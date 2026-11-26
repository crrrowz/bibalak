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

    // Studying a subdeck directly is capped by that subdeck's own limit:
    // create a separate parent tree with distinct subdeck limits.
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

    assert_eq!(c.count_due_by_type(p2_b.id).unwrap(), (25, 0, 0));
    let mut served_b = 0;
    while let Some(card) = c.next_card(p2_b.id).unwrap() {
        clock.set(clock.now_ms() + 100);
        answer(&c, &clock, card.id, Rating::Easy);
        served_b += 1;
    }
    assert_eq!(served_b, 25);
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
    // 0-minute first step puts the learning card immediately due at answer time.
    let d_zero = c.create_deck("ZeroStep").unwrap();
    let mut cfg = c.get_deck_config(d_zero.id).unwrap();
    cfg.learning_steps_min = vec![0, 10];
    c.set_deck_config(&cfg).unwrap();
    add_new_cards(&c, d_zero.id, nt_id, 4, "Z");

    clock.set(T0 + 900_000);
    let z1 = c.next_card(d_zero.id).unwrap().unwrap();
    answer(&c, &clock, z1.id, Rating::Again); // due = now (0m), last_answered = T0 + 900_000

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
    // Create 2 learning cards in A, 1 learning card in B with Again (1m step).
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

    // Advance 5 days: CR/RR (Easy -> +4d) are due reviews, CL/RL are overdue learning,
    // and daily studied counts reset! Now add 15 new in A + 15 new in B.
    clock.advance_days(5);
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
