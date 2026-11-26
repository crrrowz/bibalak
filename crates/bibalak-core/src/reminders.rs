//! Pure desktop/mobile reminder planning rules (D45 / ADR-028, 16c).
//!
//! No OS, Tauri, wall-clock, database, or UI dependencies: `now_ms`, settings,
//! and domain state are passed as arguments so planning is deterministic across
//! all platforms and tests.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::productivity::{
    is_habit_active_on_day, is_habit_scheduled_fixed, Habit, HabitFrequencyKind, HabitLog,
    HabitLogStatus,
};
use crate::progress::{created_epoch_day, MS_PER_DAY};

/// Grace window (ms) so a reminder checked right around its minute still fires once.
pub const REMINDER_DUE_GRACE_MS: i64 = 60_000;

/// Presentation style selector for reminder wording.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ReminderStyle {
    #[default]
    Default,
    Scholar,
    Game,
}

impl ReminderStyle {
    pub fn parse(raw: Option<&str>) -> Self {
        match raw.map(str::trim) {
            Some(s) if s.eq_ignore_ascii_case("scholar") => Self::Scholar,
            Some(s) if s.eq_ignore_ascii_case("game") => Self::Game,
            _ => Self::Default,
        }
    }

    fn suffix(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Scholar => "scholar",
            Self::Game => "game",
        }
    }
}

/// Device-local reminder settings passed from the client when planning.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ReminderSettingsInput {
    pub daily_study_enabled: bool,
    pub daily_study_time: String,
    pub evening_streak_enabled: bool,
    pub evening_streak_time: String,
    pub habit_reminders_enabled: bool,
}

/// Kind of planned OS reminder notification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ReminderKind {
    DailyStudy,
    EveningStreak,
    Habit,
}

/// One planned notification inside the next 24-hour window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlannedReminderDto {
    pub id: String,
    pub kind: ReminderKind,
    #[ts(type = "number")]
    pub fire_at_ms: i64,
    pub title_key: String,
    pub body_key: String,
    #[ts(type = "Record<string, string>")]
    pub args: BTreeMap<String, String>,
}

/// Result of `plan_reminders`: planned notifications for the next 24 h plus
/// the next backend rollover instant so the thin client runner can re-plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ReminderPlanDto {
    pub items: Vec<PlannedReminderDto>,
    #[ts(type = "number")]
    pub next_rollover_ms: i64,
}

/// Pure inputs for [`plan_reminders`].
pub struct ReminderPlanInput<'a> {
    pub now_ms: i64,
    pub tz_offset_minutes: i32,
    pub rollover_hour: u8,
    pub created_ms: i64,
    pub today_xp: u64,
    pub study_streak: u32,
    pub freeze_tokens_held: u32,
    pub style: ReminderStyle,
    pub settings: &'a ReminderSettingsInput,
    pub habits: &'a [Habit],
    pub habit_logs: &'a [HabitLog],
}

/// Parse `"HH:MM"` into `(hour, minute)` in `0..=23` and `0..=59`.
pub fn parse_hhmm(raw: &str) -> Option<(u8, u8)> {
    let trimmed = raw.trim();
    let (h_str, m_str) = trimmed.split_once(':')?;
    if h_str.len() != 2 || m_str.len() != 2 {
        return None;
    }
    let hour = h_str.parse::<u8>().ok()?;
    let minute = m_str.parse::<u8>().ok()?;
    if hour > 23 || minute > 59 {
        return None;
    }
    Some((hour, minute))
}

fn reminder_instant_in_rollover_day(
    day_start_ms: i64,
    rollover_hour: u8,
    hour: u8,
    minute: u8,
) -> i64 {
    let r = i64::from(rollover_hour.min(23));
    let h = i64::from(hour);
    let m = i64::from(minute);
    let hours_since_rollover = if h >= r { h - r } else { 24 - r + h };
    day_start_ms + hours_since_rollover * 3_600_000 + m * 60_000
}

fn is_habit_scheduled_for_reminder(habit: &Habit, day_index: i32, created_epoch_day: i64) -> bool {
    if habit.deleted_at.is_some() || habit.archived_at.is_some() {
        return false;
    }
    if !is_habit_active_on_day(habit, day_index) {
        return false;
    }
    match habit.frequency_kind {
        HabitFrequencyKind::Daily
        | HabitFrequencyKind::Weekdays
        | HabitFrequencyKind::EveryNDays => {
            is_habit_scheduled_fixed(habit, day_index, created_epoch_day)
        }
        HabitFrequencyKind::WeeklyCount => true,
    }
}

