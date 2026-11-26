use crate::error::CoreResult;

/// Local sync journal and sync-state persistence (ADR-014).
pub trait SyncStore: Send + Sync {
    /// Collect all local mutations with `usn = -1` into a [`crate::sync::SyncDelta`].
    fn export_delta(&self) -> CoreResult<crate::sync::SyncDelta>;

    /// Apply a remote [`crate::sync::SyncDelta`] using ADR-014 deterministic merge rules.
    fn apply_sync_delta(
        &self,
        delta: &crate::sync::SyncDelta,
        new_usn: i64,
        now_ms: i64,
    ) -> CoreResult<crate::sync::MergeSummary>;

    /// Read a key from the local `sync_state` table.
    fn get_sync_state(&self, key: &str) -> CoreResult<Option<String>>;

    /// Upsert a key-value pair in the local `sync_state` table.
    fn set_sync_state(&self, key: &str, value: &str) -> CoreResult<()>;
}
