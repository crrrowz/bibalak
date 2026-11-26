//! End-to-end: synthesize a v11 .apkg, read it into the canonical model, and
//! import it into a fresh SQLite collection.

use bibalak_ankifmt::{read_package, read_package_with_media, testkit, write_apkg_with_media};
use bibalak_core::ports::*;
use bibalak_db::SqliteStorage;
use bibalak_media::FsMediaStore;

#[test]
fn reads_v11_package_and_imports() {
    let dir = tempfile::tempdir().unwrap();
    let apkg = dir.path().join("sample.apkg");
    testkit::write_sample_v11_apkg(&apkg).unwrap();

    let media_dir = dir.path().join("media");
    let (model, media) = read_package(&apkg, Some(&media_dir)).unwrap();

    assert_eq!(model.notetypes.len(), 1);
    assert_eq!(model.notetypes[0].name, "Basic");
    let nt_id = model.notetypes[0].id;
    assert_eq!(
        model
            .fields
            .iter()
            .filter(|f| f.notetype_id == nt_id)
            .count(),
        2
    );
    assert_eq!(
        model
            .templates
            .iter()
            .filter(|t| t.notetype_id == nt_id)
            .count(),
        1
    );
    assert_eq!(model.notes.len(), 2);
    assert_eq!(model.cards.len(), 2);
    assert_eq!(model.revlog.len(), 1);
    assert!(model.decks.iter().any(|d| d.name == "Spanish::Verbs"));

    assert_eq!(media, 1, "one media file extracted");
    assert!(media_dir.join("hola.png").exists());

    // Full pipeline: import the parsed model into a fresh collection.
    let storage = SqliteStorage::open_in_memory().unwrap();
    let summary = storage.import(&model, 1_000).unwrap();
    assert_eq!(summary.notes_added, 2);
    assert_eq!(summary.cards_added, 2);
    assert_eq!(summary.revlog_added, 1);
    assert!(summary.decks_added >= 2);
    assert_eq!(summary.notetypes_added, 1);
}

#[test]
fn reads_v18_package_and_imports() {
    let dir = tempfile::tempdir().unwrap();
    let apkg = dir.path().join("sample-v18.apkg");
    testkit::write_sample_v18_apkg(&apkg).unwrap();

    let media_dir = dir.path().join("media");
    let (model, media) = read_package(&apkg, Some(&media_dir)).unwrap();

    assert_eq!(model.notetypes.len(), 1);
    assert_eq!(model.notetypes[0].name, "Basic");
    let nt_id = model.notetypes[0].id;
    assert_eq!(
        model
            .fields
            .iter()
            .filter(|f| f.notetype_id == nt_id)
            .count(),
        2
    );

    // The template q/a formats come from the decoded protobuf config.
    let template = model
        .templates
        .iter()
        .find(|t| t.notetype_id == nt_id)
        .unwrap();
    assert_eq!(template.qfmt, "{{Front}}");
    assert!(template.afmt.contains("{{Back}}"));

    assert_eq!(model.notes.len(), 2);
    assert_eq!(model.cards.len(), 2);
    assert!(model.decks.iter().any(|d| d.name == "Spanish::Verbs"));

    assert_eq!(media, 1, "media extracted via the protobuf map");
    assert!(media_dir.join("hola.png").exists());

    let storage = SqliteStorage::open_in_memory().unwrap();
    let summary = storage.import(&model, 1_000).unwrap();
    assert_eq!(summary.notes_added, 2);
    assert_eq!(summary.cards_added, 2);
}

#[test]
fn importing_same_apkg_twice_creates_no_duplicate_media_files() {
    let dir = tempfile::tempdir().unwrap();
    let apkg = dir.path().join("sample.apkg");
    testkit::write_sample_v11_apkg(&apkg).unwrap();

    let store = FsMediaStore::new(dir.path().join("collection.media"));
    let (model1, count1) = read_package_with_media(&apkg, Some(&store)).unwrap();
    assert_eq!(count1, 1);
    assert_eq!(store.list().unwrap().len(), 1);

    let (model2, _) = read_package_with_media(&apkg, Some(&store)).unwrap();
    assert_eq!(store.list().unwrap().len(), 1);
    assert_eq!(store.list().unwrap()[0].filename, "hola.png");
    assert_eq!(model1.notes.len(), model2.notes.len());
}

