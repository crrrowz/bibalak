//! Pure progress engine rules: card review rewards, deterministic ledger IDs,
//! and the Bibalak leveling curve (ADR-019, D1, D15).
//!
//! No IO, no database dependencies, and no system-clock reads.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use ts_rs::TS;

use crate::ipc::epoch_days_to_date_string;
use crate::model::Rating;

/// Milliseconds per calendar day.
pub const MS_PER_DAY: i64 = 86_400_000;
/// Rolling 30-day window (in ms) used for true-retention calculations.
pub const RETENTION_30D_MS: i64 = 30 * MS_PER_DAY;

/// Nil UUID used as the local single-user `user_id` in Stage 1 (D3, ADR-014 §2.1, ADR-019 §2.4).
pub const NIL_USER_ID: &str = "00000000-0000-0000-0000-000000000000";

/// Gold hundredths awarded per eligible card review (`25` = `0.25` gold, D15).
pub const REVIEW_GOLD_CENTS: u64 = 25;

/// XP awarded per rewarded task completion (ADR-019 §4.3).
pub const TASK_REWARD_XP: u64 = 10;
/// Gold hundredths awarded per rewarded task completion (`100` = `1.00` gold).
pub const TASK_REWARD_GOLD_CENTS: u64 = 100;
/// Maximum rewarded task completions per collection day (ADR-019 §4.3).
pub const TASK_DAILY_REWARD_CAP: u32 = 10;

/// XP awarded when a habit meets its daily target (ADR-019 §4.4).
pub const HABIT_REWARD_XP: u64 = 10;
/// Gold hundredths awarded when a habit meets its daily target (`100` = `1.00` gold).
pub const HABIT_REWARD_GOLD_CENTS: u64 = 100;

/// Local-only `sync_state` key storing the last collection day whose "yesterday" summary was dismissed.
pub const YESTERDAY_SUMMARY_SEEN_KEY: &str = "yesterday_summary_seen_day";

pub use crate::productivity::compute_habit_streak;

/// Fixed reward amounts for task and habit completions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FixedReward {
    pub xp: u64,
    pub gold_cents: u64,
}

/// Reward amounts for a single eligible card review.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewReward {
    pub xp: u64,
    pub gold_cents: u64,
}

/// Computed level and intra-level progress from a user's total XP.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct LevelProgress {
    /// Current level (1-based; starts at Level 1 for 0 XP).
    pub level: u32,
    /// XP earned within the current level (`0 .. xp_to_next_level`).
    pub xp_into_level: u64,
    /// Total XP needed to advance from `level` to `level + 1`.
    pub xp_to_next_level: u64,
}

/// A reward grant passed from `Collection::apply_answer` to `Storage::apply_answer`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RewardGrant {
    pub id: String,
    pub user_id: String,
    pub source_key: String,
    pub xp: i64,
    pub gold_cents: i64,
    pub now_ms: i64,
}

/// Active totals queried from `progress_ledger`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProgressTotals {
    pub total_xp: u64,
    pub gold_cents: u64,
    pub today_xp: u64,
    pub today_gold_cents: u64,
    pub tasks_rewarded_today: u32,
}

/// A row in `progress_ledger` exchanged during sync (`SyncDelta`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProgressLedgerEntry {
    pub id: String,
    pub user_id: String,
    pub source_key: String,
    pub xp: i64,
    pub gold_cents: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

/// Read-only IPC summary of the user's progress (ADR-019 §2.7 & §4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProgressSummaryDto {
    pub level: u32,
    #[ts(type = "number")]
    pub xp_into_level: u64,
    #[ts(type = "number")]
    pub xp_to_next_level: u64,
    #[ts(type = "number")]
    pub total_xp: u64,
    #[ts(type = "number")]
    pub gold_cents: u64,
    #[ts(type = "number")]
    pub today_xp: u64,
    #[ts(type = "number")]
    pub today_gold_cents: u64,
    pub tasks_rewarded_today: u32,
    pub task_reward_daily_cap: u32,
}

/// Daily reward history row for the Transcript & certificate milestone dates (ADR-019 §3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProgressDay {
    pub day: i32,
    pub date: String,
    #[ts(type = "number")]
    pub xp: u64,
    #[ts(type = "number")]
    pub gold_cents: u64,
    #[ts(type = "number")]
    pub cumulative_xp: u64,
    pub level_after: u32,
}

/// Daily study summary row for the Scholar Lecture Log (ADR-019 §3 & §4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StudyDay {
    pub day: i32,
    pub date: String,
    pub reviews: u32,
    pub minutes: f64,
    #[ts(type = "number[]")]
    pub deck_ids: Vec<i64>,
    #[ts(type = "number")]
    pub xp: u64,
    #[ts(type = "number")]
    pub gold_cents: u64,
    pub tasks_completed: u32,
    pub habits_completed: u32,
}

/// Raw activity counts and rewards for yesterday (`today - 1`) queried from storage.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct YesterdayActivity {
    pub reviews: u32,
    pub tasks_completed: u32,
    pub habits_completed: u32,
    pub xp: u64,
    pub gold_cents: u64,
}

/// Read-only IPC summary of yesterday's completed work (ADR-019 §4.8).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct YesterdaySummaryDto {
    pub day: i32,
    pub date: String,
    pub reviews: u32,
    pub tasks_completed: u32,
    pub habits_completed: u32,
    #[ts(type = "number")]
    pub xp: u64,
    #[ts(type = "number")]
    pub gold_cents: u64,
}

/// Per-top-deck rollup row for the Scholar Transcript courses table (ADR-019 §3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeckProgress {
    #[ts(type = "number")]
    pub deck_id: i64,
    pub name: String,
    pub total_cards: u32,
    pub mature_pct: f64,
    pub retention_pct: f64,
    #[ts(type = "number")]
    pub xp: u64,
    #[ts(type = "number")]
    pub gold_cents: u64,
    pub last_studied_date: Option<String>,
}

/// Components parsed from a `card_review:<card_id>:<day_index>` ledger `source_key`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParsedReviewSourceKey {
    pub card_id: i64,
    pub day_index: i32,
}

/// Components parsed from any supported `progress_ledger.source_key`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedSourceKey {
    CardReview { card_id: i64, day_index: i32 },
    TaskDone { task_id: String },
    HabitLog { habit_id: String, day_index: i32 },
    QuestDaily { day_index: i32, quest_id: String },
    QuestWeekly { week_index: i32, quest_id: String },
    ComebackBonus { day_index: i32 },
    MonthlyBadge { month_key: String },
}

/// Build the per-card-per-day idempotency source key (`card_review:<card_id>:<day_index>`).
pub fn review_source_key(card_id: i64, day_index: i32) -> String {
    format!("card_review:{card_id}:{day_index}")
}

/// Build the per-task completion idempotency source key (`task_done:<task_id>`).
pub fn task_source_key(task_id: &str) -> String {
    format!("task_done:{task_id}")
}

