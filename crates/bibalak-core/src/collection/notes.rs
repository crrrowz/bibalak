use crate::error::{CoreError, CoreResult};
use crate::events::{DomainEvent, EventSink};
use crate::ipc::{
    AddNoteResult, AddNotesBatchResult, BatchNoteInput, NoteDetail, NoteOverview, TagCount,
};
use crate::undo::UndoAction;
use crate::Collection;

impl Collection {
    fn ensure_writable_deck(&self, deck_id: i64) -> CoreResult<()> {
        let deck = self
            .storage
            .deck_by_id(deck_id)?
            .ok_or_else(|| CoreError::NotFound(format!("deck {deck_id}")))?;
        if deck.is_filtered {
            return Err(CoreError::Invalid(
                "cannot add notes to a filtered deck".into(),
            ));
        }
        Ok(())
    }

    /// Add a note to `deck_id`, generating cards from the notetype's templates.
    /// Returns the result DTO (`note_id` + `cards_added`).
    pub fn add_note(
        &self,
        notetype_id: i64,
        deck_id: i64,
        fields: &[String],
        tags: &[String],
    ) -> CoreResult<AddNoteResult> {
        self.ensure_writable_deck(deck_id)?;
        let first_field = fields.first().map(|f| f.trim()).unwrap_or("");
        if first_field.is_empty() {
            return Err(CoreError::Invalid("first field cannot be empty".into()));
        }
        let (note_id, cards_added) = self.storage.add_note_with_cards(
            notetype_id,
            deck_id,
            fields,
            tags,
            self.clock.now_ms(),
        )?;
        self.record_undo(UndoAction::AddNote { count: 1 }, move |s, undo_now| {
            s.delete_notes(&[note_id], undo_now)
        });
        self.events.emit(DomainEvent::NoteAdded { note_id });
        Ok(AddNoteResult {
            note_id,
            cards_added,
        })
    }

    /// Add multiple notes in a single transaction, emitting one `NotesUpdated` event.
    pub fn add_notes_batch(
        &self,
        notetype_id: i64,
        deck_id: i64,
        notes: &[BatchNoteInput],
    ) -> CoreResult<AddNotesBatchResult> {
        if notes.is_empty() {
            return Ok(AddNotesBatchResult {
                note_ids: vec![],
                cards_added: 0,
            });
        }
        self.ensure_writable_deck(deck_id)?;
        for note in notes {
            let first_field = note.fields.first().map(|f| f.trim()).unwrap_or("");
            if first_field.is_empty() {
                return Err(CoreError::Invalid("first field cannot be empty".into()));
            }
        }
        let (note_ids, cards_added) =
            self.storage
                .add_notes_batch(notetype_id, deck_id, notes, self.clock.now_ms())?;
        let undo_ids = note_ids.clone();
        let count = u32::try_from(undo_ids.len()).unwrap_or(u32::MAX);
        self.record_undo(UndoAction::AddNote { count }, move |s, undo_now| {
            s.delete_notes(&undo_ids, undo_now)
        });
        self.events.emit(DomainEvent::NotesUpdated {
            note_ids: note_ids.clone(),
        });
        Ok(AddNotesBatchResult {
            note_ids,
            cards_added,
        })
    }

    /// Check whether a note sharing the same notetype and first-field checksum exists.
    pub fn check_duplicate(&self, notetype_id: i64, first_field: &str) -> CoreResult<Option<i64>> {
        self.storage.find_duplicate_note(notetype_id, first_field)
    }

    /// Notes for the browser, optionally filtered by a substring.
    pub fn list_notes(&self, query: Option<&str>) -> CoreResult<Vec<NoteOverview>> {
        self.storage.list_notes(query, 1000)
    }

    /// Full note for the editor.
    pub fn note_detail(&self, note_id: i64) -> CoreResult<Option<NoteDetail>> {
        self.storage.note_detail(note_id)
    }

    /// Save edited note field values + tags.
    pub fn update_note(&self, note_id: i64, fields: &[String], tags: &[String]) -> CoreResult<()> {
        let prev = self.storage.note_detail(note_id)?;
        self.storage
            .update_note(note_id, fields, tags, self.clock.now_ms())?;
        if let Some(prev) = prev {
            let prev_fields: Vec<String> = prev.fields.into_iter().map(|f| f.value).collect();
            let prev_tags = prev.tags;
            self.record_undo(UndoAction::EditNote, move |s, undo_now| {
                s.update_note(note_id, &prev_fields, &prev_tags, undo_now)
            });
        }
        self.events.emit(DomainEvent::NoteUpdated { note_id });
        Ok(())
    }

