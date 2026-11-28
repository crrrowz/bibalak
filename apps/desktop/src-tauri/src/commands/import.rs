//! Import commands. Parse a package with `bibalak-ankifmt`, then merge it into
//! the open collection. Media is extracted through [`crate::MediaState`].

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use bibalak_core::ipc::{
    ImportProgress, ImportStage, IpcError, TextImportMapping, TextImportOptions, TextImportPreview,
    TextImportSummary,
};
use bibalak_core::{Collection, CoreError, ImportSummary};
use tauri::{AppHandle, Emitter, Manager};

use super::{run_blocking, state_err, CancelRegistry};
use crate::paths_guard::PickedPathsState;
use crate::MediaState;

/// Managed Tauri state tracking in-flight import cancellation flags.
#[derive(Default)]
pub struct ImportJobsState(pub(crate) CancelRegistry);

#[tauri::command]
pub async fn import_package(
    app: AppHandle,
    path: String,
    import_id: Option<String>,
) -> Result<ImportSummary, IpcError> {
    if let Some(ref id) = import_id {
        super::validate_job_id(id)?;
    }
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
            .try_state::<ImportJobsState>()
            .ok_or_else(|| state_err("ImportJobsState"))?;

        let _reg = import_id
            .as_deref()
            .map(|id| jobs.0.register(id))
            .transpose()?;
        let fallback_cancel = Arc::new(AtomicBool::new(false));
        let cancel = _reg.as_ref().map(|r| &r.flag).unwrap_or(&fallback_cancel);

        let checked = picked.verify_open_file(&path, &["apkg", "colpkg"])?;
        let (model, media_stats) = bibalak_ankifmt::read_package_with_progress_stats(
            &checked,
            Some(&*media.0),
            cancel,
            &mut |stage, done, total| {
                let _ = app.emit(
                    "bibalak://import-progress",
                    ImportProgress { stage, done, total },
                );
            },
        )?;
        if media_stats.renamed > 0 || media_stats.skipped > 0 {
            tracing::info!(
                imported = media_stats.imported,
                renamed = media_stats.renamed,
                skipped = media_stats.skipped,
                "package import normalized/skipped media filenames"
            );
        }

        if cancel.load(Ordering::Relaxed) {
            return Err(CoreError::Cancelled.into());
        }

        let mut on_progress = |done: u32, total: u32| {
            let _ = app.emit(
                "bibalak://import-progress",
                ImportProgress {
                    stage: ImportStage::Merging,
                    done,
                    total,
                },
            );
        };
        let mut summary = collection.import_with_progress(&model, &mut on_progress)?;
        summary.media_imported = media_stats.imported;
        Ok(summary)
    })
    .await
}

/// Request cancellation of an in-flight import job before the database merge starts.
#[tauri::command]
pub async fn cancel_import(app: AppHandle, import_id: String) -> Result<bool, IpcError> {
    let jobs = app
        .try_state::<ImportJobsState>()
        .ok_or_else(|| state_err("ImportJobsState"))?;
    jobs.0.cancel(&import_id)
}

#[tauri::command]
pub async fn preview_text_import(
    app: AppHandle,
    path: String,
    options: TextImportOptions,
) -> Result<TextImportPreview, IpcError> {
    run_blocking(move || {
        let picked = app
            .try_state::<PickedPathsState>()
            .ok_or_else(|| state_err("PickedPathsState"))?;
        let checked = picked.verify_open_file(&path, &[])?;
        Ok(bibalak_ankifmt::text_import::preview_text_import(
            &checked, &options,
        )?)
    })
    .await
}

#[tauri::command]
pub async fn import_text(
    app: AppHandle,
    path: String,
    mapping: TextImportMapping,
) -> Result<TextImportSummary, IpcError> {
    run_blocking(move || {
        let collection = app
            .try_state::<Collection>()
            .ok_or_else(|| state_err("Collection"))?;
        let picked = app
            .try_state::<PickedPathsState>()
            .ok_or_else(|| state_err("PickedPathsState"))?;
        let checked = picked.verify_open_file(&path, &[])?;
        let nt = collection
            .get_notetype_detail(mapping.notetype_id)?
            .ok_or_else(|| CoreError::NotFound(format!("notetype {}", mapping.notetype_id)))?;
        let (rows, mut parse_errors) =
            bibalak_ankifmt::text_import::parse_text_import(&checked, nt.fields.len(), &mapping)?;
        let mut summary = collection.import_text_notes(
            mapping.deck_id,
            mapping.notetype_id,
            mapping.duplicate_policy,
            &rows,
        )?;
        if !parse_errors.is_empty() {
            parse_errors.append(&mut summary.errors);
            parse_errors.sort_by_key(|e| e.line);
            summary.errors = parse_errors;
        }
        Ok(summary)
    })
    .await
}
