//! Thin Tauri IPC commands for Cycle 3 daily motivation (ADR-027, 16d).

use bibalak_core::ipc::IpcError;
use bibalak_core::motivation::{
    validate_daily_goal_xp, validate_month_key, MotivationStateDto, StreakCalendarDto,
};
use tauri::AppHandle;

use super::with_collection;

type IpcResult<T> = Result<T, IpcError>;

#[tauri::command]
pub async fn get_motivation_state(
    app: AppHandle,
    style: Option<String>,
) -> IpcResult<MotivationStateDto> {
    with_collection(app, move |collection| {
        collection
            .get_motivation_state_for_style(style.as_deref())
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn set_daily_goal(app: AppHandle, goal_xp: u32) -> IpcResult<MotivationStateDto> {
    let valid_goal = validate_daily_goal_xp(goal_xp).map_err(IpcError::from)?;
    with_collection(app, move |collection| {
        collection
            .set_daily_goal(valid_goal)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn get_streak_calendar(
    app: AppHandle,
    year: i32,
    month: u8,
) -> IpcResult<StreakCalendarDto> {
    with_collection(app, move |collection| {
        collection
            .get_streak_calendar(year, month)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn freeze_study_day(app: AppHandle, day_index: i32) -> IpcResult<StreakCalendarDto> {
    with_collection(app, move |collection| {
        collection
            .freeze_study_day(day_index)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn dismiss_comeback_offer(app: AppHandle) -> IpcResult<()> {
    with_collection(app, |collection| {
        collection.dismiss_comeback_offer().map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn complete_onboarding(
    app: AppHandle,
    skipped: bool,
    create_starter: bool,
    locale: String,
) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection
            .complete_onboarding(skipped, create_starter, &locale)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn mark_monthly_badge_seen(app: AppHandle, month_key: String) -> IpcResult<()> {
    let valid_key = validate_month_key(&month_key).map_err(IpcError::from)?;
    with_collection(app, move |collection| {
        collection
            .mark_monthly_badge_seen(&valid_key)
            .map_err(IpcError::from)
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use bibalak_core::ports::TestClock;
    use bibalak_core::Collection;
    use bibalak_db::SqliteStorage;

    #[test]
    fn motivation_collection_onboarding_and_goal_roundtrip() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let clock = Arc::new(TestClock::new(1_794_601_800_000));
        let col = Collection::new(Box::new(storage), clock).unwrap();

        let initial = col.get_motivation_state().unwrap();
        assert_eq!(initial.daily_goal_xp, 10);
        assert!(!initial.onboarding_completed);
        assert_eq!(initial.daily_quests.len(), 3);

        assert!(col.set_daily_goal(15).is_err());
        let updated = col.set_daily_goal(30).unwrap();
        assert_eq!(updated.daily_goal_xp, 30);

        col.complete_onboarding(false, true, "en").unwrap();
        let after_onb = col.get_motivation_state().unwrap();
        assert!(after_onb.onboarding_completed);
        assert!(col
            .list_decks()
            .unwrap()
            .iter()
            .any(|d| d.name == "Bibalak Starter"));
    }
}
