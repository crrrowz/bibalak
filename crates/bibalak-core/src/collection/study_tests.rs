use super::*;
use crate::collection::fake_storage::{deck, FakeStorage};
use crate::ports::FixedClock;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[test]
fn prefer_new_interleaves_evenly() {
    // Fresh session, equal-sized streams: new goes first (tie → new).
    assert!(prefer_new(0, 10, 0, 10));
    // After one new and zero reviews, review is now behind → pick review.
    assert!(!prefer_new(1, 9, 0, 10));
    // Driving the merge to completion yields an even split (~half new).
    let (mut new_done, mut rev_done) = (0u32, 0u32);
    let (new_total, rev_total) = (10u32, 20u32);
    for _ in 0..(new_total + rev_total) {
        let new_rem = new_total - new_done;
        let rev_rem = rev_total - rev_done;
        if new_rem == 0 {
            rev_done += 1;
        } else if rev_rem == 0 || prefer_new(new_done, new_rem, rev_done, rev_rem) {
            new_done += 1;
        } else {
            rev_done += 1;
        }
    }
    assert_eq!((new_done, rev_done), (new_total, rev_total));
}

#[test]
fn count_due_by_type_sums_subtree_excluding_filtered() {
    let storage = FakeStorage::default();
    storage.decks.lock().unwrap().extend([
        deck(1, "Spanish", None, false),
        deck(2, "Spanish::Verbs", Some(1), false),
        deck(3, "Cram", Some(1), true),
    ]);
    {
        let mut counts = storage.due_counts.lock().unwrap();
        counts.insert(1, (1, 0, 0));
        counts.insert(2, (2, 1, 1));
        counts.insert(3, (100, 100, 100));
    }

    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();
    assert_eq!(c.count_due_by_type(1).unwrap(), (3, 1, 1));
    assert_eq!(c.count_due(1).unwrap(), 5);
}

#[test]
fn next_card_prefers_soonest_learning_across_subtree() {
    let storage = FakeStorage::default();
    storage.decks.lock().unwrap().extend([
        deck(1, "Spanish", None, false),
        deck(2, "Spanish::Verbs", Some(1), false),
    ]);
    {
        let mut queues = storage.queues.lock().unwrap();
        queues.insert(
            1,
            crate::ports::StudyQueue {
                learning: vec![101],
                ..Default::default()
            },
        );
        queues.insert(
            2,
            crate::ports::StudyQueue {
                learning: vec![201],
                ..Default::default()
            },
        );
    }
    {
        let mut due = storage.due_ms.lock().unwrap();
        due.insert(101, 5_000);
        due.insert(201, 1_000); // the child's card is due sooner
    }

    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();
    // Studying the parent surfaces the child's card because it's soonest due.
    assert_eq!(c.next_card_id(1).unwrap(), Some(201));
    // Studying the child directly only ever sees its own queue.
    assert_eq!(c.next_card_id(2).unwrap(), Some(201));
}

#[test]
fn next_card_interleaves_new_and_review_across_subtree() {
    let storage = FakeStorage::default();
    storage.decks.lock().unwrap().extend([
        deck(1, "Spanish", None, false),
        deck(2, "Spanish::Verbs", Some(1), false),
    ]);
    {
        let mut queues = storage.queues.lock().unwrap();
        queues.insert(
            1,
            crate::ports::StudyQueue {
                new: vec![11],
                ..Default::default()
            },
        );
        queues.insert(
            2,
            crate::ports::StudyQueue {
                review: vec![22],
                ..Default::default()
            },
        );
    }

    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();
    // No cards studied yet on either stream: `prefer_new` ties toward new.
    assert_eq!(c.next_card_id(1).unwrap(), Some(11));
}

#[test]
fn filtered_deck_studies_in_isolation() {
    let storage = FakeStorage::default();
    storage
        .decks
        .lock()
        .unwrap()
        .push(deck(1, "Cram", None, true));
    storage.queues.lock().unwrap().insert(
        1,
        crate::ports::StudyQueue {
            new: vec![11],
            ..Default::default()
        },
    );

    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();
    assert_eq!(c.next_card_id(1).unwrap(), Some(11));
}

