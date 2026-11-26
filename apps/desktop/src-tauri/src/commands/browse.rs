//! Card/note browser commands: list, fetch, save notes; Anki-query card search; bulk ops.

use bibalak_core::ipc::{
    AddNoteResult, CardRow, DuplicateGroup, FindReplacePreview, IpcError, IpcErrorKind, NoteDetail,
    NoteOverview, NoteRow, NotetypeSummary,
};
use bibalak_core::Collection;
use tauri::{AppHandle, Manager};

use super::{run_blocking, state_err, with_collection};
use crate::SearchState;

type IpcResult<T> = Result<T, IpcError>;

#[tauri::command]
pub async fn list_notes(app: AppHandle, query: Option<String>) -> IpcResult<Vec<NoteOverview>> {
    with_collection(app, move |collection| {
        Ok(collection.list_notes(query.as_deref())?)
    })
    .await
}

#[tauri::command]
pub async fn get_note(app: AppHandle, note_id: i64) -> IpcResult<Option<NoteDetail>> {
    with_collection(app, move |collection| Ok(collection.note_detail(note_id)?)).await
}

#[tauri::command]
pub async fn save_note(
    app: AppHandle,
    note_id: i64,
    fields: Vec<String>,
    tags: Vec<String>,
) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection.update_note(note_id, &fields, &tags)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn list_notetypes(app: AppHandle) -> IpcResult<Vec<NotetypeSummary>> {
    with_collection(app, |collection| Ok(collection.list_notetypes()?)).await
}

#[tauri::command]
pub async fn add_note(
    app: AppHandle,
    notetype_id: i64,
    deck_id: i64,
    fields: Vec<String>,
    tags: Vec<String>,
) -> IpcResult<AddNoteResult> {
    with_collection(app, move |collection| {
        Ok(collection.add_note(notetype_id, deck_id, &fields, &tags)?)
    })
    .await
}

const MAX_BATCH_IDS: usize = 100_000;
const MAX_ADD_NOTES_BATCH: usize = 10_000;

fn check_batch_len(len: usize, max: usize, label: &str) -> IpcResult<()> {
    if len > max {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: format!("{label} exceeds maximum batch size of {max}"),
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn add_notes_batch(
    app: AppHandle,
    notetype_id: i64,
    deck_id: i64,
    notes: Vec<bibalak_core::ipc::BatchNoteInput>,
) -> IpcResult<bibalak_core::ipc::AddNotesBatchResult> {
    check_batch_len(notes.len(), MAX_ADD_NOTES_BATCH, "notes")?;
    with_collection(app, move |collection| {
        Ok(collection.add_notes_batch(notetype_id, deck_id, &notes)?)
    })
    .await
}

#[tauri::command]
pub async fn check_duplicate(
    app: AppHandle,
    notetype_id: i64,
    first_field: String,
) -> IpcResult<Option<i64>> {
    with_collection(app, move |collection| {
        Ok(collection.check_duplicate(notetype_id, &first_field)?)
    })
    .await
}

/// Full-text + faceted Tantivy search. Falls back to SQL LIKE when query is
/// empty or index is unavailable.
#[tauri::command]
pub async fn search_notes(app: AppHandle, query: String) -> IpcResult<Vec<NoteOverview>> {
    run_blocking(move || {
        let collection = app
            .try_state::<Collection>()
            .ok_or_else(|| state_err("Collection"))?;
        let q = query.trim();
        if q.is_empty() {
            return Ok(collection.list_notes(None)?);
        }
        let search = app
            .try_state::<SearchState>()
            .ok_or_else(|| state_err("SearchState"))?;
        let ids = search
            .0
            .lock()
            .map_err(|_| IpcError {
                kind: IpcErrorKind::Internal,
                message: "search lock poisoned".into(),
            })?
            .search(q, 500)
            .map_err(|e| IpcError {
                kind: IpcErrorKind::Internal,
                message: e.to_string(),
            })?;
        Ok(collection.notes_by_ids(&ids)?)
    })
    .await
}

/// Maximum cards returned per page from `search_cards` / `search_note_rows`.
const BROWSE_PAGE_SIZE: i64 = 500;

fn resolve_page_limit(limit: Option<i64>) -> IpcResult<i64> {
    let val = limit.unwrap_or(BROWSE_PAGE_SIZE);
    if !(1..=BROWSE_PAGE_SIZE).contains(&val) {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: format!("limit must be between 1 and {BROWSE_PAGE_SIZE}"),
        });
    }
    Ok(val)
}

/// Anki-flavoured card search: supports is:/flag:/deck:/tag:/prop:/-/or.
/// Returns one page (up to `limit`, max `BROWSE_PAGE_SIZE` rows) of card rows
/// starting at `offset`, for the browser table.
#[tauri::command]
pub async fn search_cards(
    app: AppHandle,
    query: String,
    offset: i64,
    limit: Option<i64>,
    sort_key: Option<String>,
    sort_asc: Option<bool>,
) -> IpcResult<Vec<CardRow>> {
    if offset < 0 {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: "offset cannot be negative".into(),
        });
    }
    let page_limit = resolve_page_limit(limit)?;
    with_collection(app, move |collection| {
        Ok(collection.search_cards(
            query.trim(),
            page_limit,
            offset,
            sort_key.as_deref(),
            sort_asc.unwrap_or(true),
        )?)
    })
    .await
}

/// Total matching cards for `query` (for Browse pagination footer).
#[tauri::command]
pub async fn count_cards(app: AppHandle, query: String) -> IpcResult<u32> {
    with_collection(app, move |collection| {
        Ok(collection.count_cards(query.trim())?)
    })
    .await
}

