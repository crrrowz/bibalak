use std::path::{Path, PathBuf};

use bibalak_core::ipc::BatchNoteInput;
use bibalak_core::model::Revlog;
use bibalak_core::ports::*;
use bibalak_core::productivity::{
    entity_id_v5, CalendarEvent, Habit, HabitFrequencyKind, HabitGoalMode, HabitLog,
    HabitLogStatus, HabitSection, TaskItem, TaskList, TaskPriority,
};
use bibalak_core::progress::NIL_USER_ID;
use bibalak_core::scheduling::CardPhase;
use bibalak_db::backup::{create_zip, extract_db_from_zip, validate_sqlite_file};
use bibalak_db::SqliteStorage;

const T0: i64 = 1_794_830_400_000;

struct H2TempDir(PathBuf);

impl H2TempDir {
    fn new(label: &str) -> Self {
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "keepsake_h2_int_{label}_{}_{n}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for H2TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn backup_and_restore_roundtrip_preserves_notes_cards_revlog_media_and_productivity() {
    let dir = H2TempDir::new("backup_roundtrip");
    let db_path = dir.path().join("collection.sqlite");
    let media_dir = dir.path().join("media");
    let backup_sqlite = dir.path().join("hot_backup.sqlite");
    let zip_path = dir.path().join("backup.zip");
    let restored_db = dir.path().join("restored.sqlite");
    std::fs::create_dir_all(&media_dir).unwrap();

    std::fs::write(media_dir.join("diagram.png"), b"png-bytes").unwrap();
    std::fs::write(media_dir.join("audio.mp3"), b"mp3-bytes").unwrap();

    let storage = SqliteStorage::open(&db_path).unwrap();
    storage.ensure_collection(T0).unwrap();
    let nt_id = storage.add_stock_notetype(0, T0).unwrap();

    let (note1_id, _) = storage
        .add_note_with_cards(
            nt_id,
            1,
            &[r#"Front <img src="diagram.png">"#.into(), "Back 1".into()],
            &["anatomy".into()],
            T0,
        )
        .unwrap();
    let (note2_id, _) = storage
        .add_note_with_cards(
            nt_id,
            1,
            &["Front 2 [sound:audio.mp3]".into(), "Back 2".into()],
            &[],
            T0 + 1,
        )
        .unwrap();

    let cards = storage.search_cards("", 0, T0, 50, 0, None, true).unwrap();
    assert_eq!(cards.len(), 2);
    let card0 = storage.study_card(cards[0].card_id).unwrap().unwrap();
    let mut next_state = card0.state;
    next_state.phase = CardPhase::Review;
    next_state.reps = 1;
    next_state.interval_days = 4;
    let revlog = Revlog {
        id: T0 + 100,
        card_id: card0.id,
        usn: -1,
        ease: 3,
        interval: 4,
        last_interval: 0,
        ease_factor: 2500,
        taken_ms: 1500,
        review_kind: 1,
    };
    storage
        .apply_answer(card0.id, &next_state, 4, &revlog, None)
        .unwrap();

    let list_id = "11111111-1111-4111-8111-111111111111".to_string();
    let task_id = "22222222-2222-4222-8222-222222222222".to_string();
    let habit_id = "33333333-3333-4333-8333-333333333333".to_string();
    let log_id = entity_id_v5("habit_log", NIL_USER_ID, &format!("{habit_id}:0"));
    let event_id = "44444444-4444-4444-8444-444444444444".to_string();

    storage
        .upsert_task_list(&TaskList {
            id: list_id.clone(),
            user_id: NIL_USER_ID.into(),
            name: "Backup List".into(),
            color_token: "accent".into(),
            icon_key: None,
            sort_order: 0,
            created_at: T0,
            updated_at: T0,
            deleted_at: None,
            usn: -1,
        })
        .unwrap();
    storage
        .upsert_task(&TaskItem {
            id: task_id.clone(),
            user_id: NIL_USER_ID.into(),
            list_id: Some(list_id),
            title: "Backup Task".into(),
            notes: String::new(),
            priority: TaskPriority::High,
            manual_quadrant: None,
            due_date: None,
            scheduled_start_ms: None,
            scheduled_end_ms: None,
            tags: vec![],
            deck_id: Some(1),
            completed_at: None,
            completed_day: None,
            sort_order: 0,
            created_at: T0,
            updated_at: T0,
            deleted_at: None,
            usn: -1,
        })
        .unwrap();
    storage
        .upsert_habit(&Habit {
            id: habit_id.clone(),
            user_id: NIL_USER_ID.into(),
            title: "Backup Habit".into(),
            notes: String::new(),
            icon_key: "book".into(),
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
            created_at: T0,
            updated_at: T0,
            deleted_at: None,
            usn: -1,
        })
        .unwrap();
    storage
        .upsert_habit_log(
            &HabitLog {
                id: log_id,
                user_id: NIL_USER_ID.into(),
                habit_id: habit_id.clone(),
                day_index: 0,
                logged_value: 1.0,
                goal_target: 1.0,
                completed: true,
                status: HabitLogStatus::Logged,
                mood: None,
                note: String::new(),
                created_at: T0,
                updated_at: T0,
                deleted_at: None,
                usn: -1,
            },
            None,
            None,
        )
        .unwrap();
    storage
        .upsert_calendar_event(&CalendarEvent {
            id: event_id.clone(),
            user_id: NIL_USER_ID.into(),
            title: "Backup Event".into(),
            description: String::new(),
            location: String::new(),
            color_token: "info".into(),
            start_ms: T0,
            end_ms: T0 + 3_600_000,
            is_all_day: false,
            recurrence: None,
            linked_task_id: Some(task_id.clone()),
            external_account_id: None,
            external_event_id: None,
            created_at: T0,
            updated_at: T0,
            deleted_at: None,
            usn: -1,
        })
        .unwrap();

    storage.backup_db(&backup_sqlite).unwrap();
    let zip_bytes = create_zip(&backup_sqlite, &media_dir, &zip_path).unwrap();
    assert!(zip_bytes > 0);
    drop(storage);

    extract_db_from_zip(&zip_path, &restored_db).unwrap();
    let validation = validate_sqlite_file(&restored_db).unwrap();
    assert!(validation.is_empty(), "validation errors: {validation:?}");

    let restored = SqliteStorage::open(&restored_db).unwrap();
    assert_eq!(restored.list_notes(None, 50).unwrap().len(), 2);
    assert!(restored.note_detail(note1_id).unwrap().is_some());
    assert!(restored.note_detail(note2_id).unwrap().is_some());

    let media_refs = restored.note_media_refs().unwrap();
    assert!(media_refs.contains(&"diagram.png".to_string()));
    assert!(media_refs.contains(&"audio.mp3".to_string()));

    let restored_card0 = restored.study_card(card0.id).unwrap().unwrap();
    assert_eq!(restored_card0.state.reps, 1);
    assert_eq!(restored_card0.state.interval_days, 4);

    let revlogs = restored.revlogs_for_optimize(None).unwrap();
    assert_eq!(revlogs.len(), 1);
    assert_eq!(revlogs[0].card_id, card0.id);

    assert_eq!(restored.list_task_lists(NIL_USER_ID).unwrap().len(), 1);
    assert_eq!(
        restored
            .get_task(NIL_USER_ID, &task_id)
            .unwrap()
            .unwrap()
            .title,
        "Backup Task"
    );
    assert_eq!(
        restored
            .get_habit(NIL_USER_ID, &habit_id)
            .unwrap()
            .unwrap()
            .title,
        "Backup Habit"
    );
    assert_eq!(
        restored
            .list_habit_logs_range(NIL_USER_ID, 0, 0)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        restored
            .get_calendar_event(NIL_USER_ID, &event_id)
            .unwrap()
            .unwrap()
            .title,
        "Backup Event"
    );
}

#[test]
fn integrity_check_on_large_collection_passes_and_repairs_orphan_subdecks() {
    let dir = H2TempDir::new("large_integrity");
    let db_path = dir.path().join("collection.sqlite");
    let storage = SqliteStorage::open(&db_path).unwrap();
    storage.ensure_collection(T0).unwrap();
    let nt_id = storage.add_stock_notetype(0, T0).unwrap();
    let deck = storage.create_deck("LargeDeck", T0).unwrap();

    // Create an orphan subdeck whose ancestors do not exist yet. `create_deck`
    // now makes missing parents (SUB1), so write the broken row directly, as
    // an old collection or a buggy sync could have left it.
    rusqlite::Connection::open(&db_path)
        .unwrap()
        .execute(
            r#"INSERT INTO decks (name, parent_id, config_id, "mod", usn)
               VALUES ('OrphanRoot::Branch::Leaf', NULL, 1, ?1, -1)"#,
            [T0],
        )
        .unwrap();

    // Seed 2,200 notes/cards in one batch.
    let batch: Vec<BatchNoteInput> = (0..2_200)
        .map(|i| BatchNoteInput {
            fields: vec![format!("Front {i}"), format!("Back {i}")],
            tags: vec!["bulk".into()],
        })
        .collect();
    let (note_ids, cards_added) = storage.add_notes_batch(nt_id, deck.id, &batch, T0).unwrap();
    assert_eq!(note_ids.len(), 2_200);
    assert_eq!(cards_added, 2_200);

    // Seed 50 revlog rows.
    let cards = storage.search_cards("", 0, T0, 50, 0, None, true).unwrap();
    assert_eq!(cards.len(), 50);
    for (idx, row) in cards.iter().enumerate() {
        let card = storage.study_card(row.card_id).unwrap().unwrap();
        let mut next_state = card.state;
        next_state.phase = CardPhase::Review;
        next_state.reps = 1;
        next_state.interval_days = 2;
        let log = Revlog {
            id: T0 + 10_000 + idx as i64,
            card_id: card.id,
            usn: -1,
            ease: 3,
            interval: 2,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 900,
            review_kind: 1,
        };
        storage
            .apply_answer(card.id, &next_state, 2, &log, None)
            .unwrap();
    }

    let report = storage.integrity_check(T0 + 20_000).unwrap();
    assert_eq!(
        report.len(),
        1,
        "expected only orphan repair message: {report:?}"
    );
    assert!(
        report[0].contains("Repaired 1 orphan subdeck(s)"),
        "unexpected integrity report: {report:?}"
    );

    let decks = storage.list_decks().unwrap();
    let root = decks
        .iter()
        .find(|d| d.name == "OrphanRoot")
        .expect("OrphanRoot synthesized");
    let branch = decks
        .iter()
        .find(|d| d.name == "OrphanRoot::Branch")
        .expect("OrphanRoot::Branch synthesized");
    let leaf = decks
        .iter()
        .find(|d| d.name == "OrphanRoot::Branch::Leaf")
        .expect("leaf present");
    assert_eq!(branch.parent_id, Some(root.id));
    assert_eq!(leaf.parent_id, Some(branch.id));

    let second = storage.integrity_check(T0 + 30_000).unwrap();
    assert!(
        second.is_empty(),
        "second integrity_check should be clean: {second:?}"
    );
}