    /// Browser rows for a set of note ids (search hits).
    pub fn notes_by_ids(&self, ids: &[i64]) -> CoreResult<Vec<NoteOverview>> {
        self.storage.notes_by_ids(ids)
    }

    /// Delete notes (and their cards + revlogs). Reconciles motivation quests,
    /// clears undo history, and emits SchemaChanged.
    ///
    /// A3-03 rule: already-earned XP from past reviews stays in `progress_ledger`,
    /// while quest bonuses that no longer hold are revoked (same rule as answer
    /// undo; unlike F1 full deck reset, which wipes the deck's earned XP).
    pub fn delete_notes(&self, note_ids: &[i64]) -> CoreResult<()> {
        self.storage.delete_notes(note_ids, self.clock.now_ms())?;
        let _ = self.reconcile_motivation(true)?;
        self.clear_undo();
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(())
    }

    /// Add a tag to a single note (idempotent). Emits NoteUpdated.
    pub fn add_note_tag_single(&self, note_id: i64, tag: &str) -> CoreResult<()> {
        self.storage
            .add_note_tag(note_id, tag, self.clock.now_ms())?;
        self.events.emit(DomainEvent::NoteUpdated { note_id });
        Ok(())
    }

    /// Remove a tag from a single note. Emits NoteUpdated.
    pub fn remove_note_tag_single(&self, note_id: i64, tag: &str) -> CoreResult<()> {
        self.storage
            .remove_note_tag(note_id, tag, self.clock.now_ms())?;
        self.events.emit(DomainEvent::NoteUpdated { note_id });
        Ok(())
    }

    /// Bulk: add a tag to many notes. Runs in one transaction and emits one NotesUpdated event.
    pub fn bulk_add_tag(&self, note_ids: &[i64], tag: &str) -> CoreResult<()> {
        if note_ids.is_empty() {
            return Ok(());
        }
        let now = self.clock.now_ms();
        self.storage.bulk_add_tag(note_ids, tag, now)?;
        self.clear_undo();
        self.events.emit(DomainEvent::NotesUpdated {
            note_ids: note_ids.to_vec(),
        });
        Ok(())
    }

    /// Bulk: add one or more tags to many notes in one transaction, emitting one NotesUpdated event.
    pub fn bulk_add_tags(&self, note_ids: &[i64], tags: &[String]) -> CoreResult<()> {
        if note_ids.is_empty() || tags.is_empty() {
            return Ok(());
        }
        let now = self.clock.now_ms();
        self.storage.bulk_add_tags(note_ids, tags, now)?;
        self.clear_undo();
        self.events.emit(DomainEvent::NotesUpdated {
            note_ids: note_ids.to_vec(),
        });
        Ok(())
    }

    /// Bulk: remove a tag from many notes. Runs in one transaction and emits one NotesUpdated event.
    pub fn bulk_remove_tag(&self, note_ids: &[i64], tag: &str) -> CoreResult<()> {
        if note_ids.is_empty() {
            return Ok(());
        }
        let now = self.clock.now_ms();
        self.storage.bulk_remove_tag(note_ids, tag, now)?;
        self.clear_undo();
        self.events.emit(DomainEvent::NotesUpdated {
            note_ids: note_ids.to_vec(),
        });
        Ok(())
    }

    /// Bulk: remove one or more tags from many notes in one transaction, emitting one NotesUpdated event.
    pub fn bulk_remove_tags(&self, note_ids: &[i64], tags: &[String]) -> CoreResult<()> {
        if note_ids.is_empty() || tags.is_empty() {
            return Ok(());
        }
        let now = self.clock.now_ms();
        self.storage.bulk_remove_tags(note_ids, tags, now)?;
        self.clear_undo();
        self.events.emit(DomainEvent::NotesUpdated {
            note_ids: note_ids.to_vec(),
        });
        Ok(())
    }

    pub fn list_tags(&self) -> CoreResult<Vec<String>> {
        self.storage.list_tags()
    }

    pub fn list_tag_counts(&self) -> CoreResult<Vec<TagCount>> {
        self.storage.list_tag_counts()
    }