/// Delete notes (and their cards) by note id list.
#[tauri::command]
pub async fn delete_notes(app: AppHandle, note_ids: Vec<i64>) -> IpcResult<()> {
    check_batch_len(note_ids.len(), MAX_BATCH_IDS, "note_ids")?;
    with_collection(app, move |collection| {
        collection.delete_notes(&note_ids)?;
        Ok(())
    })
    .await
}

/// Reassign cards to a different deck.
#[tauri::command]
pub async fn move_cards_to_deck(app: AppHandle, card_ids: Vec<i64>, deck_id: i64) -> IpcResult<()> {
    check_batch_len(card_ids.len(), MAX_BATCH_IDS, "card_ids")?;
    with_collection(app, move |collection| {
        collection.move_cards_to_deck(&card_ids, deck_id)?;
        Ok(())
    })
    .await
}

/// Add a tag to multiple notes (bulk).
#[tauri::command]
pub async fn bulk_add_tag(app: AppHandle, note_ids: Vec<i64>, tag: String) -> IpcResult<()> {
    check_batch_len(note_ids.len(), MAX_BATCH_IDS, "note_ids")?;
    let tag = tag.trim().to_string();
    if tag.is_empty() || tag.contains(' ') {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: "tag must be non-empty and contain no spaces".into(),
        });
    }
    with_collection(app, move |collection| {
        collection.bulk_add_tag(&note_ids, &tag)?;
        Ok(())
    })
    .await
}

/// Remove a tag from multiple notes (bulk).
#[tauri::command]
pub async fn bulk_remove_tag(app: AppHandle, note_ids: Vec<i64>, tag: String) -> IpcResult<()> {
    check_batch_len(note_ids.len(), MAX_BATCH_IDS, "note_ids")?;
    let tag = tag.trim().to_string();
    if tag.is_empty() || tag.contains(' ') {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: "tag must be non-empty and contain no spaces".into(),
        });
    }
    with_collection(app, move |collection| {
        collection.bulk_remove_tag(&note_ids, &tag)?;
        Ok(())
    })
    .await
}

/// Anki-flavoured search grouped one row per note (`Notes` browse mode).
#[tauri::command]
pub async fn search_note_rows(
    app: AppHandle,
    query: String,
    offset: i64,
    limit: Option<i64>,
    sort_key: Option<String>,
    sort_asc: Option<bool>,
) -> IpcResult<Vec<NoteRow>> {
    if offset < 0 {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: "offset cannot be negative".into(),
        });
    }
    let page_limit = resolve_page_limit(limit)?;
    with_collection(app, move |collection| {
        Ok(collection.search_note_rows(
            query.trim(),
            page_limit,
            offset,
            sort_key.as_deref(),
            sort_asc.unwrap_or(true),
        )?)
    })
    .await
}

/// Total matching notes for `query` (for Browse Notes-mode pagination footer).
#[tauri::command]
pub async fn count_note_rows(app: AppHandle, query: String) -> IpcResult<u32> {
    with_collection(app, move |collection| {
        Ok(collection.count_note_rows(query.trim())?)
    })
    .await
}

/// Preview match counts for Find & Replace across selected notes.
#[tauri::command]
pub async fn preview_find_replace(
    app: AppHandle,
    note_ids: Vec<i64>,
    field_name: Option<String>,
    find: String,
    use_regex: bool,
    case_sensitive: bool,
) -> IpcResult<FindReplacePreview> {
    check_batch_len(note_ids.len(), MAX_BATCH_IDS, "note_ids")?;
    with_collection(app, move |collection| {
        Ok(collection.preview_find_replace(
            &note_ids,
            field_name.as_deref(),
            &find,
            use_regex,
            case_sensitive,
        )?)
    })
    .await
}

/// Apply Find & Replace across selected notes inside one transaction.
#[tauri::command]
pub async fn find_replace_notes(
    app: AppHandle,
    note_ids: Vec<i64>,
    field_name: Option<String>,
    find: String,
    replace: String,
    use_regex: bool,
    case_sensitive: bool,
) -> IpcResult<u32> {
    check_batch_len(note_ids.len(), MAX_BATCH_IDS, "note_ids")?;
    with_collection(app, move |collection| {
        Ok(collection.find_replace_notes(
            &note_ids,
            field_name.as_deref(),
            &find,
            &replace,
            use_regex,
            case_sensitive,
        )?)
    })
    .await
}

/// Find groups of notes of `notetype_id` sharing normalized text in `field_ord`.
#[tauri::command]
pub async fn find_duplicates(
    app: AppHandle,
    notetype_id: i64,
    field_ord: i64,
) -> IpcResult<Vec<DuplicateGroup>> {
    with_collection(app, move |collection| {
        Ok(collection.find_duplicates(notetype_id, field_ord)?)
    })
    .await
}

/// Convert selected notes (all of one note type) to `target_notetype_id`, remapping
/// fields and card templates in a single transaction.
#[tauri::command]
pub async fn change_note_type(
    app: AppHandle,
    note_ids: Vec<i64>,
    target_notetype_id: i64,
    field_map: Vec<Option<usize>>,
    template_map: Vec<(i64, Option<i64>)>,
) -> IpcResult<u32> {
    check_batch_len(note_ids.len(), MAX_BATCH_IDS, "note_ids")?;
    with_collection(app, move |collection| {
        Ok(
            collection.change_note_type(
                &note_ids,
                target_notetype_id,
                &field_map,
                &template_map,
            )?,
        )
    })
    .await
}