#[test]
fn learn_ahead_skips_in_grace_card_for_a_later_one() {
    let storage = FakeStorage::default();
    storage
        .decks
        .lock()
        .unwrap()
        .push(deck(1, "Spanish", None, false));
    storage.queues.lock().unwrap().insert(
        1,
        crate::ports::StudyQueue {
            learning_ahead: vec![101, 102], // 101 due sooner
            ..Default::default()
        },
    );
    storage
        .due_ms
        .lock()
        .unwrap()
        .extend([(101, 2_000), (102, 5_000)]);
    // 101 was just answered (in grace); 102 has never been answered.
    storage.last_answered.lock().unwrap().insert(101, 1_000);

    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();
    assert_eq!(c.next_card_id(1).unwrap(), Some(102));
}

#[test]
fn learn_ahead_returns_sole_candidate_even_in_grace() {
    let storage = FakeStorage::default();
    storage
        .decks
        .lock()
        .unwrap()
        .push(deck(1, "Spanish", None, false));
    storage.queues.lock().unwrap().insert(
        1,
        crate::ports::StudyQueue {
            learning_ahead: vec![201],
            ..Default::default()
        },
    );
    storage.last_answered.lock().unwrap().insert(201, 1_000);

    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();
    // Grace never blocks the only card that can be shown.
    assert_eq!(c.next_card_id(1).unwrap(), Some(201));
}

#[test]
fn learning_due_now_skips_in_grace_card_for_another_due_card() {
    let storage = FakeStorage::default();
    storage
        .decks
        .lock()
        .unwrap()
        .push(deck(1, "Spanish", None, false));
    storage.queues.lock().unwrap().insert(
        1,
        crate::ports::StudyQueue {
            learning: vec![301, 302],
            ..Default::default()
        },
    );
    storage.last_answered.lock().unwrap().insert(301, 1_000);

    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();
    assert_eq!(c.next_card_id(1).unwrap(), Some(302));
}

#[test]
fn learning_due_now_in_grace_defers_to_new_card() {
    let storage = FakeStorage::default();
    storage
        .decks
        .lock()
        .unwrap()
        .push(deck(1, "Spanish", None, false));
    storage.queues.lock().unwrap().insert(
        1,
        crate::ports::StudyQueue {
            learning: vec![301],
            new: vec![11],
            ..Default::default()
        },
    );
    storage.last_answered.lock().unwrap().insert(301, 1_000);

    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();
    assert_eq!(c.next_card_id(1).unwrap(), Some(11));
}

#[test]
fn learning_due_now_in_grace_is_shown_when_it_is_the_only_card() {
    let storage = FakeStorage::default();
    storage
        .decks
        .lock()
        .unwrap()
        .push(deck(1, "Spanish", None, false));
    storage.queues.lock().unwrap().insert(
        1,
        crate::ports::StudyQueue {
            learning: vec![301],
            ..Default::default()
        },
    );
    storage.last_answered.lock().unwrap().insert(301, 1_000);

    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();
    // Sole card in the whole deck: grace must not dead-end the session.
    assert_eq!(c.next_card_id(1).unwrap(), Some(301));
}

#[test]
fn start_study_session_unburies_only_when_day_changes() {
    let unbury_calls = Arc::new(AtomicUsize::new(0));
    let storage = FakeStorage {
        unbury_calls: unbury_calls.clone(),
        ..Default::default()
    };
    storage
        .decks
        .lock()
        .unwrap()
        .push(deck(1, "Spanish", None, false));
    let clock = Arc::new(crate::ports::TestClock::new(1_000));
    let c = Collection::new(Box::new(storage), clock.clone()).unwrap();

    c.start_study_session(1).unwrap();
    assert_eq!(unbury_calls.load(Ordering::SeqCst), 1);

    // Calling it again on the same day should NOT unbury again.
    c.start_study_session(1).unwrap();
    assert_eq!(unbury_calls.load(Ordering::SeqCst), 1);

    // Advance to next day (86_400_000 ms).
    clock.advance_days(1);
    c.start_study_session(1).unwrap();
    assert_eq!(unbury_calls.load(Ordering::SeqCst), 2);

    // Calling again on the new day should NOT unbury again.
    c.start_study_session(1).unwrap();
    assert_eq!(unbury_calls.load(Ordering::SeqCst), 2);
}

