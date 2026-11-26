use crate::error::{CoreError, CoreResult};
use crate::events::{DomainEvent, EventSink};
use crate::ipc::{
    ApplyQualityFixesResult, CardRow, DuplicateGroup, FindReplacePreview, NoteRow, QualityNoteEdit,
    QualityScanNote,
};
use crate::model::NoteIndexRow;
use crate::undo::UndoAction;
use crate::Collection;

impl Collection {
    /// All notes flattened for (re)building the search index.
    pub fn index_rows(&self) -> CoreResult<Vec<NoteIndexRow>> {
        self.storage.index_rows()
    }

    /// Flatten specified notes for targeted search index updates.
    pub fn index_rows_for_notes(&self, note_ids: &[i64]) -> CoreResult<Vec<NoteIndexRow>> {
        self.storage.index_rows_for_notes(note_ids)
    }

    /// Anki-flavoured query → card rows (M16). `offset` supports pagination.
    pub fn search_cards(
        &self,
        query: &str,
        limit: i64,
        offset: i64,
        sort_key: Option<&str>,
        sort_asc: bool,
    ) -> CoreResult<Vec<CardRow>> {
        self.storage.search_cards(
            query,
            self.today(),
            self.clock.now_ms(),
            limit,
            offset,
            sort_key,
            sort_asc,
        )
    }

    /// Anki-flavoured query → one row per note (`Notes` browse mode).
    pub fn search_note_rows(
        &self,
        query: &str,
        limit: i64,
        offset: i64,
        sort_key: Option<&str>,
        sort_asc: bool,
    ) -> CoreResult<Vec<NoteRow>> {
        self.storage.search_note_rows(
            query,
            self.today(),
            self.clock.now_ms(),
            limit,
            offset,
            sort_key,
            sort_asc,
        )
    }

    /// Total cards matching `query` for Browse pagination.
    pub fn count_cards(&self, query: &str) -> CoreResult<u32> {
        self.storage
            .count_cards(query, self.today(), self.clock.now_ms())
    }

    /// Total notes matching `query` for Browse Notes-mode pagination.
    pub fn count_note_rows(&self, query: &str) -> CoreResult<u32> {
        self.storage
            .count_note_rows(query, self.today(), self.clock.now_ms())
    }

    /// Preview match counts for Find & Replace across selected notes.
    pub fn preview_find_replace(
        &self,
        note_ids: &[i64],
        field_name: Option<&str>,
        find: &str,
        use_regex: bool,
        case_sensitive: bool,
    ) -> CoreResult<FindReplacePreview> {
        if find.is_empty() {
            return Err(CoreError::Invalid("search pattern cannot be empty".into()));
        }
        if note_ids.is_empty() {
            return Ok(FindReplacePreview {
                notes_matched: 0,
                occurrences: 0,
            });
        }
        self.storage
            .preview_find_replace(note_ids, field_name, find, use_regex, case_sensitive)
    }

    /// Replace matching text in selected notes inside one transaction, recording undo and emitting one event.
    pub fn find_replace_notes(
        &self,
        note_ids: &[i64],
        field_name: Option<&str>,
        find: &str,
        replace: &str,
        use_regex: bool,
        case_sensitive: bool,
    ) -> CoreResult<u32> {
        if find.is_empty() {
            return Err(CoreError::Invalid("search pattern cannot be empty".into()));
        }
        if note_ids.is_empty() {
            return Ok(0);
        }
        let now = self.clock.now_ms();
        let prev = self.storage.find_replace_notes(
            note_ids,
            field_name,
            find,
            replace,
            use_regex,
            case_sensitive,
            now,
        )?;
        let count = prev.len() as u32;
        if count > 0 {
            let updated_ids: Vec<i64> = prev.iter().map(|s| s.note_id).collect();
            self.record_undo(UndoAction::FindReplace { count }, move |s, undo_now| {
                s.restore_notes(&prev, undo_now)
            });
            self.events.emit(DomainEvent::NotesUpdated {
                note_ids: updated_ids,
            });
        }
        Ok(count)
    }

    /// Find groups of duplicate notes by `field_ord` of `notetype_id` using `search_norm`.
    pub fn find_duplicates(
        &self,
        notetype_id: i64,
        field_ord: i64,
    ) -> CoreResult<Vec<DuplicateGroup>> {
        self.storage.find_duplicates(notetype_id, field_ord)
    }

    /// Load up to 200 notes from a deck subtree or explicit selection for AI quality review.
    pub fn load_quality_notes(
        &self,
        deck_id: Option<i64>,
        note_ids: Option<&[i64]>,
        leeches_only: bool,
    ) -> CoreResult<Vec<QualityScanNote>> {
        self.storage.load_quality_notes(
            deck_id,
            note_ids,
            leeches_only,
            crate::ai::MAX_QUALITY_SCAN_NOTES as u32,
        )
    }

    /// Apply AI quality rewrites and tag additions inside one transaction with one undo step.
    pub fn apply_quality_fixes(
        &self,
        edits: &[QualityNoteEdit],
    ) -> CoreResult<ApplyQualityFixesResult> {
        if edits.is_empty() {
            return Ok(ApplyQualityFixesResult {
                notes_updated: 0,
                note_ids: Vec::new(),
            });
        }
        let now = self.clock.now_ms();
        let prev = self.storage.apply_quality_fixes(edits, now)?;
        let note_ids: Vec<i64> = prev.iter().map(|s| s.note_id).collect();
        let count = note_ids.len() as u32;
        if count > 0 {
            self.record_undo(UndoAction::QualityFixes { count }, move |s, undo_now| {
                s.restore_notes(&prev, undo_now)
            });
            self.events.emit(DomainEvent::NotesUpdated {
                note_ids: note_ids.clone(),
            });
        }
        Ok(ApplyQualityFixesResult {
            notes_updated: count,
            note_ids,
        })
    }

    /// Change note type of selected notes inside one transaction, recording undo and emitting one event.
    pub fn change_note_type(
        &self,
        note_ids: &[i64],
        target_notetype_id: i64,
        field_map: &[Option<usize>],
        template_map: &[(i64, Option<i64>)],
    ) -> CoreResult<u32> {
        if note_ids.is_empty() {
            return Ok(0);
        }
        let now = self.clock.now_ms();
        let prev = self.storage.change_note_type(
            note_ids,
            target_notetype_id,
            field_map,
            template_map,
            now,
        )?;
        let count = prev.len() as u32;
        if count > 0 {
            let updated_ids: Vec<i64> = prev.iter().map(|s| s.note_id).collect();
            self.record_undo(UndoAction::ChangeNoteType { count }, move |s, undo_now| {
                s.restore_note_type_changes(&prev, undo_now)
            });
            self.events.emit(DomainEvent::NotesUpdated {
                note_ids: updated_ids,
            });
        }
        Ok(count)
    }

    /// Reassign cards to another deck. Emits DeckChanged for the target deck.
    pub fn move_cards_to_deck(&self, card_ids: &[i64], deck_id: i64) -> CoreResult<()> {
        self.storage
            .move_cards_to_deck(card_ids, deck_id, self.clock.now_ms())?;
        self.events.emit(DomainEvent::DeckChanged { deck_id });
        Ok(())
    }
}
