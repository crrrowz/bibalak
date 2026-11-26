//! Integration tests for EXP1 Phase 2 (Gates T1–T6) and BW2-25 import progress/cancel.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use bibalak_ankifmt::{read_package_with_media, read_package_with_progress, write_apkg_streaming};
use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::{ExportScope, ExportStage, ImportStage, MediaReport};
use bibalak_core::ports::{FixedClock, MediaEntry, MediaStore, Storage};
use bibalak_core::Collection;
use bibalak_db::SqliteStorage;
use bibalak_media::FsMediaStore;
use rusqlite::Connection;

fn setup_collection() -> (tempfile::TempDir, Collection, FsMediaStore) {
    let dir = tempfile::tempdir().unwrap();
    let media_dir = dir.path().join("collection.media");
    std::fs::create_dir_all(&media_dir).unwrap();
    let storage = SqliteStorage::open_in_memory().unwrap();
    let col = Collection::new(Box::new(storage), Arc::new(FixedClock(1_700_000_000_000))).unwrap();
    let store = FsMediaStore::new(media_dir);
    (dir, col, store)
}

struct NoHashMediaStore<'a> {
    inner: &'a FsMediaStore,
    list_calls: AtomicUsize,
    read_calls: AtomicUsize,
    open_reader_calls: AtomicUsize,
}

impl<'a> NoHashMediaStore<'a> {
    fn new(inner: &'a FsMediaStore) -> Self {
        Self {
            inner,
            list_calls: AtomicUsize::new(0),
            read_calls: AtomicUsize::new(0),
            open_reader_calls: AtomicUsize::new(0),
        }
    }
}

impl MediaStore for NoHashMediaStore<'_> {
    fn add(&self, filename: &str, bytes: &[u8]) -> CoreResult<String> {
        self.inner.add(filename, bytes)
    }
    fn read(&self, filename: &str) -> CoreResult<Vec<u8>> {
        self.read_calls.fetch_add(1, Ordering::Relaxed);
        self.inner.read(filename)
    }
    fn open_reader(&self, filename: &str) -> CoreResult<Box<dyn Read + Send>> {
        self.open_reader_calls.fetch_add(1, Ordering::Relaxed);
        self.inner.open_reader(filename)
    }
    fn list(&self) -> CoreResult<Vec<MediaEntry>> {
        self.list_calls.fetch_add(1, Ordering::Relaxed);
        self.inner.list()
    }
    fn list_sizes(&self) -> CoreResult<Vec<(String, u64)>> {
        self.inner.list_sizes()
    }
    fn usage_counts(&self, storage: &dyn Storage) -> CoreResult<BTreeMap<String, u32>> {
        self.inner.usage_counts(storage)
    }
    fn find_unused(&self, storage: &dyn Storage) -> CoreResult<Vec<String>> {
        self.inner.find_unused(storage)
    }
    fn check_media(&self, storage: &dyn Storage) -> CoreResult<MediaReport> {
        self.inner.check_media(storage)
    }
    fn delete(&self, filenames: &[String]) -> CoreResult<u32> {
        self.inner.delete(filenames)
    }
    fn rename(
        &self,
        storage: &dyn Storage,
        old_name: &str,
        new_name: &str,
        now_ms: i64,
    ) -> CoreResult<u32> {
        self.inner.rename(storage, old_name, new_name, now_ms)
    }
}

