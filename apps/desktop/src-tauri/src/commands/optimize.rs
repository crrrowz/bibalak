use bibalak_core::ipc::{
    FsrsOptimizeResult, IpcError, IpcErrorKind, WorkloadComparisonDto, WorkloadPointDto,
};
use bibalak_core::scheduling::FSRS6_DEFAULT_WEIGHTS;
use bibalak_scheduler::{
    optimizer,
    simulator::{self, SimCard, SimParams},
};
use tauri::AppHandle;

use super::with_collection;

type IpcResult<T> = Result<T, IpcError>;

fn sched_err(msg: impl std::fmt::Display) -> IpcError {
    IpcError {
        kind: IpcErrorKind::Scheduler,
        message: msg.to_string(),
    }
}

/// Run the FSRS-6 weight optimizer on the collection's review history.
///
/// `deck_id` — scope to one deck (`Some(id)`) or the full collection (`None`).
/// Requires at least 400 review entries; returns an error otherwise.
#[tauri::command]
pub async fn optimize_fsrs(app: AppHandle, deck_id: Option<i64>) -> IpcResult<FsrsOptimizeResult> {
    with_collection(app, move |col| {
        let initial_weights: [f64; 21] = match deck_id {
            Some(id) => {
                let cfg = col.get_deck_config(id).map_err(IpcError::from)?;
                let mut arr = FSRS6_DEFAULT_WEIGHTS;
                if cfg.fsrs_weights.len() == 21 {
                    arr.copy_from_slice(&cfg.fsrs_weights);
                }
                arr
            }
            None => FSRS6_DEFAULT_WEIGHTS,
        };

        let revlogs = col.revlogs_for_optimize(deck_id).map_err(IpcError::from)?;
        let result = optimizer::optimize(&revlogs, &initial_weights).map_err(sched_err)?;

        Ok(FsrsOptimizeResult {
            weights: result.weights.to_vec(),
            log_loss_before: result.log_loss_before,
            log_loss_after: result.log_loss_after,
            review_count: result.review_count,
            card_count: result.card_count,
        })
    })
    .await
}

/// Persist fitted FSRS-6 weights to a deck's scheduling config.
#[tauri::command]
pub async fn apply_fsrs_weights(app: AppHandle, deck_id: i64, weights: Vec<f64>) -> IpcResult<()> {
    if weights.len() != 21 || weights.iter().any(|w| !w.is_finite()) {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: format!("expected 21 finite weights, got {}", weights.len()),
        });
    }
    with_collection(app, move |col| {
        let mut cfg = col.get_deck_config(deck_id).map_err(IpcError::from)?;
        cfg.fsrs_weights = weights;
        col.set_deck_config(&cfg).map_err(IpcError::from)
    })
    .await
}

/// Simulate daily review workload over `horizon_days` comparing a deck's saved
/// FSRS options against unsaved edits (`desired_retention`, `new_per_day`, `weights`).
#[tauri::command]
pub async fn simulate_workload(
    app: AppHandle,
    deck_id: i64,
    desired_retention: f64,
    new_per_day: u32,
    horizon_days: u32,
    weights: Option<Vec<f64>>,
) -> IpcResult<WorkloadComparisonDto> {
    if !desired_retention.is_finite() {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: "desired_retention must be finite".into(),
        });
    }
    if let Some(ref w) = weights {
        if w.len() != 21 || w.iter().any(|x| !x.is_finite()) {
            return Err(IpcError {
                kind: IpcErrorKind::Invalid,
                message: format!("expected 21 finite weights, got {}", w.len()),
            });
        }
    }

    with_collection(app, move |col| {
        let cfg = col.get_deck_config(deck_id).map_err(IpcError::from)?;
        let sched = col.get_sched_config(deck_id).map_err(IpcError::from)?;
        let snap = col.workload_snapshot(deck_id).map_err(IpcError::from)?;

        let mut proposed_weights = sched.fsrs_weights;
        if let Some(w) = weights {
            proposed_weights.copy_from_slice(&w);
        }

        let cards: Vec<SimCard> = snap
            .cards
            .into_iter()
            .map(|c| SimCard {
                due: c.due,
                state: c.state,
            })
            .collect();

        let horizon = horizon_days.clamp(1, 365);
        let seed = 0x4b65_6570_7361_6b65_u64 ^ (deck_id as u64);
        let current_params = SimParams {
            today: col.today(),
            horizon_days: horizon,
            desired_retention: cfg.desired_retention.clamp(0.70, 0.99),
            new_per_day: cfg.new_per_day,
            maximum_interval_days: cfg.maximum_interval_days,
            secs_per_review: snap.avg_review_secs,
            fsrs_weights: sched.fsrs_weights,
            seed,
        };
        let proposed_params = SimParams {
            desired_retention: desired_retention.clamp(0.70, 0.99),
            new_per_day,
            fsrs_weights: proposed_weights,
            ..current_params
        };

        let current = simulator::simulate_workload(&cards, &current_params);
        let proposed = simulator::simulate_workload(&cards, &proposed_params);

        let mut total_current_reviews = 0_u32;
        let mut total_proposed_reviews = 0_u32;
        let mut sum_current_mins = 0.0_f64;
        let mut sum_proposed_mins = 0.0_f64;

        let days: Vec<WorkloadPointDto> = current
            .into_iter()
            .zip(proposed)
            .map(|(cur, prop)| {
                total_current_reviews = total_current_reviews.saturating_add(cur.reviews);
                total_proposed_reviews = total_proposed_reviews.saturating_add(prop.reviews);
                sum_current_mins += cur.minutes;
                sum_proposed_mins += prop.minutes;
                WorkloadPointDto {
                    day: cur.day,
                    current_reviews: cur.reviews,
                    proposed_reviews: prop.reviews,
                    current_minutes: cur.minutes,
                    proposed_minutes: prop.minutes,
                }
            })
            .collect();

        let denom = f64::from(horizon);
        Ok(WorkloadComparisonDto {
            days,
            total_current_reviews,
            total_proposed_reviews,
            avg_daily_minutes_current: ((sum_current_mins / denom) * 10.0).round() / 10.0,
            avg_daily_minutes_proposed: ((sum_proposed_mins / denom) * 10.0).round() / 10.0,
        })
    })
    .await
}
