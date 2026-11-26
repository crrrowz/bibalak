//! Pure daily motivation loop rules: daily XP goal, deterministic daily/weekly
//! quests, comeback bonus state machine, monthly badge rule, and streak calendar
//! calculations (ADR-027, 16d).
//!
//! Zero IO, zero database dependencies, and zero system-clock reads.

use std::collections::{BTreeSet, HashSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{CoreError, CoreResult};
use crate::game::study_streak_with_freezes;
use crate::productivity::{
    date_string_to_epoch_days, days_in_month, entity_id_v5, epoch_days_to_year_month,
    start_of_week_day_index, WeekStart,
};

/// Allowed daily XP goal choices (ADR-027 §1, D43).
pub const DAILY_GOAL_XP_CHOICES: [u32; 4] = [10, 20, 30, 50];

/// Default daily XP goal for new and upgraded collections.
pub const DEFAULT_DAILY_GOAL_XP: u32 = 20;

/// Gold reward (`gold_cents`) for completing a daily quest (`2.00` gold, D44 #4).
pub const DAILY_QUEST_GOLD_CENTS: u64 = 200;

/// Gold reward (`gold_cents`) for completing a weekly quest (`10.00` gold, D44 #4).
pub const WEEKLY_QUEST_GOLD_CENTS: u64 = 1_000;

/// Gold reward (`gold_cents`) for earning a monthly badge (`10.00` gold, D44 #4).
pub const MONTHLY_BADGE_GOLD_CENTS: u64 = 1_000;

/// Number of daily quests completed in a calendar month to earn the monthly badge.
pub const MONTHLY_BADGE_TARGET_QUESTS: u32 = 20;

/// Minimum full days away before the comeback bonus triggers (`K = 7`, D44 #3).
pub const COMEBACK_AWAY_DAYS: i32 = 7;

/// Active return window in days (`today - return_day <= 3`, 4 days inclusive).
pub const COMEBACK_RETURN_WINDOW_DAYS: i32 = 3;

/// Gold reward (`gold_cents`) for the comeback bonus (`5.00` gold, D44 #3).
pub const COMEBACK_BONUS_GOLD_CENTS: u64 = 500;

/// Streak milestone thresholds shown on `/streak` and Session-end.
pub const STREAK_MILESTONES: [u32; 4] = [7, 30, 100, 365];

/// Local-only `sync_state` key storing the last day the daily goal celebration fired.
pub const GOAL_CELEBRATED_DAY_KEY: &str = "goal_celebrated_day";

/// Deterministic RFC 4122 v5 UUID for the user's `motivation_settings` row (ADR-027 §2.3).
pub fn motivation_settings_id(user_id: &str) -> String {
    entity_id_v5("motivation_settings", user_id, "default")
}

/// Deterministic RFC 4122 v5 UUID for a `monthly_badges` row (ADR-027 §2.3).
pub fn monthly_badge_id(user_id: &str, month_key: &str) -> String {
    entity_id_v5("monthly_badge", user_id, month_key)
}

/// Validate a daily XP goal against `DAILY_GOAL_XP_CHOICES`.
pub fn validate_daily_goal_xp(goal_xp: u32) -> CoreResult<u32> {
    if DAILY_GOAL_XP_CHOICES.contains(&goal_xp) {
        Ok(goal_xp)
    } else {
        Err(CoreError::Invalid(format!(
            "daily_goal_xp must be one of 10, 20, 30, 50 (got {goal_xp})"
        )))
    }
}

/// Validate a calendar month key (`"YYYY-MM"`, `01..=12`).
pub fn is_valid_month_key(month_key: &str) -> bool {
    let bytes = month_key.as_bytes();
    if bytes.len() != 7 || bytes[4] != b'-' {
        return false;
    }
    if !bytes[..4].iter().all(u8::is_ascii_digit) || !bytes[5..7].iter().all(u8::is_ascii_digit) {
        return false;
    }
    matches!(month_key[5..7].parse::<u8>(), Ok(1..=12))
}

/// Validate and normalize a `"YYYY-MM"` month key.
pub fn validate_month_key(month_key: &str) -> CoreResult<String> {
    let trimmed = month_key.trim();
    if !is_valid_month_key(trimmed) {
        return Err(CoreError::Invalid(format!(
            "invalid month_key '{month_key}': expected YYYY-MM"
        )));
    }
    Ok(trimmed.to_string())
}

/// Build `quest_daily:<day_index>:<quest_id>` (`progress_ledger.source_key`).
pub fn daily_quest_source_key(day_index: i32, quest_id: &str) -> String {
    format!("quest_daily:{day_index}:{quest_id}")
}

/// Build `quest_weekly:<week_index>:<quest_id>` (`progress_ledger.source_key`).
pub fn weekly_quest_source_key(week_index: i32, quest_id: &str) -> String {
    format!("quest_weekly:{week_index}:{quest_id}")
}

/// Build `comeback_bonus:<day_index>` (`progress_ledger.source_key`).
pub fn comeback_bonus_source_key(day_index: i32) -> String {
    format!("comeback_bonus:{day_index}")
}

/// Build `badge_monthly:<yyyy_mm>` (`progress_ledger.source_key`).
pub fn monthly_badge_source_key(month_key: &str) -> String {
    format!("badge_monthly:{month_key}")
}

/// Build `freeze_use:study:<day_index>` (`freeze_token_ledger.source_key`).
pub fn study_freeze_source_key(day_index: i32) -> String {
    format!("freeze_use:study:{day_index}")
}

/// Parse `freeze_use:study:<day_index>`, returning `None` for habit freezes or malformed keys.
pub fn parse_study_freeze_source_key(key: &str) -> Option<i32> {
    let day_str = key.strip_prefix("freeze_use:study:")?;
    if day_str.starts_with('+') {
        return None;
    }
    day_str.parse::<i32>().ok()
}

/// Raw `motivation_settings` row (exchanged in `SyncDelta`, ADR-027 §2.1 & §2.5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MotivationSettingsRow {
    pub id: String,
    pub user_id: String,
    pub daily_goal_xp: u32,
    pub onboarding_completed_at: Option<i64>,
    pub comeback_return_day: Option<i32>,
    pub comeback_awarded_return_day: Option<i32>,
    pub comeback_awarded_day: Option<i32>,
    pub comeback_dismissed_day: Option<i32>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

impl MotivationSettingsRow {
    pub fn new_default(user_id: &str, now_ms: i64) -> Self {
        Self {
            id: motivation_settings_id(user_id),
            user_id: user_id.to_string(),
            daily_goal_xp: DEFAULT_DAILY_GOAL_XP,
            onboarding_completed_at: None,
            comeback_return_day: None,
            comeback_awarded_return_day: None,
            comeback_awarded_day: None,
            comeback_dismissed_day: None,
            created_at: now_ms,
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
        }
    }
}

/// Raw `monthly_badges` row (exchanged in `SyncDelta`, ADR-027 §2.1 & §2.5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MonthlyBadgeRow {
    pub id: String,
    pub user_id: String,
    pub month_key: String,
    pub quest_count_at_earn: u32,
    pub earned_at: i64,
    pub seen_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

/// Quest cadence (`daily` or `weekly`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum QuestKind {
    Daily,
    Weekly,
}

