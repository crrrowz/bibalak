use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::atomic::Ordering;

use crate::error::{CoreError, CoreResult};
use crate::events::{DomainEvent, EventSink};
use crate::ipc::{DuplicatePolicy, ExportEstimate, ExportScope, TextImportSummary};
use crate::media_refs::{canonical_media_key, extract_media_refs};
use crate::model::{CanonicalModel, ImportSummary};
use crate::ports::{MediaStore, ParsedTextNote};
use crate::Collection;

const HOST_CASE_INSENSITIVE: bool = cfg!(any(target_os = "windows", target_os = "macos"));

/// Prepared `.apkg` export payload (scoped model + resolved media entries).
#[derive(Debug, Clone)]
pub struct PreparedExport {
    pub model: CanonicalModel,
    /// `(stored_filename, size_bytes)` pairs to pack into the `.apkg`.
    pub media_files: Vec<(String, u64)>,
    pub media_skipped_missing: u32,
}

/// Extract all unique local media references from exported notes, templates,
/// and notetype CSS.
pub fn collect_export_media_refs(model: &CanonicalModel) -> BTreeSet<String> {
    let mut refs = BTreeSet::new();
    for note in &model.notes {
        for field in &note.fields {
            refs.extend(extract_media_refs(field));
        }
    }
    for tpl in &model.templates {
        refs.extend(extract_media_refs(&tpl.qfmt));
        refs.extend(extract_media_refs(&tpl.afmt));
    }
    for nt in &model.notetypes {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&nt.config_json) {
            if let Some(css) = val.get("css").and_then(|v| v.as_str()) {
                refs.extend(extract_media_refs(css));
            }
        }
    }
    refs
}

/// Strip scheduling and review history so exported cards import as fresh new cards.
pub fn strip_export_scheduling(model: &mut CanonicalModel) {
    model.revlog.clear();
    for (idx, card) in model.cards.iter_mut().enumerate() {
        card.ctype = 0;
        card.queue = 0;
        card.due = (idx + 1) as i64;
        card.interval = 0;
        card.ease_factor = 0;
        card.reps = 0;
        card.lapses = 0;
        card.remaining = 0;
        card.original_due = 0;
        card.original_deck_id = 0;
        card.flags = 0;
        card.usn = 0;
        card.fsrs_stability = None;
        card.fsrs_difficulty = None;
        card.fsrs_last_review = None;
        card.data = None;
    }
}

impl Collection {
    /// Dump the full collection for export (`.apkg`/`.colpkg`).
    pub fn dump_collection(&self) -> CoreResult<CanonicalModel> {
        let mut model = self.storage.dump_collection()?;
        model.created_ms = Some(self.day_zero_start_ms());
        Ok(model)
    }

    fn resolve_export_deck_ids(&self, scope: &ExportScope) -> CoreResult<Option<Vec<i64>>> {
        match scope {
            ExportScope::Collection => Ok(None),
            ExportScope::Deck {
                deck_id,
                include_subdecks,
            } => {
                let deck = self
                    .storage
                    .deck_by_id(*deck_id)?
                    .ok_or_else(|| CoreError::NotFound(format!("deck {deck_id}")))?;
                if deck.is_filtered {
                    return Err(CoreError::Invalid("cannot export a filtered deck".into()));
                }
                let ids = if *include_subdecks {
                    self.study_subtree(*deck_id)?
                } else {
                    vec![*deck_id]
                };
                Ok(Some(ids))
            }
        }
    }

    fn select_export_media(
        scope: &ExportScope,
        model: &CanonicalModel,
        include_media: bool,
        media_store: &dyn MediaStore,
    ) -> CoreResult<(Vec<(String, u64)>, u32)> {
        if !include_media {
            return Ok((Vec::new(), 0));
        }
        let available = media_store.list_sizes()?;
        match scope {
            ExportScope::Collection => Ok((available, 0)),
            ExportScope::Deck { .. } => {
                let mut by_key: HashMap<String, (String, u64)> =
                    HashMap::with_capacity(available.len());
                for (name, size) in available {
                    by_key
                        .entry(canonical_media_key(&name, HOST_CASE_INSENSITIVE))
                        .or_insert((name, size));
                }

                let refs = collect_export_media_refs(model);
                let mut selected: BTreeMap<String, u64> = BTreeMap::new();
                let mut skipped_missing = 0u32;
                for ref_name in refs {
                    let key = canonical_media_key(&ref_name, HOST_CASE_INSENSITIVE);
                    if let Some((stored_name, size)) = by_key.get(&key) {
                        selected.insert(stored_name.clone(), *size);
                    } else {
                        skipped_missing += 1;
                    }
                }
                Ok((selected.into_iter().collect(), skipped_missing))
            }
        }
    }