#[test]
fn apply_answer_records_undo_step() {
    let undo_answer_calls = Arc::new(AtomicUsize::new(0));
    let storage = FakeStorage {
        undo_answer_calls: undo_answer_calls.clone(),
        ..Default::default()
    };
    let clock = Arc::new(FixedClock(1_000));
    let c = Collection::new(Box::new(storage), clock).unwrap();

    let prev = CardState::new(2500);
    let next = CardState::new(2500);
    let log = Revlog {
        id: 1_000,
        card_id: 101,
        usn: -1,
        ease: 3,
        interval: 1,
        last_interval: 0,
        ease_factor: 2500,
        taken_ms: 5000,
        review_kind: 0,
    };

    c.apply_answer(101, 1, &prev, 0, &next, 1, &log, 0).unwrap();
    assert_eq!(
        c.undo_status(),
        Some(crate::undo::UndoAction::AnswerCard),
        "apply_answer must record UndoAction::AnswerCard in UndoLog"
    );
    let undone = c.undo().unwrap();
    assert_eq!(undone, Some(crate::undo::UndoAction::AnswerCard));
    assert_eq!(undo_answer_calls.load(Ordering::SeqCst), 1);
}

#[test]
fn repro_b_parent_subtree_caps_new_and_review_by_ancestor() {
    let storage = FakeStorage::default();
    storage.decks.lock().unwrap().extend([
        deck(1, "Spanish", None, false),
        deck(2, "Spanish::Verbs", Some(1), false),
        deck(3, "Spanish::Nouns", Some(1), false),
    ]);
    {
        let mut limits = storage.deck_limits_map.lock().unwrap();
        limits.insert(1, (20, 10));
        limits.insert(2, (20, 10));
        limits.insert(3, (20, 10));
    }
    {
        let mut counts = storage.due_counts.lock().unwrap();
        counts.insert(2, (15, 0, 8));
        counts.insert(3, (15, 0, 8));
    }
    {
        let mut queues = storage.queues.lock().unwrap();
        queues.insert(
            2,
            crate::ports::StudyQueue {
                new: (200..215).collect(),
                review: (2000..2008).collect(),
                ..Default::default()
            },
        );
        queues.insert(
            3,
            crate::ports::StudyQueue {
                new: (300..315).collect(),
                review: (3000..3008).collect(),
                ..Default::default()
            },
        );
    }

    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();
    assert_eq!(
        c.count_due_by_type(1).unwrap(),
        (20, 0, 10),
        "studying parent must cap subtree new=20 and review=10"
    );
    assert_eq!(
        c.count_due_by_type(2).unwrap(),
        (15, 0, 8),
        "studying subdeck directly uses subdeck's own limit"
    );
}

#[test]
fn repro_b_parent_subtree_accounts_for_already_studied_in_children() {
    let storage = FakeStorage::default();
    storage.decks.lock().unwrap().extend([
        deck(1, "Spanish", None, false),
        deck(2, "Spanish::Verbs", Some(1), false),
        deck(3, "Spanish::Nouns", Some(1), false),
    ]);
    {
        let mut limits = storage.deck_limits_map.lock().unwrap();
        limits.insert(1, (20, 10));
        limits.insert(2, (20, 10));
        limits.insert(3, (20, 10));
    }
    {
        let mut studied = storage.today_studied_map.lock().unwrap();
        studied.insert(2, (12, 5));
        studied.insert(3, (8, 5));
    }
    {
        let mut counts = storage.due_counts.lock().unwrap();
        counts.insert(2, (10, 0, 10));
        counts.insert(3, (10, 0, 10));
    }
    {
        let mut queues = storage.queues.lock().unwrap();
        queues.insert(
            2,
            crate::ports::StudyQueue {
                new: (200..210).collect(),
                review: (2000..2010).collect(),
                ..Default::default()
            },
        );
        queues.insert(
            3,
            crate::ports::StudyQueue {
                new: (300..310).collect(),
                review: (3000..3010).collect(),
                ..Default::default()
            },
        );
    }

    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();
    assert_eq!(
        c.count_due_by_type(1).unwrap(),
        (0, 0, 0),
        "20 new and 10 review already studied across subdecks exhausts parent limit"
    );
    assert_eq!(c.next_card_id(1).unwrap(), None);
}