/// Underlying activity metric tracked by a quest template.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum QuestMetric {
    Reviews,
    Minutes,
    NewCards,
    Tasks,
    Habits,
    Xp,
    ActiveDays,
    TasksOrHabits,
}

/// Static template in the deterministic quest catalogue.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QuestTemplate {
    pub id: &'static str,
    pub metric: QuestMetric,
    pub target: u32,
}

/// Aggregated live counts used to evaluate daily or weekly quest progress.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct QuestMetricCounts {
    pub reviews: u32,
    pub minutes: u32,
    pub new_cards: u32,
    pub tasks: u32,
    pub habits: u32,
    pub xp: u64,
    pub active_days: u32,
}

/// Quest status returned in [`MotivationStateDto`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QuestDto {
    pub id: String,
    pub kind: QuestKind,
    pub metric: QuestMetric,
    pub progress: u32,
    pub target: u32,
    pub completed: bool,
    #[ts(type = "number")]
    pub reward_gold_cents: u64,
}

/// Current month's badge progress and earn state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MonthlyBadgeStatusDto {
    pub month_key: String,
    pub completed_daily_quests: u32,
    pub target_daily_quests: u32,
    pub earned: bool,
    #[ts(type = "number | null")]
    pub earned_at: Option<i64>,
    pub seen: bool,
    #[ts(type = "number")]
    pub reward_gold_cents: u64,
}