/// Build the per-habit-per-day idempotency source key (`habit_log:<habit_id>:<day_index>`).
pub fn habit_source_key(habit_id: &str, day_index: i32) -> String {
    format!("habit_log:{habit_id}:{day_index}")
}

/// Parse any supported `progress_ledger.source_key`.
pub fn parse_ledger_source_key(key: &str) -> Option<ParsedSourceKey> {
    let mut parts = key.split(':');
    match parts.next()? {
        "card_review" => {
            let card_str = parts.next()?;
            let day_str = parts.next()?;
            if parts.next().is_some() || card_str.starts_with('+') || day_str.starts_with('+') {
                return None;
            }
            let card_id = card_str.parse::<i64>().ok()?;
            let day_index = day_str.parse::<i32>().ok()?;
            Some(ParsedSourceKey::CardReview { card_id, day_index })
        }
        "task_done" => {
            let task_id = parts.next()?;
            if parts.next().is_some() || !crate::productivity::is_valid_uuid(task_id) {
                return None;
            }
            Some(ParsedSourceKey::TaskDone {
                task_id: task_id.to_string(),
            })
        }
        "habit_log" => {
            let habit_id = parts.next()?;
            let day_str = parts.next()?;
            if parts.next().is_some()
                || !crate::productivity::is_valid_uuid(habit_id)
                || day_str.starts_with('+')
            {
                return None;
            }
            let day_index = day_str.parse::<i32>().ok()?;
            Some(ParsedSourceKey::HabitLog {
                habit_id: habit_id.to_string(),
                day_index,
            })
        }
        "quest_daily" => {
            let day_str = parts.next()?;
            let quest_id = parts.next()?;
            if parts.next().is_some() || day_str.starts_with('+') || quest_id.trim().is_empty() {
                return None;
            }
            let day_index = day_str.parse::<i32>().ok()?;
            Some(ParsedSourceKey::QuestDaily {
                day_index,
                quest_id: quest_id.to_string(),
            })
        }
        "quest_weekly" => {
            let week_str = parts.next()?;
            let quest_id = parts.next()?;
            if parts.next().is_some() || week_str.starts_with('+') || quest_id.trim().is_empty() {
                return None;
            }
            let week_index = week_str.parse::<i32>().ok()?;
            Some(ParsedSourceKey::QuestWeekly {
                week_index,
                quest_id: quest_id.to_string(),
            })
        }
        "comeback_bonus" => {
            let day_str = parts.next()?;
            if parts.next().is_some() || day_str.starts_with('+') {
                return None;
            }
            let day_index = day_str.parse::<i32>().ok()?;
            Some(ParsedSourceKey::ComebackBonus { day_index })
        }
        "badge_monthly" => {
            let month_key = parts.next()?;
            if parts.next().is_some() || !crate::motivation::is_valid_month_key(month_key) {
                return None;
            }
            Some(ParsedSourceKey::MonthlyBadge {
                month_key: month_key.to_string(),
            })
        }
        _ => None,
    }
}

/// Parse a `card_review:<card_id>:<day_index>` ledger key, returning `None` if malformed.
pub fn parse_review_source_key(key: &str) -> Option<ParsedReviewSourceKey> {
    match parse_ledger_source_key(key) {
        Some(ParsedSourceKey::CardReview { card_id, day_index }) => {
            Some(ParsedReviewSourceKey { card_id, day_index })
        }
        _ => None,
    }
}

/// Fixed reward for completing a task when under the daily reward cap (`< 10`).
pub fn reward_for_task(tasks_rewarded_today: u32) -> Option<FixedReward> {
    (tasks_rewarded_today < TASK_DAILY_REWARD_CAP).then_some(FixedReward {
        xp: TASK_REWARD_XP,
        gold_cents: TASK_REWARD_GOLD_CENTS,
    })
}

/// Habits earn rewards only for `today` and `today - 1` (yesterday), never older or future days.
pub fn is_habit_day_reward_eligible(day_index: i32, today: i32) -> bool {
    day_index == today || day_index == today.saturating_sub(1)
}

/// Fixed reward for completing a habit target on an eligible day.
pub fn reward_for_habit(completed: bool, day_index: i32, today: i32) -> Option<FixedReward> {
    (completed && is_habit_day_reward_eligible(day_index, today)).then_some(FixedReward {
        xp: HABIT_REWARD_XP,
        gold_cents: HABIT_REWARD_GOLD_CENTS,
    })
}

/// Collect `root_deck_id` and every descendant deck ID reachable via `parent_id`.
/// Returns an empty set if `root_deck_id` does not exist.
pub fn deck_subtree_ids(decks: &[(i64, Option<i64>)], root_deck_id: i64) -> HashSet<i64> {
    let mut exists = false;
    let mut children: HashMap<i64, Vec<i64>> = HashMap::new();
    for &(id, parent_id) in decks {
        if id == root_deck_id {
            exists = true;
        }
        if let Some(pid) = parent_id {
            children.entry(pid).or_default().push(id);
        }
    }
    if !exists {
        return HashSet::new();
    }
    let mut out = HashSet::new();
    let mut stack = vec![root_deck_id];
    while let Some(cur) = stack.pop() {
        if !out.insert(cur) {
            continue;
        }
        if let Some(kids) = children.get(&cur) {
            stack.extend(kids.iter().copied());
        }
    }
    out
}

/// Count study reviews (`review_kind` in `0..=3`) inside `[start_ms, end_ms)` belonging to `subtree_deck_ids`.
pub fn count_deck_reviews_in_window(
    revlogs: &[StudyRevlogInput],
    card_decks: &HashMap<i64, i64>,
    subtree_deck_ids: &HashSet<i64>,
    start_ms: i64,
    end_ms: i64,
) -> u32 {
    if subtree_deck_ids.is_empty() {
        return 0;
    }
    revlogs
        .iter()
        .filter(|r| {
            r.id >= start_ms
                && r.id < end_ms
                && (0..=3).contains(&r.review_kind)
                && card_decks
                    .get(&r.card_id)
                    .is_some_and(|did| subtree_deck_ids.contains(did))
        })
        .count() as u32
}

/// Build the optional "yesterday" summary DTO, returning `None` when yesterday had no completed work.
pub fn build_yesterday_summary(
    day: i32,
    created_epoch_day: i64,
    activity: YesterdayActivity,
) -> Option<YesterdaySummaryDto> {
    if activity.reviews == 0 && activity.tasks_completed == 0 && activity.habits_completed == 0 {
        return None;
    }
    Some(YesterdaySummaryDto {
        day,
        date: epoch_days_to_date_string(created_epoch_day + i64::from(day)),
        reviews: activity.reviews,
        tasks_completed: activity.tasks_completed,
        habits_completed: activity.habits_completed,
        xp: activity.xp,
        gold_cents: activity.gold_cents,
    })
}

/// Raw `progress_ledger` row input for pure progress history/log/deck aggregation.
#[derive(Debug, Clone)]
pub struct LedgerRewardInput {
    pub source_key: String,
    pub xp: i64,
    pub gold_cents: i64,
    pub created_at: i64,
}

