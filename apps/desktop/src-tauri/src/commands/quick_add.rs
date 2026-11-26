use bibalak_core::ipc::{IpcError, IpcErrorKind, QuickAddConfig};
use tauri::{AppHandle, Manager, State};

use super::{run_blocking, state_err};
use crate::quick_add::{self, QuickAddState};

type IpcResult<T> = Result<T, IpcError>;

fn invalid_err(message: String) -> IpcError {
    IpcError {
        kind: IpcErrorKind::Invalid,
        message,
    }
}

#[tauri::command]
pub fn get_quick_add_config(state: State<'_, QuickAddState>) -> IpcResult<QuickAddConfig> {
    state.get().map_err(invalid_err)
}

#[tauri::command]
pub async fn set_quick_add_config(
    enabled: bool,
    shortcut: String,
    app: AppHandle,
) -> IpcResult<QuickAddConfig> {
    let trimmed = shortcut.trim();
    if trimmed.len() > 128 || trimmed.chars().any(char::is_control) {
        return Err(invalid_err(
            "shortcut is too long or contains control characters".into(),
        ));
    }
    let app_for_save = app.clone();
    let cfg = run_blocking(move || {
        let state = app_for_save
            .try_state::<QuickAddState>()
            .ok_or_else(|| state_err("QuickAddState"))?;
        state.set_shortcut(enabled, shortcut).map_err(invalid_err)
    })
    .await?;
    if !cfg.enabled {
        quick_add::destroy_window_if_open(&app);
    }
    Ok(cfg)
}

#[tauri::command]
pub async fn remember_quick_add_target(
    deck_id: Option<i64>,
    notetype_id: Option<i64>,
    app: AppHandle,
) -> IpcResult<QuickAddConfig> {
    if matches!(deck_id, Some(id) if id <= 0) {
        return Err(invalid_err("deck_id must be positive".into()));
    }
    if matches!(notetype_id, Some(id) if id <= 0) {
        return Err(invalid_err("notetype_id must be positive".into()));
    }
    run_blocking(move || {
        let state = app
            .try_state::<QuickAddState>()
            .ok_or_else(|| state_err("QuickAddState"))?;
        state
            .remember_target(deck_id, notetype_id)
            .map_err(invalid_err)
    })
    .await
}

#[tauri::command]
pub async fn toggle_quick_add(state: State<'_, QuickAddState>, app: AppHandle) -> IpcResult<bool> {
    let cfg = state.get().map_err(invalid_err)?;
    quick_add::toggle_or_open_window(&app, &cfg).map_err(invalid_err)
}

#[tauri::command]
pub fn hide_quick_add(app: AppHandle) {
    quick_add::hide_window(&app);
}