/// Previously (or currently) earned monthly badge for the `/quests` gallery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EarnedMonthlyBadgeDto {
    pub month_key: String,
    pub quest_count_at_earn: u32,
    #[ts(type = "number")]
    pub earned_at: i64,
    pub seen: bool,
}

/// Active comeback welcome-back offer shown on Home when eligible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ComebackOfferDto {
    pub return_day: i32,
    pub away_days: i32,
    #[ts(type = "number")]
    pub reward_gold_cents: u64,
}

/// Unified daily motivation state returned by `get_motivation_state` & `set_daily_goal`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MotivationStateDto {
    pub daily_goal_xp: u32,
    #[ts(type = "number")]
    pub today_xp: u64,
    pub goal_met_today: bool,
    pub current_streak: u32,
    pub best_streak: u32,
    pub studied_today: bool,
    pub next_milestone: Option<u32>,
    pub today_day_index: i32,
    pub today_date: String,
    /// Whole days remaining in the current ISO week (`0` on Sunday .. `6` on Monday).
    pub days_remaining_in_week: u32,
    pub daily_quests: Vec<QuestDto>,
    pub weekly_quest: QuestDto,
    pub monthly_badge: MonthlyBadgeStatusDto,
    pub earned_monthly_badges: Vec<EarnedMonthlyBadgeDto>,
    pub comeback_offer: Option<ComebackOfferDto>,
    pub onboarding_completed: bool,
    /// Populated with `yesterday` (`today - 1`) when Game auto-freeze just protected a 1-day gap.
    pub auto_frozen_day: Option<i32>,
}

/// Milestone chip status on `/streak`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StreakMilestoneDto {
    pub target: u32,
    pub achieved: bool,
}

/// Single day cell on the `/streak` calendar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StreakCalendarDayDto {
    pub day_index: i32,
    pub date: String,
    pub day_of_month: u8,
    pub is_future: bool,
    pub studied: bool,
    pub goal_met: bool,
    pub frozen: bool,
    #[ts(type = "number")]
    pub xp: u64,
    pub reviews: u32,
    pub tasks_completed: u32,
    pub habits_completed: u32,
}

/// Monthly streak calendar payload returned by `get_streak_calendar` & `freeze_study_day`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StreakCalendarDto {
    pub year: i32,
    pub month: u8,
    pub today_day_index: i32,
    pub today_date: String,
    pub daily_goal_xp: u32,
    pub current_streak: u32,
    pub best_streak: u32,
    pub studied_today: bool,
    pub next_milestone: Option<u32>,
    pub milestones: Vec<StreakMilestoneDto>,
    pub freeze_tokens_held: u32,
    pub freeze_token_cap: u32,
    /// Suggested eligible grace day (`today - 1` or `today - 2`) when manual freeze is available.
    pub can_freeze_day: Option<i32>,
    pub days: Vec<StreakCalendarDayDto>,
}

// ── Fixed Quest Catalogue (01-daily-loop-spec.md §5.1) ───────────────────────

const SLOT_1: [QuestTemplate; 4] = [
    QuestTemplate {
        id: "reviews_15",
        metric: QuestMetric::Reviews,
        target: 15,
    },
    QuestTemplate {
        id: "reviews_25",
        metric: QuestMetric::Reviews,
        target: 25,
    },
    QuestTemplate {
        id: "reviews_40",
        metric: QuestMetric::Reviews,
        target: 40,
    },
    QuestTemplate {
        id: "minutes_10",
        metric: QuestMetric::Minutes,
        target: 10,
    },
];

const SLOT_2: [QuestTemplate; 4] = [
    QuestTemplate {
        id: "new_5",
        metric: QuestMetric::NewCards,
        target: 5,
    },
    QuestTemplate {
        id: "new_10",
        metric: QuestMetric::NewCards,
        target: 10,
    },
    QuestTemplate {
        id: "minutes_15",
        metric: QuestMetric::Minutes,
        target: 15,
    },
    QuestTemplate {
        id: "xp_30",
        metric: QuestMetric::Xp,
        target: 30,
    },
];

