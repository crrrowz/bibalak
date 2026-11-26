//! SQLite schema v10 migration, deck soft-link, and atomic reward hook tests (ADR-018 §2.13 item 3).

use bibalak_core::ports::*;
use bibalak_core::productivity::{
    entity_id_v5, Habit, HabitFrequencyKind, HabitGoalMode, HabitLog, HabitLogStatus, HabitSection,
    TaskItem, TaskOrderItem, TaskPriority,
};
use bibalak_core::progress::{ledger_id, RewardGrant, NIL_USER_ID};
use rusqlite::{params, Connection, OptionalExtension};

use crate::schema::MIGRATIONS;
use crate::SqliteStorage;

fn make_task(id: &str, deck_id: Option<i64>) -> TaskItem {
    TaskItem {
        id: id.to_string(),
        user_id: NIL_USER_ID.to_string(),
        list_id: None,
        title: "Review lecture".to_string(),
        notes: String::new(),
        priority: TaskPriority::Medium,
        manual_quadrant: None,
        due_date: Some("2026-11-22".to_string()),
        scheduled_start_ms: None,
        scheduled_end_ms: None,
        tags: vec!["study".to_string()],
        deck_id,
        completed_at: None,
        completed_day: None,
        sort_order: 0,
        created_at: 1_000,
        updated_at: 1_000,
        deleted_at: None,
        usn: -1,
    }
}

fn make_habit(id: &str, deck_id: Option<i64>) -> Habit {
    Habit {
        id: id.to_string(),
        user_id: NIL_USER_ID.to_string(),
        title: "Daily cards".to_string(),
        notes: String::new(),
        icon_key: "check-circle".to_string(),
        color_token: "accent".to_string(),
        frequency_kind: HabitFrequencyKind::Daily,
        weekdays: vec![],
        weekly_target: None,
        interval_days: None,
        goal_mode: HabitGoalMode::ReachAmount,
        goal_target: 20.0,
        goal_unit: "cards".to_string(),
        start_day_index: 0,
        target_days: None,
        section: HabitSection::Morning,
        reminders: vec![],
        auto_popup_log: false,
        deck_id,
        archived_at: None,
        sort_order: 0,
        created_at: 1_000,
        updated_at: 1_000,
        deleted_at: None,
        usn: -1,
    }
}