fn deck_with_own_config(
    id: i64,
    name: &str,
    parent_id: Option<i64>,
    is_filtered: bool,
) -> crate::model::Deck {
    let mut d = deck(id, name, parent_id, is_filtered);
    d.config_id = id;
    d
}

#[test]
fn repro_b_multi_level_ancestor_and_extra_new_cap() {
    let storage = FakeStorage::default();
    storage.decks.lock().unwrap().extend([
        deck_with_own_config(1, "Root", None, false),
        deck_with_own_config(2, "Root::Mid", Some(1), false),
        deck_with_own_config(3, "Root::Mid::LeafA", Some(2), false),
        deck_with_own_config(4, "Root::Mid::LeafB", Some(2), false),
        deck_with_own_config(5, "Root::Other", Some(1), false),
    ]);
    {
        let mut limits = storage.deck_limits_map.lock().unwrap();
        limits.insert(1, (25, 200));
        limits.insert(2, (10, 200));
        limits.insert(3, (20, 200));
        limits.insert(4, (20, 200));
        limits.insert(5, (25, 200));
    }
    storage.extra_new_map.lock().unwrap().insert(3, 5);
    {
        let mut counts = storage.due_counts.lock().unwrap();
        counts.insert(3, (15, 0, 0));
        counts.insert(4, (15, 0, 0));
        counts.insert(5, (20, 0, 0));
    }

    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();
    // Mid caps {LeafA, LeafB} at 10 total; Other adds 20 -> 30 total, capped by Root at 25.
    assert_eq!(c.count_due_by_type(1).unwrap(), (25, 0, 0));
    // Studying Mid caps at 10 even with extra_new on LeafA.
    assert_eq!(c.count_due_by_type(2).unwrap(), (10, 0, 0));
    // Studying LeafA directly sees 15 available (within its 20 + 5 limit).
    assert_eq!(c.count_due_by_type(3).unwrap(), (15, 0, 0));
}

#[test]
fn increase_today_new_limit_spreads_to_non_filtered_subdecks_capped_by_parent() {
    let storage = FakeStorage::default();
    storage.decks.lock().unwrap().extend([
        deck_with_own_config(1, "Languages", None, false),
        deck_with_own_config(2, "Languages::Arabic", Some(1), false),
        deck_with_own_config(3, "Languages::Spanish", Some(1), false),
        deck_with_own_config(4, "Languages::Cram", Some(1), true),
    ]);
    {
        let mut limits = storage.deck_limits_map.lock().unwrap();
        limits.insert(1, (4, 200));
        limits.insert(2, (2, 200));
        limits.insert(3, (2, 200));
        limits.insert(4, (2, 200));
    }
    // Both non-filtered subdecks have already hit their own 2/day cap today,
    // while each still has 5 unseen new cards waiting.
    {
        let mut studied = storage.today_studied_map.lock().unwrap();
        studied.insert(2, (2, 0));
        studied.insert(3, (2, 0));
    }
    {
        let mut counts = storage.due_counts.lock().unwrap();
        counts.insert(2, (5, 0, 0));
        counts.insert(3, (5, 0, 0));
        counts.insert(4, (5, 0, 0));
    }

    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();
    assert_eq!(c.count_due_by_type(1).unwrap().0, 0);

    // Owner decision (STUDY1 item 4): raising a parent's today limit by N adds N to
    // the parent AND each non-filtered subdeck, while the parent cap keeps total at N.
    c.increase_today_new_limit(1, 3).unwrap();

    assert_eq!(c.get_today_extra_new(1).unwrap(), 3);
    assert_eq!(c.get_today_extra_new(2).unwrap(), 3);
    assert_eq!(c.get_today_extra_new(3).unwrap(), 3);
    assert_eq!(
        c.get_today_extra_new(4).unwrap(),
        0,
        "filtered subdeck untouched"
    );
    assert_eq!(
        c.count_due_by_type(1).unwrap().0,
        3,
        "parent cap keeps total extra new cards at N=3 across subdecks"
    );
}

