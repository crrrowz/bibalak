//! The `Collection` aggregate — the application layer's entry point.
//!
//! It owns the [`Storage`] port, a [`Clock`], the [`EventBus`] and the
//! [`UndoLog`], and exposes use-cases (create/rename/remove deck, undo). Each
//! mutating use-case: validates input, calls storage, records an undo step, and
//! emits a domain event. The shell (Tauri) constructs it with a concrete
//! storage + clock and never reaches past these methods.

use std::sync::atomic::{AtomicI32, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Once};

use crate::error::{CoreError, CoreResult};
use crate::events::{DomainEvent, EventBus, EventSink};
use crate::ipc::CollectionPrefs;
use crate::ports::{Clock, SchedulerSet, Storage};
use crate::undo::{UndoAction, UndoLog};

mod browse;
mod decks;
mod game;
mod game_depth;
mod import_export;
pub use import_export::{collect_export_media_refs, strip_export_scheduling, PreparedExport};
mod maintenance;
mod media;
mod motivation;
mod notes;
mod notetypes;
mod productivity;
mod reminders;
mod stats;
mod study;
mod sync;

#[cfg(any(test, feature = "testkit"))]
pub mod fake_storage;
#[cfg(test)]
pub(crate) mod testkit;

pub(crate) const MS_PER_DAY: i64 = 86_400_000;

pub struct Collection {
    pub(crate) storage: Box<dyn Storage>,
    pub(crate) clock: Arc<dyn Clock>,
    pub(crate) scheduler_set: Option<Arc<dyn SchedulerSet>>,
    pub(crate) events: Arc<EventBus>,
    pub(crate) undo: Mutex<UndoLog>,
    /// Most recently undone answer's `card_id`, kept so `next_card_id` shows
    /// the undone card next (Anki `rslib/src/scheduler/answering/undo.rs`, A1-09 / F6).
    pub(crate) last_undone_card_id: Mutex<Option<i64>>,
    /// Collection creation time (ms); anchors the scheduling day-number.
    pub(crate) created_ms: i64,
    /// Local hour (0-23) at which "today" rolls over, mirroring Anki's day
    /// cutoff. Loaded from storage at construction; updated by
    /// [`Collection::set_collection_prefs`].
    pub(crate) rollover_hour: AtomicU8,
    /// Frontend's local UTC offset in minutes (`-Date#getTimezoneOffset()`),
    /// applied so the rollover hour is evaluated in local, not UTC, time. Set
    /// once at startup via [`Collection::set_local_offset_minutes`]; defaults
    /// to UTC until then.
    pub(crate) tz_offset_minutes: AtomicI32,
    /// Last day index on which unbury was executed.
    pub(crate) last_unbury_day: AtomicI32,
}

impl Collection {
    /// Build a collection over the given storage + clock. Ensures the
    /// collection row exists and emits [`DomainEvent::CollectionOpened`].
    pub fn new(storage: Box<dyn Storage>, clock: Arc<dyn Clock>) -> CoreResult<Self> {
        let created_ms = storage.ensure_collection(clock.now_ms())?;
        let rollover_hour = storage.get_rollover_hour()?;
        let last_unbury_day = storage.get_last_unbury_day()?.unwrap_or(i32::MIN);
        let collection = Self {
            storage,
            clock,
            scheduler_set: None,
            events: Arc::new(EventBus::new()),
            undo: Mutex::new(UndoLog::default()),
            last_undone_card_id: Mutex::new(None),
            created_ms,
            rollover_hour: AtomicU8::new(rollover_hour),
            tz_offset_minutes: AtomicI32::new(0),
            last_unbury_day: AtomicI32::new(last_unbury_day),
        };
        collection.events.emit(DomainEvent::CollectionOpened);
        Ok(collection)
    }

    /// Attach a [`SchedulerSet`] implementation so [`Collection::answer_card`]
    /// can compute scheduling outcomes and interval fuzz without `bibalak-core`
    /// depending on `bibalak-scheduler`.
    pub fn with_scheduler_set(mut self, scheduler_set: Arc<dyn SchedulerSet>) -> Self {
        self.scheduler_set = Some(scheduler_set);
        self
    }

