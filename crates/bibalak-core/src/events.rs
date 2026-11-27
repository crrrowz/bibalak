//! Typed domain events + a minimal in-process dispatch bus.
//!
//! Mutations in the application layer emit a [`DomainEvent`] *after* their
//! transaction commits. Subscribers include the search-index updater, the stats
//! cache invalidator, the plugin host, and a Tauri bridge that re-emits events
//! to the webview so the UI can invalidate its query cache.

use std::sync::{Mutex, MutexGuard, Once};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Stable event name emitted to the webview, which maps it to query-cache
/// invalidations. Single source of truth for both Rust and TypeScript (`ts-rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum CoreEventName {
    DeckChanged,
    SchemaChanged,
    CollectionOpened,
    CollectionClosed,
    CardAnswered,
    NotesChanged,
    MediaChanged,
    ProductivityChanged,
    GameChanged,
}

impl CoreEventName {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DeckChanged => "deck-changed",
            Self::SchemaChanged => "schema-changed",
            Self::CollectionOpened => "collection-opened",
            Self::CollectionClosed => "collection-closed",
            Self::CardAnswered => "card-answered",
            Self::NotesChanged => "notes-changed",
            Self::MediaChanged => "media-changed",
            Self::ProductivityChanged => "productivity-changed",
            Self::GameChanged => "game-changed",
        }
    }
}

/// A fact about something that has already happened to the collection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DomainEvent {
    CollectionOpened,
    CollectionClosed,
    SchemaChanged,
    CardAnswered { card_id: i64 },
    NoteAdded { note_id: i64 },
    NoteUpdated { note_id: i64 },
    NotesUpdated { note_ids: Vec<i64> },
    NoteRemoved { note_id: i64 },
    DeckChanged { deck_id: i64 },
    MediaChanged,
    ProductivityChanged,
    GameChanged,
}

impl DomainEvent {
    pub const fn event_name(&self) -> CoreEventName {
        match self {
            Self::DeckChanged { .. } => CoreEventName::DeckChanged,
            Self::SchemaChanged => CoreEventName::SchemaChanged,
            Self::CollectionOpened => CoreEventName::CollectionOpened,
            Self::CollectionClosed => CoreEventName::CollectionClosed,
            Self::CardAnswered { .. } => CoreEventName::CardAnswered,
            Self::NoteAdded { .. }
            | Self::NoteUpdated { .. }
            | Self::NotesUpdated { .. }
            | Self::NoteRemoved { .. } => CoreEventName::NotesChanged,
            Self::MediaChanged => CoreEventName::MediaChanged,
            Self::ProductivityChanged => CoreEventName::ProductivityChanged,
            Self::GameChanged => CoreEventName::GameChanged,
        }
    }
}

/// Anything that can receive domain events.
pub trait EventSink: Send + Sync {
    fn emit(&self, event: DomainEvent);
}

type Listener = Box<dyn Fn(&DomainEvent) + Send + Sync + 'static>;

/// Synchronous fan-out event bus. Listeners are invoked in registration order
/// on the thread that emits. Cheap and deterministic — good enough until a
/// milestone needs async or ordering guarantees.
#[derive(Default)]
pub struct EventBus {
    listeners: Mutex<Vec<Listener>>,
}

impl EventBus {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock_listeners(&self) -> MutexGuard<'_, Vec<Listener>> {
        match self.listeners.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                static LOGGED_EVENT_POISON: Once = Once::new();
                LOGGED_EVENT_POISON.call_once(|| {
                    eprintln!("bibalak: event bus mutex poisoned; recovering inner listeners");
                });
                poisoned.into_inner()
            }
        }
    }

    /// Register a listener for all events.
    pub fn subscribe(&self, listener: impl Fn(&DomainEvent) + Send + Sync + 'static) {
        self.lock_listeners().push(Box::new(listener));
    }
}

impl EventSink for EventBus {
    fn emit(&self, event: DomainEvent) {
        let listeners = self.lock_listeners();
        for listener in listeners.iter() {
            listener(&event);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    #[test]
    fn fans_out_to_subscribers() {
        let bus = EventBus::new();
        let count = Arc::new(AtomicUsize::new(0));
        let c = count.clone();
        bus.subscribe(move |_| {
            c.fetch_add(1, Ordering::SeqCst);
        });
        bus.emit(DomainEvent::CollectionOpened);
        bus.emit(DomainEvent::DeckChanged { deck_id: 1 });
        assert_eq!(count.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn recovers_from_poisoned_mutex_in_subscribe_and_emit() {
        let bus = EventBus::new();
        bus.subscribe(|event| {
            if matches!(event, DomainEvent::CollectionOpened) {
                panic!("simulated listener panic");
            }
        });

        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            bus.emit(DomainEvent::CollectionOpened);
        }));
        assert!(panicked.is_err());

        let count = Arc::new(AtomicUsize::new(0));
        let c = count.clone();
        bus.subscribe(move |_| {
            c.fetch_add(1, Ordering::SeqCst);
        });
        bus.emit(DomainEvent::DeckChanged { deck_id: 1 });
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn domain_events_map_to_stable_core_event_names() {
        assert_eq!(
            DomainEvent::DeckChanged { deck_id: 1 }
                .event_name()
                .as_str(),
            "deck-changed"
        );
        assert_eq!(
            DomainEvent::SchemaChanged.event_name().as_str(),
            "schema-changed"
        );
        assert_eq!(
            DomainEvent::CollectionOpened.event_name().as_str(),
            "collection-opened"
        );
        assert_eq!(
            DomainEvent::CollectionClosed.event_name().as_str(),
            "collection-closed"
        );
        assert_eq!(
            DomainEvent::CardAnswered { card_id: 1 }
                .event_name()
                .as_str(),
            "card-answered"
        );
        assert_eq!(
            DomainEvent::NoteAdded { note_id: 1 }.event_name().as_str(),
            "notes-changed"
        );
        assert_eq!(
            DomainEvent::NoteUpdated { note_id: 1 }
                .event_name()
                .as_str(),
            "notes-changed"
        );
        assert_eq!(
            DomainEvent::NotesUpdated {
                note_ids: vec![1, 2]
            }
            .event_name()
            .as_str(),
            "notes-changed"
        );
        assert_eq!(
            DomainEvent::NoteRemoved { note_id: 1 }
                .event_name()
                .as_str(),
            "notes-changed"
        );
        assert_eq!(
            DomainEvent::MediaChanged.event_name().as_str(),
            "media-changed"
        );
        assert_eq!(
            DomainEvent::ProductivityChanged.event_name().as_str(),
            "productivity-changed"
        );
        assert_eq!(
            DomainEvent::GameChanged.event_name().as_str(),
            "game-changed"
        );
    }
}
