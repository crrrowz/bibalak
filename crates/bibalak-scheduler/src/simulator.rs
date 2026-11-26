//! Pure, seeded FSRS workload simulator.
//!
//! Steps day-by-day over `horizon_days` using the production [`FsrsScheduler`]
//! memory model and [`retrievability`] curve without IO, clocks, or extra PRNG
//! dependencies.

use std::collections::VecDeque;

use bibalak_core::scheduling::{
    CardPhase, CardState, Interval, SchedConfig, SchedContext, Scheduler,
};
use bibalak_core::{Algorithm, Rating};

use crate::fsrs::{retrievability, FsrsScheduler};

/// Lightweight SplitMix64 PRNG so simulations are strictly reproducible per seed
/// without pulling an external RNG crate into `bibalak-scheduler`.
struct SplitMix64(u64);

impl SplitMix64 {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    fn next_f64(&mut self) -> f64 {
        ((self.next_u64() >> 11) as f64) * (1.0 / ((1_u64 << 53) as f64))
    }
}

/// Input card snapshot for simulation. Suspended/buried cards should be omitted
/// by the caller before simulating.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SimCard {
    /// Day-relative due date for review cards, or queue position for new cards.
    pub due: i32,
    pub state: CardState,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SimParams {
    pub today: i32,
    pub horizon_days: u32,
    pub desired_retention: f64,
    pub new_per_day: u32,
    pub maximum_interval_days: u32,
    pub secs_per_review: f64,
    pub fsrs_weights: [f64; 21],
    pub seed: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SimulatedDay {
    pub day: u32,
    pub reviews: u32,
    pub minutes: f64,
}

struct ActiveCard {
    due: i32,
    state: CardState,
}

fn graduate_state(
    scheduler: &FsrsScheduler,
    mut state: CardState,
    initial_rating: Rating,
    ctx: &SchedContext,
) -> (CardState, i32) {
    let outcome = scheduler.answer(&state, initial_rating, ctx);
    state = outcome.next;
    match outcome.interval {
        Interval::Days(d) => (state, d.max(1) as i32),
        Interval::Minutes(_) => {
            // Complete remaining learning step(s) within the same study session.
            let grad = scheduler.answer(&state, Rating::Good, ctx);
            let days = match grad.interval {
                Interval::Days(d) => d.max(1) as i32,
                Interval::Minutes(_) => 1,
            };
            (grad.next, days)
        }
    }
}

/// Simulate daily review counts and study minutes over the next `horizon_days`.
pub fn simulate_workload(cards: &[SimCard], params: &SimParams) -> Vec<SimulatedDay> {
    let scheduler = FsrsScheduler;
    let secs_per_review = params.secs_per_review.clamp(1.0, 300.0);
    let max_interval = params.maximum_interval_days.max(1);
    let desired_retention = params.desired_retention.clamp(0.5, 0.99);

    let mut new_cards: Vec<&SimCard> = cards
        .iter()
        .filter(|c| c.state.phase == CardPhase::New)
        .collect();
    new_cards.sort_by_key(|c| c.due);
    let mut pending_new: VecDeque<CardState> = new_cards.into_iter().map(|c| c.state).collect();

    let mut active: Vec<ActiveCard> = cards
        .iter()
        .filter(|c| c.state.phase != CardPhase::New)
        .map(|c| ActiveCard {
            due: if c.state.phase == CardPhase::Review {
                c.due
            } else {
                params.today
            },
            state: c.state,
        })
        .collect();

    let mut rng = SplitMix64(params.seed);
    let mut out = Vec::with_capacity(params.horizon_days as usize);

    for day in 0..params.horizon_days {
        let sim_day = params.today + day as i32;
        let ctx = SchedContext {
            today: sim_day,
            config: SchedConfig {
                algorithm: Algorithm::Fsrs,
                new_per_day: params.new_per_day,
                maximum_interval_days: max_interval,
                fsrs_weights: params.fsrs_weights,
                desired_retention,
                learning_steps_min: Vec::new(),
                relearning_steps_min: Vec::new(),
                ..SchedConfig::default()
            },
        };

        let mut reviews_today = 0_u32;

        // 1. Introduce up to `new_per_day` new cards.
        let new_quota = (params.new_per_day as usize).min(pending_new.len());
        for _ in 0..new_quota {
            let Some(card_state) = pending_new.pop_front() else {
                break;
            };
            let roll = rng.next_f64();
            let rating = if roll < 0.15 {
                reviews_today += 1; // initial lapse + graduation pass below
                Rating::Again
            } else if roll < 0.30 {
                Rating::Hard
            } else if roll < 0.90 {
                Rating::Good
            } else {
                Rating::Easy
            };
            reviews_today += 1;
            let (next_state, wait_days) = graduate_state(&scheduler, card_state, rating, &ctx);
            active.push(ActiveCard {
                due: sim_day + wait_days,
                state: next_state,
            });
        }

        // 2. Review active cards due on or before `sim_day`.
        for card in &mut active {
            if card.due > sim_day {
                continue;
            }
            if matches!(
                card.state.phase,
                CardPhase::Learning | CardPhase::Relearning
            ) {
                reviews_today += 1;
                let (next_state, wait_days) =
                    graduate_state(&scheduler, card.state, Rating::Good, &ctx);
                card.state = next_state;
                card.due = sim_day + wait_days;
                continue;
            }

            let elapsed = card
                .state
                .last_review_day
                .map(|last| (sim_day - last).max(1) as f64)
                .unwrap_or_else(|| f64::from(card.state.interval_days.max(1)));
            let stability = card
                .state
                .stability
                .unwrap_or_else(|| f64::from(card.state.interval_days.max(1)));
            let p_recall = retrievability(elapsed, stability, &params.fsrs_weights);

            if rng.next_f64() < p_recall {
                reviews_today += 1;
                let pass_roll = rng.next_f64();
                let rating = if pass_roll < 0.10 {
                    Rating::Hard
                } else if pass_roll < 0.88 {
                    Rating::Good
                } else {
                    Rating::Easy
                };
                let (next_state, wait_days) = graduate_state(&scheduler, card.state, rating, &ctx);
                card.state = next_state;
                card.due = sim_day + wait_days;
            } else {
                // Failed recall: failed attempt + same-day relearning recovery pass.
                reviews_today += 2;
                let (next_state, wait_days) =
                    graduate_state(&scheduler, card.state, Rating::Again, &ctx);
                card.state = next_state;
                card.due = sim_day + wait_days;
            }
        }

        let minutes = ((f64::from(reviews_today) * secs_per_review / 60.0) * 10.0).round() / 10.0;
        out.push(SimulatedDay {
            day,
            reviews: reviews_today,
            minutes,
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use bibalak_core::scheduling::FSRS6_DEFAULT_WEIGHTS;

    fn sample_deck() -> Vec<SimCard> {
        let mut cards = Vec::new();
        // 120 new cards queued in order.
        for i in 0..120 {
            cards.push(SimCard {
                due: i,
                state: CardState::new(2500),
            });
        }
        // 80 review cards spread across due days and stabilities.
        for i in 0..80_i32 {
            let stability = 5.0 + f64::from((i * 3) % 45);
            let interval = stability.round() as u32;
            let last_review = 100 - ((i * 7) % interval as i32).max(1);
            let due = last_review + interval as i32;
            cards.push(SimCard {
                due,
                state: CardState {
                    phase: CardPhase::Review,
                    steps_remaining: 0,
                    interval_days: interval,
                    ease_milli: 2500,
                    reps: 4,
                    lapses: (i % 3) as u32,
                    stability: Some(stability),
                    difficulty: Some(4.5 + f64::from(i % 5) * 0.8),
                    last_review_day: Some(last_review),
                },
            });
        }
        cards
    }

    fn base_params(desired_retention: f64, new_per_day: u32, horizon_days: u32) -> SimParams {
        SimParams {
            today: 100,
            horizon_days,
            desired_retention,
            new_per_day,
            maximum_interval_days: 36500,
            secs_per_review: 8.0,
            fsrs_weights: FSRS6_DEFAULT_WEIGHTS,
            seed: 0x5EED_CAFE_0000_0001,
        }
    }

    #[test]
    fn empty_deck_produces_zero_workload() {
        let days = simulate_workload(&[], &base_params(0.90, 20, 30));
        assert_eq!(days.len(), 30);
        assert!(days.iter().all(|d| d.reviews == 0 && d.minutes == 0.0));
    }

    #[test]
    fn higher_desired_retention_and_new_limit_increase_total_workload() {
        let cards = sample_deck();
        let low_r: u32 = simulate_workload(&cards, &base_params(0.80, 15, 90))
            .iter()
            .map(|d| d.reviews)
            .sum();
        let high_r: u32 = simulate_workload(&cards, &base_params(0.95, 15, 90))
            .iter()
            .map(|d| d.reviews)
            .sum();
        assert!(
            high_r > low_r,
            "higher retention 0.95 ({high_r}) must yield more reviews than 0.80 ({low_r})"
        );

        let low_new: u32 = simulate_workload(&cards, &base_params(0.90, 5, 30))
            .iter()
            .map(|d| d.reviews)
            .sum();
        let high_new: u32 = simulate_workload(&cards, &base_params(0.90, 30, 30))
            .iter()
            .map(|d| d.reviews)
            .sum();
        assert!(
            high_new > low_new,
            "higher new/day 30 ({high_new}) must yield more reviews than 5 ({low_new})"
        );
    }

    #[test]
    fn fixed_seed_produces_deterministic_golden_numbers() {
        let cards = sample_deck();
        let params = base_params(0.90, 10, 30);
        let run1 = simulate_workload(&cards, &params);
        let run2 = simulate_workload(&cards, &params);
        assert_eq!(run1, run2);

        let total_30d: u32 = run1.iter().map(|d| d.reviews).sum();
        let day0_reviews = run1[0].reviews;
        let day0_minutes = run1[0].minutes;
        let day29_reviews = run1[29].reviews;
        assert_eq!(total_30d, 515);
        assert_eq!(day0_reviews, 13);
        assert_eq!(day0_minutes, 1.7);
        assert_eq!(day29_reviews, 11);
    }
}
