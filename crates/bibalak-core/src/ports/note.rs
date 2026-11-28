use crate::error::CoreResult;
use crate::ipc::{NoteDetail, NoteOverview};
use crate::model::{CanonicalModel, ImportSummary, NoteSnapshot};

/// A mapped text-import row ready to persist inside [`NoteStore::import_text_notes`].
#[derive(Debug, Clone)]
pub struct ParsedTextNote {
    pub line: u32,
    pub fields: Vec<String>,
    pub tags: Vec<String>,
}

/// Result of a transactional text-import batch, including touched note ids for
/// incremental search-index synchronization.
#[derive(Debug, Clone, Default)]
pub struct TextImportOutcome {
    pub summary: crate::ipc::TextImportSummary,
    pub affected_note_ids: Vec<i64>,
}

/// Note CRUD, tagging, and collection import/export persistence.
pub trait NoteStore: Send + Sync {
    /// Merge a parsed collection into this one in a single transaction.
    /// Decks/notetypes match by name, notes by `guid`; see `CanonicalModel`.
    /// The `media_imported` field of the result is left at 0 — the caller
    /// (which owns the media directory) fills it in.
    fn import(&self, model: &CanonicalModel, now_ms: i64) -> CoreResult<ImportSummary> {
        self.import_with_progress(model, now_ms, &mut |_, _| {})
    }

    /// Same as [`NoteStore::import`], but calls `on_progress(done, total)`
    /// periodically as notes/cards are merged, for long-running imports.
    /// Default implementation ignores progress and defers to `import`.
    fn import_with_progress(
        &self,
        model: &CanonicalModel,
        now_ms: i64,
        on_progress: &mut dyn FnMut(u32, u32),
    ) -> CoreResult<ImportSummary> {
        self.import_with_tz(model, 0, now_ms, on_progress)
    }

    /// Like [`NoteStore::import_with_progress`], passing the caller's local UTC
    /// offset in minutes so day-aligned due dates match the user's rollover.
    fn import_with_tz(
        &self,
        model: &CanonicalModel,
        tz_offset_minutes: i32,
        now_ms: i64,
        on_progress: &mut dyn FnMut(u32, u32),
    ) -> CoreResult<ImportSummary>;

    /// Import mapped notes from CSV/TSV/Markdown into `deck_id` with `notetype_id`
    /// in a single transaction, applying duplicate policy by Anki first-field checksum.
    fn import_text_notes(
        &self,
        deck_id: i64,
        notetype_id: i64,
        duplicate_policy: crate::ipc::DuplicatePolicy,
        rows: &[ParsedTextNote],
        now_ms: i64,
    ) -> CoreResult<TextImportOutcome>;

    /// List notes for the browser, optionally filtered by a substring of the
    /// fields/tags, newest first, capped at `limit`.
    fn list_notes(&self, query: Option<&str>, limit: i64) -> CoreResult<Vec<NoteOverview>>;

    /// Full note (ordered fields + tags + note-type name) for the editor.
    fn note_detail(&self, note_id: i64) -> CoreResult<Option<NoteDetail>>;

    /// Update a note's field values (in order) and tags.
    fn update_note(
        &self,
        note_id: i64,
        fields: &[String],
        tags: &[String],
        now_ms: i64,
    ) -> CoreResult<()>;

    /// Browser rows for a set of note ids (e.g. search hits), any order.
    fn notes_by_ids(&self, ids: &[i64]) -> CoreResult<Vec<NoteOverview>>;

    /// Dump the full collection as a `CanonicalModel` for export.
    fn dump_collection(&self) -> CoreResult<CanonicalModel>;