const SLOT_3: [QuestTemplate; 4] = [
    QuestTemplate {
        id: "tasks_2",
        metric: QuestMetric::Tasks,
        target: 2,
    },
    QuestTemplate {
        id: "habit_1",
        metric: QuestMetric::Habits,
        target: 1,
    },
    QuestTemplate {
        id: "reviews_30",
        metric: QuestMetric::Reviews,
        target: 30,
    },
    QuestTemplate {
        id: "minutes_20",
        metric: QuestMetric::Minutes,
        target: 20,
    },
];

const WEEKLY_CATALOG: [QuestTemplate; 5] = [
    QuestTemplate {
        id: "w_reviews_150",
        metric: QuestMetric::Reviews,
        target: 150,
    },
    QuestTemplate {
        id: "w_minutes_60",
        metric: QuestMetric::Minutes,
        target: 60,
    },
    QuestTemplate {
        id: "w_new_40",
        metric: QuestMetric::NewCards,
        target: 40,
    },
    QuestTemplate {
        id: "w_days_5",
        metric: QuestMetric::ActiveDays,
        target: 5,
    },
    QuestTemplate {
        id: "w_plan_10",
        metric: QuestMetric::TasksOrHabits,
        target: 10,
    },
];

/// Deterministically draw the 3 daily quests for `day_index` with distinct metrics.
pub fn daily_quests_for_day(day_index: i32) -> [QuestTemplate; 3] {
    let idx1 = day_index.rem_euclid(SLOT_1.len() as i32) as usize;
    let q1 = SLOT_1[idx1];

    let mut idx2 = (day_index.div_euclid(2) + 1).rem_euclid(SLOT_2.len() as i32) as usize;
    for _ in 0..SLOT_2.len() {
        if SLOT_2[idx2].metric != q1.metric {
            break;
        }
        idx2 = (idx2 + 1) % SLOT_2.len();
    }
    let q2 = SLOT_2[idx2];

    let mut idx3 = (i64::from(day_index) * 3 + 2).rem_euclid(SLOT_3.len() as i64) as usize;
    for _ in 0..SLOT_3.len() {
        let m = SLOT_3[idx3].metric;
        if m != q1.metric && m != q2.metric {
            break;
        }
        idx3 = (idx3 + 1) % SLOT_3.len();
    }
    let q3 = SLOT_3[idx3];

    [q1, q2, q3]
}

/// Deterministically draw the weekly quest for `week_index`.
pub fn weekly_quest_for_week(week_index: i32) -> QuestTemplate {
    let idx = week_index.rem_euclid(WEEKLY_CATALOG.len() as i32) as usize;
    WEEKLY_CATALOG[idx]
}

/// Compute ISO week (`Mon..Sun`) `(week_index, week_start_day, week_end_day)` for `day_index`.
///
/// `week_index = 0` starts on Monday `1970-01-05` (`epoch_day = 4`).
pub fn iso_week_bounds(day_index: i32, created_epoch_day: i64) -> (i32, i32, i32) {
    let epoch_day = created_epoch_day + i64::from(day_index);
    let week_start_day = start_of_week_day_index(day_index, epoch_day, WeekStart::Mon);
    let week_end_day = week_start_day + 6;
    let epoch_monday = created_epoch_day + i64::from(week_start_day);
    let week_index = ((epoch_monday - 4).div_euclid(7)) as i32;
    (week_index, week_start_day, week_end_day)
}

/// Calendar month key (`"YYYY-MM"`) for `day_index`.
pub fn month_key_for_day(day_index: i32, created_epoch_day: i64) -> String {
    let (year, month) = epoch_days_to_year_month(created_epoch_day + i64::from(day_index));
    format!("{year:04}-{month:02}")
}