#[test]
fn progress_summary_crosses_level_boundary_accurately() {
    let storage = FakeStorage::default();
    storage
        .progress_ledger
        .lock()
        .unwrap()
        .push(crate::progress::ProgressLedgerEntry {
            id: "e1".into(),
            user_id: crate::progress::NIL_USER_ID.into(),
            source_key: crate::progress::review_source_key(1, 0),
            xp: 44,
            gold_cents: 25,
            created_at: 1_000,
            updated_at: 1_000,
            deleted_at: None,
            usn: -1,
        });
    let ledger_ref = storage.progress_ledger.clone();
    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();

    // At 44 total/today XP: Level 1, 44 / 100 XP (never capped at 10).
    let s1 = c.progress_summary().unwrap();
    assert_eq!(
        (s1.level, s1.xp_into_level, s1.xp_to_next_level, s1.today_xp),
        (1, 44, 100, 44)
    );

    // At 99 XP: still Level 1 (99 / 100).
    ledger_ref
        .lock()
        .unwrap()
        .push(crate::progress::ProgressLedgerEntry {
            id: "e2".into(),
            user_id: crate::progress::NIL_USER_ID.into(),
            source_key: crate::progress::review_source_key(2, 0),
            xp: 55,
            gold_cents: 25,
            created_at: 1_000,
            updated_at: 1_000,
            deleted_at: None,
            usn: -1,
        });
    let s99 = c.progress_summary().unwrap();
    assert_eq!(
        (s99.level, s99.xp_into_level, s99.xp_to_next_level),
        (1, 99, 100)
    );

    // +1 XP -> 100 XP: levels up to Level 2 (0 / 150).
    ledger_ref
        .lock()
        .unwrap()
        .push(crate::progress::ProgressLedgerEntry {
            id: "e3".into(),
            user_id: crate::progress::NIL_USER_ID.into(),
            source_key: crate::progress::review_source_key(3, 0),
            xp: 1,
            gold_cents: 25,
            created_at: 1_000,
            updated_at: 1_000,
            deleted_at: None,
            usn: -1,
        });
    let s100 = c.progress_summary().unwrap();
    assert_eq!(
        (s100.level, s100.xp_into_level, s100.xp_to_next_level),
        (2, 0, 150)
    );
}

#[test]
fn repro_c_grace_never_hides_due_learning_card_for_multiple_answers() {
    let storage = FakeStorage::default();
    storage
        .decks
        .lock()
        .unwrap()
        .push(deck(1, "Spanish", None, false));
    {
        let mut queues = storage.queues.lock().unwrap();
        queues.insert(
            1,
            crate::ports::StudyQueue {
                learning: vec![301],
                new: vec![11, 12],
                ..Default::default()
            },
        );
    }
    storage.due_ms.lock().unwrap().insert(301, 1_000);
    storage.last_answered.lock().unwrap().insert(301, 1_000);

    let queues_ref = storage.queues.clone();
    let last_ref = storage.last_answered.clone();
    let clock = Arc::new(crate::ports::TestClock::new(1_000));
    let c = Collection::new(Box::new(storage), clock.clone()).unwrap();

    // First call immediately after answering 301: deferred once to 11.
    assert_eq!(c.next_card_id(1).unwrap(), Some(11));

    // User answers 11 at t=5_000 (while 12 still sits in new and 301 is still due).
    {
        let mut q = queues_ref.lock().unwrap();
        q.get_mut(&1).unwrap().new.retain(|&id| id != 11);
    }
    last_ref.lock().unwrap().insert(11, 5_000);
    clock.set(5_000);

    // Due learning card 301 must now resurface instead of being hidden behind 12.
    assert_eq!(c.next_card_id(1).unwrap(), Some(301));
}

