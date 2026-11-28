use std::collections::HashSet;
use std::sync::Arc;

use bibalak_core::model::Revlog;
use bibalak_core::ports::{Clock, TestClock};
use bibalak_core::scheduling::{CardPhase, Interval, SchedContext, Scheduler};
use bibalak_core::{Collection, Rating};
use bibalak_db::SqliteStorage;
use bibalak_scheduler::Sm2Scheduler;

// 2026-11-16T12:00:00Z — comfortably inside day 0 (04:00..04:00 UTC rollover).
const T0: i64 = 1_794_830_400_000;
const DAY_MS: i64 = 86_400_000;
const MIN_MS: i64 = 60_000;

fn day_index(now_ms: i64) -> i32 {
    ((now_ms - T0) / DAY_MS) as i32
}

fn setup() -> (Collection, Arc<TestClock>, i64) {
    let storage = SqliteStorage::open_in_memory().unwrap();
    let clock = Arc::new(TestClock::new(T0));
    let c = Collection::new(Box::new(storage), clock.clone()).unwrap();
    let nt = c.add_stock_notetype(0).unwrap();
    (c, clock, nt.id)
}

fn add_new_cards(c: &Collection, deck_id: i64, notetype_id: i64, count: usize, prefix: &str) {
    for i in 0..count {
        c.add_note(
            notetype_id,
            deck_id,
            &[format!("{prefix} Q{i}"), format!("{prefix} A{i}")],
            &[],
        )
        .unwrap();
    }
}

fn answer(c: &Collection, clock: &TestClock, card_id: i64, rating: Rating) {
    let card = c.study_card(card_id).unwrap().expect("card exists");
    let now_ms = clock.now_ms();
    let today = day_index(now_ms);
    let config = c.get_sched_config(card.deck_id).unwrap();
    let outcome = Sm2Scheduler.answer(
        &card.state,
        rating,
        &SchedContext {
            today,
            config: config.clone(),
        },
    );
    let due = match outcome.interval {
        Interval::Minutes(m) => now_ms + i64::from(m) * MIN_MS,
        Interval::Days(d) => i64::from(today + d as i32),
    };
    let review_kind = match card.state.phase {
        CardPhase::Review => 1,
        CardPhase::Relearning => 2,
        CardPhase::New | CardPhase::Learning => 0,
    };
    let log = Revlog {
        id: now_ms,
        card_id: card.id,
        usn: -1,
        ease: match rating {
            Rating::Again => 1,
            Rating::Hard => 2,
            Rating::Good => 3,
            Rating::Easy => 4,
        },
        interval: match outcome.interval {
            Interval::Minutes(m) => -(i64::from(m) * 60),
            Interval::Days(d) => i64::from(d),
        },
        last_interval: i64::from(card.state.interval_days),
        ease_factor: outcome.next.ease_milli as i64,
        taken_ms: 1000,
        review_kind,
    };
    c.apply_answer(
        card.id,
        card.note_id,
        &card.state,
        card.due,
        &outcome.next,
        due,
        &log,
        config.leech_threshold,
    )
    .unwrap();
}

#[test]
fn repro_a_single_deck_20_new_per_day_and_next_day() {
    let (c, clock, nt_id) = setup();
    c.set_deck_options(1, 20, 200).unwrap();
    add_new_cards(&c, 1, nt_id, 45, "Single");

    assert_eq!(c.count_due_by_type(1).unwrap(), (20, 0, 0));

    let mut introduced = HashSet::new();
    for i in 0..20 {
        clock.set(T0 + i * 1_000);
        let card = c.next_card(1).unwrap().expect("new card offered");
        assert_eq!(card.state.phase, CardPhase::New);
        introduced.insert(card.id);
        answer(&c, &clock, card.id, Rating::Good);
    }
    assert_eq!(introduced.len(), 20);

    // New badge reaches 0; learning badge rises to 20.
    assert_eq!(c.count_due_by_type(1).unwrap(), (0, 20, 0));

    // Even before finishing learning cards (learn-ahead), no new card beyond
    // the 20 introduced today is offered.
    clock.set(T0 + 25_000);
    let next = c.next_card(1).unwrap().expect("learn-ahead card offered");
    assert_eq!(next.state.phase, CardPhase::Learning);
    assert!(introduced.contains(&next.id));

    // Graduate all 20 learning cards after 10m step -> session is completely done.
    clock.set(T0 + 15 * MIN_MS);
    for step in 0..20 {
        clock.set(T0 + 15 * MIN_MS + step * 100);
        let card = c.next_card(1).unwrap().expect("learning card due");
        assert_eq!(card.state.phase, CardPhase::Learning);
        answer(&c, &clock, card.id, Rating::Good);
    }

    assert_eq!(c.count_due_by_type(1).unwrap(), (0, 0, 0));
    assert!(
        c.next_card(1).unwrap().is_none(),
        "no 21st new card may be offered today"
    );

    // Next day: 20 new cards (and 20 due reviews) are available again.
    clock.advance_days(1);
    assert_eq!(c.count_due_by_type(1).unwrap(), (20, 0, 20));
}