#[test]
fn importing_colliding_media_renames_with_suffix_and_rewrites_note_ref() {
    let dir = tempfile::tempdir().unwrap();
    let apkg = dir.path().join("sample.apkg");
    testkit::write_sample_v11_apkg(&apkg).unwrap();

    let store = FsMediaStore::new(dir.path().join("collection.media"));
    // Pre-populate hola.png with different bytes.
    store.add("hola.png", b"different-existing-image").unwrap();

    let (model, count) = read_package_with_media(&apkg, Some(&store)).unwrap();
    assert_eq!(count, 1);

    let names: Vec<String> = store
        .list()
        .unwrap()
        .into_iter()
        .map(|e| e.filename)
        .collect();
    assert_eq!(names, vec!["hola-1.png", "hola.png"]);

    // Imported note referencing hola.png was rewritten to hola-1.png.
    assert!(
        model
            .notes
            .iter()
            .any(|n| n.fields.iter().any(|f| f.contains("hola-1.png"))),
        "expected imported note field to be rewritten to hola-1.png, got: {:?}",
        model.notes
    );
}

#[test]
fn export_apkg_via_media_store_uses_anki_valid_original_names() {
    let dir = tempfile::tempdir().unwrap();
    let apkg = dir.path().join("sample.apkg");
    testkit::write_sample_v11_apkg(&apkg).unwrap();

    let store = FsMediaStore::new(dir.path().join("collection.media"));
    let (model, _) = read_package_with_media(&apkg, Some(&store)).unwrap();

    let exported = dir.path().join("exported.apkg");
    let count = write_apkg_with_media(&model, &exported, Some(&store)).unwrap();
    assert_eq!(count, 1);

    let file = std::fs::File::open(&exported).unwrap();
    let mut zip = zip::ZipArchive::new(file).unwrap();
    let mut media_json = String::new();
    std::io::Read::read_to_string(&mut zip.by_name("media").unwrap(), &mut media_json).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&media_json).unwrap();
    assert_eq!(parsed["0"], "hola.png");
    assert!(zip.by_name("0").is_ok());
}

