//! # bibalak-scheduler
//!
//! Pure scheduling logic. Functions are deterministic over plain data plus the
//! [`SchedContext`] (today + per-deck config); there is no IO, no database and
//! no direct wall-clock access. Both algorithms implement the
//! [`bibalak_core::scheduling::Scheduler`] port, so the application layer never
//! names a concrete algorithm — it asks [`scheduler_for`].
//!
//! Interval fuzz is applied by the caller at apply time (seeded by card id) so
//! that previews and these tests stay deterministic.

mod common;
mod fsrs;
pub mod optimizer;
pub mod simulator;
mod sm2;

pub use fsrs::{retrievability, FsrsScheduler};
pub use optimizer::{optimize, OptimizeResult, MIN_REVIEWS};
pub use simulator::{simulate_workload, SimCard, SimParams, SimulatedDay};
pub use sm2::Sm2Scheduler;

use bibalak_core::scheduling::{AnswerOutcome, CardState, SchedContext, Scheduler};
use bibalak_core::{Algorithm, Rating, SchedulerSet};

/// Default [`SchedulerSet`] backed by [`scheduler_for`] and [`fuzz_days`].
#[derive(Debug, Default, Clone, Copy)]
pub struct DefaultSchedulerSet;

impl SchedulerSet for DefaultSchedulerSet {
    fn answer(
        &self,
        algorithm: Algorithm,
        state: &CardState,
        rating: Rating,
        ctx: &SchedContext,
    ) -> AnswerOutcome {
        scheduler_for(algorithm).answer(state, rating, ctx)
    }

    fn fuzz_days(&self, days: u32, card_id: i64) -> u32 {
        fuzz_days(days, card_id)
    }
}

/// Construct the scheduler for a deck's configured algorithm. Switching is just
/// a config change — both SM-2 and FSRS state persist on every card.
pub fn scheduler_for(algorithm: Algorithm) -> Box<dyn Scheduler> {
    match algorithm {
        Algorithm::Sm2 => Box::new(Sm2Scheduler),
        Algorithm::Fsrs => Box::new(FsrsScheduler),
    }
}

/// Anki-style interval fuzz: ± a small random range seeded by `card_id` so that
/// cards due on the same day don't all come back at exactly the same time.
/// The state's `interval_days` is stored unfuzzed; fuzz is applied only to `due`.
pub fn fuzz_days(days: u32, card_id: i64) -> u32 {
    if days < 2 {
        return days;
    }
    // LCG-based deterministic fuzz seeded by card_id + days.
    let seed = (card_id.unsigned_abs())
        .wrapping_mul(1_664_525)
        .wrapping_add(days as u64)
        .wrapping_add(1_013_904_223);
    let rng = ((seed >> 16) & 0xffff) as f64 / 65536.0; // [0, 1)

    let delta = if days < 7 {
        ((days as f64 * 0.25).round() as u32).max(1)
    } else if days < 30 {
        ((days as f64 * 0.15).round() as u32).max(2)
    } else {
        ((days as f64 * 0.05).round() as u32).max(4)
    };

    let fuzz = (rng * (2 * delta + 1) as f64) as u32;
    days.saturating_sub(delta) + fuzz
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn factory_returns_matching_algorithm() {
        assert_eq!(scheduler_for(Algorithm::Sm2).algorithm(), Algorithm::Sm2);
        assert_eq!(scheduler_for(Algorithm::Fsrs).algorithm(), Algorithm::Fsrs);
    }

    #[test]
    fn fuzz_days_stays_within_delta_for_all_16bit_seeds() {
        let expected_delta = |days: u32| -> u32 {
            if days < 7 {
                ((days as f64 * 0.25).round() as u32).max(1)
            } else if days < 30 {
                ((days as f64 * 0.15).round() as u32).max(2)
            } else {
                ((days as f64 * 0.05).round() as u32).max(4)
            }
        };

        for days in [0, 1] {
            for card_id in [-1, 0, 1, 42, i64::MIN, i64::MAX] {
                assert_eq!(fuzz_days(days, card_id), days);
            }
        }

        // `1_664_525` is odd, so `(i << 16) * 1_664_525` sweeps every 16-bit
        // value in bits 16..31 across `i in 0..65_536`.
        for days in [2, 3, 6, 7, 15, 29, 30, 100, 365] {
            let delta = expected_delta(days);
            let min_due = days.saturating_sub(delta);
            let max_due = min_due + 2 * delta;
            for i in 0u64..65_536 {
                let card_id = (i << 16) as i64;
                let fuzzed = fuzz_days(days, card_id);
                assert!(
                    (min_due..=max_due).contains(&fuzzed),
                    "days={days} card_id={card_id}: fuzzed={fuzzed} outside [{min_due}, {max_due}]"
                );
            }
            for card_id in [-1_i64, -42, i64::MIN, i64::MAX] {
                let fuzzed = fuzz_days(days, card_id);
                assert!(
                    (min_due..=max_due).contains(&fuzzed),
                    "days={days} card_id={card_id}: fuzzed={fuzzed} outside [{min_due}, {max_due}]"
                );
            }
        }
    }
}
