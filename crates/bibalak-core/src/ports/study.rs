use std::collections::HashMap;

use crate::error::CoreResult;
use crate::ipc::StatsDto;
use crate::model::{Card, Revlog, StudyCard};
use crate::scheduling::{CardState, SchedConfig};

/// The studyable cards of a deck, split into their three streams plus a single
/// learn-ahead fallback. [`StudyStore::study_queue`] gates each stream by due time;
/// [`crate::Collection::next_card`] decides the order (learning first, then a
/// proportional new/review interleave, then learn-ahead).
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct StudyQueue {
    /// Learning/relearning cards due now, ordered by due (soonest first).
    pub learning: Vec<i64>,
    /// New cards in roughly frequency-rank order (lightly jittered), capped by
    /// the remaining daily new limit.
    pub new: Vec<i64>,
    /// Review cards due today (random order), capped by the remaining limit.
    pub review: Vec<i64>,
    /// Learning cards due within the learn-ahead window, ordered by due
    /// (soonest first) — shown only when every other stream is empty.
    pub learning_ahead: Vec<i64>,
}

/// Active card scheduling snapshot used as simulator input.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SimCardSnapshot {
    pub due: i32,
    pub state: CardState,
}

/// Deck snapshot passed into `bibalak_scheduler::simulate_workload`.
#[derive(Debug, Clone, Default)]
pub struct WorkloadSnapshot {
    pub cards: Vec<SimCardSnapshot>,
    pub avg_review_secs: f64,
}

/// Study queue, scheduling state, card lifecycle, limits, and statistics persistence.
pub trait StudyStore: Send + Sync {
    /// The studyable cards of `deck_id` split into streams, gated by due time
    /// (`today` for reviews, `now_ms` for learning) and capped by daily limits.
    /// `today_end_ms` is the start of tomorrow (ms); learning cards due before
    /// that time are eligible for the learn-ahead fallback when nothing else is due.
    /// The caller assembles the final order from the [`StudyQueue`].
    fn study_queue(
        &self,
        deck_id: i64,
        today: i32,
        now_ms: i64,
        today_end_ms: i64,
        new_limit: u32,
        review_limit: u32,
    ) -> CoreResult<StudyQueue>;

    /// Count of studyable cards by type `(new, learning, review)`, capped by limits.
    /// `today_end_ms` gates the learning count: cards due before midnight count even
    /// if not yet due right now.
    fn count_due_by_type(
        &self,
        deck_id: i64,
        today: i32,
        now_ms: i64,
        today_end_ms: i64,
        new_limit: u32,
        review_limit: u32,
    ) -> CoreResult<(u32, u32, u32)>;

    /// Total count of studyable cards in `deck_id` on `today`, capped by limits.
    fn count_due(
        &self,
        deck_id: i64,
        today: i32,
        now_ms: i64,
        today_end_ms: i64,
        new_limit: u32,
        review_limit: u32,
    ) -> CoreResult<u32>;

    /// Per-deck card-type counts (raw, pre-limit). Keyed by deck_id.
    /// `today_end_ms` gates the learning count (cards due before midnight).
    fn deck_due_counts(
        &self,
        today: i32,
        now_ms: i64,
        today_end_ms: i64,
    ) -> CoreResult<HashMap<i64, (u32, u32, u32)>>;

    /// `due` for a set of card ids, keyed by id. Used to merge several decks'
    /// learning streams into one soonest-first order when studying a deck
    /// with subdecks.
    fn cards_due_ms(&self, card_ids: &[i64]) -> CoreResult<HashMap<i64, i64>>;

    /// Most recent revlog time (ms) per card id, keyed by id. Cards with no
    /// revlog entry are omitted. Used to grace-period a just-answered card out
    /// of immediate resurfacing.
    fn cards_last_answered(&self, card_ids: &[i64]) -> CoreResult<HashMap<i64, i64>>;

    /// Card id of the most recently answered card in the collection (if any).
    /// Keeps `GRACE_MS` from deferring a due learning card for more than one
    /// answer while other cards exist.
    fn latest_answered_card_id(&self) -> CoreResult<Option<i64>>;