    pub fn rename_tag(&self, old_tag: &str, new_tag: &str) -> CoreResult<u32> {
        let n = self
            .storage
            .rename_tag(old_tag, new_tag, self.clock.now_ms())?;
        self.clear_undo();
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(n)
    }

    pub fn delete_tag(&self, tag: &str) -> CoreResult<u32> {
        let n = self.storage.delete_tag(tag, self.clock.now_ms())?;
        self.clear_undo();
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(n)
    }

    pub fn merge_tags(&self, sources: Vec<String>, target: &str) -> CoreResult<()> {
        self.storage
            .merge_tags(&sources, target, self.clock.now_ms())?;
        self.clear_undo();
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::collection::fake_storage::FakeStorage;
    use crate::ports::FixedClock;
    use crate::{Collection, DomainEvent};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn bulk_add_tag_emits_exactly_one_event_for_batch() {
        let storage = Box::new(FakeStorage::default());
        let clock = Arc::new(FixedClock(1_700_000_000_000));
        let col = Collection::new(storage, clock).unwrap();

        let event_count = Arc::new(AtomicUsize::new(0));
        let count_clone = event_count.clone();
        col.events().subscribe(move |e| {
            if matches!(e, DomainEvent::NotesUpdated { .. }) {
                count_clone.fetch_add(1, Ordering::SeqCst);
            }
        });

        let note_ids: Vec<i64> = (1..=50).collect();
        col.bulk_add_tag(&note_ids, "tag1").unwrap();

        assert_eq!(
            event_count.load(Ordering::SeqCst),
            1,
            "bulk tagging N notes must emit exactly one event"
        );
    }

    #[test]
    fn bulk_suspend_and_bury_emit_exactly_one_event_for_batch() {
        let storage = Box::new(FakeStorage::default());
        let clock = Arc::new(FixedClock(1_700_000_000_000));
        let col = Collection::new(storage, clock).unwrap();

        let event_count = Arc::new(AtomicUsize::new(0));
        let count_clone = event_count.clone();
        col.events().subscribe(move |e| {
            if matches!(e, DomainEvent::DeckChanged { .. }) {
                count_clone.fetch_add(1, Ordering::SeqCst);
            }
        });

        let card_ids: Vec<i64> = (1..=50).collect();
        col.suspend_cards(&card_ids).unwrap();
        assert_eq!(event_count.load(Ordering::SeqCst), 1);

        col.bury_cards(&card_ids).unwrap();
        assert_eq!(event_count.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn add_notes_batch_rejects_filtered_deck_and_emits_one_notes_updated_event() {
        use crate::ipc::BatchNoteInput;

        let storage = Box::new(FakeStorage::default());
        storage.decks.lock().unwrap().push(crate::Deck {
            id: 1,
            name: "Default".into(),
            parent_id: None,
            config_id: 1,
            is_filtered: false,
            collapsed: false,
            mod_ms: 0,
            usn: 0,
        });
        storage.decks.lock().unwrap().push(crate::Deck {
            id: 2,
            name: "Filtered".into(),
            parent_id: None,
            config_id: 1,
            is_filtered: true,
            collapsed: false,
            mod_ms: 0,
            usn: 0,
        });
        let clock = Arc::new(FixedClock(1_700_000_000_000));
        let col = Collection::new(storage, clock).unwrap();

        let batch = vec![
            BatchNoteInput {
                fields: vec!["Q1".into(), "A1".into()],
                tags: vec!["ai-generated".into()],
            },
            BatchNoteInput {
                fields: vec!["Q2".into(), "A2".into()],
                tags: vec!["ai-generated".into()],
            },
        ];

        assert!(col.add_notes_batch(1, 2, &batch).is_err());

        let event_count = Arc::new(AtomicUsize::new(0));
        let count_clone = event_count.clone();
        col.events().subscribe(move |e| {
            if matches!(e, DomainEvent::NotesUpdated { .. }) {
                count_clone.fetch_add(1, Ordering::SeqCst);
            }
        });

        let res = col.add_notes_batch(1, 1, &batch).unwrap();
        assert_eq!(res.note_ids.len(), 2);
        assert_eq!(res.cards_added, 2);
        assert_eq!(event_count.load(Ordering::SeqCst), 1);
    }
}