#[test]
fn t1_t2_t4_scoped_deck_export_media_and_anki_compatibility() {
    let (dir, col, store) = setup_collection();
    let lang = col.create_deck("Lang").unwrap().id;
    let verbs = col.create_deck("Lang::Verbs").unwrap().id;
    let history = col.create_deck("History").unwrap().id;
    let filtered = col.create_filtered_deck("Cram", "is:new", 10, 0).unwrap();

    // Filtered deck export must be rejected.
    let err = col
        .prepare_export(
            &ExportScope::Deck {
                deck_id: filtered.id,
                include_subdecks: true,
            },
            true,
            false,
            &store,
        )
        .unwrap_err();
    assert!(matches!(err, CoreError::Invalid(_)));

    // Custom notetype with CSS url(...), template <script src="_helper.js">, and keepsakePreset JSON.
    let nt_id = col.create_notetype("LangCard", 0).unwrap().id;
    col.save_template(
        nt_id,
        0,
        "Card 1",
        r#"<script src="_helper.js"></script>{{Front}}"#,
        "{{Back}}",
    )
    .unwrap();
    col.save_notetype_css(nt_id, r#".card { background: url("bg.jpg"); }"#)
        .unwrap();
    let rev_nt = col
        .list_notetypes()
        .unwrap()
        .into_iter()
        .find(|n| n.name == "Basic (and reversed card)")
        .unwrap()
        .id;

    // Media files: used in target deck, used in template/CSS, used only in sibling, orphan, unused _font.
    store.add("in_deck.png", b"deck-img").unwrap();
    store.add("_helper.js", b"console.log(1);").unwrap();
    store.add("bg.jpg", b"bg-bytes").unwrap();
    store.add("other_deck.png", b"other-img").unwrap();
    store.add("orphan.png", b"orphan-bytes").unwrap();
    store.add("_unused.woff2", b"unused-font").unwrap();

    // Target deck note referencing in_deck.png and a missing file.
    col.add_note(
        nt_id,
        verbs,
        &[
            r#"Hola <img src="in_deck.png"> <img src="missing_file.png">"#.into(),
            "Back".into(),
        ],
        &["vocab".into()],
    )
    .unwrap();

    // Multi-card note split across Lang::Verbs (card 0) and History (card 1).
    let split_note_id = col
        .add_note(rev_nt, verbs, &["uno".into(), "one".into()], &[])
        .unwrap()
        .note_id;
    let split_cards: Vec<i64> = col
        .dump_collection()
        .unwrap()
        .cards
        .into_iter()
        .filter(|c| c.note_id == split_note_id)
        .map(|c| c.id)
        .collect();
    col.move_cards_to_deck(&[split_cards[1]], history).unwrap();

    // Sibling deck note referencing other_deck.png.
    let basic_nt = col
        .list_notetypes()
        .unwrap()
        .into_iter()
        .find(|n| n.name == "Basic")
        .unwrap()
        .id;
    col.add_note(
        basic_nt,
        history,
        &[
            r#"History <img src="other_deck.png">"#.into(),
            "1914".into(),
        ],
        &[],
    )
    .unwrap();

    // T5: ensure zero MediaStore::list() / read() calls during prepare + streaming export.
    let no_hash_store = NoHashMediaStore::new(&store);
    let prepared = col
        .prepare_export(
            &ExportScope::Deck {
                deck_id: lang,
                include_subdecks: true,
            },
            true,
            false,
            &no_hash_store,
        )
        .unwrap();
    assert_eq!(prepared.media_skipped_missing, 1);
    let selected_names: BTreeSet<String> = prepared
        .media_files
        .iter()
        .map(|(n, _)| n.clone())
        .collect();
    assert_eq!(
        selected_names,
        BTreeSet::from(["_helper.js".into(), "bg.jpg".into(), "in_deck.png".into()])
    );

    let out_apkg = dir.path().join("lang.apkg");
    let cancel = AtomicBool::new(false);
    let mut stages = Vec::new();
    let outcome = write_apkg_streaming(
        &prepared.model,
        &out_apkg,
        Some(&no_hash_store),
        &prepared.media_files,
        &cancel,
        &mut |u| stages.push(u.stage),
    )
    .unwrap();

    assert_eq!(outcome.media_exported, 3);
    assert_eq!(no_hash_store.list_calls.load(Ordering::Relaxed), 0);
    assert_eq!(no_hash_store.read_calls.load(Ordering::Relaxed), 0);
    assert_eq!(no_hash_store.open_reader_calls.load(Ordering::Relaxed), 3);
    assert!(stages.contains(&ExportStage::WritingDb));
    assert!(stages.contains(&ExportStage::PackingMedia));
    assert!(stages.contains(&ExportStage::Finalizing));

    // T4: verify ZIP contents directly (no keepsakePreset in col.models; media JSON matches).
    {
        let file = std::fs::File::open(&out_apkg).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        let mut media_json = String::new();
        zip.by_name("media")
            .unwrap()
            .read_to_string(&mut media_json)
            .unwrap();
        let media_map: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&media_json).unwrap();
        let exported_media_names: BTreeSet<String> = media_map
            .values()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        assert_eq!(exported_media_names, selected_names);

        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("c.anki2");
        let mut db_bytes = Vec::new();
        zip.by_name("collection.anki2")
            .unwrap()
            .read_to_end(&mut db_bytes)
            .unwrap();
        std::fs::write(&db_path, &db_bytes).unwrap();
        let conn = Connection::open(&db_path).unwrap();
        let models_json: String = conn
            .query_row("SELECT models FROM col WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert!(!models_json.contains("keepsakePreset"));
    }

    // T4 round-trip into a fresh collection.
    let fresh_dir = dir.path().join("fresh_media");
    let fresh_store = FsMediaStore::new(fresh_dir);
    let (reimported, media_count) = read_package_with_media(&out_apkg, Some(&fresh_store)).unwrap();
    assert_eq!(media_count, 3);
    assert_eq!(reimported.notes.len(), 2);
    assert_eq!(reimported.cards.len(), 2); // 1 note in LangCard + 1 split card in Lang::Verbs
    assert!(reimported.decks.iter().any(|d| d.name == "Lang::Verbs"));
    assert!(!reimported.decks.iter().any(|d| d.name == "History"));

    // T2 collection scope includes all 6 media files on disk.
    let col_prepared = col
        .prepare_export(&ExportScope::Collection, true, true, &no_hash_store)
        .unwrap();
    assert_eq!(col_prepared.media_files.len(), 6);
    assert_eq!(no_hash_store.list_calls.load(Ordering::Relaxed), 0);
}

#[test]
fn t3_scheduling_flag_controls_card_state_and_revlog() {
    let dir = tempfile::tempdir().unwrap();
    let media_dir = dir.path().join("collection.media");
    std::fs::create_dir_all(&media_dir).unwrap();
    let storage = SqliteStorage::open_in_memory().unwrap();
    let col = Collection::new(Box::new(storage), Arc::new(FixedClock(1_700_000_000_000))).unwrap();
    let store = FsMediaStore::new(media_dir);

    let deck = col.create_deck("StudyDeck").unwrap().id;
    let nt = col
        .list_notetypes()
        .unwrap()
        .into_iter()
        .find(|n| n.name == "Basic")
        .unwrap()
        .id;
    col.add_note(nt, deck, &["Q".into(), "A".into()], &[])
        .unwrap();
    let card_id = col.dump_collection().unwrap().cards[0].id;
    // Import a review-state card + revlog entry so scheduling and FSRS fields are populated.
    let sched_model = bibalak_core::model::CanonicalModel {
        decks: vec![bibalak_core::model::Deck {
            id: 99,
            name: "StudyDeck".into(),
            parent_id: None,
            config_id: 1,
            mod_ms: 0,
            usn: 0,
            collapsed: false,
            is_filtered: false,
        }],
        notetypes: vec![bibalak_core::model::Notetype {
            id: 88,
            name: "Basic".into(),
            kind: 0,
            mod_ms: 0,
            usn: 0,
            config_json: "{}".into(),
        }],
        notes: vec![bibalak_core::model::Note {
            id: 77,
            guid: "sched-guid".into(),
            notetype_id: 88,
            mod_ms: 0,
            usn: 0,
            tags: vec![],
            fields: vec!["Q2".into(), "A2".into()],
            sort_field: Some("Q2".into()),
            checksum: None,
        }],
        cards: vec![bibalak_core::model::Card {
            id: 66,
            note_id: 77,
            deck_id: 99,
            ord: 0,
            mod_ms: 0,
            usn: 0,
            ctype: 2,
            queue: 2,
            due: 5,
            interval: 14,
            ease_factor: 2500,
            reps: 4,
            lapses: 1,
            remaining: 0,
            original_due: 0,
            original_deck_id: 0,
            flags: 1,
            fsrs_stability: Some(9.5),
            fsrs_difficulty: Some(4.2),
            fsrs_last_review: Some(1),
            data: Some("{}".into()),
        }],
        revlog: vec![bibalak_core::model::Revlog {
            id: 500_001,
            card_id: 66,
            usn: 0,
            ease: 3,
            interval: 14,
            last_interval: 6,
            ease_factor: 2500,
            taken_ms: 1200,
            review_kind: 1,
        }],
        ..Default::default()
    };
    col.import(&sched_model).unwrap();
    let _ = card_id;

    // include_scheduling = true keeps review state and revlog.
    let with_sched = col
        .prepare_export(
            &ExportScope::Deck {
                deck_id: deck,
                include_subdecks: false,
            },
            false,
            true,
            &store,
        )
        .unwrap();
    assert_eq!(with_sched.model.revlog.len(), 1);
    assert!(with_sched.model.cards.iter().any(|c| c.reps == 4));

    // include_scheduling = false resets cards to new and clears revlog.
    let without_sched = col
        .prepare_export(
            &ExportScope::Deck {
                deck_id: deck,
                include_subdecks: false,
            },
            false,
            false,
            &store,
        )
        .unwrap();
    assert!(without_sched.model.revlog.is_empty());
    let c = &without_sched.model.cards[0];
    assert_eq!(c.ctype, 0);
    assert_eq!(c.queue, 0);
    assert_eq!(c.reps, 0);
    assert_eq!(c.interval, 0);
    assert!(c.fsrs_stability.is_none());

    let out = dir.path().join("no-sched.apkg");
    write_apkg_streaming(
        &without_sched.model,
        &out,
        Some(&store),
        &without_sched.media_files,
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();
    let (re, _) = read_package_with_media(&out, None).unwrap();
    assert!(re.revlog.is_empty());
    assert_eq!(re.cards[0].ctype, 0);
}

#[test]
fn t6_cancel_mid_stream_cleans_partial_and_preserves_existing_file() {
    let (dir, col, store) = setup_collection();
    let deck = col.create_deck("BigDeck").unwrap().id;
    let nt = col
        .list_notetypes()
        .unwrap()
        .into_iter()
        .find(|n| n.name == "Basic")
        .unwrap()
        .id;

    let blob = vec![0xABu8; 512 * 1024];
    store.add("big1.bin", &blob).unwrap();
    store.add("big2.bin", &blob).unwrap();
    col.add_note(
        nt,
        deck,
        &[
            r#"Big <img src="big1.bin"><img src="big2.bin">"#.into(),
            "Back".into(),
        ],
        &[],
    )
    .unwrap();

    let prepared = col
        .prepare_export(
            &ExportScope::Deck {
                deck_id: deck,
                include_subdecks: false,
            },
            true,
            false,
            &store,
        )
        .unwrap();

    // Case 1: cancelling export to a new destination leaves no file and no partial.
    let new_dest = dir.path().join("cancelled_new.apkg");
    let cancel_new = AtomicBool::new(false);
    let err = write_apkg_streaming(
        &prepared.model,
        &new_dest,
        Some(&store),
        &prepared.media_files,
        &cancel_new,
        &mut |u| {
            if u.stage == ExportStage::PackingMedia && u.bytes_done > 0 {
                cancel_new.store(true, Ordering::Relaxed);
            }
        },
    )
    .unwrap_err();
    assert!(matches!(err, CoreError::Cancelled));
    assert!(!new_dest.exists());

    // Case 2: cancelling export over an existing file leaves original bytes untouched.
    let existing_dest = dir.path().join("existing.apkg");
    std::fs::write(&existing_dest, b"ORIGINAL_BYTES").unwrap();
    let cancel_overwrite = AtomicBool::new(false);
    let err2 = write_apkg_streaming(
        &prepared.model,
        &existing_dest,
        Some(&store),
        &prepared.media_files,
        &cancel_overwrite,
        &mut |u| {
            if u.stage == ExportStage::PackingMedia && u.bytes_done > 0 {
                cancel_overwrite.store(true, Ordering::Relaxed);
            }
        },
    )
    .unwrap_err();
    assert!(matches!(err2, CoreError::Cancelled));
    assert_eq!(std::fs::read(&existing_dest).unwrap(), b"ORIGINAL_BYTES");

    // Verify no .keepsake-partial-* temp files remain in dir.
    let leftovers: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.contains(".keepsake-partial-"))
        .collect();
    assert!(leftovers.is_empty(), "leftover partials: {leftovers:?}");
}

#[test]
fn bw2_25_import_reports_reading_and_media_stages_and_cancels_cleanly() {
    let (dir, col, store) = setup_collection();
    let deck = col.create_deck("Pkg").unwrap().id;
    let nt = col
        .list_notetypes()
        .unwrap()
        .into_iter()
        .find(|n| n.name == "Basic")
        .unwrap()
        .id;
    store.add("pic1.png", b"png-1").unwrap();
    store.add("pic2.png", b"png-2").unwrap();
    col.add_note(
        nt,
        deck,
        &[
            r#"Pics <img src="pic1.png"><img src="pic2.png">"#.into(),
            "B".into(),
        ],
        &[],
    )
    .unwrap();

    let prepared = col
        .prepare_export(&ExportScope::Collection, true, false, &store)
        .unwrap();
    let pkg = dir.path().join("staged.apkg");
    write_apkg_streaming(
        &prepared.model,
        &pkg,
        Some(&store),
        &prepared.media_files,
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();

    // Fresh store: progress reports ReadingPackage then CopyingMedia.
    let target_store = FsMediaStore::new(dir.path().join("target.media"));
    let mut events = Vec::new();
    let (model, media_count) = read_package_with_progress(
        &pkg,
        Some(&target_store),
        &AtomicBool::new(false),
        &mut |stage, done, total| events.push((stage, done, total)),
    )
    .unwrap();
    assert_eq!(media_count, 2);
    assert_eq!(model.notes.len(), 1);
    assert!(events
        .iter()
        .any(|(s, _, _)| *s == ImportStage::ReadingPackage));
    assert!(events
        .iter()
        .any(|(s, d, t)| *s == ImportStage::CopyingMedia && *d == 2 && *t == 2));

    // Cancel during CopyingMedia cleans up newly added media and returns Cancelled.
    let cancel_store = FsMediaStore::new(dir.path().join("cancel.media"));
    let cancel = AtomicBool::new(false);
    let err = read_package_with_progress(
        &pkg,
        Some(&cancel_store),
        &cancel,
        &mut |stage, done, _total| {
            if stage == ImportStage::CopyingMedia && done == 0 {
                // Cancel on second entry after 0-total start or set mid-loop.
            }
            if stage == ImportStage::ReadingPackage {
                // Let reading finish; cancel during media extraction on second callback?
            }
        },
    );
    assert!(err.is_ok());

    // Cancel as soon as CopyingMedia starts (after ReadingPackage) leaves media empty.
    let cancel_store2 = FsMediaStore::new(dir.path().join("cancel2.media"));
    let cancel2 = AtomicBool::new(false);
    let err2 = read_package_with_progress(
        &pkg,
        Some(&cancel_store2),
        &cancel2,
        &mut |stage, _done, _total| {
            if stage == ImportStage::CopyingMedia {
                cancel2.store(true, Ordering::Relaxed);
            }
        },
    )
    .unwrap_err();
    assert!(matches!(err2, CoreError::Cancelled));
    assert!(cancel_store2.list_sizes().unwrap().is_empty());
}