    /// Estimate notes, cards, and media bytes for the export dialog preview.
    pub fn estimate_export(
        &self,
        scope: &ExportScope,
        include_media: bool,
        media_store: &dyn MediaStore,
    ) -> CoreResult<ExportEstimate> {
        let deck_ids = self.resolve_export_deck_ids(scope)?;
        let model = self
            .storage
            .dump_collection_scoped(deck_ids.as_deref(), false)?;
        let (media_files, _) =
            Self::select_export_media(scope, &model, include_media, media_store)?;
        let media_bytes = media_files.iter().map(|(_, s)| *s).sum();
        Ok(ExportEstimate {
            notes: model.notes.len() as u32,
            cards: model.cards.len() as u32,
            media_files: media_files.len() as u32,
            media_bytes,
        })
    }

    /// Prepare a scoped `CanonicalModel` and media list for streaming `.apkg` export.
    pub fn prepare_export(
        &self,
        scope: &ExportScope,
        include_media: bool,
        include_scheduling: bool,
        media_store: &dyn MediaStore,
    ) -> CoreResult<PreparedExport> {
        let deck_ids = self.resolve_export_deck_ids(scope)?;
        let mut model = self
            .storage
            .dump_collection_scoped(deck_ids.as_deref(), include_scheduling)?;
        model.created_ms = Some(self.day_zero_start_ms());
        if !include_scheduling {
            strip_export_scheduling(&mut model);
        }
        let (media_files, media_skipped_missing) =
            Self::select_export_media(scope, &model, include_media, media_store)?;
        Ok(PreparedExport {
            model,
            media_files,
            media_skipped_missing,
        })
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

    #[test]
    fn strip_export_scheduling_resets_cards_and_clears_revlog() {
        let mut model = CanonicalModel {
            cards: vec![crate::model::Card {
                id: 10,
                note_id: 1,
                deck_id: 2,
                ord: 0,
                mod_ms: 500,
                usn: -1,
                ctype: 2,
                queue: 2,
                due: 99,
                interval: 21,
                ease_factor: 2500,
                reps: 8,
                lapses: 1,
                remaining: 2,
                original_due: 44,
                original_deck_id: 3,
                flags: 2,
                fsrs_stability: Some(12.5),
                fsrs_difficulty: Some(5.0),
                fsrs_last_review: Some(50),
                data: Some("{}".into()),
            }],
            revlog: vec![crate::model::Revlog {
                id: 1000,
                card_id: 10,
                usn: 0,
                ease: 3,
                interval: 21,
                last_interval: 10,
                ease_factor: 2500,
                taken_ms: 1500,
                review_kind: 1,
            }],
            ..Default::default()
        };

        strip_export_scheduling(&mut model);
        assert!(model.revlog.is_empty());
        let c = &model.cards[0];
        assert_eq!(c.ctype, 0);
        assert_eq!(c.queue, 0);
        assert_eq!(c.due, 1);
        assert_eq!(c.interval, 0);
        assert_eq!(c.ease_factor, 0);
        assert_eq!(c.reps, 0);
        assert_eq!(c.lapses, 0);
        assert_eq!(c.remaining, 0);
        assert_eq!(c.original_due, 0);
        assert_eq!(c.original_deck_id, 0);
        assert_eq!(c.flags, 0);
        assert_eq!(c.usn, 0);
        assert!(c.fsrs_stability.is_none());
        assert!(c.fsrs_difficulty.is_none());
        assert!(c.fsrs_last_review.is_none());
        assert!(c.data.is_none());
    }

    #[test]
    fn collect_export_media_refs_covers_fields_templates_scripts_and_css() {
        let model = CanonicalModel {
            notetypes: vec![crate::model::Notetype {
                id: 1,
                name: "Basic".into(),
                kind: 0,
                mod_ms: 0,
                usn: 0,
                config_json: r#"{"css":".card { background: url(\"bg.jpg\"); }"}"#.into(),
            }],
            templates: vec![crate::model::Template {
                notetype_id: 1,
                ord: 0,
                name: "Card 1".into(),
                qfmt: r#"<script src="_helper.js"></script>{{Front}}"#.into(),
                afmt: r#"<img src="banner.png">{{Back}}"#.into(),
                config_json: "{}".into(),
            }],
            notes: vec![crate::model::Note {
                id: 1,
                guid: "g1".into(),
                notetype_id: 1,
                mod_ms: 0,
                usn: 0,
                tags: vec![],
                fields: vec![r#"[sound:audio.mp3]"#.into(), "back".into()],
                sort_field: None,
                checksum: None,
            }],
            ..Default::default()
        };

        let refs = collect_export_media_refs(&model);
        assert_eq!(
            refs,
            BTreeSet::from([
                "_helper.js".into(),
                "audio.mp3".into(),
                "banner.png".into(),
                "bg.jpg".into(),
            ])
        );
    }
}