#[test]
fn apply_answer_storage_error_leaves_neither_answer_nor_reward() {
    let storage = FakeStorage::default();
    storage
        .decks
        .lock()
        .unwrap()
        .push(deck(1, "Spanish", None, false));
    let fail_flag = storage.fail_apply_answer.clone();
    let revlogs_ref = storage.applied_revlogs.clone();
    let ledger_ref = storage.progress_ledger.clone();

    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();
    let prev = crate::scheduling::CardState::new(2500);
    let next = crate::scheduling::CardState {
        phase: crate::scheduling::CardPhase::Review,
        interval_days: 1,
        reps: 1,
        ..prev
    };
    let log1 = crate::model::Revlog {
        id: 1_000,
        card_id: 10,
        usn: -1,
        ease: 3,
        interval: 1,
        last_interval: 0,
        ease_factor: 2500,
        taken_ms: 1000,
        review_kind: 0,
    };

    // 1. Failing storage apply_answer leaves neither revlog nor reward nor undo entry.
    fail_flag.store(true, std::sync::atomic::Ordering::SeqCst);
    let res = c.apply_answer(10, 100, &prev, 0, &next, 1, &log1, 8);
    assert!(res.is_err());
    assert!(revlogs_ref.lock().unwrap().is_empty());
    assert!(ledger_ref.lock().unwrap().is_empty());
    assert_eq!(c.progress_summary().unwrap().total_xp, 0);
    assert!(c.undo_status().is_none());

    // 2. When storage succeeds, both the revlog and the reward are persisted atomically.
    fail_flag.store(false, std::sync::atomic::Ordering::SeqCst);
    c.apply_answer(10, 100, &prev, 0, &next, 1, &log1, 8)
        .unwrap();
    assert_eq!(*revlogs_ref.lock().unwrap(), vec![1_000]);
    assert_eq!(ledger_ref.lock().unwrap().len(), 1);
    let summary = c.progress_summary().unwrap();
    assert_eq!(summary.total_xp, 3);
    assert_eq!(summary.gold_cents, 25);
}

#[test]
fn progress_history_accumulates_levels_excludes_undone_and_skips_bad_keys() {
    let storage = FakeStorage::default();
    storage.progress_ledger.lock().unwrap().extend([
        crate::progress::ProgressLedgerEntry {
            id: "1".into(),
            user_id: crate::progress::NIL_USER_ID.into(),
            source_key: crate::progress::review_source_key(10, 2),
            xp: 120,
            gold_cents: 50,
            created_at: 200,
            updated_at: 200,
            deleted_at: None,
            usn: -1,
        },
        crate::progress::ProgressLedgerEntry {
            id: "2".into(),
            user_id: crate::progress::NIL_USER_ID.into(),
            source_key: crate::progress::review_source_key(11, 0),
            xp: 90,
            gold_cents: 25,
            created_at: 100,
            updated_at: 100,
            deleted_at: None,
            usn: -1,
        },
        crate::progress::ProgressLedgerEntry {
            id: "3".into(),
            user_id: crate::progress::NIL_USER_ID.into(),
            source_key: crate::progress::review_source_key(12, 0),
            xp: 10,
            gold_cents: 25,
            created_at: 110,
            updated_at: 110,
            deleted_at: None,
            usn: -1,
        },
        crate::progress::ProgressLedgerEntry {
            id: "4".into(),
            user_id: crate::progress::NIL_USER_ID.into(),
            source_key: crate::progress::review_source_key(13, 1),
            xp: 999,
            gold_cents: 999,
            created_at: 150,
            updated_at: 160,
            deleted_at: Some(160),
            usn: -1,
        },
        crate::progress::ProgressLedgerEntry {
            id: "5".into(),
            user_id: crate::progress::NIL_USER_ID.into(),
            source_key: "malformed_key".into(),
            xp: 50,
            gold_cents: 25,
            created_at: 170,
            updated_at: 170,
            deleted_at: None,
            usn: -1,
        },
    ]);

    // Created at 2026-11-13 23:30 UTC+3 -> Day 0 = 2026-11-13, Day 2 = 2026-11-15.
    let mut c =
        Collection::new(Box::new(storage), Arc::new(FixedClock(1_794_601_800_000))).unwrap();
    c.created_ms = 1_794_601_800_000;
    c.set_local_offset_minutes(180);

    let (days, skipped) = c.progress_history_with_skipped().unwrap();
    assert_eq!(skipped, 1);
    assert_eq!(days.len(), 2);
    assert_eq!(
        days[0],
        crate::progress::ProgressDay {
            day: 0,
            date: "2026-11-13".into(),
            xp: 100,
            gold_cents: 50,
            cumulative_xp: 100,
            level_after: crate::progress::level_from_xp(100).level,
        }
    );
    assert_eq!(
        days[1],
        crate::progress::ProgressDay {
            day: 2,
            date: "2026-11-15".into(),
            xp: 120,
            gold_cents: 50,
            cumulative_xp: 220,
            level_after: crate::progress::level_from_xp(220).level,
        }
    );
}