    /// `(new_per_day, rev_per_day)` from the deck config's JSON.
    fn deck_limits(&self, config_id: i64) -> CoreResult<(u32, u32)>;

    /// `(new_per_day, rev_per_day)` for every config row. Keyed by config_id.
    fn all_deck_limits(&self) -> CoreResult<HashMap<i64, (u32, u32)>>;

    /// Cards from `deck_id` studied today, split by type. `today_start_ms` is the
    /// epoch-ms start of the current scheduling day.
    fn today_studied(&self, deck_id: i64, today_start_ms: i64) -> CoreResult<(u32, u32)>;

    /// Today-studied counts for all decks in one query. Keyed by deck_id.
    fn all_today_studied(&self, today_start_ms: i64) -> CoreResult<HashMap<i64, (u32, u32)>>;

    /// Persist updated `new_per_day` / `rev_per_day` in the config JSON.
    fn set_deck_limits(
        &self,
        config_id: i64,
        new_per_day: u32,
        rev_per_day: u32,
        now_ms: i64,
    ) -> CoreResult<()>;

    /// Read full scheduling config for a `deck_config` row.
    fn get_deck_config(&self, config_id: i64) -> CoreResult<SchedConfig>;

    /// Persist full scheduling config for a `deck_config` row.
    fn set_deck_config(&self, config_id: i64, config: &SchedConfig, now_ms: i64) -> CoreResult<()>;

    /// Configured day-rollover hour (0-23, local time; Anki default is 4am),
    /// read from the `collection.config` JSON blob.
    fn get_rollover_hour(&self) -> CoreResult<u8>;

    /// Persist the day-rollover hour into the `collection.config` JSON blob.
    fn set_rollover_hour(&self, hour: u8, now_ms: i64) -> CoreResult<()>;

    /// Extra new-card allowance for `deck_id` on collection-day `day` (0 if none set).
    fn day_extra_new(&self, deck_id: i64, day: i32) -> CoreResult<u32>;

    /// Extra new-card allowances for every deck on collection-day `day`, keyed by deck_id.
    fn all_day_extra_new(&self, day: i32) -> CoreResult<HashMap<i64, u32>>;

    /// Upsert the extra new-card allowance for `deck_id` on `day`.
    fn set_day_extra_new(&self, deck_id: i64, day: i32, extra_new: u32) -> CoreResult<()>;

    /// Render inputs + scheduling state for one card.
    fn study_card(&self, card_id: i64) -> CoreResult<Option<StudyCard>>;

    /// Persist a card's post-answer state, append a review-log row, and
    /// optionally grant/re-activate a progress reward in the same transaction.
    /// Returns `true` iff this call inserted or re-activated the reward row.
    fn apply_answer(
        &self,
        card_id: i64,
        next: &CardState,
        due: i64,
        log: &Revlog,
        reward: Option<&crate::progress::RewardGrant>,
    ) -> CoreResult<bool>;

    /// Aggregate statistics (review history, forecast, card maturity).
    ///
    /// `deck_ids` restricts to those decks (already resolved to include subdeck
    /// rollup), or `None` for the whole collection. `days` restricts
    /// range-scoped aggregates (totals, retention, answer buttons, hourly), or
    /// `None` for all time. `tz_offset_minutes` shifts only the hourly bucketing
    /// into local time. `fsrs_weights`/`retention_goal_pct` are the relevant
    /// deck's trained FSRS weights and desired retention (or the collection
    /// defaults when no single deck is selected), used for the retrievability
    /// panel and the retention goal line.
    #[allow(clippy::too_many_arguments)]
    fn stats(
        &self,
        deck_ids: Option<&[i64]>,
        days: Option<u32>,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        fsrs_weights: &[f64; 21],
        retention_goal_pct: f64,
        today: i32,
        now_ms: i64,
        created_ms: i64,
    ) -> CoreResult<StatsDto>;

    /// Set `queue = -1` for each card id.
    fn suspend_cards(&self, card_ids: &[i64], now_ms: i64) -> CoreResult<()>;

    /// Restore suspended cards (`queue = -1`) to their natural `queue = type`.
    fn unsuspend_cards(&self, card_ids: &[i64], now_ms: i64) -> CoreResult<()>;