#[test]
fn repro_b_parent_with_two_subdecks_caps_total_and_subdeck_direct() {
    let (c, clock, nt_id) = setup();
    let parent = c.create_deck("Spanish").unwrap();
    let sub_a = c.create_deck("Spanish::Verbs").unwrap();
    let sub_b = c.create_deck("Spanish::Nouns").unwrap();
    c.set_deck_options(parent.id, 20, 200).unwrap();
    c.set_deck_options(sub_a.id, 20, 200).unwrap();
    c.set_deck_options(sub_b.id, 20, 200).unwrap();

    add_new_cards(&c, sub_a.id, nt_id, 30, "Verb");
    add_new_cards(&c, sub_b.id, nt_id, 30, "Noun");

    // Parent badge and count_due_by_type must show 20 total, not 40.
    assert_eq!(c.count_due_by_type(parent.id).unwrap(), (20, 0, 0));
    let deck_counts: std::collections::HashMap<i64, (u32, u32, u32)> = c
        .list_decks_with_counts()
        .unwrap()
        .into_iter()
        .map(|(d, counts)| (d.id, counts))
        .collect();
    assert_eq!(deck_counts[&parent.id], (20, 0, 0));

    // Study parent via Easy (graduates immediately -> only new limit matters).
    let mut served = 0;
    while let Some(card) = c.next_card(parent.id).unwrap() {
        clock.set(clock.now_ms() + 100);
        answer(&c, &clock, card.id, Rating::Easy);
        served += 1;
        assert!(served <= 60, "safety bound against infinite loop");
    }
    assert_eq!(
        served, 20,
        "studying parent must introduce at most 20 new cards total"
    );
    assert_eq!(c.count_due_by_type(parent.id).unwrap(), (0, 0, 0));

    // Studying a subdeck directly is bounded by both its own limit and its
    // ancestors' remaining daily allowances (A1-06).
    let p2 = c.create_deck("Japanese").unwrap();
    let p2_a = c.create_deck("Japanese::Kanji").unwrap();
    let p2_b = c.create_deck("Japanese::Vocab").unwrap();
    c.set_deck_options(p2.id, 20, 200).unwrap();
    c.set_deck_options(p2_a.id, 10, 200).unwrap();
    c.set_deck_options(p2_b.id, 25, 200).unwrap();
    add_new_cards(&c, p2_a.id, nt_id, 20, "Kanji");
    add_new_cards(&c, p2_b.id, nt_id, 30, "Vocab");

    assert_eq!(c.count_due_by_type(p2_a.id).unwrap(), (10, 0, 0));
    let mut served_a = 0;
    while let Some(card) = c.next_card(p2_a.id).unwrap() {
        clock.set(clock.now_ms() + 100);
        answer(&c, &clock, card.id, Rating::Easy);
        served_a += 1;
    }
    assert_eq!(served_a, 10);

    // Parent budget had 20/day; p2_a used 10, so p2_b is capped at 10 remaining today.
    assert_eq!(c.count_due_by_type(p2_b.id).unwrap(), (10, 0, 0));
    let mut served_b = 0;
    while let Some(card) = c.next_card(p2_b.id).unwrap() {
        clock.set(clock.now_ms() + 100);
        answer(&c, &clock, card.id, Rating::Easy);
        served_b += 1;
    }
    assert_eq!(served_b, 10);
}

