//! Permanent regression tests for MAINT4 progress, ledger, game, and stats invariants.

use std::sync::Arc;

use bibalak_core::game::STREAK_FREEZE_ITEM_KEY;
use bibalak_core::model::{Card, Deck, Field, Note, Notetype, Revlog, Template};
use bibalak_core::motivation::QuestMetric;
use bibalak_core::ports::{MaintenanceStore, TestClock};
use bibalak_core::productivity::{
    HabitFrequencyKind, HabitGoalMode, HabitInput, HabitLogInput, HabitLogStatus, HabitSection,
    TaskDto, TaskInput, TaskPriority,
};
use bibalak_core::scheduling::{CardPhase, CardState};
use bibalak_core::{CanonicalModel, Clock, Collection};
use bibalak_db::SqliteStorage;

const BASE_MS: i64 = 1_795_341_600_000; // 2026-11-21 ~10:00 UTC (well past rollover 04:00)

fn setup_collection() -> (Collection, Arc<TestClock>) {
    let storage = SqliteStorage::open_in_memory().unwrap();
    storage.ensure_collection(BASE_MS).unwrap();
    let clock = Arc::new(TestClock::new(BASE_MS));
    let c = Collection::new(Box::new(storage), clock.clone()).unwrap();
    (c, clock)
}

