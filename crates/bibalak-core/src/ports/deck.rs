use crate::error::CoreResult;
use crate::ipc::FilteredDeckConfig;
use crate::model::{Card, Deck, Note};

/// A deck subtree captured at deletion time, so the operation can be undone.
/// `decks` are ordered parent-first; `cards` are every card those decks held;
/// `notes` are the notes those cards left orphaned (no cards anywhere else).
#[derive(Debug, Default, Clone)]
pub struct RemovedDeck {
    pub decks: Vec<Deck>,
    pub cards: Vec<Card>,
    pub notes: Vec<Note>,
    pub revlogs: Vec<crate::model::Revlog>,
    pub day_limit_overrides: Vec<(i64, i32, u32)>,
    pub deck_configs: Vec<(i64, String, Option<String>)>,
}

/// Deck CRUD and filtered-deck persistence.
pub trait DeckStore: Send + Sync {
    /// Insert a new deck with the given full name; returns the stored row.
    fn create_deck(&self, name: &str, now_ms: i64) -> CoreResult<Deck>;

    fn deck_by_id(&self, id: i64) -> CoreResult<Option<Deck>>;

    fn deck_by_name(&self, name: &str) -> CoreResult<Option<Deck>>;

    fn list_decks(&self) -> CoreResult<Vec<Deck>>;

    fn rename_deck(&self, id: i64, name: &str, now_ms: i64) -> CoreResult<()>;

    /// Delete a deck and everything under it — its sub-decks (`name::*`) and all
    /// their cards plus those cards' review-log rows — in one transaction, and
    /// tombstone each in `graves`. Returns the deleted rows so the caller can
    /// undo the deletion via [`DeckStore::restore_deck`].
    fn remove_deck(&self, id: i64, now_ms: i64) -> CoreResult<RemovedDeck>;

    /// Restore a previously [removed](DeckStore::remove_deck) deck subtree (decks
    /// parent-first, then cards), clearing the tombstones. Inverse of `remove_deck`.
    fn restore_deck(&self, removed: &RemovedDeck, now_ms: i64) -> CoreResult<()>;

    /// Re-insert a single deck verbatim (used to undo a rename/delete of an
    /// empty deck).
    fn insert_deck(&self, deck: &Deck, now_ms: i64) -> CoreResult<()>;

    /// Persist the collapsed state of a deck (for expanding/collapsing subdecks).
    fn set_deck_collapsed(&self, deck_id: i64, collapsed: bool) -> CoreResult<()>;

    /// Create a new filtered deck with `search` query; gather cards immediately.
    /// `order` (0=random, 1=due-date, 2=added, 3=ivl-asc, 4=lapses).
    fn create_filtered_deck(
        &self,
        name: &str,
        search: &str,
        order: u8,
        limit: u32,
        today: i32,
        now_ms: i64,
    ) -> CoreResult<Deck>;

    /// Empty then re-gather cards for an existing filtered deck. Returns card count.
    fn rebuild_filtered(&self, deck_id: i64, today: i32, now_ms: i64) -> CoreResult<u32>;

    /// Return all cards in a filtered deck to their original decks.
    fn empty_filtered(&self, deck_id: i64, now_ms: i64) -> CoreResult<()>;

    /// Filtered deck configuration (search, order, limit) for the rebuild dialog.
    fn get_filtered_config(&self, deck_id: i64) -> CoreResult<Option<FilteredDeckConfig>>;
}