fn is_habit_done_on_day(habit_id: &str, day_index: i32, logs: &[HabitLog]) -> bool {
    logs.iter().any(|l| {
        l.deleted_at.is_none()
            && l.habit_id == habit_id
            && l.day_index == day_index
            && (l.completed || matches!(l.status, HabitLogStatus::Skipped | HabitLogStatus::Frozen))
    })
}

/// Plan OS reminders for `[now_ms - REMINDER_DUE_GRACE_MS, now_ms + MS_PER_DAY]`.
pub fn plan_reminders(input: &ReminderPlanInput<'_>) -> ReminderPlanDto {
    let rollover_hour = input.rollover_hour.min(23);
    let created_epoch = created_epoch_day(input.created_ms, input.tz_offset_minutes, rollover_hour);
    let today_epoch = created_epoch_day(input.now_ms, input.tz_offset_minutes, rollover_hour);
    let today_day_index = (today_epoch - created_epoch) as i32;

    let tz_off_ms = i64::from(input.tz_offset_minutes) * 60_000;
    let rollover_ms = i64::from(rollover_hour) * 3_600_000;
    let today_start_ms = today_epoch * MS_PER_DAY + rollover_ms - tz_off_ms;
    let next_rollover_ms = today_start_ms + MS_PER_DAY;

    let any_enabled = input.settings.daily_study_enabled
        || input.settings.evening_streak_enabled
        || input.settings.habit_reminders_enabled;
    if !any_enabled {
        return ReminderPlanDto {
            items: Vec::new(),
            next_rollover_ms,
        };
    }

    let window_start = input.now_ms - REMINDER_DUE_GRACE_MS;
    let window_end = input.now_ms + MS_PER_DAY;
    let suffix = input.style.suffix();
    let mut items = Vec::new();

    for day_offset in [0_i32, 1_i32] {
        let day_index = today_day_index.saturating_add(day_offset);
        let day_start_ms = today_start_ms + i64::from(day_offset) * MS_PER_DAY;

        let (studied, streak, freezes) = if day_offset == 0 {
            (
                input.today_xp > 0,
                input.study_streak,
                input.freeze_tokens_held,
            )
        } else {
            // Next rollover day: not yet studied; streak continues if today was studied.
            let projected_streak = if input.today_xp > 0 {
                input.study_streak.saturating_add(1)
            } else {
                0
            };
            (false, projected_streak, input.freeze_tokens_held)
        };

        if input.settings.daily_study_enabled && !studied {
            if let Some((hour, minute)) = parse_hhmm(&input.settings.daily_study_time) {
                let fire_at_ms =
                    reminder_instant_in_rollover_day(day_start_ms, rollover_hour, hour, minute);
                if fire_at_ms >= window_start && fire_at_ms <= window_end {
                    items.push(PlannedReminderDto {
                        id: format!("daily:{day_index}"),
                        kind: ReminderKind::DailyStudy,
                        fire_at_ms,
                        title_key: format!("reminders.daily.title.{suffix}"),
                        body_key: format!("reminders.daily.body.{suffix}"),
                        args: BTreeMap::new(),
                    });
                }
            }
        }

        if input.settings.evening_streak_enabled && !studied && streak > 0 {
            if let Some((hour, minute)) = parse_hhmm(&input.settings.evening_streak_time) {
                let fire_at_ms =
                    reminder_instant_in_rollover_day(day_start_ms, rollover_hour, hour, minute);
                if fire_at_ms >= window_start && fire_at_ms <= window_end {
                    let body_key = if input.style == ReminderStyle::Game && freezes > 0 {
                        "reminders.evening.bodyWithFreeze.game".to_string()
                    } else {
                        format!("reminders.evening.body.{suffix}")
                    };
                    let mut args = BTreeMap::new();
                    args.insert("count".to_string(), streak.to_string());
                    items.push(PlannedReminderDto {
                        id: format!("evening:{day_index}"),
                        kind: ReminderKind::EveningStreak,
                        fire_at_ms,
                        title_key: format!("reminders.evening.title.{suffix}"),
                        body_key,
                        args,
                    });
                }
            }
        }

        if input.settings.habit_reminders_enabled {
            for habit in input.habits {
                if !is_habit_scheduled_for_reminder(habit, day_index, created_epoch) {
                    continue;
                }
                if is_habit_done_on_day(&habit.id, day_index, input.habit_logs) {
                    continue;
                }
                let mut seen_times = BTreeSet::new();
                for raw_time in &habit.reminders {
                    let Some((hour, minute)) = parse_hhmm(raw_time) else {
                        continue;
                    };
                    let normalized = format!("{hour:02}:{minute:02}");
                    if !seen_times.insert(normalized.clone()) {
                        continue;
                    }
                    let fire_at_ms =
                        reminder_instant_in_rollover_day(day_start_ms, rollover_hour, hour, minute);
                    if fire_at_ms >= window_start && fire_at_ms <= window_end {
                        let mut args = BTreeMap::new();
                        args.insert("title".to_string(), habit.title.clone());
                        items.push(PlannedReminderDto {
                            id: format!("habit:{}:{}:{}", habit.id, normalized, day_index),
                            kind: ReminderKind::Habit,
                            fire_at_ms,
                            title_key: format!("reminders.habit.title.{suffix}"),
                            body_key: format!("reminders.habit.body.{suffix}"),
                            args,
                        });
                    }
                }
            }
        }
    }

    items.sort_by(|a, b| {
        a.fire_at_ms
            .cmp(&b.fire_at_ms)
            .then_with(|| a.id.cmp(&b.id))
    });

    ReminderPlanDto {
        items,
        next_rollover_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::productivity::{HabitGoalMode, HabitSection};

    // 2026-11-25T00:00:00Z = epoch day 20782 (Wednesday, ISO weekday 3).
    const DAY0_UTC_MS: i64 = 20_782 * MS_PER_DAY;

    fn base_settings() -> ReminderSettingsInput {
        ReminderSettingsInput {
            daily_study_enabled: false,
            daily_study_time: "19:00".to_string(),
            evening_streak_enabled: false,
            evening_streak_time: "21:00".to_string(),
            habit_reminders_enabled: false,
        }
    }

    fn make_habit(id: &str, title: &str, freq: HabitFrequencyKind, reminders: &[&str]) -> Habit {
        Habit {
            id: id.to_string(),
            user_id: "00000000-0000-0000-0000-000000000000".to_string(),
            title: title.to_string(),
            notes: String::new(),
            icon_key: "book-open".to_string(),
            color_token: "accent".to_string(),
            frequency_kind: freq,
            weekdays: vec![],
            weekly_target: None,
            interval_days: None,
            goal_mode: HabitGoalMode::AchieveAll,
            goal_target: 1.0,
            goal_unit: String::new(),
            start_day_index: 0,
            target_days: None,
            section: HabitSection::Morning,
            reminders: reminders.iter().map(|s| (*s).to_string()).collect(),
            auto_popup_log: false,
            deck_id: None,
            archived_at: None,
            sort_order: 0,
            created_at: DAY0_UTC_MS,
            updated_at: DAY0_UTC_MS,
            deleted_at: None,
            usn: -1,
        }
    }

    #[test]
    fn reminder_fires_only_when_not_studied() {
        let mut settings = base_settings();
        settings.daily_study_enabled = true;
        settings.daily_study_time = "19:00".to_string();

        // Now = 18:00 UTC on day 0 (rollover 04:00 UTC).
        let now_ms = DAY0_UTC_MS + 18 * 3_600_000;
        let expected_today_fire = DAY0_UTC_MS + 19 * 3_600_000;

        let unstudied = plan_reminders(&ReminderPlanInput {
            now_ms,
            tz_offset_minutes: 0,
            rollover_hour: 4,
            created_ms: DAY0_UTC_MS + 4 * 3_600_000,
            today_xp: 0,
            study_streak: 0,
            freeze_tokens_held: 0,
            style: ReminderStyle::Default,
            settings: &settings,
            habits: &[],
            habit_logs: &[],
        });
        assert!(unstudied
            .items
            .iter()
            .any(|i| i.id == "daily:0" && i.fire_at_ms == expected_today_fire));

        let studied = plan_reminders(&ReminderPlanInput {
            now_ms,
            tz_offset_minutes: 0,
            rollover_hour: 4,
            created_ms: DAY0_UTC_MS + 4 * 3_600_000,
            today_xp: 15,
            study_streak: 1,
            freeze_tokens_held: 0,
            style: ReminderStyle::Default,
            settings: &settings,
            habits: &[],
            habit_logs: &[],
        });
        assert!(!studied.items.iter().any(|i| i.id == "daily:0"));
    }

    #[test]
    fn evening_reminder_needs_streak_and_mentions_freeze_in_game() {
        let mut settings = base_settings();
        settings.evening_streak_enabled = true;
        settings.evening_streak_time = "21:00".to_string();

        let now_ms = DAY0_UTC_MS + 20 * 3_600_000;

        // 1) streak == 0 -> no evening reminder.
        let no_streak = plan_reminders(&ReminderPlanInput {
            now_ms,
            tz_offset_minutes: 0,
            rollover_hour: 4,
            created_ms: DAY0_UTC_MS + 4 * 3_600_000,
            today_xp: 0,
            study_streak: 0,
            freeze_tokens_held: 2,
            style: ReminderStyle::Game,
            settings: &settings,
            habits: &[],
            habit_logs: &[],
        });
        assert!(no_streak.items.is_empty());

        // 2) Game with streak > 0 and 0 freeze tokens -> standard game evening body.
        let game_no_freeze = plan_reminders(&ReminderPlanInput {
            now_ms,
            tz_offset_minutes: 0,
            rollover_hour: 4,
            created_ms: DAY0_UTC_MS + 4 * 3_600_000,
            today_xp: 0,
            study_streak: 5,
            freeze_tokens_held: 0,
            style: ReminderStyle::Game,
            settings: &settings,
            habits: &[],
            habit_logs: &[],
        });
        assert_eq!(game_no_freeze.items.len(), 1);
        assert_eq!(
            game_no_freeze.items[0].body_key,
            "reminders.evening.body.game"
        );
        assert_eq!(
            game_no_freeze.items[0]
                .args
                .get("count")
                .map(String::as_str),
            Some("5")
        );

        // 3) Game with streak > 0 and freeze_tokens_held > 0 -> freeze body key.
        let game_with_freeze = plan_reminders(&ReminderPlanInput {
            now_ms,
            tz_offset_minutes: 0,
            rollover_hour: 4,
            created_ms: DAY0_UTC_MS + 4 * 3_600_000,
            today_xp: 0,
            study_streak: 5,
            freeze_tokens_held: 1,
            style: ReminderStyle::Game,
            settings: &settings,
            habits: &[],
            habit_logs: &[],
        });
        assert_eq!(game_with_freeze.items.len(), 1);
        assert_eq!(
            game_with_freeze.items[0].body_key,
            "reminders.evening.bodyWithFreeze.game"
        );

        // 4) Scholar uses scholar key even if freeze tokens exist.
        let scholar = plan_reminders(&ReminderPlanInput {
            now_ms,
            tz_offset_minutes: 0,
            rollover_hour: 4,
            created_ms: DAY0_UTC_MS + 4 * 3_600_000,
            today_xp: 0,
            study_streak: 4,
            freeze_tokens_held: 2,
            style: ReminderStyle::Scholar,
            settings: &settings,
            habits: &[],
            habit_logs: &[],
        });
        assert_eq!(scholar.items.len(), 1);
        assert_eq!(scholar.items[0].body_key, "reminders.evening.body.scholar");
    }

    #[test]
    fn habit_reminder_only_on_scheduled_undone_days() {
        let mut settings = base_settings();
        settings.habit_reminders_enabled = true;

        // 09:00 UTC on Wednesday (ISO weekday 3): day 0 at 09:00 and day 1 at 09:00 (+24h)
        // both fall within [now_ms - 60s, now_ms + 24h].
        let now_ms = DAY0_UTC_MS + 9 * 3_600_000;

        let due_undone = make_habit(
            "h1",
            "Read Arabic notes",
            HabitFrequencyKind::Daily,
            &["09:00"],
        );
        let mut wrong_weekday = make_habit(
            "h2",
            "Thursday only",
            HabitFrequencyKind::Weekdays,
            &["09:00"],
        );
        wrong_weekday.weekdays = vec![4]; // Thursday, not Wednesday (day 0)
        let already_done = make_habit("h3", "Already done", HabitFrequencyKind::Daily, &["09:00"]);
        let already_skipped = make_habit(
            "h4",
            "Already skipped",
            HabitFrequencyKind::Daily,
            &["09:00"],
        );
        let mut archived = make_habit("h5", "Archived", HabitFrequencyKind::Daily, &["09:00"]);
        archived.archived_at = Some(DAY0_UTC_MS);

        let logs = vec![
            HabitLog {
                id: "l1".to_string(),
                user_id: "00000000-0000-0000-0000-000000000000".to_string(),
                habit_id: "h3".to_string(),
                day_index: 0,
                logged_value: 1.0,
                goal_target: 1.0,
                completed: true,
                status: HabitLogStatus::Logged,
                mood: None,
                note: String::new(),
                created_at: DAY0_UTC_MS,
                updated_at: DAY0_UTC_MS,
                deleted_at: None,
                usn: -1,
            },
            HabitLog {
                id: "l2".to_string(),
                user_id: "00000000-0000-0000-0000-000000000000".to_string(),
                habit_id: "h4".to_string(),
                day_index: 0,
                logged_value: 0.0,
                goal_target: 1.0,
                completed: false,
                status: HabitLogStatus::Skipped,
                mood: None,
                note: String::new(),
                created_at: DAY0_UTC_MS,
                updated_at: DAY0_UTC_MS,
                deleted_at: None,
                usn: -1,
            },
        ];

        let plan = plan_reminders(&ReminderPlanInput {
            now_ms,
            tz_offset_minutes: 0,
            rollover_hour: 4,
            created_ms: DAY0_UTC_MS + 4 * 3_600_000,
            today_xp: 0,
            study_streak: 0,
            freeze_tokens_held: 0,
            style: ReminderStyle::Default,
            settings: &settings,
            habits: &[
                due_undone,
                wrong_weekday,
                already_done,
                already_skipped,
                archived,
            ],
            habit_logs: &logs,
        });

        let day0_ids: Vec<&str> = plan
            .items
            .iter()
            .filter(|i| i.fire_at_ms < plan.next_rollover_ms)
            .map(|i| i.id.as_str())
            .collect();
        assert_eq!(day0_ids, vec!["habit:h1:09:00:0"]);

        // Day 1 (Thursday, ISO weekday 4) includes h2 and h3/h4 (undone on day 1), still excludes archived h5.
        let day1_ids: Vec<&str> = plan
            .items
            .iter()
            .filter(|i| i.fire_at_ms >= plan.next_rollover_ms)
            .map(|i| i.id.as_str())
            .collect();
        assert!(day1_ids.contains(&"habit:h2:09:00:1"));
        assert!(!day1_ids.iter().any(|id| id.contains("h5")));
    }

    #[test]
    fn no_duplicate_notification_same_day() {
        let mut settings = base_settings();
        settings.daily_study_enabled = true;
        settings.daily_study_time = "19:00".to_string();
        settings.habit_reminders_enabled = true;

        // Habit with duplicate "09:00" entries produces only one id on day 0.
        let habit = make_habit("h1", "Read", HabitFrequencyKind::Daily, &["09:00", "09:00"]);
        let now_ms = DAY0_UTC_MS + 8 * 3_600_000;

        let plan1 = plan_reminders(&ReminderPlanInput {
            now_ms,
            tz_offset_minutes: 0,
            rollover_hour: 4,
            created_ms: DAY0_UTC_MS + 4 * 3_600_000,
            today_xp: 0,
            study_streak: 0,
            freeze_tokens_held: 0,
            style: ReminderStyle::Default,
            settings: &settings,
            habits: std::slice::from_ref(&habit),
            habit_logs: &[],
        });

        // Re-planning later on the same day keeps the exact same deterministic per-day IDs.
        let plan2 = plan_reminders(&ReminderPlanInput {
            now_ms: now_ms + 30_000,
            tz_offset_minutes: 0,
            rollover_hour: 4,
            created_ms: DAY0_UTC_MS + 4 * 3_600_000,
            today_xp: 0,
            study_streak: 0,
            freeze_tokens_held: 0,
            style: ReminderStyle::Default,
            settings: &settings,
            habits: &[habit],
            habit_logs: &[],
        });

        let day0_ids_1: Vec<&str> = plan1
            .items
            .iter()
            .filter(|i| i.fire_at_ms < plan1.next_rollover_ms)
            .map(|i| i.id.as_str())
            .collect();
        let day0_ids_2: Vec<&str> = plan2
            .items
            .iter()
            .filter(|i| i.fire_at_ms < plan2.next_rollover_ms)
            .map(|i| i.id.as_str())
            .collect();
        assert_eq!(day0_ids_1, vec!["habit:h1:09:00:0", "daily:0"]);
        assert_eq!(day0_ids_1, day0_ids_2);
    }
}
