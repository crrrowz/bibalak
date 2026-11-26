//! Portable-aware AI settings persistence (`data_dir/.ai.json`, zero secrets).

use std::path::{Path, PathBuf};

use bibalak_core::ai::{normalize_provider_origin, AIConfig, AIProviderKind, AISaveConfigInput};
use bibalak_core::{CoreError, CoreResult};
use serde::{Deserialize, Serialize};

use crate::secrets::SecretStore;

pub const AI_CONFIG_FILENAME: &str = ".ai.json";

/// Disk representation stored in `data_dir/.ai.json`. Notice `api_key` is intentionally absent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct AIPersistedConfig {
    pub enabled: bool,
    pub provider: AIProviderKind,
    pub base_url: String,
    pub model: String,
}

impl Default for AIPersistedConfig {
    fn default() -> Self {
        let d = AIConfig::default();
        Self {
            enabled: d.enabled,
            provider: d.provider,
            base_url: d.base_url,
            model: d.model,
        }
    }
}

pub fn config_path(data_dir: &Path) -> PathBuf {
    data_dir.join(AI_CONFIG_FILENAME)
}

pub(crate) fn load_persisted(data_dir: &Path) -> AIPersistedConfig {
    let Ok(raw) = std::fs::read_to_string(config_path(data_dir)) else {
        return AIPersistedConfig::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

pub fn load_ai_config(data_dir: &Path, secrets: &dyn SecretStore) -> AIConfig {
    let persisted = load_persisted(data_dir);
    let has_api_key = secrets.get_api_key().map(|k| k.is_some()).unwrap_or(false);
    AIConfig {
        enabled: persisted.enabled,
        provider: persisted.provider,
        base_url: persisted.base_url,
        model: persisted.model,
        has_api_key,
    }
}

pub fn save_ai_config(
    data_dir: &Path,
    secrets: &dyn SecretStore,
    input: AISaveConfigInput,
) -> CoreResult<AIConfig> {
    let base_url = input.base_url.trim().trim_end_matches('/').to_string();
    let model = input.model.trim().to_string();

    if input.enabled || !base_url.is_empty() {
        let _ = normalize_provider_origin(&base_url)?;
    }
    if input.enabled && model.is_empty() {
        return Err(CoreError::Invalid("AI model name cannot be empty".into()));
    }

    if let Some(raw_key) = input.api_key {
        let trimmed = raw_key.trim();
        if trimmed.is_empty() {
            secrets.delete_api_key().map_err(CoreError::Storage)?;
        } else {
            secrets.set_api_key(trimmed).map_err(CoreError::Storage)?;
        }
    }

    let persisted = AIPersistedConfig {
        enabled: input.enabled,
        provider: input.provider,
        base_url,
        model,
    };

    std::fs::create_dir_all(data_dir)
        .map_err(|e| CoreError::Storage(format!("create data dir for AI config: {e}")))?;
    let json = serde_json::to_string_pretty(&persisted)
        .map_err(|e| CoreError::Storage(format!("serialize AI config: {e}")))?;
    std::fs::write(config_path(data_dir), json)
        .map_err(|e| CoreError::Storage(format!("write AI config: {e}")))?;

    let has_api_key = secrets.get_api_key().map_err(CoreError::Storage)?.is_some();

    Ok(AIConfig {
        enabled: persisted.enabled,
        provider: persisted.provider,
        base_url: persisted.base_url,
        model: persisted.model,
        has_api_key,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecretStore;

    #[test]
    fn api_key_goes_only_to_secret_store_never_on_disk() {
        let dir = std::env::temp_dir().join(format!(
            "bibalak-ai-cfg-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let secrets = MemorySecretStore::default();
        let saved = save_ai_config(
            &dir,
            &secrets,
            AISaveConfigInput {
                enabled: true,
                provider: AIProviderKind::OpenAiCompatible,
                base_url: "https://api.openai.com/v1/".into(),
                model: "gpt-4o-mini".into(),
                api_key: Some("sk-super-secret-value".into()),
            },
        )
        .unwrap();

        assert!(saved.enabled);
        assert!(saved.has_api_key);
        assert_eq!(saved.base_url, "https://api.openai.com/v1");
        assert_eq!(
            secrets.get_api_key().unwrap().as_deref(),
            Some("sk-super-secret-value")
        );

        let disk_json = std::fs::read_to_string(config_path(&dir)).unwrap();
        assert!(!disk_json.contains("sk-super-secret-value"));
        assert!(!disk_json.contains("api_key"));

        // Passing None preserves the existing secret while updating other fields.
        let updated = save_ai_config(
            &dir,
            &secrets,
            AISaveConfigInput {
                enabled: true,
                provider: AIProviderKind::Ollama,
                base_url: "http://localhost:11434".into(),
                model: "llama3.2".into(),
                api_key: None,
            },
        )
        .unwrap();
        assert!(updated.has_api_key);

        // Passing Some("") deletes it cleanly.
        let cleared = save_ai_config(
            &dir,
            &secrets,
            AISaveConfigInput {
                enabled: true,
                provider: AIProviderKind::Ollama,
                base_url: "http://localhost:11434".into(),
                model: "llama3.2".into(),
                api_key: Some(String::new()),
            },
        )
        .unwrap();
        assert!(!cleared.has_api_key);
        assert_eq!(secrets.get_api_key().unwrap(), None);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