#[test]
fn migration_v9_to_v10_upgrades_real_v9_fixture_and_seeds_quadrants() {
    let mut conn = Connection::open_in_memory().unwrap();
    for (version, sql) in MIGRATIONS.iter().take(9).enumerate() {
        conn.execute_batch(sql).unwrap();
        conn.pragma_update(None, "user_version", version as i64 + 1)
            .unwrap();
    }

    // Seed real v9 Anki + progress_ledger rows before running v10 migration.
    conn.execute_batch(
        r#"INSERT INTO collection (id, created, modified, schema_mod, anki_ver, usn, last_sync, config)
           VALUES (1, 1000, 2000, 1000, 18, 0, 0, '{}');
           INSERT INTO notetypes (id, name, kind, "mod", usn, config) VALUES (10, 'Basic', 0, 0, 0, '{}');
           INSERT INTO notes (id, guid, notetype_id, "mod", usn, tags, fields) VALUES (100, 'g1', 10, 0, 0, '', 'q' || char(31) || 'a');
           INSERT INTO cards (id, note_id, deck_id, ord, "mod", type, queue, due) VALUES (1000, 100, 1, 0, 0, 0, 0, 0);"#,
    )
    .unwrap();
    let review_key = "card_review:1000:0";
    let review_ledger_id = ledger_id(NIL_USER_ID, review_key);
    conn.execute(
        "INSERT INTO progress_ledger (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, 3, 25, 1000, 1000, NULL, 0)",
        params![review_ledger_id, NIL_USER_ID, review_key],
    )
    .unwrap();

    crate::migrations::run(&mut conn).unwrap();

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, MIGRATIONS.len() as i64);

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
        assert_eq!(count, 1, "table {table} must exist after v10 migration");
    }

    // Existing Anki and progress_ledger rows remain intact.
    let kept_xp: i64 = conn
        .query_row(
            "SELECT xp FROM progress_ledger WHERE id = ?1",
            [&review_ledger_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(kept_xp, 3);

    // Seeded matrix_quadrants match deterministic UUIDv5 IDs with usn == 0.
    for key in ["q1", "q2", "q3", "q4"] {
        let expected_id = entity_id_v5("matrix_quadrant", NIL_USER_ID, key);
        let (id, usn, created_at, updated_at): (String, i64, i64, i64) = conn
            .query_row(
                "SELECT id, usn, created_at, updated_at FROM matrix_quadrants WHERE user_id = ?1 AND quadrant_key = ?2",
                params![NIL_USER_ID, key],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(id, expected_id);
        assert_eq!(usn, 0);
        assert_eq!(created_at, 0);
        assert_eq!(updated_at, 0);
    }

    // CHECK & json_valid constraints enforce invalid inputs across all 6 tables.
    assert!(conn
        .execute(
            "INSERT INTO task_lists (id, name, created_at, updated_at) VALUES ('l1', '   ', 1, 1)",
            [],
        )
        .is_err());
    assert!(conn
        .execute(
            "INSERT INTO tasks (id, title, priority, created_at, updated_at) VALUES ('t1', 'ok', 'urgent', 1, 1)",
            [],
        )
        .is_err());
    assert!(conn
        .execute(
            "INSERT INTO tasks (id, title, due_date, created_at, updated_at) VALUES ('t2', 'ok', '2026-2-1', 1, 1)",
            [],
        )
        .is_err());
    assert!(conn
        .execute(
            "INSERT INTO tasks (id, title, scheduled_start_ms, scheduled_end_ms, created_at, updated_at) VALUES ('t3', 'ok', 100, NULL, 1, 1)",
            [],
        )
        .is_err());
    assert!(conn
        .execute(
            "INSERT INTO tasks (id, title, scheduled_start_ms, scheduled_end_ms, created_at, updated_at) VALUES ('t4', 'ok', 200, 100, 1, 1)",
            [],
        )
        .is_err());
    assert!(conn
        .execute(
            "INSERT INTO tasks (id, title, tags_json, created_at, updated_at) VALUES ('t5', 'ok', '{bad', 1, 1)",
            [],
        )
        .is_err());
    assert!(conn
        .execute(
            "INSERT INTO matrix_quadrants (id, quadrant_key, color_token, rule_json, created_at, updated_at) VALUES ('mq1', 'q5', 'danger', '{}', 1, 1)",
            [],
        )
        .is_err());
    assert!(conn
        .execute(
            "INSERT INTO habits (id, title, goal_target, start_day_index, created_at, updated_at) VALUES ('h1', 'ok', 0.0, 0, 1, 1)",
            [],
        )
        .is_err());
    assert!(conn
        .execute(
            "INSERT INTO habits (id, title, weekdays_json, start_day_index, created_at, updated_at) VALUES ('h2', 'ok', '[bad', 0, 1, 1)",
            [],
        )
        .is_err());
    conn.execute(
        "INSERT INTO habits (id, title, start_day_index, created_at, updated_at) VALUES ('h_ok', 'Valid', 0, 1, 1)",
        [],
    )
    .unwrap();
    assert!(conn
        .execute(
            "INSERT INTO habit_logs (id, habit_id, day_index, logged_value, created_at, updated_at) VALUES ('hl1', 'h_ok', 0, -1.0, 1, 1)",
            [],
        )
        .is_err());
    assert!(conn
        .execute(
            "INSERT INTO habit_logs (id, habit_id, day_index, mood, created_at, updated_at) VALUES ('hl2', 'h_ok', 1, 6, 1, 1)",
            [],
        )
        .is_err());
    assert!(conn
        .execute(
            "INSERT INTO calendar_events (id, title, start_ms, end_ms, created_at, updated_at) VALUES ('ce1', 'ok', 200, 100, 1, 1)",
            [],
        )
        .is_err());
    assert!(conn
        .execute(
            "INSERT INTO calendar_events (id, title, start_ms, end_ms, recurrence_until_date, recurrence_count, created_at, updated_at) VALUES ('ce2', 'ok', 100, 200, '2026-12-31', 5, 1, 1)",
            [],
        )
        .is_err());
}

#[test]
fn deleted_deck_leaves_task_and_habit_links_recoverable_on_undo() {
    let storage = SqliteStorage::open_in_memory().unwrap();
    storage.ensure_collection(1_000).unwrap();
    let deck = storage.create_deck("Pharmacology", 1_000).unwrap();

    let task = make_task("11111111-1111-4111-8111-111111111111", Some(deck.id));
    let habit = make_habit("22222222-2222-4222-8222-222222222222", Some(deck.id));
    storage.upsert_task(&task).unwrap();
    storage.upsert_habit(&habit).unwrap();

    let lookup_names = |s: &SqliteStorage| -> (Option<String>, Option<String>) {
        let conn = s.lock();
        let t_name: Option<String> = conn
            .query_row(
                "SELECT d.name FROM tasks t LEFT JOIN decks d ON d.id = t.deck_id WHERE t.id = ?1",
                [&task.id],
                |r| r.get(0),
            )
            .unwrap();
        let h_name: Option<String> = conn
            .query_row(
                "SELECT d.name FROM habits h LEFT JOIN decks d ON d.id = h.deck_id WHERE h.id = ?1",
                [&habit.id],
                |r| r.get(0),
            )
            .unwrap();
        (t_name, h_name)
    };

    assert_eq!(
        lookup_names(&storage),
        (
            Some("Pharmacology".to_string()),
            Some("Pharmacology".to_string())
        )
    );

    let removed = storage.remove_deck(deck.id, 2_000).unwrap();
    {
        let conn = storage.lock();
        let mut fk = conn.prepare("PRAGMA foreign_key_check").unwrap();
        assert!(fk.query([]).unwrap().next().unwrap().is_none());
    }
    assert_eq!(
        storage
            .get_task(NIL_USER_ID, &task.id)
            .unwrap()
            .unwrap()
            .deck_id,
        Some(deck.id)
    );
    assert_eq!(
        storage
            .get_habit(NIL_USER_ID, &habit.id)
            .unwrap()
            .unwrap()
            .deck_id,
        Some(deck.id)
    );
    assert_eq!(lookup_names(&storage), (None, None));

    storage.restore_deck(&removed, 3_000).unwrap();
    assert_eq!(
        lookup_names(&storage),
        (
            Some("Pharmacology".to_string()),
            Some("Pharmacology".to_string())
        )
    );
}

#[test]
fn task_and_habit_reward_hook_commits_and_revokes_atomically() {
    let storage = SqliteStorage::open_in_memory().unwrap();
    storage.ensure_collection(1_000).unwrap();

    let task_id = "33333333-3333-4333-8333-333333333333";
    let task2_id = "44444444-4444-4444-8444-444444444444";
    let habit_id = "55555555-5555-4555-8555-555555555555";
    storage.upsert_task(&make_task(task_id, None)).unwrap();
    storage.upsert_task(&make_task(task2_id, None)).unwrap();
    storage.upsert_habit(&make_habit(habit_id, None)).unwrap();

    let ledger_deleted_at = |source_key: &str| -> Option<Option<i64>> {
        storage
            .lock()
            .query_row(
                "SELECT deleted_at FROM progress_ledger WHERE user_id = ?1 AND source_key = ?2",
                params![NIL_USER_ID, source_key],
                |r| r.get(0),
            )
            .optional()
            .unwrap()
    };

    // 1. Task completion grant + duplicate no-op + reopen revocation
    let task_key = format!("task_done:{task_id}");
    let task_grant = RewardGrant {
        id: ledger_id(NIL_USER_ID, &task_key),
        user_id: NIL_USER_ID.to_string(),
        source_key: task_key.clone(),
        xp: 10,
        gold_cents: 100,
        now_ms: 2_000,
    };
    assert!(storage
        .set_task_completion(
            NIL_USER_ID,
            task_id,
            Some(2_000),
            Some(0),
            Some(&task_grant),
            None,
            2_000
        )
        .unwrap());
    assert_eq!(ledger_deleted_at(&task_key), Some(None));
    assert!(!storage
        .set_task_completion(
            NIL_USER_ID,
            task_id,
            Some(2_000),
            Some(0),
            Some(&task_grant),
            None,
            2_100
        )
        .unwrap());

    assert!(!storage
        .set_task_completion(
            NIL_USER_ID,
            task_id,
            None,
            None,
            None,
            Some(&task_key),
            3_000
        )
        .unwrap());
    assert_eq!(ledger_deleted_at(&task_key), Some(Some(3_000)));

    // 2. Habit log grant + lowered-log revocation + re-activation
    let habit_key = format!("habit_log:{habit_id}:0");
    let habit_grant = RewardGrant {
        id: ledger_id(NIL_USER_ID, &habit_key),
        user_id: NIL_USER_ID.to_string(),
        source_key: habit_key.clone(),
        xp: 10,
        gold_cents: 100,
        now_ms: 4_000,
    };
    let done_log = HabitLog {
        id: entity_id_v5("habit_log", NIL_USER_ID, &format!("{habit_id}:0")),
        user_id: NIL_USER_ID.to_string(),
        habit_id: habit_id.to_string(),
        day_index: 0,
        logged_value: 20.0,
        goal_target: 20.0,
        completed: true,
        status: HabitLogStatus::Logged,
        mood: Some(4),
        note: "Done".to_string(),
        created_at: 4_000,
        updated_at: 4_000,
        deleted_at: None,
        usn: -1,
    };
    let out1 = storage
        .upsert_habit_log(&done_log, Some(&habit_grant), None)
        .unwrap();
    assert!(out1.reward_granted);
    assert!(!out1.reward_revoked);
    assert_eq!(ledger_deleted_at(&habit_key), Some(None));

    let lowered_log = HabitLog {
        logged_value: 5.0,
        completed: false,
        updated_at: 5_000,
        ..done_log.clone()
    };
    let out2 = storage
        .upsert_habit_log(&lowered_log, None, Some(&habit_key))
        .unwrap();
    assert!(!out2.reward_granted);
    assert!(out2.reward_revoked);
    assert_eq!(ledger_deleted_at(&habit_key), Some(Some(5_000)));

    let raised_log = HabitLog {
        logged_value: 25.0,
        completed: true,
        updated_at: 6_000,
        ..done_log
    };
    let out3 = storage
        .upsert_habit_log(
            &raised_log,
            Some(&RewardGrant {
                now_ms: 6_000,
                ..habit_grant
            }),
            None,
        )
        .unwrap();
    assert!(out3.reward_granted);
    assert_eq!(ledger_deleted_at(&habit_key), Some(None));

    // 3. Rollback on injected storage failure
    storage
        .lock()
        .execute_batch(
            "CREATE TRIGGER fail_ledger_m1 BEFORE INSERT ON progress_ledger
             BEGIN
                 SELECT RAISE(ABORT, 'forced_m1');
             END;",
        )
        .unwrap();

    let task2_key = format!("task_done:{task2_id}");
    let task2_grant = RewardGrant {
        id: ledger_id(NIL_USER_ID, &task2_key),
        user_id: NIL_USER_ID.to_string(),
        source_key: task2_key.clone(),
        xp: 10,
        gold_cents: 100,
        now_ms: 7_000,
    };
    let err = storage
        .set_task_completion(
            NIL_USER_ID,
            task2_id,
            Some(7_000),
            Some(0),
            Some(&task2_grant),
            None,
            7_000,
        )
        .unwrap_err();
    assert!(err.to_string().contains("forced_m1"));
    assert_eq!(
        storage
            .get_task(NIL_USER_ID, task2_id)
            .unwrap()
            .unwrap()
            .completed_at,
        None
    );

    let day1_key = format!("habit_log:{habit_id}:1");
    let day1_grant = RewardGrant {
        id: ledger_id(NIL_USER_ID, &day1_key),
        user_id: NIL_USER_ID.to_string(),
        source_key: day1_key.clone(),
        xp: 10,
        gold_cents: 100,
        now_ms: 7_100,
    };
    let day1_log = HabitLog {
        id: entity_id_v5("habit_log", NIL_USER_ID, &format!("{habit_id}:1")),
        user_id: NIL_USER_ID.to_string(),
        habit_id: habit_id.to_string(),
        day_index: 1,
        logged_value: 20.0,
        goal_target: 20.0,
        completed: true,
        status: HabitLogStatus::Logged,
        mood: None,
        note: String::new(),
        created_at: 7_100,
        updated_at: 7_100,
        deleted_at: None,
        usn: -1,
    };
    let err = storage
        .upsert_habit_log(&day1_log, Some(&day1_grant), None)
        .unwrap_err();
    assert!(err.to_string().contains("forced_m1"));
    assert!(storage
        .list_habit_logs_range(NIL_USER_ID, 1, 1)
        .unwrap()
        .is_empty());

    storage
        .lock()
        .execute_batch("DROP TRIGGER fail_ledger_m1;")
        .unwrap();

    // 4. Soft-deleting task or habit preserves already-earned rewards
    assert!(storage
        .set_task_completion(
            NIL_USER_ID,
            task2_id,
            Some(8_000),
            Some(0),
            Some(&task2_grant),
            None,
            8_000
        )
        .unwrap());
    storage
        .soft_delete_task(NIL_USER_ID, task2_id, 8_100)
        .unwrap();
    assert_eq!(ledger_deleted_at(&task2_key), Some(None));

    storage
        .soft_delete_habit(NIL_USER_ID, habit_id, 8_200)
        .unwrap();
    assert_eq!(ledger_deleted_at(&habit_key), Some(None));
}

#[test]
fn reopen_task_undo_and_habit_lower_raise_cycle_preserve_ledger_integrity() {
    use bibalak_core::ports::TestClock;
    use bibalak_core::productivity::{
        HabitFrequencyKind, HabitGoalMode, HabitInput, HabitLogInput, HabitSection, TaskInput,
        TaskPriority,
    };
    use bibalak_core::progress::{habit_source_key, task_source_key};
    use bibalak_core::Collection;
    use std::sync::Arc;

    let now_ms = 1_794_601_800_000_i64 + 3 * 86_400_000;
    let storage = SqliteStorage::open_in_memory().unwrap();
    storage.ensure_collection(1_794_601_800_000).unwrap();
    let clock = Arc::new(TestClock::new(now_ms));
    let c = Collection::new(Box::new(storage), clock.clone()).unwrap();
    c.set_local_offset_minutes(180);

    // 1. Task: complete -> undo -> complete -> reopen -> undo(reopen) -> reopen -> re-complete
    let task = c
        .create_task(TaskInput {
            list_id: None,
            title: "Cycle task".into(),
            notes: String::new(),
            priority: TaskPriority::High,
            manual_quadrant: None,
            due_date: None,
            scheduled_start_ms: None,
            scheduled_end_ms: None,
            tags: vec![],
            deck_id: None,
            sort_order: 0,
        })
        .unwrap();
    c.complete_task(&task.id).unwrap();
    assert_eq!(c.progress_summary().unwrap().total_xp, 10);

    c.undo().unwrap();
    assert_eq!(c.progress_summary().unwrap().total_xp, 0);

    c.complete_task(&task.id).unwrap();
    assert_eq!(c.progress_summary().unwrap().total_xp, 10);

    c.reopen_task(&task.id).unwrap();
    assert_eq!(c.progress_summary().unwrap().total_xp, 0);

    c.undo().unwrap(); // undo reopen -> restores grant cleanly
    assert_eq!(c.progress_summary().unwrap().total_xp, 10);
    assert!(c
        .storage()
        .get_active_ledger_reward(NIL_USER_ID, &task_source_key(&task.id))
        .unwrap()
        .is_some());

    c.reopen_task(&task.id).unwrap();
    c.complete_task(&task.id).unwrap();
    assert_eq!(c.progress_summary().unwrap().tasks_rewarded_today, 1);

    // 2. Habit: goal reached -> lowered below goal (revoked) -> raised on today (granted) vs older day (no reward)
    let habit = c
        .create_habit(HabitInput {
            title: "Water".into(),
            notes: String::new(),
            icon_key: "droplet".into(),
            color_token: "info".into(),
            frequency_kind: HabitFrequencyKind::Daily,
            weekdays: vec![],
            weekly_target: None,
            interval_days: None,
            goal_mode: HabitGoalMode::ReachAmount,
            goal_target: 4.0,
            goal_unit: "cups".into(),
            start_date: None,
            target_days: None,
            section: HabitSection::Morning,
            reminders: vec![],
            auto_popup_log: false,
            deck_id: None,
            sort_order: 0,
        })
        .unwrap();

    let today = c.today();
    c.log_habit(HabitLogInput {
        habit_id: habit.id.clone(),
        day_index: Some(today),
        logged_value: 4.0,
        status: HabitLogStatus::Logged,
        mood: None,
        note: String::new(),
    })
    .unwrap();
    assert!(c
        .storage()
        .get_active_ledger_reward(NIL_USER_ID, &habit_source_key(&habit.id, today))
        .unwrap()
        .is_some());

    c.log_habit(HabitLogInput {
        habit_id: habit.id.clone(),
        day_index: Some(today),
        logged_value: 2.0,
        status: HabitLogStatus::Logged,
        mood: None,
        note: String::new(),
    })
    .unwrap();
    assert!(c
        .storage()
        .get_active_ledger_reward(NIL_USER_ID, &habit_source_key(&habit.id, today))
        .unwrap()
        .is_none());

    c.log_habit(HabitLogInput {
        habit_id: habit.id.clone(),
        day_index: Some(today),
        logged_value: 4.0,
        status: HabitLogStatus::Logged,
        mood: None,
        note: String::new(),
    })
    .unwrap();
    assert_eq!(c.progress_summary().unwrap().total_xp, 20);

    c.log_habit(HabitLogInput {
        habit_id: habit.id.clone(),
        day_index: Some(today - 2),
        logged_value: 4.0,
        status: HabitLogStatus::Logged,
        mood: None,
        note: String::new(),
    })
    .unwrap();
    assert_eq!(c.progress_summary().unwrap().total_xp, 20);
}

#[test]
fn delete_task_and_delete_habit_keep_earned_rewards_and_cap_count() {
    use bibalak_core::ports::FixedClock;
    use bibalak_core::productivity::{
        HabitFrequencyKind, HabitGoalMode, HabitInput, HabitLogInput, HabitSection, TaskInput,
        TaskPriority,
    };
    use bibalak_core::Collection;
    use std::sync::Arc;

    let now_ms = 1_795_341_600_000_i64;
    let storage = SqliteStorage::open_in_memory().unwrap();
    storage.ensure_collection(now_ms).unwrap();
    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(now_ms))).unwrap();

    let t = c
        .create_task(TaskInput {
            list_id: None,
            title: "Temp task".into(),
            notes: String::new(),
            priority: TaskPriority::Medium,
            manual_quadrant: None,
            due_date: None,
            scheduled_start_ms: None,
            scheduled_end_ms: None,
            tags: vec![],
            deck_id: None,
            sort_order: 0,
        })
        .unwrap();
    c.complete_task(&t.id).unwrap();
    c.delete_task(&t.id).unwrap();

    let h = c
        .create_habit(HabitInput {
            title: "Temp habit".into(),
            notes: String::new(),
            icon_key: "check".into(),
            color_token: "accent".into(),
            frequency_kind: HabitFrequencyKind::Daily,
            weekdays: vec![],
            weekly_target: None,
            interval_days: None,
            goal_mode: HabitGoalMode::AchieveAll,
            goal_target: 1.0,
            goal_unit: String::new(),
            start_date: None,
            target_days: None,
            section: HabitSection::Morning,
            reminders: vec![],
            auto_popup_log: false,
            deck_id: None,
            sort_order: 0,
        })
        .unwrap();
    c.log_habit(HabitLogInput {
        habit_id: h.id.clone(),
        day_index: None,
        logged_value: 1.0,
        status: HabitLogStatus::Logged,
        mood: None,
        note: String::new(),
    })
    .unwrap();
    c.delete_habit(&h.id).unwrap();

    let s = c.progress_summary().unwrap();
    assert_eq!(s.total_xp, 20);
    assert_eq!(s.gold_cents, 200);
    assert_eq!(s.today_xp, 20);
    assert_eq!(s.tasks_rewarded_today, 1);
}

