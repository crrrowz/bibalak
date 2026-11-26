//! Export commands: scoped estimate, streaming `.apkg` export with progress, and cancel.

use std::sync::atomic::AtomicBool;

use bibalak_ankifmt::ExportProgressUpdate;
use bibalak_core::ipc::{
    ExportEstimate, ExportPackageRequest, ExportProgress, ExportScope, ExportStage, ExportSummary,
    IpcError,
};
use bibalak_core::{Collection, MediaStore};
use tauri::{AppHandle, Emitter, Manager};

use super::{run_blocking, state_err, with_collection, CancelRegistry};
use crate::paths_guard::PickedPathsState;
use crate::MediaState;

type IpcResult<T> = Result<T, IpcError>;

/// Managed Tauri state tracking in-flight export cancellation flags.
#[derive(Default)]
pub struct ExportJobsState(pub(crate) CancelRegistry);

#[tauri::command]
pub async fn get_export_estimate(
    app: AppHandle,
    scope: ExportScope,
    include_media: bool,
) -> IpcResult<ExportEstimate> {
    let media = app
        .try_state::<MediaState>()
        .ok_or_else(|| state_err("MediaState"))?;
    let media_store = media.0.clone();
    with_collection(app, move |collection| {
        Ok(collection.estimate_export(&scope, include_media, media_store.as_ref())?)
    })
    .await
}

pub(crate) fn export_package_checked(
    collection: &Collection,
    media: &dyn MediaStore,
    picked: &PickedPathsState,
    request: &ExportPackageRequest,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(ExportProgress),
) -> IpcResult<ExportSummary> {
    super::validate_job_id(&request.export_id)?;
    let dest = picked.verify_save_file(&request.path, &["apkg"])?;

    on_progress(ExportProgress {
        export_id: request.export_id.clone(),
        stage: ExportStage::Preparing,
        notes_done: 0,
        notes_total: 0,
        cards_done: 0,
        cards_total: 0,
        media_done: 0,
        media_total: 0,
        bytes_done: 0,
        bytes_total: 0,
    });

    let prepared = collection.prepare_export(
        &request.scope,
        request.include_media,
        request.include_scheduling,
        media,
    )?;

    let notes_exported = prepared.model.notes.len() as u32;
    let cards_exported = prepared.model.cards.len() as u32;
    let media_skipped_missing = prepared.media_skipped_missing;

    let mut forward = |u: ExportProgressUpdate| {
        on_progress(ExportProgress {
            export_id: request.export_id.clone(),
            stage: u.stage,
            notes_done: u.notes_done,
            notes_total: u.notes_total,
            cards_done: u.cards_done,
            cards_total: u.cards_total,
            media_done: u.media_done,
            media_total: u.media_total,
            bytes_done: u.bytes_done,
            bytes_total: u.bytes_total,
        });
    };

    let outcome = bibalak_ankifmt::write_apkg_streaming(
        &prepared.model,
        &dest,
        Some(media),
        &prepared.media_files,
        cancel,
        &mut forward,
    )?;

    Ok(ExportSummary {
        notes_exported,
        cards_exported,
        media_exported: outcome.media_exported,
        media_skipped_missing,
        bytes_written: outcome.bytes_written,
    })
}

/// Stream a scoped collection or deck export as an `.apkg` file.
#[tauri::command]
pub async fn export_package(
    app: AppHandle,
    request: ExportPackageRequest,
) -> IpcResult<ExportSummary> {
    super::validate_job_id(&request.export_id)?;
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
        let jobs = app
            .try_state::<ExportJobsState>()
            .ok_or_else(|| state_err("ExportJobsState"))?;
        let registration = jobs.0.register(&request.export_id)?;
        let mut emit = |progress: ExportProgress| {
            let _ = app.emit("bibalak://export-progress", progress);
        };
        export_package_checked(
            &collection,
            media.0.as_ref(),
            &picked,
            &request,
            &registration.flag,
            &mut emit,
        )
    })
    .await
}

/// Request cancellation of an in-flight export job by `export_id`.
#[tauri::command]
pub async fn cancel_export(app: AppHandle, export_id: String) -> IpcResult<bool> {
    let jobs = app
        .try_state::<ExportJobsState>()
        .ok_or_else(|| state_err("ExportJobsState"))?;
    jobs.0.cancel(&export_id)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::atomic::Ordering;
    use std::sync::Arc;

    use bibalak_core::ipc::IpcErrorKind;
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

    fn make_req(export_id: &str, path: &str, scope: ExportScope) -> ExportPackageRequest {
        ExportPackageRequest {
            export_id: export_id.into(),
            path: path.into(),
            scope,
            include_media: true,
            include_scheduling: false,
        }
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
        let cancel = AtomicBool::new(false);

        let unpicked_abs = export_dir.join("collection.apkg");
        for bad in [
            "collection.apkg",
            "../collection.apkg",
            "\\\\server\\share\\collection.apkg",
            "C:\\evil\\collection.apkg",
            &unpicked_abs.to_string_lossy(),
            &data_dir.join("collection.apkg").to_string_lossy(),
        ] {
            let req = make_req("exp-1", bad, ExportScope::Collection);
            let err =
                export_package_checked(&collection, &media, &picked, &req, &cancel, &mut |_| {})
                    .unwrap_err();
            assert_eq!(
                err.kind,
                IpcErrorKind::Invalid,
                "expected Invalid for unpicked/bad path {bad:?}, got {err:?}"
            );
        }

        // Reject invalid export_id.
        let recorded = picked.record_save_file(&unpicked_abs).unwrap();
        for bad_id in ["", "bad id", "bad\nid", &"x".repeat(65)] {
            let req = make_req(bad_id, &recorded.to_string_lossy(), ExportScope::Collection);
            let err =
                export_package_checked(&collection, &media, &picked, &req, &cancel, &mut |_| {})
                    .unwrap_err();
            assert_eq!(err.kind, IpcErrorKind::Invalid);
        }

        // Even if a non-.apkg file were picked, export_package rejects it.
        let wrong_ext = export_dir.join("collection.txt");
        let _ = picked.record_save_file(&wrong_ext);
        let bad_ext_req = make_req(
            "exp-2",
            &wrong_ext.to_string_lossy(),
            ExportScope::Collection,
        );
        assert_eq!(
            export_package_checked(
                &collection,
                &media,
                &picked,
                &bad_ext_req,
                &cancel,
                &mut |_| {}
            )
            .unwrap_err()
            .kind,
            IpcErrorKind::Invalid
        );

        // User-picked .apkg outside data_dir succeeds.
        let ok_req = make_req(
            "exp-3",
            &recorded.to_string_lossy(),
            ExportScope::Collection,
        );
        let mut stages = Vec::new();
        let summary =
            export_package_checked(&collection, &media, &picked, &ok_req, &cancel, &mut |p| {
                stages.push(p.stage)
            })
            .unwrap();
        assert_eq!(summary.media_exported, 0);
        assert!(summary.bytes_written > 0);
        assert!(recorded.is_file());
        assert!(stages.contains(&ExportStage::Preparing));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn cancel_registry_sets_flag_and_unregisters_on_drop() {
        let reg = ExportJobsState::default();
        assert!(!reg.0.cancel("missing").unwrap());
        {
            let entry = reg.0.register("job-1").unwrap();
            assert!(!entry.flag.load(Ordering::Relaxed));
            assert!(reg.0.register("job-1").is_err());
            assert!(reg.0.cancel("job-1").unwrap());
            assert!(entry.flag.load(Ordering::Relaxed));
        }
        assert!(!reg.0.cancel("job-1").unwrap());
    }
}
