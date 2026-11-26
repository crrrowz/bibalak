//! Read-only progress IPC commands (ADR-019 §2.7 / §3, R1 / P2).

use bibalak_core::ipc::IpcError;
use bibalak_core::progress::{
    DeckProgress, ProgressDay, ProgressSummaryDto, StudyDay, YesterdaySummaryDto,
};
use bibalak_core::Collection;
use tauri::AppHandle;

use super::with_collection;

pub(crate) fn load_progress_summary(
    collection: &Collection,
) -> Result<ProgressSummaryDto, IpcError> {
    collection.progress_summary().map_err(|e| {
        tracing::error!(error = %e, "progress_summary failed");
        IpcError::from(e)
    })
}

#[tauri::command]
pub async fn progress_summary(app: AppHandle) -> Result<ProgressSummaryDto, IpcError> {
    with_collection(app, load_progress_summary).await
}

pub(crate) fn load_progress_history(collection: &Collection) -> Result<Vec<ProgressDay>, IpcError> {
    let (days, skipped) = collection.progress_history_with_skipped().map_err(|e| {
        tracing::error!(error = %e, "progress_history failed");
        IpcError::from(e)
    })?;
    if skipped > 0 {
        tracing::debug!(skipped, "skipped unparseable progress_ledger source_keys");
    }
    Ok(days)
}

#[tauri::command]
pub async fn progress_history(app: AppHandle) -> Result<Vec<ProgressDay>, IpcError> {
    with_collection(app, load_progress_history).await
}

pub(crate) fn load_study_days(
    collection: &Collection,
    limit: Option<u32>,
) -> Result<Vec<StudyDay>, IpcError> {
    let (days, skipped) = collection.study_days_with_skipped(limit).map_err(|e| {
        tracing::error!(error = %e, ?limit, "study_days failed");
        IpcError::from(e)
    })?;
    if skipped > 0 {
        tracing::debug!(skipped, "skipped unparseable progress_ledger source_keys");
    }
    Ok(days)
}

#[tauri::command]
pub async fn study_days(app: AppHandle, limit: Option<u32>) -> Result<Vec<StudyDay>, IpcError> {
    with_collection(app, move |collection| load_study_days(collection, limit)).await
}

pub(crate) fn load_progress_by_deck(
    collection: &Collection,
) -> Result<Vec<DeckProgress>, IpcError> {
    let (rows, skipped) = collection.progress_by_deck_with_skipped().map_err(|e| {
        tracing::error!(error = %e, "progress_by_deck failed");
        IpcError::from(e)
    })?;
    if skipped > 0 {
        tracing::debug!(skipped, "skipped unparseable progress_ledger source_keys");
    }
    Ok(rows)
}

#[tauri::command]
pub async fn progress_by_deck(app: AppHandle) -> Result<Vec<DeckProgress>, IpcError> {
    with_collection(app, load_progress_by_deck).await
}

#[tauri::command]
pub async fn yesterday_summary(app: AppHandle) -> Result<Option<YesterdaySummaryDto>, IpcError> {
    with_collection(app, |collection| {
        collection.yesterday_summary().map_err(|e| {
            tracing::error!(error = %e, "yesterday_summary failed");
            IpcError::from(e)
        })
    })
    .await
}