#[test]
fn migration_v10_to_v11_adds_habit_log_status() {
    let mut conn = Connection::open_in_memory().unwrap();
    for (version, sql) in MIGRATIONS.iter().take(10).enumerate() {
        conn.execute_batch(sql).unwrap();
        conn.pragma_update(None, "user_version", version as i64 + 1)
            .unwrap();
    }

    let habit_id = "66666666-6666-4666-8666-666666666666";
    let log_id = entity_id_v5("habit_log", NIL_USER_ID, &format!("{habit_id}:0"));
    conn.execute(
        "INSERT INTO habits (id, user_id, title, start_day_index, created_at, updated_at)
         VALUES (?1, ?2, 'v10 habit', 0, 1000, 1000)",
        params![habit_id, NIL_USER_ID],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO habit_logs
         (id, user_id, habit_id, day_index, logged_value, goal_target, completed, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, 1.0, 1.0, 1, 1000, 1000)",
        params![log_id, NIL_USER_ID, habit_id],
    )
    .unwrap();

    crate::migrations::run(&mut conn).unwrap();

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, MIGRATIONS.len() as i64);

    let logs = crate::productivity::list_habit_logs_range(&conn, NIL_USER_ID, 0, 0).unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].status, HabitLogStatus::Logged);
    assert!(logs[0].completed);

    // CHECK constraint accepts 'skipped'/'frozen' and rejects invalid status values.
    assert!(conn
        .execute(
            "INSERT INTO habit_logs
             (id, user_id, habit_id, day_index, status, created_at, updated_at)
             VALUES ('hl-skip', ?1, ?2, 1, 'skipped', 1000, 1000)",
            params![NIL_USER_ID, habit_id],
        )
        .is_ok());
    assert!(conn
        .execute(
            "INSERT INTO habit_logs
             (id, user_id, habit_id, day_index, status, created_at, updated_at)
             VALUES ('hl-bad', ?1, ?2, 2, 'paused', 1000, 1000)",
            params![NIL_USER_ID, habit_id],
        )
        .is_err());
}

