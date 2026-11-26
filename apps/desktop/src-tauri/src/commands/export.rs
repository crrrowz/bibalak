//! Export command: dump the collection and write it as an .apkg file.

use bibalak_core::ipc::{IpcError, IpcErrorKind};
use bibalak_core::{Collection, MediaStore};
use tauri::{AppHandle, Manager};

use super::{run_blocking, state_err};
use crate::paths_guard::PickedPathsState;
use crate::MediaState;

type IpcResult<T> = Result<T, IpcError>;

fn ipc_err(msg: impl std::fmt::Display) -> IpcError {
    IpcError {
        kind: IpcErrorKind::Internal,
        message: msg.to_string(),
    }
}

pub(crate) fn export_package_checked(
    collection: &Collection,
    media: &dyn MediaStore,
    picked: &PickedPathsState,
    path: &str,
) -> IpcResult<u32> {
    let dest = picked.verify_save_file(path, &["apkg"])?;
    let model = collection.dump_collection().map_err(ipc_err)?;
    let count =
        bibalak_ankifmt::write_apkg_with_media(&model, &dest, Some(media)).map_err(ipc_err)?;
    Ok(count)
}

/// Export the collection to the given path as an .apkg file.
/// Returns the number of media files included.
#[tauri::command]
pub async fn export_package(app: AppHandle, path: String) -> IpcResult<u32> {
    run_blocking(move || {
        let collection = app
            .try_state::<Collection>()
            .ok_or_else(|| state_err("Collection"))?;
        let media = app
            .try_state::<MediaState>()
            .ok_or_else(|| state_err("MediaState"))?;
        let picked = app
            .try_state::<PickedPathsState>()
            .ok_or_else(|| state_err("PickedPathsState"))?;
        export_package_checked(&collection, media.0.as_ref(), &picked, &path)
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use bibalak_core::ports::FixedClock;
    use bibalak_db::SqliteStorage;
    use bibalak_media::FsMediaStore;

    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let uniq = format!(
            "keepsake_export_test_{tag}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let dir = std::env::temp_dir().join(uniq);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn export_path_must_be_user_picked() {
        let root = temp_dir("guard");
        let data_dir = root.join("data");
        let export_dir = root.join("exports");
        std::fs::create_dir_all(&data_dir).unwrap();
        std::fs::create_dir_all(&export_dir).unwrap();

        let storage = SqliteStorage::open_in_memory().unwrap();
        let collection =
            Collection::new(Box::new(storage), Arc::new(FixedClock(1_700_000_000_000))).unwrap();
        let media = FsMediaStore::new(data_dir.join("collection.media"));
        let picked = PickedPathsState::new(data_dir.clone());

        let unpicked_abs = export_dir.join("collection.apkg");
        for bad in [
            "collection.apkg",
            "../collection.apkg",
            "\\\\server\\share\\collection.apkg",
            "C:\\evil\\collection.apkg",
            &unpicked_abs.to_string_lossy(),
            &data_dir.join("collection.apkg").to_string_lossy(),
        ] {
            let err = export_package_checked(&collection, &media, &picked, bad).unwrap_err();
            assert_eq!(
                err.kind,
                IpcErrorKind::Invalid,
                "expected Invalid for unpicked/bad path {bad:?}, got {err:?}"
            );
        }

        // Even if a non-.apkg file were picked, export_package rejects it.
        let wrong_ext = export_dir.join("collection.txt");
        let _ = picked.record_save_file(&wrong_ext);
        assert_eq!(
            export_package_checked(&collection, &media, &picked, &wrong_ext.to_string_lossy())
                .unwrap_err()
                .kind,
            IpcErrorKind::Invalid
        );

        // User-picked .apkg outside data_dir succeeds.
        let recorded = picked.record_save_file(&unpicked_abs).unwrap();
        let count =
            export_package_checked(&collection, &media, &picked, &recorded.to_string_lossy())
                .unwrap();
        assert_eq!(count, 0);
        assert!(recorded.is_file());

        let _ = std::fs::remove_dir_all(&root);
    }
}