#[tauri::command]
pub async fn dismiss_yesterday_summary(app: AppHandle, day: i32) -> Result<(), IpcError> {
    with_collection(app, move |collection| {
        collection.dismiss_yesterday_summary(day).map_err(|e| {
            tracing::error!(error = %e, day, "dismiss_yesterday_summary failed");
            IpcError::from(e)
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use bibalak_core::model::Revlog;
    use bibalak_core::ports::TestClock;
    use bibalak_core::scheduling::{CardPhase, CardState};
    use bibalak_core::Collection;
    use bibalak_db::SqliteStorage;

    use super::{
        load_progress_by_deck, load_progress_history, load_progress_summary, load_study_days,
    };

    #[test]
    fn progress_summary_reflects_answer_and_undo_on_sqlite_collection() {
        let now_ms: i64 = 1_700_000_000_000;
        let storage = SqliteStorage::open_in_memory().unwrap();
        let clock = Arc::new(TestClock::new(now_ms));
        let col = Collection::new(Box::new(storage), clock.clone()).unwrap();

        let initial = load_progress_summary(&col).unwrap();
        assert_eq!(initial.level, 1);
        assert_eq!(initial.xp_into_level, 0);
        assert_eq!(initial.xp_to_next_level, 100);
        assert_eq!(initial.total_xp, 0);
        assert_eq!(initial.gold_cents, 0);
        assert_eq!(initial.today_xp, 0);
        assert_eq!(initial.today_gold_cents, 0);

        let notetypes = col.list_notetypes().unwrap();
        let basic_id = notetypes[0].id;
        let added = col
            .add_note(basic_id, 1, &["Front".into(), "Back".into()], &[])
            .unwrap();
        let card_id = col.next_card(1).unwrap().unwrap().id;
        let prev = CardState::new(2500);
        let next = CardState {
            phase: CardPhase::Review,
            interval_days: 1,
            reps: 1,
            ..prev
        };
        let log = Revlog {
            id: now_ms + 1_000,
            card_id,
            usn: -1,
            ease: 3,
            interval: 1,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 1200,
            review_kind: 0,
        };

        col.apply_answer(card_id, added.note_id, &prev, 0, &next, 1, &log, 8)
            .unwrap();

        let after_answer = load_progress_summary(&col).unwrap();
        assert_eq!(after_answer.level, 1);
        assert_eq!(after_answer.xp_into_level, 3);
        assert_eq!(after_answer.xp_to_next_level, 100);
        assert_eq!(after_answer.total_xp, 3);
        assert_eq!(after_answer.gold_cents, 25);
        assert_eq!(after_answer.today_xp, 3);
        assert_eq!(after_answer.today_gold_cents, 25);

        clock.set(now_ms + 2_000);
        col.undo().unwrap();
        let after_undo = load_progress_summary(&col).unwrap();
        assert_eq!(after_undo.total_xp, 0);
        assert_eq!(after_undo.gold_cents, 0);
        assert_eq!(after_undo.today_xp, 0);
        assert_eq!(after_undo.today_gold_cents, 0);
    }

    #[test]
    fn scholar_progress_commands_return_history_study_days_and_deck_progress() {
        let now_ms: i64 = 1_700_000_000_000;
        let storage = SqliteStorage::open_in_memory().unwrap();
        let clock = Arc::new(TestClock::new(now_ms));
        let col = Collection::new(Box::new(storage), clock).unwrap();

        let notetypes = col.list_notetypes().unwrap();
        let basic_id = notetypes[0].id;
        let added = col
            .add_note(basic_id, 1, &["Front".into(), "Back".into()], &[])
            .unwrap();
        let card_id = col.next_card(1).unwrap().unwrap().id;
        let prev = CardState::new(2500);
        let next = CardState {
            phase: CardPhase::Review,
            interval_days: 1,
            reps: 1,
            ..prev
        };
        let log = Revlog {
            id: now_ms + 1_000,
            card_id,
            usn: -1,
            ease: 3,
            interval: 1,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 30_000,
            review_kind: 0,
        };
        col.apply_answer(card_id, added.note_id, &prev, 0, &next, 1, &log, 8)
            .unwrap();

        let history = load_progress_history(&col).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].xp, 3);
        assert_eq!(history[0].level_after, 1);

        let days = load_study_days(&col, Some(30)).unwrap();
        assert_eq!(days.len(), 1);
        assert_eq!(days[0].reviews, 1);
        assert_eq!(days[0].minutes, 0.5);
        assert_eq!(days[0].deck_ids, vec![1]);
        assert_eq!(days[0].xp, 3);

        let decks = load_progress_by_deck(&col).unwrap();
        assert_eq!(decks.len(), 1);
        assert_eq!(decks[0].deck_id, 1);
        assert_eq!(decks[0].total_cards, 1);
        assert_eq!(decks[0].xp, 3);
    }
}
