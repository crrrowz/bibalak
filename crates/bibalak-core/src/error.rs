//! Core error type. Each crate defines its own `thiserror` enum; they compose
//! upward into [`CoreError`], which the IPC boundary later maps to a typed,
//! serialisable error union for the frontend.

use thiserror::Error;

pub type CoreResult<T> = Result<T, CoreError>;

/// Errors that can escape the application layer.
///
/// Variants are intentionally coarse-grained and stable; richer context travels
/// in the `String` payloads until milestones introduce the subsystems that need
/// structured detail.
#[derive(Debug, Error)]
pub enum CoreError {
    #[error("collection is not open")]
    NotOpen,

    #[error("storage error: {0}")]
    Storage(String),

    #[error("import/export error: {0}")]
    Format(String),

    #[error("scheduler error: {0}")]
    Scheduler(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid input: {0}")]
    Invalid(String),

    #[error("cancelled")]
    Cancelled,

    #[error("collection was saved by a newer Bibalak (schema v{found}, supported v{supported})")]
    SchemaTooNew { found: i64, supported: i64 },

    #[error("full sync required: local schema_mod {local} != remote schema_mod {remote}")]
    FullSyncRequired { local: i64, remote: i64 },

    #[error("clock skew detected: remote mod {remote_mod} exceeds local time {now_ms} by more than {max_skew_ms}ms")]
    ClockSkewDetected {
        remote_mod: i64,
        now_ms: i64,
        max_skew_ms: i64,
    },

    #[error(transparent)]
    Other(#[from] anyhow_compat::AnyError),
}

/// A tiny indirection so this crate does not need a hard `anyhow` dependency in
/// its public API while still allowing `?` on boxed errors internally.
pub mod anyhow_compat {
    /// Boxed dynamic error used by [`super::CoreError::Other`].
    pub type AnyError = Box<dyn std::error::Error + Send + Sync + 'static>;
}