#[test]
fn repro_c_learning_again_1min_and_soonest_due() {
    let (c, clock, nt_id) = setup();
    let deck = c.create_deck("Learn").unwrap();
    add_new_cards(&c, deck.id, nt_id, 5, "L");

    // 1. Answer a new card Again (1-minute step); after 60 s it comes back
    //    before any further new card.
    let first = c.next_card(deck.id).unwrap().unwrap();
    answer(&c, &clock, first.id, Rating::Again);

    clock.set(T0 + 30_000);
    let while_waiting = c.next_card(deck.id).unwrap().unwrap();
    assert_ne!(while_waiting.id, first.id);
    assert_eq!(while_waiting.state.phase, CardPhase::New);

    clock.set(T0 + 60_000);
    let after_60s = c.next_card(deck.id).unwrap().unwrap();
    assert_eq!(
        after_60s.id, first.id,
        "1-min learning card must be offered at +60s before next new card"
    );

    // 2. With multiple learning cards due, soonest due comes first.
    clock.set(T0 + 120_000);
    let second = c.next_card(deck.id).unwrap().unwrap();
    assert_eq!(second.id, first.id);
    // Answer first -> Good (10m step -> due T0 + 120s + 600s = T0 + 720s).
    answer(&c, &clock, first.id, Rating::Good);
    // Answer a new card Again at T0 + 180s (1m step -> due T0 + 240s, earlier!).
    clock.set(T0 + 180_000);
    let third = c.next_card(deck.id).unwrap().unwrap();
    assert_eq!(third.state.phase, CardPhase::New);
    answer(&c, &clock, third.id, Rating::Again);

    clock.set(T0 + 800_000);
    // Both `third` (due T0 + 240s) and `first` (due T0 + 720s) are due;
    // soonest due (`third`) must come first.
    assert_eq!(c.next_card(deck.id).unwrap().unwrap().id, third.id);
}

#[test]
fn repro_c_grace_never_hides_due_learning_card_for_multiple_answers() {
    let (c, clock, nt_id) = setup();
    let d_zero = c.create_deck("ZeroStep").unwrap();
    add_new_cards(&c, d_zero.id, nt_id, 4, "Z");

    clock.set(T0 + 900_000);
    let z1 = c.next_card(d_zero.id).unwrap().unwrap();
    let z1_next = bibalak_core::scheduling::CardState {
        phase: CardPhase::Learning,
        steps_remaining: 2,
        reps: 1,
        ..z1.state
    };
    let z1_log = bibalak_core::model::Revlog {
        id: clock.now_ms(),
        card_id: z1.id,
        usn: -1,
        ease: Rating::Again as i64,
        interval: 0,
        last_interval: 0,
        ease_factor: 2500,
        taken_ms: 400,
        review_kind: 0,
    };
    // Learning card due immediately (now_ms) with last_answered = T0 + 900_000.
    c.apply_answer(
        z1.id,
        z1.note_id,
        &z1.state,
        z1.due,
        &z1_next,
        clock.now_ms(),
        &z1_log,
        8,
    )
    .unwrap();

    // Deferred once while another new card exists:
    let z2 = c.next_card(d_zero.id).unwrap().unwrap();
    assert_ne!(z2.id, z1.id);
    assert_eq!(z2.state.phase, CardPhase::New);

    // Answer z2 with Easy (graduates out of learning):
    clock.set(T0 + 905_000);
    answer(&c, &clock, z2.id, Rating::Easy);

    // On the very next call, z1 MUST resurface instead of being hidden behind z3!
    let next = c.next_card(d_zero.id).unwrap().unwrap();
    assert_eq!(
        next.id, z1.id,
        "GRACE must not hide due learning card for more than one answer"
    );
}