/// Enumerate `(day_index, "YYYY-MM-DD", day_of_month)` for every day in `(year, month)`.
pub fn month_day_range(
    year: i32,
    month: u8,
    created_epoch_day: i64,
) -> CoreResult<Vec<(i32, String, u8)>> {
    if !(1900..=2200).contains(&year) {
        return Err(CoreError::Invalid(format!(
            "year {year} out of supported range (1900..=2200)"
        )));
    }
    let Some(num_days) = days_in_month(i64::from(year), u32::from(month)) else {
        return Err(CoreError::Invalid(format!("invalid month {month}")));
    };
    let first_date = format!("{year:04}-{month:02}-01");
    let first_epoch = date_string_to_epoch_days(&first_date)?;
    let mut out = Vec::with_capacity(num_days as usize);
    for dom in 1..=num_days {
        let epoch = first_epoch + i64::from(dom - 1);
        let day_index = i32::try_from(epoch - created_epoch_day)
            .map_err(|_| CoreError::Invalid("calendar date out of day_index range".into()))?;
        out.push((
            day_index,
            format!("{year:04}-{month:02}-{dom:02}"),
            dom as u8,
        ));
    }
    Ok(out)
}

/// Evaluate a quest metric's progress from aggregated counts.
pub fn quest_progress(metric: QuestMetric, counts: &QuestMetricCounts) -> u32 {
    match metric {
        QuestMetric::Reviews => counts.reviews,
        QuestMetric::Minutes => counts.minutes,
        QuestMetric::NewCards => counts.new_cards,
        QuestMetric::Tasks => counts.tasks,
        QuestMetric::Habits => counts.habits,
        QuestMetric::Xp => u32::try_from(counts.xp).unwrap_or(u32::MAX),
        QuestMetric::ActiveDays => counts.active_days,
        QuestMetric::TasksOrHabits => counts.tasks.saturating_add(counts.habits),
    }
}

/// Build a [`QuestDto`] from a template and live counts.
pub fn build_quest_dto(
    tpl: QuestTemplate,
    kind: QuestKind,
    counts: &QuestMetricCounts,
) -> QuestDto {
    let progress = quest_progress(tpl.metric, counts);
    let reward_gold_cents = match kind {
        QuestKind::Daily => DAILY_QUEST_GOLD_CENTS,
        QuestKind::Weekly => WEEKLY_QUEST_GOLD_CENTS,
    };
    QuestDto {
        id: tpl.id.to_string(),
        kind,
        metric: tpl.metric,
        progress,
        target: tpl.target,
        completed: progress >= tpl.target,
        reward_gold_cents,
    }
}

/// Next streak milestone strictly above `current_streak` (`7 / 30 / 100 / 365`).
pub fn next_streak_milestone(current_streak: u32) -> Option<u32> {
    STREAK_MILESTONES
        .iter()
        .copied()
        .find(|&m| m > current_streak)
}

/// Longest historical study streak across `active_days`, bridged by `frozen_days`.
///
/// Frozen-only days preserve continuity across a gap without adding to the day count.
pub fn best_streak_with_freezes(active_days: &HashSet<i32>, frozen_days: &HashSet<i32>) -> u32 {
    let all_days: BTreeSet<i32> = active_days
        .iter()
        .copied()
        .chain(frozen_days.iter().copied())
        .collect();
    let mut prev_day: Option<i32> = None;
    let mut cur_streak = 0_u32;
    let mut best = 0_u32;

    for day in all_days {
        let contiguous = prev_day.is_some_and(|p| p.checked_add(1) == Some(day));
        if contiguous {
            if active_days.contains(&day) {
                cur_streak = cur_streak.saturating_add(1);
            }
        } else {
            cur_streak = u32::from(active_days.contains(&day));
        }
        best = best.max(cur_streak);
        prev_day = Some(day);
    }
    best
}

/// Build milestone progress chips for `/streak`.
pub fn build_streak_milestones(current_streak: u32, best_streak: u32) -> Vec<StreakMilestoneDto> {
    let peak = current_streak.max(best_streak);
    STREAK_MILESTONES
        .iter()
        .map(|&target| StreakMilestoneDto {
            target,
            achieved: peak >= target,
        })
        .collect()
}

/// Update `settings.comeback_return_day` on load/activity when returning after >= 7 days away.
///
/// Returns `true` if `settings` changed and should be persisted (`usn = -1`).
pub fn evaluate_comeback_on_load(
    settings: &mut MotivationSettingsRow,
    prev_active_day: Option<i32>,
    today: i32,
    now_ms: i64,
) -> bool {
    let Some(prev) = prev_active_day else {
        return false;
    };
    if today - prev < COMEBACK_AWAY_DAYS {
        return false;
    }
    let is_new_absence = match settings.comeback_return_day {
        None => true,
        Some(prev_return) => prev >= prev_return,
    };
    if is_new_absence {
        settings.comeback_return_day = Some(today);
        settings.comeback_dismissed_day = None;
        settings.updated_at = now_ms;
        settings.usn = -1;
        return true;
    }
    false
}

