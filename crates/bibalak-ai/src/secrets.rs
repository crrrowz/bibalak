//! OS credential-store adapter backed by `keyring` 3.

use std::sync::Mutex;

use keyring::Entry;

/// Keychain service name: the app id.
const SERVICE_NAME: &str = "com.bibalak.desktop";
/// Service name used by Bibalak 1.0 and 1.1; read once and moved to
/// [`SERVICE_NAME`].
const PREVIOUS_SERVICE_NAME: &str = "com.keepsake.desktop";
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
        Self::entry_for(SERVICE_NAME)
    }

    fn entry_for(service: &str) -> Result<Entry, String> {
        Entry::new(service, API_KEY_ACCOUNT)
            .map_err(|e| format!("failed to access OS credential store: {e}"))
    }

    /// Key saved under the 1.0/1.1 service name, moved to the current name.
    /// Best effort: if the move fails the old entry stays and is read again.
    fn take_previous_key() -> Option<String> {
        let old = Self::entry_for(PREVIOUS_SERVICE_NAME).ok()?;
        let secret = old.get_password().ok().filter(|s| !s.is_empty())?;
        if Self::entry()
            .and_then(|new| {
                new.set_password(&secret)
                    .map_err(|e| format!("failed to store API key in credential store: {e}"))
            })
            .is_ok()
        {
            let _ = old.delete_credential();
        }
        Some(secret)
    }
}

impl SecretStore for KeyringSecretStore {
    fn get_api_key(&self) -> Result<Option<String>, String> {
        let entry = Self::entry()?;
        match entry.get_password() {
            Ok(secret) if !secret.is_empty() => Ok(Some(secret)),
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(Self::take_previous_key()),
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