#[test]
fn repro_d_badges_match_served_queue_counts() {
    let (c, clock, nt_id) = setup();
    let parent = c.create_deck("Med").unwrap();
    let sub_a = c.create_deck("Med::Cardio").unwrap();
    let sub_b = c.create_deck("Med::Renal").unwrap();
    c.set_deck_options(parent.id, 20, 15).unwrap();
    c.set_deck_options(sub_a.id, 20, 15).unwrap();
    c.set_deck_options(sub_b.id, 20, 15).unwrap();

    // Seed: 15 new in A, 15 new in B; plus 2 learning in A, 1 in B; plus 10 review in A, 10 in B.
    add_new_cards(&c, sub_a.id, nt_id, 15, "CN");
    add_new_cards(&c, sub_b.id, nt_id, 15, "RN");

    // Create 2+1 learning due now and 10+10 reviews due yesterday by graduating seeded notes.
    add_new_cards(&c, sub_a.id, nt_id, 2, "CL");
    add_new_cards(&c, sub_b.id, nt_id, 1, "RL");
    add_new_cards(&c, sub_a.id, nt_id, 10, "CR");
    add_new_cards(&c, sub_b.id, nt_id, 10, "RR");
    // Answer the CL/RL/CR/RR cards on day -10? Wait: day 0 is T0, so just force via SQL?
    // Even simpler: use clock at T0, answer CR/RR with Easy (4d -> day 4), answer CL/RL with Again,
    // then advance 5 days so CR/RR are due reviews on day 5 and CL/RL are overdue learning cards,
    // and day 5 has fresh daily new/review limits!
    // Identify their IDs from queues: wait — create CL/RL/CR/RR BEFORE adding CN/RN so we don't mix!
    // Wait: we already added CN/RN, so let's instead create a fresh helper or clear deck!
    drop((c, clock, nt_id, parent, sub_a, sub_b));

    let (c, clock, nt_id) = setup();
    let parent = c.create_deck("Med").unwrap();
    let sub_a = c.create_deck("Med::Cardio").unwrap();
    let sub_b = c.create_deck("Med::Renal").unwrap();
    c.set_deck_options(parent.id, 20, 15).unwrap();
    c.set_deck_options(sub_a.id, 20, 15).unwrap();
    c.set_deck_options(sub_b.id, 20, 15).unwrap();

    // First create review candidates (10 per subdeck) and graduate them on day 0.
    add_new_cards(&c, sub_a.id, nt_id, 10, "CR");
    add_new_cards(&c, sub_b.id, nt_id, 10, "RR");
    for d_id in [sub_a.id, sub_b.id] {
        while let Some(card) = c.next_card(d_id).unwrap() {
            clock.set(clock.now_ms() + 100);
            answer(&c, &clock, card.id, Rating::Easy);
        }
    }
    // Advance 1 day so Day 1 has fresh new-card capacity under parent Med (20/day),
    // then create 2 learning cards in A and 1 learning card in B with Again (1m step).
    clock.advance_days(1);
    add_new_cards(&c, sub_a.id, nt_id, 2, "CL");
    add_new_cards(&c, sub_b.id, nt_id, 1, "RL");
    for _ in 0..2 {
        clock.set(clock.now_ms() + 100);
        let card = c.next_card(sub_a.id).unwrap().unwrap();
        answer(&c, &clock, card.id, Rating::Again);
    }
    clock.set(clock.now_ms() + 100);
    let card = c.next_card(sub_b.id).unwrap().unwrap();
    answer(&c, &clock, card.id, Rating::Again);

    // Advance 4 more days (Day 5 total): CR/RR (Easy on Day 0 -> Day 4) are due reviews,
    // CL/RL are overdue learning, and daily studied counts reset!
    clock.advance_days(4);
    add_new_cards(&c, sub_a.id, nt_id, 15, "CN");
    add_new_cards(&c, sub_b.id, nt_id, 15, "RN");

    let expected = (20, 3, 15);
    assert_eq!(c.count_due_by_type(parent.id).unwrap(), expected);

    // Drain parent queue answering every card so it leaves today's queue:
    let mut got = (0u32, 0u32, 0u32);
    while let Some(card) = c.next_card(parent.id).unwrap() {
        clock.set(clock.now_ms() + 100);
        match card.state.phase {
            CardPhase::New => {
                got.0 += 1;
                answer(&c, &clock, card.id, Rating::Easy);
            }
            CardPhase::Learning | CardPhase::Relearning => {
                got.1 += 1;
                answer(&c, &clock, card.id, Rating::Easy);
            }
            CardPhase::Review => {
                got.2 += 1;
                answer(&c, &clock, card.id, Rating::Good);
            }
        }
    }
    assert_eq!(
        got, expected,
        "count_due_by_type must equal what the parent queue actually serves"
    );
}

