//! Card lifecycle IPC commands: suspend, bury, flag.

use bibalak_core::ipc::{IpcError, IpcErrorKind};
use tauri::AppHandle;

use super::with_collection;

type IpcResult<T> = Result<T, IpcError>;

const MAX_CARD_IDS_BATCH: usize = 100_000;

fn check_card_ids(card_ids: &[i64]) -> IpcResult<()> {
    if card_ids.len() > MAX_CARD_IDS_BATCH {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: format!("card_ids exceeds maximum batch size of {MAX_CARD_IDS_BATCH}"),
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn suspend_cards(app: AppHandle, card_ids: Vec<i64>) -> IpcResult<()> {
    check_card_ids(&card_ids)?;
    with_collection(app, move |collection| {
        collection.suspend_cards(&card_ids).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn unsuspend_cards(app: AppHandle, card_ids: Vec<i64>) -> IpcResult<()> {
    check_card_ids(&card_ids)?;
    with_collection(app, move |collection| {
        collection
            .unsuspend_cards(&card_ids)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn bury_cards(app: AppHandle, card_ids: Vec<i64>) -> IpcResult<()> {
    check_card_ids(&card_ids)?;
    with_collection(app, move |collection| {
        collection.bury_cards(&card_ids).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn unbury_cards(app: AppHandle, card_ids: Vec<i64>) -> IpcResult<()> {
    check_card_ids(&card_ids)?;
    with_collection(app, move |collection| {
        collection.unbury_cards(&card_ids).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn set_card_flag(app: AppHandle, card_ids: Vec<i64>, flag: u8) -> IpcResult<()> {
    check_card_ids(&card_ids)?;
    if flag > 7 {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: format!("flag {flag} out of range 0–7"),
        });
    }
    with_collection(app, move |collection| {
        collection
            .set_card_flag(&card_ids, flag)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn forget_cards(app: AppHandle, card_ids: Vec<i64>, reset_counts: bool) -> IpcResult<()> {
    check_card_ids(&card_ids)?;
    with_collection(app, move |collection| {
        collection
            .forget_cards(&card_ids, reset_counts)
            .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn set_due_date(app: AppHandle, card_ids: Vec<i64>, spec: String) -> IpcResult<()> {
    check_card_ids(&card_ids)?;
    with_collection(app, move |collection| {
        collection
            .set_due_date(&card_ids, &spec)
            .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn reposition_new_cards(
    app: AppHandle,
    card_ids: Vec<i64>,
    start: i64,
    step: i64,
    shuffle: bool,
    shift_existing: bool,
) -> IpcResult<()> {
    check_card_ids(&card_ids)?;
    with_collection(app, move |collection| {
        collection
            .reposition_new_cards(&card_ids, start, step, shuffle, shift_existing)
            .map_err(Into::into)
    })
    .await
}
