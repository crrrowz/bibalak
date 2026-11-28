use crate::error::CoreResult;
use crate::ipc::IntegrityReport;

/// Database maintenance, backup, and media-reference persistence.
pub trait MaintenanceStore: Send + Sync {
    /// The database `user_version` (our migration revision).
    fn schema_version(&self) -> CoreResult<i64>;

    /// Ensure the singleton collection row exists; returns its creation time
    /// (ms), which anchors the day-number used for scheduling.
    fn ensure_collection(&self, now_ms: i64) -> CoreResult<i64>;

    /// Run `PRAGMA integrity_check` and orphan subdeck repair, returning structured counts.
    fn integrity_check(&self, now_ms: i64) -> CoreResult<IntegrityReport>;

    /// Run `PRAGMA optimize; VACUUM` to compact and tune the database.
    fn optimize(&self) -> CoreResult<()>;

    /// Extract all media filenames referenced in note fields.
    fn note_media_refs(&self) -> CoreResult<Vec<String>>;

    /// Extract media filenames referenced in note fields alongside the number of
    /// distinct notes referencing each filename.
    fn note_media_ref_counts(&self) -> CoreResult<Vec<(String, u32)>>;

    /// Extract media filenames referenced by notes matching a Browse search
    /// query alongside the number of distinct matching notes per filename.
    fn note_media_ref_counts_matching(
        &self,
        query: &str,
        today: i32,
        now_ms: i64,
    ) -> CoreResult<Vec<(String, u32)>>;

    /// Rewrite `<img src="old_name">` / `<img src='old_name'>` and
    /// `[sound:old_name]` references across note fields to `new_name`. Returns
    /// the number of notes updated.
    fn rewrite_media_ref(&self, old_name: &str, new_name: &str, now_ms: i64) -> CoreResult<u32>;

    /// Hot-copy the main database to `dest_path`.
    fn backup_db(&self, dest_path: &std::path::Path) -> CoreResult<()>;
}