    fn lock_undo(&self) -> MutexGuard<'_, UndoLog> {
        match self.undo.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                static LOGGED_UNDO_POISON: Once = Once::new();
                LOGGED_UNDO_POISON.call_once(|| {
                    eprintln!("keepsake: undo mutex poisoned; recovering inner log");
                });
                poisoned.into_inner()
            }
        }
    }

    /// Borrow the underlying storage port (used by outer adapters such as
    /// `MediaStore` to inspect or rewrite note references).
    pub fn storage(&self) -> &dyn Storage {
        self.storage.as_ref()
    }

    /// Day index of `ms` in local time, in units of whole days since the
    /// rollover hour last passed — i.e. bucketing `ms` into rollover-aligned
    /// days rather than calendar/UTC days.
    pub(crate) fn local_day_index(&self, ms: i64) -> i64 {
        crate::progress::created_epoch_day(
            ms,
            self.tz_offset_minutes.load(Ordering::Relaxed),
            self.rollover_hour.load(Ordering::Relaxed),
        )
    }

    /// Today's day-number (days since collection creation), aligned to the
    /// configured local rollover hour.
    pub fn today(&self) -> i32 {
        (self.local_day_index(self.clock.now_ms()) - self.local_day_index(self.created_ms)) as i32
    }

    /// Start instant (epoch ms) of day 0 (the rollover-aligned creation day),
    /// matching Anki's `col.crt` convention.
    pub(crate) fn day_zero_start_ms(&self) -> i64 {
        let tz_off_ms = i64::from(self.tz_offset_minutes.load(Ordering::Relaxed)) * 60_000;
        let rollover_ms = i64::from(self.rollover_hour.load(Ordering::Relaxed)) * 3_600_000;
        self.local_day_index(self.created_ms) * MS_PER_DAY + rollover_ms - tz_off_ms
    }

    /// Start of today in ms (UTC) — the most recent local rollover instant.
    pub(crate) fn today_start_ms(&self) -> i64 {
        self.today_end_ms() - MS_PER_DAY
    }

    /// Start of tomorrow in ms (UTC) — used as the learning-card gate for today's session.
    pub(crate) fn today_end_ms(&self) -> i64 {
        let tz_off_ms = i64::from(self.tz_offset_minutes.load(Ordering::Relaxed)) * 60_000;
        let rollover_ms = i64::from(self.rollover_hour.load(Ordering::Relaxed)) * 3_600_000;
        let next_local_day = self.local_day_index(self.clock.now_ms()) + 1;
        next_local_day * MS_PER_DAY + rollover_ms - tz_off_ms
    }

    /// Current day-rollover preferences.
    pub fn get_collection_prefs(&self) -> CoreResult<CollectionPrefs> {
        Ok(CollectionPrefs {
            rollover_hour: self.rollover_hour.load(Ordering::Relaxed),
        })
    }

    /// Persist the day-rollover hour and apply it immediately. Since the day
    /// number is derived from the current rollover hour rather than stored
    /// per-card, changing it takes effect on the next `today()` call — same
    /// as Anki's behavior when the cutoff hour is changed.
    pub fn set_collection_prefs(&self, prefs: &CollectionPrefs) -> CoreResult<()> {
        if prefs.rollover_hour > 23 {
            return Err(CoreError::Invalid("rollover hour must be 0-23".into()));
        }
        self.storage
            .set_rollover_hour(prefs.rollover_hour, self.now_ms())?;
        self.rollover_hour
            .store(prefs.rollover_hour, Ordering::Relaxed);
        let _ = self.maybe_unbury_day_rollover()?;
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(())
    }

    /// Record the frontend's local UTC offset (minutes, `-Date#getTimezoneOffset()`)
    /// so the rollover hour is evaluated in local rather than UTC time.
    /// Desktop-only; the shell calls this once at startup.
    pub fn set_local_offset_minutes(&self, minutes: i32) {
        self.tz_offset_minutes.store(minutes, Ordering::Relaxed);
    }

    /// Current wall-clock time in ms (from the injected clock).
    pub fn now_ms(&self) -> i64 {
        self.clock.now_ms()
    }

    /// `root` plus every deck nested under it (transitively), via `parent_id`.
    pub(crate) fn deck_and_descendants(&self, root: i64) -> CoreResult<Vec<i64>> {
        let decks = self.storage.list_decks()?;
        let mut children: std::collections::HashMap<i64, Vec<i64>> =
            std::collections::HashMap::new();
        for d in &decks {
            if let Some(p) = d.parent_id {
                children.entry(p).or_default().push(d.id);
            }
        }
        let mut ids = vec![root];
        let mut stack = vec![root];
        while let Some(id) = stack.pop() {
            if let Some(kids) = children.get(&id) {
                for &k in kids {
                    ids.push(k);
                    stack.push(k);
                }
            }
        }
        Ok(ids)
    }

    /// Shared handle to the event bus, for wiring external subscribers
    /// (e.g. the Tauri → webview bridge).
    pub fn events(&self) -> Arc<EventBus> {
        self.events.clone()
    }

    pub fn schema_version(&self) -> CoreResult<i64> {
        self.storage.schema_version()
    }

    /// Next undoable operation, if any.
    pub fn undo_status(&self) -> Option<UndoAction> {
        self.lock_undo().peek().cloned()
    }

    /// Paged newest-first list of in-memory undoable operations (20 per page).
    pub fn undo_history(&self, page: u32) -> crate::undo::UndoHistoryPage {
        self.lock_undo()
            .history(page, crate::undo::UNDO_HISTORY_PAGE_SIZE)
    }

    /// Undo the most recent operation; returns the action that was undone.
    pub fn undo(&self) -> CoreResult<Option<UndoAction>> {
        let step = self.lock_undo().pop();
        match step {
            None => Ok(None),
            Some(step) => {
                let label = step.label.clone();
                let undone_card_id = step.card_id;
                step.run(self.storage.as_ref(), self.clock.now_ms())?;
                self.set_last_undone_card_id(undone_card_id);
                if matches!(
                    label,
                    UndoAction::AnswerCard
                        | UndoAction::ResetDeckProgress { .. }
                        | UndoAction::CompleteTask { .. }
                        | UndoAction::ReopenTask { .. }
                        | UndoAction::LogHabit { .. }
                ) {
                    let _ = self.reconcile_motivation(true)?;
                }
                self.events.emit(DomainEvent::SchemaChanged);
                if matches!(
                    label,
                    UndoAction::AnswerCard
                        | UndoAction::ResetDeckProgress { .. }
                        | UndoAction::CompleteTask { .. }
                        | UndoAction::ReopenTask { .. }
                        | UndoAction::LogHabit { .. }
                ) {
                    self.events.emit(DomainEvent::GameChanged);
                }
                Ok(Some(label))
            }
        }
    }

    pub(crate) fn last_undone_card_id(&self) -> Option<i64> {
        match self.last_undone_card_id.lock() {
            Ok(guard) => *guard,
            Err(poisoned) => *poisoned.into_inner(),
        }
    }

    pub(crate) fn set_last_undone_card_id(&self, card_id: Option<i64>) {
        match self.last_undone_card_id.lock() {
            Ok(mut guard) => *guard = card_id,
            Err(poisoned) => *poisoned.into_inner() = card_id,
        }
    }

    pub(crate) fn record_undo(
        &self,
        label: UndoAction,
        action: impl FnOnce(&dyn Storage, i64) -> CoreResult<()> + Send + 'static,
    ) {
        self.lock_undo()
            .record_at(label, self.clock.now_ms(), Box::new(action));
    }

    pub(crate) fn record_undo_for_card(
        &self,
        label: UndoAction,
        card_id: i64,
        action: impl FnOnce(&dyn Storage, i64) -> CoreResult<()> + Send + 'static,
    ) {
        self.lock_undo()
            .record_with_card_at(label, card_id, self.clock.now_ms(), Box::new(action));
    }

    /// Clear pending undo history when an irreversible mutation runs so `undo()`
    /// never silently reverses an earlier unrelated operation.
    pub(crate) fn clear_undo(&self) {
        self.lock_undo().clear();
        self.set_last_undone_card_id(None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collection::fake_storage::FakeStorage;
    use crate::ports::FixedClock;

    #[test]
    fn collection_new_fails_on_bad_created() {
        let storage = FakeStorage::default();
        storage
            .fail_ensure_collection
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let res = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000)));
        assert!(matches!(res, Err(CoreError::Storage(_))));
    }

    #[test]
    fn poisoned_lock_recovers() {
        let col = Arc::new(
            Collection::new(
                Box::new(FakeStorage::default()),
                Arc::new(FixedClock(1_000)),
            )
            .unwrap(),
        );
        let col2 = Arc::clone(&col);
        let handle = std::thread::spawn(move || {
            let _guard = col2.undo.lock().unwrap();
            panic!("intentional undo poison");
        });
        assert!(handle.join().is_err());
        assert_eq!(col.undo_status(), None);
        assert_eq!(col.undo().unwrap(), None);
    }
}
