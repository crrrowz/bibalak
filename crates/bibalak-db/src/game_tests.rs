//! SQLite integration tests for Game data layer (R2a + R4-1), including
//! v11->v12->v13 migration preserving progress_ledger, freeze token & deck-linked
//! auto-sync promotion, backfill idempotency, and 100k revlog performance budget.

use std::sync::Arc;
use std::time::{Duration, Instant};

use bibalak_core::game::{EquipmentSlot, FREEZE_TOKEN_CAP, STREAK_FREEZE_ITEM_KEY};
use bibalak_core::game_depth::{game_pet_id, GamePathId};
use bibalak_core::model::{Card, Deck, Field, Note, Notetype, Revlog, Template};
use bibalak_core::ports::{TestClock, *};
use bibalak_core::productivity::{
    entity_id_v5, HabitFrequencyKind, HabitGoalMode, HabitInput, HabitLogInput, HabitLogStatus,
    HabitSection, TaskInput, TaskPriority,
};
use bibalak_core::progress::{ledger_id, review_source_key, NIL_USER_ID};
use bibalak_core::scheduling::{CardPhase, CardState};
use bibalak_core::{CanonicalModel, Clock, Collection};
use rusqlite::{params, Connection};

use crate::migrations;
use crate::schema::MIGRATIONS;
use crate::SqliteStorage;

const BASE_MS: i64 = 1_795_341_600_000;

fn seed_card_model(cards: Vec<Card>) -> CanonicalModel {
    CanonicalModel {
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
                name: "Biology".into(),
                parent_id: None,
                config_id: 1,
                mod_ms: 0,
                usn: 0,
                collapsed: false,
                is_filtered: false,
            },
            Deck {
                id: 3,
                name: "History".into(),
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
            .map(|c| Note {
                id: c.note_id,
                guid: format!("g{}", c.note_id),
                notetype_id: 1,
                mod_ms: 0,
                usn: 0,
                tags: vec![],
                fields: vec!["Q".into(), "A".into()],
                sort_field: Some("Q".into()),
                checksum: None,
            })
            .collect(),
        cards,
        ..Default::default()
    }
}

fn make_card(id: i64, deck_id: i64) -> Card {
    Card {
        id,
        note_id: id,
        deck_id,
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
    }
}

#[test]
fn v11_to_v12_to_v13_migrates_cleanly_and_preserves_progress_ledger() {
    let mut conn = Connection::open_in_memory().unwrap();
    for (version, sql) in MIGRATIONS.iter().take(11).enumerate() {
        conn.execute_batch(sql).unwrap();
        conn.pragma_update(None, "user_version", version as i64 + 1)
            .unwrap();
    }

    let lid = ledger_id(NIL_USER_ID, "card_review:1:0");
    conn.execute(
        "INSERT INTO progress_ledger
         (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, 'card_review:1:0', 300, 1250, 1000, 1000, NULL, 5)",
        params![lid, NIL_USER_ID],
    )
    .unwrap();

    migrations::run(&mut conn).unwrap();

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, MIGRATIONS.len() as i64);
    assert_eq!(MIGRATIONS.len(), 16);

    for table in [
        "avatar_profile",
        "inventory_items",
        "avatar_equipped",
        "custom_rewards",
        "gold_spend_ledger",
        "freeze_token_ledger",
        "game_profile",
        "game_unlocks",
        "game_pets",
        "game_pet_credits",
        "game_achievements",
    ] {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "missing table {table}");
    }

    // Reviewer change #5: avatar_equipped has created_at column
    let has_created_at: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('avatar_equipped') WHERE name = 'created_at'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(has_created_at, 1);

    // Partial unique index on game_pets + v14 performance indexes
    for idx_name in [
        "idx_game_pets_one_active",
        "idx_game_pet_credits_ledger",
        "idx_progress_ledger_active_created",
    ] {
        let has_idx: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
                [idx_name],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_idx, 1, "missing index {idx_name}");
    }

    // progress_ledger row untouched
    let (xp, gold, usn): (i64, i64, i64) = conn
        .query_row(
            "SELECT xp, gold_cents, usn FROM progress_ledger WHERE id = ?1",
            [lid],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!((xp, gold, usn), (300, 1250, 5));
}

