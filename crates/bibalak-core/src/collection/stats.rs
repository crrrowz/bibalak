use std::sync::atomic::Ordering;

use crate::error::CoreResult;
use crate::ipc::StatsDto;
use crate::ports::WorkloadSnapshot;
use crate::Collection;

impl Collection {
    /// Aggregate statistics for the dashboards. `deck_id` selects a deck plus
    /// all of its subdecks (rollup via `parent_id`), or `None` for the whole
    /// collection. `days` restricts range-scoped aggregates, or `None` for all
    /// time. `tz_offset_minutes` (`-Date#getTimezoneOffset()`) shifts only the
    /// hourly breakdown into local time.
    pub fn stats(
        &self,
        deck_id: Option<i64>,
        days: Option<u32>,
        tz_offset_minutes: i32,
    ) -> CoreResult<StatsDto> {
        let deck_ids = match deck_id {
            Some(root) => Some(self.study_subtree(root)?),
            None => None,
        };
        let (fsrs_weights, retention_goal_pct) = match deck_id {
            Some(id) => {
                let cfg = self.get_sched_config(id)?;
                (cfg.fsrs_weights, cfg.desired_retention * 100.0)
            }
            None => (crate::scheduling::FSRS6_DEFAULT_WEIGHTS, 90.0),
        };
        self.storage.stats(
            deck_ids.as_deref(),
            days,
            tz_offset_minutes,
            self.rollover_hour.load(Ordering::Relaxed),
            &fsrs_weights,
            retention_goal_pct,
            self.today(),
            self.clock.now_ms(),
            self.created_ms,
        )
    }

    /// Card states and recent pacing for simulating workload across `deck_id` and subdecks.
    pub fn workload_snapshot(&self, deck_id: i64) -> CoreResult<WorkloadSnapshot> {
        let deck_ids = self.study_subtree(deck_id)?;
        self.storage.workload_snapshot(&deck_ids)
    }
}