#[test]
fn forgotten_card_counts_as_new_again_and_decrements_new_badge_on_again() {
    // Reproduces owner's case:
    // 1. Studying a previously-studied card after Reset (forget_cards) must consume
    //    today's new-card quota when answered Again, decrementing New (16 -> 15) as
    //    Learn rises to 1 — whether the prior review was yesterday or earlier today.
    // 2. Undoing forget_cards removes the manual-forget revlog boundary.
    let (c, clock, nt_id) = setup();
    let deck = c.create_deck("ResetTest").unwrap();
    c.set_deck_options(deck.id, 16, 200).unwrap();
    add_new_cards(&c, deck.id, nt_id, 20, "R");

    // Day 0: study one card to review.
    let c0 = c.next_card(deck.id).unwrap().unwrap();
    answer(&c, &clock, c0.id, Rating::Easy);

    // Day 1: forget c0, verify New = 16, Learn = 0.
    clock.advance_days(1);
    c.forget_cards(&[c0.id], true).unwrap();
    assert_eq!(c.count_due_by_type(deck.id).unwrap(), (16, 0, 0));

    // Answer c0 with Again on Day 1 -> must consume 1 new quota: New 15, Learn 1.
    clock.set(clock.now_ms() + 1_000);
    answer(&c, &clock, c0.id, Rating::Again);
    assert_eq!(
        c.count_due_by_type(deck.id).unwrap(),
        (15, 1, 0),
        "forgetting a previously-studied card must let its next Again decrement New"
    );

    // Now forget another card studied *earlier today* on Day 1:
    // 1) Pre-forget quota is not refunded (new_done=1 already used, remaining=15, total=19 -> New=15).
    // 2) Studying c0 again after today's forget must increment new_done -> New=14, Learn=1.
    clock.set(clock.now_ms() + 1_000);
    c.forget_cards(&[c0.id], true).unwrap();
    assert_eq!(c.count_due_by_type(deck.id).unwrap(), (15, 0, 0));
    clock.set(clock.now_ms() + 1_000);
    answer(&c, &clock, c0.id, Rating::Again);
    assert_eq!(
        c.count_due_by_type(deck.id).unwrap(),
        (14, 1, 0),
        "answering a card reset earlier today must decrement remaining New quota"
    );

    // Undo second answer + second forget removes the boundary and restores learning state.
    c.undo().unwrap();
    assert_eq!(c.count_due_by_type(deck.id).unwrap(), (15, 0, 0));
    c.undo().unwrap();
    assert_eq!(c.count_due_by_type(deck.id).unwrap(), (15, 1, 0));
}

#[test]
fn filtered_deck_ignores_default_limits_and_uses_home_deck_preset() {
    let (c, clock, nt_id) = setup();
    // Set Default deck (id = 1) limits to 0/0.
    c.set_deck_options(1, 0, 0).unwrap();
    let home = c.create_deck("Home").unwrap();
    let mut home_cfg = c.get_deck_config(home.id).unwrap();
    home_cfg.new_per_day = 5;
    home_cfg.review_per_day = 5;
    home_cfg.algorithm = bibalak_core::model::Algorithm::Fsrs;
    c.set_deck_config(&home_cfg).unwrap();

    add_new_cards(&c, home.id, nt_id, 5, "F");
    // Graduate one card to future review (due = today + 4), keep 4 as new.
    let first = c.next_card(home.id).unwrap().unwrap();
    answer(&c, &clock, first.id, Rating::Easy);
    clock.set(clock.now_ms() + 1_000);

    // Filtered deck gathers all 5 cards from Home.
    let cram = c.create_filtered_deck("Cram", "deck:Home", 0, 50).unwrap();
    assert_eq!(
        c.count_due_by_type(cram.id).unwrap(),
        (4, 0, 1),
        "filtered deck must not be capped by Default (0/0) or hide future reviews"
    );
    let next = c.next_card(cram.id).unwrap().expect("cram card served");
    let sched_cfg = c.get_sched_config_for_card(next.id, next.deck_id).unwrap();
    assert_eq!(
        sched_cfg.algorithm,
        bibalak_core::model::Algorithm::Fsrs,
        "filtered card must use its home deck preset"
    );
}