/// Whether the user currently has an un-awarded active comeback return window (`0..=3` days).
pub fn is_comeback_reward_eligible(settings: &MotivationSettingsRow, today: i32) -> bool {
    let Some(return_day) = settings.comeback_return_day else {
        return false;
    };
    if settings.comeback_awarded_return_day == Some(return_day) {
        return false;
    }
    let elapsed = today - return_day;
    (0..=COMEBACK_RETURN_WINDOW_DAYS).contains(&elapsed)
}

/// Active dismissible comeback card offer for Home, if visible.
pub fn active_comeback_offer(
    settings: &MotivationSettingsRow,
    prev_active_before_return: Option<i32>,
    today: i32,
) -> Option<ComebackOfferDto> {
    if !is_comeback_reward_eligible(settings, today) {
        return None;
    }
    let return_day = settings.comeback_return_day?;
    if settings.comeback_dismissed_day == Some(return_day) {
        return None;
    }
    let prev = prev_active_before_return?;
    let away_days = return_day - prev;
    if away_days < COMEBACK_AWAY_DAYS {
        return None;
    }
    Some(ComebackOfferDto {
        return_day,
        away_days,
        reward_gold_cents: COMEBACK_BONUS_GOLD_CENTS,
    })
}

/// Return `Some(yesterday)` when Game style should auto-freeze a single missed day (`today - 1`).
///
/// Eligible only when `today >= 2`, `freeze_tokens_held >= 1`, `today - 1` is neither studied nor
/// already frozen, and `today - 2` was studied or frozen (so there is a 1-day gap to bridge).
pub fn should_auto_freeze_study_gap(
    active_days: &HashSet<i32>,
    frozen_days: &HashSet<i32>,
    today: i32,
    freeze_tokens_held: u32,
) -> Option<i32> {
    if freeze_tokens_held < 1 || today < 2 {
        return None;
    }
    let yesterday = today - 1;
    let two_days_ago = today - 2;
    if active_days.contains(&yesterday) || frozen_days.contains(&yesterday) {
        return None;
    }
    if active_days.contains(&two_days_ago) || frozen_days.contains(&two_days_ago) {
        Some(yesterday)
    } else {
        None
    }
}

/// Suggest an eligible missed grace day (`today - 1` or `today - 2`) for manual freeze on `/streak`.
pub fn can_manual_freeze_day(
    active_days: &HashSet<i32>,
    frozen_days: &HashSet<i32>,
    today: i32,
    freeze_tokens_held: u32,
) -> Option<i32> {
    if freeze_tokens_held < 1 {
        return None;
    }
    for offset in [1_i32, 2_i32] {
        if let Some(day) = today.checked_sub(offset) {
            if day >= 0 && !active_days.contains(&day) && !frozen_days.contains(&day) {
                return Some(day);
            }
        }
    }
    None
}

