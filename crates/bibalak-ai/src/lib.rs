//! Bibalak AI adapter crate.
//!
//! Implements [`bibalak_core::ai::AIProvider`] over `ureq` 3 (OpenAI-compatible HTTP
//! + local Ollama) and persists API keys exclusively in the OS credential store via `keyring` 3.

pub mod config;
pub mod provider;
pub mod secrets;
pub mod service;

pub use config::{load_ai_config, save_ai_config};
pub use provider::HttpAIProvider;
pub use secrets::{KeyringSecretStore, MemorySecretStore, SecretStore};
pub use service::{preview_ai_action, run_ai_action};
