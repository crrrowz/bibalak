use crate::error::CoreResult;

/// Task lists, tasks, Eisenhower matrix, habits, and calendar events persistence.
pub trait ProductivityStore: Send + Sync {
    /// Generate a lowercase RFC 4122 v4 UUID (`fastrand` in `bibalak-db`, atomic counter in `FakeStorage`).
    fn new_uuid(&self) -> String;

    fn list_task_lists(&self, user_id: &str) -> CoreResult<Vec<crate::productivity::TaskList>>;

    fn upsert_task_list(&self, list: &crate::productivity::TaskList) -> CoreResult<()>;

    fn soft_delete_task_list(
        &self,
        user_id: &str,
        id: &str,
        now_ms: i64,
    ) -> CoreResult<Vec<String>>;

    fn restore_task_list(
        &self,
        user_id: &str,
        id: &str,
        task_ids: &[String],
        now_ms: i64,
    ) -> CoreResult<()>;

    fn list_tasks(
        &self,
        user_id: &str,
        include_completed: bool,
    ) -> CoreResult<Vec<crate::productivity::TaskItem>>;

    fn get_task(
        &self,
        user_id: &str,
        id: &str,
    ) -> CoreResult<Option<crate::productivity::TaskItem>>;

    fn upsert_task(&self, task: &crate::productivity::TaskItem) -> CoreResult<()>;

    #[allow(clippy::too_many_arguments)]
    fn set_task_completion(
        &self,
        user_id: &str,
        id: &str,
        completed_at: Option<i64>,
        completed_day: Option<i32>,
        reward: Option<&crate::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
        now_ms: i64,
    ) -> CoreResult<bool>;

    fn reorder_tasks(
        &self,
        user_id: &str,
        items: &[crate::productivity::TaskOrderItem],
        now_ms: i64,
    ) -> CoreResult<()>;

    fn reschedule_overdue_tasks(
        &self,
        user_id: &str,
        today_date: &str,
        target_date: &str,
        now_ms: i64,
    ) -> CoreResult<u32>;

    fn soft_delete_task(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()>;

    fn restore_task(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()>;

    fn list_matrix_quadrants(
        &self,
        user_id: &str,
    ) -> CoreResult<Vec<crate::productivity::MatrixQuadrant>>;

    fn upsert_matrix_quadrant(&self, q: &crate::productivity::MatrixQuadrant) -> CoreResult<()>;

    fn list_habits(
        &self,
        user_id: &str,
        include_archived: bool,
    ) -> CoreResult<Vec<crate::productivity::Habit>>;

    fn get_habit(&self, user_id: &str, id: &str) -> CoreResult<Option<crate::productivity::Habit>>;

    fn upsert_habit(&self, habit: &crate::productivity::Habit) -> CoreResult<()>;

    fn soft_delete_habit(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<Vec<String>>;

    fn restore_habit(
        &self,
        user_id: &str,
        id: &str,
        log_ids: &[String],
        now_ms: i64,
    ) -> CoreResult<()>;

    fn list_habit_logs_range(
        &self,
        user_id: &str,
        from_day: i32,
        to_day: i32,
    ) -> CoreResult<Vec<crate::productivity::HabitLog>>;

    fn list_habit_logs_for_habit(
        &self,
        user_id: &str,
        habit_id: &str,
        from_day: i32,
        to_day: i32,
    ) -> CoreResult<Vec<crate::productivity::HabitLog>>;

    fn upsert_habit_log(
        &self,
        log: &crate::productivity::HabitLog,
        reward: Option<&crate::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
    ) -> CoreResult<crate::productivity::HabitLogWriteOutcome>;

    #[allow(clippy::too_many_arguments)]
    fn restore_habit_log_snapshot(
        &self,
        user_id: &str,
        habit_id: &str,
        day_index: i32,
        previous: Option<&crate::productivity::HabitLog>,
        restore_reward: Option<&crate::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
        now_ms: i64,
    ) -> CoreResult<()>;

    fn list_calendar_events(
        &self,
        user_id: &str,
    ) -> CoreResult<Vec<crate::productivity::CalendarEvent>>;

    fn get_calendar_event(
        &self,
        user_id: &str,
        id: &str,
    ) -> CoreResult<Option<crate::productivity::CalendarEvent>>;

    fn upsert_calendar_event(&self, event: &crate::productivity::CalendarEvent) -> CoreResult<()>;

    fn soft_delete_calendar_event(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()>;

    fn restore_calendar_event(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()>;
}