#[test]
fn import_preserves_calendar_dates_across_years_with_tz_and_rollover() {
    use bibalak_core::ports::FixedClock;
    use bibalak_core::Collection;
    use std::io::Write;
    use std::sync::Arc;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    // Anki collection created 2020-01-01 04:00:00 +03:00 (01:00 UTC)
    let anki_crt_sec: i64 = 1_577_840_400;
    // Bibalak collection created 2026-11-14 04:30:00 +03:00 (01:30 UTC), UTC+3, rollover 4
    let ks_now_ms: i64 = 1_794_619_800_000;
    // 2020-01-01 -> 2026-11-14 is 2509 days.
    let anki_today_day: i64 = 2509;
    // Learning card due 2026-11-14 10:00:00 +03:00 (later today, epoch sec)
    let learn_later_today_sec: i64 = 1_794_639_600;
    // Learning card due 2026-11-15 10:00:00 +03:00 (tomorrow, epoch sec)
    let learn_tomorrow_sec: i64 = 1_794_726_000;
    // Revlog on 2026-11-13 12:00:00 +03:00 (epoch ms)
    let revlog_yesterday_ms: i64 = 1_794_560_400_000;

    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("col.sqlite");
    {
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER, mod INTEGER, scm INTEGER, ver INTEGER,
                dty INTEGER, usn INTEGER, ls INTEGER, conf TEXT, models TEXT, decks TEXT, dconf TEXT, tags TEXT);
            CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, mod INTEGER, usn INTEGER,
                tags TEXT, flds TEXT, sfld TEXT, csum INTEGER, flags INTEGER, data TEXT);
            CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER,
                usn INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER,
                reps INTEGER, lapses INTEGER, left INTEGER, odue INTEGER, odid INTEGER, flags INTEGER, data TEXT);
            CREATE TABLE revlog (id INTEGER PRIMARY KEY, cid INTEGER, usn INTEGER, ease INTEGER, ivl INTEGER,
                lastIvl INTEGER, factor INTEGER, time INTEGER, type INTEGER);
            "#,
        )
        .unwrap();
        let models = serde_json::json!({
            "1": {
                "id": 1, "name": "Basic", "type": 0, "css": "",
                "flds": [{"name": "Front", "ord": 0}, {"name": "Back", "ord": 1}],
                "tmpls": [{"name": "Card 1", "ord": 0, "qfmt": "{{Front}}", "afmt": "{{Back}}"}]
            }
        })
        .to_string();
        let decks = serde_json::json!({
            "10": {"id": 10, "name": "MainDeck", "conf": 1},
            "20": {"id": 20, "name": "FilteredDeck", "conf": 1, "dyn": 1}
        })
        .to_string();
        let dconf = serde_json::json!({"1": {"id": 1, "name": "Default"}}).to_string();
        conn.execute(
            "INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
             VALUES (1, ?1, ?1, ?1, 11, 0, 0, 0, '{}', ?2, ?3, ?4, '{}')",
            rusqlite::params![anki_crt_sec, models, decks, dconf],
        )
        .unwrap();

        for i in 1..=8i64 {
            conn.execute(
                "INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
                 VALUES (?1, ?2, 1, ?3, -1, '', ?4, ?4, 0, 0, '')",
                rusqlite::params![
                    100 + i,
                    format!("guid-{i}"),
                    anki_crt_sec,
                    format!("Q{i}\u{1f}A{i}")
                ],
            )
            .unwrap();
        }
        // 1: review due today (2026-11-14 -> Anki day 2509)
        conn.execute(
            "INSERT INTO cards VALUES (1001, 101, 10, 0, 0, -1, 2, 2, ?1, 10, 2500, 3, 0, 0, 0, 0, 0, '')",
            [anki_today_day],
        ).unwrap();
        // 2: review due in 3 days (2026-11-17 -> Anki day 2512)
        conn.execute(
            "INSERT INTO cards VALUES (1002, 102, 10, 0, 0, -1, 2, 2, ?1, 10, 2500, 3, 0, 0, 0, 0, 0, '')",
            [anki_today_day + 3],
        ).unwrap();
        // 3: learning due later today (epoch seconds)
        conn.execute(
            "INSERT INTO cards VALUES (1003, 103, 10, 0, 0, -1, 1, 1, ?1, 0, 0, 1, 0, 1, 0, 0, 0, '')",
            [learn_later_today_sec],
        ).unwrap();
        // 4: learning due tomorrow (epoch seconds) -> must NOT be due today
        conn.execute(
            "INSERT INTO cards VALUES (1004, 104, 10, 0, 0, -1, 1, 1, ?1, 0, 0, 1, 0, 1, 0, 0, 0, '')",
            [learn_tomorrow_sec],
        ).unwrap();
        // 5: day-learn due today (2026-11-14 -> Anki day 2509)
        conn.execute(
            "INSERT INTO cards VALUES (1005, 105, 10, 0, 0, -1, 1, 3, ?1, 1, 0, 1, 0, 1, 0, 0, 0, '')",
            [anki_today_day],
        ).unwrap();
        // 6: day-learn due tomorrow (2026-11-15 -> Anki day 2510)
        conn.execute(
            "INSERT INTO cards VALUES (1006, 106, 10, 0, 0, -1, 1, 3, ?1, 1, 0, 1, 0, 1, 0, 0, 0, '')",
            [anki_today_day + 1],
        ).unwrap();
        // 7: new card at position 42
        conn.execute(
            "INSERT INTO cards VALUES (1007, 107, 10, 0, 0, -1, 0, 0, 42, 0, 0, 0, 0, 0, 0, 0, 0, '')",
            [],
        ).unwrap();
        // 8: review card inside filtered deck (did=20, odid=10, odue=2512 -> 2026-11-17)
        conn.execute(
            "INSERT INTO cards VALUES (1008, 108, 20, 0, 0, -1, 2, 2, 1, 10, 2500, 3, 0, 0, ?1, 10, 0, '')",
            [anki_today_day + 3],
        ).unwrap();

        conn.execute(
            "INSERT INTO revlog VALUES (?1, 1001, -1, 3, 10, 5, 2500, 1500, 1)",
            [revlog_yesterday_ms],
        )
        .unwrap();
    }

    // Write as .colpkg to verify .colpkg import leaves collection.created intact too
    let pkg_path = dir.path().join("handmade.colpkg");
    {
        let sqlite_bytes = std::fs::read(&db_path).unwrap();
        let file = std::fs::File::create(&pkg_path).unwrap();
        let mut zip = ZipWriter::new(file);
        let opts = SimpleFileOptions::default();
        zip.start_file("collection.anki2", opts).unwrap();
        zip.write_all(&sqlite_bytes).unwrap();
        zip.start_file("media", opts).unwrap();
        zip.write_all(b"{}").unwrap();
        zip.finish().unwrap();
    }

    let storage = SqliteStorage::open_in_memory().unwrap();
    let col = Collection::new(Box::new(storage), Arc::new(FixedClock(ks_now_ms))).unwrap();
    col.set_local_offset_minutes(180); // UTC+3, default rollover = 4

    let (model, _) = read_package(&pkg_path, None).unwrap();
    assert_eq!(model.created_ms, Some(anki_crt_sec * 1000));
    col.import(&model).unwrap();

    // .colpkg import must NOT overwrite Bibalak's collection.created
    let dumped = col.dump_collection().unwrap();
    // Day 0 start in UTC+3 rollover 4 for 2026-11-14 is 2026-11-14 04:00 +03:00 = 1_794_618_000_000
    assert_eq!(dumped.created_ms, Some(1_794_618_000_000));

    let decks = col.list_decks().unwrap();
    let main_deck = decks.iter().find(|d| d.name == "MainDeck").unwrap().id;
    let (new_due, learn_due, rev_due) = col.count_due_by_type(main_deck).unwrap();

    // New: card 7 (1)
    // Learning due today: card 3 (later today) + card 5 (day-learn today) = 2 (cards 4 & 6 are tomorrow)
    // Review due today: card 1 = 1 (card 2 is in 3 days)
    assert_eq!((new_due, learn_due, rev_due), (1, 2, 1));

    // Check forecast dates in Stats (today = 2026-11-14, future review = 2026-11-17)
    let stats = col.stats(Some(main_deck), None, 180).unwrap();
    assert_eq!(stats.today, 0);
    assert_eq!(stats.today_date, "2026-11-14");
    assert_eq!(stats.forecast.len(), 2);
    assert_eq!(stats.forecast[0].day, 0);
    assert_eq!(stats.forecast[0].date, "2026-11-14");
    assert_eq!(stats.forecast[1].day, 3);
    assert_eq!(stats.forecast[1].date, "2026-11-17");
    // Revlog on 2026-11-13 -> day -1, date "2026-11-13"
    assert_eq!(stats.reviews.len(), 1);
    assert_eq!(stats.reviews[0].date, "2026-11-13");

    // Check card details directly via dump_collection
    let by_guid = |guid: &str| {
        let note_id = dumped.notes.iter().find(|n| n.guid == guid).unwrap().id;
        dumped
            .cards
            .iter()
            .find(|c| c.note_id == note_id)
            .unwrap()
            .clone()
    };
    assert_eq!(by_guid("guid-1").due, 0);
    assert_eq!(by_guid("guid-2").due, 3);
    assert_eq!(by_guid("guid-3").queue, 1);
    assert_eq!(by_guid("guid-3").due, learn_later_today_sec * 1000);
    assert_eq!(by_guid("guid-4").due, learn_tomorrow_sec * 1000);
    // Day-learn converted to queue 1 at start of Anki day (04:00 +03:00)
    assert_eq!(by_guid("guid-5").queue, 1);
    assert_eq!(by_guid("guid-5").due, 1_794_618_000_000);
    assert_eq!(by_guid("guid-6").queue, 1);
    assert_eq!(by_guid("guid-6").due, 1_794_704_400_000);
    assert_eq!(by_guid("guid-7").due, 42);
    // Filtered deck card: odid remapped to main_deck, odue shifted to day 3 (2026-11-17)
    let c8 = by_guid("guid-8");
    assert_eq!(c8.original_deck_id, main_deck);
    assert_eq!(c8.original_due, 3);
}