/// Raw `revlog` row input for pure study-day and per-deck aggregation.
#[derive(Debug, Clone, Copy)]
pub struct StudyRevlogInput {
    pub id: i64,
    pub card_id: i64,
    pub ease: i64,
    pub taken_ms: i64,
    pub review_kind: i64,
}

/// Raw `cards` row input for pure per-deck progress aggregation.
#[derive(Debug, Clone, Copy)]
pub struct DeckCardInput {
    pub card_id: i64,
    pub deck_id: i64,
    pub ctype: i64,
    pub queue: i64,
    pub interval: i64,
}

/// True when a card row counts as mature in Stats / Transcript (`queue >= 0 && ctype == 2 && interval >= 21`).
pub fn is_mature_card(ctype: i64, queue: i64, interval: i64) -> bool {
    queue >= 0 && ctype == 2 && interval >= 21
}

/// Compute `numerator / denominator * 100.0`, returning `0.0` when `denominator == 0`.
pub fn percentage(numerator: u32, denominator: u32) -> f64 {
    if denominator > 0 {
        f64::from(numerator) / f64::from(denominator) * 100.0
    } else {
        0.0
    }
}

/// Rollover-aligned epoch day for collection creation (`created_ms`).
pub fn created_epoch_day(created_ms: i64, tz_offset_minutes: i32, rollover_hour: u8) -> i64 {
    let tz_off_ms = i64::from(tz_offset_minutes) * 60_000;
    let rollover_ms = i64::from(rollover_hour) * 3_600_000;
    (created_ms + tz_off_ms - rollover_ms).div_euclid(MS_PER_DAY)
}

/// Accumulated passed/total counts for true-retention calculations.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RetentionTally {
    pub passed: u32,
    pub total: u32,
}

impl RetentionTally {
    pub fn record(&mut self, passed: bool) {
        self.total += 1;
        if passed {
            self.passed += 1;
        }
    }

    pub fn pct(self) -> f64 {
        percentage(self.passed, self.total)
    }

    pub fn pct_opt(self) -> Option<f64> {
        (self.total > 0).then(|| self.pct())
    }
}

/// Evaluates 30-day true retention over an `id`-ordered revlog stream:
/// first review per card per rollover day, `review_kind == 1`, `id_ms >= cutoff_ms`,
/// with `ease > 1` counted as a pass.
#[derive(Debug, Clone)]
pub struct RetentionCounter {
    cutoff_ms: i64,
    cur_day: Option<i64>,
    seen_today: HashSet<i64>,
    tally: RetentionTally,
}

impl RetentionCounter {
    /// Create a counter for reviews within the 30-day window ending at `now_ms`.
    pub fn new_30d(now_ms: i64) -> Self {
        Self {
            cutoff_ms: now_ms - RETENTION_30D_MS,
            cur_day: None,
            seen_today: HashSet::new(),
            tally: RetentionTally::default(),
        }
    }

    /// Observe one review from an `id`-ordered stream and return `(is_first_today, counted_30d_pass)`.
    pub fn observe(
        &mut self,
        card_id: i64,
        id_ms: i64,
        review_kind: i64,
        ease: i64,
        day_idx: i64,
    ) -> (bool, Option<bool>) {
        if self.cur_day != Some(day_idx) {
            self.cur_day = Some(day_idx);
            self.seen_today.clear();
        }
        let is_first = self.seen_today.insert(card_id);
        if id_ms >= self.cutoff_ms && review_kind == 1 && is_first {
            let passed = ease > 1;
            self.tally.record(passed);
            (is_first, Some(passed))
        } else {
            (is_first, None)
        }
    }

    pub fn passed(&self) -> u32 {
        self.tally.passed
    }

    pub fn total(&self) -> u32 {
        self.tally.total
    }

    pub fn pct(&self) -> f64 {
        self.tally.pct()
    }
}

/// Collection-relative day index for `ms`, matching `Collection::local_day_index` and `Stats`.
pub fn day_index_for_ms(
    ms: i64,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_day: i64,
) -> i64 {
    created_epoch_day(ms, tz_offset_minutes, rollover_hour) - created_day
}

/// Map every `deck_id` in `(id, name, parent_id)` to its root `(top_deck_id, top_deck_name)`.
pub fn build_top_deck_lookup(
    decks: impl IntoIterator<Item = (i64, String, Option<i64>)>,
) -> HashMap<i64, (i64, String)> {
    let raw: HashMap<i64, (String, Option<i64>)> = decks
        .into_iter()
        .map(|(id, name, parent_id)| (id, (name, parent_id)))
        .collect();
    let max_hops = raw.len();
    let mut out = HashMap::with_capacity(raw.len());
    for &id in raw.keys() {
        let mut cur = id;
        for _ in 0..max_hops {
            match raw.get(&cur).and_then(|(_, parent)| *parent) {
                Some(p) if raw.contains_key(&p) && p != cur => cur = p,
                _ => break,
            }
        }
        if let Some((name, _)) = raw.get(&cur) {
            out.insert(id, (cur, name.clone()));
        }
    }
    out
}

/// Aggregate active ledger rewards (reviews, tasks, habits) into ascending [`ProgressDay`] rows.
pub fn aggregate_progress_history(
    rewards: impl IntoIterator<Item = LedgerRewardInput>,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
) -> (Vec<ProgressDay>, usize) {
    let created_day = created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
    let mut by_day: BTreeMap<i32, (u64, u64)> = BTreeMap::new();
    let mut skipped = 0usize;

    for row in rewards {
        let day_index = match parse_ledger_source_key(&row.source_key) {
            Some(ParsedSourceKey::CardReview { day_index, .. })
            | Some(ParsedSourceKey::HabitLog { day_index, .. })
            | Some(ParsedSourceKey::QuestDaily { day_index, .. })
            | Some(ParsedSourceKey::ComebackBonus { day_index }) => day_index,
            Some(ParsedSourceKey::TaskDone { .. })
            | Some(ParsedSourceKey::QuestWeekly { .. })
            | Some(ParsedSourceKey::MonthlyBadge { .. }) => {
                let d = day_index_for_ms(
                    row.created_at,
                    tz_offset_minutes,
                    rollover_hour,
                    created_day,
                );
                match i32::try_from(d) {
                    Ok(day) => day,
                    Err(_) => {
                        skipped += 1;
                        continue;
                    }
                }
            }
            None => {
                skipped += 1;
                continue;
            }
        };
        let entry = by_day.entry(day_index).or_insert((0, 0));
        entry.0 = entry.0.saturating_add(row.xp.max(0) as u64);
        entry.1 = entry.1.saturating_add(row.gold_cents.max(0) as u64);
    }

    let mut cumulative_xp = 0_u64;
    let mut out = Vec::with_capacity(by_day.len());
    for (day, (xp, gold_cents)) in by_day {
        cumulative_xp = cumulative_xp.saturating_add(xp);
        let level_after = level_from_xp(cumulative_xp).level;
        let date = epoch_days_to_date_string(created_day + i64::from(day));
        out.push(ProgressDay {
            day,
            date,
            xp,
            gold_cents,
            cumulative_xp,
            level_after,
        });
    }
    (out, skipped)
}

