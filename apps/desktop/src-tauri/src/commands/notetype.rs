//! Note-type editor commands: CRUD for note types, fields, and templates;
//! template preview rendered via `bibalak-render`.

use bibalak_core::ipc::{
    FieldOptions, FieldRemoveWarning, IpcError, NotetypeDetail, RenderedPreview,
};
use bibalak_core::notetype_preset::{NotetypePreset, TemplateLintHint};
use bibalak_render::{RenderRequest, Template};
use tauri::AppHandle;

use super::with_collection;

type IpcResult<T> = Result<T, IpcError>;

#[tauri::command]
pub async fn get_notetype(app: AppHandle, notetype_id: i64) -> IpcResult<Option<NotetypeDetail>> {
    with_collection(app, move |collection| {
        Ok(collection.get_notetype_detail(notetype_id)?)
    })
    .await
}

#[tauri::command]
pub async fn create_notetype(app: AppHandle, name: String, kind: i64) -> IpcResult<NotetypeDetail> {
    with_collection(app, move |collection| {
        Ok(collection.create_notetype(&name, kind)?)
    })
    .await
}

#[tauri::command]
pub async fn delete_notetype(app: AppHandle, notetype_id: i64) -> IpcResult<()> {
    with_collection(app, move |collection| {
        Ok(collection.delete_notetype(notetype_id)?)
    })
    .await
}

#[tauri::command]
pub async fn rename_notetype(app: AppHandle, notetype_id: i64, name: String) -> IpcResult<()> {
    with_collection(app, move |collection| {
        Ok(collection.rename_notetype(notetype_id, &name)?)
    })
    .await
}