#[test]
fn export_then_reimport_round_trip_keeps_calendar_dates() {
    use bibalak_ankifmt::write_apkg;
    use bibalak_core::model::{CanonicalModel, Card, Deck, Field, Note, Notetype, Template};
    use bibalak_core::ports::FixedClock;
    use bibalak_core::Collection;
    use std::sync::Arc;

    // Collection 1 created 2026-11-13 23:30 +03:00 (20:30 UTC), UTC+3, rollover 4 -> day 0 = 2026-11-13
    let col1_created_ms: i64 = 1_794_601_800_000;
    let storage1 = SqliteStorage::open_in_memory().unwrap();
    let col1 = Collection::new(Box::new(storage1), Arc::new(FixedClock(col1_created_ms))).unwrap();
    col1.set_local_offset_minutes(180);

    // 2026-11-13 (epoch day 20770) -> 2030-01-05 (epoch day 21919) = 1149 days.
    let learn_2030_ms: i64 = 1_893_481_200_000; // 2030-01-01 10:00:00 +03:00 (epoch day 21915)

    let seed = CanonicalModel {
        decks: vec![Deck {
            id: 10,
            name: "Study".into(),
            parent_id: None,
            config_id: 1,
            mod_ms: col1_created_ms,
            usn: -1,
            collapsed: false,
            is_filtered: false,
        }],
        notetypes: vec![Notetype {
            id: 10,
            name: "Basic".into(),
            kind: 0,
            mod_ms: col1_created_ms,
            usn: -1,
            config_json: "{}".into(),
        }],
        fields: vec![
            Field {
                notetype_id: 10,
                ord: 0,
                name: "Front".into(),
                config_json: "{}".into(),
            },
            Field {
                notetype_id: 10,
                ord: 1,
                name: "Back".into(),
                config_json: "{}".into(),
            },
        ],
        templates: vec![Template {
            notetype_id: 10,
            ord: 0,
            name: "Card 1".into(),
            qfmt: "{{Front}}".into(),
            afmt: "{{Back}}".into(),
            config_json: "{}".into(),
        }],
        notes: vec![
            Note {
                id: 1,
                guid: "rt-rev".into(),
                notetype_id: 10,
                mod_ms: col1_created_ms,
                usn: -1,
                tags: vec![],
                fields: vec!["r".into(), "a".into()],
                sort_field: Some("r".into()),
                checksum: None,
            },
            Note {
                id: 2,
                guid: "rt-learn".into(),
                notetype_id: 10,
                mod_ms: col1_created_ms,
                usn: -1,
                tags: vec![],
                fields: vec!["l".into(), "a".into()],
                sort_field: Some("l".into()),
                checksum: None,
            },
        ],
        cards: vec![
            Card {
                id: 11,
                note_id: 1,
                deck_id: 10,
                ord: 0,
                mod_ms: col1_created_ms,
                usn: -1,
                ctype: 2,
                queue: 2,
                due: 1149,
                interval: 10,
                ease_factor: 2500,
                reps: 1,
                lapses: 0,
                remaining: 0,
                original_due: 0,
                original_deck_id: 0,
                flags: 0,
                fsrs_stability: None,
                fsrs_difficulty: None,
                fsrs_last_review: None,
                data: None,
            },
            Card {
                id: 12,
                note_id: 2,
                deck_id: 10,
                ord: 0,
                mod_ms: col1_created_ms,
                usn: -1,
                ctype: 1,
                queue: 1,
                due: learn_2030_ms,
                interval: 0,
                ease_factor: 0,
                reps: 1,
                lapses: 0,
                remaining: 1,
                original_due: 0,
                original_deck_id: 0,
                flags: 0,
                fsrs_stability: None,
                fsrs_difficulty: None,
                fsrs_last_review: None,
                data: None,
            },
        ],
        ..Default::default()
    };
    col1.import(&seed).unwrap();

    // Export from col1
    let dir = tempfile::tempdir().unwrap();
    let exported_path = dir.path().join("roundtrip.apkg");
    let dumped1 = col1.dump_collection().unwrap();
    write_apkg(&dumped1, &exported_path, None).unwrap();

    // Import into Collection 2 created years later: 2030-01-01 04:30:00 +03:00 (01:30 UTC)
    let col2_created_ms: i64 = 1_893_461_400_000;
    let storage2 = SqliteStorage::open_in_memory().unwrap();
    let col2 = Collection::new(Box::new(storage2), Arc::new(FixedClock(col2_created_ms))).unwrap();
    col2.set_local_offset_minutes(180);

    let (re_read, _) = read_package(&exported_path, None).unwrap();
    col2.import(&re_read).unwrap();

    let study_deck = col2
        .list_decks()
        .unwrap()
        .into_iter()
        .find(|d| d.name == "Study")
        .unwrap()
        .id;
    let stats2 = col2.stats(Some(study_deck), None, 180).unwrap();
    assert_eq!(stats2.today, 0);
    assert_eq!(stats2.today_date, "2030-01-01");
    assert_eq!(stats2.forecast.len(), 1);
    assert_eq!(stats2.forecast[0].day, 4);
    assert_eq!(stats2.forecast[0].date, "2030-01-05");

    // Learning card due at 2030-01-01 10:00 +03:00 is due later today (1 learning card in col2)
    let (_, learn_due, rev_due) = col2.count_due_by_type(study_deck).unwrap();
    assert_eq!(learn_due, 1);
    assert_eq!(rev_due, 0);
}

