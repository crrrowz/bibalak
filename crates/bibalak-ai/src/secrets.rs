//! OS credential-store adapter backed by `keyring` 3.

use std::sync::Mutex;

use keyring::Entry;

const SERVICE_NAME: &str = "com.keepsake.desktop";
const API_KEY_ACCOUNT: &str = "ai_provider_api_key";

/// Port for storing the AI API key outside SQLite and config files.
pub trait SecretStore: Send + Sync {
    fn get_api_key(&self) -> Result<Option<String>, String>;
    fn set_api_key(&self, api_key: &str) -> Result<(), String>;
    fn delete_api_key(&self) -> Result<(), String>;
}

/// OS keychain implementation (`keyring` crate).
#[derive(Debug, Clone, Default)]
pub struct KeyringSecretStore;

impl KeyringSecretStore {
    fn entry() -> Result<Entry, String> {
        Entry::new(SERVICE_NAME, API_KEY_ACCOUNT)
            .map_err(|e| format!("failed to access OS credential store: {e}"))
    }
}

impl SecretStore for KeyringSecretStore {
    fn get_api_key(&self) -> Result<Option<String>, String> {
        let entry = Self::entry()?;
        match entry.get_password() {
            Ok(secret) => Ok(if secret.is_empty() {
                None
            } else {
                Some(secret)
            }),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("failed to read API key from credential store: {e}")),
        }
    }

    fn set_api_key(&self, api_key: &str) -> Result<(), String> {
        let entry = Self::entry()?;
        entry
            .set_password(api_key)
            .map_err(|e| format!("failed to store API key in credential store: {e}"))
    }

    fn delete_api_key(&self) -> Result<(), String> {
        let entry = Self::entry()?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!(
                "failed to remove API key from credential store: {e}"
            )),
        }
    }
}

/// In-memory secret store for tests so tests never touch the host OS keychain.
#[derive(Debug, Default)]
pub struct MemorySecretStore {
    key: Mutex<Option<String>>,
}

impl MemorySecretStore {
    pub fn with_key(key: impl Into<String>) -> Self {
        Self {
            key: Mutex::new(Some(key.into())),
        }
    }
}

impl SecretStore for MemorySecretStore {
    fn get_api_key(&self) -> Result<Option<String>, String> {
        self.key
            .lock()
            .map(|g| g.clone())
            .map_err(|_| "memory secret store lock poisoned".into())
    }

    fn set_api_key(&self, api_key: &str) -> Result<(), String> {
        let mut g = self
            .key
            .lock()
            .map_err(|_| "memory secret store lock poisoned".to_string())?;
        *g = if api_key.is_empty() {
            None
        } else {
            Some(api_key.to_string())
        };
        Ok(())
    }

    fn delete_api_key(&self) -> Result<(), String> {
        let mut g = self
            .key
            .lock()
            .map_err(|_| "memory secret store lock poisoned".to_string())?;
        *g = None;
        Ok(())
    }
}
