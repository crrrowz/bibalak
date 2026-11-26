//! Thin Tauri IPC wrappers for the AI assistant (`bibalak-ai`).

use std::path::PathBuf;
use std::sync::Arc;

use bibalak_ai::{load_ai_config, preview_ai_action, run_ai_action, save_ai_config, SecretStore};
use bibalak_core::ai::{
    build_coach_input, split_text_for_generation, AIActionRequest, AIActionResult, AIConfig,
    AIPreviewPayload, AISaveConfigInput, CoachInput, DEFAULT_CHUNK_MAX_CHARS,
};
use bibalak_core::ipc::{
    ApplyQualityFixesResult, IpcError, IpcErrorKind, QualityNoteEdit, QualityScanNote,
};
use tauri::{AppHandle, Manager, State};

use super::{run_blocking, state_err, with_collection};

/// Managed Tauri state holding portable-aware `data_dir` and the OS keyring secret store.
pub struct AIState {
    pub data_dir: PathBuf,
    pub secrets: Arc<dyn SecretStore>,
}

impl AIState {
    pub fn new(data_dir: PathBuf, secrets: Arc<dyn SecretStore>) -> Self {
        Self { data_dir, secrets }
    }
}

#[tauri::command]
pub async fn ai_get_config(app: AppHandle) -> Result<AIConfig, IpcError> {
    run_blocking(move || {
        let state = app
            .try_state::<AIState>()
            .ok_or_else(|| state_err("AIState"))?;
        Ok(load_ai_config(&state.data_dir, state.secrets.as_ref()))
    })
    .await
}

#[tauri::command]
pub async fn ai_set_config(
    app: AppHandle,
    config: AISaveConfigInput,
) -> Result<AIConfig, IpcError> {
    run_blocking(move || {
        let state = app
            .try_state::<AIState>()
            .ok_or_else(|| state_err("AIState"))?;
        save_ai_config(&state.data_dir, state.secrets.as_ref(), config).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn ai_preview_action(
    app: AppHandle,
    action: AIActionRequest,
    app_locale: Option<String>,
) -> Result<AIPreviewPayload, IpcError> {
    run_blocking(move || {
        let state = app
            .try_state::<AIState>()
            .ok_or_else(|| state_err("AIState"))?;
        preview_ai_action(&state.data_dir, &action, app_locale.as_deref()).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn ai_run_action(
    action: AIActionRequest,
    app_locale: Option<String>,
    state: State<'_, AIState>,
) -> Result<AIActionResult, IpcError> {
    let data_dir = state.data_dir.clone();
    let secrets = Arc::clone(&state.secrets);
    tauri::async_runtime::spawn_blocking(move || {
        run_ai_action(&data_dir, secrets.as_ref(), &action, app_locale.as_deref())
    })
    .await
    .map_err(|e| IpcError {
        kind: IpcErrorKind::Internal,
        message: format!("AI task failed: {e}"),
    })?
    .map_err(IpcError::from)
}

/// Pure helper splitting pasted source text into bounded parts before generating cards.
#[tauri::command]
pub fn ai_split_text(text: String) -> Result<Vec<String>, IpcError> {
    split_text_for_generation(&text, DEFAULT_CHUNK_MAX_CHARS).map_err(IpcError::from)
}

/// Load up to 200 notes for AI deck quality scanning.
#[tauri::command]
pub async fn load_quality_notes(
    app: AppHandle,
    deck_id: Option<i64>,
    note_ids: Option<Vec<i64>>,
    leeches_only: bool,
) -> Result<Vec<QualityScanNote>, IpcError> {
    if let Some(ref ids) = note_ids {
        if ids.len() > 1_000 {
            return Err(IpcError {
                kind: IpcErrorKind::Invalid,
                message: "note_ids exceeds maximum of 1000".into(),
            });
        }
    }
    with_collection(app, move |collection| {
        collection
            .load_quality_notes(deck_id, note_ids.as_deref(), leeches_only)
            .map_err(IpcError::from)
    })
    .await
}

/// Apply accepted AI quality rewrites and tag suggestions atomically with one undo step.
#[tauri::command]
pub async fn apply_quality_fixes(
    app: AppHandle,
    edits: Vec<QualityNoteEdit>,
) -> Result<ApplyQualityFixesResult, IpcError> {
    if edits.len() > 500 {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: "edits exceeds maximum of 500".into(),
        });
    }
    with_collection(app, move |collection| {
        collection
            .apply_quality_fixes(&edits)
            .map_err(IpcError::from)
    })
    .await
}

/// Aggregate stats and build a [`CoachInput`] summary for the AI Study coach.
#[tauri::command]
pub async fn get_coach_input(
    app: AppHandle,
    deck_id: Option<i64>,
    tz_offset_minutes: i32,
) -> Result<CoachInput, IpcError> {
    if !(-1440..=1440).contains(&tz_offset_minutes) {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: format!("tz_offset_minutes {tz_offset_minutes} out of range -1440..=1440"),
        });
    }
    with_collection(app, move |collection| {
        let stats = collection
            .stats(deck_id, Some(30), tz_offset_minutes)
            .map_err(IpcError::from)?;
        let selected_deck_name = match deck_id {
            Some(id) => stats
                .deck_stats
                .iter()
                .find(|d| d.deck_id == id)
                .map(|d| d.name.clone())
                .or_else(|| {
                    collection
                        .list_decks()
                        .ok()
                        .and_then(|decks| decks.into_iter().find(|d| d.id == id).map(|d| d.name))
                }),
            None => None,
        };
        Ok(build_coach_input(&stats, selected_deck_name, deck_id))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use bibalak_ai::MemorySecretStore;
    use bibalak_core::ai::AIProviderKind;

    #[test]
    fn ai_state_roundtrips_config_without_leaking_key_and_previews_plain_text() {
        let dir = std::env::temp_dir().join(format!(
            "keepsake-cmd-ai-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let secrets = Arc::new(MemorySecretStore::default());
        let saved = save_ai_config(
            &dir,
            secrets.as_ref(),
            AISaveConfigInput {
                enabled: true,
                provider: AIProviderKind::OpenAiCompatible,
                base_url: "https://api.openai.com/v1".into(),
                model: "gpt-4o-mini".into(),
                api_key: Some("sk-secret-abc".into()),
            },
        )
        .unwrap();
        assert!(saved.has_api_key);
        let reloaded = load_ai_config(&dir, secrets.as_ref());
        assert_eq!(reloaded, saved);

        let preview = preview_ai_action(
            &dir,
            &AIActionRequest::ExplainCard {
                front_html: "<b>Hola</b>".into(),
                back_html: "<i>Hello</i>".into(),
                deck_name: Some("Spanish".into()),
            },
            Some("ar"),
        )
        .unwrap();
        assert_eq!(preview.endpoint_origin, "https://api.openai.com");
        assert!(!preview.prompt.contains("<b>"));
        assert!(preview.prompt.contains("Hola"));
        assert!(preview.system.contains("Arabic"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
