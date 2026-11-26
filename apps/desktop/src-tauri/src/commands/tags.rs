use bibalak_core::ipc::{DeckSummary, FilteredDeckConfig, IpcError, TagCount};
use tauri::AppHandle;

use super::with_collection;

type IpcResult<T> = Result<T, IpcError>;

#[tauri::command]
pub async fn list_tags(app: AppHandle) -> IpcResult<Vec<String>> {
    with_collection(app, |collection| Ok(collection.list_tags()?)).await
}

#[tauri::command]
pub async fn list_tag_counts(app: AppHandle) -> IpcResult<Vec<TagCount>> {
    with_collection(app, |collection| Ok(collection.list_tag_counts()?)).await
}

#[tauri::command]
pub async fn rename_tag(app: AppHandle, old_tag: String, new_tag: String) -> IpcResult<u32> {
    with_collection(app, move |collection| {
        Ok(collection.rename_tag(&old_tag, &new_tag)?)
    })
    .await
}

#[tauri::command]
pub async fn delete_tag(app: AppHandle, tag: String) -> IpcResult<u32> {
    with_collection(app, move |collection| Ok(collection.delete_tag(&tag)?)).await
}

#[tauri::command]
pub async fn merge_tags(app: AppHandle, sources: Vec<String>, target: String) -> IpcResult<()> {
    with_collection(app, move |collection| {
        Ok(collection.merge_tags(sources, &target)?)
    })
    .await
}

#[tauri::command]
pub async fn create_filtered_deck(
    app: AppHandle,
    name: String,
    search: String,
    order: u8,
    limit: u32,
) -> IpcResult<DeckSummary> {
    with_collection(app, move |collection| {
        Ok(collection.create_filtered_deck(&name, &search, order, limit)?)
    })
    .await
}

#[tauri::command]
pub async fn rebuild_filtered(app: AppHandle, deck_id: i64) -> IpcResult<u32> {
    with_collection(app, move |collection| {
        Ok(collection.rebuild_filtered(deck_id)?)
    })
    .await
}

#[tauri::command]
pub async fn empty_filtered(app: AppHandle, deck_id: i64) -> IpcResult<()> {
    with_collection(app, move |collection| {
        Ok(collection.empty_filtered(deck_id)?)
    })
    .await
}

#[tauri::command]
pub async fn get_filtered_config(
    app: AppHandle,
    deck_id: i64,
) -> IpcResult<Option<FilteredDeckConfig>> {
    with_collection(app, move |collection| {
        Ok(collection.get_filtered_config(deck_id)?)
    })
    .await
}