/// Convenience helper computing `(current_streak, studied_today, best_streak)` together.
pub fn compute_streak_pair(
    active_days: &HashSet<i32>,
    frozen_days: &HashSet<i32>,
    today: i32,
) -> (u32, bool, u32) {
    let (current, studied_today) = study_streak_with_freezes(active_days, frozen_days, today);
    let best = best_streak_with_freezes(active_days, frozen_days);
    (current, studied_today, best)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::progress::NIL_USER_ID;

    #[test]
    fn quests_are_deterministic_for_a_day_and_week() {
        for day in -5..200 {
            let a = daily_quests_for_day(day);
            let b = daily_quests_for_day(day);
            assert_eq!(a, b);
            assert_ne!(a[0].metric, a[1].metric);
            assert_ne!(a[0].metric, a[2].metric);
            assert_ne!(a[1].metric, a[2].metric);
        }
        for week in -5..100 {
            assert_eq!(weekly_quest_for_week(week), weekly_quest_for_week(week));
        }
        // Known distinct days produce variety across slots.
        assert_ne!(daily_quests_for_day(0), daily_quests_for_day(1));
        assert_ne!(weekly_quest_for_week(0), weekly_quest_for_week(1));
    }

    #[test]
    fn comeback_state_machine_once_per_return_after_7_days() {
        let mut settings = MotivationSettingsRow::new_default(NIL_USER_ID, 1_000);
        // Away 6 days -> not eligible.
        assert!(!evaluate_comeback_on_load(
            &mut settings,
            Some(10),
            16,
            2_000
        ));
        assert_eq!(settings.comeback_return_day, None);

        // Away 7 days -> eligible.
        assert!(evaluate_comeback_on_load(
            &mut settings,
            Some(10),
            17,
            3_000
        ));
        assert_eq!(settings.comeback_return_day, Some(17));
        assert!(is_comeback_reward_eligible(&settings, 17));
        assert!(is_comeback_reward_eligible(&settings, 20)); // 4-day return window (17..=20)
        assert!(!is_comeback_reward_eligible(&settings, 21)); // expired on day 21

        // Studied lightly on day 17, returned on day 18 -> same return_day stays active.
        assert!(!evaluate_comeback_on_load(
            &mut settings,
            Some(17),
            18,
            4_000
        ));
        assert_eq!(settings.comeback_return_day, Some(17));
        let offer = active_comeback_offer(&settings, Some(10), 18).unwrap();
        assert_eq!(offer.away_days, 7);
        assert_eq!(offer.reward_gold_cents, COMEBACK_BONUS_GOLD_CENTS);

        // Once awarded for return_day 17, no longer eligible during this return.
        settings.comeback_awarded_return_day = Some(17);
        settings.comeback_awarded_day = Some(18);
        assert!(!is_comeback_reward_eligible(&settings, 18));
        assert_eq!(active_comeback_offer(&settings, Some(10), 18), None);

        // Another 7-day absence starting after return_day 17 opens a fresh offer.
        assert!(evaluate_comeback_on_load(
            &mut settings,
            Some(18),
            25,
            5_000
        ));
        assert_eq!(settings.comeback_return_day, Some(25));
        assert!(is_comeback_reward_eligible(&settings, 25));
    }

    #[test]
    fn streak_calendar_and_best_streak_with_freezes() {
        let active: HashSet<i32> = [1, 2, 3, 5, 6, 10, 11].into_iter().collect();
        let frozen: HashSet<i32> = [4, 20].into_iter().collect();

        // Day 4 bridges 1..=3 and 5..=6 into a 5-day streak without counting day 4 as a study day.
        assert_eq!(best_streak_with_freezes(&active, &frozen), 5);
        assert_eq!(study_streak_with_freezes(&active, &frozen, 6), (5, true));
        assert_eq!(study_streak_with_freezes(&active, &frozen, 7), (5, false));
        assert_eq!(study_streak_with_freezes(&active, &frozen, 11), (2, true));

        // Lonely freeze without surrounding study days never creates a streak.
        assert_eq!(study_streak_with_freezes(&active, &frozen, 21), (0, false));
    }

    #[test]
    fn auto_freeze_only_bridges_one_day_gap() {
        let active: HashSet<i32> = [5].into_iter().collect();
        let empty = HashSet::new();

        // Today = 7, yesterday = 6 missed, day 5 active -> auto-freeze day 6.
        assert_eq!(should_auto_freeze_study_gap(&active, &empty, 7, 1), Some(6));
        // No tokens -> None.
        assert_eq!(should_auto_freeze_study_gap(&active, &empty, 7, 0), None);
        // Today = 8 (2-day gap: 6 and 7 both missed) -> None.
        assert_eq!(should_auto_freeze_study_gap(&active, &empty, 8, 1), None);
        // Already frozen -> None.
        let frozen: HashSet<i32> = [6].into_iter().collect();
        assert_eq!(should_auto_freeze_study_gap(&active, &frozen, 7, 1), None);
    }

    #[test]
    fn deterministic_ids_match_entity_v5() {
        let id1 = motivation_settings_id(NIL_USER_ID);
        let id2 = motivation_settings_id(NIL_USER_ID);
        assert_eq!(id1, id2);
        assert!(crate::productivity::is_valid_uuid(&id1));
        assert_ne!(id1, monthly_badge_id(NIL_USER_ID, "2026-11"));
    }
}