#[test]
fn round_trips_field_options_and_sort_field_through_apkg() {
    use bibalak_core::model::{CanonicalModel, Deck, Field, Note, Notetype, Template};

    let model = CanonicalModel {
        decks: vec![Deck {
            id: 1,
            name: "Default".into(),
            parent_id: None,
            config_id: 1,
            mod_ms: 1_700_000_000_000,
            usn: -1,
            collapsed: false,
            is_filtered: false,
        }],
        notetypes: vec![Notetype {
            id: 10,
            name: "Arabic Vocab".into(),
            kind: 0,
            mod_ms: 1_700_000_000_000,
            usn: -1,
            config_json: r#"{"css":".card{font-size:18px;}","sortf":1}"#.into(),
        }],
        fields: vec![
            Field {
                notetype_id: 10,
                ord: 0,
                name: "Arabic".into(),
                config_json:
                    r#"{"rtl":true,"font":"Amiri","size":24,"description":"Arabic script"}"#.into(),
            },
            Field {
                notetype_id: 10,
                ord: 1,
                name: "English".into(),
                config_json: r#"{"rtl":false,"font":"Inter","size":16,"description":"Meaning"}"#
                    .into(),
            },
            Field {
                notetype_id: 10,
                ord: 2,
                name: "Notes".into(),
                config_json: r#"{"description":"Optional usage note"}"#.into(),
            },
        ],
        templates: vec![Template {
            notetype_id: 10,
            ord: 0,
            name: "Card 1".into(),
            qfmt: "{{Arabic}}".into(),
            afmt: "{{FrontSide}}<hr id=answer>{{English}}".into(),
            config_json: "{}".into(),
        }],
        notes: vec![Note {
            id: 100,
            guid: "g-arabic-1".into(),
            notetype_id: 10,
            mod_ms: 1_700_000_000_000,
            usn: -1,
            tags: vec![],
            fields: vec!["كتب".into(), "wrote".into(), "Form I".into()],
            sort_field: Some("wrote".into()),
            checksum: None,
        }],
        ..Default::default()
    };

    let dir = tempfile::tempdir().unwrap();
    let apkg = dir.path().join("field-options.apkg");
    bibalak_ankifmt::write_apkg(&model, &apkg, None).unwrap();

    let (parsed, _) = read_package(&apkg, None).unwrap();
    let nt = parsed
        .notetypes
        .iter()
        .find(|n| n.name == "Arabic Vocab")
        .unwrap();
    let nt_cfg: serde_json::Value = serde_json::from_str(&nt.config_json).unwrap();
    assert_eq!(nt_cfg.get("sortf").and_then(|v| v.as_i64()), Some(1));

    let f0 = parsed
        .fields
        .iter()
        .find(|f| f.notetype_id == nt.id && f.ord == 0)
        .unwrap();
    let f0_cfg: serde_json::Value = serde_json::from_str(&f0.config_json).unwrap();
    assert_eq!(f0_cfg.get("rtl").and_then(|v| v.as_bool()), Some(true));
    assert_eq!(f0_cfg.get("font").and_then(|v| v.as_str()), Some("Amiri"));
    assert_eq!(f0_cfg.get("size").and_then(|v| v.as_u64()), Some(24));
    assert_eq!(
        f0_cfg.get("description").and_then(|v| v.as_str()),
        Some("Arabic script")
    );

    let f1 = parsed
        .fields
        .iter()
        .find(|f| f.notetype_id == nt.id && f.ord == 1)
        .unwrap();
    let f1_cfg: serde_json::Value = serde_json::from_str(&f1.config_json).unwrap();
    assert_eq!(f1_cfg.get("rtl").and_then(|v| v.as_bool()), Some(false));
    assert_eq!(f1_cfg.get("font").and_then(|v| v.as_str()), Some("Inter"));
    assert_eq!(f1_cfg.get("size").and_then(|v| v.as_u64()), Some(16));
    assert_eq!(
        f1_cfg.get("description").and_then(|v| v.as_str()),
        Some("Meaning")
    );

    let f2 = parsed
        .fields
        .iter()
        .find(|f| f.notetype_id == nt.id && f.ord == 2)
        .unwrap();
    let f2_cfg: serde_json::Value = serde_json::from_str(&f2.config_json).unwrap();
    assert!(f2_cfg.get("rtl").is_none());
    assert_eq!(
        f2_cfg.get("description").and_then(|v| v.as_str()),
        Some("Optional usage note")
    );
}