fn card_with_id(id: i64, deck_id: i64) -> Card {
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

fn seed_cards(c: &Collection, cards: Vec<Card>) {
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
                guid: format!("maint4-g{}", card.note_id),
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
}

fn answer_card_today(
    c: &Collection,
    clock: &TestClock,
    card_id: i64,
    deck_id: i64,
    revlog_id: i64,
) {
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
            id: revlog_id,
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
    let _ = clock.now_ms();
}

fn create_done_task(c: &Collection, title: &str) -> TaskDto {
    let t = c
        .create_task(TaskInput {
            list_id: None,
            title: title.into(),
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
    t
}

fn create_yes_no_habit(c: &Collection, title: &str, start_date: Option<String>) -> String {
    c.create_habit(HabitInput {
        title: title.into(),
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
        start_date,
        target_days: None,
        section: HabitSection::Morning,
        reminders: vec![],
        auto_popup_log: false,
        deck_id: None,
        sort_order: 0,
    })
    .unwrap()
    .id
}

#[test]
fn a3_01_habit_backfill_yesterday_attributes_xp_to_yesterday_everywhere() {
    let (c, clock) = setup_collection();
    let habit_id = create_yes_no_habit(&c, "Daily reading", None);

    clock.advance_days(1);
    let today = c.today();
    let yesterday = today - 1;

    c.log_habit(HabitLogInput {
        habit_id,
        day_index: Some(yesterday),
        logged_value: 1.0,
        status: HabitLogStatus::Logged,
        mood: None,
        note: String::new(),
    })
    .unwrap();

    let summary = c.progress_summary().unwrap();
    let yesterday_sum = c.yesterday_summary().unwrap();
    let mot = c.get_motivation_state().unwrap();

    assert_eq!(
        summary.today_xp, 0,
        "yesterday habit backfill should not inflate today_xp"
    );
    assert_eq!(mot.today_xp, 0);
    assert!(
        yesterday_sum.is_some_and(|y| y.xp > 0),
        "yesterday_summary should include backfilled yesterday habit XP"
    );
    let _ = (STREAK_FREEZE_ITEM_KEY, QuestMetric::Tasks);
}

#[test]
fn a3_02_streak_freeze_milestone_bridges_frozen_gap_and_undo_revokes_token() {
    let (c, clock) = setup_collection();
    seed_cards(&c, (1..=20).map(|i| card_with_id(i, 2)).collect());

    for d in 0..3 {
        for i in 0..10 {
            create_done_task(&c, &format!("Gold-{d}-{i}"));
        }
        clock.advance_days(1);
    }
    c.buy_shop_item(STREAK_FREEZE_ITEM_KEY, "tx-buy-freeze")
        .unwrap();
    assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 1);

    clock.advance_days(2);

    let base_rev_id = clock.now_ms();
    for offset in 0..6 {
        answer_card_today(&c, &clock, offset + 1, 2, base_rev_id + offset);
        clock.advance_days(1);
    }
    clock.advance_days(1);
    let yesterday = c.today() - 1;
    c.freeze_study_day(yesterday).unwrap();
    assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 0);

    answer_card_today(&c, &clock, 10, 2, clock.now_ms() + 100);
    let mot = c.get_motivation_state().unwrap();
    assert_eq!(mot.current_streak, 7);
    assert_eq!(
        c.get_game_state().unwrap().freeze_tokens_held,
        1,
        "reaching a 7-day streak with a frozen bridge should award +1 milestone freeze token"
    );

    c.undo().unwrap();
    assert_eq!(
        c.get_game_state().unwrap().freeze_tokens_held,
        0,
        "undoing the 7th streak day should revoke the milestone freeze token"
    );
}

#[test]
fn a3_04_delete_completed_task_and_habit_reconcile_quest_gold() {
    let (c, clock) = setup_collection();

    for _ in 0..14 {
        if c.get_motivation_state()
            .unwrap()
            .daily_quests
            .iter()
            .any(|q| q.metric == QuestMetric::Tasks)
        {
            break;
        }
        clock.advance_days(1);
    }

    let mot0 = c.get_motivation_state().unwrap();
    let quest = mot0
        .daily_quests
        .iter()
        .find(|q| q.metric == QuestMetric::Tasks)
        .expect("a Tasks daily quest should appear within 14 days")
        .clone();

    let mut tasks = Vec::new();
    for i in 0..quest.target {
        tasks.push(create_done_task(&c, &format!("Task {i}")));
    }

    let mot_before = c.get_motivation_state().unwrap();
    let q_before = mot_before
        .daily_quests
        .iter()
        .find(|q| q.id == quest.id)
        .unwrap();
    assert!(q_before.completed);
    let gold_before_delete = c.progress_summary().unwrap().gold_cents;

    c.delete_task(&tasks[0].id).unwrap();

    let mot_after = c.get_motivation_state().unwrap();
    let q_after = mot_after
        .daily_quests
        .iter()
        .find(|q| q.id == quest.id)
        .unwrap();

    assert_eq!(q_after.progress, quest.target - 1);
    assert!(!q_after.completed);
    assert!(c.progress_summary().unwrap().gold_cents <= gold_before_delete - 200);

    // Also verify delete_habit reconciles daily Habits quests.
    for _ in 0..14 {
        if c.get_motivation_state()
            .unwrap()
            .daily_quests
            .iter()
            .any(|q| q.metric == QuestMetric::Habits)
        {
            break;
        }
        clock.advance_days(1);
    }
    let h_mot = c.get_motivation_state().unwrap();
    if let Some(h_quest) = h_mot
        .daily_quests
        .iter()
        .find(|q| q.metric == QuestMetric::Habits)
    {
        let mut habit_ids = Vec::new();
        for i in 0..h_quest.target {
            let hid = create_yes_no_habit(&c, &format!("Habit {i}"), None);
            c.log_habit(HabitLogInput {
                habit_id: hid.clone(),
                day_index: None,
                logged_value: 1.0,
                status: HabitLogStatus::Logged,
                mood: None,
                note: String::new(),
            })
            .unwrap();
            habit_ids.push(hid);
        }
        let gold_before_habit_del = c.progress_summary().unwrap().gold_cents;
        c.delete_habit(&habit_ids[0]).unwrap();
        let h_after = c.get_motivation_state().unwrap();
        let hq_after = h_after
            .daily_quests
            .iter()
            .find(|q| q.id == h_quest.id)
            .unwrap();
        assert!(!hq_after.completed);
        assert!(c.progress_summary().unwrap().gold_cents <= gold_before_habit_del - 200);
    }
}

#[test]
fn a3_05_undo_habit_unfreeze_cannot_restore_frozen_without_token() {
    let (c, clock) = setup_collection();
    for d in 0..3 {
        for i in 0..10 {
            create_done_task(&c, &format!("G-{d}-{i}"));
        }
        clock.advance_days(1);
    }
    clock.advance_days(1);
    c.buy_shop_item(STREAK_FREEZE_ITEM_KEY, "tx-1").unwrap();
    assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 1);

    let habit_a = create_yes_no_habit(&c, "Habit A", None);

    c.log_habit(HabitLogInput {
        habit_id: habit_a.clone(),
        day_index: None,
        logged_value: 0.0,
        status: HabitLogStatus::Frozen,
        mood: None,
        note: String::new(),
    })
    .unwrap();
    assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 0);

    c.log_habit(HabitLogInput {
        habit_id: habit_a.clone(),
        day_index: None,
        logged_value: 0.0,
        status: HabitLogStatus::Logged,
        mood: None,
        note: String::new(),
    })
    .unwrap();
    assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 1);

    let yesterday = c.today() - 1;
    c.freeze_study_day(yesterday).unwrap();
    assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 0);

    assert!(c.undo().is_err());
    let board = c.get_habit_board(None, Default::default()).unwrap();
    let a_log = board.logs.iter().find(|l| l.habit_id == habit_a).unwrap();
    assert_ne!(
        a_log.status,
        HabitLogStatus::Frozen,
        "cannot restore Frozen status for free with 0 tokens remaining"
    );
}

