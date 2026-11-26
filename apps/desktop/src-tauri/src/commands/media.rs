//! Thin media IPC commands delegating storage/dedup to [`crate::MediaState`] and [`Collection`].

use bibalak_core::collection::Collection;
use bibalak_core::ipc::{IpcError, IpcErrorKind, MediaLibraryFilter, MediaLibraryPage};
use tauri::{AppHandle, Manager};

use super::{run_blocking, state_err};
use crate::MediaState;

type IpcResult<T> = Result<T, IpcError>;

pub(crate) fn ensure_no_legacy_copy_pending(app: &AppHandle) -> IpcResult<()> {
    if let Some(dirs) = app.try_state::<crate::LegacyMediaDirs>() {
        crate::legacy::ensure_no_legacy_copy_pending(&dirs.new_dir)?;
    }
    Ok(())
}

fn map_io<E: std::fmt::Display>(e: E) -> IpcError {
    IpcError {
        kind: IpcErrorKind::Storage,
        message: e.to_string(),
    }
}

const MAX_MEDIA_BYTES: usize = 100 * 1024 * 1024;
const MAX_MEDIA_PAGE_LIMIT: u32 = 1_000;

/// Save a pasted media file via [`MediaStore`], returning the stored filename.
#[tauri::command]
pub async fn save_media(app: AppHandle, bytes: Vec<u8>, filename: String) -> IpcResult<String> {
    if bytes.len() > MAX_MEDIA_BYTES {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: "media file exceeds 100 MiB limit".into(),
        });
    }
    run_blocking(move || {
        let media = app
            .try_state::<MediaState>()
            .ok_or_else(|| state_err("MediaState"))?;
        media.0.add(&filename, &bytes).map_err(IpcError::from)
    })
    .await
}

/// Read `source_path` and store it via [`MediaStore`], returning the stored filename.
#[tauri::command]
pub async fn save_media_from_path(app: AppHandle, source_path: String) -> IpcResult<String> {
    run_blocking(move || {
        let picked = app
            .try_state::<crate::paths_guard::PickedPathsState>()
            .ok_or_else(|| state_err("PickedPathsState"))?;
        let media = app
            .try_state::<MediaState>()
            .ok_or_else(|| state_err("MediaState"))?;
        let path = picked.verify_open_file(&source_path, &[])?;
        let meta = std::fs::metadata(&path).map_err(map_io)?;
        if meta.len() > MAX_MEDIA_BYTES as u64 {
            return Err(IpcError {
                kind: IpcErrorKind::Invalid,
                message: "media file exceeds 100 MiB limit".into(),
            });
        }
        let bytes = std::fs::read(&path).map_err(map_io)?;
        let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("media");
        media.0.add(filename, &bytes).map_err(IpcError::from)
    })
    .await
}

/// Return one page of stored media files with sizes, kinds, and note usage counts.
#[tauri::command]
pub async fn list_media_library(
    app: AppHandle,
    search: String,
    filter: Option<MediaLibraryFilter>,
    limit: u32,
    offset: u32,
) -> IpcResult<MediaLibraryPage> {
    if limit == 0 || limit > MAX_MEDIA_PAGE_LIMIT {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: format!("limit must be between 1 and {MAX_MEDIA_PAGE_LIMIT}"),
        });
    }
    run_blocking(move || {
        let collection = app
            .try_state::<Collection>()
            .ok_or_else(|| state_err("Collection"))?;
        let media = app
            .try_state::<MediaState>()
            .ok_or_else(|| state_err("MediaState"))?;
        let filter = filter.unwrap_or_default();
        collection
            .list_media_library(media.0.as_ref(), &search, &filter, limit, offset)
            .map_err(IpcError::from)
    })
    .await
}

/// Return `true` while phase 2 legacy media migration is still copying files in the background.
#[tauri::command]
pub async fn legacy_media_pending(app: AppHandle) -> bool {
    run_blocking(move || {
        Ok(app
            .try_state::<crate::LegacyMediaDirs>()
            .is_some_and(|dirs| crate::legacy::legacy_copy_pending(&dirs.new_dir)))
    })
    .await
    .unwrap_or(false)
}

/// Delete all unreferenced media files via [`MediaStore`] and return count removed.
#[tauri::command]
pub async fn delete_unused_media(app: AppHandle) -> IpcResult<u32> {
    run_blocking(move || {
        ensure_no_legacy_copy_pending(&app)?;
        let collection = app
            .try_state::<Collection>()
            .ok_or_else(|| state_err("Collection"))?;
        let media = app
            .try_state::<MediaState>()
            .ok_or_else(|| state_err("MediaState"))?;
        collection
            .delete_unused_media(media.0.as_ref())
            .map_err(IpcError::from)
    })
    .await
}
