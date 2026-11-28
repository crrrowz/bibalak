use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use bibalak_core::model::{Card, Deck, Field, Note, Notetype, Revlog, Template};
use bibalak_core::ports::{MaintenanceStore, TestClock};
use bibalak_core::progress::NIL_USER_ID;
use bibalak_core::scheduling::{CardPhase, CardState};
use bibalak_core::{CanonicalModel, Clock, Collection};
use bibalak_db::SqliteStorage;
use rusqlite::{params, Connection};

const BASE_MS: i64 = 1_795_341_600_000; // 2026-11-21 ~10:00 UTC

struct TempDbDir(PathBuf);

impl TempDbDir {
    fn new(label: &str) -> Self {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("bibalak_a303_{label}_{}_{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}

impl Drop for TempDbDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn setup_on_disk(label: &str) -> (TempDbDir, PathBuf, Collection, Arc<TestClock>) {
    let dir = TempDbDir::new(label);
    let db_path = dir.0.join("collection.sqlite");
    let storage = SqliteStorage::open(&db_path).unwrap();
    storage.ensure_collection(BASE_MS).unwrap();
    let clock = Arc::new(TestClock::new(BASE_MS));
    let c = Collection::new(Box::new(storage), clock.clone()).unwrap();
    (dir, db_path, c, clock)
}

fn seed_study_deck_cards(c: &Collection, count: usize) -> (i64, Vec<(i64, i64)>) {
    let cards: Vec<Card> = (1..=count as i64)
        .map(|i| Card {
            id: i,
            note_id: i,
            deck_id: 2,
            ord: 0,
            mod_ms: 0,
            usn: 0,
            ctype: 0,
            queue: 0,
            due: 0,
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
        })
        .collect();

    let model = CanonicalModel {
        decks: vec![
            Deck {
                id: 1,
                name: "Default".into(),
                parent_id: None,
                config_id: 1,
                mod_ms: 0,
                usn: 0,
                collapsed: false,
                is_filtered: false,
            },
            Deck {
                id: 2,
                name: "StudyDeck".into(),
                parent_id: None,
                config_id: 1,
                mod_ms: 0,
                usn: 0,
                collapsed: false,
                is_filtered: false,
            },
        ],
        deck_configs: vec![],
        notetypes: vec![Notetype {
            id: 1,
            name: "Basic".into(),
            kind: 0,
            mod_ms: 0,
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
        notes: cards
            .iter()
            .map(|card| Note {
                id: card.note_id,
                guid: format!("a303-g{}", card.note_id),
                notetype_id: 1,
                mod_ms: 0,
                usn: 0,
                tags: vec![],
                fields: vec![format!("Q{}", card.id), format!("A{}", card.id)],
                sort_field: Some(format!("Q{}", card.id)),
                checksum: None,
            })
            .collect(),
        cards,
        revlog: vec![],
        created_ms: None,
    };
    c.import(&model).unwrap();

    let deck_id = c
        .list_decks()
        .unwrap()
        .into_iter()
        .find(|d| d.name == "StudyDeck")
        .unwrap()
        .id;
    let rows = c
        .search_cards("deck:\"StudyDeck\"", 100, 0, None, true)
        .unwrap();
    let pairs = rows.into_iter().map(|r| (r.card_id, r.note_id)).collect();
    (deck_id, pairs)
}

fn answer_card_today(c: &Collection, clock: &TestClock, card_id: i64, deck_id: i64, idx: i64) {
    let next = CardState {
        phase: CardPhase::Review,
        interval_days: 1,
        ease_milli: 2500,
        reps: 1,
        lapses: 0,
        steps_remaining: 0,
        stability: Some(2.0),
        difficulty: Some(5.0),
        last_review_day: Some(c.today()),
    };
    c.apply_answer(
        card_id,
        deck_id,
        &CardState::new(2500),
        0,
        &next,
        1,
        &Revlog {
            id: clock.now_ms() + idx,
            card_id,
            usn: -1,
            ease: 3,
            interval: 1,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 5_000,
            review_kind: 0,
        },
        10,
    )
    .unwrap();
}

fn seed_depth_caches(db_path: &std::path::Path) {
    let conn = Connection::open(db_path).unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?1, '150')",
        [format!("game:earned_xp:{NIL_USER_ID}")],
    )
    .unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('game:studied_top_decks', '[2]')",
        [],
    )
    .unwrap();
}

fn depth_cache_count(db_path: &std::path::Path) -> (i64, i64) {
    let conn = Connection::open(db_path).unwrap();
    let xp_rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sync_state WHERE key = ?1",
            params![format!("game:earned_xp:{NIL_USER_ID}")],
            |r| r.get(0),
        )
        .unwrap();
    let deck_rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sync_state WHERE key = 'game:studied_top_decks'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    (xp_rows, deck_rows)
}

#[test]
fn a3_03_remove_deck_revokes_unheld_quests_invalidates_caches_and_keeps_earned_xp() {
    let (_dir, db_path, c, clock) = setup_on_disk("remove_deck");
    let (deck_id, pairs) = seed_study_deck_cards(&c, 15);

    for (idx, (card_id, _)) in pairs.iter().enumerate() {
        answer_card_today(&c, &clock, *card_id, deck_id, idx as i64 + 1);
    }
    seed_depth_caches(&db_path);

    let before = c.get_motivation_state().unwrap();
    let q_before = before
        .daily_quests
        .iter()
        .find(|q| q.id == "reviews_15")
        .unwrap();
    assert!(q_before.completed);
    let summary_before = c.progress_summary().unwrap();
    assert_eq!(summary_before.total_xp, 45);

    c.remove_deck(deck_id).unwrap();

    let after = c.get_motivation_state().unwrap();
    let q_after = after
        .daily_quests
        .iter()
        .find(|q| q.id == "reviews_15")
        .unwrap();
    assert_eq!(q_after.progress, 0);
    assert!(!q_after.completed);

    let summary_after = c.progress_summary().unwrap();
    // Quest gold (+200) is revoked, while already-earned review XP (45) stays.
    assert!(summary_after.gold_cents < summary_before.gold_cents);
    assert_eq!(summary_after.total_xp, summary_before.total_xp);
    assert_eq!(depth_cache_count(&db_path), (0, 0));
}

#[test]
fn a3_03_delete_notes_revokes_unheld_quests_invalidates_caches_and_keeps_earned_xp() {
    let (_dir, db_path, c, clock) = setup_on_disk("delete_notes");
    let (deck_id, pairs) = seed_study_deck_cards(&c, 15);

    for (idx, (card_id, _)) in pairs.iter().enumerate() {
        answer_card_today(&c, &clock, *card_id, deck_id, idx as i64 + 1);
    }
    seed_depth_caches(&db_path);

    let before = c.get_motivation_state().unwrap();
    let q_before = before
        .daily_quests
        .iter()
        .find(|q| q.id == "reviews_15")
        .unwrap();
    assert!(q_before.completed);
    let summary_before = c.progress_summary().unwrap();
    assert_eq!(summary_before.total_xp, 45);

    let note_ids: Vec<i64> = pairs.into_iter().map(|(_, note_id)| note_id).collect();
    c.delete_notes(&note_ids).unwrap();

    let after = c.get_motivation_state().unwrap();
    let q_after = after
        .daily_quests
        .iter()
        .find(|q| q.id == "reviews_15")
        .unwrap();
    assert_eq!(q_after.progress, 0);
    assert!(!q_after.completed);

    let summary_after = c.progress_summary().unwrap();
    assert!(summary_after.gold_cents < summary_before.gold_cents);
    assert_eq!(summary_after.total_xp, summary_before.total_xp);
    assert_eq!(depth_cache_count(&db_path), (0, 0));
}