#[test]
fn a3_14_depth_metrics_cache_reviews_count_and_studied_decks() {
    let (c, clock) = setup_collection();
    seed_cards(&c, vec![card_with_id(1, 2), card_with_id(2, 2)]);

    let initial = c.get_game_depth_state().unwrap();
    let initial_reviews = initial
        .achievements
        .iter()
        .find(|a| a.achievement_key == "ach:reviews_50")
        .unwrap()
        .current_value;
    assert_eq!(initial_reviews, 0);

    answer_card_today(&c, &clock, 1, 2, clock.now_ms());
    let after_one = c.get_game_depth_state().unwrap();
    let reviews_after_one = after_one
        .achievements
        .iter()
        .find(|a| a.achievement_key == "ach:reviews_50")
        .unwrap()
        .current_value;
    assert_eq!(reviews_after_one, 1);

    c.undo().unwrap();
    let after_undo = c.get_game_depth_state().unwrap();
    let reviews_after_undo = after_undo
        .achievements
        .iter()
        .find(|a| a.achievement_key == "ach:reviews_50")
        .unwrap()
        .current_value;
    assert_eq!(reviews_after_undo, 0);
}

#[test]
fn a3_08_stats_week_euclidean_and_negative_day_dates() {
    let (c, _) = setup_collection();

    // Import revlogs at day -1 (before created_ms BASE_MS) and day +1 (after created_ms).
    let day_minus_1_ms = BASE_MS - 86_400_000;
    let day_plus_1_ms = BASE_MS + 86_400_000;
    let model = CanonicalModel {
        decks: vec![Deck {
            id: 2,
            name: "Imported".into(),
            parent_id: None,
            config_id: 1,
            mod_ms: 0,
            usn: 0,
            collapsed: false,
            is_filtered: false,
        }],
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
        notes: vec![Note {
            id: 1,
            guid: "a308-n1".into(),
            notetype_id: 1,
            mod_ms: 0,
            usn: 0,
            tags: vec![],
            fields: vec!["Q".into(), "A".into()],
            sort_field: Some("Q".into()),
            checksum: None,
        }],
        cards: vec![card_with_id(1, 2)],
        revlog: vec![
            Revlog {
                id: day_minus_1_ms,
                card_id: 1,
                usn: -1,
                ease: 3,
                interval: 5,
                last_interval: 1,
                ease_factor: 2500,
                taken_ms: 1_000,
                review_kind: 1,
            },
            Revlog {
                id: day_plus_1_ms,
                card_id: 1,
                usn: -1,
                ease: 3,
                interval: 10,
                last_interval: 5,
                ease_factor: 2500,
                taken_ms: 1_000,
                review_kind: 1,
            },
        ],
        created_ms: Some(BASE_MS - 5 * 86_400_000),
    };
    c.import(&model).unwrap();

    let stats = c.stats(None, None, 0).unwrap();

    assert_eq!(
        stats.retention_weekly.len(),
        2,
        "days -1 and +1 belong to two different 7-day weeks (-1 and 0)"
    );
    assert!(
        stats.dates.contains_key(&-1),
        "stats.dates should include negative imported day index -1"
    );
}