    /// Manually bury cards (`queue = -2`).
    fn bury_cards(&self, card_ids: &[i64], now_ms: i64) -> CoreResult<()>;

    /// Restore buried cards (`queue IN (-2, -3)`) to their natural queue.
    fn unbury_cards(&self, card_ids: &[i64], now_ms: i64) -> CoreResult<()>;

    /// Sibling bury: set `queue = -3` on all new/review cards from `note_id`
    /// other than `answered_card_id` (called immediately after answering).
    /// Returns the card IDs that were newly buried.
    fn bury_siblings(
        &self,
        note_id: i64,
        answered_card_id: i64,
        now_ms: i64,
    ) -> CoreResult<Vec<i64>>;

    /// Reverse an applied card answer: restore previous card state and due,
    /// delete the inserted revlog row, restore buried siblings, remove any
    /// added leech tag / suspension, and soft-revoke `reward_source_key` (if
    /// `Some`) in the same transaction.
    #[allow(clippy::too_many_arguments)]
    fn undo_answer(
        &self,
        card_id: i64,
        prev_state: &CardState,
        prev_due: i64,
        revlog_id: i64,
        buried_siblings: &[i64],
        leech_note: Option<i64>,
        reward_source_key: Option<&str>,
        now_ms: i64,
    ) -> CoreResult<()>;

    /// Restore all buried cards in `deck_id` (manual -2 and sibling -3) to
    /// their natural queue. Called at day rollover / session start.
    fn unbury_deck(&self, deck_id: i64, now_ms: i64) -> CoreResult<()>;

    /// Restore all buried cards in the entire collection (manual -2 and sibling -3)
    /// to their natural queue. Called on day rollover.
    fn unbury_all(&self, now_ms: i64) -> CoreResult<()>;

    /// Last day-number on which collection unbury was performed.
    fn get_last_unbury_day(&self) -> CoreResult<Option<i32>>;

    /// Persist the last day-number on which collection unbury was performed.
    fn set_last_unbury_day(&self, day: i32, now_ms: i64) -> CoreResult<()>;

    /// Set the flag byte (0–7) on a list of cards.
    fn set_card_flag(&self, card_ids: &[i64], flag: u8, now_ms: i64) -> CoreResult<()>;

    /// Card IDs belonging to `deck_ids`, ordered by `id`.
    fn deck_card_ids(&self, deck_ids: &[i64]) -> CoreResult<Vec<i64>>;

    /// Reset `card_ids` to the new queue (`type = 0, queue = 0`), returning prior
    /// card rows for undo.
    fn forget_cards(
        &self,
        card_ids: &[i64],
        reset_counts: bool,
        now_ms: i64,
    ) -> CoreResult<Vec<Card>>;

    /// Reschedule `card_ids` to `(today + offset_days)` for an inclusive offset in
    /// `[min_days, max_days]`. Review cards keep their interval; non-review cards become
    /// reviews. Returns prior card rows for undo.
    fn set_due_date(
        &self,
        card_ids: &[i64],
        min_days: u32,
        max_days: u32,
        today: i32,
        now_ms: i64,
    ) -> CoreResult<Vec<Card>>;

    /// Assign sequential new-card positions starting at `start` with `step` (optionally
    /// shuffled, optionally shifting existing new cards at or after `start`). Returns all
    /// affected prior card rows (including shifted ones) for undo.
    fn reposition_new_cards(
        &self,
        card_ids: &[i64],
        start: i64,
        step: i64,
        shuffle: bool,
        shift_existing: bool,
        now_ms: i64,
    ) -> CoreResult<Vec<Card>>;

    /// Restore full scheduling columns on previously snapshotted cards (used by undo).
    fn restore_cards(&self, cards: &[Card], now_ms: i64) -> CoreResult<()>;

    /// Revlog entries suitable for FSRS optimization: review_kind in {0,1,2},
    /// optionally scoped to cards in a specific deck.
    fn revlogs_for_optimize(&self, deck_id: Option<i64>) -> CoreResult<Vec<Revlog>>;

    /// Active card states and recent review pace for workload simulation.
    fn workload_snapshot(&self, deck_ids: &[i64]) -> CoreResult<WorkloadSnapshot>;
}