#[test]
fn reorder_tasks_updates_sort_order_atomically() {
    use bibalak_core::ports::FixedClock;
    use bibalak_core::Collection;
    use bibalak_core::DomainEvent;
    use std::sync::{Arc, Mutex};

    let now_ms = 1_795_341_600_000_i64;
    let storage = SqliteStorage::open_in_memory().unwrap();
    storage.ensure_collection(now_ms).unwrap();
    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(now_ms + 5_000))).unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    c.events().subscribe(move |ev| {
        captured.lock().unwrap().push(ev.clone());
    });

    let t1_id = "11111111-1111-4111-8111-111111111101";
    let t2_id = "11111111-1111-4111-8111-111111111102";
    let t3_id = "11111111-1111-4111-8111-111111111103";
    c.storage().upsert_task(&make_task(t1_id, None)).unwrap();
    c.storage().upsert_task(&make_task(t2_id, None)).unwrap();
    c.storage().upsert_task(&make_task(t3_id, None)).unwrap();
    events.lock().unwrap().clear();

    // Missing task ID rolls back the entire transaction (t1 keeps sort_order = 0).
    let missing = "99999999-9999-4999-8999-999999999999";
    let err = c
        .reorder_tasks(vec![
            TaskOrderItem {
                id: t1_id.into(),
                sort_order: 20,
            },
            TaskOrderItem {
                id: missing.into(),
                sort_order: 10,
            },
        ])
        .unwrap_err();
    assert!(err.to_string().contains("not found"));
    assert_eq!(
        c.storage()
            .get_task(NIL_USER_ID, t1_id)
            .unwrap()
            .unwrap()
            .sort_order,
        0
    );
    assert!(events.lock().unwrap().is_empty());

    // Valid reorder updates all rows in one transaction and emits exactly one ProductivityChanged.
    c.reorder_tasks(vec![
        TaskOrderItem {
            id: t3_id.into(),
            sort_order: 0,
        },
        TaskOrderItem {
            id: t1_id.into(),
            sort_order: 10,
        },
        TaskOrderItem {
            id: t2_id.into(),
            sort_order: 20,
        },
    ])
    .unwrap();

    assert_eq!(
        c.storage()
            .get_task(NIL_USER_ID, t3_id)
            .unwrap()
            .unwrap()
            .sort_order,
        0
    );
    assert_eq!(
        c.storage()
            .get_task(NIL_USER_ID, t1_id)
            .unwrap()
            .unwrap()
            .sort_order,
        10
    );
    assert_eq!(
        c.storage()
            .get_task(NIL_USER_ID, t2_id)
            .unwrap()
            .unwrap()
            .sort_order,
        20
    );
    let evs = events.lock().unwrap();
    assert_eq!(
        evs.iter()
            .filter(|e| matches!(e, DomainEvent::ProductivityChanged))
            .count(),
        1
    );
}

