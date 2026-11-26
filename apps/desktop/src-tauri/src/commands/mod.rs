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

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use bibalak_core::ipc::{IpcError, IpcErrorKind};
use bibalak_core::Collection;
use tauri::{AppHandle, Manager};

/// Cooperative cancellation registry shared by long-running export and import jobs.
#[derive(Default)]
pub(crate) struct CancelRegistry(Mutex<HashMap<String, Arc<AtomicBool>>>);

pub(crate) struct JobRegistration<'a> {
    registry: &'a CancelRegistry,
    id: String,
    pub(crate) flag: Arc<AtomicBool>,
}

impl Drop for JobRegistration<'_> {
    fn drop(&mut self) {
        if let Ok(mut map) = self.registry.0.lock() {
            map.remove(&self.id);
        }
    }
}

pub(crate) fn validate_job_id(id: &str) -> Result<(), IpcError> {
    if id.is_empty() || id.len() > 64 || id.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: "job id must be 1–64 non-whitespace characters".into(),
        });
    }
    Ok(())
}

impl CancelRegistry {
    pub(crate) fn register<'a>(&'a self, id: &str) -> Result<JobRegistration<'a>, IpcError> {
        validate_job_id(id)?;
        let flag = Arc::new(AtomicBool::new(false));
        let mut map = self.0.lock().map_err(|_| IpcError {
            kind: IpcErrorKind::Internal,
            message: "job registry lock poisoned".into(),
        })?;
        if map.contains_key(id) {
            return Err(IpcError {
                kind: IpcErrorKind::Invalid,
                message: format!("job '{id}' is already running"),
            });
        }
        map.insert(id.to_string(), Arc::clone(&flag));
        Ok(JobRegistration {
            registry: self,
            id: id.to_string(),
            flag,
        })
    }

    pub(crate) fn cancel(&self, id: &str) -> Result<bool, IpcError> {
        validate_job_id(id)?;
        let map = self.0.lock().map_err(|_| IpcError {
            kind: IpcErrorKind::Internal,
            message: "job registry lock poisoned".into(),
        })?;
        if let Some(flag) = map.get(id) {
            flag.store(true, Ordering::Relaxed);
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

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
