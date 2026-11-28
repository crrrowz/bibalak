use std::sync::Arc;

use bibalak_core::ports::TestClock;
use bibalak_core::scheduling::CardPhase;
use bibalak_core::{Collection, Rating};
use bibalak_db::SqliteStorage;
use bibalak_scheduler::DefaultSchedulerSet;

// 2026-11-16T12:00:00Z — comfortably inside day 0 (04:00..04:00 UTC rollover).
const T0: i64 = 1_794_830_400_000;

fn setup() -> (Collection, Arc<TestClock>, i64) {
    let storage = SqliteStorage::open_in_memory().unwrap();
    let clock = Arc::new(TestClock::new(T0));
    let c = Collection::new(Box::new(storage), clock.clone())
        .unwrap()
        .with_scheduler_set(Arc::new(DefaultSchedulerSet));
    let nt = c.add_stock_notetype(0).unwrap();
    (c, clock, nt.id)
}

#[test]
fn f1_new_plus_lapsed_reviews_reach_70_learning_on_day_one() {
    let (c, _clock, nt_id) = setup();
    let deck = c.create_deck("DayOne70").unwrap();
    c.set_deck_options(deck.id, 20, 50).unwrap();

    for i in 0..50 {
        c.add_note(
            nt_id,
            deck.id,
            &[format!("Rev Q{i}"), format!("Rev A{i}")],
            &[],
        )
        .unwrap();
    }
    let rev_ids = c.deck_card_ids(deck.id, false).unwrap();
    c.set_due_date(&rev_ids, "0").unwrap();

    for i in 0..20 {
        c.add_note(
            nt_id,
            deck.id,
            &[format!("New Q{i}"), format!("New A{i}")],
            &[],
        )
        .unwrap();
    }

    assert_eq!(c.count_due_by_type(deck.id).unwrap(), (20, 0, 50));

    let mut processed = 0;
    while processed < 70 {
        let card = c.next_card(deck.id).unwrap().expect("expected queued card");
        match card.state.phase {
            CardPhase::New => {
                c.answer_card(card.id, Rating::Good, 500).unwrap();
            }
            CardPhase::Review => {
                c.answer_card(card.id, Rating::Again, 500).unwrap();
            }
            other => panic!("unexpected phase {other:?} before finishing new/review"),
        }
        processed += 1;
    }

    // With New=20 and Review=50, 20 learning + 50 relearning = 70 in Learn (G1).
    let (new_c, learn_c, rev_c) = c.count_due_by_type(deck.id).unwrap();
    assert_eq!((new_c, learn_c, rev_c), (0, 70, 0));
}

#[test]
fn a1_06_studying_child_decks_enforces_parent_new_limit() {
    let (c, _clock, nt_id) = setup();
    let parent = c.create_deck("Lang").unwrap();
    let child_a = c.create_deck("Lang::Vocab").unwrap();
    let child_b = c.create_deck("Lang::Grammar").unwrap();
    c.set_deck_options(parent.id, 20, 50).unwrap();

    for i in 0..25 {
        c.add_note(nt_id, child_a.id, &[format!("VA {i}"), "A".into()], &[])
            .unwrap();
        c.add_note(nt_id, child_b.id, &[format!("GB {i}"), "B".into()], &[])
            .unwrap();
    }

    let mut new_studied = 0u32;
    for child_id in [child_a.id, child_b.id] {
        while let Some(card) = c.next_card(child_id).unwrap() {
            if card.state.phase != CardPhase::New {
                break;
            }
            new_studied += 1;
            c.answer_card(card.id, Rating::Easy, 400).unwrap();
        }
    }

    assert!(
        new_studied <= 20,
        "expected parent deck limit (20) to cap combined child decks, studied {new_studied}"
    );
}

#[test]
fn a1_09_f6_undo_returns_undone_card_next() {
    let (c, _clock, nt_id) = setup();
    let deck = c.create_deck("UndoOrder").unwrap();
    for i in 0..10 {
        c.add_note(
            nt_id,
            deck.id,
            &[format!("Card {i}"), format!("A {i}")],
            &[],
        )
        .unwrap();
    }

    for iter in 0..8 {
        let first = c.next_card(deck.id).unwrap().expect("expected card");
        c.answer_card(first.id, Rating::Good, 500).unwrap();
        c.undo().unwrap();
        let after_undo = c.next_card(deck.id).unwrap().expect("expected card");
        assert_eq!(
            after_undo.id, first.id,
            "iteration {iter}: expected undone card {} next, got {}",
            first.id, after_undo.id
        );
    }
}

