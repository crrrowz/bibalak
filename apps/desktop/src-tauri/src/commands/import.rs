//! Import commands. Parse a package with `bibalak-ankifmt`, then merge it into
//! the open collection. Media is extracted through [`crate::MediaState`].

use bibalak_core::ipc::{
    ImportProgress, IpcError, TextImportMapping, TextImportOptions, TextImportPreview,
    TextImportSummary,
};
use bibalak_core::{Collection, CoreError, ImportSummary};
use tauri::{AppHandle, Emitter, Manager};

use super::{run_blocking, state_err};
use crate::paths_guard::PickedPathsState;
use crate::MediaState;

#[tauri::command]
pub async fn import_package(app: AppHandle, path: String) -> Result<ImportSummary, IpcError> {
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
        let checked = picked.verify_open_file(&path, &["apkg", "colpkg"])?;
        let (model, media_imported) =
            bibalak_ankifmt::read_package_with_media(&checked, Some(&*media.0))?;
        let mut on_progress = |done: u32, total: u32| {
            let _ = app.emit("bibalak://import-progress", ImportProgress { done, total });
        };
        let mut summary = collection.import_with_progress(&model, &mut on_progress)?;
        summary.media_imported = media_imported;
        Ok(summary)
    })
    .await
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
