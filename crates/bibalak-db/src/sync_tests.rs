//! Sync write-path tests.
//! Pins down sync markers (`mod`, `usn`, `graves`, `schema_mod`) on every write path.

use bibalak_core::error::CoreError;
use bibalak_core::model::*;
use bibalak_core::ports::*;
use rusqlite::OptionalExtension;

use super::browse::change_note_type;
use super::notetype::{
    add_template, create_notetype, rename_field, rename_notetype, save_field_options,
    save_notetype_css, save_template,
};
use super::search::delete_notes;
use super::stock::add_stock;
use super::storage::SqliteStorage;
use super::study::{apply_answer, get_deck_config, set_deck_config, set_deck_limits, undo_answer};
use super::tags::{delete_tag, rename_tag};

fn setup_db() -> (SqliteStorage, i64, i64, i64) {
    let s = SqliteStorage::open_in_memory().unwrap();
    let now_ms = 1_700_000_000_000;
    s.ensure_collection(now_ms).unwrap();

    let model = CanonicalModel {
        deck_configs: vec![DeckConfig {
            id: 1,
            name: "Default".into(),
            mod_ms: now_ms,
            usn: 0,
            config_json: "{}".into(),
        }],
        decks: vec![Deck {
            id: 1,
            name: "Default".into(),
            parent_id: None,
            config_id: 1,
            mod_ms: now_ms,
            usn: 0,
            collapsed: false,
            is_filtered: false,
        }],
        notetypes: vec![Notetype {
            id: 1,
            name: "Basic".into(),
            kind: 0,
            mod_ms: now_ms,
            usn: 0,
            config_json: "{}".into(),
        }],
        fields: vec![
            Field {
                notetype_id: 1,
                ord: 0,
                name: "Front".into(),
                config_json: "{}".into(),
            },
            Field {
                notetype_id: 1,
                ord: 1,
                name: "Back".into(),
                config_json: "{}".into(),
            },
        ],
        templates: vec![Template {
            notetype_id: 1,
            ord: 0,
            name: "Card 1".into(),
            qfmt: "{{Front}}".into(),
            afmt: "{{FrontSide}}<hr id=answer>{{Back}}".into(),
            config_json: "{}".into(),
        }],
        notes: vec![Note {
            id: 100,
            guid: "guid100000".into(),
            notetype_id: 1,
            mod_ms: now_ms,
            usn: 0,
            tags: vec!["tag1".into(), "leech".into()],
            fields: vec!["Hello Front".into(), "World Back".into()],
            sort_field: Some("Hello Front".into()),
            checksum: None,
        }],
        cards: vec![Card {
            id: 1000,
            note_id: 100,
            deck_id: 1,
            ord: 0,
            mod_ms: now_ms,
            usn: 0,
            ctype: 0,
            queue: 0,
            due: 1,
            interval: 0,
            ease_factor: 2500,
            reps: 0,
            lapses: 0,
            remaining: 0,
            original_due: 0,
            original_deck_id: 0,
            flags: 0,
            fsrs_stability: None,
            fsrs_difficulty: None,
            fsrs_last_review: None,
            data: None,
        }],
        revlog: vec![],
        created_ms: Some(now_ms),
    };
    s.import(&model, now_ms).unwrap();

    let nt_id: i64 = s
        .lock()
        .query_row("SELECT id FROM notetypes WHERE name = 'Basic'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let note_id: i64 = s
        .lock()
        .query_row(
            "SELECT id FROM notes WHERE notetype_id = ?1",
            [nt_id],
            |r| r.get(0),
        )
        .unwrap();
    let card_id: i64 = s
        .lock()
        .query_row("SELECT id FROM cards WHERE note_id = ?1", [note_id], |r| {
            r.get(0)
        })
        .unwrap();

    // Reset usn on all rows to 0 to simulate clean synced state
    {
        let conn = s.lock();
        conn.execute("UPDATE collection SET usn = 0", []).unwrap();
        conn.execute("UPDATE deck_config SET usn = 0", []).unwrap();
        conn.execute("UPDATE decks SET usn = 0", []).unwrap();
        conn.execute("UPDATE notetypes SET usn = 0", []).unwrap();
        conn.execute("UPDATE notes SET usn = 0", []).unwrap();
        conn.execute("UPDATE cards SET usn = 0", []).unwrap();
    }

    (s, nt_id, note_id, card_id)
}

#[test]
fn test_rename_notetype_marks_dirty_without_bumping_schema_mod() {
    let (s, nt_id, _, _) = setup_db();
    let initial_scm: i64 = s
        .lock()
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();

    let now_ms = 1_700_000_050_000;
    rename_notetype(&s.lock(), nt_id, "Basic Renamed", now_ms).unwrap();

    let conn = s.lock();
    let updated_scm: i64 = conn
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        updated_scm, initial_scm,
        "rename_notetype is cosmetic and must NOT bump collection.schema_mod"
    );

    let (mod_ms, usn): (i64, i64) = conn
        .query_row(
            r#"SELECT "mod", usn FROM notetypes WHERE id = ?1"#,
            [nt_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(mod_ms, now_ms, "rename_notetype must update notetypes.mod");
    assert_eq!(
        usn, -1,
        "rename_notetype must mark notetype dirty with usn = -1"
    );
}

#[test]
fn test_save_template_marks_dirty_without_bumping_schema_mod() {
    let (s, nt_id, _, _) = setup_db();
    let initial_scm: i64 = s
        .lock()
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();

    let now_ms = 1_700_000_060_000;
    save_template(
        &s.lock(),
        nt_id,
        0,
        "Card 1 Updated",
        "{{Front}}<br>extra",
        "{{FrontSide}}<hr id=answer>{{Back}}",
        now_ms,
    )
    .unwrap();

    let conn = s.lock();
    let updated_scm: i64 = conn
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        updated_scm, initial_scm,
        "save_template (cosmetic format edit) must NOT bump collection.schema_mod"
    );

    let (mod_ms, usn): (i64, i64) = conn
        .query_row(
            r#"SELECT "mod", usn FROM notetypes WHERE id = ?1"#,
            [nt_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(mod_ms, now_ms, "save_template must update notetypes.mod");
    assert_eq!(
        usn, -1,
        "save_template must mark notetype dirty with usn = -1"
    );
}

#[test]
fn test_add_stock_marks_dirty_without_bumping_schema_mod() {
    let (s, _, _, _) = setup_db();
    let initial_scm: i64 = s
        .lock()
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();

    let now_ms = 1_700_000_070_000;
    let added_id = add_stock(&s.lock(), 1, now_ms).unwrap();

    let conn = s.lock();
    let updated_scm: i64 = conn
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        updated_scm, initial_scm,
        "add_stock must NOT bump collection.schema_mod"
    );

    let (mod_ms, usn): (i64, i64) = conn
        .query_row(
            r#"SELECT "mod", usn FROM notetypes WHERE id = ?1"#,
            [added_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(mod_ms, now_ms, "add_stock must set notetypes.mod = now");
    assert_eq!(usn, -1, "add_stock must set notetypes.usn = -1");
}

#[test]
fn test_cosmetic_notetype_edits_do_not_bump_schema_mod() {
    let (s, nt_id, _, _) = setup_db();
    let initial_scm: i64 = s
        .lock()
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();

    let now_ms = 1_700_000_075_000;
    // 1. save_notetype_css
    save_notetype_css(&s.lock(), nt_id, ".card { font-size: 20px; }", now_ms).unwrap();
    let scm1: i64 = s
        .lock()
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        scm1, initial_scm,
        "save_notetype_css must NOT bump schema_mod"
    );

    // 2. rename_field
    {
        let mut conn = s.lock();
        let tx = conn.transaction().unwrap();
        rename_field(&tx, nt_id, 0, "Front Renamed", now_ms).unwrap();
        tx.commit().unwrap();
    }
    let scm2: i64 = s
        .lock()
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(scm2, initial_scm, "rename_field must NOT bump schema_mod");

    // 3. save_field_options
    {
        let mut conn = s.lock();
        let tx = conn.transaction().unwrap();
        save_field_options(
            &tx,
            nt_id,
            0,
            &bibalak_core::ipc::FieldOptions {
                direction: bibalak_core::ipc::FieldDirection::Ltr,
                font: "Arial".into(),
                size: 14,
                description: "".into(),
            },
            now_ms,
        )
        .unwrap();
        tx.commit().unwrap();
    }
    let scm3: i64 = s
        .lock()
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        scm3, initial_scm,
        "save_field_options must NOT bump schema_mod"
    );

    // 4. create_notetype
    let new_nt = {
        let mut conn = s.lock();
        let tx = conn.transaction().unwrap();
        let id = create_notetype(&tx, "Custom", 0, now_ms).unwrap();
        tx.commit().unwrap();
        id
    };
    let scm4: i64 = s
        .lock()
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        scm4, initial_scm,
        "create_notetype must NOT bump schema_mod"
    );
    let (mod_ms, usn): (i64, i64) = s
        .lock()
        .query_row(
            r#"SELECT "mod", usn FROM notetypes WHERE id = ?1"#,
            [new_nt],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(mod_ms, now_ms);
    assert_eq!(usn, -1);
}

#[test]
fn test_change_note_type_bumps_schema_mod() {
    let (s, _nt_id, note_id, _) = setup_db();
    let now_ms = 1_700_000_078_000;
    let target_nt = {
        let mut conn = s.lock();
        let tx = conn.transaction().unwrap();
        // create_notetype creates 2 fields (Front, Back) and 1 template (Card 1)
        let id = create_notetype(&tx, "TargetNT", 0, now_ms).unwrap();
        tx.commit().unwrap();
        id
    };

    let before_change_scm: i64 = s
        .lock()
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();

    let change_time = now_ms + 10_000;
    let mut conn = s.lock();
    change_note_type(
        &mut conn,
        &[note_id],
        target_nt,
        &[Some(0), Some(1)],
        &[(0, Some(0))],
        change_time,
    )
    .unwrap();

    let updated_scm: i64 = conn
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        updated_scm, change_time,
        "change_note_type MUST bump collection.schema_mod (structural change)"
    );
    assert_ne!(updated_scm, before_change_scm);
}

#[test]
fn test_bury_and_unbury_mark_cards_dirty() {
    let (s, _, note_id, card_id) = setup_db();

    // 1. bury_cards
    let t1 = 1_700_000_200_000;
    s.bury_cards(&[card_id], t1).unwrap();
    let (m, u, q): (i64, i64, i64) = s
        .lock()
        .query_row(
            r#"SELECT "mod", usn, queue FROM cards WHERE id = ?1"#,
            [card_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(q, -2);
    assert_eq!(m, t1, "bury_cards must update cards.mod");
    assert_eq!(u, -1, "bury_cards must mark cards dirty with usn = -1");

    // Clean sync status
    s.lock().execute("UPDATE cards SET usn = 0", []).unwrap();

    // 2. unbury_cards
    let t2 = 1_700_000_210_000;
    s.unbury_cards(&[card_id], t2).unwrap();
    let (m, u, q): (i64, i64, i64) = s
        .lock()
        .query_row(
            r#"SELECT "mod", usn, queue FROM cards WHERE id = ?1"#,
            [card_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(q, 0);
    assert_eq!(m, t2, "unbury_cards must update cards.mod");
    assert_eq!(u, -1, "unbury_cards must mark cards dirty with usn = -1");

    // 3. bury_siblings
    s.lock()
        .execute(
            r#"INSERT INTO cards (note_id, deck_id, ord, "mod", usn, type, queue, due, interval, ease_factor, reps, lapses, remaining, original_due, original_deck_id, flags)
               VALUES (?1, 1, 1, 0, 0, 0, 0, 1, 0, 2500, 0, 0, 0, 0, 0, 0)"#,
            [note_id],
        )
        .unwrap();
    let sib_id: i64 = s.lock().last_insert_rowid();
    s.lock().execute("UPDATE cards SET usn = 0", []).unwrap();

    let t3 = 1_700_000_220_000;
    s.bury_siblings(note_id, card_id, t3).unwrap();
    let (m, u, q): (i64, i64, i64) = s
        .lock()
        .query_row(
            r#"SELECT "mod", usn, queue FROM cards WHERE id = ?1"#,
            [sib_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(q, -3);
    assert_eq!(m, t3, "bury_siblings must update cards.mod");
    assert_eq!(u, -1, "bury_siblings must mark cards dirty with usn = -1");

    // 4. unbury_deck
    s.lock().execute("UPDATE cards SET usn = 0", []).unwrap();
    let t4 = 1_700_000_230_000;
    s.unbury_deck(1, t4).unwrap();
    let (m, u, q): (i64, i64, i64) = s
        .lock()
        .query_row(
            r#"SELECT "mod", usn, queue FROM cards WHERE id = ?1"#,
            [sib_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(q, 0);
    assert_eq!(m, t4, "unbury_deck must update cards.mod");
    assert_eq!(u, -1, "unbury_deck must mark cards dirty with usn = -1");

    // 5. unbury_all
    s.bury_cards(&[card_id], t4).unwrap();
    s.lock().execute("UPDATE cards SET usn = 0", []).unwrap();
    let t5 = 1_700_000_240_000;
    s.unbury_all(t5).unwrap();
    let (m, u, q): (i64, i64, i64) = s
        .lock()
        .query_row(
            r#"SELECT "mod", usn, queue FROM cards WHERE id = ?1"#,
            [card_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(q, 0);
    assert_eq!(m, t5, "unbury_all must update cards.mod");
    assert_eq!(u, -1, "unbury_all must mark cards dirty with usn = -1");
}

#[test]
fn test_import_notes_get_mod_now_and_relinked_deck_marked_dirty() {
    let s = SqliteStorage::open_in_memory().unwrap();
    let t0 = 1_700_000_000_000;
    s.ensure_collection(t0).unwrap();

    let parent = s.create_deck("Lang", t0).unwrap();
    let child = s.create_deck("Lang::German", t0).unwrap();
    s.lock()
        .execute(
            "UPDATE decks SET parent_id = NULL, usn = 0 WHERE id = ?1",
            [child.id],
        )
        .unwrap();
    s.lock()
        .execute("UPDATE collection SET usn = 0", [])
        .unwrap();

    let import_time = 1_700_000_300_000;
    let file_mod = 1_600_000_000_000;
    let model = CanonicalModel {
        deck_configs: vec![],
        decks: vec![
            Deck {
                id: parent.id,
                name: "Lang".into(),
                parent_id: None,
                config_id: 1,
                mod_ms: file_mod,
                usn: 0,
                collapsed: false,
                is_filtered: false,
            },
            Deck {
                id: child.id,
                name: "Lang::German".into(),
                parent_id: Some(parent.id),
                config_id: 1,
                mod_ms: file_mod,
                usn: 0,
                collapsed: false,
                is_filtered: false,
            },
        ],
        notetypes: vec![Notetype {
            id: 1,
            name: "Basic".into(),
            kind: 0,
            mod_ms: file_mod,
            usn: 0,
            config_json: "{}".into(),
        }],
        fields: vec![Field {
            notetype_id: 1,
            ord: 0,
            name: "Front".into(),
            config_json: "{}".into(),
        }],
        templates: vec![Template {
            notetype_id: 1,
            ord: 0,
            name: "T1".into(),
            qfmt: "{{Front}}".into(),
            afmt: "{{Front}}".into(),
            config_json: "{}".into(),
        }],
        notes: vec![Note {
            id: 50,
            guid: "guid_imp_1".into(),
            notetype_id: 1,
            mod_ms: file_mod,
            usn: 0,
            tags: vec![],
            fields: vec!["Hello".into()],
            sort_field: Some("Hello".into()),
            checksum: None,
        }],
        cards: vec![Card {
            id: 500,
            note_id: 50,
            deck_id: child.id,
            ord: 0,
            mod_ms: file_mod,
            usn: 0,
            ctype: 0,
            queue: 0,
            due: 1,
            interval: 0,
            ease_factor: 2500,
            reps: 0,
            lapses: 0,
            remaining: 0,
            original_due: 0,
            original_deck_id: 0,
            flags: 0,
            fsrs_stability: None,
            fsrs_difficulty: None,
            fsrs_last_review: None,
            data: None,
        }],
        revlog: vec![],
        created_ms: Some(t0),
    };

    s.import(&model, import_time).unwrap();

    let conn = s.lock();
    let note_mod: i64 = conn
        .query_row(
            r#"SELECT "mod" FROM notes WHERE guid = 'guid_imp_1'"#,
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        note_mod, import_time,
        "imported note must get mod = now_ms, not file mod"
    );

    let (d_parent, d_mod, d_usn): (Option<i64>, i64, i64) = conn
        .query_row(
            r#"SELECT parent_id, "mod", usn FROM decks WHERE id = ?1"#,
            [child.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        d_parent,
        Some(parent.id),
        "child deck must be re-linked to parent"
    );
    assert_eq!(d_mod, import_time, "re-linked deck must have mod = now_ms");
    assert_eq!(
        d_usn, -1,
        "re-linked deck must be marked dirty with usn = -1"
    );
}

#[test]
fn test_delete_notes_writes_card_and_note_graves_without_bumping_schema_mod() {
    let (s, _, note_id, card_id) = setup_db();
    let initial_scm: i64 = s
        .lock()
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();

    let now_ms = 1_700_000_080_000;
    delete_notes(&s.lock(), &[note_id], now_ms).unwrap();

    let conn = s.lock();
    // 1. Verify card grave (type 0) was written
    let card_grave: Option<(i64, i64)> = conn
        .query_row(
            "SELECT oid, usn FROM graves WHERE oid = ?1 AND type = 0",
            [card_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .unwrap();
    assert_eq!(
        card_grave,
        Some((card_id, -1)),
        "delete_notes must write a grave for every deleted card (type 0, usn -1)"
    );

    // 2. Verify note grave (type 1) was written
    let note_grave: Option<(i64, i64)> = conn
        .query_row(
            "SELECT oid, usn FROM graves WHERE oid = ?1 AND type = 1",
            [note_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .unwrap();
    assert_eq!(
        note_grave,
        Some((note_id, -1)),
        "delete_notes must write a grave for every deleted note (type 1, usn -1)"
    );

    // 3. Verify collection.schema_mod was NOT bumped (note deletion is not a schema change)
    let updated_scm: i64 = conn
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        updated_scm, initial_scm,
        "delete_notes must NOT bump schema_mod (it delta syncs via graves)"
    );

    // 4. Verify collection.modified was updated
    let col_mod: i64 = conn
        .query_row("SELECT modified FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        col_mod, now_ms,
        "delete_notes must update collection.modified"
    );
}

#[test]
fn test_move_cards_to_deck_marks_cards_dirty() {
    let (s, _, _, card_id) = setup_db();
    let new_deck = s.create_deck("Target Deck", 1_700_000_090_000).unwrap();

    let now_ms: i64 = 1_700_000_095_000;
    s.move_cards_to_deck(&[card_id], new_deck.id, now_ms)
        .unwrap();

    let (usn, deck_id): (i64, i64) = s
        .lock()
        .query_row(
            r#"SELECT usn, deck_id FROM cards WHERE id = ?1"#,
            [card_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(deck_id, new_deck.id);
    assert_eq!(
        usn, -1,
        "move_cards_to_deck must mark moved cards dirty with usn = -1"
    );
}

#[test]
fn test_suspend_and_unsuspend_cards_mark_cards_dirty() {
    let (s, _, _, card_id) = setup_db();

    let now_ms = 1_700_000_100_000;
    // 1. Suspend
    s.suspend_cards(&[card_id], now_ms).unwrap();
    let (usn, queue): (i64, i64) = s
        .lock()
        .query_row(
            r#"SELECT usn, queue FROM cards WHERE id = ?1"#,
            [card_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(queue, -1);
    assert_eq!(usn, -1, "suspend_cards must mark cards dirty with usn = -1");

    // Clean sync status
    s.lock()
        .execute("UPDATE cards SET usn = 0 WHERE id = ?1", [card_id])
        .unwrap();

    // 2. Unsuspend
    s.unsuspend_cards(&[card_id], now_ms).unwrap();
    let (usn, queue): (i64, i64) = s
        .lock()
        .query_row(
            r#"SELECT usn, queue FROM cards WHERE id = ?1"#,
            [card_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(queue, 0);
    assert_eq!(
        usn, -1,
        "unsuspend_cards must mark cards dirty with usn = -1"
    );
}

#[test]
fn test_set_card_flag_marks_cards_dirty() {
    let (s, _, _, card_id) = setup_db();

    s.set_card_flag(&[card_id], 3, 1_700_000_110_000).unwrap();

    let (usn, flags): (i64, i64) = s
        .lock()
        .query_row(
            r#"SELECT usn, flags FROM cards WHERE id = ?1"#,
            [card_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(flags, 3);
    assert_eq!(usn, -1, "set_card_flag must mark cards dirty with usn = -1");
}

#[test]
fn test_filtered_deck_empty_and_gather_mark_cards_dirty() {
    let (s, _, _, card_id) = setup_db();
    let now_ms = 1_700_000_130_000;
    let fdeck =
        super::filtered::create_filtered_deck(&s.lock(), "Filtered", "tag:tag1", 0, 100, 0, now_ms)
            .unwrap();

    // Verify gathered card has usn = -1
    let (usn_gathered, deck_id): (i64, i64) = s
        .lock()
        .query_row(
            "SELECT usn, deck_id FROM cards WHERE id = ?1",
            [card_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(deck_id, fdeck.id);
    assert_eq!(
        usn_gathered, -1,
        "gather_cards must mark cards moved to filtered deck with usn = -1"
    );

    // Clean sync status
    s.lock()
        .execute("UPDATE cards SET usn = 0 WHERE id = ?1", [card_id])
        .unwrap();

    // Empty filtered deck
    let now_empty = 1_700_000_140_000;
    super::filtered::empty_filtered(&s.lock(), fdeck.id, now_empty).unwrap();

    let (usn_emptied, deck_id): (i64, i64) = s
        .lock()
        .query_row(
            "SELECT usn, deck_id FROM cards WHERE id = ?1",
            [card_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(deck_id, 1);
    assert_eq!(
        usn_emptied, -1,
        "empty_filtered must mark cards returned from filtered deck with usn = -1"
    );
}

#[test]
fn test_save_deck_limits_and_sched_config_mark_deck_config_dirty() {
    let (s, _, _, _) = setup_db();

    // 1. set_deck_limits
    let now_ms = 1_700_000_150_000;
    set_deck_limits(&s.lock(), 1, 30, 150, now_ms).unwrap();
    let usn_limits: i64 = s
        .lock()
        .query_row("SELECT usn FROM deck_config WHERE id = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        usn_limits, -1,
        "set_deck_limits must set deck_config.usn = -1"
    );

    // Clean sync status
    s.lock()
        .execute("UPDATE deck_config SET usn = 0 WHERE id = 1", [])
        .unwrap();

    // 2. set_deck_config
    let now_sched = 1_700_000_160_000;
    let cfg = get_deck_config(&s.lock(), 1).unwrap();
    set_deck_config(&s.lock(), 1, &cfg, now_sched).unwrap();
    let usn_sched: i64 = s
        .lock()
        .query_row("SELECT usn FROM deck_config WHERE id = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        usn_sched, -1,
        "set_deck_config must set deck_config.usn = -1"
    );
}

#[test]
fn test_undo_answer_updates_card_mod_and_note_mod() {
    let (s, _, note_id, card_id) = setup_db();
    let now_answer = 1_700_000_170_000;

    let next_state = bibalak_core::scheduling::CardState {
        phase: bibalak_core::scheduling::CardPhase::Review,
        interval_days: 1,
        ease_milli: 2500,
        difficulty: None,
        stability: None,
        reps: 1,
        lapses: 0,
        steps_remaining: 0,
        last_review_day: Some(0),
    };
    let revlog = Revlog {
        id: now_answer,
        card_id,
        usn: 0,
        ease: 3,
        interval: 1,
        last_interval: 0,
        ease_factor: 2500,
        taken_ms: 1000,
        review_kind: 0,
    };
    apply_answer(
        &s.lock().transaction().unwrap(),
        card_id,
        &next_state,
        1,
        &revlog,
        None,
    )
    .unwrap();

    // Clean sync status before undo
    s.lock()
        .execute(
            r#"UPDATE cards SET "mod" = 1000, usn = 0 WHERE id = ?1"#,
            [card_id],
        )
        .unwrap();
    s.lock()
        .execute(
            r#"UPDATE notes SET "mod" = 1000, usn = 0 WHERE id = ?1"#,
            [note_id],
        )
        .unwrap();

    let prev_state = bibalak_core::scheduling::CardState {
        phase: bibalak_core::scheduling::CardPhase::New,
        interval_days: 0,
        ease_milli: 2500,
        difficulty: None,
        stability: None,
        reps: 0,
        lapses: 0,
        steps_remaining: 0,
        last_review_day: None,
    };
    let now_undo: i64 = 1_700_000_180_000;
    undo_answer(
        &mut s.lock(),
        card_id,
        &prev_state,
        1,
        now_answer,
        &[],
        Some(note_id),
        None,
        now_undo,
    )
    .unwrap();

    let (card_mod, card_usn): (i64, i64) = s
        .lock()
        .query_row(
            r#"SELECT "mod", usn FROM cards WHERE id = ?1"#,
            [card_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_ne!(
        card_mod, 1000,
        "undo_answer must update cards.mod to current timestamp"
    );
    assert_eq!(card_usn, -1, "undo_answer must set cards.usn = -1");

    let (note_mod, note_usn): (i64, i64) = s
        .lock()
        .query_row(
            r#"SELECT "mod", usn FROM notes WHERE id = ?1"#,
            [note_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_ne!(
        note_mod, 1000,
        "undo_answer un-leech must update notes.mod to current timestamp"
    );
    assert_eq!(note_usn, -1, "undo_answer un-leech must set notes.usn = -1");
}

#[test]
fn test_rename_and_delete_tag_mark_notes_dirty() {
    let (s, _, note_id, _) = setup_db();

    // 1. Rename tag
    let now_rename = 1_700_000_190_000;
    rename_tag(&s.lock(), "tag1", "tag1-renamed", now_rename).unwrap();

    let (mod_ms, usn): (i64, i64) = s
        .lock()
        .query_row(
            r#"SELECT "mod", usn FROM notes WHERE id = ?1"#,
            [note_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(mod_ms, now_rename);
    assert_eq!(
        usn, -1,
        "rename_tag must mark affected notes dirty with usn = -1"
    );

    // Clean sync status
    s.lock()
        .execute("UPDATE notes SET usn = 0 WHERE id = ?1", [note_id])
        .unwrap();

    // 2. Delete tag
    let now_del = 1_700_000_200_000;
    delete_tag(&s.lock(), "tag1-renamed", now_del).unwrap();

    let (mod_ms, usn): (i64, i64) = s
        .lock()
        .query_row(
            r#"SELECT "mod", usn FROM notes WHERE id = ?1"#,
            [note_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(mod_ms, now_del);
    assert_eq!(
        usn, -1,
        "delete_tag must mark affected notes dirty with usn = -1"
    );
}

#[test]
fn test_change_note_type_writes_card_graves_for_dropped_cards() {
    let (s, nt_id, note_id, card_id) = setup_db();

    // Create a target notetype
    let target_nt_id = s
        .duplicate_notetype(nt_id, "Basic Target", 1_700_000_210_000)
        .unwrap();

    let field_map = vec![Some(0), Some(1)];
    let template_map = vec![(0, None)];

    let now_ms = 1_700_000_220_000;
    // Add Card 2 to target_nt so the note creates at least one card
    {
        let conn = s.lock();
        let tx = conn.unchecked_transaction().unwrap();
        add_template(&tx, target_nt_id, "Card 2", "{{Back}}", "{{Front}}", now_ms).unwrap();
        tx.commit().unwrap();
    }

    change_note_type(
        &mut s.lock(),
        &[note_id],
        target_nt_id,
        &field_map,
        &template_map,
        now_ms,
    )
    .unwrap();

    // Verify dropped card was written to graves!
    let grave: Option<(i64, i64)> = s
        .lock()
        .query_row(
            "SELECT oid, usn FROM graves WHERE oid = ?1 AND type = 0",
            [card_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .unwrap();
    assert_eq!(
        grave,
        Some((card_id, -1)),
        "change_note_type must write a grave for dropped cards (type 0, usn -1)"
    );
}

#[test]
fn test_restore_deck_undo_marks_rows_dirty() {
    let (s, _, note_id, card_id) = setup_db();

    // Remove deck (captures RemovedDeck)
    let removed = s.remove_deck(1, 1_000).unwrap();

    // Verify graves exist
    let grave_count: i64 = s
        .lock()
        .query_row("SELECT COUNT(*) FROM graves", [], |r| r.get(0))
        .unwrap();
    assert!(grave_count > 0);

    // Restore deck via undo
    s.restore_deck(&removed, 1_700_000_120_000).unwrap();

    // The restored deck, notes, and cards MUST have usn = -1!
    let deck_usn: i64 = s
        .lock()
        .query_row("SELECT usn FROM decks WHERE id = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        deck_usn, -1,
        "restore_deck must mark restored decks dirty with usn = -1"
    );

    let note_usn: i64 = s
        .lock()
        .query_row("SELECT usn FROM notes WHERE id = ?1", [note_id], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        note_usn, -1,
        "restore_deck must mark restored notes dirty with usn = -1"
    );

    let card_usn: i64 = s
        .lock()
        .query_row("SELECT usn FROM cards WHERE id = ?1", [card_id], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        card_usn, -1,
        "restore_deck must mark restored cards dirty with usn = -1"
    );
}

// ── Journal Export Tests (Scope 1) ──────────────────────────────────────────

#[test]
fn test_export_delta_collects_dirty_rows_and_skips_clean() {
    let (s, _deck_id, note_id, _) = setup_db();
    let now_ms = 1_700_000_100_000;

    // Initially all rows have usn = 0 (clean)
    s.lock()
        .execute_batch(
            "UPDATE notes SET usn = 0;
             UPDATE cards SET usn = 0;
             UPDATE decks SET usn = 0;
             UPDATE deck_config SET usn = 0;
             UPDATE notetypes SET usn = 0;
             UPDATE tags SET usn = 0;",
        )
        .unwrap();

    let clean_delta = s.export_delta().unwrap();
    assert!(
        clean_delta.is_empty(),
        "clean database should export an empty delta"
    );

    // Make local mutations (sets usn = -1)
    s.update_note(
        note_id,
        &["Updated Front".into(), "World Back".into()],
        &["newtag".into()],
        now_ms,
    )
    .unwrap();
    let new_deck = s.create_deck("New Deck", now_ms).unwrap();

    // Insert revlog with usn = -1
    s.lock()
        .execute(
            "INSERT INTO revlog (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
             VALUES (?1, 1000, -1, 3, 1, 0, 2500, 4000, 1)",
            rusqlite::params![now_ms],
        )
        .unwrap();

    let delta = s.export_delta().unwrap();
    assert_eq!(delta.notes.len(), 1, "must export 1 dirty note");
    assert_eq!(delta.notes[0].id, note_id);
    assert_eq!(delta.decks.len(), 1, "must export 1 dirty deck");
    assert_eq!(delta.decks[0].id, new_deck.id);
    assert_eq!(delta.revlog.len(), 1, "must export 1 dirty revlog");
    assert_eq!(delta.revlog[0].id, now_ms);
    assert!(delta.cards.is_empty(), "clean cards must not be exported");
}

#[test]
fn test_export_delta_collects_graves_with_mod() {
    let (s, _, note_id, _) = setup_db();
    let now_ms = 1_700_000_200_000;

    // Delete note at now_ms
    s.delete_notes(&[note_id], now_ms).unwrap();

    let delta = s.export_delta().unwrap();
    assert_eq!(
        delta.graves.len(),
        2,
        "must export card grave and note grave"
    );
    for g in &delta.graves {
        assert_eq!(g.usn, -1);
        assert_eq!(g.mod_ms, now_ms);
    }
}

// ── Two-Device Simulation Test Suite (Scope 2) ──────────────────────────────

fn create_peer(schema_mod: i64, _now_ms: i64) -> (SqliteStorage, i64, i64, i64) {
    let (s, deck_id, note_id, card_id) = setup_db();

    if schema_mod != 0 {
        s.lock()
            .execute(
                "UPDATE collection SET schema_mod = ?1",
                rusqlite::params![schema_mod],
            )
            .unwrap();
    }

    s.lock()
        .execute_batch(
            "UPDATE notes SET usn = 0;
             UPDATE cards SET usn = 0;
             UPDATE decks SET usn = 0;
             UPDATE deck_config SET usn = 0;
             UPDATE notetypes SET usn = 0;
             UPDATE tags SET usn = 0;",
        )
        .unwrap();

    (s, deck_id, note_id, card_id)
}

#[test]
fn test_sim_01_concurrent_reviews_of_same_card_both_revlogs_kept() {
    let t0 = 1_700_000_000_000;
    let (dev_a, _, _, card_id) = create_peer(100, t0);
    let (dev_b, _, _, _) = create_peer(100, t0);

    // Device A reviews card at t0 + 1000
    dev_a
        .lock()
        .execute(
            "INSERT INTO revlog (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
             VALUES (?1, ?2, -1, 3, 1, 0, 2500, 5000, 0)",
            rusqlite::params![t0 + 1000, card_id],
        )
        .unwrap();

    // Device B reviews same card concurrently at t0 + 2000
    dev_b
        .lock()
        .execute(
            "INSERT INTO revlog (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
             VALUES (?1, ?2, -1, 4, 3, 0, 2600, 3000, 0)",
            rusqlite::params![t0 + 2000, card_id],
        )
        .unwrap();

    // A exports delta, B applies
    let delta_a = dev_a.export_delta().unwrap();
    assert_eq!(delta_a.revlog.len(), 1);
    dev_b.apply_sync_delta(&delta_a, 1, t0 + 3000).unwrap();

    // B exports delta, A applies
    let delta_b = dev_b.export_delta().unwrap();
    dev_a.apply_sync_delta(&delta_b, 1, t0 + 4000).unwrap();

    // Both devices now have exactly 2 revlog entries
    let count_a: i64 = dev_a
        .lock()
        .query_row("SELECT COUNT(*) FROM revlog", [], |r| r.get(0))
        .unwrap();
    let count_b: i64 = dev_b
        .lock()
        .query_row("SELECT COUNT(*) FROM revlog", [], |r| r.get(0))
        .unwrap();

    assert_eq!(count_a, 2, "Device A must keep both revlog entries");
    assert_eq!(count_b, 2, "Device B must keep both revlog entries");
}

#[test]
fn test_sim_02_same_note_edited_on_both_newer_wins_both_directions() {
    let t0 = 1_700_000_000_000;
    let (dev_a, _, note_id, _) = create_peer(100, t0);
    let (dev_b, _, _, _) = create_peer(100, t0);

    // Device A edits at t0 + 1000: "Edited by A"
    dev_a
        .update_note(
            note_id,
            &["Edited by A".into(), "World Back".into()],
            &[],
            t0 + 1000,
        )
        .unwrap();

    // Device B edits at t0 + 2000 (newer): "Edited by B"
    dev_b
        .update_note(
            note_id,
            &["Edited by B".into(), "World Back".into()],
            &[],
            t0 + 2000,
        )
        .unwrap();

    // Sync A -> B: B's newer local edit must win over A's older edit
    let delta_a = dev_a.export_delta().unwrap();
    dev_b.apply_sync_delta(&delta_a, 1, t0 + 3000).unwrap();

    let note_b_front: String = dev_b
        .lock()
        .query_row(
            "SELECT sort_field FROM notes WHERE id = ?1",
            [note_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(note_b_front, "Edited by B");

    // Sync B -> A: B's newer edit overwrites A's older edit
    let delta_b = dev_b.export_delta().unwrap();
    dev_a.apply_sync_delta(&delta_b, 1, t0 + 4000).unwrap();

    let note_a_front: String = dev_a
        .lock()
        .query_row(
            "SELECT sort_field FROM notes WHERE id = ?1",
            [note_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(note_a_front, "Edited by B");
}

#[test]
fn test_sim_03_tag_edits_merge_and_register() {
    let t0 = 1_700_000_000_000;
    let (dev_a, _, note_id, _) = create_peer(100, t0);
    let (dev_b, _, _, _) = create_peer(100, t0);

    // Device A adds tag "biology"
    dev_a.add_note_tag(note_id, "biology", t0 + 1000).unwrap();

    // Device B adds tag "medicine"
    dev_b.add_note_tag(note_id, "medicine", t0 + 2000).unwrap();

    // Sync B -> A (B is newer)
    let delta_b = dev_b.export_delta().unwrap();
    dev_a.apply_sync_delta(&delta_b, 1, t0 + 3000).unwrap();

    let note_a_tags: String = dev_a
        .lock()
        .query_row("SELECT tags FROM notes WHERE id = ?1", [note_id], |r| {
            r.get(0)
        })
        .unwrap();
    assert!(note_a_tags.contains("medicine"));

    // Tags registry on A has medicine
    let has_tag: i64 = dev_a
        .lock()
        .query_row(
            "SELECT COUNT(*) FROM tags WHERE name = 'medicine'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(has_tag, 1);
}

#[test]
fn test_sim_04_delete_vs_edit_tombstone_wins_over_stale_edit_and_newer_resurrects() {
    let t0 = 1_700_000_000_000;
    let (dev_a, _, note_id, _) = create_peer(100, t0);
    let (dev_b, _, _, _) = create_peer(100, t0);

    // Scenario A: Stale edit vs newer delete
    // Device B edits at t0 + 1000
    dev_b
        .update_note(
            note_id,
            &["Stale Edit".into(), "World Back".into()],
            &[],
            t0 + 1000,
        )
        .unwrap();

    // Device A deletes note at t0 + 2000
    dev_a.delete_notes(&[note_id], t0 + 2000).unwrap();

    // Sync A -> B: tombstone (t0 + 2000) wins over stale edit (t0 + 1000)
    let delta_a = dev_a.export_delta().unwrap();
    assert_eq!(delta_a.graves.len(), 2); // 1 card grave + 1 note grave
    dev_b.apply_sync_delta(&delta_a, 1, t0 + 3000).unwrap();

    let exists_b: i64 = dev_b
        .lock()
        .query_row("SELECT COUNT(*) FROM notes WHERE id = ?1", [note_id], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(exists_b, 0, "Tombstone must delete note on Device B");

    // Scenario B: Newer edit after delete resurrects
    // Device B resurrects/edits note at t0 + 4000
    dev_b
        .lock()
        .execute(
            "INSERT INTO notes (id, guid, notetype_id, \"mod\", usn, tags, fields, fields_norm)
             VALUES (?1, 'resurrected_guid', 1, ?2, -1, ' resurrected ', 'Resurrected' || char(31) || 'Content', 'resurrected content')",
            rusqlite::params![note_id, t0 + 4000],
        )
        .unwrap();

    // Sync B -> A: Newer edit (t0 + 4000) resurrects note on A and clears tombstone
    let delta_b = dev_b.export_delta().unwrap();
    dev_a.apply_sync_delta(&delta_b, 2, t0 + 5000).unwrap();

    let exists_a: i64 = dev_a
        .lock()
        .query_row("SELECT COUNT(*) FROM notes WHERE id = ?1", [note_id], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        exists_a, 1,
        "Newer edit after delete must resurrect entity on Device A"
    );

    // Tombstone must be cleared
    let grave_count: i64 = dev_a
        .lock()
        .query_row(
            "SELECT COUNT(*) FROM graves WHERE oid = ?1 AND type = 1",
            [note_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        grave_count, 0,
        "Active tombstone must be removed on resurrection"
    );
}

#[test]
fn test_sim_05_deck_rename_vs_card_move() {
    let t0 = 1_700_000_000_000;
    let (dev_a, deck_id, _, card_id) = create_peer(100, t0);
    let (dev_b, _, _, _) = create_peer(100, t0);

    // Device A renames deck 1 to "Primary" at t0 + 1000
    dev_a.rename_deck(deck_id, "Primary", t0 + 1000).unwrap();

    // Device B creates a new deck "Secondary" at t0 + 1500 and moves card to it at t0 + 2000
    let deck2 = dev_b.create_deck("Secondary", t0 + 1500).unwrap();
    dev_b
        .move_cards_to_deck(&[card_id], deck2.id, t0 + 2000)
        .unwrap();

    // Sync A -> B and B -> A
    let delta_a = dev_a.export_delta().unwrap();
    dev_b.apply_sync_delta(&delta_a, 1, t0 + 3000).unwrap();

    let delta_b = dev_b.export_delta().unwrap();
    dev_a.apply_sync_delta(&delta_b, 1, t0 + 4000).unwrap();

    // Both devices have deck "Primary" and "Secondary", with card in "Secondary"
    let d1_name_a: String = dev_a
        .lock()
        .query_row("SELECT name FROM decks WHERE id = 1", [], |r| r.get(0))
        .unwrap();
    let d1_name_b: String = dev_b
        .lock()
        .query_row("SELECT name FROM decks WHERE id = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(d1_name_a, "Primary");
    assert_eq!(d1_name_b, "Primary");

    let card_deck_a: i64 = dev_a
        .lock()
        .query_row("SELECT deck_id FROM cards WHERE id = ?1", [card_id], |r| {
            r.get(0)
        })
        .unwrap();
    let card_deck_b: i64 = dev_b
        .lock()
        .query_row("SELECT deck_id FROM cards WHERE id = ?1", [card_id], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(card_deck_a, deck2.id);
    assert_eq!(card_deck_b, deck2.id);
}

#[test]
fn test_sim_06_notetype_structural_change_refuses_delta_full_sync_required() {
    let t0 = 1_700_000_000_000;
    let (dev_a, _, _, _) = create_peer(100, t0);
    let (dev_b, _, _, _) = create_peer(100, t0);

    // Device A performs structural change: bumps schema_mod to 101
    dev_a
        .lock()
        .execute("UPDATE collection SET schema_mod = 101", [])
        .unwrap();

    // Export delta from A carries schema_mod = 101
    let delta_a = dev_a.export_delta().unwrap();
    assert_eq!(delta_a.schema_mod, 101);

    // Device B has schema_mod = 100 -> must reject with FullSyncRequired
    let err = dev_b.apply_sync_delta(&delta_a, 1, t0 + 2000).unwrap_err();
    match err {
        CoreError::FullSyncRequired { local, remote } => {
            assert_eq!(local, 100);
            assert_eq!(remote, 101);
        }
        other => panic!("expected FullSyncRequired, got {other:?}"),
    }
}

#[test]
fn test_sim_07_idempotency_applying_same_delta_twice_changes_nothing() {
    let t0 = 1_700_000_000_000;
    let (dev_a, _, note_id, _) = create_peer(100, t0);
    let (dev_b, _, _, _) = create_peer(100, t0);

    // Device A edits note
    dev_a
        .update_note(
            note_id,
            &["Updated once".into(), "World Back".into()],
            &[],
            t0 + 1000,
        )
        .unwrap();

    let delta_a = dev_a.export_delta().unwrap();

    // Apply first time
    let s1 = dev_b.apply_sync_delta(&delta_a, 1, t0 + 2000).unwrap();
    assert_eq!(s1.notes_updated, 1);

    // Apply second time (same delta)
    let s2 = dev_b.apply_sync_delta(&delta_a, 1, t0 + 3000).unwrap();
    // Second application is idempotent: note is already up to date
    assert_eq!(s2.notes_updated, 0);

    let front_b: String = dev_b
        .lock()
        .query_row(
            "SELECT sort_field FROM notes WHERE id = ?1",
            [note_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(front_b, "Updated once");
}

#[test]
fn test_sim_08_round_trip_a_to_b_to_a_ends_identical() {
    let t0 = 1_700_000_000_000;
    let (dev_a, _, note_id, card_id) = create_peer(100, t0);
    let (dev_b, _, _, _) = create_peer(100, t0);

    // Device A edits note
    dev_a
        .update_note(
            note_id,
            &["A content".into(), "Synced".into()],
            &["roundtrip".into()],
            t0 + 1000,
        )
        .unwrap();

    // A -> B
    let delta_a = dev_a.export_delta().unwrap();
    dev_b.apply_sync_delta(&delta_a, 1, t0 + 2000).unwrap();

    // B reviews the card
    dev_b
        .lock()
        .execute(
            "INSERT INTO revlog (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
             VALUES (?1, ?2, -1, 3, 1, 0, 2500, 4000, 1)",
            rusqlite::params![t0 + 2500, card_id],
        )
        .unwrap();

    // B -> A
    let delta_b = dev_b.export_delta().unwrap();
    dev_a.apply_sync_delta(&delta_b, 2, t0 + 3000).unwrap();

    // Both devices now have identical notes and revlog
    let note_a_front: String = dev_a
        .lock()
        .query_row(
            "SELECT sort_field FROM notes WHERE id = ?1",
            [note_id],
            |r| r.get(0),
        )
        .unwrap();
    let note_b_front: String = dev_b
        .lock()
        .query_row(
            "SELECT sort_field FROM notes WHERE id = ?1",
            [note_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(note_a_front, note_b_front);

    let rev_count_a: i64 = dev_a
        .lock()
        .query_row("SELECT COUNT(*) FROM revlog", [], |r| r.get(0))
        .unwrap();
    let rev_count_b: i64 = dev_b
        .lock()
        .query_row("SELECT COUNT(*) FROM revlog", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rev_count_a, 1);
    assert_eq!(rev_count_b, 1);
}

#[test]
fn test_delete_notes_writes_grave_times() {
    let (s, note_id, _, card_id) = setup_db();
    let del_time = 1_700_000_050_000;
    s.delete_notes(&[note_id], del_time).unwrap();

    let conn = s.lock();
    let note_del_ms: i64 = conn
        .query_row(
            "SELECT deleted_ms FROM grave_times WHERE oid = ?1 AND type = 1",
            [note_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(note_del_ms, del_time);

    let card_del_ms: i64 = conn
        .query_row(
            "SELECT deleted_ms FROM grave_times WHERE oid = ?1 AND type = 0",
            [card_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(card_del_ms, del_time);
}

#[test]
fn test_export_delta_sets_grave_mod_to_deleted_ms_not_collection_modified() {
    let (s, note_id, _, _) = setup_db();
    let del_time = 1_700_000_010_000;
    s.delete_notes(&[note_id], del_time).unwrap();

    // Later local change at t2 bumps collection.modified
    let later_time = 1_700_000_090_000;
    s.set_rollover_hour(5, later_time).unwrap();

    let col_mod: i64 = s
        .lock()
        .query_row("SELECT modified FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(col_mod, later_time);

    let delta = s.export_delta().unwrap();
    let note_grave = delta
        .graves
        .iter()
        .find(|g| g.oid == note_id && g.kind == 1)
        .expect("note grave must be in delta");

    assert_eq!(
        note_grave.mod_ms, del_time,
        "grave mod_ms must be its deleted_ms, NOT collection.modified ({later_time})"
    );
}

#[test]
fn test_sim_09_delete_vs_later_local_edit_on_a_and_concurrent_remote_edit_on_b() {
    let t0 = 1_700_000_000_000;
    let (dev_a, _, note_id, _) = create_peer(100, t0);
    let (dev_b, _, _, _) = create_peer(100, t0);

    // 1. Device A deletes note at t1 = t0 + 1000
    let t1 = t0 + 1000;
    dev_a.delete_notes(&[note_id], t1).unwrap();

    // 2. Later, Device A modifies its collection at t3 = t0 + 3000 (e.g. rollover hour edit)
    let t3 = t0 + 3000;
    dev_a.set_rollover_hour(5, t3).unwrap();

    // 3. Concurrently, Device B edited the note at t2 = t0 + 2000 (where t1 < t2 < t3)
    let t2 = t0 + 2000;
    dev_b
        .update_note(
            note_id,
            &["Device B Concurrent Edit".into(), "Answer".into()],
            &[],
            t2,
        )
        .unwrap();

    // 4. Sync B -> A: Because B's edit happened at t2 > t1 (deletion time),
    // B's edit MUST resurrect the note on Device A!
    let delta_b = dev_b.export_delta().unwrap();
    dev_a.apply_sync_delta(&delta_b, 1, t0 + 4000).unwrap();

    let note_count_a: i64 = dev_a
        .lock()
        .query_row("SELECT COUNT(*) FROM notes WHERE id = ?1", [note_id], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        note_count_a, 1,
        "Edit on Device B at t2 > t1 must resurrect note on Device A even if collection.modified was t3 > t2"
    );

    // Grave on A must be cleared
    let grave_count_a: i64 = dev_a
        .lock()
        .query_row(
            "SELECT COUNT(*) FROM graves WHERE oid = ?1 AND type = 1",
            [note_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(grave_count_a, 0, "grave must be cleared upon resurrection");

    // Also test case where edit at t0 < t1 -> tombstone wins
    let (dev_c, _, note_id_c, _) = create_peer(200, t0);
    let (dev_d, _, _, _) = create_peer(200, t0);
    // dev_d edited at t0
    dev_d
        .update_note(note_id_c, &["Old Edit".into(), "Ans".into()], &[], t0)
        .unwrap();
    // dev_c deleted at t0 + 500
    dev_c.delete_notes(&[note_id_c], t0 + 500).unwrap();
    // delta_d merged into c: tombstone must win
    let delta_d = dev_d.export_delta().unwrap();
    dev_c.apply_sync_delta(&delta_d, 2, t0 + 600).unwrap();
    let count_c: i64 = dev_c
        .lock()
        .query_row(
            "SELECT COUNT(*) FROM notes WHERE id = ?1",
            [note_id_c],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count_c, 0, "Tombstone at t0 + 500 must win over edit at t0");
}

#[test]
fn test_validate_delta_full_sync_with_local_zero_schema_mod() {
    use bibalak_core::sync::validate_delta;
    let delta = bibalak_core::sync::SyncDelta {
        schema_mod: 12345,
        collection_mod: 1000,
        ..Default::default()
    };

    // Local schema_mod is 0 (a real value, not unknown!)
    let res = validate_delta(&delta, 0, 1000);
    match res {
        Err(CoreError::FullSyncRequired { local, remote }) => {
            assert_eq!(local, 0);
            assert_eq!(remote, 12345);
        }
        other => panic!("Expected FullSyncRequired, got {other:?}"),
    }
}

#[test]
fn test_apply_sync_delta_tags_normalized_and_deduped() {
    let (s, _, _, _) = setup_db();
    let mut delta = bibalak_core::sync::SyncDelta::default();
    delta.notes.push(Note {
        id: 999,
        guid: "guid99999".into(),
        notetype_id: 1,
        mod_ms: 1_700_000_000_000,
        usn: 1,
        // Messy tags: case differences, duplicates, extra whitespace, empty strings
        tags: vec![
            "Med".into(),
            "med".into(),
            "  anatomy  ".into(),
            "".into(),
            "Cardiology".into(),
        ],
        fields: vec!["Q".into(), "A".into()],
        sort_field: Some("Q".into()),
        checksum: None,
    });

    s.apply_sync_delta(&delta, 2, 1_700_000_000_100).unwrap();

    let conn = s.lock();
    let tags_str: String = conn
        .query_row("SELECT tags FROM notes WHERE id = 999", [], |r| r.get(0))
        .unwrap();

    // Must be stored with bounding spaces, trimmed and deduped case-insensitively
    assert!(
        tags_str == " Med anatomy Cardiology " || tags_str == " med anatomy Cardiology ",
        "Tags must be normalized and deduped, got: {tags_str:?}"
    );

    // Tags registry check: must not register empty string, must register valid tags
    let registered_tags: Vec<String> = conn
        .prepare("SELECT name FROM tags ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert!(registered_tags.contains(&"anatomy".to_string()));
    assert!(!registered_tags.contains(&"".to_string()));
}

#[test]
fn test_collection_apply_remote_delta_creates_backup_and_keeps_it_on_failure() {
    let (s, _, _, _) = setup_db();
    let clock = std::sync::Arc::new(bibalak_core::ports::SystemClock);
    let col = bibalak_core::Collection::new(Box::new(s), clock).unwrap();

    let backup_path = std::env::temp_dir().join(format!(
        "keepsake-test-pre-merge-{}.db",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));

    let delta = bibalak_core::sync::SyncDelta {
        schema_mod: 999_999_999,
        ..Default::default()
    };

    let res = col.apply_remote_delta(&delta, 1, &backup_path);
    assert!(res.is_err(), "Divergent schema must cause apply to fail");

    assert!(
        backup_path.exists(),
        "Pre-merge backup file must exist on disk even when apply_remote_delta fails"
    );
    assert!(
        backup_path.metadata().unwrap().len() > 0,
        "Backup file must not be empty"
    );
}

// ── Progress ledger sync merge simulations (ADR-019 §2.5, R1) ─────────────────

#[test]
fn test_sim_10_progress_ledger_same_card_same_day_on_two_devices_merges_to_one_reward() {
    let (dev_a, _deck_id, note_id, card_id) = setup_db();
    let (dev_b, _, _, _) = setup_db();
    let now_base: i64 = 1_700_000_000_000;

    let clock_a = std::sync::Arc::new(bibalak_core::ports::TestClock::new(now_base + 1_000));
    let col_a = bibalak_core::Collection::new(Box::new(dev_a), clock_a).unwrap();
    let clock_b = std::sync::Arc::new(bibalak_core::ports::TestClock::new(now_base + 2_000));
    let col_b = bibalak_core::Collection::new(Box::new(dev_b), clock_b).unwrap();

    let prev = bibalak_core::scheduling::CardState::new(2500);
    let next = bibalak_core::scheduling::CardState {
        phase: bibalak_core::scheduling::CardPhase::Review,
        interval_days: 1,
        reps: 1,
        ..prev
    };

    // Device A answers Good (+3 XP, +25 gold_cents) at t = +1_000
    let log_a = Revlog {
        id: now_base + 1_000,
        card_id,
        usn: -1,
        ease: 3,
        interval: 1,
        last_interval: 0,
        ease_factor: 2500,
        taken_ms: 1200,
        review_kind: 0,
    };
    col_a
        .apply_answer(card_id, note_id, &prev, 0, &next, 1, &log_a, 8)
        .unwrap();
    assert_eq!(col_a.progress_summary().unwrap().total_xp, 3);

    // Device B independently answers the SAME card Hard (+2 XP, +25 gold_cents) on the SAME day at t = +2_000
    let log_b = Revlog {
        id: now_base + 2_000,
        card_id,
        usn: -1,
        ease: 2,
        interval: 1,
        last_interval: 0,
        ease_factor: 2500,
        taken_ms: 1400,
        review_kind: 0,
    };
    col_b
        .apply_answer(card_id, note_id, &prev, 0, &next, 1, &log_b, 8)
        .unwrap();
    assert_eq!(col_b.progress_summary().unwrap().total_xp, 2);

    let delta_a = col_a.storage().export_delta().unwrap();
    let delta_b = col_b.storage().export_delta().unwrap();
    assert_eq!(
        delta_a.progress_ledger.len(),
        1,
        "Device A delta must export its progress_ledger row"
    );
    assert_eq!(
        delta_b.progress_ledger.len(),
        1,
        "Device B delta must export its progress_ledger row"
    );
    assert_eq!(
        delta_a.progress_ledger[0].id, delta_b.progress_ledger[0].id,
        "Both devices must derive the identical deterministic UUID v5 for the same card+day"
    );

    // Merge B -> A and A -> B
    col_a
        .storage()
        .apply_sync_delta(&delta_b, 10, now_base + 3_000)
        .unwrap();
    col_b
        .storage()
        .apply_sync_delta(&delta_a, 10, now_base + 3_000)
        .unwrap();

    // Both devices must converge to a SINGLE reward row (not double-counted), with B's newer updated_at winning
    let sum_a = col_a.progress_summary().unwrap();
    let sum_b = col_b.progress_summary().unwrap();
    assert_eq!(sum_a, sum_b);
    assert_eq!(sum_a.total_xp, 2);
    assert_eq!(sum_a.gold_cents, 25);
    assert_eq!(sum_a.today_xp, 2);
    assert_eq!(sum_a.today_gold_cents, 25);
}

#[test]
fn test_sim_11_progress_ledger_undo_revoke_propagates_and_tie_on_updated_at_favors_revoke() {
    let (dev_a, _deck_id, note_id, card_id) = setup_db();
    let (dev_b, _, _, _) = setup_db();
    let now_base: i64 = 1_700_000_000_000;

    let clock_a = std::sync::Arc::new(bibalak_core::ports::TestClock::new(now_base + 1_000));
    let col_a = bibalak_core::Collection::new(Box::new(dev_a), clock_a.clone()).unwrap();
    let clock_b = std::sync::Arc::new(bibalak_core::ports::TestClock::new(now_base + 1_000));
    let col_b = bibalak_core::Collection::new(Box::new(dev_b), clock_b.clone()).unwrap();

    let prev = bibalak_core::scheduling::CardState::new(2500);
    let next = bibalak_core::scheduling::CardState {
        phase: bibalak_core::scheduling::CardPhase::Review,
        interval_days: 1,
        reps: 1,
        ..prev
    };
    let log = Revlog {
        id: now_base + 1_000,
        card_id,
        usn: -1,
        ease: 3,
        interval: 1,
        last_interval: 0,
        ease_factor: 2500,
        taken_ms: 1000,
        review_kind: 0,
    };

    // 1. Device A answers and syncs to B
    col_a
        .apply_answer(card_id, note_id, &prev, 0, &next, 1, &log, 8)
        .unwrap();
    let delta1 = col_a.storage().export_delta().unwrap();
    col_b
        .storage()
        .apply_sync_delta(&delta1, 1, now_base + 1_500)
        .unwrap();
    assert_eq!(col_b.progress_summary().unwrap().total_xp, 3);

    // 2. Device A undoes the answer at t = +2_000 and syncs to B -> revoke reaches B
    clock_a.set(now_base + 2_000);
    col_a.undo().unwrap();
    assert_eq!(col_a.progress_summary().unwrap().total_xp, 0);

    let delta_undo = col_a.storage().export_delta().unwrap();
    assert_eq!(delta_undo.progress_ledger.len(), 1);
    assert_eq!(
        delta_undo.progress_ledger[0].deleted_at,
        Some(now_base + 2_000)
    );

    col_b
        .storage()
        .apply_sync_delta(&delta_undo, 2, now_base + 2_500)
        .unwrap();
    assert_eq!(
        col_b.progress_summary().unwrap().total_xp,
        0,
        "remote undo revoke must soft-delete B's reward row"
    );

    // 3. Tie on updated_at between active and revoked: revoke (deleted_at.is_some()) must win in both directions
    let tie_ts = now_base + 5_000;
    let source_key = bibalak_core::progress::review_source_key(card_id, 0);
    let entry_id =
        bibalak_core::progress::ledger_id(bibalak_core::progress::NIL_USER_ID, &source_key);
    let active_entry = bibalak_core::progress::ProgressLedgerEntry {
        id: entry_id.clone(),
        user_id: bibalak_core::progress::NIL_USER_ID.to_string(),
        source_key: source_key.clone(),
        xp: 3,
        gold_cents: 25,
        created_at: tie_ts,
        updated_at: tie_ts,
        deleted_at: None,
        usn: 3,
    };
    let revoked_entry = bibalak_core::progress::ProgressLedgerEntry {
        deleted_at: Some(tie_ts),
        ..active_entry.clone()
    };

    // Put active@5000 on A, then apply remote revoked@5000 -> A must become revoked (0 XP)
    let mut delta_active = bibalak_core::sync::SyncDelta::default();
    delta_active.progress_ledger.push(active_entry);
    let mut delta_revoked = bibalak_core::sync::SyncDelta::default();
    delta_revoked.progress_ledger.push(revoked_entry);

    col_a
        .storage()
        .apply_sync_delta(&delta_active, 3, tie_ts)
        .unwrap();
    assert_eq!(col_a.progress_summary().unwrap().total_xp, 3);
    col_a
        .storage()
        .apply_sync_delta(&delta_revoked, 4, tie_ts)
        .unwrap();
    assert_eq!(
        col_a.progress_summary().unwrap().total_xp,
        0,
        "on updated_at tie, incoming revoked row must win over local active row"
    );

    // Put revoked@5000 on B, then apply remote active@5000 -> B must remain revoked (0 XP)
    col_b
        .storage()
        .apply_sync_delta(&delta_revoked, 3, tie_ts)
        .unwrap();
    col_b
        .storage()
        .apply_sync_delta(&delta_active, 4, tie_ts)
        .unwrap();
    assert_eq!(
        col_b.progress_summary().unwrap().total_xp,
        0,
        "on updated_at tie, local revoked row must win over incoming active row"
    );
}

#[test]
fn test_sim_12_progress_ledger_round_trip_and_idempotent_reapply_and_acknowledge() {
    let (dev_a, _deck_id, _note_id, card_id) = setup_db();
    let (dev_b, _, _, _) = setup_db();
    let now_base: i64 = 1_700_000_000_000;

    let prev = bibalak_core::scheduling::CardState::new(2500);
    let next = bibalak_core::scheduling::CardState {
        phase: bibalak_core::scheduling::CardPhase::Review,
        interval_days: 1,
        reps: 1,
        ..prev
    };
    let log = Revlog {
        id: now_base + 1_000,
        card_id,
        usn: -1,
        ease: 3,
        interval: 1,
        last_interval: 0,
        ease_factor: 2500,
        taken_ms: 1000,
        review_kind: 0,
    };
    let source_key = bibalak_core::progress::review_source_key(card_id, 0);
    let grant = bibalak_core::progress::RewardGrant {
        id: bibalak_core::progress::ledger_id(bibalak_core::progress::NIL_USER_ID, &source_key),
        user_id: bibalak_core::progress::NIL_USER_ID.to_string(),
        source_key: source_key.clone(),
        xp: 3,
        gold_cents: 25,
        now_ms: now_base + 1_000,
    };

    dev_a
        .apply_answer(card_id, &next, 1, &log, Some(&grant))
        .unwrap();

    // Export from A, apply to B twice (idempotency check)
    let delta_a = dev_a.export_delta().unwrap();
    assert_eq!(delta_a.progress_ledger.len(), 1);

    let sum1 = dev_b
        .apply_sync_delta(&delta_a, 10, now_base + 2_000)
        .unwrap();
    assert_eq!(sum1.progress_ledger_updated, 1);

    let sum2 = dev_b
        .apply_sync_delta(&delta_a, 10, now_base + 2_000)
        .unwrap();
    assert_eq!(
        sum2.progress_ledger_updated, 0,
        "applying the same delta twice must be a no-op"
    );

    // Acknowledge delta on A -> marks progress_ledger.usn = 10, so next export_delta is empty
    super::sync::acknowledge_delta(&dev_a.lock(), 10).unwrap();
    let delta_a_after_ack = dev_a.export_delta().unwrap();
    assert!(
        delta_a_after_ack.progress_ledger.is_empty(),
        "acknowledge_delta must mark progress_ledger rows clean"
    );

    // Round-trip A -> B -> A check: totals on both devices match
    let totals_a = dev_a
        .progress_totals(
            bibalak_core::progress::NIL_USER_ID,
            now_base,
            now_base + 86_400_000,
        )
        .unwrap();
    let totals_b = dev_b
        .progress_totals(
            bibalak_core::progress::NIL_USER_ID,
            now_base,
            now_base + 86_400_000,
        )
        .unwrap();
    assert_eq!(totals_a, totals_b);
    assert_eq!(totals_a.total_xp, 3);
    assert_eq!(totals_a.gold_cents, 25);
}

// ── Productivity sync merge simulations (ADR-018 §2.9, M1) ──────────────────

#[test]
fn sync_delta_roundtrips_all_six_productivity_tables_and_acknowledges_usn() {
    use bibalak_core::productivity::{
        entity_id_v5, CalendarEvent, CalendarRecurrence, CalendarRecurrenceFreq, Habit,
        HabitFrequencyKind, HabitGoalMode, HabitLog, HabitLogStatus, HabitSection, MatrixGroupBy,
        MatrixListFilter, MatrixQuadrant, MatrixSortBy, QuadrantKey, QuadrantRule, TaskItem,
        TaskList, TaskPriority,
    };
    use bibalak_core::progress::NIL_USER_ID;

    let (dev_a, _, _, _) = setup_db();
    let (dev_b, _, _, _) = setup_db();
    let initial_schema_mod: i64 = dev_a
        .lock()
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();

    // Untouched seeded matrix_quadrants have usn = 0, so initial export has empty productivity vectors.
    let empty_delta = dev_a.export_delta().unwrap();
    assert!(empty_delta.task_lists.is_empty());
    assert!(empty_delta.matrix_quadrants.is_empty());

    let list_id = "11111111-1111-4111-8111-111111111111".to_string();
    let task_id = "22222222-2222-4222-8222-222222222222".to_string();
    let habit_id = "33333333-3333-4333-8333-333333333333".to_string();
    let log_id = entity_id_v5("habit_log", NIL_USER_ID, &format!("{habit_id}:0"));
    let event_id = "44444444-4444-4444-8444-444444444444".to_string();
    let q1_id = entity_id_v5("matrix_quadrant", NIL_USER_ID, "q1");

    let list = TaskList {
        id: list_id.clone(),
        user_id: NIL_USER_ID.into(),
        name: "Med School".into(),
        color_token: "accent".into(),
        icon_key: Some("book".into()),
        sort_order: 1,
        created_at: 1_700_000_000_100,
        updated_at: 1_700_000_000_100,
        deleted_at: None,
        usn: -1,
    };
    let task = TaskItem {
        id: task_id.clone(),
        user_id: NIL_USER_ID.into(),
        list_id: Some(list_id.clone()),
        title: "Finish pathology".into(),
        notes: "Ch 1-3".into(),
        priority: TaskPriority::High,
        manual_quadrant: None,
        due_date: Some("2026-11-22".into()),
        scheduled_start_ms: None,
        scheduled_end_ms: None,
        tags: vec!["exam".into()],
        deck_id: None,
        completed_at: None,
        completed_day: None,
        sort_order: 0,
        created_at: 1_700_000_000_200,
        updated_at: 1_700_000_000_200,
        deleted_at: None,
        usn: -1,
    };
    let q1 = MatrixQuadrant {
        id: q1_id.clone(),
        user_id: NIL_USER_ID.into(),
        quadrant_key: QuadrantKey::Q1,
        title: "Urgent Exams".into(),
        color_token: "danger".into(),
        group_by: MatrixGroupBy::List,
        sort_by: MatrixSortBy::Priority,
        rule: QuadrantRule {
            lists: MatrixListFilter::All,
            date_filters: None,
            priorities: Some(vec![TaskPriority::High]),
            types: None,
            pinned_deck_ids: vec![],
            excluded_deck_ids: vec![],
        },
        created_at: 0,
        updated_at: 1_700_000_000_300,
        deleted_at: None,
        usn: -1,
    };
    let habit = Habit {
        id: habit_id.clone(),
        user_id: NIL_USER_ID.into(),
        title: "Read 20 pages".into(),
        notes: String::new(),
        icon_key: "book-open".into(),
        color_token: "success".into(),
        frequency_kind: HabitFrequencyKind::Daily,
        weekdays: vec![],
        weekly_target: None,
        interval_days: None,
        goal_mode: HabitGoalMode::ReachAmount,
        goal_target: 20.0,
        goal_unit: "pages".into(),
        start_day_index: 0,
        target_days: Some(30),
        section: HabitSection::Night,
        reminders: vec!["21:00".into()],
        auto_popup_log: true,
        deck_id: None,
        archived_at: None,
        sort_order: 0,
        created_at: 1_700_000_000_400,
        updated_at: 1_700_000_000_400,
        deleted_at: None,
        usn: -1,
    };
    let log = HabitLog {
        id: log_id.clone(),
        user_id: NIL_USER_ID.into(),
        habit_id: habit_id.clone(),
        day_index: 0,
        logged_value: 20.0,
        goal_target: 20.0,
        completed: true,
        status: HabitLogStatus::Logged,
        mood: Some(5),
        note: "Great".into(),
        created_at: 1_700_000_000_500,
        updated_at: 1_700_000_000_500,
        deleted_at: None,
        usn: -1,
    };
    let event = CalendarEvent {
        id: event_id.clone(),
        user_id: NIL_USER_ID.into(),
        title: "Study block".into(),
        description: String::new(),
        location: "Library".into(),
        color_token: "info".into(),
        start_ms: 1_700_000_000_000,
        end_ms: 1_700_000_360_000,
        is_all_day: false,
        recurrence: Some(CalendarRecurrence {
            freq: CalendarRecurrenceFreq::Weekly,
            interval: 1,
            weekdays: vec![1, 3, 5],
            until_date: None,
            count: Some(6),
            exdates: vec!["2026-11-25".into()],
        }),
        linked_task_id: Some(task_id.clone()),
        external_account_id: None,
        external_event_id: None,
        created_at: 1_700_000_000_600,
        updated_at: 1_700_000_000_600,
        deleted_at: None,
        usn: -1,
    };

    dev_a.upsert_task_list(&list).unwrap();
    dev_a.upsert_task(&task).unwrap();
    dev_a.upsert_matrix_quadrant(&q1).unwrap();
    dev_a.upsert_habit(&habit).unwrap();
    dev_a.upsert_habit_log(&log, None, None).unwrap();
    dev_a.upsert_calendar_event(&event).unwrap();

    // schema_mod must remain unchanged.
    let after_schema_mod: i64 = dev_a
        .lock()
        .query_row("SELECT schema_mod FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(after_schema_mod, initial_schema_mod);

    let delta = dev_a.export_delta().unwrap();
    assert_eq!(delta.task_lists.len(), 1);
    assert_eq!(delta.tasks.len(), 1);
    assert_eq!(delta.matrix_quadrants.len(), 1);
    assert_eq!(delta.habits.len(), 1);
    assert_eq!(delta.habit_logs.len(), 1);
    assert_eq!(delta.calendar_events.len(), 1);

    let summary = dev_b
        .apply_sync_delta(&delta, 42, 1_700_000_001_000)
        .unwrap();
    assert_eq!(summary.task_lists_updated, 1);
    assert_eq!(summary.tasks_updated, 1);
    assert_eq!(summary.matrix_quadrants_updated, 1);
    assert_eq!(summary.habits_updated, 1);
    assert_eq!(summary.habit_logs_updated, 1);
    assert_eq!(summary.calendar_events_updated, 1);

    assert_eq!(dev_b.list_task_lists(NIL_USER_ID).unwrap().len(), 1);
    assert_eq!(
        dev_b
            .get_task(NIL_USER_ID, &task_id)
            .unwrap()
            .unwrap()
            .title,
        "Finish pathology"
    );
    assert_eq!(
        dev_b
            .list_matrix_quadrants(NIL_USER_ID)
            .unwrap()
            .into_iter()
            .find(|q| q.quadrant_key == QuadrantKey::Q1)
            .unwrap()
            .title,
        "Urgent Exams"
    );
    assert_eq!(
        dev_b
            .get_habit(NIL_USER_ID, &habit_id)
            .unwrap()
            .unwrap()
            .title,
        "Read 20 pages"
    );
    assert_eq!(
        dev_b
            .list_habit_logs_range(NIL_USER_ID, 0, 0)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        dev_b
            .get_calendar_event(NIL_USER_ID, &event_id)
            .unwrap()
            .unwrap()
            .title,
        "Study block"
    );

    // Re-applying identical delta is a no-op.
    let summary_dup = dev_b
        .apply_sync_delta(&delta, 42, 1_700_000_001_100)
        .unwrap();
    assert_eq!(summary_dup.task_lists_updated, 0);
    assert_eq!(summary_dup.tasks_updated, 0);
    assert_eq!(summary_dup.matrix_quadrants_updated, 0);
    assert_eq!(summary_dup.habits_updated, 0);
    assert_eq!(summary_dup.habit_logs_updated, 0);
    assert_eq!(summary_dup.calendar_events_updated, 0);

    // Acknowledge clears usn = -1 on all 6 tables on dev_a.
    super::sync::acknowledge_delta(&dev_a.lock(), 42).unwrap();
    let after_ack = dev_a.export_delta().unwrap();
    assert!(after_ack.is_empty());
}

#[test]
fn sync_merge_lww_tie_prefers_soft_delete_and_preserves_fk_order() {
    use bibalak_core::productivity::{CalendarEvent, TaskItem, TaskList, TaskPriority};
    use bibalak_core::progress::NIL_USER_ID;

    let (dev_a, _, _, _) = setup_db();
    let (dev_b, _, _, _) = setup_db();
    let tie_ts = 1_700_000_005_000;

    let list_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".to_string();
    let task_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb".to_string();
    let event_id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc".to_string();

    let list = TaskList {
        id: list_id.clone(),
        user_id: NIL_USER_ID.into(),
        name: "Parent List".into(),
        color_token: "accent".into(),
        icon_key: None,
        sort_order: 0,
        created_at: tie_ts,
        updated_at: tie_ts,
        deleted_at: None,
        usn: 1,
    };
    let active_task = TaskItem {
        id: task_id.clone(),
        user_id: NIL_USER_ID.into(),
        list_id: Some(list_id.clone()),
        title: "Child Task".into(),
        notes: String::new(),
        priority: TaskPriority::Medium,
        manual_quadrant: None,
        due_date: None,
        scheduled_start_ms: None,
        scheduled_end_ms: None,
        tags: vec![],
        deck_id: None,
        completed_at: None,
        completed_day: None,
        sort_order: 0,
        created_at: tie_ts,
        updated_at: tie_ts,
        deleted_at: None,
        usn: 1,
    };
    let deleted_task = TaskItem {
        deleted_at: Some(tie_ts),
        ..active_task.clone()
    };
    let child_event = CalendarEvent {
        id: event_id.clone(),
        user_id: NIL_USER_ID.into(),
        title: "Task Linked Event".into(),
        description: String::new(),
        location: String::new(),
        color_token: "accent".into(),
        start_ms: tie_ts,
        end_ms: tie_ts + 3_600_000,
        is_all_day: false,
        recurrence: None,
        linked_task_id: Some(task_id.clone()),
        external_account_id: None,
        external_event_id: None,
        created_at: tie_ts,
        updated_at: tie_ts,
        deleted_at: None,
        usn: 1,
    };

    // Parent + child + grandchild delivered together in one delta must pass PRAGMA foreign_key_check.
    let delta_active = bibalak_core::sync::SyncDelta {
        task_lists: vec![list.clone()],
        tasks: vec![active_task],
        calendar_events: vec![child_event],
        ..Default::default()
    };
    let delta_deleted = bibalak_core::sync::SyncDelta {
        task_lists: vec![list],
        tasks: vec![deleted_task],
        ..Default::default()
    };

    // Active on A, then incoming soft-delete at same updated_at -> soft-delete wins.
    dev_a.apply_sync_delta(&delta_active, 10, tie_ts).unwrap();
    assert!(dev_a.get_task(NIL_USER_ID, &task_id).unwrap().is_some());
    dev_a.apply_sync_delta(&delta_deleted, 11, tie_ts).unwrap();
    assert!(dev_a.get_task(NIL_USER_ID, &task_id).unwrap().is_none());

    // Soft-deleted on B, then incoming active at same updated_at -> local soft-delete stays.
    dev_b.apply_sync_delta(&delta_deleted, 10, tie_ts).unwrap();
    dev_b.apply_sync_delta(&delta_active, 11, tie_ts).unwrap();
    assert!(dev_b.get_task(NIL_USER_ID, &task_id).unwrap().is_none());
}

#[test]
fn sync_two_devices_completing_same_task_or_habit_merges_to_single_reward_and_tie_prefers_revoke() {
    use bibalak_core::progress::{ledger_id, task_source_key, RewardGrant, NIL_USER_ID};

    let dev_a = SqliteStorage::open_in_memory().unwrap();
    let dev_b = SqliteStorage::open_in_memory().unwrap();
    let now_base: i64 = 1_795_341_600_000;
    dev_a.ensure_collection(now_base).unwrap();
    dev_b.ensure_collection(now_base).unwrap();

    let task_id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    let task = bibalak_core::productivity::TaskItem {
        id: task_id.into(),
        user_id: NIL_USER_ID.into(),
        list_id: None,
        title: "Synced task".into(),
        notes: String::new(),
        priority: bibalak_core::productivity::TaskPriority::Medium,
        manual_quadrant: None,
        due_date: None,
        scheduled_start_ms: None,
        scheduled_end_ms: None,
        tags: vec![],
        deck_id: None,
        completed_at: Some(now_base + 1_000),
        completed_day: Some(0),
        sort_order: 0,
        created_at: now_base,
        updated_at: now_base + 1_000,
        deleted_at: None,
        usn: -1,
    };
    dev_a.upsert_task(&task).unwrap();
    dev_b.upsert_task(&task).unwrap();

    let key = task_source_key(task_id);
    let grant = RewardGrant {
        id: ledger_id(NIL_USER_ID, &key),
        user_id: NIL_USER_ID.into(),
        source_key: key.clone(),
        xp: 10,
        gold_cents: 100,
        now_ms: now_base + 1_000,
    };
    assert!(dev_a
        .set_task_completion(
            NIL_USER_ID,
            task_id,
            Some(now_base + 1_000),
            Some(0),
            Some(&grant),
            None,
            now_base + 1_000
        )
        .unwrap());
    assert!(dev_b
        .set_task_completion(
            NIL_USER_ID,
            task_id,
            Some(now_base + 1_500),
            Some(0),
            Some(&RewardGrant {
                now_ms: now_base + 1_500,
                ..grant.clone()
            }),
            None,
            now_base + 1_500
        )
        .unwrap());

    let delta_a = dev_a.export_delta().unwrap();
    dev_b
        .apply_sync_delta(&delta_a, 10, now_base + 2_000)
        .unwrap();
    let totals_b = dev_b
        .progress_totals(NIL_USER_ID, now_base, now_base + 86_400_000)
        .unwrap();
    assert_eq!(
        totals_b.total_xp, 10,
        "duplicate completions merge to single 10 XP"
    );
    assert_eq!(totals_b.tasks_rewarded_today, 1);

    // Same updated_at tie: revoke (deleted_at.is_some()) must win over active grant.
    let tie_ts = now_base + 5_000;
    dev_a
        .set_task_completion(NIL_USER_ID, task_id, None, None, None, Some(&key), tie_ts)
        .unwrap();
    let delta_revoke = dev_a.export_delta().unwrap();
    dev_b.apply_sync_delta(&delta_revoke, 11, tie_ts).unwrap();
    let totals_after_tie = dev_b
        .progress_totals(NIL_USER_ID, now_base, now_base + 86_400_000)
        .unwrap();
    assert_eq!(totals_after_tie.total_xp, 0);
}

#[test]
fn sync_merges_game_tables_without_lost_tokens_or_credits() {
    use bibalak_core::game::{AvatarProfileInput, EquipmentSlot, STREAK_FREEZE_ITEM_KEY};
    use bibalak_core::game_depth::{
        game_achievement_id, game_pet_id, game_profile_id, game_unlock_id, GameAchievement,
        GameEvalContext, GamePathId, GamePet, GameProfile, GameUnlock,
    };
    use bibalak_core::model::Revlog;
    use bibalak_core::progress::{ledger_id, RewardGrant, NIL_USER_ID};
    use bibalak_core::scheduling::CardState;

    let dev_a = SqliteStorage::open_in_memory().unwrap();
    let dev_b = SqliteStorage::open_in_memory().unwrap();
    let now_base: i64 = 1_795_341_600_000;
    dev_a.ensure_collection(now_base).unwrap();
    dev_b.ensure_collection(now_base).unwrap();

    // Seed gold + reviews on both devices (card 1 on A, card 2 on B)
    let ctx_a = GameEvalContext {
        user_id: NIL_USER_ID.into(),
        today: 0,
        awarded_day: 0,
        now_ms: now_base + 1_000,
        tz_offset_minutes: 0,
        rollover_hour: 4,
        created_ms: now_base,
        card_is_mature: false,
    };
    dev_a
        .apply_answer_with_game(
            1,
            &CardState::new(2500),
            0,
            &Revlog {
                id: now_base + 1_000,
                card_id: 1,
                usn: -1,
                ease: 3,
                interval: 1,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 500,
                review_kind: 1,
            },
            Some(&RewardGrant {
                id: ledger_id(NIL_USER_ID, "card_review:1:0"),
                user_id: NIL_USER_ID.into(),
                source_key: "card_review:1:0".into(),
                xp: 2_700,
                gold_cents: 10_000,
                now_ms: now_base + 1_000,
            }),
            &ctx_a,
        )
        .unwrap();

    let ctx_b = GameEvalContext {
        now_ms: now_base + 2_000,
        ..ctx_a.clone()
    };
    dev_b
        .apply_answer_with_game(
            2,
            &CardState::new(2500),
            0,
            &Revlog {
                id: now_base + 2_000,
                card_id: 2,
                usn: -1,
                ease: 3,
                interval: 1,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 500,
                review_kind: 1,
            },
            Some(&RewardGrant {
                id: ledger_id(NIL_USER_ID, "card_review:2:0"),
                user_id: NIL_USER_ID.into(),
                source_key: "card_review:2:0".into(),
                xp: 2_700,
                gold_cents: 10_000,
                now_ms: now_base + 2_000,
            }),
            &ctx_b,
        )
        .unwrap();

    // Device A buys 1 freeze token, updates avatar, equips head item, chooses path Sage
    dev_a
        .buy_shop_item(
            NIL_USER_ID,
            STREAK_FREEZE_ITEM_KEY,
            "tx-a-1",
            now_base + 3_000,
        )
        .unwrap();
    dev_a
        .buy_shop_item(NIL_USER_ID, "head_hood_scholar", "tx-a-2", now_base + 3_100)
        .unwrap();
    dev_a
        .equip_game_item(
            NIL_USER_ID,
            EquipmentSlot::Head,
            "head_hood_scholar",
            now_base + 3_200,
        )
        .unwrap();
    dev_a
        .update_avatar_profile(
            NIL_USER_ID,
            &AvatarProfileInput {
                body_tone: "tone_4".into(),
                hair_style: "hair_3".into(),
                hair_color: "silver".into(),
                starter_outfit: "tunic_ochre".into(),
                starter_accessory: "acc_glasses".into(),
            },
            now_base + 3_300,
        )
        .unwrap();
    dev_a
        .choose_game_path(NIL_USER_ID, GamePathId::Sage, now_base + 3_400)
        .unwrap();

    // Device B buys 1 freeze token independently, equips back item, activates lynx (newer updated_at)
    dev_b
        .buy_shop_item(
            NIL_USER_ID,
            STREAK_FREEZE_ITEM_KEY,
            "tx-b-1",
            now_base + 4_000,
        )
        .unwrap();
    dev_b
        .buy_shop_item(NIL_USER_ID, "back_cape_crimson", "tx-b-2", now_base + 4_100)
        .unwrap();
    dev_b
        .equip_game_item(
            NIL_USER_ID,
            EquipmentSlot::Back,
            "back_cape_crimson",
            now_base + 4_200,
        )
        .unwrap();
    let lynx_id = game_pet_id(NIL_USER_ID, "lynx", "classic");
    dev_b
        .set_active_pet(NIL_USER_ID, Some(&lynx_id), false, now_base + 4_500)
        .unwrap();

    // Bidirectional merge: A -> B and B -> A
    let delta_a = dev_a.export_delta().unwrap();
    let delta_b = dev_b.export_delta().unwrap();
    assert!(!delta_a.freeze_token_ledger.is_empty());
    assert!(!delta_a.game_pet_credits.is_empty());
    assert!(!delta_b.freeze_token_ledger.is_empty());
    assert!(!delta_b.game_pet_credits.is_empty());

    dev_b
        .apply_sync_delta(&delta_a, 10, now_base + 5_000)
        .unwrap();
    dev_a
        .apply_sync_delta(&delta_b, 10, now_base + 5_000)
        .unwrap();

    // Both devices now hold BOTH freeze tokens (2), BOTH equipped slots (Head + Back),
    // and owl:classic has 2 growth credits (1 from card 1 on A + 1 from card 2 on B)!
    assert_eq!(dev_a.freeze_tokens_held(NIL_USER_ID).unwrap(), 2);
    assert_eq!(dev_b.freeze_tokens_held(NIL_USER_ID).unwrap(), 2);

    let (depth_a, _) = dev_a
        .load_game_depth_state(NIL_USER_ID, now_base + 5_100, 0, 4, now_base)
        .unwrap();
    let (depth_b, _) = dev_b
        .load_game_depth_state(NIL_USER_ID, now_base + 5_100, 0, 4, now_base)
        .unwrap();
    assert_eq!(depth_a.active_pet_id.as_deref(), Some(lynx_id.as_str()));
    assert_eq!(depth_b.active_pet_id.as_deref(), Some(lynx_id.as_str()));
    let owl_a = depth_a
        .pets
        .iter()
        .find(|p| p.species_key == "owl" && p.variant_key == "classic")
        .unwrap();
    let owl_b = depth_b
        .pets
        .iter()
        .find(|p| p.species_key == "owl" && p.variant_key == "classic")
        .unwrap();
    assert_eq!(owl_a.growth_points, 2);
    assert_eq!(owl_b.growth_points, 2);
    assert_eq!(depth_a.chosen_path, Some(GamePathId::Sage));
    assert_eq!(depth_b.chosen_path, Some(GamePathId::Sage));

    let snap_a = dev_a
        .load_game_snapshot(NIL_USER_ID, 0, 0, 4, now_base)
        .unwrap();
    assert!(snap_a.equipped.iter().any(
        |e| e.slot == EquipmentSlot::Head && e.item_key.as_deref() == Some("head_hood_scholar")
    ));
    assert!(snap_a.equipped.iter().any(
        |e| e.slot == EquipmentSlot::Back && e.item_key.as_deref() == Some("back_cape_crimson")
    ));

    // Test ADR-026 §2.5 merge rules: active unlock/achievement wins over deleted, earliest timestamps kept,
    // and backfill_version takes max()
    let tie_delta = bibalak_core::sync::SyncDelta {
        game_profile: vec![GameProfile {
            id: game_profile_id(NIL_USER_ID),
            user_id: NIL_USER_ID.into(),
            chosen_path: Some("sage".into()),
            path_chosen_at: Some(now_base + 3_400),
            backfill_version: 2,
            created_at: now_base,
            updated_at: now_base + 1_000,
            deleted_at: None,
            usn: -1,
        }],
        game_unlocks: vec![GameUnlock {
            id: game_unlock_id(NIL_USER_ID, "unlock:reviews:1"),
            user_id: NIL_USER_ID.into(),
            unlock_key: "unlock:reviews:1".into(),
            reward_kind: "pet".into(),
            reward_ref: "owl:classic".into(),
            unlocked_at: now_base + 100,
            seen_at: Some(now_base + 500),
            created_at: now_base + 100,
            updated_at: now_base + 100,
            deleted_at: Some(now_base + 200),
            usn: -1,
        }],
        game_achievements: vec![GameAchievement {
            id: game_achievement_id(NIL_USER_ID, "ach:first_review"),
            user_id: NIL_USER_ID.into(),
            achievement_key: "ach:first_review".into(),
            tier: 1,
            earned_at: now_base + 100,
            seen_at: Some(now_base + 500),
            created_at: now_base + 100,
            updated_at: now_base + 100,
            deleted_at: Some(now_base + 200),
            usn: -1,
        }],
        game_pets: vec![GamePet {
            id: game_pet_id(NIL_USER_ID, "owl", "classic"),
            user_id: NIL_USER_ID.into(),
            species_key: "owl".into(),
            variant_key: "classic".into(),
            mount_unlocked_at: Some(now_base + 4_900),
            is_active: false,
            is_mounted: false,
            created_at: now_base + 100,
            updated_at: now_base + 4_900,
            deleted_at: None,
            usn: -1,
        }],
        ..Default::default()
    };
    dev_a
        .apply_sync_delta(&tie_delta, 11, now_base + 6_000)
        .unwrap();

    // Acknowledge clears all dirty game rows
    {
        let conn = dev_a.lock();
        crate::sync::acknowledge_delta(&conn, 12).unwrap();
    }
    let post_ack = dev_a.export_delta().unwrap();
    assert!(post_ack.avatar_profile.is_empty());
    assert!(post_ack.inventory_items.is_empty());
    assert!(post_ack.avatar_equipped.is_empty());
    assert!(post_ack.gold_spend_ledger.is_empty());
    assert!(post_ack.freeze_token_ledger.is_empty());
    assert!(post_ack.game_profile.is_empty());
    assert!(post_ack.game_unlocks.is_empty());
    assert!(post_ack.game_pets.is_empty());
    assert!(post_ack.game_pet_credits.is_empty());
    assert!(post_ack.game_achievements.is_empty());
}

#[test]
fn sync_merges_motivation_tables() {
    use bibalak_core::motivation::{
        monthly_badge_id, motivation_settings_id, MonthlyBadgeRow, MotivationSettingsRow,
    };
    use bibalak_core::progress::NIL_USER_ID;

    let dev_a = SqliteStorage::open_in_memory().unwrap();
    let dev_b = SqliteStorage::open_in_memory().unwrap();
    let now_base = 1_700_000_000_000_i64;
    dev_a.ensure_collection(now_base).unwrap();
    dev_b.ensure_collection(now_base).unwrap();

    // Device A sets daily_goal_xp = 30 at +1s (onboarding not completed yet)
    dev_a
        .set_daily_goal(NIL_USER_ID, 30, now_base + 1_000)
        .unwrap();
    // Device B completes onboarding at +500ms while daily_goal_xp = 20
    dev_b
        .complete_onboarding(NIL_USER_ID, now_base + 500)
        .unwrap();

    let delta_b = dev_b.export_delta().unwrap();
    assert_eq!(delta_b.motivation_settings.len(), 1);
    dev_a
        .apply_sync_delta(&delta_b, 10, now_base + 2_000)
        .unwrap();

    let state_a = dev_a
        .get_motivation_state(NIL_USER_ID, 0, 0, 4, now_base, now_base + 2_000, false)
        .unwrap();
    // Newer daily_goal_xp (30 at +1s) survives, AND onboarding_completed_at merges via min_some!
    assert_eq!(state_a.daily_goal_xp, 30);
    assert!(state_a.onboarding_completed);

    // Monthly badge merge: active wins over soft-deleted, earned_at/seen_at take min_some, count takes max
    let remote_badge = MonthlyBadgeRow {
        id: monthly_badge_id(NIL_USER_ID, "2026-11"),
        user_id: NIL_USER_ID.into(),
        month_key: "2026-11".into(),
        quest_count_at_earn: 22,
        earned_at: now_base + 300,
        seen_at: Some(now_base + 800),
        created_at: now_base + 300,
        updated_at: now_base + 800,
        deleted_at: None,
        usn: -1,
    };
    let local_deleted_badge = MonthlyBadgeRow {
        id: monthly_badge_id(NIL_USER_ID, "2026-11"),
        user_id: NIL_USER_ID.into(),
        month_key: "2026-11".into(),
        quest_count_at_earn: 20,
        earned_at: now_base + 500,
        seen_at: None,
        created_at: now_base + 500,
        updated_at: now_base + 900,
        deleted_at: Some(now_base + 900),
        usn: -1,
    };
    dev_a
        .apply_sync_delta(
            &bibalak_core::sync::SyncDelta {
                monthly_badges: vec![local_deleted_badge],
                ..Default::default()
            },
            11,
            now_base + 2_500,
        )
        .unwrap();
    dev_a
        .apply_sync_delta(
            &bibalak_core::sync::SyncDelta {
                monthly_badges: vec![remote_badge],
                ..Default::default()
            },
            12,
            now_base + 2_600,
        )
        .unwrap();

    let conn = dev_a.lock();
    let (cnt, earned, seen, del): (i64, i64, Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT quest_count_at_earn, earned_at, seen_at, deleted_at FROM monthly_badges WHERE month_key = '2026-11'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!(cnt, 22);
    assert_eq!(earned, now_base + 300);
    assert_eq!(seen, Some(now_base + 800));
    assert_eq!(del, None);
    drop(conn);

    // Acknowledge clears dirty motivation rows
    {
        let conn = dev_a.lock();
        crate::sync::acknowledge_delta(&conn, 13).unwrap();
    }
    let post_ack = dev_a.export_delta().unwrap();
    assert!(post_ack.motivation_settings.is_empty());
    assert!(post_ack.monthly_badges.is_empty());
    let _ = (
        motivation_settings_id(NIL_USER_ID),
        MotivationSettingsRow::new_default(NIL_USER_ID, 0),
    );
}

#[test]
fn productivity_local_writes_set_usn_minus_one_updated_at_and_soft_delete() {
    use bibalak_core::productivity::{
        entity_id_v5, CalendarEvent, Habit, HabitFrequencyKind, HabitGoalMode, HabitLog,
        HabitLogStatus, HabitSection, TaskItem, TaskList, TaskOrderItem, TaskPriority,
    };
    use bibalak_core::progress::NIL_USER_ID;

    let (dev_a, _, _, _) = setup_db();
    let (dev_b, _, _, _) = setup_db();

    let list_id = "11111111-1111-4111-8111-111111111112".to_string();
    let task_id = "22222222-2222-4222-8222-222222222223".to_string();
    let habit_id = "33333333-3333-4333-8333-333333333334".to_string();
    let log_id = entity_id_v5("habit_log", NIL_USER_ID, &format!("{habit_id}:0"));
    let event_id = "44444444-4444-4444-8444-444444444445".to_string();
    let t0 = 1_700_000_010_000;

    let list = TaskList {
        id: list_id.clone(),
        user_id: NIL_USER_ID.into(),
        name: "Audit List".into(),
        color_token: "accent".into(),
        icon_key: None,
        sort_order: 0,
        created_at: t0,
        updated_at: t0,
        deleted_at: None,
        usn: -1,
    };
    let task = TaskItem {
        id: task_id.clone(),
        user_id: NIL_USER_ID.into(),
        list_id: Some(list_id.clone()),
        title: "Audit Task".into(),
        notes: String::new(),
        priority: TaskPriority::Medium,
        manual_quadrant: None,
        due_date: Some("2026-11-20".into()),
        scheduled_start_ms: None,
        scheduled_end_ms: None,
        tags: vec![],
        deck_id: None,
        completed_at: None,
        completed_day: None,
        sort_order: 0,
        created_at: t0,
        updated_at: t0,
        deleted_at: None,
        usn: -1,
    };
    let habit = Habit {
        id: habit_id.clone(),
        user_id: NIL_USER_ID.into(),
        title: "Audit Habit".into(),
        notes: String::new(),
        icon_key: "check".into(),
        color_token: "success".into(),
        frequency_kind: HabitFrequencyKind::Daily,
        weekdays: vec![],
        weekly_target: None,
        interval_days: None,
        goal_mode: HabitGoalMode::AchieveAll,
        goal_target: 1.0,
        goal_unit: String::new(),
        start_day_index: 0,
        target_days: None,
        section: HabitSection::Morning,
        reminders: vec![],
        auto_popup_log: false,
        deck_id: None,
        archived_at: None,
        sort_order: 0,
        created_at: t0,
        updated_at: t0,
        deleted_at: None,
        usn: -1,
    };
    let log = HabitLog {
        id: log_id.clone(),
        user_id: NIL_USER_ID.into(),
        habit_id: habit_id.clone(),
        day_index: 0,
        logged_value: 1.0,
        goal_target: 1.0,
        completed: true,
        status: HabitLogStatus::Logged,
        mood: None,
        note: String::new(),
        created_at: t0,
        updated_at: t0,
        deleted_at: None,
        usn: -1,
    };
    let event = CalendarEvent {
        id: event_id.clone(),
        user_id: NIL_USER_ID.into(),
        title: "Audit Event".into(),
        description: String::new(),
        location: String::new(),
        color_token: "info".into(),
        start_ms: t0,
        end_ms: t0 + 3_600_000,
        is_all_day: false,
        recurrence: None,
        linked_task_id: Some(task_id.clone()),
        external_account_id: None,
        external_event_id: None,
        created_at: t0,
        updated_at: t0,
        deleted_at: None,
        usn: -1,
    };

    dev_a.upsert_task_list(&list).unwrap();
    dev_a.upsert_task(&task).unwrap();
    dev_a.upsert_habit(&habit).unwrap();
    dev_a.upsert_habit_log(&log, None, None).unwrap();
    dev_a.upsert_calendar_event(&event).unwrap();

    // Sync initial state to dev_b so foreign keys (e.g. task.list_id) exist on dev_b.
    let initial_delta = dev_a.export_delta().unwrap();
    dev_b.apply_sync_delta(&initial_delta, 10, t0).unwrap();

    // Acknowledge so all rows start clean with usn = 10.
    {
        let conn = dev_a.lock();
        super::sync::acknowledge_delta(&conn, 10).unwrap();
    }
    assert!(dev_a.export_delta().unwrap().is_empty());

    // 1. Task mutations: reorder, reschedule, complete, reopen.
    let t1 = t0 + 1_000;
    let t2 = t0 + 2_000;
    let t3 = t0 + 3_000;
    let t4 = t0 + 4_000;
    {
        let mut conn = dev_a.lock();
        super::productivity::reorder_tasks(
            &mut conn,
            NIL_USER_ID,
            &[TaskOrderItem {
                id: task_id.clone(),
                sort_order: 7,
            }],
            t1,
        )
        .unwrap();
        let (usn, upd): (i64, i64) = conn
            .query_row(
                "SELECT usn, updated_at FROM tasks WHERE id = ?1",
                [&task_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(usn, -1);
        assert_eq!(upd, t1);

        super::sync::acknowledge_delta(&conn, 11).unwrap();
        let moved = super::productivity::reschedule_overdue_tasks(
            &mut conn,
            NIL_USER_ID,
            "2026-11-23",
            "2026-11-24",
            t2,
        )
        .unwrap();
        assert_eq!(moved, 1);
        let (usn, upd): (i64, i64) = conn
            .query_row(
                "SELECT usn, updated_at FROM tasks WHERE id = ?1",
                [&task_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(usn, -1);
        assert_eq!(upd, t2);

        super::sync::acknowledge_delta(&conn, 12).unwrap();
        super::productivity::set_task_completion(
            &mut conn,
            NIL_USER_ID,
            &task_id,
            Some(t3),
            Some(0),
            None,
            None,
            t3,
        )
        .unwrap();
        let (usn, upd): (i64, i64) = conn
            .query_row(
                "SELECT usn, updated_at FROM tasks WHERE id = ?1",
                [&task_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(usn, -1);
        assert_eq!(upd, t3);

        super::productivity::set_task_completion(
            &mut conn,
            NIL_USER_ID,
            &task_id,
            None,
            None,
            None,
            None,
            t4,
        )
        .unwrap();
    }

    // 2. Soft-delete and restore task list (also unlinks/relinks child task).
    let t5 = t0 + 5_000;
    let t6 = t0 + 6_000;
    {
        let mut conn = dev_a.lock();
        super::sync::acknowledge_delta(&conn, 13).unwrap();
        let moved_ids =
            super::productivity::soft_delete_task_list(&mut conn, NIL_USER_ID, &list_id, t5)
                .unwrap();
        assert_eq!(moved_ids, vec![task_id.clone()]);
        let (del, usn, upd, uid): (Option<i64>, i64, i64, String) = conn
            .query_row(
                "SELECT deleted_at, usn, updated_at, user_id FROM task_lists WHERE id = ?1",
                [&list_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(del, Some(t5));
        assert_eq!(usn, -1);
        assert_eq!(upd, t5);
        assert_eq!(uid, NIL_USER_ID);
        let (task_usn, task_list_id): (i64, Option<String>) = conn
            .query_row(
                "SELECT usn, list_id FROM tasks WHERE id = ?1",
                [&task_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(task_usn, -1);
        assert_eq!(task_list_id, None);

        super::sync::acknowledge_delta(&conn, 14).unwrap();
        super::productivity::restore_task_list(&mut conn, NIL_USER_ID, &list_id, &moved_ids, t6)
            .unwrap();
        let (del, usn, upd): (Option<i64>, i64, i64) = conn
            .query_row(
                "SELECT deleted_at, usn, updated_at FROM task_lists WHERE id = ?1",
                [&list_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(del, None);
        assert_eq!(usn, -1);
        assert_eq!(upd, t6);
    }

    // 3. Soft-delete and restore task, habit (+ habit_logs), and calendar_event.
    let t7 = t0 + 7_000;
    let t8 = t0 + 8_000;
    let t9 = t0 + 9_000;
    let t10 = t0 + 10_000;
    {
        let mut conn = dev_a.lock();
        super::sync::acknowledge_delta(&conn, 15).unwrap();
        super::productivity::soft_delete_task(&conn, NIL_USER_ID, &task_id, t7).unwrap();
        super::productivity::soft_delete_habit(&mut conn, NIL_USER_ID, &habit_id, t7).unwrap();
        super::productivity::soft_delete_calendar_event(&conn, NIL_USER_ID, &event_id, t7).unwrap();

        for (table, id) in [
            ("tasks", &task_id),
            ("habits", &habit_id),
            ("habit_logs", &log_id),
            ("calendar_events", &event_id),
        ] {
            let (del, usn, upd): (Option<i64>, i64, i64) = conn
                .query_row(
                    &format!("SELECT deleted_at, usn, updated_at FROM {table} WHERE id = ?1"),
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .unwrap();
            assert_eq!(
                del,
                Some(t7),
                "{table} must be soft-deleted, not hard-deleted"
            );
            assert_eq!(usn, -1, "{table} soft-delete must set usn = -1");
            assert_eq!(upd, t7, "{table} soft-delete must set updated_at");
        }
    }

    // Export soft-deletes to dev_b and verify tombstone propagation.
    let delete_delta = dev_a.export_delta().unwrap();
    assert_eq!(delete_delta.tasks.len(), 1);
    assert_eq!(delete_delta.habits.len(), 1);
    assert_eq!(delete_delta.habit_logs.len(), 1);
    assert_eq!(delete_delta.calendar_events.len(), 1);
    dev_b.apply_sync_delta(&delete_delta, 20, t8).unwrap();
    assert!(dev_b.get_task(NIL_USER_ID, &task_id).unwrap().is_none());
    assert!(dev_b.get_habit(NIL_USER_ID, &habit_id).unwrap().is_none());
    assert!(dev_b
        .get_calendar_event(NIL_USER_ID, &event_id)
        .unwrap()
        .is_none());

    // Restore on dev_a and verify restore_habit_log_snapshot(None) soft-deletes with usn = -1.
    {
        let mut conn = dev_a.lock();
        super::productivity::restore_task(&conn, NIL_USER_ID, &task_id, t9).unwrap();
        super::productivity::restore_habit(
            &mut conn,
            NIL_USER_ID,
            &habit_id,
            std::slice::from_ref(&log_id),
            t9,
        )
        .unwrap();
        super::productivity::restore_calendar_event(&conn, NIL_USER_ID, &event_id, t9).unwrap();

        super::sync::acknowledge_delta(&conn, 21).unwrap();
        super::productivity::restore_habit_log_snapshot(
            &mut conn,
            NIL_USER_ID,
            &habit_id,
            0,
            None,
            None,
            None,
            t10,
        )
        .unwrap();
        let (del, usn, upd): (Option<i64>, i64, i64) = conn
            .query_row(
                "SELECT deleted_at, usn, updated_at FROM habit_logs WHERE id = ?1",
                [&log_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(del, Some(t10));
        assert_eq!(usn, -1);
        assert_eq!(upd, t10);
    }
}

#[test]
fn sync_delta_roundtrips_habit_log_v11_statuses_skipped_and_frozen() {
    use bibalak_core::productivity::{
        entity_id_v5, Habit, HabitFrequencyKind, HabitGoalMode, HabitLog, HabitLogStatus,
        HabitSection,
    };
    use bibalak_core::progress::NIL_USER_ID;

    let (dev_a, _, _, _) = setup_db();
    let (dev_b, _, _, _) = setup_db();
    let t0 = 1_700_000_020_000;
    let habit_id = "55555555-5555-4555-8555-555555555555".to_string();

    let habit = Habit {
        id: habit_id.clone(),
        user_id: NIL_USER_ID.into(),
        title: "Status Sync Habit".into(),
        notes: String::new(),
        icon_key: "flame".into(),
        color_token: "accent".into(),
        frequency_kind: HabitFrequencyKind::Daily,
        weekdays: vec![],
        weekly_target: None,
        interval_days: None,
        goal_mode: HabitGoalMode::AchieveAll,
        goal_target: 1.0,
        goal_unit: String::new(),
        start_day_index: 0,
        target_days: None,
        section: HabitSection::Others,
        reminders: vec![],
        auto_popup_log: false,
        deck_id: None,
        archived_at: None,
        sort_order: 0,
        created_at: t0,
        updated_at: t0,
        deleted_at: None,
        usn: -1,
    };
    let skipped = HabitLog {
        id: entity_id_v5("habit_log", NIL_USER_ID, &format!("{habit_id}:1")),
        user_id: NIL_USER_ID.into(),
        habit_id: habit_id.clone(),
        day_index: 1,
        logged_value: 0.0,
        goal_target: 1.0,
        completed: false,
        status: HabitLogStatus::Skipped,
        mood: None,
        note: "Rest day".into(),
        created_at: t0 + 100,
        updated_at: t0 + 100,
        deleted_at: None,
        usn: -1,
    };
    let frozen = HabitLog {
        id: entity_id_v5("habit_log", NIL_USER_ID, &format!("{habit_id}:2")),
        user_id: NIL_USER_ID.into(),
        habit_id: habit_id.clone(),
        day_index: 2,
        logged_value: 0.0,
        goal_target: 1.0,
        completed: false,
        status: HabitLogStatus::Frozen,
        mood: None,
        note: "Freeze token".into(),
        created_at: t0 + 200,
        updated_at: t0 + 200,
        deleted_at: None,
        usn: -1,
    };

    dev_a.upsert_habit(&habit).unwrap();
    dev_a.upsert_habit_log(&skipped, None, None).unwrap();
    dev_a.upsert_habit_log(&frozen, None, None).unwrap();

    let delta = dev_a.export_delta().unwrap();
    assert_eq!(delta.habit_logs.len(), 2);

    let summary = dev_b.apply_sync_delta(&delta, 55, t0 + 500).unwrap();
    assert_eq!(summary.habit_logs_updated, 2);

    let logs = dev_b.list_habit_logs_range(NIL_USER_ID, 1, 2).unwrap();
    assert_eq!(logs.len(), 2);
    assert_eq!(logs[0].day_index, 1);
    assert_eq!(logs[0].status, HabitLogStatus::Skipped);
    assert_eq!(logs[0].usn, 55);
    assert_eq!(logs[1].day_index, 2);
    assert_eq!(logs[1].status, HabitLogStatus::Frozen);
    assert_eq!(logs[1].usn, 55);

    {
        let conn = dev_a.lock();
        super::sync::acknowledge_delta(&conn, 55).unwrap();
    }
    assert!(dev_a.export_delta().unwrap().is_empty());
}
