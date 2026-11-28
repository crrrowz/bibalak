//! Shared behavioral contract suite run against both [`SqliteStorage`] and
//! [`FakeStorage`] (ADR-001 / ARCH6).
//!
//! Ensures the in-memory test double and the SQLite adapter agree on
//! productivity, progress, and core deck/study/sync semantics.

use bibalak_core::collection::fake_storage::FakeStorage;
use bibalak_core::ports::{
    DeckStore, MaintenanceStore, ProductivityStore, ProgressStore, Storage, StudyStore, SyncStore,
};
use bibalak_core::productivity::{
    CalendarEvent, Habit, HabitFrequencyKind, HabitGoalMode, HabitLog, HabitLogStatus,
    HabitSection, MatrixSortBy, QuadrantKey, TaskItem, TaskList, TaskOrderItem, TaskPriority,
};
use bibalak_core::progress::{ledger_id, RewardGrant, NIL_USER_ID};
use bibalak_db::SqliteStorage;

fn make_task_list(id: &str, name: &str, sort_order: i32) -> TaskList {
    TaskList {
        id: id.to_string(),
        user_id: NIL_USER_ID.to_string(),
        name: name.to_string(),
        color_token: "accent".to_string(),
        icon_key: None,
        sort_order,
        created_at: 1_000,
        updated_at: 1_000,
        deleted_at: None,
        usn: -1,
    }
}

fn make_task(id: &str, list_id: Option<&str>, title: &str, sort_order: i32) -> TaskItem {
    TaskItem {
        id: id.to_string(),
        user_id: NIL_USER_ID.to_string(),
        list_id: list_id.map(str::to_string),
        title: title.to_string(),
        notes: String::new(),
        priority: TaskPriority::Medium,
        manual_quadrant: None,
        due_date: Some("2026-11-22".to_string()),
        scheduled_start_ms: None,
        scheduled_end_ms: None,
        tags: vec!["study".to_string()],
        deck_id: None,
        completed_at: None,
        completed_day: None,
        sort_order,
        created_at: 1_000,
        updated_at: 1_000,
        deleted_at: None,
        usn: -1,
    }
}

fn make_habit(id: &str, title: &str, archived_at: Option<i64>, sort_order: i32) -> Habit {
    Habit {
        id: id.to_string(),
        user_id: NIL_USER_ID.to_string(),
        title: title.to_string(),
        notes: String::new(),
        icon_key: "check-circle".to_string(),
        color_token: "accent".to_string(),
        frequency_kind: HabitFrequencyKind::Daily,
        weekdays: vec![],
        weekly_target: None,
        interval_days: None,
        goal_mode: HabitGoalMode::ReachAmount,
        goal_target: 10.0,
        goal_unit: "cards".to_string(),
        start_day_index: 0,
        target_days: None,
        section: HabitSection::Morning,
        reminders: vec![],
        auto_popup_log: false,
        deck_id: None,
        archived_at,
        sort_order,
        created_at: 1_000,
        updated_at: 1_000,
        deleted_at: None,
        usn: -1,
    }
}

fn make_habit_log(id: &str, habit_id: &str, day_index: i32, logged_value: f64) -> HabitLog {
    HabitLog {
        id: id.to_string(),
        user_id: NIL_USER_ID.to_string(),
        habit_id: habit_id.to_string(),
        day_index,
        logged_value,
        goal_target: 10.0,
        completed: logged_value >= 10.0,
        status: HabitLogStatus::Logged,
        mood: Some(4),
        note: "steady".to_string(),
        created_at: 1_000,
        updated_at: 1_000,
        deleted_at: None,
        usn: -1,
    }
}

fn make_calendar_event(id: &str, title: &str, start_ms: i64, end_ms: i64) -> CalendarEvent {
    CalendarEvent {
        id: id.to_string(),
        user_id: NIL_USER_ID.to_string(),
        title: title.to_string(),
        description: String::new(),
        location: String::new(),
        color_token: "accent".to_string(),
        start_ms,
        end_ms,
        is_all_day: false,
        recurrence: None,
        linked_task_id: None,
        external_account_id: None,
        external_event_id: None,
        created_at: 1_000,
        updated_at: 1_000,
        deleted_at: None,
        usn: -1,
    }
}