#[test]
fn importing_apkg_with_only_subdeck_creates_missing_parent_hierarchy() {
    let dir = tempfile::tempdir().unwrap();
    let apkg = dir.path().join("subdeck_only.apkg");
    testkit::write_subdeck_only_apkg(&apkg, "Book::Part I").unwrap();

    let (model, _media) = read_package(&apkg, None).unwrap();
    let storage = SqliteStorage::open_in_memory().unwrap();
    let summary = storage.import(&model, 1_000).unwrap();

    assert_eq!(summary.notes_added, 1);
    assert_eq!(summary.cards_added, 1);

    // Look up ids after import (ids are remapped)
    let book = storage
        .deck_by_name("Book")
        .unwrap()
        .expect("Book parent deck must exist after import");
    let part1 = storage
        .deck_by_name("Book::Part I")
        .unwrap()
        .expect("Book::Part I deck must exist after import");

    assert_eq!(
        part1.parent_id,
        Some(book.id),
        "Book::Part I parent_id must link to Book"
    );
}

#[test]
fn apkg_export_excludes_all_productivity_tables() {
    use std::io::Read;

    use bibalak_core::productivity::{TaskItem, TaskPriority};
    use bibalak_core::progress::NIL_USER_ID;

    let storage = SqliteStorage::open_in_memory().unwrap();
    storage.ensure_collection(1_700_000_000_000).unwrap();
    storage
        .upsert_task(&TaskItem {
            id: "22222222-2222-4222-8222-222222222222".into(),
            user_id: NIL_USER_ID.into(),
            list_id: None,
            title: "Never exported to apkg".into(),
            notes: String::new(),
            priority: TaskPriority::High,
            manual_quadrant: None,
            due_date: None,
            scheduled_start_ms: None,
            scheduled_end_ms: None,
            tags: vec![],
            deck_id: None,
            completed_at: None,
            completed_day: None,
            sort_order: 0,
            created_at: 1_000,
            updated_at: 1_000,
            deleted_at: None,
            usn: -1,
        })
        .unwrap();

    let model = storage.dump_collection().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let apkg = dir.path().join("isolated.apkg");
    bibalak_ankifmt::write_apkg(&model, &apkg, None).unwrap();

    let file = std::fs::File::open(&apkg).unwrap();
    let mut zip = zip::ZipArchive::new(file).unwrap();
    let mut sqlite_entry = zip.by_name("collection.anki2").unwrap();
    let mut bytes = Vec::new();
    sqlite_entry.read_to_end(&mut bytes).unwrap();
    let db_path = dir.path().join("extracted.anki2");
    std::fs::write(&db_path, bytes).unwrap();

    let conn = rusqlite::Connection::open(&db_path).unwrap();
    for table in [
        "task_lists",
        "tasks",
        "matrix_quadrants",
        "habits",
        "habit_logs",
        "calendar_events",
    ] {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, ".apkg must not contain {table}");
    }
}

