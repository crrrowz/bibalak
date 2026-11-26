use std::sync::atomic::Ordering;

use crate::error::{CoreError, CoreResult};
use crate::events::{DomainEvent, EventSink};
use crate::ipc::{DuplicatePolicy, TextImportSummary};
use crate::model::{CanonicalModel, ImportSummary};
use crate::ports::ParsedTextNote;
use crate::Collection;

impl Collection {
    /// Dump the full collection for export (`.apkg`/`.colpkg`).
    pub fn dump_collection(&self) -> CoreResult<CanonicalModel> {
        let mut model = self.storage.dump_collection()?;
        model.created_ms = Some(self.day_zero_start_ms());
        Ok(model)
    }

    /// Merge a parsed package (from `bibalak-ankifmt`) into this collection.
    /// Import is not undoable via the per-op log (it is bulk and transactional);
    /// the pre-import backup is the recovery path (added in a later milestone).
    pub fn import(&self, model: &CanonicalModel) -> CoreResult<ImportSummary> {
        let tz = self.tz_offset_minutes.load(Ordering::Relaxed);
        let summary =
            self.storage
                .import_with_tz(model, tz, self.clock.now_ms(), &mut |_, _| {})?;
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(summary)
    }

    /// Same as [`Collection::import`], but reports progress via `on_progress`
    /// as notes/cards are merged — for surfacing a live indicator on large imports.
    pub fn import_with_progress(
        &self,
        model: &CanonicalModel,
        on_progress: &mut dyn FnMut(u32, u32),
    ) -> CoreResult<ImportSummary> {
        let tz = self.tz_offset_minutes.load(Ordering::Relaxed);
        let summary = self
            .storage
            .import_with_tz(model, tz, self.clock.now_ms(), on_progress)?;
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(summary)
    }

    /// Import mapped notes from CSV/TSV/Markdown into `deck_id` with `notetype_id`
    /// in a single transaction, validating the target deck and incrementally
    /// refreshing the search index and deck counts.
    pub fn import_text_notes(
        &self,
        deck_id: i64,
        notetype_id: i64,
        duplicate_policy: DuplicatePolicy,
        rows: &[ParsedTextNote],
    ) -> CoreResult<TextImportSummary> {
        let deck = self
            .storage
            .deck_by_id(deck_id)?
            .ok_or_else(|| CoreError::NotFound(format!("deck {deck_id}")))?;
        if deck.is_filtered {
            return Err(CoreError::Invalid(
                "cannot import notes directly into a filtered deck".into(),
            ));
        }
        let outcome = self.storage.import_text_notes(
            deck_id,
            notetype_id,
            duplicate_policy,
            rows,
            self.clock.now_ms(),
        )?;
        if !outcome.affected_note_ids.is_empty() {
            self.events.emit(DomainEvent::NotesUpdated {
                note_ids: outcome.affected_note_ids,
            });
            self.events.emit(DomainEvent::DeckChanged { deck_id });
        }
        Ok(outcome.summary)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collection::fake_storage::collection;
    use crate::model::Deck;

    #[test]
    fn import_creates_decks_and_counts_notes() {
        let c = collection();
        let model = CanonicalModel {
            decks: vec![Deck {
                id: 5,
                name: "Imported".into(),
                parent_id: None,
                config_id: 1,
                mod_ms: 0,
                usn: -1,
                collapsed: false,
                is_filtered: false,
            }],
            notes: vec![crate::model::Note {
                id: 1700000000000,
                guid: "abc".into(),
                notetype_id: 1,
                mod_ms: 0,
                usn: -1,
                tags: vec![],
                fields: vec!["Front".into(), "Back".into()],
                sort_field: Some("Front".into()),
                checksum: None,
            }],
            ..Default::default()
        };
        let summary = c.import(&model).unwrap();
        assert_eq!(summary.decks_added, 1);
        assert_eq!(summary.notes_added, 1);
        assert!(c.list_decks().unwrap().iter().any(|d| d.name == "Imported"));
    }
}