fn make_reward(source_key: &str, xp: i64, gold_cents: i64, now_ms: i64) -> RewardGrant {
    RewardGrant {
        id: ledger_id(NIL_USER_ID, source_key),
        user_id: NIL_USER_ID.to_string(),
        source_key: source_key.to_string(),
        xp,
        gold_cents,
        now_ms,
    }
}

macro_rules! storage_contract_tests {
    ($mod_name:ident, $make_storage:expr) => {
        mod $mod_name {
            use super::*;

            fn open_storage() -> impl Storage {
                let s = $make_storage;
                MaintenanceStore::ensure_collection(&s, 1_000).unwrap();
                s
            }

            #[test]
            fn task_lists_crud_soft_delete_and_restore() {
                let s = open_storage();
                let l1 = make_task_list("11111111-1111-4111-8111-111111111111", "Beta", 2);
                let l2 = make_task_list("22222222-2222-4222-8222-222222222222", "Alpha", 1);
                ProductivityStore::upsert_task_list(&s, &l1).unwrap();
                ProductivityStore::upsert_task_list(&s, &l2).unwrap();

                let lists = ProductivityStore::list_task_lists(&s, NIL_USER_ID).unwrap();
                assert_eq!(lists.len(), 2);
                assert_eq!(lists[0].name, "Alpha");
                assert_eq!(lists[1].name, "Beta");

                let t1 = make_task(
                    "33333333-3333-4333-8333-333333333333",
                    Some(&l1.id),
                    "Task in Beta",
                    0,
                );
                ProductivityStore::upsert_task(&s, &t1).unwrap();

                let moved =
                    ProductivityStore::soft_delete_task_list(&s, NIL_USER_ID, &l1.id, 2_000)
                        .unwrap();
                assert_eq!(moved, vec![t1.id.clone()]);
                assert_eq!(
                    ProductivityStore::list_task_lists(&s, NIL_USER_ID)
                        .unwrap()
                        .len(),
                    1
                );
                let detached = ProductivityStore::get_task(&s, NIL_USER_ID, &t1.id)
                    .unwrap()
                    .unwrap();
                assert_eq!(detached.list_id, None);

                ProductivityStore::restore_task_list(&s, NIL_USER_ID, &l1.id, &moved, 3_000)
                    .unwrap();
                assert_eq!(
                    ProductivityStore::list_task_lists(&s, NIL_USER_ID)
                        .unwrap()
                        .len(),
                    2
                );
                let reattached = ProductivityStore::get_task(&s, NIL_USER_ID, &t1.id)
                    .unwrap()
                    .unwrap();
                assert_eq!(reattached.list_id.as_deref(), Some(l1.id.as_str()));
            }

            #[test]
            fn tasks_reorder_reschedule_and_soft_delete_roundtrip() {
                let s = open_storage();
                let mut t1 = make_task("11111111-1111-4111-8111-111111111111", None, "First", 1);
                t1.due_date = Some("2026-11-20".to_string());
                let mut t2 = make_task("22222222-2222-4222-8222-222222222222", None, "Second", 2);
                t2.due_date = Some("2026-11-25".to_string());
                ProductivityStore::upsert_task(&s, &t1).unwrap();
                ProductivityStore::upsert_task(&s, &t2).unwrap();

                ProductivityStore::reorder_tasks(
                    &s,
                    NIL_USER_ID,
                    &[
                        TaskOrderItem {
                            id: t2.id.clone(),
                            sort_order: 0,
                        },
                        TaskOrderItem {
                            id: t1.id.clone(),
                            sort_order: 1,
                        },
                    ],
                    2_000,
                )
                .unwrap();
                let ordered = ProductivityStore::list_tasks(&s, NIL_USER_ID, true).unwrap();
                assert_eq!(ordered[0].id, t2.id);
                assert_eq!(ordered[1].id, t1.id);

                let rescheduled = ProductivityStore::reschedule_overdue_tasks(
                    &s,
                    NIL_USER_ID,
                    "2026-11-22",
                    "2026-11-22",
                    3_000,
                )
                .unwrap();
                assert_eq!(rescheduled, 1);
                assert_eq!(
                    ProductivityStore::get_task(&s, NIL_USER_ID, &t1.id)
                        .unwrap()
                        .unwrap()
                        .due_date
                        .as_deref(),
                    Some("2026-11-22")
                );

                ProductivityStore::soft_delete_task(&s, NIL_USER_ID, &t1.id, 4_000).unwrap();
                assert!(ProductivityStore::get_task(&s, NIL_USER_ID, &t1.id)
                    .unwrap()
                    .is_none());
                assert_eq!(
                    ProductivityStore::list_tasks(&s, NIL_USER_ID, true)
                        .unwrap()
                        .len(),
                    1
                );

                ProductivityStore::restore_task(&s, NIL_USER_ID, &t1.id, 5_000).unwrap();
                assert_eq!(
                    ProductivityStore::list_tasks(&s, NIL_USER_ID, true)
                        .unwrap()
                        .len(),
                    2
                );
            }

            #[test]
            fn matrix_quadrants_seed_and_upsert() {
                let s = open_storage();
                let mut quads = ProductivityStore::list_matrix_quadrants(&s, NIL_USER_ID).unwrap();
                assert_eq!(quads.len(), 4);
                assert_eq!(quads[0].quadrant_key, QuadrantKey::Q1);

                let mut q1 = quads.remove(0);
                q1.title = "Urgent & Important".to_string();
                q1.sort_by = MatrixSortBy::Priority;
                q1.updated_at = 2_000;
                ProductivityStore::upsert_matrix_quadrant(&s, &q1).unwrap();

                let updated = ProductivityStore::list_matrix_quadrants(&s, NIL_USER_ID).unwrap();
                let found = updated
                    .iter()
                    .find(|q| q.quadrant_key == QuadrantKey::Q1)
                    .unwrap();
                assert_eq!(found.title, "Urgent & Important");
                assert_eq!(found.sort_by, MatrixSortBy::Priority);
            }

            #[test]
            fn habits_and_habit_logs_roundtrip_and_cascade_soft_delete() {
                let s = open_storage();
                let h1 = make_habit("11111111-1111-4111-8111-111111111111", "Active", None, 0);
                let h2 = make_habit(
                    "22222222-2222-4222-8222-222222222222",
                    "Archived",
                    Some(1_500),
                    1,
                );
                ProductivityStore::upsert_habit(&s, &h1).unwrap();
                ProductivityStore::upsert_habit(&s, &h2).unwrap();

                assert_eq!(
                    ProductivityStore::list_habits(&s, NIL_USER_ID, false)
                        .unwrap()
                        .len(),
                    1
                );
                assert_eq!(
                    ProductivityStore::list_habits(&s, NIL_USER_ID, true)
                        .unwrap()
                        .len(),
                    2
                );

                let log1 = make_habit_log("33333333-3333-4333-8333-333333333333", &h1.id, 10, 10.0);
                let reward = make_reward("habit_done:h1:10", 15, 30, 2_000);
                let outcome =
                    ProductivityStore::upsert_habit_log(&s, &log1, Some(&reward), None).unwrap();
                assert!(outcome.previous.is_none());
                assert!(outcome.reward_granted);
                assert!(!outcome.reward_revoked);

                assert_eq!(
                    ProductivityStore::list_habit_logs_range(&s, NIL_USER_ID, 5, 15)
                        .unwrap()
                        .len(),
                    1
                );
                assert_eq!(
                    ProductivityStore::list_habit_logs_for_habit(&s, NIL_USER_ID, &h1.id, 5, 15)
                        .unwrap()
                        .len(),
                    1
                );

                let deleted_logs =
                    ProductivityStore::soft_delete_habit(&s, NIL_USER_ID, &h1.id, 3_000).unwrap();
                assert_eq!(deleted_logs, vec![log1.id.clone()]);
                assert!(ProductivityStore::get_habit(&s, NIL_USER_ID, &h1.id)
                    .unwrap()
                    .is_none());
                assert!(
                    ProductivityStore::list_habit_logs_range(&s, NIL_USER_ID, 5, 15)
                        .unwrap()
                        .is_empty()
                );

                ProductivityStore::restore_habit(&s, NIL_USER_ID, &h1.id, &deleted_logs, 4_000)
                    .unwrap();
                assert!(ProductivityStore::get_habit(&s, NIL_USER_ID, &h1.id)
                    .unwrap()
                    .is_some());
                assert_eq!(
                    ProductivityStore::list_habit_logs_range(&s, NIL_USER_ID, 5, 15)
                        .unwrap()
                        .len(),
                    1
                );

                // Restore log snapshot to None (soft-deletes log & revokes reward).
                ProductivityStore::restore_habit_log_snapshot(
                    &s,
                    NIL_USER_ID,
                    &h1.id,
                    10,
                    None,
                    None,
                    Some(&reward.source_key),
                    5_000,
                )
                .unwrap();
                assert!(
                    ProductivityStore::list_habit_logs_range(&s, NIL_USER_ID, 5, 15)
                        .unwrap()
                        .is_empty()
                );
                assert!(ProgressStore::get_active_ledger_reward(
                    &s,
                    NIL_USER_ID,
                    &reward.source_key
                )
                .unwrap()
                .is_none());
            }

            #[test]
            fn calendar_events_crud_soft_delete_and_restore() {
                let s = open_storage();
                let e1 = make_calendar_event(
                    "11111111-1111-4111-8111-111111111111",
                    "Later",
                    20_000,
                    25_000,
                );
                let e2 = make_calendar_event(
                    "22222222-2222-4222-8222-222222222222",
                    "Earlier",
                    10_000,
                    15_000,
                );
                ProductivityStore::upsert_calendar_event(&s, &e1).unwrap();
                ProductivityStore::upsert_calendar_event(&s, &e2).unwrap();

                let events = ProductivityStore::list_calendar_events(&s, NIL_USER_ID).unwrap();
                assert_eq!(events.len(), 2);
                assert_eq!(events[0].title, "Earlier");
                assert_eq!(events[1].title, "Later");

                ProductivityStore::soft_delete_calendar_event(&s, NIL_USER_ID, &e2.id, 30_000)
                    .unwrap();
                assert!(
                    ProductivityStore::get_calendar_event(&s, NIL_USER_ID, &e2.id)
                        .unwrap()
                        .is_none()
                );
                assert_eq!(
                    ProductivityStore::list_calendar_events(&s, NIL_USER_ID)
                        .unwrap()
                        .len(),
                    1
                );

                ProductivityStore::restore_calendar_event(&s, NIL_USER_ID, &e2.id, 31_000).unwrap();
                assert_eq!(
                    ProductivityStore::list_calendar_events(&s, NIL_USER_ID)
                        .unwrap()
                        .len(),
                    2
                );
            }

            #[test]
            fn progress_task_reward_grant_revoke_and_yesterday_activity() {
                let s = open_storage();
                let t1 = make_task("11111111-1111-4111-8111-111111111111", None, "Study", 0);
                ProductivityStore::upsert_task(&s, &t1).unwrap();

                let source_key = format!("task_done:{}", t1.id);
                let reward = make_reward(&source_key, 25, 50, 5_000);
                let granted = ProductivityStore::set_task_completion(
                    &s,
                    NIL_USER_ID,
                    &t1.id,
                    Some(5_000),
                    Some(1),
                    Some(&reward),
                    None,
                    5_000,
                )
                .unwrap();
                assert!(granted);

                let totals = ProgressStore::progress_totals(&s, NIL_USER_ID, 0, 10_000, 1).unwrap();
                assert_eq!(totals.total_xp, 25);
                assert_eq!(totals.today_xp, 25);
                assert_eq!(totals.gold_cents, 50);
                assert_eq!(totals.today_gold_cents, 50);
                assert_eq!(totals.tasks_rewarded_today, 1);

                assert!(
                    ProgressStore::get_active_ledger_reward(&s, NIL_USER_ID, &source_key)
                        .unwrap()
                        .is_some()
                );

                let yday =
                    ProgressStore::yesterday_activity(&s, NIL_USER_ID, 1, 0, 10_000).unwrap();
                assert_eq!(yday.tasks_completed, 1);
                assert_eq!(yday.xp, 25);
                assert_eq!(yday.gold_cents, 50);

                // Uncomplete and revoke reward
                let granted_after = ProductivityStore::set_task_completion(
                    &s,
                    NIL_USER_ID,
                    &t1.id,
                    None,
                    None,
                    None,
                    Some(&source_key),
                    6_000,
                )
                .unwrap();
                assert!(!granted_after);

                let totals_after =
                    ProgressStore::progress_totals(&s, NIL_USER_ID, 0, 10_000, 1).unwrap();
                assert_eq!(totals_after.total_xp, 0);
                assert_eq!(totals_after.gold_cents, 0);
                assert_eq!(totals_after.tasks_rewarded_today, 0);
                assert!(
                    ProgressStore::get_active_ledger_reward(&s, NIL_USER_ID, &source_key)
                        .unwrap()
                        .is_none()
                );
            }

            #[test]
            fn core_deck_study_and_sync_state_roundtrips() {
                let s = open_storage();
                let deck = DeckStore::create_deck(&s, "Anatomy", 1_000).unwrap();
                assert_eq!(deck.name, "Anatomy");
                assert_eq!(
                    DeckStore::deck_by_id(&s, deck.id).unwrap().unwrap().name,
                    "Anatomy"
                );
                assert_eq!(
                    DeckStore::deck_by_name(&s, "Anatomy").unwrap().unwrap().id,
                    deck.id
                );

                DeckStore::rename_deck(&s, deck.id, "Neuroanatomy", 2_000).unwrap();
                DeckStore::set_deck_collapsed(&s, deck.id, true).unwrap();
                let renamed = DeckStore::deck_by_id(&s, deck.id).unwrap().unwrap();
                assert_eq!(renamed.name, "Neuroanatomy");
                assert!(renamed.collapsed);

                let removed = DeckStore::remove_deck(&s, deck.id, 3_000).unwrap();
                assert!(DeckStore::deck_by_id(&s, deck.id).unwrap().is_none());
                DeckStore::restore_deck(&s, &removed, 4_000).unwrap();
                assert!(DeckStore::deck_by_id(&s, deck.id).unwrap().is_some());

                assert_eq!(StudyStore::get_rollover_hour(&s).unwrap(), 4);
                StudyStore::set_rollover_hour(&s, 6, 5_000).unwrap();
                assert_eq!(StudyStore::get_rollover_hour(&s).unwrap(), 6);

                assert_eq!(StudyStore::get_last_unbury_day(&s).unwrap(), None);
                StudyStore::set_last_unbury_day(&s, 42, 5_000).unwrap();
                assert_eq!(StudyStore::get_last_unbury_day(&s).unwrap(), Some(42));

                assert_eq!(SyncStore::get_sync_state(&s, "cursor").unwrap(), None);
                SyncStore::set_sync_state(&s, "cursor", "abc-123").unwrap();
                assert_eq!(
                    SyncStore::get_sync_state(&s, "cursor").unwrap().as_deref(),
                    Some("abc-123")
                );
            }
        }
    };
}

storage_contract_tests!(sqlite_contract, SqliteStorage::open_in_memory().unwrap());
storage_contract_tests!(fake_contract, FakeStorage::default());