#[test]
fn apkg_export_excludes_keepsake_preset_from_models() {
    use std::io::Read;

    use bibalak_core::notetype_preset::{LayoutId, NotetypePreset, KEEPSAKE_PRESET_CONFIG_KEY};
    use bibalak_core::{Collection, SystemClock};
    use std::sync::Arc;

    let storage = SqliteStorage::open_in_memory().unwrap();
    storage.ensure_collection(1_700_000_000_000).unwrap();
    let nt_id = storage
        .create_notetype("PresetVocab", 0, 1_700_000_000_000)
        .unwrap();
    storage
        .rename_field(nt_id, 0, "Word", 1_700_000_000_100)
        .unwrap();
    storage
        .rename_field(nt_id, 1, "Meaning", 1_700_000_000_100)
        .unwrap();
    storage
        .add_note_with_cards(
            nt_id,
            1,
            &["سلام".into(), "peace".into()],
            &[],
            1_700_000_000_200,
        )
        .unwrap();

    let col = Collection::new(Box::new(storage), Arc::new(SystemClock)).unwrap();
    let preset = NotetypePreset::for_layout(LayoutId::LanguageCard);
    let detail = col.save_notetype_preset(nt_id, preset).unwrap();
    assert!(detail.preset.is_some());

    let model = col.dump_collection().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let apkg = dir.path().join("preset-export.apkg");
    bibalak_ankifmt::write_apkg(&model, &apkg, None).unwrap();

    let file = std::fs::File::open(&apkg).unwrap();
    let mut zip = zip::ZipArchive::new(file).unwrap();
    let mut sqlite_entry = zip.by_name("collection.anki2").unwrap();
    let mut bytes = Vec::new();
    sqlite_entry.read_to_end(&mut bytes).unwrap();
    let db_path = dir.path().join("extracted.anki2");
    std::fs::write(&db_path, bytes).unwrap();

    let conn = rusqlite::Connection::open(&db_path).unwrap();
    let models_json: String = conn
        .query_row("SELECT models FROM col LIMIT 1", [], |r| r.get(0))
        .unwrap();
    assert!(
        !models_json.contains(KEEPSAKE_PRESET_CONFIG_KEY),
        "exported Anki models JSON must not contain keepsakePreset: {models_json}"
    );
    let models: serde_json::Value = serde_json::from_str(&models_json).unwrap();
    for entry in models.as_object().unwrap().values() {
        assert!(entry.get(KEEPSAKE_PRESET_CONFIG_KEY).is_none());
    }
}