#[test]
fn undo_bury_and_suspend_returns_card_next() {
    let (c, _clock, nt_id) = setup();
    let deck = c.create_deck("BurySuspendUndo").unwrap();
    for i in 0..4 {
        c.add_note(
            nt_id,
            deck.id,
            &[format!("Card {i}"), format!("Back {i}")],
            &[],
        )
        .unwrap();
    }

    let first = c.next_card(deck.id).unwrap().expect("expected card");
    c.bury_cards(&[first.id]).unwrap();
    let after_bury = c.next_card(deck.id).unwrap().expect("expected next card");
    assert_ne!(after_bury.id, first.id);

    c.undo().unwrap();
    let restored_after_bury = c.next_card(deck.id).unwrap().expect("expected card");
    assert_eq!(
        restored_after_bury.id, first.id,
        "undoing single-card bury must return that card next"
    );

    c.suspend_cards(&[first.id]).unwrap();
    let after_suspend = c.next_card(deck.id).unwrap().expect("expected next card");
    assert_ne!(after_suspend.id, first.id);

    c.undo().unwrap();
    let restored_after_suspend = c.next_card(deck.id).unwrap().expect("expected card");
    assert_eq!(
        restored_after_suspend.id, first.id,
        "undoing single-card suspend must return that card next"
    );
}

#[test]
fn a1_19_fuzz_never_exceeds_maximum_interval_days() {
    let (c, _clock, nt_id) = setup();
    let deck = c.create_deck("MaxIvlCap").unwrap();
    let mut cfg = c.get_deck_config(deck.id).unwrap();
    cfg.algorithm = bibalak_core::Algorithm::Sm2;
    cfg.easy_interval_days = 10;
    cfg.maximum_interval_days = 10;
    c.set_deck_config(&cfg).unwrap();

    for i in 0..30 {
        c.add_note(nt_id, deck.id, &[format!("Cap Q{i}"), "A".into()], &[])
            .unwrap();
    }

    let today = c.today();
    while let Some(card) = c.next_card(deck.id).unwrap() {
        c.answer_card(card.id, Rating::Easy, 400).unwrap();
    }

    let rows = c
        .search_cards("deck:MaxIvlCap", 100, 0, None, true)
        .unwrap();
    let reviewed: Vec<_> = rows.iter().filter(|r| r.card_type != 0).collect();
    assert_eq!(reviewed.len(), 20);
    let over_max: Vec<_> = reviewed
        .into_iter()
        .filter(|r| r.interval > 10 || r.due > i64::from(today) + 10)
        .collect();
    assert!(
        over_max.is_empty(),
        "fuzz pushed {} cards past maximum_interval_days=10",
        over_max.len()
    );
}

#[test]
fn a1_08_unsuspended_leech_in_relearning_does_not_resuspend_on_good() {
    let (c, clock, nt_id) = setup();
    let deck = c.create_deck("LeechRelearn").unwrap();
    let mut cfg = c.get_deck_config(deck.id).unwrap();
    cfg.algorithm = bibalak_core::Algorithm::Sm2;
    cfg.leech_threshold = 2;
    c.set_deck_config(&cfg).unwrap();

    c.add_note(nt_id, deck.id, &["Hard fact".into(), "A".into()], &[])
        .unwrap();
    let card_id = c.deck_card_ids(deck.id, false).unwrap()[0];
    c.set_due_date(&[card_id], "0").unwrap();

    assert!(!c.answer_card(card_id, Rating::Again, 400).unwrap());
    assert!(!c.answer_card(card_id, Rating::Good, 400).unwrap());
    clock.advance_days(1);
    assert!(
        c.answer_card(card_id, Rating::Again, 400).unwrap(),
        "2nd lapse should hit leech_threshold=2"
    );

    c.unsuspend_cards(&[card_id]).unwrap();
    let second_leech = c.answer_card(card_id, Rating::Good, 400).unwrap();
    assert!(
        !second_leech,
        "answering Good on an unsuspended leech in Relearning should not re-trigger leech"
    );
}
