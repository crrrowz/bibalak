//! `Collection` use-case for OS reminder planning (D45 / ADR-028, 16c).

use std::sync::atomic::Ordering;

use crate::error::CoreResult;
use crate::progress::NIL_USER_ID;
use crate::reminders::{
    plan_reminders, ReminderPlanDto, ReminderPlanInput, ReminderSettingsInput, ReminderStyle,
};

use super::Collection;

impl Collection {
    /// Plan OS reminders for the next 24 hours using backend day indices,
    /// today's XP, study streak, freeze tokens, and active habits.
    pub fn plan_reminders(
        &self,
        settings: &ReminderSettingsInput,
        style: Option<&str>,
    ) -> CoreResult<ReminderPlanDto> {
        let now_ms = self.clock.now_ms();
        let tz_offset_minutes = self.tz_offset_minutes.load(Ordering::Relaxed);
        let rollover_hour = self.rollover_hour.load(Ordering::Relaxed);
        let today = self.today();

        let totals = if settings.daily_study_enabled || settings.evening_streak_enabled {
            Some(self.storage.progress_totals(
                NIL_USER_ID,
                self.today_start_ms(),
                self.today_end_ms(),
            )?)
        } else {
            None
        };

        let snapshot = if settings.evening_streak_enabled {
            Some(self.storage.load_game_snapshot(
                NIL_USER_ID,
                today,
                tz_offset_minutes,
                rollover_hour,
                self.created_ms,
            )?)
        } else {
            None
        };

        let (habits, habit_logs) = if settings.habit_reminders_enabled {
            (
                self.storage.list_habits(NIL_USER_ID, false)?,
                self.storage
                    .list_habit_logs_range(NIL_USER_ID, today, today.saturating_add(1))?,
            )
        } else {
            (Vec::new(), Vec::new())
        };

        Ok(plan_reminders(&ReminderPlanInput {
            now_ms,
            tz_offset_minutes,
            rollover_hour,
            created_ms: self.created_ms,
            today_xp: totals.map_or(0, |t| t.today_xp),
            study_streak: snapshot.as_ref().map_or(0, |s| s.study_streak),
            freeze_tokens_held: snapshot.as_ref().map_or(0, |s| s.freeze_tokens_held),
            style: ReminderStyle::parse(style),
            settings,
            habits: &habits,
            habit_logs: &habit_logs,
        }))
    }
}