#[test]
fn deck_list_unburies_yesterday_buried_cards_on_day_rollover() {
    let (c, clock, nt_id) = setup();
    let deck = c.create_deck("BuryRollover").unwrap();
    add_new_cards(&c, deck.id, nt_id, 1, "B");
    let card_id = c.deck_card_ids(deck.id, false).unwrap()[0];

    c.bury_cards(&[card_id]).unwrap();
    let day0_counts: std::collections::HashMap<i64, (u32, u32, u32)> = c
        .list_decks_with_counts()
        .unwrap()
        .into_iter()
        .map(|(d, cts)| (d.id, cts))
        .collect();
    assert_eq!(day0_counts[&deck.id], (0, 0, 0));

    clock.advance_days(1);
    let day1_counts: std::collections::HashMap<i64, (u32, u32, u32)> = c
        .list_decks_with_counts()
        .unwrap()
        .into_iter()
        .map(|(d, cts)| (d.id, cts))
        .collect();
    assert_eq!(
        day1_counts[&deck.id],
        (1, 0, 0),
        "list_decks_with_counts must unbury on day rollover before study opens"
    );
}

#[test]
fn answer_card_rejects_suspended_or_buried_card() {
    let storage = SqliteStorage::open_in_memory().unwrap();
    let clock = Arc::new(TestClock::new(T0));
    let sched = Arc::new(bibalak_scheduler::DefaultSchedulerSet);
    let c = Collection::new(Box::new(storage), clock)
        .unwrap()
        .with_scheduler_set(sched);
    let nt_id = c.add_stock_notetype(0).unwrap().id;
    let deck = c.create_deck("Guard").unwrap();
    add_new_cards(&c, deck.id, nt_id, 1, "G");
    let card_id = c.deck_card_ids(deck.id, false).unwrap()[0];

    c.suspend_cards(&[card_id]).unwrap();
    assert!(c.answer_card(card_id, Rating::Good, 1000).is_err());

    c.unsuspend_cards(&[card_id]).unwrap();
    c.bury_cards(&[card_id]).unwrap();
    assert!(c.answer_card(card_id, Rating::Good, 1000).is_err());
}

#[test]
fn delete_deck_undo_restores_revlogs_day_limits_and_filtered_config() {
    let (c, clock, nt_id) = setup();
    let deck = c.create_deck("UndoDeck").unwrap();
    add_new_cards(&c, deck.id, nt_id, 2, "UD");
    c.increase_today_new_limit(deck.id, 5).unwrap();

    let first = c.next_card(deck.id).unwrap().unwrap();
    answer(&c, &clock, first.id, Rating::Easy);
    assert_eq!(c.storage().revlogs_for_optimize(None).unwrap().len(), 1);

    c.remove_deck(deck.id).unwrap();
    assert!(c.storage().revlogs_for_optimize(None).unwrap().is_empty());

    c.undo().unwrap();
    assert_eq!(c.storage().revlogs_for_optimize(None).unwrap().len(), 1);
    assert_eq!(c.get_today_extra_new(deck.id).unwrap(), 5);

    // Filtered deck config and membership also restore on delete undo.
    let cram = c
        .create_filtered_deck("CramUndo", "deck:UndoDeck", 0, 50)
        .unwrap();
    assert!(!c.deck_card_ids(cram.id, false).unwrap().is_empty());
    c.remove_deck(cram.id).unwrap();
    c.undo().unwrap();
    let cfg = c
        .get_filtered_config(cram.id)
        .unwrap()
        .expect("filtered cfg restored");
    assert_eq!(cfg.search, "deck:UndoDeck");
    assert!(!c.deck_card_ids(cram.id, false).unwrap().is_empty());
}

#[test]
fn undo_answer_restores_zero_ease_and_reposition_counts_only_new_cards() {
    let storage = SqliteStorage::open_in_memory().unwrap();
    let clock = Arc::new(TestClock::new(T0));
    let sched = Arc::new(bibalak_scheduler::DefaultSchedulerSet);
    let c = Collection::new(Box::new(storage), clock.clone())
        .unwrap()
        .with_scheduler_set(sched);
    let nt_id = c.add_stock_notetype(0).unwrap().id;
    let deck = c.create_deck("UndoEase").unwrap();
    add_new_cards(&c, deck.id, nt_id, 2, "UE");
    let ids = c.deck_card_ids(deck.id, false).unwrap();

    assert_eq!(c.storage().card_raw_ease_factor(ids[0]).unwrap(), Some(0));
    c.answer_card(ids[0], Rating::Again, 1000).unwrap();
    c.undo().unwrap();
    assert_eq!(
        c.storage().card_raw_ease_factor(ids[0]).unwrap(),
        Some(0),
        "undoing first answer on a new card must restore ease_factor = 0"
    );

    // Make ids[1] a review card, then pass [ids[0], ids[1]] to reposition_new_cards.
    c.answer_card(ids[1], Rating::Easy, 1000).unwrap();
    c.reposition_new_cards(&ids, 10, 1, false, false).unwrap();
    assert!(matches!(
        c.undo_status(),
        Some(bibalak_core::undo::UndoAction::RepositionCards { count: 1 })
    ));
}