#[test]
fn reschedule_overdue_tasks_moves_only_incomplete_overdue() {
    use bibalak_core::ports::FixedClock;
    use bibalak_core::Collection;
    use bibalak_core::DomainEvent;
    use std::sync::{Arc, Mutex};

    // 2026-11-22 10:00 UTC -> today_date is "2026-11-22".
    let now_ms = 1_795_341_600_000_i64;
    let storage = SqliteStorage::open_in_memory().unwrap();
    storage.ensure_collection(now_ms).unwrap();
    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(now_ms))).unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    c.events().subscribe(move |ev| {
        captured.lock().unwrap().push(ev.clone());
    });

    let mut overdue_1 = make_task("22222222-2222-4222-8222-222222222201", None);
    overdue_1.due_date = Some("2026-11-20".into());
    let mut overdue_2 = make_task("22222222-2222-4222-8222-222222222202", None);
    overdue_2.due_date = Some("2026-11-21".into());
    let mut completed_overdue = make_task("22222222-2222-4222-8222-222222222203", None);
    completed_overdue.due_date = Some("2026-11-19".into());
    completed_overdue.completed_at = Some(now_ms - 1_000);
    completed_overdue.completed_day = Some(0);
    let mut deleted_overdue = make_task("22222222-2222-4222-8222-222222222204", None);
    deleted_overdue.due_date = Some("2026-11-18".into());
    deleted_overdue.deleted_at = Some(now_ms - 1_000);
    let mut future = make_task("22222222-2222-4222-8222-222222222205", None);
    future.due_date = Some("2026-11-25".into());
    let mut no_date = make_task("22222222-2222-4222-8222-222222222206", None);
    no_date.due_date = None;

    for t in [
        &overdue_1,
        &overdue_2,
        &completed_overdue,
        &deleted_overdue,
        &future,
        &no_date,
    ] {
        c.storage().upsert_task(t).unwrap();
    }
    events.lock().unwrap().clear();

    let count = c.reschedule_overdue_tasks("2026-11-22").unwrap();
    assert_eq!(count, 2);

    assert_eq!(
        c.storage()
            .get_task(NIL_USER_ID, &overdue_1.id)
            .unwrap()
            .unwrap()
            .due_date
            .as_deref(),
        Some("2026-11-22")
    );
    assert_eq!(
        c.storage()
            .get_task(NIL_USER_ID, &overdue_2.id)
            .unwrap()
            .unwrap()
            .due_date
            .as_deref(),
        Some("2026-11-22")
    );
    assert_eq!(
        c.storage()
            .get_task(NIL_USER_ID, &completed_overdue.id)
            .unwrap()
            .unwrap()
            .due_date
            .as_deref(),
        Some("2026-11-19")
    );
    assert_eq!(
        c.storage()
            .get_task(NIL_USER_ID, &future.id)
            .unwrap()
            .unwrap()
            .due_date
            .as_deref(),
        Some("2026-11-25")
    );
    assert_eq!(
        c.storage()
            .get_task(NIL_USER_ID, &no_date.id)
            .unwrap()
            .unwrap()
            .due_date,
        None
    );

    let evs = events.lock().unwrap();
    assert_eq!(
        evs.iter()
            .filter(|e| matches!(e, DomainEvent::ProductivityChanged))
            .count(),
        1
    );
}