#[test]
fn apkg_import_export_round_trip_is_lossless() {
    let dir = tempfile::tempdir().unwrap();
    let src_apkg = dir.path().join("source.apkg");
    testkit::write_sample_v11_apkg(&src_apkg).unwrap();

    let (imported_model, _) = read_package(&src_apkg, None).unwrap();
    let storage = SqliteStorage::open_in_memory().unwrap();
    storage.import(&imported_model, 1_700_000_000_000).unwrap();

    // Opening every note type in the editor must never mutate templates or CSS
    for nt in storage.list_notetypes().unwrap() {
        let _ = storage.get_notetype_detail(nt.id).unwrap();
    }

    let exported_model = storage.dump_collection().unwrap();
    let out_apkg = dir.path().join("roundtrip.apkg");
    bibalak_ankifmt::write_apkg(&exported_model, &out_apkg, None).unwrap();

    let (reimported_model, _) = read_package(&out_apkg, None).unwrap();
    assert_eq!(
        reimported_model.notetypes.len(),
        imported_model.notetypes.len()
    );
    for (orig_nt, rt_nt) in imported_model
        .notetypes
        .iter()
        .zip(reimported_model.notetypes.iter())
    {
        assert_eq!(rt_nt.name, orig_nt.name);
        assert_eq!(rt_nt.kind, orig_nt.kind);
        let orig_tmpls: Vec<_> = imported_model
            .templates
            .iter()
            .filter(|t| t.notetype_id == orig_nt.id)
            .map(|t| (&t.name, &t.qfmt, &t.afmt))
            .collect();
        let rt_tmpls: Vec<_> = reimported_model
            .templates
            .iter()
            .filter(|t| t.notetype_id == rt_nt.id)
            .map(|t| (&t.name, &t.qfmt, &t.afmt))
            .collect();
        assert_eq!(rt_tmpls, orig_tmpls);
    }
    assert_eq!(reimported_model.notes.len(), imported_model.notes.len());
    assert_eq!(reimported_model.cards.len(), imported_model.cards.len());
}
