//! Undo log.
//!
//! Each mutating use-case records an *inverse* action that, given storage and
//! the current time, reverses the change. This is separate from the event bus:
//! events are for notification, the undo log is for reversal. Redo (replaying
//! forward actions popped during undo) is a later-milestone extension.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::CoreResult;
use crate::ports::Storage;

/// Typed description of an undoable operation, serialized across IPC so the
/// UI can render localized labels without English strings coming from Rust.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export)]
pub enum UndoAction {
    AnswerCard,
    CreateDeck { name: String },
    RenameDeck { name: String },
    DeleteDeck { name: String },
    ForgetCards { count: u32 },
    SetDueDate { count: u32 },
    RepositionCards { count: u32 },
    SuspendCards { count: u32 },
    UnsuspendCards { count: u32 },
    BuryCards { count: u32 },
    UnburyCards { count: u32 },
    MoveCards { count: u32 },
    SetCardFlag { count: u32 },
    ChangeDeckOptions,
    IncreaseTodayLimit,
    FindReplace { count: u32 },
    ChangeNoteType { count: u32 },
    AddNote { count: u32 },
    EditNote,
    QualityFixes { count: u32 },
    CompleteTask { title: String },
    ReopenTask { title: String },
    DeleteTask { title: String },
    DeleteTaskList { name: String },
    LogHabit { title: String },
    DeleteHabit { title: String },
    DeleteCalendarEvent { title: String },
}

/// An inverse callback: given storage and "now", undo one operation.
pub type UndoCallback = Box<dyn FnOnce(&dyn Storage, i64) -> CoreResult<()> + Send>;

pub struct UndoStep {
    pub label: UndoAction,
    pub(crate) callback: UndoCallback,
}

impl UndoStep {
    pub(crate) fn run(self, storage: &dyn Storage, now_ms: i64) -> CoreResult<()> {
        (self.callback)(storage, now_ms)
    }
}

/// LIFO stack of reversible operations.
#[derive(Default)]
pub struct UndoLog {
    steps: Vec<UndoStep>,
}

impl UndoLog {
    pub fn record(&mut self, label: UndoAction, callback: UndoCallback) {
        self.steps.push(UndoStep { label, callback });
    }

    /// Action of the operation that would be undone next, if any.
    pub fn peek(&self) -> Option<&UndoAction> {
        self.steps.last().map(|s| &s.label)
    }

    pub fn pop(&mut self) -> Option<UndoStep> {
        self.steps.pop()
    }

    pub fn len(&self) -> usize {
        self.steps.len()
    }

    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }

    pub fn clear(&mut self) {
        self.steps.clear();
    }
}