#[test]
fn study_days_and_progress_by_deck_work_on_fake_storage() {
    let storage = FakeStorage::default();
    storage.decks.lock().unwrap().extend([
        deck(1, "Physics", None, false),
        deck(2, "Physics::Mechanics", Some(1), false),
    ]);
    storage.cards.lock().unwrap().push(crate::model::Card {
        id: 100,
        note_id: 1,
        deck_id: 2,
        ord: 0,
        mod_ms: 0,
        usn: -1,
        ctype: 2,
        queue: 2,
        due: 0,
        interval: 30,
        ease_factor: 2500,
        reps: 5,
        lapses: 0,
        remaining: 0,
        original_due: 0,
        original_deck_id: 0,
        flags: 0,
        fsrs_stability: None,
        fsrs_difficulty: None,
        fsrs_last_review: None,
        data: None,
    });
    let created_ms = 1_794_601_800_000; // 2026-11-13 23:30 UTC+3
    let day1_ms = 1_794_688_200_000; // 2026-11-14 23:30 UTC+3 (Day 1)
    storage.revlogs.lock().unwrap().push(crate::model::Revlog {
        id: day1_ms,
        card_id: 100,
        usn: -1,
        ease: 3,
        interval: 30,
        last_interval: 10,
        ease_factor: 2500,
        taken_ms: 30_000,
        review_kind: 1,
    });
    storage
        .progress_ledger
        .lock()
        .unwrap()
        .push(crate::progress::ProgressLedgerEntry {
            id: "1".into(),
            user_id: crate::progress::NIL_USER_ID.into(),
            source_key: crate::progress::review_source_key(100, 1),
            xp: 3,
            gold_cents: 25,
            created_at: day1_ms,
            updated_at: day1_ms,
            deleted_at: None,
            usn: -1,
        });

    let mut c = Collection::new(Box::new(storage), Arc::new(FixedClock(day1_ms))).unwrap();
    c.created_ms = created_ms;
    c.set_local_offset_minutes(180);

    let days = c.study_days(Some(30)).unwrap();
    assert_eq!(days.len(), 1);
    assert_eq!(days[0].day, 1);
    assert_eq!(days[0].date, "2026-11-14");
    assert_eq!(days[0].reviews, 1);
    assert_eq!(days[0].minutes, 0.5);
    assert_eq!(days[0].deck_ids, vec![1]);
    assert_eq!(days[0].xp, 3);
    assert_eq!(days[0].gold_cents, 25);

    let decks = c.progress_by_deck().unwrap();
    assert_eq!(decks.len(), 1);
    assert_eq!(decks[0].deck_id, 1);
    assert_eq!(decks[0].name, "Physics");
    assert_eq!(decks[0].total_cards, 1);
    assert_eq!(decks[0].mature_pct, 100.0);
    assert_eq!(decks[0].retention_pct, 100.0);
    assert_eq!(decks[0].xp, 3);
    assert_eq!(decks[0].gold_cents, 25);
    assert_eq!(decks[0].last_studied_date.as_deref(), Some("2026-11-14"));
}

