//! # bibalak-core
//!
//! The innermost ring of Bibalak's clean architecture: the domain model, the
//! application use-cases ([`Collection`]), the typed event bus and the *ports*
//! (traits) that outer layers implement.
//!
//! This crate must never depend on a UI framework (React/Tauri), on a concrete
//! database (rusqlite), or on a search engine (Tantivy). Those are wired in via
//! the traits declared in [`ports`]. Keeping this boundary clean is what lets
//! the same engine power the desktop app today and a mobile/CLI app later.

pub mod ai;
pub mod collection;
pub mod error;
pub mod events;
pub mod game;
pub mod game_depth;
pub mod ipc;
pub mod media_refs;
pub mod model;
pub mod motivation;
pub mod ports;
pub mod productivity;
pub mod progress;
pub mod reminders;
pub mod scheduling;
pub mod search_norm;
pub mod sync;
pub mod undo;

pub use search_norm::normalize_search_text;

pub use collection::Collection;
pub use error::{CoreError, CoreResult};
pub use events::{CoreEventName, DomainEvent, EventBus, EventSink};
pub use model::{
    Algorithm, CanonicalModel, Card, CardRender, Deck, DeckConfig, Field, ImportSummary, Note,
    NoteIndexRow, Notetype, Rating, Revlog, StudyCard, Template,
};
pub use ports::{
    BrowseStore, Clock, DeckStore, GameStore, MaintenanceStore, MediaEntry, MediaStore, NoteStore,
    NotetypeStore, ParsedTextNote, ProductivityStore, ProgressStore, SchedulerSet, Storage,
    StudyStore, SyncStore, SystemClock, TextImportOutcome,
};
pub use scheduling::{
    AnswerOutcome, CardPhase, CardState, Interval, RatingPreviews, SchedConfig, SchedContext,
    Scheduler,
};
pub use sync::{Grave, MergeSummary, SyncDelta, SyncTag, MAX_FUTURE_DRIFT_MS};
pub use undo::UndoAction;