#[test]
fn suspend_bury_move_options_limit_undo_and_delete_notes_clears_undo() {
    let (c, _clock, nt_id) = setup();
    let d1 = c.create_deck("D1").unwrap();
    let d2 = c.create_deck("D2").unwrap();
    add_new_cards(&c, d1.id, nt_id, 2, "U");
    let ids = c.deck_card_ids(d1.id, false).unwrap();

    // Suspend -> undo restores active queue
    c.suspend_cards(&[ids[0]]).unwrap();
    assert_eq!(c.storage().card_queue(ids[0]).unwrap(), Some(-1));
    // Burying an already-suspended card must not overwrite queue = -1.
    c.bury_cards(&[ids[0]]).unwrap();
    assert_eq!(c.storage().card_queue(ids[0]).unwrap(), Some(-1));
    c.undo().unwrap(); // undo bury (restores -1)
    c.undo().unwrap(); // undo suspend (restores 0)
    assert_eq!(c.storage().card_queue(ids[0]).unwrap(), Some(0));

    // Bury -> undo restores active queue
    c.bury_cards(&[ids[0]]).unwrap();
    assert_eq!(c.storage().card_queue(ids[0]).unwrap(), Some(-2));
    c.undo().unwrap();
    assert_eq!(c.storage().card_queue(ids[0]).unwrap(), Some(0));

    // Move deck -> undo restores original deck
    c.move_cards_to_deck(&[ids[0]], d2.id).unwrap();
    assert_eq!(c.study_card(ids[0]).unwrap().unwrap().deck_id, d2.id);
    c.undo().unwrap();
    assert_eq!(c.study_card(ids[0]).unwrap().unwrap().deck_id, d1.id);

    // Increase today's limit -> undo restores prior extra
    c.increase_today_new_limit(d1.id, 7).unwrap();
    assert_eq!(c.get_today_extra_new(d1.id).unwrap(), 7);
    c.undo().unwrap();
    assert_eq!(c.get_today_extra_new(d1.id).unwrap(), 0);

    // Deck options -> undo restores prior limits
    c.set_deck_options(d1.id, 5, 50).unwrap();
    assert_eq!(c.get_deck_options(d1.id).unwrap(), (5, 50));
    c.undo().unwrap();
    assert_eq!(c.get_deck_options(d1.id).unwrap(), (20, 200));

    // Delete note -> clears undo history so stale undo cannot run
    let note_id = c.study_card(ids[1]).unwrap().unwrap().note_id;
    c.suspend_cards(&[ids[0]]).unwrap();
    assert!(c.undo_status().is_some());
    c.delete_notes(&[note_id]).unwrap();
    assert!(c.undo_status().is_none());
}

