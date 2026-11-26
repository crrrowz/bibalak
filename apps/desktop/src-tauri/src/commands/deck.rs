//! Deck commands. Delegate to the managed [`Collection`]; `?` converts
//! `CoreError` into the serialisable [`IpcError`] union returned to the UI.

use bibalak_core::ipc::{
    CollectionPrefs, DeckConfig, DeckSummary, IpcError, IpcErrorKind, UndoAction,
};
use tauri::AppHandle;

use super::with_collection;

type IpcResult<T> = Result<T, IpcError>;

#[tauri::command]
pub async fn list_decks(app: AppHandle) -> IpcResult<Vec<DeckSummary>> {
    with_collection(app, |collection| {
        Ok(collection
            .list_decks_with_counts()?
            .into_iter()
            .map(|(deck, counts)| DeckSummary::with_counts(deck, counts))
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn create_deck(app: AppHandle, name: String) -> IpcResult<DeckSummary> {
    with_collection(app, move |collection| {
        Ok(collection.create_deck(&name)?.into())
    })
    .await
}

#[tauri::command]
pub async fn rename_deck(app: AppHandle, id: i64, name: String) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection.rename_deck(id, &name)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn delete_deck(app: AppHandle, id: i64) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection.remove_deck(id)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn undo(app: AppHandle) -> IpcResult<Option<UndoAction>> {
    with_collection(app, |collection| Ok(collection.undo()?)).await
}

#[tauri::command]
pub async fn undo_status(app: AppHandle) -> IpcResult<Option<UndoAction>> {
    with_collection(app, |collection| Ok(collection.undo_status())).await
}

#[tauri::command]
pub async fn get_deck_config(app: AppHandle, deck_id: i64) -> IpcResult<DeckConfig> {
    with_collection(app, move |collection| {
        Ok(collection.get_deck_config(deck_id)?)
    })
    .await
}

#[tauri::command]
pub async fn set_deck_config(app: AppHandle, config: DeckConfig) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection.set_deck_config(&config)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_collection_prefs(app: AppHandle) -> IpcResult<CollectionPrefs> {
    with_collection(app, |collection| Ok(collection.get_collection_prefs()?)).await
}

#[tauri::command]
pub async fn set_collection_prefs(app: AppHandle, prefs: CollectionPrefs) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection.set_collection_prefs(&prefs)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn set_local_offset(app: AppHandle, minutes: i32) -> IpcResult<()> {
    if !(-1440..=1440).contains(&minutes) {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: format!("timezone offset {minutes} minutes out of range -1440..=1440"),
        });
    }
    with_collection(app, move |collection| {
        collection.set_local_offset_minutes(minutes);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn set_deck_collapsed(app: AppHandle, deck_id: i64, collapsed: bool) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection.set_deck_collapsed(deck_id, collapsed)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_today_extra_new(app: AppHandle, deck_id: i64) -> IpcResult<u32> {
    with_collection(app, move |collection| {
        Ok(collection.get_today_extra_new(deck_id)?)
    })
    .await
}

#[tauri::command]
pub async fn increase_today_limit(app: AppHandle, deck_id: i64, extra_new: u32) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection.increase_today_new_limit(deck_id, extra_new)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn deck_card_ids(
    app: AppHandle,
    deck_id: i64,
    include_subdecks: bool,
) -> IpcResult<Vec<i64>> {
    with_collection(app, move |collection| {
        Ok(collection.deck_card_ids(deck_id, include_subdecks)?)
    })
    .await
}