struct FakeSchedulerSet {
    answer_calls: AtomicUsize,
    fuzz_calls: AtomicUsize,
}

impl FakeSchedulerSet {
    fn new() -> Self {
        Self {
            answer_calls: AtomicUsize::new(0),
            fuzz_calls: AtomicUsize::new(0),
        }
    }
}

impl crate::ports::SchedulerSet for FakeSchedulerSet {
    fn answer(
        &self,
        _algorithm: crate::model::Algorithm,
        state: &CardState,
        _rating: Rating,
        _ctx: &SchedContext,
    ) -> crate::scheduling::AnswerOutcome {
        self.answer_calls.fetch_add(1, Ordering::SeqCst);
        crate::scheduling::AnswerOutcome {
            next: CardState {
                phase: CardPhase::Review,
                interval_days: 7,
                reps: state.reps + 1,
                ..*state
            },
            interval: Interval::Days(7),
        }
    }

    fn fuzz_days(&self, days: u32, _card_id: i64) -> u32 {
        self.fuzz_calls.fetch_add(1, Ordering::SeqCst);
        days + 1
    }
}

fn sample_study_card(card_id: i64, deck_id: i64) -> StudyCard {
    StudyCard {
        id: card_id,
        note_id: 100 + card_id,
        deck_id,
        due: 0,
        render: crate::model::CardRender {
            fields: vec![("Front".into(), "Q".into()), ("Back".into(), "A".into())],
            qfmt: "{{Front}}".into(),
            afmt: "{{Back}}".into(),
            is_cloze: false,
            card_ord: 0,
            tags: String::new(),
            deck: "Default".into(),
            subdeck: "Default".into(),
            notetype: "Basic".into(),
            card_name: "Card 1".into(),
            flag: 0,
            css: String::new(),
            occlusion_mode: String::new(),
        },
        state: CardState::new(2500),
    }
}

#[test]
fn answer_card_uses_core_orchestration_and_fails_on_missing_config() {
    let storage = FakeStorage::default();
    storage
        .decks
        .lock()
        .unwrap()
        .push(deck(1, "Default", None, false));
    storage
        .study_cards
        .lock()
        .unwrap()
        .insert(10, sample_study_card(10, 1));
    let revlogs = storage.applied_revlogs.clone();
    let fail_config = storage.fail_get_deck_config.clone();

    let sched = Arc::new(FakeSchedulerSet::new());
    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(5_000)))
        .unwrap()
        .with_scheduler_set(sched.clone());

    // Happy path: core loads card + config, invokes SchedulerSet, and applies answer.
    let leech = c.answer_card(10, Rating::Good, 1_500).unwrap();
    assert!(!leech);
    assert_eq!(sched.answer_calls.load(Ordering::SeqCst), 1);
    assert_eq!(sched.fuzz_calls.load(Ordering::SeqCst), 1);
    assert_eq!(*revlogs.lock().unwrap(), vec![5_000]);

    // Config failure must propagate (no silent unwrap_or_default).
    fail_config.store(true, Ordering::SeqCst);
    let err = c.answer_card(10, Rating::Good, 1_500).unwrap_err();
    assert!(matches!(err, CoreError::Storage(_)));
}

#[test]
fn answer_card_not_found_returns_error() {
    let storage = FakeStorage::default();
    let sched = Arc::new(FakeSchedulerSet::new());
    let c = Collection::new(Box::new(storage), Arc::new(FixedClock(5_000)))
        .unwrap()
        .with_scheduler_set(sched);

    let err = c.answer_card(999, Rating::Good, 1_000).unwrap_err();
    assert!(matches!(err, CoreError::NotFound(_)));
}