/// Aggregate `revlog`, completed tasks/habits, and active `progress_ledger` rows into the last `limit` [`StudyDay`] rows, newest first.
#[allow(clippy::too_many_arguments)]
pub fn aggregate_study_days(
    revlogs: impl IntoIterator<Item = StudyRevlogInput>,
    card_top_decks: &HashMap<i64, i64>,
    completed_task_days: impl IntoIterator<Item = i32>,
    completed_habit_days: impl IntoIterator<Item = i32>,
    rewards: impl IntoIterator<Item = LedgerRewardInput>,
    limit: u32,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
) -> (Vec<StudyDay>, usize) {
    #[derive(Default)]
    struct DayAccum {
        reviews: u32,
        taken_ms: i64,
        deck_set: BTreeSet<i64>,
        tasks_completed: u32,
        habits_completed: u32,
        xp: u64,
        gold_cents: u64,
    }

    let created_day = created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
    let mut by_day: BTreeMap<i32, DayAccum> = BTreeMap::new();
    let mut skipped = 0usize;

    for row in rewards {
        let day_index = match parse_ledger_source_key(&row.source_key) {
            Some(ParsedSourceKey::CardReview { day_index, .. })
            | Some(ParsedSourceKey::HabitLog { day_index, .. })
            | Some(ParsedSourceKey::QuestDaily { day_index, .. })
            | Some(ParsedSourceKey::ComebackBonus { day_index }) => day_index,
            Some(ParsedSourceKey::TaskDone { .. })
            | Some(ParsedSourceKey::QuestWeekly { .. })
            | Some(ParsedSourceKey::MonthlyBadge { .. }) => {
                let d = day_index_for_ms(
                    row.created_at,
                    tz_offset_minutes,
                    rollover_hour,
                    created_day,
                );
                match i32::try_from(d) {
                    Ok(day) => day,
                    Err(_) => {
                        skipped += 1;
                        continue;
                    }
                }
            }
            None => {
                skipped += 1;
                continue;
            }
        };
        let entry = by_day.entry(day_index).or_default();
        entry.xp = entry.xp.saturating_add(row.xp.max(0) as u64);
        entry.gold_cents = entry
            .gold_cents
            .saturating_add(row.gold_cents.max(0) as u64);
    }

    for r in revlogs {
        // Manual reschedules (review_kind == 4) and unknown kinds do not count as study reviews.
        if !(0..=3).contains(&r.review_kind) {
            continue;
        }
        let day_i64 = day_index_for_ms(r.id, tz_offset_minutes, rollover_hour, created_day);
        let Ok(day) = i32::try_from(day_i64) else {
            continue;
        };
        let entry = by_day.entry(day).or_default();
        entry.reviews += 1;
        entry.taken_ms = entry.taken_ms.saturating_add(r.taken_ms.max(0));
        if let Some(&top_deck_id) = card_top_decks.get(&r.card_id) {
            entry.deck_set.insert(top_deck_id);
        }
    }

    for day in completed_task_days {
        by_day.entry(day).or_default().tasks_completed += 1;
    }

    for day in completed_habit_days {
        by_day.entry(day).or_default().habits_completed += 1;
    }

    let take_n = limit.min(365) as usize;
    let days = by_day
        .into_iter()
        .filter(|(_, a)| {
            a.reviews > 0
                || a.tasks_completed > 0
                || a.habits_completed > 0
                || a.xp > 0
                || a.gold_cents > 0
        })
        .rev()
        .take(take_n)
        .map(|(day, a)| {
            let minutes = ((a.taken_ms as f64 / 60_000.0) * 10.0).round() / 10.0;
            StudyDay {
                day,
                date: epoch_days_to_date_string(created_day + i64::from(day)),
                reviews: a.reviews,
                minutes,
                deck_ids: a.deck_set.into_iter().collect(),
                xp: a.xp,
                gold_cents: a.gold_cents,
                tasks_completed: a.tasks_completed,
                habits_completed: a.habits_completed,
            }
        })
        .collect();
    (days, skipped)
}

/// Aggregate per-top-deck cards, 30d retention, last studied date, and ledger rewards
/// (card reviews + active deck-linked habits).
/// `revlogs` must be ordered by `id` ascending so first-review-per-day retention matches Stats.
#[allow(clippy::too_many_arguments)]
pub fn aggregate_progress_by_deck(
    decks: impl IntoIterator<Item = (i64, String, Option<i64>)>,
    cards: impl IntoIterator<Item = DeckCardInput>,
    revlogs: impl IntoIterator<Item = StudyRevlogInput>,
    habit_top_decks: &HashMap<String, i64>,
    rewards: impl IntoIterator<Item = LedgerRewardInput>,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    now_ms: i64,
    created_ms: i64,
) -> (Vec<DeckProgress>, usize) {
    #[derive(Default)]
    struct TopAccum {
        name: String,
        total_cards: u32,
        mature_count: u32,
        retention: RetentionTally,
        xp: u64,
        gold_cents: u64,
        last_studied_day: Option<i64>,
    }

    let created_day = created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
    let top_lookup = build_top_deck_lookup(decks);
    let mut top_decks: HashMap<i64, TopAccum> = HashMap::new();
    for &(top_id, ref top_name) in top_lookup.values() {
        top_decks.entry(top_id).or_insert_with(|| TopAccum {
            name: top_name.clone(),
            ..Default::default()
        });
    }

    let mut card_top_deck: HashMap<i64, i64> = HashMap::new();
    for card in cards {
        let Some(&(top_id, _)) = top_lookup.get(&card.deck_id) else {
            continue;
        };
        card_top_deck.insert(card.card_id, top_id);
        if let Some(acc) = top_decks.get_mut(&top_id) {
            acc.total_cards += 1;
            if is_mature_card(card.ctype, card.queue, card.interval) {
                acc.mature_count += 1;
            }
        }
    }

    let mut retention_30d = RetentionCounter::new_30d(now_ms);
    for r in revlogs {
        let day_idx = day_index_for_ms(r.id, tz_offset_minutes, rollover_hour, created_day);
        let (_, retention_pass) =
            retention_30d.observe(r.card_id, r.id, r.review_kind, r.ease, day_idx);
        let Some(&top_id) = card_top_deck.get(&r.card_id) else {
            continue;
        };
        let Some(acc) = top_decks.get_mut(&top_id) else {
            continue;
        };
        if (0..=3).contains(&r.review_kind) {
            acc.last_studied_day = Some(acc.last_studied_day.map_or(day_idx, |p| p.max(day_idx)));
        }
        if let Some(passed) = retention_pass {
            acc.retention.record(passed);
        }
    }

    let mut skipped = 0usize;
    for row in rewards {
        let top_id = match parse_ledger_source_key(&row.source_key) {
            Some(ParsedSourceKey::CardReview { card_id, .. }) => {
                card_top_deck.get(&card_id).copied()
            }
            Some(ParsedSourceKey::HabitLog { habit_id, .. }) => {
                habit_top_decks.get(&habit_id).copied()
            }
            Some(ParsedSourceKey::TaskDone { .. })
            | Some(ParsedSourceKey::QuestDaily { .. })
            | Some(ParsedSourceKey::QuestWeekly { .. })
            | Some(ParsedSourceKey::ComebackBonus { .. })
            | Some(ParsedSourceKey::MonthlyBadge { .. }) => None,
            None => {
                skipped += 1;
                None
            }
        };
        let Some(top_id) = top_id else {
            continue;
        };
        if let Some(acc) = top_decks.get_mut(&top_id) {
            acc.xp = acc.xp.saturating_add(row.xp.max(0) as u64);
            acc.gold_cents = acc.gold_cents.saturating_add(row.gold_cents.max(0) as u64);
        }
    }

    let mut out: Vec<DeckProgress> = top_decks
        .into_iter()
        .filter(|(_, acc)| acc.total_cards > 0)
        .map(|(deck_id, acc)| DeckProgress {
            deck_id,
            name: acc.name,
            total_cards: acc.total_cards,
            mature_pct: percentage(acc.mature_count, acc.total_cards),
            retention_pct: acc.retention.pct(),
            xp: acc.xp,
            gold_cents: acc.gold_cents,
            last_studied_date: acc
                .last_studied_day
                .map(|d| epoch_days_to_date_string(created_day + d)),
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name).then(a.deck_id.cmp(&b.deck_id)));
    (out, skipped)
}