#[test]
fn a3_09_stats_range_uses_rollover_start_and_filters_heatmap() {
    let (c, clock) = setup_collection();

    // Move clock forward 10 days (`today = 10`, ~10:00 UTC).
    clock.advance_days(10);
    let today_10am = BASE_MS + 10 * 86_400_000;
    // Day 3 (`today - 7`), at 06:00 UTC (after 04:00 rollover, before wall-clock 10:00 UTC).
    let boundary_day_morning_ms = today_10am - 7 * 86_400_000 - 4 * 3_600_000;
    // Day 0 (`today - 10`), strictly outside any 7-day filter.
    let old_day0_ms = BASE_MS + 1_000;

    let model = CanonicalModel {
        decks: vec![Deck {
            id: 2,
            name: "Study".into(),
            parent_id: None,
            config_id: 1,
            mod_ms: 0,
            usn: 0,
            collapsed: false,
            is_filtered: false,
        }],
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
        notes: vec![Note {
            id: 1,
            guid: "a309-n1".into(),
            notetype_id: 1,
            mod_ms: 0,
            usn: 0,
            tags: vec![],
            fields: vec!["Q".into(), "A".into()],
            sort_field: Some("Q".into()),
            checksum: None,
        }],
        cards: vec![card_with_id(1, 2)],
        revlog: vec![
            Revlog {
                id: old_day0_ms,
                card_id: 1,
                usn: -1,
                ease: 3,
                interval: 1,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 1_000,
                review_kind: 0,
            },
            Revlog {
                id: boundary_day_morning_ms,
                card_id: 1,
                usn: -1,
                ease: 3,
                interval: 2,
                last_interval: 1,
                ease_factor: 2500,
                taken_ms: 1_000,
                review_kind: 1,
            },
        ],
        created_ms: None,
    };
    c.import(&model).unwrap();

    let stats_7d = c.stats(None, Some(7), 0).unwrap();

    assert!(
        !stats_7d.reviews.iter().any(|r| r.day == 0 && r.count > 0),
        "7d stats.reviews heatmap should not return day 0 reviews outside range"
    );
    assert_eq!(
        stats_7d.total_reviews, 1,
        "boundary day within 7d rollover window should include morning review"
    );
}