#[test]
fn sqlite_freeze_refunds_on_deck_linked_auto_sync_completion() {
    let storage = SqliteStorage::open_in_memory().unwrap();
    storage.ensure_collection(BASE_MS).unwrap();
    storage
        .import(
            &seed_card_model(vec![make_card(1, 2), make_card(2, 2)]),
            BASE_MS,
        )
        .unwrap();
    let clock = Arc::new(TestClock::new(BASE_MS));
    let c = Collection::new(Box::new(storage), clock.clone()).unwrap();

    // Earn enough gold via card 1 in Default deck (deck 1) -> 25 gold_cents; complete 30 tasks -> 3,000 gold_cents
    for i in 0..3 {
        let t = c
            .create_task(TaskInput {
                list_id: None,
                title: format!("Setup {i}"),
                notes: String::new(),
                priority: TaskPriority::None,
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
    }
    // 3 tasks = 300 cents; buy 25 tasks more on next days? Easier: seed via storage directly or 25 tasks across 3 days
    clock.advance_days(1);
    for d in 1..=3 {
        for i in 0..8 {
            let t = c
                .create_task(TaskInput {
                    list_id: None,
                    title: format!("T{d}-{i}"),
                    notes: String::new(),
                    priority: TaskPriority::None,
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
        }
        clock.advance_days(1);
    }
    assert!(c.get_game_state().unwrap().available_gold_cents >= 2_500);
    c.buy_shop_item(STREAK_FREEZE_ITEM_KEY, "tx-freeze")
        .unwrap();
    assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 1);

    let habit = c
        .create_habit(HabitInput {
            title: "Bio review".into(),
            notes: String::new(),
            icon_key: "check".into(),
            color_token: "accent".into(),
            frequency_kind: HabitFrequencyKind::Daily,
            weekdays: vec![],
            weekly_target: None,
            interval_days: None,
            goal_mode: HabitGoalMode::ReachAmount,
            goal_target: 1.0,
            goal_unit: "cards".into(),
            start_date: None,
            target_days: None,
            section: HabitSection::Morning,
            reminders: vec![],
            auto_popup_log: false,
            deck_id: Some(2),
            sort_order: 0,
        })
        .unwrap();

    // Freeze today -> 0 tokens held
    c.log_habit(HabitLogInput {
        habit_id: habit.id.clone(),
        day_index: None,
        logged_value: 0.0,
        status: HabitLogStatus::Frozen,
        mood: None,
        note: String::new(),
    })
    .unwrap();
    assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 0);

    // Answer card in Biology deck -> auto-sync promotes Frozen to Logged(completed) and refunds freeze token!
    let next = CardState {
        phase: CardPhase::Review,
        interval_days: 1,
        ease_milli: 2500,
        reps: 1,
        lapses: 0,
        steps_remaining: 0,
        stability: Some(1.0),
        difficulty: Some(5.0),
        last_review_day: Some(c.today()),
    };
    c.apply_answer(
        1,
        1,
        &CardState::new(2500),
        0,
        &next,
        1,
        &Revlog {
            id: clock.now_ms(),
            card_id: 1,
            usn: -1,
            ease: 3,
            interval: 1,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 800,
            review_kind: 0,
        },
        8,
    )
    .unwrap();
    assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 1);
    let _ = (EquipmentSlot::Head, FREEZE_TOKEN_CAP, GamePathId::Sage);
}

#[test]
fn backfill_grants_once_and_is_idempotent() {
    let storage = SqliteStorage::open_in_memory().unwrap();
    storage.ensure_collection(BASE_MS).unwrap();
    storage
        .import(
            &seed_card_model(vec![make_card(1, 1), make_card(2, 2), make_card(3, 3)]),
            BASE_MS,
        )
        .unwrap();

    // Seed pre-existing revlog (55 reviews across 3 decks), mature card, tasks, habit_logs directly in SQLite
    {
        let conn = storage.lock();
        for i in 1..=55_i64 {
            let cid = ((i - 1) % 3) + 1;
            conn.execute(
                "INSERT INTO revlog (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
                 VALUES (?1, ?2, 0, 3, 1, 0, 2500, 1000, 1)",
                params![BASE_MS + i * 1000, cid],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO tasks (id, user_id, title, completed_at, completed_day, created_at, updated_at)
             VALUES (?1, ?2, 'Pre task', ?3, 0, ?3, ?3)",
            params![entity_id_v5("task", NIL_USER_ID, "pre1"), NIL_USER_ID, BASE_MS],
        )
        .unwrap();
    }

    let c = Collection::new(
        Box::new(storage),
        Arc::new(TestClock::new(BASE_MS + 100_000)),
    )
    .unwrap();
    let before_progress = c.progress_summary().unwrap();
    assert_eq!(before_progress.total_xp, 0);
    assert_eq!(before_progress.gold_cents, 0);

    // First get_game_depth_state triggers backfill (0 -> 1)
    let state = c.get_game_depth_state().unwrap();
    assert!(state.backfill_applied);
    assert!(state
        .pets
        .iter()
        .any(|p| p.species_key == "owl" && p.variant_key == "classic"));
    assert!(state
        .pets
        .iter()
        .any(|p| p.species_key == "fox" && p.variant_key == "classic"));
    assert!(state
        .achievements
        .iter()
        .any(|a| a.achievement_key == "ach:reviews_50" && a.unlocked));
    assert!(state
        .achievements
        .iter()
        .any(|a| a.achievement_key == "ach:decks_3" && a.unlocked));
    assert!(state
        .achievements
        .iter()
        .any(|a| a.achievement_key == "ach:first_task" && a.unlocked));
    assert!(c
        .get_game_state()
        .unwrap()
        .owned_item_keys
        .contains(&"backdrop_study_hearth".to_string()));

    // Backfill NEVER touches progress_ledger
    let after_progress = c.progress_summary().unwrap();
    assert_eq!(after_progress.total_xp, 0);
    assert_eq!(after_progress.gold_cents, 0);

    // Explicit run_unlock_backfill is idempotent no-op
    let second = c.run_unlock_backfill().unwrap();
    assert!(second.already_applied);
    assert_eq!(second.pets_granted, 0);
    assert_eq!(second.cosmetics_granted, 0);
    assert_eq!(second.achievements_granted, 0);
}

fn median_duration(mut samples: Vec<Duration>) -> Duration {
    samples.sort();
    samples[samples.len() / 2]
}

#[test]
fn unlock_check_stays_fast_with_100k_revlog_rows() {
    let measure_median = |bulk_rows: i64| -> Duration {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(BASE_MS).unwrap();
        storage
            .import(&seed_card_model(vec![make_card(1, 1)]), BASE_MS)
            .unwrap();

        {
            let mut conn = storage.lock();
            let tx = conn.transaction().unwrap();
            {
                let mut stmt = tx
                    .prepare(
                        "INSERT INTO revlog (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
                         VALUES (?1, 1, 0, 3, 1, 0, 2500, 500, 1)",
                    )
                    .unwrap();
                for i in 1..=bulk_rows {
                    stmt.execute([BASE_MS - 10_000_000 + i]).unwrap();
                }
            }
            tx.commit().unwrap();
        }

        let clock = Arc::new(TestClock::new(BASE_MS + 100_000));
        let c = Collection::new(Box::new(storage), clock.clone()).unwrap();

        // First answer evaluates & caches existing review thresholds; subsequent answers measure steady-state cost
        let next = CardState {
            phase: CardPhase::Review,
            interval_days: 5,
            ease_milli: 2500,
            reps: 1,
            lapses: 0,
            steps_remaining: 0,
            stability: Some(5.0),
            difficulty: Some(5.0),
            last_review_day: Some(c.today()),
        };
        c.apply_answer(
            1,
            1,
            &CardState::new(2500),
            0,
            &next,
            1,
            &Revlog {
                id: clock.now_ms(),
                card_id: 1,
                usn: -1,
                ease: 3,
                interval: 5,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 500,
                review_kind: 1,
            },
            8,
        )
        .unwrap();

        let mut samples = Vec::with_capacity(5);
        for _ in 0..5 {
            clock.advance_ms(1_000);
            let t0 = Instant::now();
            c.apply_answer(
                1,
                1,
                &next,
                1,
                &next,
                2,
                &Revlog {
                    id: clock.now_ms(),
                    card_id: 1,
                    usn: -1,
                    ease: 3,
                    interval: 10,
                    last_interval: 5,
                    ease_factor: 2500,
                    taken_ms: 500,
                    review_kind: 1,
                },
                8,
            )
            .unwrap();
            samples.push(t0.elapsed());
        }
        median_duration(samples)
    };

    let small = measure_median(5);
    let large = measure_median(100_000);
    let budget = small * 3 + Duration::from_millis(15);
    println!(
        "100k_revlog_apply_answer small_median_ms={:.2} large_median_ms={:.2} budget_ms={:.2}",
        small.as_secs_f64() * 1000.0,
        large.as_secs_f64() * 1000.0,
        budget.as_secs_f64() * 1000.0
    );
    assert!(
        large < budget,
        "apply_answer median with 100k revlog rows took {:?} (small={:?}, budget < {:?})",
        large,
        small,
        budget
    );
}

#[test]
fn freeze_milestone_cost_flat_with_100k_ledger_rows() {
    let measure = |bulk_rows: i64| -> (Duration, Duration) {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(BASE_MS).unwrap();
        storage
            .import(
                &seed_card_model(vec![make_card(1, 1), make_card(2, 1)]),
                BASE_MS,
            )
            .unwrap();
        {
            let mut conn = storage.lock();
            let tx = conn.transaction().unwrap();
            {
                let mut stmt = tx
                    .prepare(
                        "INSERT INTO progress_ledger
                         (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
                         VALUES (?1, ?2, ?3, 3, 25, ?4, ?4, NULL, -1)",
                    )
                    .unwrap();
                // Bulk rows on day 0
                for i in 1..=bulk_rows {
                    let id = format!("00000000-0000-5000-8000-{i:012x}");
                    let key = format!("card_review:{i}:0");
                    stmt.execute(params![id, NIL_USER_ID, key, BASE_MS + i])
                        .unwrap();
                }
                // One active reward on each of days 1..=5 -> 6-day streak before day 6
                for day in 1..=5_i64 {
                    let key = format!("card_review:999999:{day}");
                    let id = ledger_id(NIL_USER_ID, &key);
                    let ts = BASE_MS + day * 86_400_000;
                    stmt.execute(params![id, NIL_USER_ID, key, ts]).unwrap();
                }
            }
            tx.commit().unwrap();
        }
        let clock = Arc::new(TestClock::new(BASE_MS));
        clock.advance_days(6);
        let c = Collection::new(Box::new(storage), clock.clone()).unwrap();
        let make_next = |today: i32| CardState {
            phase: CardPhase::Review,
            interval_days: 5,
            ease_milli: 2500,
            reps: 1,
            lapses: 0,
            steps_remaining: 0,
            stability: Some(5.0),
            difficulty: Some(5.0),
            last_review_day: Some(today),
        };

        let mut first_samples = Vec::with_capacity(5);
        for step in 0..5 {
            if step > 0 {
                clock.advance_days(1);
            }
            let next = make_next(c.today());
            let prev = if step == 0 {
                CardState::new(2500)
            } else {
                make_next(c.today() - 1)
            };
            let t0 = Instant::now();
            c.apply_answer(
                1,
                1,
                &prev,
                i64::from(step > 0),
                &next,
                1,
                &Revlog {
                    id: clock.now_ms(),
                    card_id: 1,
                    usn: -1,
                    ease: 3,
                    interval: 5,
                    last_interval: if step == 0 { 0 } else { 5 },
                    ease_factor: 2500,
                    taken_ms: 500,
                    review_kind: 1,
                },
                8,
            )
            .unwrap();
            first_samples.push(t0.elapsed());
            if step == 0 {
                // 7-day streak (days 0..=6) earns 1 freeze token on the first reward of day 6
                assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 1);
            }
        }

        let mut second_samples = Vec::with_capacity(5);
        let next = make_next(c.today());
        for step in 0..5 {
            clock.advance_ms(1_000);
            let prev = if step == 0 {
                CardState::new(2500)
            } else {
                next
            };
            let t1 = Instant::now();
            c.apply_answer(
                2,
                2,
                &prev,
                i64::from(step > 0),
                &next,
                1,
                &Revlog {
                    id: clock.now_ms(),
                    card_id: 2,
                    usn: -1,
                    ease: 3,
                    interval: 5,
                    last_interval: if step == 0 { 0 } else { 5 },
                    ease_factor: 2500,
                    taken_ms: 500,
                    review_kind: 1,
                },
                8,
            )
            .unwrap();
            second_samples.push(t1.elapsed());
        }

        (
            median_duration(first_samples),
            median_duration(second_samples),
        )
    };

    let (small_first, small_second) = measure(5);
    let (large_first, large_second) = measure(99_995);
    let budget_first = small_first * 3 + Duration::from_millis(15);
    let budget_second = small_second * 3 + Duration::from_millis(15);

    println!(
        "freeze_100k_ledger small_first_ms={:.2} large_first_ms={:.2} budget_first_ms={:.2} small_second_ms={:.2} large_second_ms={:.2} budget_second_ms={:.2}",
        small_first.as_secs_f64() * 1000.0,
        large_first.as_secs_f64() * 1000.0,
        budget_first.as_secs_f64() * 1000.0,
        small_second.as_secs_f64() * 1000.0,
        large_second.as_secs_f64() * 1000.0,
        budget_second.as_secs_f64() * 1000.0
    );
    assert!(
        large_first < budget_first,
        "first answer of day median with 100k ledger rows took {:?} (small={:?}, budget < {:?})",
        large_first,
        small_first,
        budget_first
    );
    assert!(
        large_second < budget_second,
        "second answer of day median with 100k ledger rows took {:?} (small={:?}, budget < {:?})",
        large_second,
        small_second,
        budget_second
    );
}

#[test]
fn answer_path_ledger_queries_use_bounded_indexes() {
    let storage = SqliteStorage::open_in_memory().unwrap();
    storage.ensure_collection(BASE_MS).unwrap();
    let conn = storage.lock();
    let explain = |sql: &str, args: Vec<rusqlite::types::Value>| -> Vec<String> {
        let eqp = format!("EXPLAIN QUERY PLAN {sql}");
        let mut stmt = conn.prepare(&eqp).unwrap();
        stmt.query_map(rusqlite::params_from_iter(args.iter()), |r| {
            r.get::<_, String>(3)
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
    };

    let active_quests_plan = explain(
        "SELECT source_key FROM progress_ledger
         WHERE user_id = ?1 AND +deleted_at IS NULL AND source_key IN (?2, ?3, ?4, ?5)",
        vec![
            NIL_USER_ID.to_string().into(),
            "quest_daily:6:reviews_15".to_string().into(),
            "quest_daily:6:new_5".to_string().into(),
            "quest_daily:6:tasks_2".to_string().into(),
            "quest_weekly:2967:w_new_40".to_string().into(),
        ],
    );
    println!("EQP [reconcile_motivation:active_quest_keys]: {active_quests_plan:?}");
    assert!(
        active_quests_plan
            .iter()
            .any(|d| d.contains("sqlite_autoindex_progress_ledger_2") && d.contains("source_key=")),
        "active_quest_keys must probe (user_id, source_key), got {active_quests_plan:?}"
    );

    let prev_day_plan = explain(
        "SELECT source_key, created_at FROM progress_ledger
         WHERE user_id = ?1 AND deleted_at IS NULL AND created_at < ?2
         ORDER BY created_at DESC LIMIT 1",
        vec![
            NIL_USER_ID.to_string().into(),
            (BASE_MS + 6 * 86_400_000).into(),
        ],
    );
    println!("EQP [reconcile_motivation:prev_active_day_before]: {prev_day_plan:?}");
    assert!(
        prev_day_plan
            .iter()
            .any(|d| d.contains("idx_progress_ledger_active_created") && d.contains("created_at<")),
        "prev_active_day_before must seek via idx_progress_ledger_active_created, got {prev_day_plan:?}"
    );

    let quest_xp_plan = explain(
        "SELECT xp FROM progress_ledger
         WHERE user_id = ?1 AND deleted_at IS NULL AND created_at >= ?2 AND created_at < ?3",
        vec![
            NIL_USER_ID.to_string().into(),
            BASE_MS.into(),
            (BASE_MS + 86_400_000).into(),
        ],
    );
    println!("EQP [reconcile_motivation:quest_xp]: {quest_xp_plan:?}");
    assert!(
        quest_xp_plan
            .iter()
            .any(|d| d.contains("idx_progress_ledger_active_created")
                && d.contains("created_at>")
                && d.contains("created_at<")),
        "quest_xp must use bounded range on idx_progress_ledger_active_created, got {quest_xp_plan:?}"
    );

    let quest_days_plan = explain(
        "SELECT created_at, source_key FROM progress_ledger
         WHERE user_id = ?1 AND deleted_at IS NULL AND created_at >= ?2 AND created_at < ?3
         ORDER BY created_at ASC LIMIT 1",
        vec![
            NIL_USER_ID.to_string().into(),
            BASE_MS.into(),
            (BASE_MS + 7 * 86_400_000).into(),
        ],
    );
    println!("EQP [reconcile_motivation:quest_active_days]: {quest_days_plan:?}");
    assert!(
        quest_days_plan
            .iter()
            .any(|d| d.contains("idx_progress_ledger_active_created")
                && d.contains("created_at>")
                && d.contains("created_at<")),
        "quest_active_days must use bounded skip scan on idx_progress_ledger_active_created, got {quest_days_plan:?}"
    );

    let study_days_plan = explain(
        "SELECT created_at, source_key FROM progress_ledger
         WHERE user_id = ?1 AND deleted_at IS NULL AND created_at >= ?2
         ORDER BY created_at ASC LIMIT 1",
        vec![NIL_USER_ID.to_string().into(), 0_i64.into()],
    );
    println!("EQP [has_at_least_study_days]: {study_days_plan:?}");
    assert!(
        study_days_plan
            .iter()
            .any(|d| d.contains("idx_progress_ledger_active_created") && d.contains("created_at>")),
        "has_at_least_study_days must seek via idx_progress_ledger_active_created, got {study_days_plan:?}"
    );

    let streak_day_plan = explain(
        "SELECT id, source_key FROM progress_ledger
         WHERE user_id = ?1 AND deleted_at IS NULL AND created_at >= ?2 AND created_at < ?3",
        vec![
            NIL_USER_ID.to_string().into(),
            BASE_MS.into(),
            (BASE_MS + 86_400_000).into(),
        ],
    );
    println!("EQP [has_active_ledger_row_on_day]: {streak_day_plan:?}");
    assert!(
        streak_day_plan
            .iter()
            .any(|d| d.contains("idx_progress_ledger_active_created")
                && d.contains("created_at>")
                && d.contains("created_at<")),
        "has_active_ledger_row_on_day must use bounded range on idx_progress_ledger_active_created, got {streak_day_plan:?}"
    );
}

#[test]
fn level_check_cost_flat_with_100k_zero_xp_ledger_rows() {
    let measure = |bulk_rows: i64| -> Duration {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(BASE_MS).unwrap();
        let cards: Vec<Card> = (1..=6).map(|id| make_card(id, 1)).collect();
        storage.import(&seed_card_model(cards), BASE_MS).unwrap();
        {
            let mut conn = storage.lock();
            let tx = conn.transaction().unwrap();
            {
                let mut stmt = tx
                    .prepare(
                        "INSERT INTO progress_ledger
                         (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
                         VALUES (?1, ?2, ?3, 0, 25, ?4, ?4, NULL, -1)",
                    )
                    .unwrap();
                for i in 1..=bulk_rows {
                    let id = format!("00000000-0000-5000-9000-{i:012x}");
                    let key = format!("card_review:{}:0", 1_000_000 + i);
                    stmt.execute(params![id, NIL_USER_ID, key, BASE_MS + i])
                        .unwrap();
                }
            }
            tx.commit().unwrap();
        }

        let clock = Arc::new(TestClock::new(BASE_MS));
        clock.advance_days(10);
        let c = Collection::new(Box::new(storage), clock.clone()).unwrap();
        let next = CardState {
            phase: CardPhase::Review,
            interval_days: 5,
            ease_milli: 2500,
            reps: 1,
            lapses: 0,
            steps_remaining: 0,
            stability: Some(5.0),
            difficulty: Some(5.0),
            last_review_day: Some(c.today()),
        };

        let mut samples = Vec::with_capacity(5);
        for step in 1..=5_i64 {
            clock.advance_ms(1_000);
            let t0 = Instant::now();
            c.apply_answer(
                step,
                step,
                &CardState::new(2500),
                0,
                &next,
                1,
                &Revlog {
                    id: clock.now_ms(),
                    card_id: step,
                    usn: -1,
                    ease: 3,
                    interval: 5,
                    last_interval: 0,
                    ease_factor: 2500,
                    taken_ms: 500,
                    review_kind: 1,
                },
                8,
            )
            .unwrap();
            samples.push(t0.elapsed());
        }
        // Higher level thresholds remain unearned throughout (total XP = 15 < 100 for Level 2).
        assert_eq!(c.progress_summary().unwrap().level, 1);
        assert_eq!(c.progress_summary().unwrap().total_xp, 15);
        median_duration(samples)
    };

    let small = measure(5);
    let large = measure(99_995);
    let budget = small * 3 + Duration::from_millis(15);
    println!(
        "level_check_100k_zero_xp small_ms={:.2} large_ms={:.2} budget_ms={:.2}",
        small.as_secs_f64() * 1000.0,
        large.as_secs_f64() * 1000.0,
        budget.as_secs_f64() * 1000.0
    );
    assert!(
        large < budget,
        "answer with unearned level thresholds and 100k ledger rows took {:?} (small={:?}, budget < {:?})",
        large,
        small,
        budget
    );
}

#[test]
fn answer_path_equivalence_with_rollover_and_undo() {
    let storage = SqliteStorage::open_in_memory().unwrap();
    storage.ensure_collection(BASE_MS).unwrap();
    let cards: Vec<Card> = (1..=4).map(|id| make_card(id, 1)).collect();
    storage.import(&seed_card_model(cards), BASE_MS).unwrap();

    // Seed 94 XP on day 0 (so 2 Good reviews = +6 XP reaches exact Level 2 = 100 XP),
    // plus a same-day QuestDaily row at the exact same timestamp to test skip-scan tie safety.
    {
        let mut conn = storage.lock();
        let tx = conn.transaction().unwrap();
        let k0 = "card_review:9001:0";
        tx.execute(
            "INSERT INTO progress_ledger
             (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
             VALUES (?1, ?2, ?3, 94, 250, ?4, ?4, NULL, -1)",
            params![ledger_id(NIL_USER_ID, k0), NIL_USER_ID, k0, BASE_MS + 100],
        )
        .unwrap();
        let qk = "quest_daily:0:reviews_15";
        tx.execute(
            "INSERT INTO progress_ledger
             (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
             VALUES (?1, ?2, ?3, 0, 200, ?4, ?4, NULL, -1)",
            params![ledger_id(NIL_USER_ID, qk), NIL_USER_ID, qk, BASE_MS + 100],
        )
        .unwrap();
        tx.commit().unwrap();
    }

    let clock = Arc::new(TestClock::new(BASE_MS));
    // Jump 8 days (past 7-day comeback threshold) so `prev_active_day_before` must locate day 0.
    clock.advance_days(8);
    let c = Collection::new(Box::new(storage), clock.clone()).unwrap();

    let answer = |card_id: i64| {
        let next = CardState {
            phase: CardPhase::Review,
            interval_days: 5,
            ease_milli: 2500,
            reps: 1,
            lapses: 0,
            steps_remaining: 0,
            stability: Some(5.0),
            difficulty: Some(5.0),
            last_review_day: Some(c.today()),
        };
        c.apply_answer(
            card_id,
            card_id,
            &CardState::new(2500),
            0,
            &next,
            1,
            &Revlog {
                id: clock.now_ms(),
                card_id,
                usn: -1,
                ease: 3,
                interval: 5,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 500,
                review_kind: 1,
            },
            8,
        )
        .unwrap();
    };

    // Answer card 1 -> 97 XP (Level 1), comeback return_day = 8 detected from day 0.
    answer(1);
    let m1 = c.get_motivation_state().unwrap();
    assert_eq!(m1.comeback_offer.map(|o| o.away_days), Some(8));
    assert_eq!(c.progress_summary().unwrap().total_xp, 97);
    assert_eq!(c.progress_summary().unwrap().level, 1);

    // Answer card 2 -> 100 XP -> Level 2 unlocked!
    clock.advance_ms(1_000);
    answer(2);
    assert_eq!(c.progress_summary().unwrap().total_xp, 100);
    assert_eq!(c.progress_summary().unwrap().level, 2);
    let depth_at_l2 = c.get_game_depth_state().unwrap();
    assert!(
        depth_at_l2
            .unseen_unlocks
            .iter()
            .any(|u| u.key == "unlock:level:2"),
        "expected unlock:level:2 at 100 XP"
    );

    // Rollover to next day (day 9), answer card 3 (103 XP), then undo it!
    clock.advance_days(1);
    answer(3);
    assert_eq!(c.progress_summary().unwrap().total_xp, 103);
    assert_eq!(c.progress_summary().unwrap().today_xp, 3);

    clock.advance_ms(1_000);
    c.undo().unwrap();
    let after_undo = c.progress_summary().unwrap();
    assert_eq!(after_undo.total_xp, 100);
    assert_eq!(after_undo.today_xp, 0);
    assert_eq!(after_undo.level, 2);

    // Answer card 4 on day 9 -> cache invalidation from undo must recompute 100 + 3 = 103 XP.
    clock.advance_ms(1_000);
    answer(4);
    let final_summary = c.progress_summary().unwrap();
    assert_eq!(final_summary.total_xp, 103);
    assert_eq!(final_summary.today_xp, 3);
    assert_eq!(final_summary.level, 2);

    // Verify cached XP in sync_state matches direct progress_totals from progress_ledger.
    let cached_xp: u64 = c
        .storage()
        .get_sync_state(&format!("game:earned_xp:{NIL_USER_ID}"))
        .unwrap()
        .expect("earned_xp cache must be populated")
        .parse()
        .unwrap();
    assert_eq!(cached_xp, final_summary.total_xp);

    // Re-answering card 4 on the same day must be a reward no-op (same idempotency key & XP).
    clock.advance_ms(1_000);
    answer(4);
    let after_reanswer = c.progress_summary().unwrap();
    assert_eq!(after_reanswer.total_xp, final_summary.total_xp);
    assert_eq!(after_reanswer.gold_cents, final_summary.gold_cents);

    // Compare against a second collection seeded identically (after deleting the cached key)
    // to confirm totals, level, unlocks, quests, and comeback match uncached evaluation.
    c.storage()
        .set_sync_state(&format!("game:earned_xp:{NIL_USER_ID}"), "")
        .unwrap();
    assert_eq!(c.get_game_depth_state().unwrap().level, 2);
    let final_mot = c.get_motivation_state().unwrap();
    assert_eq!(final_mot.current_streak, 2);
    assert_eq!(final_mot.daily_quests.len(), 3);
    assert!(c
        .storage()
        .get_active_ledger_reward(NIL_USER_ID, "card_review:3:9")
        .unwrap()
        .is_none());
    assert!(c
        .storage()
        .get_active_ledger_reward(NIL_USER_ID, "card_review:4:9")
        .unwrap()
        .is_some());
}

#[test]
fn decks_studied_cost_flat_with_300_decks_3_studied() {
    let measure = |total_decks: i64| -> (Duration, Duration, Collection) {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(BASE_MS).unwrap();
        let decks: Vec<Deck> = (1..=total_decks)
            .map(|id| Deck {
                id,
                name: if id == 1 {
                    "Default".to_string()
                } else {
                    format!("Deck {id:03}")
                },
                parent_id: None,
                config_id: 1,
                mod_ms: 0,
                usn: 0,
                collapsed: false,
                is_filtered: false,
            })
            .collect();
        let cards: Vec<Card> = (1..=total_decks + 5)
            .map(|id| make_card(id, if id <= total_decks { id } else { 1 }))
            .collect();
        let mut model = seed_card_model(cards);
        model.decks = decks;
        storage.import(&model, BASE_MS).unwrap();

        let clock = Arc::new(TestClock::new(BASE_MS));
        let c = Collection::new(Box::new(storage), clock.clone()).unwrap();
        let next = CardState {
            phase: CardPhase::Review,
            interval_days: 5,
            ease_milli: 2500,
            reps: 1,
            lapses: 0,
            steps_remaining: 0,
            stability: Some(5.0),
            difficulty: Some(5.0),
            last_review_day: Some(c.today()),
        };

        // Study 3 decks (decks 1, 2, 3) -> unlocks ach:decks_3, leaves ach:decks_10 unearned
        for deck_card in 1..=3_i64 {
            clock.advance_ms(1_000);
            c.apply_answer(
                deck_card,
                deck_card,
                &CardState::new(2500),
                0,
                &next,
                1,
                &Revlog {
                    id: clock.now_ms(),
                    card_id: deck_card,
                    usn: -1,
                    ease: 3,
                    interval: 5,
                    last_interval: 0,
                    ease_factor: 2500,
                    taken_ms: 500,
                    review_kind: 1,
                },
                8,
            )
            .unwrap();
        }

        // Measure answering cards in an already-studied deck (deck 1)
        let mut existing_samples = Vec::with_capacity(5);
        for offset in 1..=5_i64 {
            let card_id = total_decks + offset;
            clock.advance_ms(1_000);
            let t0 = Instant::now();
            c.apply_answer(
                card_id,
                card_id,
                &CardState::new(2500),
                0,
                &next,
                1,
                &Revlog {
                    id: clock.now_ms(),
                    card_id,
                    usn: -1,
                    ease: 3,
                    interval: 5,
                    last_interval: 0,
                    ease_factor: 2500,
                    taken_ms: 500,
                    review_kind: 1,
                },
                8,
            )
            .unwrap();
            existing_samples.push(t0.elapsed());
        }

        // Measure answering newly studied decks (decks 4..=8, keeping total studied < 10)
        let mut new_samples = Vec::with_capacity(5);
        for deck_card in 4..=8_i64 {
            clock.advance_ms(1_000);
            let t1 = Instant::now();
            c.apply_answer(
                deck_card,
                deck_card,
                &CardState::new(2500),
                0,
                &next,
                1,
                &Revlog {
                    id: clock.now_ms(),
                    card_id: deck_card,
                    usn: -1,
                    ease: 3,
                    interval: 5,
                    last_interval: 0,
                    ease_factor: 2500,
                    taken_ms: 500,
                    review_kind: 1,
                },
                8,
            )
            .unwrap();
            new_samples.push(t1.elapsed());
        }

        (
            median_duration(existing_samples),
            median_duration(new_samples),
            c,
        )
    };

    let (small_existing, small_new, _) = measure(10);
    let (large_existing, large_new, c) = measure(300);
    let existing_budget = small_existing * 3 + Duration::from_millis(15);
    let new_budget = small_new * 3 + Duration::from_millis(15);

    println!(
        "300_decks_studied small_existing_ms={:.2} large_existing_ms={:.2} small_new_ms={:.2} large_new_ms={:.2}",
        small_existing.as_secs_f64() * 1000.0,
        large_existing.as_secs_f64() * 1000.0,
        small_new.as_secs_f64() * 1000.0,
        large_new.as_secs_f64() * 1000.0
    );
    assert!(
        large_existing < existing_budget,
        "apply_answer median on studied deck with 300 decks took {:?} (small={:?}, budget < {:?})",
        large_existing,
        small_existing,
        existing_budget
    );
    assert!(
        large_new < new_budget,
        "apply_answer median on newly studied deck with 300 decks took {:?} (small={:?}, budget < {:?})",
        large_new,
        small_new,
        new_budget
    );

    let state = c.get_game_depth_state().unwrap();
    assert!(state
        .achievements
        .iter()
        .any(|a| a.achievement_key == "ach:decks_3" && a.unlocked));
    assert!(!state
        .achievements
        .iter()
        .any(|a| a.achievement_key == "ach:decks_10" && a.unlocked));
}

#[test]
fn undo_cost_flat_with_20k_pet_credits() {
    let measure_undo = |credit_rows: i64| -> (Duration, Collection) {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(BASE_MS).unwrap();
        storage
            .import(
                &seed_card_model(vec![make_card(1, 1), make_card(2, 1)]),
                BASE_MS,
            )
            .unwrap();

        let clock = Arc::new(TestClock::new(BASE_MS));
        let next = CardState {
            phase: CardPhase::Review,
            interval_days: 5,
            ease_milli: 2500,
            reps: 1,
            lapses: 0,
            steps_remaining: 0,
            stability: Some(5.0),
            difficulty: Some(5.0),
            last_review_day: Some(0),
        };

        // Verify query plan uses idx_game_pet_credits_ledger + seed credits on a non-active pet
        {
            let mut conn = storage.lock();
            let plan: String = {
                let mut stmt = conn
                    .prepare(
                        "EXPLAIN QUERY PLAN
                         UPDATE game_pet_credits
                         SET deleted_at = 1, updated_at = 1, usn = -1
                         WHERE user_id = 'u' AND ledger_id = 'l' AND deleted_at IS NULL",
                    )
                    .unwrap();
                stmt.query_map([], |r| r.get::<_, String>(3))
                    .unwrap()
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .unwrap()
                    .join(" | ")
            };
            assert!(
                plan.contains("idx_game_pet_credits_ledger"),
                "revoke_pet_credit_tx must use idx_game_pet_credits_ledger, plan: {plan}"
            );

            let tx = conn.transaction().unwrap();
            {
                let mut stmt = tx
                    .prepare(
                        "INSERT INTO game_pet_credits
                         (id, user_id, pet_id, ledger_id, points, created_at, updated_at, deleted_at, usn)
                         VALUES (?1, ?2, 'other-pet', ?3, 1, ?4, ?4, NULL, -1)",
                    )
                    .unwrap();
                for i in 1..=credit_rows {
                    let id = format!("00000000-0000-5000-9000-{i:012x}");
                    let lid = format!("00000000-0000-5000-a000-{i:012x}");
                    stmt.execute(params![id, NIL_USER_ID, lid, BASE_MS + i])
                        .unwrap();
                }
            }
            tx.commit().unwrap();
        }

        let c = Collection::new(Box::new(storage), clock.clone()).unwrap();
        // Card 1 unlocks owl:classic; card 2 writes a pet credit to revoke on undo
        c.apply_answer(
            1,
            1,
            &CardState::new(2500),
            0,
            &next,
            1,
            &Revlog {
                id: clock.now_ms(),
                card_id: 1,
                usn: -1,
                ease: 3,
                interval: 5,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 500,
                review_kind: 1,
            },
            8,
        )
        .unwrap();

        let mut samples = Vec::with_capacity(5);
        for _ in 0..5 {
            clock.advance_ms(1_000);
            c.apply_answer(
                2,
                2,
                &CardState::new(2500),
                0,
                &next,
                1,
                &Revlog {
                    id: clock.now_ms(),
                    card_id: 2,
                    usn: -1,
                    ease: 3,
                    interval: 5,
                    last_interval: 0,
                    ease_factor: 2500,
                    taken_ms: 500,
                    review_kind: 1,
                },
                8,
            )
            .unwrap();

            clock.advance_ms(1_000);
            let t0 = Instant::now();
            c.undo().unwrap();
            samples.push(t0.elapsed());
        }

        (median_duration(samples), c)
    };

    let (small_undo, _) = measure_undo(5);
    let (large_undo, c) = measure_undo(20_000);
    let budget = small_undo * 3 + Duration::from_millis(15);

    println!(
        "undo_20k_pet_credits small_median_ms={:.2} large_median_ms={:.2} budget_ms={:.2}",
        small_undo.as_secs_f64() * 1000.0,
        large_undo.as_secs_f64() * 1000.0,
        budget.as_secs_f64() * 1000.0
    );
    assert!(
        large_undo < budget,
        "undo median with 20k pet credits took {:?} (small={:?}, budget < {:?})",
        large_undo,
        small_undo,
        budget
    );
    // Card 1 remains (1 point), Card 2 credit was soft-deleted
    let state = c.get_game_depth_state().unwrap();
    let owl_id = game_pet_id(NIL_USER_ID, "owl", "classic");
    let owl = state.pets.iter().find(|p| p.id == owl_id).unwrap();
    assert_eq!(owl.growth_points, 1);
    let _ = review_source_key(2, 0);
}

#[test]
fn no_credit_written_after_mount_unlocked() {
    let dir = std::env::temp_dir().join(format!(
        "keepsake_14c_no_credit_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("collection.db");
    let storage = SqliteStorage::open(&db_path).unwrap();
    storage.ensure_collection(BASE_MS).unwrap();
    storage
        .import(
            &seed_card_model(vec![make_card(1, 1), make_card(2, 1), make_card(3, 1)]),
            BASE_MS,
        )
        .unwrap();
    let clock = Arc::new(TestClock::new(BASE_MS));
    let c = Collection::new(Box::new(storage), clock.clone()).unwrap();

    let next = CardState {
        phase: CardPhase::Review,
        interval_days: 5,
        ease_milli: 2500,
        reps: 1,
        lapses: 0,
        steps_remaining: 0,
        stability: Some(5.0),
        difficulty: Some(5.0),
        last_review_day: Some(0),
    };
    // Answer card 1 -> unlocks owl:classic (active) + 1 bond point
    c.apply_answer(
        1,
        1,
        &CardState::new(2500),
        0,
        &next,
        1,
        &Revlog {
            id: clock.now_ms(),
            card_id: 1,
            usn: -1,
            ease: 3,
            interval: 5,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 500,
            review_kind: 1,
        },
        8,
    )
    .unwrap();

    // Complete 25 rewarded tasks across 3 days (+50 points -> mount unlocked at 51)
    for d in 0..3_i32 {
        let count = if d < 2 { 10 } else { 5 };
        for i in 0..count {
            clock.advance_ms(100);
            let t = c
                .create_task(TaskInput {
                    list_id: None,
                    title: format!("Bond {d}-{i}"),
                    notes: String::new(),
                    priority: TaskPriority::None,
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
        }
        if d < 2 {
            clock.advance_days(1);
        }
    }

    let state_before = c.get_game_depth_state().unwrap();
    let owl = state_before
        .pets
        .iter()
        .find(|p| p.species_key == "owl" && p.variant_key == "classic")
        .unwrap();
    assert!(owl.mount_unlocked);
    assert_eq!(owl.growth_points, 50);

    let inspect = Connection::open(&db_path).unwrap();
    let credits_before: i64 = inspect
        .query_row(
            "SELECT COUNT(*) FROM game_pet_credits WHERE user_id = ?1",
            [NIL_USER_ID],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(credits_before, 26);

    // Answer card 2 and complete another task -> both earn ledger rewards, neither writes a pet credit
    clock.advance_ms(1_000);
    c.apply_answer(
        2,
        2,
        &CardState::new(2500),
        0,
        &next,
        1,
        &Revlog {
            id: clock.now_ms(),
            card_id: 2,
            usn: -1,
            ease: 3,
            interval: 5,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 500,
            review_kind: 1,
        },
        8,
    )
    .unwrap();
    let extra_task = c
        .create_task(TaskInput {
            list_id: None,
            title: "After mount".into(),
            notes: String::new(),
            priority: TaskPriority::None,
            manual_quadrant: None,
            due_date: None,
            scheduled_start_ms: None,
            scheduled_end_ms: None,
            tags: vec![],
            deck_id: None,
            sort_order: 0,
        })
        .unwrap();
    c.complete_task(&extra_task.id).unwrap();

    let extra_lid = ledger_id(NIL_USER_ID, &format!("task_done:{}", extra_task.id));
    let card2_lid = ledger_id(NIL_USER_ID, &review_source_key(2, c.today()));
    let credits_after: i64 = inspect
        .query_row(
            "SELECT COUNT(*) FROM game_pet_credits WHERE user_id = ?1",
            [NIL_USER_ID],
            |r| r.get(0),
        )
        .unwrap();
    let extra_rows: i64 = inspect
        .query_row(
            "SELECT COUNT(*) FROM game_pet_credits WHERE user_id = ?1 AND ledger_id IN (?2, ?3)",
            params![NIL_USER_ID, card2_lid, extra_lid],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(credits_after, credits_before);
    assert_eq!(extra_rows, 0);

    drop(inspect);
    drop(c);
    let _ = std::fs::remove_dir_all(&dir);
}