/// Compute the deterministic RFC 4122 v5 (SHA-1) UUID for `(user_id, source_key)`.
pub fn ledger_id(user_id: &str, source_key: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(b"keepsake:progress_ledger:v1:");
    hasher.update(user_id.as_bytes());
    hasher.update(b":");
    hasher.update(source_key.as_bytes());
    let digest = hasher.finalize();

    let mut b = [0_u8; 16];
    b.copy_from_slice(&digest[..16]);
    // RFC 4122 version 5 (name-based SHA-1)
    b[6] = (b[6] & 0x0f) | 0x50;
    // RFC 4122 variant (10xx)
    b[8] = (b[8] & 0x3f) | 0x80;

    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3],
        b[4], b[5],
        b[6], b[7],
        b[8], b[9],
        b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

/// Return the reward for answering a card with `rating` and `review_kind`
/// (`0=learn, 1=review, 2=relearn, 3=cram, 4=manual`).
/// Manual reschedules (`review_kind == 4` or outside `0..=3`) earn no reward.
pub fn reward_for_review(rating: Rating, review_kind: i64) -> Option<ReviewReward> {
    if !(0..=3).contains(&review_kind) {
        return None;
    }
    let xp = match rating {
        Rating::Again => 1,
        Rating::Hard => 2,
        Rating::Good | Rating::Easy => 3,
    };
    Some(ReviewReward {
        xp,
        gold_cents: REVIEW_GOLD_CENTS,
    })
}

/// Return the reward for a raw Anki revlog `ease` (`1..=4`) and `review_kind`.
pub fn reward_for_revlog(ease: i64, review_kind: i64) -> Option<ReviewReward> {
    let rating = match ease {
        1 => Rating::Again,
        2 => Rating::Hard,
        3 => Rating::Good,
        4 => Rating::Easy,
        _ => return None,
    };
    reward_for_review(rating, review_kind)
}

/// XP required to advance from `level` to `level + 1`: `50 * L + 50` (for `L >= 1`).
pub fn xp_to_next(level: u32) -> u64 {
    let l = u64::from(level.max(1));
    50_u64.saturating_mul(l).saturating_add(50)
}

fn cumulative_xp_u128(level: u32) -> u128 {
    let l = u128::from(level.max(1));
    25_u128 * (l - 1) * (l + 2)
}

/// Cumulative total XP required to reach the start of `level` (`L >= 1`):
/// `25 * (L - 1) * (L + 2)`.
pub fn cumulative_xp_for_level(level: u32) -> u64 {
    u64::try_from(cumulative_xp_u128(level)).unwrap_or(u64::MAX)
}