#[test]
fn a3_10_stats_counts_buried_fsrs_cram_answers_and_filtered_home_deck() {
    let (c, _) = setup_collection();

    let buried_mature = Card {
        id: 1,
        note_id: 1,
        deck_id: 4,
        ord: 0,
        mod_ms: 0,
        usn: 0,
        ctype: 2,
        queue: -2, // buried mature card currently gathered in filtered deck 4 (home = 2)
        due: 30,
        interval: 30,
        ease_factor: 2500,
        reps: 5,
        lapses: 0,
        remaining: 0,
        original_due: 30,
        original_deck_id: 2,
        flags: 0,
        fsrs_stability: Some(30.0),
        fsrs_difficulty: Some(5.0),
        fsrs_last_review: Some(0),
        data: None,
    };

    let model = CanonicalModel {
        decks: vec![
            Deck {
                id: 2,
                name: "HomeDeck".into(),
                parent_id: None,
                config_id: 1,
                mod_ms: 0,
                usn: 0,
                collapsed: false,
                is_filtered: false,
            },
            Deck {
                id: 4,
                name: "CramDeck".into(),
                parent_id: None,
                config_id: 1,
                mod_ms: 0,
                usn: 0,
                collapsed: false,
                is_filtered: true,
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
        notes: vec![Note {
            id: 1,
            guid: "a310-n1".into(),
            notetype_id: 1,
            mod_ms: 0,
            usn: 0,
            tags: vec![],
            fields: vec!["Q".into(), "A".into()],
            sort_field: Some("Q".into()),
            checksum: None,
        }],
        cards: vec![buried_mature],
        revlog: vec![Revlog {
            id: BASE_MS + 1_000,
            card_id: 1,
            usn: -1,
            ease: 3,
            interval: 30,
            last_interval: 15,
            ease_factor: 2500,
            taken_ms: 2_000,
            review_kind: 3, // Cram/filtered review
        }],
        created_ms: None,
    };
    c.import(&model).unwrap();

    let stats = c.stats(None, None, 0).unwrap();
    let home = stats
        .deck_stats
        .iter()
        .find(|d| d.name == "HomeDeck")
        .unwrap();
    let answers_sum: u32 = stats
        .answer_buttons
        .learning
        .iter()
        .chain(stats.answer_buttons.young.iter())
        .chain(stats.answer_buttons.mature.iter())
        .sum();

    assert_eq!(stats.fsrs.card_count, stats.mature_count);
    assert_eq!(answers_sum, stats.total_reviews);
    assert_eq!(home.total_cards, 1);
}

#[test]
fn a5_09_ranged_stats_sql_pushdown_keeps_30d_coach_and_7d_boundary() {
    let (c, clock) = setup_collection();
    clock.advance_days(45);
    let now_ms = clock.now_ms();

    let ancient_ms = BASE_MS; // 45 days ago: outside both 31d retention and 7d range
    let ret_20d_ms = now_ms - 20 * 86_400_000; // inside 30d coach retention, outside 7d range
    let in_7d_ms = now_ms - 2 * 86_400_000; // inside 7d range

    let model = CanonicalModel {
        decks: vec![Deck {
            id: 2,
            name: "Pushdown".into(),
            parent_id: None,
            config_id: 1,
            mod_ms: 0,
            usn: 0,
            collapsed: false,
            is_filtered: false,
        }],
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
        notes: vec![Note {
            id: 1,
            guid: "a509-n1".into(),
            notetype_id: 1,
            mod_ms: 0,
            usn: 0,
            tags: vec![],
            fields: vec!["Q".into(), "A".into()],
            sort_field: Some("Q".into()),
            checksum: None,
        }],
        cards: vec![card_with_id(1, 2)],
        revlog: vec![
            Revlog {
                id: ancient_ms,
                card_id: 1,
                usn: -1,
                ease: 1,
                interval: 1,
                last_interval: 1,
                ease_factor: 2500,
                taken_ms: 1_000,
                review_kind: 1,
            },
            Revlog {
                id: ret_20d_ms,
                card_id: 1,
                usn: -1,
                ease: 1, // failed review inside 30d window
                interval: 1,
                last_interval: 5,
                ease_factor: 2500,
                taken_ms: 1_000,
                review_kind: 1,
            },
            Revlog {
                id: in_7d_ms,
                card_id: 1,
                usn: -1,
                ease: 3, // passed review inside both 7d and 30d
                interval: 5,
                last_interval: 1,
                ease_factor: 2500,
                taken_ms: 1_000,
                review_kind: 1,
            },
        ],
        created_ms: None,
    };
    c.import(&model).unwrap();

    let stats_7d = c.stats(None, Some(7), 0).unwrap();
    assert_eq!(stats_7d.total_reviews, 1);
    let d2 = stats_7d
        .deck_stats
        .iter()
        .find(|d| d.name == "Pushdown")
        .unwrap();
    assert_eq!(d2.reviews_7d, 1);
    // 30d retention saw both ret_20d_ms (fail) and in_7d_ms (pass) = 50% (not 100%, not 33.3%).
    let ret = d2.retention_pct.expect("30d retention present");
    assert!((ret - 50.0).abs() < 1e-6, "got {ret}");
}

#[test]
fn a5_08_list_deck_algorithms_returns_per_deck_algorithms() {
    let (c, _) = setup_collection();
    let d2 = c.create_deck("FSRSDeck").unwrap();
    let mut cfg2 = c.get_deck_config(d2.id).unwrap();
    cfg2.algorithm = bibalak_core::Algorithm::Fsrs;
    c.set_deck_config(&cfg2).unwrap();

    let algos = c.list_deck_algorithms().unwrap();
    assert!(!algos.is_empty());
    let f = algos.iter().find(|a| a.deck_id == d2.id).unwrap();
    assert_eq!(f.algorithm, bibalak_core::Algorithm::Fsrs);
}
