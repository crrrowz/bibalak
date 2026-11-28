use std::path::PathBuf;

use bibalak_core::{
    collection::Collection,
    ipc::{BackupInfo, IntegrityReport, IpcError, IpcErrorKind, MediaReport},
};
use bibalak_db::backup;
use tauri::{AppHandle, Manager};

use super::{run_blocking, state_err, with_collection};

type IpcResult<T> = Result<T, IpcError>;

const KEEP_BACKUPS: usize = 20;

fn backup_dir(app: &AppHandle) -> Result<PathBuf, IpcError> {
    crate::data_dir::data_dir(app)
        .map(|p| p.join("backups"))
        .map_err(|e| IpcError {
            kind: IpcErrorKind::Storage,
            message: e.to_string(),
        })
}

fn map_io<E: std::fmt::Display>(e: E) -> IpcError {
    IpcError {
        kind: IpcErrorKind::Storage,
        message: e.to_string(),
    }
}

/// Create a backup zip and return its metadata.
#[tauri::command]
pub async fn create_backup(app: AppHandle) -> IpcResult<BackupInfo> {
    run_blocking(move || {
        let col = app
            .try_state::<Collection>()
            .ok_or_else(|| state_err("Collection"))?;
        let dir = backup_dir(&app)?;
        std::fs::create_dir_all(&dir).map_err(map_io)?;

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        let name = format!("{now_ms}.zip");
        let zip_path = dir.join(&name);

        // Hot-copy the DB to a temp file first so we can zip while the DB is live.
        let tmp = dir.join(format!("{now_ms}.tmp.sqlite"));
        col.backup_db(&tmp).map_err(IpcError::from)?;

        let media_dir = crate::data_dir::data_dir(&app)
            .map(|p| p.join("collection.media"))
            .map_err(map_io)?;

        let size_bytes = backup::create_zip(&tmp, &media_dir, &zip_path).map_err(IpcError::from)?;
        let _ = std::fs::remove_file(&tmp);

        backup::rotate_backups(&dir, KEEP_BACKUPS).map_err(IpcError::from)?;

        Ok(BackupInfo {
            name,
            created_ms: now_ms,
            size_bytes: size_bytes as i64,
        })
    })
    .await
}

/// List all existing backups, newest first.
#[tauri::command]
pub async fn list_backups(app: AppHandle) -> IpcResult<Vec<BackupInfo>> {
    run_blocking(move || {
        let dir = backup_dir(&app)?;
        let entries = backup::list_zips(&dir).map_err(IpcError::from)?;
        Ok(entries
            .into_iter()
            .map(|(name, created_ms, size_bytes)| BackupInfo {
                name,
                created_ms,
                size_bytes: size_bytes as i64,
            })
            .collect())
    })
    .await
}

/// Stage a backup restore (`collection.sqlite.pending-restore`) from a zip archive.
///
/// Does not overwrite the live database while SQLite/WAL is open; the staged file
/// is validated now and swapped into place before `SqliteStorage::open` on next start.
#[tauri::command]
pub async fn restore_backup(app: AppHandle, name: String) -> IpcResult<()> {
    run_blocking(move || {
        let dir = backup_dir(&app)?;
        let zip_path = crate::paths_guard::resolve_backup_zip_path(&dir, &name)?;

        let data_dir = crate::data_dir::data_dir(&app).map_err(map_io)?;
        let db_path = data_dir.join("collection.sqlite");
        backup::stage_restore(&zip_path, &db_path).map_err(IpcError::from)?;
        Ok(())
    })
    .await
}

/// Delete a backup zip by name.
#[tauri::command]
pub async fn delete_backup(app: AppHandle, name: String) -> IpcResult<()> {
    run_blocking(move || {
        let dir = backup_dir(&app)?;
        let zip_path = crate::paths_guard::resolve_backup_zip_path(&dir, &name)?;
        std::fs::remove_file(&zip_path).map_err(map_io)?;
        Ok(())
    })
    .await
}

/// Run `PRAGMA integrity_check` and return structured error/repair counts.
#[tauri::command]
pub async fn check_integrity(app: AppHandle) -> IpcResult<IntegrityReport> {
    with_collection(app, |col| col.integrity_check().map_err(IpcError::from)).await
}

/// Run `PRAGMA optimize; VACUUM` to compact and tune the database.
#[tauri::command]
pub async fn optimize_db(app: AppHandle) -> IpcResult<()> {
    with_collection(app, |col| col.optimize().map_err(IpcError::from)).await
}

/// Scan media references in notes against files on disk.
/// Returns orphan files (on disk but unreferenced) and missing files
/// (referenced in notes but absent from disk).
#[tauri::command]
pub async fn check_media(app: AppHandle) -> IpcResult<MediaReport> {
    run_blocking(move || {
        super::media::ensure_no_legacy_copy_pending(&app)?;
        let col = app
            .try_state::<Collection>()
            .ok_or_else(|| state_err("Collection"))?;
        let media = app
            .try_state::<crate::MediaState>()
            .ok_or_else(|| state_err("MediaState"))?;
        media.0.check_media(col.storage()).map_err(IpcError::from)
    })
    .await
}

/// Delete orphan media files — files on disk not referenced by any note.
/// Accepts the list returned by `check_media` so the frontend can confirm
/// before deleting. Returns the number of files actually removed.
#[tauri::command]
pub async fn delete_orphan_media(app: AppHandle, files: Vec<String>) -> IpcResult<u32> {
    if files.len() > 50_000 {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: "files exceeds maximum batch size of 50000".into(),
        });
    }
    run_blocking(move || {
        super::media::ensure_no_legacy_copy_pending(&app)?;
        let media = app
            .try_state::<crate::MediaState>()
            .ok_or_else(|| state_err("MediaState"))?;
        media.0.delete(&files).map_err(IpcError::from)
    })
    .await
}