#[tauri::command]
pub async fn list_stock_notetypes(app: AppHandle) -> IpcResult<Vec<String>> {
    with_collection(app, |collection| {
        Ok(collection
            .stock_notetype_names()
            .into_iter()
            .map(str::to_string)
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn add_stock_notetype(app: AppHandle, index: usize) -> IpcResult<NotetypeDetail> {
    with_collection(app, move |collection| {
        Ok(collection.add_stock_notetype(index)?)
    })
    .await
}

#[tauri::command]
pub async fn save_notetype_css(app: AppHandle, notetype_id: i64, css: String) -> IpcResult<()> {
    with_collection(app, move |collection| {
        Ok(collection.save_notetype_css(notetype_id, &css)?)
    })
    .await
}

#[tauri::command]
pub async fn add_field(app: AppHandle, notetype_id: i64, name: String) -> IpcResult<()> {
    with_collection(app, move |collection| {
        Ok(collection.add_field(notetype_id, &name)?)
    })
    .await
}

#[tauri::command]
pub async fn check_field_remove(
    app: AppHandle,
    notetype_id: i64,
    ord: i64,
) -> IpcResult<FieldRemoveWarning> {
    with_collection(app, move |collection| {
        Ok(collection.check_field_remove(notetype_id, ord)?)
    })
    .await
}

#[tauri::command]
pub async fn remove_field(app: AppHandle, notetype_id: i64, ord: i64) -> IpcResult<()> {
    with_collection(app, move |collection| {
        Ok(collection.remove_field(notetype_id, ord)?)
    })
    .await
}

#[tauri::command]
pub async fn rename_field(
    app: AppHandle,
    notetype_id: i64,
    ord: i64,
    name: String,
) -> IpcResult<()> {
    with_collection(app, move |collection| {
        Ok(collection.rename_field(notetype_id, ord, &name)?)
    })
    .await
}

#[tauri::command]
pub async fn reorder_fields(
    app: AppHandle,
    notetype_id: i64,
    new_order: Vec<i64>,
) -> IpcResult<()> {
    with_collection(app, move |collection| {
        Ok(collection.reorder_fields(notetype_id, new_order)?)
    })
    .await
}

#[tauri::command]
pub async fn save_field_options(
    app: AppHandle,
    notetype_id: i64,
    ord: i64,
    options: FieldOptions,
) -> IpcResult<()> {
    with_collection(app, move |collection| {
        Ok(collection.save_field_options(notetype_id, ord, options)?)
    })
    .await
}

#[tauri::command]
pub async fn set_sort_field(app: AppHandle, notetype_id: i64, ord: i64) -> IpcResult<()> {
    with_collection(app, move |collection| {
        Ok(collection.set_sort_field(notetype_id, ord)?)
    })
    .await
}

#[tauri::command]
pub async fn duplicate_notetype(
    app: AppHandle,
    notetype_id: i64,
    copy_name_base: String,
) -> IpcResult<NotetypeDetail> {
    with_collection(app, move |collection| {
        Ok(collection.duplicate_notetype(notetype_id, &copy_name_base)?)
    })
    .await
}

#[tauri::command]
pub async fn add_template(
    app: AppHandle,
    notetype_id: i64,
    name: String,
    qfmt: String,
    afmt: String,
) -> IpcResult<()> {
    with_collection(app, move |collection| {
        Ok(collection.add_template(notetype_id, &name, &qfmt, &afmt)?)
    })
    .await
}

#[tauri::command]
pub async fn remove_template(app: AppHandle, notetype_id: i64, ord: i64) -> IpcResult<()> {
    with_collection(app, move |collection| {
        Ok(collection.remove_template(notetype_id, ord)?)
    })
    .await
}

#[tauri::command]
pub async fn save_template(
    app: AppHandle,
    notetype_id: i64,
    ord: i64,
    name: String,
    qfmt: String,
    afmt: String,
) -> IpcResult<()> {
    with_collection(app, move |collection| {
        Ok(collection.save_template(notetype_id, ord, &name, &qfmt, &afmt)?)
    })
    .await
}

#[tauri::command]
pub async fn check_template_remove(app: AppHandle, notetype_id: i64, ord: i64) -> IpcResult<u32> {
    with_collection(app, move |collection| {
        Ok(collection.check_template_remove(notetype_id, ord)?)
    })
    .await
}

/// Render a template preview using the provided sample field values.
/// `sample_fields` is one value per field in ord order; empty strings are fine.
#[tauri::command]
pub async fn preview_template(
    app: AppHandle,
    notetype_id: i64,
    template_ord: i64,
    sample_fields: Vec<String>,
    qfmt: Option<String>,
    afmt: Option<String>,
) -> IpcResult<RenderedPreview> {
    with_collection(app, move |collection| {
        use bibalak_core::error::CoreError;

        let detail = collection
            .get_notetype_detail(notetype_id)?
            .ok_or_else(|| CoreError::NotFound(format!("notetype {notetype_id}")))?;
        let tmpl = detail
            .templates
            .iter()
            .find(|t| t.ord == template_ord)
            .ok_or_else(|| CoreError::NotFound(format!("template {template_ord}")))?;
        let fields: Vec<(String, String)> = detail
            .fields
            .iter()
            .enumerate()
            .map(|(i, f)| {
                (
                    f.name.clone(),
                    sample_fields.get(i).cloned().unwrap_or_default(),
                )
            })
            .collect();
        let qfmt_effective = qfmt.as_deref().unwrap_or(&tmpl.qfmt);
        let afmt_effective = afmt.as_deref().unwrap_or(&tmpl.afmt);
        let rendered = bibalak_render::render(&RenderRequest {
            template: Template {
                qfmt: qfmt_effective,
                afmt: afmt_effective,
            },
            fields: &fields,
            card_ord: template_ord as u16,
            is_cloze: detail.kind == 1,
            notetype: &detail.name,
            card_name: &tmpl.name,
            deck: "Preview",
            subdeck: "Preview",
            ..RenderRequest::default()
        })
        .map_err(|e| IpcError {
            kind: bibalak_core::ipc::IpcErrorKind::Invalid,
            message: e.to_string(),
        })?;
        Ok(RenderedPreview {
            question: rendered.question,
            answer: rendered.answer,
        })
    })
    .await
}

#[tauri::command]
pub async fn save_notetype_preset(
    app: AppHandle,
    notetype_id: i64,
    preset: NotetypePreset,
    confirm_remove: Option<bool>,
) -> IpcResult<NotetypeDetail> {
    let confirm = confirm_remove.unwrap_or(false);
    with_collection(app, move |collection| {
        Ok(collection.save_notetype_preset(notetype_id, preset, confirm)?)
    })
    .await
}

#[tauri::command]
pub async fn lint_notetype(
    app: AppHandle,
    notetype_id: i64,
    qfmt: Option<String>,
    afmt: Option<String>,
    css: Option<String>,
) -> IpcResult<Vec<TemplateLintHint>> {
    with_collection(app, move |collection| {
        Ok(collection.lint_notetype(
            notetype_id,
            qfmt.as_deref(),
            afmt.as_deref(),
            css.as_deref(),
        )?)
    })
    .await
}