#[test]
fn filtered_deck_answers_do_not_consume_home_deck_daily_limits_either_way() {
    let storage = SqliteStorage::open_in_memory().unwrap();
    let clock = Arc::new(TestClock::new(T0));
    let sched = Arc::new(bibalak_scheduler::DefaultSchedulerSet);
    let c = Collection::new(Box::new(storage), clock.clone())
        .unwrap()
        .with_scheduler_set(sched);
    let nt_id = c.add_stock_notetype(0).unwrap().id;
    let home = c.create_deck("HomeLimits").unwrap();
    let mut home_cfg = c.get_deck_config(home.id).unwrap();
    home_cfg.new_per_day = 1;
    home_cfg.review_per_day = 1;
    home_cfg.algorithm = bibalak_core::model::Algorithm::Sm2;
    c.set_deck_config(&home_cfg).unwrap();

    // Seed 3 cards to graduate into due reviews (R0 tagged cram, R1 plain, R2 tagged pool2).
    c.add_note(
        nt_id,
        home.id,
        &["R0 Q".to_string(), "R0 A".to_string()],
        &["cram".to_string()],
    )
    .unwrap();
    c.add_note(
        nt_id,
        home.id,
        &["R1 Q".to_string(), "R1 A".to_string()],
        &[],
    )
    .unwrap();
    c.add_note(
        nt_id,
        home.id,
        &["R2 Q".to_string(), "R2 A".to_string()],
        &["pool2".to_string()],
    )
    .unwrap();
    for card_id in c.deck_card_ids(home.id, false).unwrap() {
        c.answer_card(card_id, Rating::Easy, 1000).unwrap();
        clock.set(clock.now_ms() + 1_000);
    }

    // Move forward 5 days so all 3 SM-2 Easy review cards (4d interval) are due today.
    clock.advance_days(5);

    // Seed 3 new cards (N0 tagged cram, N1 plain, N2 tagged pool2).
    c.add_note(
        nt_id,
        home.id,
        &["N0 Q".to_string(), "N0 A".to_string()],
        &["cram".to_string()],
    )
    .unwrap();
    c.add_note(
        nt_id,
        home.id,
        &["N1 Q".to_string(), "N1 A".to_string()],
        &[],
    )
    .unwrap();
    c.add_note(
        nt_id,
        home.id,
        &["N2 Q".to_string(), "N2 A".to_string()],
        &["pool2".to_string()],
    )
    .unwrap();
    assert_eq!(c.count_due_by_type(home.id).unwrap(), (1, 0, 1));

    // Direction A: studying in a filtered deck must not consume the home deck's daily limits.
    let cram = c
        .create_filtered_deck("Cram", "deck:HomeLimits tag:cram", 0, 10)
        .unwrap();
    assert_eq!(c.count_due_by_type(cram.id).unwrap(), (1, 0, 1));

    let cram_ids = c.deck_card_ids(cram.id, false).unwrap();
    assert_eq!(cram_ids.len(), 2);
    assert!(c.next_card(cram.id).unwrap().is_some());
    let mut cram_phases = Vec::new();
    for card_id in cram_ids {
        let card = c.study_card(card_id).unwrap().expect("cram card exists");
        cram_phases.push(card.state.phase);
        c.answer_card(card_id, Rating::Easy, 1000).unwrap();
        clock.set(clock.now_ms() + 1_000);
    }
    assert_eq!(cram_phases.len(), 2);
    assert!(cram_phases.contains(&CardPhase::New));
    assert!(cram_phases.contains(&CardPhase::Review));

    assert_eq!(
        c.count_due_by_type(home.id).unwrap(),
        (1, 0, 1),
        "answering cards in filtered deck must leave home deck daily limits untouched"
    );
    let list_counts: std::collections::HashMap<i64, (u32, u32, u32)> = c
        .list_decks_with_counts()
        .unwrap()
        .into_iter()
        .map(|(d, cts)| (d.id, cts))
        .collect();
    assert_eq!(list_counts[&home.id], (1, 0, 1));

    // Exhaust the home deck's daily limits (1 new + 1 review).
    let mut home_phases = Vec::new();
    for _ in 0..2 {
        let card = c.next_card(home.id).unwrap().expect("home card offered");
        home_phases.push(card.state.phase);
        c.answer_card(card.id, Rating::Easy, 1000).unwrap();
        clock.set(clock.now_ms() + 1_000);
    }
    assert!(c.next_card(home.id).unwrap().is_none());
    assert_eq!(home_phases.len(), 2);
    assert!(home_phases.contains(&CardPhase::New));
    assert!(home_phases.contains(&CardPhase::Review));
    assert_eq!(c.count_due_by_type(home.id).unwrap(), (0, 0, 0));

    // Direction B: exhausting the home deck's daily limits must not block a filtered deck.
    // Home started with 2 new + 2 review; exhausting (1 new, 1 review) leaves 1 new + 3 review.
    let cram2 = c
        .create_filtered_deck("Cram2", "deck:HomeLimits", 0, 10)
        .unwrap();
    assert_eq!(c.count_due_by_type(cram2.id).unwrap(), (1, 0, 3));
    assert!(c.next_card(cram2.id).unwrap().is_some());
}
