use std::path::Path;

use crate::error::CoreResult;
use crate::events::{DomainEvent, EventSink};
use crate::sync::{MergeSummary, SyncDelta};
use crate::Collection;

impl Collection {
    /// Export local changes since cursor as a [`SyncDelta`].
    pub fn export_local_delta(&self) -> CoreResult<SyncDelta> {
        self.storage.export_delta()
    }

    /// Apply a remote sync delta to local state.
    ///
    /// Safety contract (ADR-014 §2.5):
    /// 1. Takes `now_ms` from the Collection's `Clock` port.
    /// 2. Performs a pre-merge database snapshot to `backup_path` via `Storage::backup_db`.
    /// 3. Applies the remote delta via `Storage::apply_sync_delta`.
    /// 4. If applying fails, returns the error with the pre-merge backup preserved on disk.
    /// 5. On success, emits `DomainEvent::SchemaChanged` and returns the `MergeSummary`.
    pub fn apply_remote_delta(
        &self,
        delta: &SyncDelta,
        new_usn: i64,
        backup_path: &Path,
    ) -> CoreResult<MergeSummary> {
        let now_ms = self.clock.now_ms();
        // 1. Take pre-merge backup before applying
        self.storage.backup_db(backup_path)?;

        // 2. Apply remote delta (with ADR-014 LWW and tombstone reconciliation)
        let summary = self.storage.apply_sync_delta(delta, new_usn, now_ms)?;

        // 3. Emit schema changed event to notify active screens
        self.events.emit(DomainEvent::SchemaChanged);

        Ok(summary)
    }
}
