//! IPC command surface. Each submodule groups related commands. Commands are
//! thin: validate, delegate to `bibalak-core`, (de)serialise. They must not
//! contain domain logic. Errors surface as the typed `IpcError` union.

pub mod ai;
pub mod app;
pub mod browse;
pub mod cards;
pub mod deck;
pub mod export;
pub mod game;
pub mod import;
pub mod maintenance;
pub mod media;
pub mod motivation;
pub mod notetype;
pub mod optimize;
pub mod plugins;
pub mod productivity;
pub mod progress;
pub mod quick_add;
pub mod reminders;
pub mod stats;
pub mod study;
pub mod tags;

use bibalak_core::ipc::{IpcError, IpcErrorKind};
use bibalak_core::Collection;
use tauri::{AppHandle, Manager};

pub(crate) fn state_err(name: &str) -> IpcError {
    IpcError {
        kind: IpcErrorKind::Internal,
        message: format!("state `{name}` is not initialized"),
    }
}

pub(crate) async fn run_blocking<F, T>(f: F) -> Result<T, IpcError>
where
    F: FnOnce() -> Result<T, IpcError> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| IpcError {
            kind: IpcErrorKind::Internal,
            message: format!("blocking task failed: {e}"),
        })?
}

pub(crate) async fn with_collection<F, T>(app: AppHandle, f: F) -> Result<T, IpcError>
where
    F: FnOnce(&Collection) -> Result<T, IpcError> + Send + 'static,
    T: Send + 'static,
{
    run_blocking(move || {
        let collection = app
            .try_state::<Collection>()
            .ok_or_else(|| state_err("Collection"))?;
        f(&collection)
    })
    .await
}
