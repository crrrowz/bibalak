//! Ports — the traits outer layers implement (hexagonal / ports-and-adapters).
//!
//! `bibalak-core` depends on *none* of the implementations. `bibalak-db`
//! implements [`Storage`] (via its role traits), `bibalak-media` implements
//! [`MediaStore`], `bibalak-scheduler` implements [`Scheduler`], and so on.
//! Tests inject fakes (notably [`FixedClock`]) so behaviour is deterministic.

use std::collections::BTreeMap;

use crate::error::CoreResult;
use crate::ipc::MediaReport;
use crate::scheduling::CardState;

pub mod browse;
pub mod deck;
pub mod game;
pub mod maintenance;
pub mod note;
pub mod notetype;
pub mod productivity;
pub mod progress;
pub mod study;
pub mod sync;

pub use browse::BrowseStore;
pub use deck::{DeckStore, RemovedDeck};
pub use game::GameStore;
pub use maintenance::MaintenanceStore;
pub use note::{NoteStore, ParsedTextNote, TextImportOutcome};
pub use notetype::NotetypeStore;
pub use productivity::ProductivityStore;
pub use progress::ProgressStore;
pub use study::{SimCardSnapshot, StudyQueue, StudyStore, WorkloadSnapshot};
pub use sync::SyncStore;

/// Source of "now", injectable so scheduler tests are deterministic across the
/// day cutoff and time zones. The engine must never read the wall clock except
/// through this port.
pub trait Clock: Send + Sync {
    /// Milliseconds since the Unix epoch.
    fn now_ms(&self) -> i64;
}

/// Real system clock used by the application at runtime.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }
}

/// Deterministic clock for tests.
#[derive(Debug, Clone, Copy)]
pub struct FixedClock(pub i64);

impl Clock for FixedClock {
    fn now_ms(&self) -> i64 {
        self.0
    }
}

/// Steppable clock for tests across time intervals.
#[derive(Debug, Default)]
pub struct TestClock(pub std::sync::atomic::AtomicI64);

impl TestClock {
    pub fn new(now_ms: i64) -> Self {
        Self(std::sync::atomic::AtomicI64::new(now_ms))
    }

    pub fn set(&self, now_ms: i64) {
        self.0.store(now_ms, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn advance_days(&self, days: i64) {
        self.0
            .fetch_add(days * 86_400_000, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn advance_ms(&self, ms: i64) {
        self.0.fetch_add(ms, std::sync::atomic::Ordering::SeqCst);
    }
}

impl Clock for TestClock {
    fn now_ms(&self) -> i64 {
        self.0.load(std::sync::atomic::Ordering::SeqCst)
    }
}

/// Transactional persistence for the collection. Composed from the role traits
/// in [`crate::ports`]; any type implementing all role traits automatically
/// implements [`Storage`] via a blanket impl.
pub trait Storage:
    DeckStore
    + NoteStore
    + NotetypeStore
    + StudyStore
    + BrowseStore
    + MaintenanceStore
    + SyncStore
    + ProgressStore
    + ProductivityStore
    + GameStore
    + Send
    + Sync
{
}

impl<T> Storage for T where
    T: DeckStore
        + NoteStore
        + NotetypeStore
        + StudyStore
        + BrowseStore
        + MaintenanceStore
        + SyncStore
        + ProgressStore
        + ProductivityStore
        + GameStore
        + Send
        + Sync
{
}

/// Metadata for a stored file inside the collection's media directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaEntry {
    pub filename: String,
    pub size_bytes: u64,
    pub sha1: String,
}

/// On-disk media store (checksums, dedup, cleanup, ref-rewriting). Implemented
/// by `bibalak-media`. Core itself holds no filesystem paths or I/O.
pub trait MediaStore: Send + Sync {
    /// Store `bytes` under `filename` (rejecting path traversal / absolute paths).
    /// Identical SHA-1 content is stored once and returns the existing name; a
    /// colliding filename with different content receives `stem-N.ext`.
    fn add(&self, filename: &str, bytes: &[u8]) -> CoreResult<String>;

    /// Read raw bytes of `filename` (rejecting path traversal / absolute paths).
    fn read(&self, filename: &str) -> CoreResult<Vec<u8>>;

    /// Open a streaming reader for `filename` without buffering the whole file
    /// in memory. Defaults to wrapping [`Self::read`] in a cursor for test fakes.
    fn open_reader(&self, filename: &str) -> CoreResult<Box<dyn std::io::Read + Send>> {
        Ok(Box::new(std::io::Cursor::new(self.read(filename)?)))
    }

    /// List all stored media entries sorted by filename.
    fn list(&self) -> CoreResult<Vec<MediaEntry>>;

    /// Lightweight listing returning `(filename, size_bytes)` sorted by filename
    /// without computing SHA-1 hashes. Defaults to delegating to [`Self::list`].
    fn list_sizes(&self) -> CoreResult<Vec<(String, u64)>> {
        Ok(self
            .list()?
            .into_iter()
            .map(|e| (e.filename, e.size_bytes))
            .collect())
    }

    /// Usage count (distinct notes referencing each file) keyed by filename,
    /// including stored-but-unused files with count `0`.
    fn usage_counts(&self, storage: &dyn Storage) -> CoreResult<BTreeMap<String, u32>>;

    /// Stored files that are not referenced by any note, sorted by filename.
    fn find_unused(&self, storage: &dyn Storage) -> CoreResult<Vec<String>>;

    /// Scan stored files against note references (`orphan_files` + `missing_files`).
    fn check_media(&self, storage: &dyn Storage) -> CoreResult<MediaReport>;

    /// Delete the given filenames (rejecting path traversal). Returns count deleted.
    fn delete(&self, filenames: &[String]) -> CoreResult<u32>;

    /// Rename `old_name` to `new_name` (rejecting traversal and overwriting an
    /// existing file) and rewrite references in `storage` note fields. Returns
    /// the number of notes updated.
    fn rename(
        &self,
        storage: &dyn Storage,
        old_name: &str,
        new_name: &str,
        now_ms: i64,
    ) -> CoreResult<u32>;
}

/// Port for selecting a scheduling algorithm, computing an answer outcome, and
/// applying interval fuzz. Implemented by `bibalak-scheduler::DefaultSchedulerSet`
/// so `Collection::answer_card` stays independent of `bibalak-scheduler`.
pub trait SchedulerSet: Send + Sync {
    fn answer(
        &self,
        algorithm: crate::model::Algorithm,
        state: &CardState,
        rating: crate::model::Rating,
        ctx: &crate::scheduling::SchedContext,
    ) -> crate::scheduling::AnswerOutcome;

    fn fuzz_days(&self, days: u32, card_id: i64) -> u32;
}

// The `Scheduler` port lives in `crate::scheduling` alongside its value types.

#[cfg(test)]
mod tests {
    use super::*;

    fn _assert_blanket_storage<T>()
    where
        T: DeckStore
            + NoteStore
            + NotetypeStore
            + StudyStore
            + BrowseStore
            + MaintenanceStore
            + SyncStore
            + ProgressStore
            + ProductivityStore
            + GameStore
            + Send
            + Sync,
    {
        fn requires_storage<S: Storage + ?Sized>() {}
        requires_storage::<T>();
    }

    fn _assert_dyn_storage(_: &dyn Storage) {}
}