    /// Dump a scoped subset of the collection for export. When `deck_ids` is
    /// `None`, exports all decks; when `include_revlog` is `false`, skips
    /// querying review history.
    fn dump_collection_scoped(
        &self,
        deck_ids: Option<&[i64]>,
        include_revlog: bool,
    ) -> CoreResult<CanonicalModel> {
        let mut model = self.dump_collection()?;
        if let Some(ids) = deck_ids {
            let deck_set: std::collections::HashSet<i64> = ids.iter().copied().collect();
            model.decks.retain(|d| deck_set.contains(&d.id));
            model.cards.retain(|c| deck_set.contains(&c.deck_id));
            let note_set: std::collections::HashSet<i64> =
                model.cards.iter().map(|c| c.note_id).collect();
            model.notes.retain(|n| note_set.contains(&n.id));
            let nt_set: std::collections::HashSet<i64> =
                model.notes.iter().map(|n| n.notetype_id).collect();
            model.notetypes.retain(|nt| nt_set.contains(&nt.id));
            model.fields.retain(|f| nt_set.contains(&f.notetype_id));
            model.templates.retain(|t| nt_set.contains(&t.notetype_id));
            let cfg_set: std::collections::HashSet<i64> =
                model.decks.iter().map(|d| d.config_id).collect();
            model.deck_configs.retain(|c| cfg_set.contains(&c.id));
            if include_revlog {
                let card_set: std::collections::HashSet<i64> =
                    model.cards.iter().map(|c| c.id).collect();
                model.revlog.retain(|r| card_set.contains(&r.card_id));
            }
        }
        if !include_revlog {
            model.revlog.clear();
        }
        Ok(model)
    }

    /// Insert a new note and generate its cards (one per template for standard
    /// notetypes; one per cloze ordinal for cloze notetypes). Returns
    /// `(note_id, cards_added)`.
    fn add_note_with_cards(
        &self,
        notetype_id: i64,
        deck_id: i64,
        fields: &[String],
        tags: &[String],
        now_ms: i64,
    ) -> CoreResult<(i64, u32)>;

    /// Insert multiple notes in a single atomic transaction and generate their cards.
    fn add_notes_batch(
        &self,
        notetype_id: i64,
        deck_id: i64,
        notes: &[crate::ipc::BatchNoteInput],
        now_ms: i64,
    ) -> CoreResult<(Vec<i64>, u32)>;

    /// Check whether a note sharing the same notetype and first-field checksum exists.
    fn find_duplicate_note(&self, notetype_id: i64, first_field: &str) -> CoreResult<Option<i64>>;

    /// Append `tag` to a note's tag blob if not already present (idempotent).
    fn add_note_tag(&self, note_id: i64, tag: &str, now_ms: i64) -> CoreResult<()>;

    /// Bulk: append `tag` to many notes in a single transaction.
    fn bulk_add_tag(&self, note_ids: &[i64], tag: &str, now_ms: i64) -> CoreResult<()>;

    /// Bulk: append multiple `tags` to many notes in a single transaction.
    fn bulk_add_tags(&self, note_ids: &[i64], tags: &[String], now_ms: i64) -> CoreResult<()>;

    /// Bulk: remove `tag` from many notes in a single transaction.
    fn bulk_remove_tag(&self, note_ids: &[i64], tag: &str, now_ms: i64) -> CoreResult<()>;

    /// Bulk: remove multiple `tags` from many notes in a single transaction.
    fn bulk_remove_tags(&self, note_ids: &[i64], tags: &[String], now_ms: i64) -> CoreResult<()>;

    /// Restore note fields/tags from snapshots through the normal note update path (used by undo).
    fn restore_notes(&self, snapshots: &[NoteSnapshot], now_ms: i64) -> CoreResult<()>;

    /// Delete notes (and their cards + revlogs) by id; write graves.
    fn delete_notes(&self, note_ids: &[i64], now_ms: i64) -> CoreResult<()>;

    /// Reassign cards to a different deck.
    fn move_cards_to_deck(&self, card_ids: &[i64], deck_id: i64, now_ms: i64) -> CoreResult<()>;

    /// Remove `tag` from a note's tag blob (idempotent).
    fn remove_note_tag(&self, note_id: i64, tag: &str, now_ms: i64) -> CoreResult<()>;
}
