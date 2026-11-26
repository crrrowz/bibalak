use crate::error::CoreResult;

/// Progress ledger and study-history persistence (ADR-019).
pub trait ProgressStore: Send + Sync {
    /// Sum active (`deleted_at IS NULL`) progress rewards for `user_id` all-time and inside `[today_start_ms, today_end_ms)`.
    fn progress_totals(
        &self,
        user_id: &str,
        today_start_ms: i64,
        today_end_ms: i64,
    ) -> CoreResult<crate::progress::ProgressTotals>;

    /// Look up an active (`deleted_at IS NULL`) ledger grant by `(user_id, source_key)`.
    fn get_active_ledger_reward(
        &self,
        user_id: &str,
        source_key: &str,
    ) -> CoreResult<Option<crate::progress::RewardGrant>>;

    /// Count study reviews (`review_kind IN (0,1,2,3)`) in `[start_ms, end_ms)` for `deck_id` and descendants.
    fn deck_review_count_in_window(
        &self,
        deck_id: i64,
        start_ms: i64,
        end_ms: i64,
    ) -> CoreResult<u32>;

    /// Query completed activity counts and rewards for yesterday (`yesterday_day`, `[yesterday_start_ms, yesterday_end_ms)`).
    fn yesterday_activity(
        &self,
        user_id: &str,
        yesterday_day: i32,
        yesterday_start_ms: i64,
        yesterday_end_ms: i64,
    ) -> CoreResult<crate::progress::YesterdayActivity>;

    /// Daily XP/gold history ordered by day ascending, plus count of skipped malformed source_keys.
    fn progress_history(
        &self,
        user_id: &str,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<(Vec<crate::progress::ProgressDay>, usize)>;

    /// Last `limit` study days ordered newest first, plus count of skipped malformed source_keys.
    fn study_days(
        &self,
        user_id: &str,
        limit: u32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<(Vec<crate::progress::StudyDay>, usize)>;

    /// Per-top-deck progress rollup (only top decks with cards), plus count of skipped malformed source_keys.
    fn progress_by_deck(
        &self,
        user_id: &str,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        now_ms: i64,
        created_ms: i64,
    ) -> CoreResult<(Vec<crate::progress::DeckProgress>, usize)>;
}
