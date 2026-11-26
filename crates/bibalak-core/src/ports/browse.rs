use crate::error::CoreResult;
use crate::ipc::{
    CardRow, DuplicateGroup, FindReplacePreview, NoteRow, QualityNoteEdit, QualityScanNote,
    TagCount,
};
use crate::model::{NoteIndexRow, NoteSnapshot};

/// Browser search, find-and-replace, quality scan, duplicate detection, and tag registry persistence.
pub trait BrowseStore: Send + Sync {
    /// All notes flattened for (re)building the search index.
    fn index_rows(&self) -> CoreResult<Vec<NoteIndexRow>>;

    /// Flatten specified notes for targeted search index updates.
    fn index_rows_for_notes(&self, note_ids: &[i64]) -> CoreResult<Vec<NoteIndexRow>>;

    /// Anki-flavoured query → card rows. `limit` caps result count, `offset` skips rows for paging.
    #[allow(clippy::too_many_arguments)]
    fn search_cards(
        &self,
        query: &str,
        today: i32,
        now_ms: i64,
        limit: i64,
        offset: i64,
        sort_key: Option<&str>,
        sort_asc: bool,
    ) -> CoreResult<Vec<CardRow>>;

    /// Anki-flavoured query grouped one row per note (`Notes` browse mode).
    #[allow(clippy::too_many_arguments)]
    fn search_note_rows(
        &self,
        query: &str,
        today: i32,
        now_ms: i64,
        limit: i64,
        offset: i64,
        sort_key: Option<&str>,
        sort_asc: bool,
    ) -> CoreResult<Vec<NoteRow>>;

    /// Total matching cards for `query` (for Browse pagination footer).
    fn count_cards(&self, query: &str, today: i32, now_ms: i64) -> CoreResult<u32>;

    /// Total matching notes for `query` (for Browse Notes-mode pagination footer).
    fn count_note_rows(&self, query: &str, today: i32, now_ms: i64) -> CoreResult<u32>;

    /// Preview how many notes and occurrences match a Find & Replace query over `note_ids`.
    fn preview_find_replace(
        &self,
        note_ids: &[i64],
        field_name: Option<&str>,
        find: &str,
        use_regex: bool,
        case_sensitive: bool,
    ) -> CoreResult<FindReplacePreview>;

    /// Apply Find & Replace across `note_ids` in one transaction via the normal note update path.
    /// Returns snapshots of notes that actually changed (for undo).
    #[allow(clippy::too_many_arguments)]
    fn find_replace_notes(
        &self,
        note_ids: &[i64],
        field_name: Option<&str>,
        find: &str,
        replace: &str,
        use_regex: bool,
        case_sensitive: bool,
        now_ms: i64,
    ) -> CoreResult<Vec<NoteSnapshot>>;

    /// Load up to `limit` notes (deck subtree or explicit note ids, optionally `tag:leech`) for AI quality scan.
    fn load_quality_notes(
        &self,
        deck_id: Option<i64>,
        note_ids: Option<&[i64]>,
        leeches_only: bool,
        limit: u32,
    ) -> CoreResult<Vec<QualityScanNote>>;

    /// Apply AI quality rewrites and/or tag additions inside one transaction and return prior snapshots for undo.
    fn apply_quality_fixes(
        &self,
        edits: &[QualityNoteEdit],
        now_ms: i64,
    ) -> CoreResult<Vec<NoteSnapshot>>;

    /// Find groups of notes of `notetype_id` whose `field_ord` normalizes to the same key.
    fn find_duplicates(&self, notetype_id: i64, field_ord: i64) -> CoreResult<Vec<DuplicateGroup>>;

    /// All distinct tag names from the registry, sorted alphabetically.
    fn list_tags(&self) -> CoreResult<Vec<String>>;

    /// All tags from the registry paired with their distinct-note counts, sorted alphabetically.
    fn list_tag_counts(&self) -> CoreResult<Vec<TagCount>>;

    /// Rename `old_tag` to `new_tag` in all note tag blobs + registry.
    /// Returns the number of notes affected.
    fn rename_tag(&self, old_tag: &str, new_tag: &str, now_ms: i64) -> CoreResult<u32>;

    /// Remove `tag` from all note tag blobs + registry. Returns notes affected.
    fn delete_tag(&self, tag: &str, now_ms: i64) -> CoreResult<u32>;

    /// Rename each tag in `sources` to `target` (merge). Idempotent.
    fn merge_tags(&self, sources: &[String], target: &str, now_ms: i64) -> CoreResult<()>;
}