/// Derive current level, XP into the current level, and XP to the next level
/// from `total_xp` without overflow at large totals.
pub fn level_from_xp(total_xp: u64) -> LevelProgress {
    let target = u128::from(total_xp);
    let mut lo: u32 = 1;
    // At L = 1_000_000_000, cumulative XP is ~2.5e19 > u64::MAX (~1.844e19).
    let mut hi: u32 = 1_000_000_000;
    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2);
        if cumulative_xp_u128(mid) <= target {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    let start_xp = u64::try_from(cumulative_xp_u128(lo)).unwrap_or(total_xp);
    let xp_into_level = total_xp.saturating_sub(start_xp);
    let xp_to_next_level = xp_to_next(lo);
    LevelProgress {
        level: lo,
        xp_into_level,
        xp_to_next_level,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_rating_gives_adr_019_reward_for_study_review_kinds() {
        for kind in 0..=3 {
            assert_eq!(
                reward_for_review(Rating::Again, kind),
                Some(ReviewReward {
                    xp: 1,
                    gold_cents: 25
                })
            );
            assert_eq!(
                reward_for_review(Rating::Hard, kind),
                Some(ReviewReward {
                    xp: 2,
                    gold_cents: 25
                })
            );
            assert_eq!(
                reward_for_review(Rating::Good, kind),
                Some(ReviewReward {
                    xp: 3,
                    gold_cents: 25
                })
            );
            assert_eq!(
                reward_for_review(Rating::Easy, kind),
                Some(ReviewReward {
                    xp: 3,
                    gold_cents: 25
                })
            );
        }
    }

    #[test]
    fn manual_reschedules_and_unknown_kinds_give_no_reward() {
        for rating in [Rating::Again, Rating::Hard, Rating::Good, Rating::Easy] {
            assert_eq!(reward_for_review(rating, 4), None);
            assert_eq!(reward_for_review(rating, -1), None);
            assert_eq!(reward_for_review(rating, 99), None);
        }
        assert_eq!(reward_for_revlog(3, 4), None);
        assert_eq!(reward_for_revlog(0, 0), None);
    }

    #[test]
    fn level_curve_matches_adr_019_table_and_boundaries() {
        // ADR-019 §2.3 table: (level, xp_to_next, cumulative_xp)
        let table: &[(u32, u64, u64)] = &[
            (1, 100, 0),
            (2, 150, 100),
            (3, 200, 250),
            (4, 250, 450),
            (5, 300, 700),
            (6, 350, 1_000),
            (7, 400, 1_350),
            (8, 450, 1_750),
            (9, 500, 2_200),
            (10, 550, 2_700),
            (25, 1_300, 16_200),
            (50, 2_550, 63_700),
        ];

        for &(lvl, expected_next, expected_cum) in table {
            assert_eq!(xp_to_next(lvl), expected_next, "xp_to_next(L={lvl})");
            assert_eq!(
                cumulative_xp_for_level(lvl),
                expected_cum,
                "cumulative_xp_for_level(L={lvl})"
            );
            let at_start = level_from_xp(expected_cum);
            assert_eq!(
                at_start,
                LevelProgress {
                    level: lvl,
                    xp_into_level: 0,
                    xp_to_next_level: expected_next,
                },
                "level_from_xp at exact start of L={lvl}"
            );
        }

        // Exact boundary checks required by 07-R1 §3.1: 0, 99, 100, 249 XP
        assert_eq!(
            level_from_xp(0),
            LevelProgress {
                level: 1,
                xp_into_level: 0,
                xp_to_next_level: 100,
            }
        );
        assert_eq!(
            level_from_xp(99),
            LevelProgress {
                level: 1,
                xp_into_level: 99,
                xp_to_next_level: 100,
            }
        );
        assert_eq!(
            level_from_xp(100),
            LevelProgress {
                level: 2,
                xp_into_level: 0,
                xp_to_next_level: 150,
            }
        );
        assert_eq!(
            level_from_xp(249),
            LevelProgress {
                level: 2,
                xp_into_level: 149,
                xp_to_next_level: 150,
            }
        );
    }

    #[test]
    fn level_from_xp_does_not_overflow_at_large_totals() {
        let large = level_from_xp(u64::MAX / 2);
        assert!(large.level > 1_000_000);
        assert!(large.xp_into_level < large.xp_to_next_level);

        let max = level_from_xp(u64::MAX);
        assert!(max.level >= large.level);
        assert!(max.xp_to_next_level > 0);
    }

    #[test]
    fn source_key_and_deterministic_uuid_v5_layout() {
        let key = review_source_key(42, 7);
        assert_eq!(key, "card_review:42:7");

        let id1 = ledger_id(NIL_USER_ID, &key);
        let id2 = ledger_id(NIL_USER_ID, &key);
        assert_eq!(
            id1, id2,
            "same (user_id, source_key) must produce identical UUID"
        );
        assert_eq!(id1.len(), 36);
        let bytes = id1.as_bytes();
        assert_eq!(bytes[8], b'-');
        assert_eq!(bytes[13], b'-');
        assert_eq!(bytes[14], b'5', "RFC 4122 version nibble must be 5");
        assert_eq!(bytes[18], b'-');
        assert!(
            matches!(bytes[19], b'8' | b'9' | b'a' | b'b'),
            "RFC 4122 variant nibble must be 8, 9, a, or b, got {}",
            bytes[19] as char
        );
        assert_eq!(bytes[23], b'-');

        let other_day = ledger_id(NIL_USER_ID, &review_source_key(42, 8));
        assert_ne!(id1, other_day);
    }

    #[test]
    fn parse_review_source_key_accepts_valid_and_rejects_malformed() {
        assert_eq!(
            parse_review_source_key(&review_source_key(42, 7)),
            Some(ParsedReviewSourceKey {
                card_id: 42,
                day_index: 7,
            })
        );
        assert_eq!(
            parse_review_source_key("card_review:1001:0"),
            Some(ParsedReviewSourceKey {
                card_id: 1001,
                day_index: 0,
            })
        );
        assert_eq!(
            parse_review_source_key("card_review:-5:-1"),
            Some(ParsedReviewSourceKey {
                card_id: -5,
                day_index: -1,
            })
        );
        assert_eq!(parse_review_source_key(""), None);
        assert_eq!(parse_review_source_key("card_review:42"), None);
        assert_eq!(parse_review_source_key("card_review:42:7:extra"), None);
        assert_eq!(parse_review_source_key("task_done:42:7"), None);
        assert_eq!(parse_review_source_key("card_review:abc:7"), None);
        assert_eq!(parse_review_source_key("card_review:42:xyz"), None);
        assert_eq!(parse_review_source_key("card_review: 42:7"), None);
    }

    #[test]
    fn retention_counter_counts_first_kind_1_review_per_card_per_day_in_30d_window() {
        let now_ms = 100 * MS_PER_DAY;
        let cutoff = now_ms - RETENTION_30D_MS;
        let mut counter = RetentionCounter::new_30d(now_ms);

        // Outside the 30-day window -> ignored, though still tracked for same-day first review.
        assert_eq!(counter.observe(1, cutoff - 1, 1, 3, 69), (true, None));
        assert_eq!(counter.total(), 0);

        // Exact 30d boundary (day 70): card 1 passes, then fails later the same day -> counts once as pass.
        assert_eq!(counter.observe(1, cutoff, 1, 3, 70), (true, Some(true)));
        assert_eq!(counter.observe(1, cutoff + 1_000, 1, 1, 70), (false, None));

        // Day 70: card 2 has a learning review (kind 0) before a review (kind 1) -> first review wasn't kind 1, ignored.
        assert_eq!(counter.observe(2, cutoff + 2_000, 0, 3, 70), (true, None));
        assert_eq!(counter.observe(2, cutoff + 3_000, 1, 3, 70), (false, None));

        // Day 70: relearn (kind 2), cram (kind 3), manual (kind 4) are ignored.
        assert_eq!(counter.observe(3, cutoff + 4_000, 2, 3, 70), (true, None));
        assert_eq!(counter.observe(4, cutoff + 5_000, 3, 3, 70), (true, None));
        assert_eq!(counter.observe(5, cutoff + 6_000, 4, 3, 70), (true, None));

        // Day 71: card 1 seen again on a new day (ease 1 = fail), card 2 first review kind 1 (ease 2 = pass).
        assert_eq!(
            counter.observe(1, cutoff + MS_PER_DAY, 1, 1, 71),
            (true, Some(false))
        );
        assert_eq!(
            counter.observe(2, cutoff + MS_PER_DAY + 500, 1, 2, 71),
            (true, Some(true))
        );

        assert_eq!(counter.total(), 3);
        assert_eq!(counter.passed(), 2);
        assert!((counter.pct() - (200.0 / 3.0)).abs() < 1e-9);
    }

    #[test]
    fn day_index_for_ms_matches_stats_formula_for_positive_timestamps_and_uses_div_euclid_for_negative(
    ) {
        let created_samples = [
            0_i64,
            1_700_000_000_000,
            1_794_601_800_000,
            86_400_000 + 3_600_000,
        ];
        let tz_offsets = [-720, -300, 0, 120, 180, 330, 540, 840];

        for &created_ms in &created_samples {
            for &tz in &tz_offsets {
                let tz_off_ms = i64::from(tz) * 60_000;
                for rollover in 0..=23_u8 {
                    let rollover_ms = i64::from(rollover) * 3_600_000;
                    if created_ms + tz_off_ms - rollover_ms < 0 {
                        continue;
                    }
                    let created_day = created_epoch_day(created_ms, tz, rollover);
                    let old_created_div = (created_ms + tz_off_ms - rollover_ms) / MS_PER_DAY;
                    assert_eq!(created_day, old_created_div);

                    for hour_off in [0_i64, 3, 12, 23, 25, 48] {
                        let ms = created_ms + hour_off * 3_600_000 + 123_456;
                        let old_stats_day =
                            ((ms + tz_off_ms - rollover_ms) / MS_PER_DAY) - old_created_div;
                        let helper_day = day_index_for_ms(ms, tz, rollover, created_day);
                        assert_eq!(
                            helper_day, old_stats_day,
                            "mismatch at created={created_ms} ms={ms} tz={tz} rollover={rollover}"
                        );
                    }
                }
            }
        }

        // Negative timestamp: div_euclid floors to -1 instead of truncating toward 0.
        let created_day = created_epoch_day(0, 0, 0);
        assert_eq!(created_day, 0);
        assert_eq!(day_index_for_ms(-3_600_000, 0, 0, created_day), -1);
    }

    #[test]
    fn task_and_habit_reward_constants_and_priority_invariance() {
        assert_eq!(TASK_REWARD_XP, 10);
        assert_eq!(TASK_REWARD_GOLD_CENTS, 100);
        assert_eq!(TASK_DAILY_REWARD_CAP, 10);
        assert_eq!(HABIT_REWARD_XP, 10);
        assert_eq!(HABIT_REWARD_GOLD_CENTS, 100);

        for count in 0..TASK_DAILY_REWARD_CAP {
            assert_eq!(
                reward_for_task(count),
                Some(FixedReward {
                    xp: 10,
                    gold_cents: 100,
                })
            );
        }
        assert_eq!(reward_for_task(TASK_DAILY_REWARD_CAP), None);
        assert_eq!(reward_for_task(TASK_DAILY_REWARD_CAP + 5), None);

        assert!(is_habit_day_reward_eligible(5, 5));
        assert!(is_habit_day_reward_eligible(4, 5));
        assert!(!is_habit_day_reward_eligible(3, 5));
        assert!(!is_habit_day_reward_eligible(6, 5));

        assert_eq!(
            reward_for_habit(true, 5, 5),
            Some(FixedReward {
                xp: 10,
                gold_cents: 100,
            })
        );
        assert_eq!(
            reward_for_habit(true, 4, 5),
            Some(FixedReward {
                xp: 10,
                gold_cents: 100,
            })
        );
        assert_eq!(reward_for_habit(false, 5, 5), None);
        assert_eq!(reward_for_habit(true, 3, 5), None);
        assert_eq!(reward_for_habit(true, 6, 5), None);
    }

    #[test]
    fn parse_ledger_source_key_parses_all_three_kinds_and_rejects_malformed() {
        let task_uuid = "11111111-1111-4111-8111-111111111111";
        let habit_uuid = "22222222-2222-4222-8222-222222222222";

        assert_eq!(
            parse_ledger_source_key(&review_source_key(42, 7)),
            Some(ParsedSourceKey::CardReview {
                card_id: 42,
                day_index: 7,
            })
        );
        assert_eq!(
            parse_ledger_source_key(&task_source_key(task_uuid)),
            Some(ParsedSourceKey::TaskDone {
                task_id: task_uuid.to_string(),
            })
        );
        assert_eq!(
            parse_ledger_source_key(&habit_source_key(habit_uuid, 3)),
            Some(ParsedSourceKey::HabitLog {
                habit_id: habit_uuid.to_string(),
                day_index: 3,
            })
        );

        assert_eq!(parse_ledger_source_key("task_done:not-a-uuid"), None);
        assert_eq!(
            parse_ledger_source_key(&format!("task_done:{task_uuid}:extra")),
            None
        );
        assert_eq!(parse_ledger_source_key("habit_log:not-a-uuid:1"), None);
        assert_eq!(
            parse_ledger_source_key(&format!("habit_log:{habit_uuid}:+1")),
            None
        );
        assert_eq!(
            parse_ledger_source_key(&format!("habit_log:{habit_uuid}:1:extra")),
            None
        );
        assert_eq!(parse_ledger_source_key("card_review:+42:1"), None);
        assert_eq!(parse_ledger_source_key(""), None);

        assert_eq!(
            parse_ledger_source_key("quest_daily:12:reviews_15"),
            Some(ParsedSourceKey::QuestDaily {
                day_index: 12,
                quest_id: "reviews_15".to_string(),
            })
        );
        assert_eq!(
            parse_ledger_source_key("quest_weekly:420:w_reviews_150"),
            Some(ParsedSourceKey::QuestWeekly {
                week_index: 420,
                quest_id: "w_reviews_150".to_string(),
            })
        );
        assert_eq!(
            parse_ledger_source_key("comeback_bonus:19"),
            Some(ParsedSourceKey::ComebackBonus { day_index: 19 })
        );
        assert_eq!(
            parse_ledger_source_key("badge_monthly:2026-11"),
            Some(ParsedSourceKey::MonthlyBadge {
                month_key: "2026-11".to_string(),
            })
        );
        assert_eq!(parse_ledger_source_key("badge_monthly:2026-13"), None);
        assert_eq!(parse_ledger_source_key("quest_daily:+1:reviews_15"), None);
    }

    #[test]
    fn aggregate_history_study_days_and_deck_progress_include_tasks_and_habits() {
        let created_ms = 1_794_601_800_000_i64; // 2026-11-13 23:30 UTC+3 -> Day 0
        let tz_offset_minutes = 180;
        let rollover_hour = 4;
        let day1_ms = created_ms + MS_PER_DAY;
        let day2_ms = created_ms + 2 * MS_PER_DAY;

        let task_uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let linked_habit_uuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        let free_habit_uuid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

        let rewards = vec![
            LedgerRewardInput {
                source_key: review_source_key(100, 1),
                xp: 3,
                gold_cents: 25,
                created_at: day1_ms,
            },
            LedgerRewardInput {
                source_key: task_source_key(task_uuid),
                xp: 10,
                gold_cents: 100,
                created_at: day2_ms,
            },
            LedgerRewardInput {
                source_key: habit_source_key(linked_habit_uuid, 2),
                xp: 10,
                gold_cents: 100,
                created_at: day2_ms,
            },
            LedgerRewardInput {
                source_key: habit_source_key(free_habit_uuid, 2),
                xp: 10,
                gold_cents: 100,
                created_at: day2_ms,
            },
            LedgerRewardInput {
                source_key: "malformed".into(),
                xp: 99,
                gold_cents: 99,
                created_at: day2_ms,
            },
        ];

        let (history, skipped_hist) = aggregate_progress_history(
            rewards.clone(),
            tz_offset_minutes,
            rollover_hour,
            created_ms,
        );
        assert_eq!(skipped_hist, 1);
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].day, 1);
        assert_eq!(history[0].xp, 3);
        assert_eq!(history[1].day, 2);
        assert_eq!(history[1].xp, 30);
        assert_eq!(history[1].cumulative_xp, 33);

        let mut card_top_decks = HashMap::new();
        card_top_decks.insert(100, 1);
        let revlogs = vec![StudyRevlogInput {
            id: day1_ms,
            card_id: 100,
            ease: 3,
            taken_ms: 30_000,
            review_kind: 1,
        }];
        let (study_days, skipped_days) = aggregate_study_days(
            revlogs.clone(),
            &card_top_decks,
            [2],
            [2, 2],
            rewards.clone(),
            30,
            tz_offset_minutes,
            rollover_hour,
            created_ms,
        );
        assert_eq!(skipped_days, 1);
        assert_eq!(study_days.len(), 2);
        assert_eq!(study_days[0].day, 2);
        assert_eq!(study_days[0].reviews, 0);
        assert!(study_days[0].deck_ids.is_empty());
        assert_eq!(study_days[0].tasks_completed, 1);
        assert_eq!(study_days[0].habits_completed, 2);
        assert_eq!(study_days[0].xp, 30);
        assert_eq!(study_days[1].day, 1);
        assert_eq!(study_days[1].reviews, 1);
        assert_eq!(study_days[1].tasks_completed, 0);
        assert_eq!(study_days[1].habits_completed, 0);

        let mut habit_top_decks = HashMap::new();
        habit_top_decks.insert(linked_habit_uuid.to_string(), 1);
        let (by_deck, skipped_deck) = aggregate_progress_by_deck(
            [(1, "Top".into(), None), (2, "Top::Sub".into(), Some(1))],
            [DeckCardInput {
                card_id: 100,
                deck_id: 2,
                ctype: 2,
                queue: 2,
                interval: 21,
            }],
            revlogs,
            &habit_top_decks,
            rewards,
            tz_offset_minutes,
            rollover_hour,
            day2_ms,
            created_ms,
        );
        assert_eq!(skipped_deck, 1);
        assert_eq!(by_deck.len(), 1);
        // 3 XP from card review + 10 XP from deck-linked habit; excludes task (10) & unlinked habit (10).
        assert_eq!(by_deck[0].xp, 13);
        assert_eq!(by_deck[0].gold_cents, 125);
    }

    #[test]
    fn compute_habit_streak_covers_all_frequencies_with_today_grace_and_no_penalties() {
        use crate::productivity::{
            Habit, HabitFrequencyKind, HabitGoalMode, HabitLog, HabitSection,
        };

        let created_epoch_day = 20_000_i64; // arbitrary fixed epoch day (2024-10-04 = Friday; +3 = Monday)
        let mon = 3_i32;
        let base_habit = |freq: HabitFrequencyKind,
                          weekdays: Vec<u8>,
                          weekly: Option<u8>,
                          ivl: Option<u32>| Habit {
            id: "h1".into(),
            user_id: NIL_USER_ID.into(),
            title: "Test".into(),
            notes: String::new(),
            icon_key: "check".into(),
            color_token: "accent".into(),
            frequency_kind: freq,
            weekdays,
            weekly_target: weekly,
            interval_days: ivl,
            goal_mode: HabitGoalMode::AchieveAll,
            goal_target: 1.0,
            goal_unit: String::new(),
            start_day_index: mon,
            target_days: None,
            section: HabitSection::Morning,
            reminders: vec![],
            auto_popup_log: false,
            deck_id: None,
            archived_at: None,
            sort_order: 0,
            created_at: 0,
            updated_at: 0,
            deleted_at: None,
            usn: -1,
        };
        let done_log = |day_index: i32| HabitLog {
            id: format!("l-{day_index}"),
            user_id: NIL_USER_ID.into(),
            habit_id: "h1".into(),
            day_index,
            logged_value: 1.0,
            goal_target: 1.0,
            completed: true,
            status: crate::productivity::HabitLogStatus::Logged,
            mood: None,
            note: String::new(),
            created_at: 0,
            updated_at: 0,
            deleted_at: None,
            usn: -1,
        };

        // Daily: Mon & Tue completed, Wed (today) not yet completed -> today grace gives 2.
        let daily = base_habit(HabitFrequencyKind::Daily, vec![], None, None);
        assert_eq!(
            compute_habit_streak(
                &daily,
                &[done_log(mon), done_log(mon + 1)],
                mon + 2,
                created_epoch_day,
                crate::productivity::WeekStart::Mon,
            ),
            2
        );
        // Missed Tue -> Wed incomplete -> resets to 0.
        assert_eq!(
            compute_habit_streak(
                &daily,
                &[done_log(mon)],
                mon + 2,
                created_epoch_day,
                crate::productivity::WeekStart::Mon,
            ),
            0
        );

        // Weekdays (Mon-Fri): Fri & Mon completed (weekend skipped) -> streak 2 even if Tue incomplete.
        let weekdays = base_habit(
            HabitFrequencyKind::Weekdays,
            vec![1, 2, 3, 4, 5],
            None,
            None,
        );
        let fri = mon + 4;
        let next_mon = mon + 7;
        assert_eq!(
            compute_habit_streak(
                &weekdays,
                &[done_log(fri), done_log(next_mon)],
                next_mon + 1,
                created_epoch_day,
                crate::productivity::WeekStart::Mon,
            ),
            2
        );

        // EveryNDays (interval = 2): scheduled on mon, mon+2, mon+4; completed all 3 -> streak 3.
        let every_n = base_habit(HabitFrequencyKind::EveryNDays, vec![], None, Some(2));
        assert_eq!(
            compute_habit_streak(
                &every_n,
                &[done_log(mon), done_log(mon + 2), done_log(mon + 4)],
                mon + 4,
                created_epoch_day,
                crate::productivity::WeekStart::Mon,
            ),
            3
        );

        // WeeklyCount (target = 2/week): week 1 has 2 completions, week 2 has 1 completion mid-week -> 3.
        let weekly = base_habit(HabitFrequencyKind::WeeklyCount, vec![], Some(2), None);
        assert_eq!(
            compute_habit_streak(
                &weekly,
                &[done_log(mon), done_log(mon + 2), done_log(mon + 7)],
                mon + 8,
                created_epoch_day,
                crate::productivity::WeekStart::Mon,
            ),
            3
        );
    }

    #[test]
    fn build_yesterday_summary_returns_none_when_empty_and_some_on_activity() {
        assert_eq!(
            build_yesterday_summary(2, 20_000, YesterdayActivity::default()),
            None
        );

        let some = build_yesterday_summary(
            2,
            20_000,
            YesterdayActivity {
                reviews: 5,
                tasks_completed: 2,
                habits_completed: 1,
                xp: 45,
                gold_cents: 425,
            },
        )
        .expect("active day should produce yesterday summary");
        assert_eq!(some.day, 2);
        assert_eq!(some.reviews, 5);
        assert_eq!(some.tasks_completed, 2);
        assert_eq!(some.habits_completed, 1);
        assert_eq!(some.xp, 45);
        assert_eq!(some.gold_cents, 425);
    }
}
