//! Thin Tauri IPC command for OS reminder planning (D45 / ADR-028, 16c).

use bibalak_core::ipc::IpcError;
use bibalak_core::reminders::{ReminderPlanDto, ReminderSettingsInput};
use tauri::AppHandle;

use super::with_collection;

#[tauri::command]
pub async fn plan_reminders(
    app: AppHandle,
    settings: ReminderSettingsInput,
    style: Option<String>,
) -> Result<ReminderPlanDto, IpcError> {
    with_collection(app, move |collection| {
        collection
            .plan_reminders(&settings, style.as_deref())
            .map_err(IpcError::from)
    })
    .await
}
