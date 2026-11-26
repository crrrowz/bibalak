//! App-level commands, including Rust-mediated native file dialogs.

use std::sync::Mutex;

use bibalak_core::error::CoreError;
use bibalak_core::ipc::{AppInfo, IpcError, IpcErrorKind};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::paths_guard::PickedPathsState;

#[derive(Debug, Clone, Serialize)]
pub struct StartupErrorInfo {
    pub kind: &'static str,
    pub found: Option<i64>,
    pub supported: Option<i64>,
    pub message: String,
}

impl StartupErrorInfo {
    pub(crate) fn from_core(err: &CoreError) -> Self {
        match err {
            CoreError::SchemaTooNew { found, supported } => Self {
                kind: "schema_too_new",
                found: Some(*found),
                supported: Some(*supported),
                message: err.to_string(),
            },
            _ => Self {
                kind: "open_failed",
                found: None,
                supported: None,
                message: err.to_string(),
            },
        }
    }
}

pub struct StartupErrorState(pub Mutex<Option<StartupErrorInfo>>);

#[tauri::command]
pub fn get_startup_error(state: State<'_, StartupErrorState>) -> Option<StartupErrorInfo> {
    state.0.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

const MAX_DIALOG_FILTERS: usize = 16;
const MAX_DIALOG_TITLE_LEN: usize = 256;
const MAX_DEFAULT_FILE_NAME_LEN: usize = 255;

#[derive(Debug, Deserialize)]
pub struct DialogFilterInput {
    pub name: String,
    pub extensions: Vec<String>,
}

fn invalid_err(message: impl Into<String>) -> IpcError {
    IpcError {
        kind: IpcErrorKind::Invalid,
        message: message.into(),
    }
}

fn validate_filters(filters: &[DialogFilterInput]) -> Result<(), IpcError> {
    if filters.len() > MAX_DIALOG_FILTERS {
        return Err(invalid_err("too many file dialog filters"));
    }
    for f in filters {
        if f.name.len() > MAX_DIALOG_TITLE_LEN || f.extensions.len() > 32 {
            return Err(invalid_err("invalid file dialog filter"));
        }
        for ext in &f.extensions {
            if ext.is_empty() || ext.len() > 16 || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
                return Err(invalid_err(format!("invalid filter extension '{ext}'")));
            }
        }
    }
    Ok(())
}

/// Returns basic identity of the running app, including the media directory
/// path so the frontend can resolve card images and audio via the asset protocol.
#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    let media_dir = crate::data_dir::data_dir(&app)
        .map(|p| p.join("collection.media").to_string_lossy().into_owned())
        .unwrap_or_default();
    AppInfo {
        name: "Bibalak".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        tauri_version: tauri::VERSION.to_string(),
        media_dir,
    }
}

/// Show a native open-file or open-folder dialog and register the picked path
/// in [`PickedPathsState`] so subsequent import/media/plugin commands accept it.
#[tauri::command]
pub async fn pick_open_path(
    window: tauri::Window,
    app: AppHandle,
    picked: State<'_, PickedPathsState>,
    title: Option<String>,
    directory: bool,
    filters: Vec<DialogFilterInput>,
) -> Result<Option<String>, IpcError> {
    if let Some(ref t) = title {
        if t.len() > MAX_DIALOG_TITLE_LEN {
            return Err(invalid_err("dialog title too long"));
        }
    }
    validate_filters(&filters)?;

    let mut builder = app.dialog().file();
    #[cfg(desktop)]
    {
        builder = builder.set_parent(&window);
    }
    if let Some(t) = title {
        builder = builder.set_title(t);
    }
    for f in &filters {
        let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(&f.name, &exts);
    }

    let chosen = if directory {
        #[cfg(desktop)]
        {
            builder.blocking_pick_folder()
        }
        #[cfg(not(desktop))]
        {
            return Err(invalid_err(
                "folder picker is not supported on this platform",
            ));
        }
    } else {
        builder.blocking_pick_file()
    };

    let Some(file_path) = chosen else {
        return Ok(None);
    };
    let path = file_path
        .into_path()
        .map_err(|e| invalid_err(format!("picked path is not a local filesystem path: {e}")))?;
    let recorded = if directory {
        picked.record_open_dir(&path)?
    } else {
        picked.record_open_file(&path)?
    };
    Ok(Some(recorded.to_string_lossy().into_owned()))
}

/// Show a native save-file dialog and register the picked path in [`PickedPathsState`]
/// so `export_package` accepts it.
#[tauri::command]
pub async fn pick_save_path(
    window: tauri::Window,
    app: AppHandle,
    picked: State<'_, PickedPathsState>,
    default_path: String,
    filters: Vec<DialogFilterInput>,
) -> Result<Option<String>, IpcError> {
    let default_name = default_path.trim();
    if default_name.is_empty()
        || default_name.len() > MAX_DEFAULT_FILE_NAME_LEN
        || default_name == "."
        || default_name == ".."
        || default_name.contains(['/', '\\', '\0', ':'])
    {
        return Err(invalid_err("invalid default save file name"));
    }
    validate_filters(&filters)?;

    let mut builder = app.dialog().file();
    #[cfg(desktop)]
    {
        builder = builder.set_parent(&window);
    }
    builder = builder.set_file_name(default_name);
    for f in &filters {
        let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(&f.name, &exts);
    }

    let Some(file_path) = builder.blocking_save_file() else {
        return Ok(None);
    };
    let path = file_path
        .into_path()
        .map_err(|e| invalid_err(format!("picked path is not a local filesystem path: {e}")))?;
    let recorded = picked.record_save_file(&path)?;
    Ok(Some(recorded.to_string_lossy().into_owned()))
}
