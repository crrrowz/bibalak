//! Undo log.
//!
//! Each mutating use-case records an *inverse* action that, given storage and
//! the current time, reverses the change. This is separate from the event bus:
//! events are for notification, the undo log is for reversal. Redo (replaying
//! forward actions popped during undo) is a later-milestone extension.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::CoreResult;
use crate::ports::Storage;

/// Maximum number of undo steps retained in memory (F4 / A5-20).
pub const MAX_UNDO_STEPS: usize = 200;

/// Default page size for the paged Activity history view (F4).
pub const UNDO_HISTORY_PAGE_SIZE: u32 = 20;

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
    ResetDeckProgress { name: String, count: u32 },
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

/// One newest-first entry in the paged Activity / undo history (F4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UndoHistoryEntry {
    pub action: UndoAction,
    #[ts(type = "number")]
    pub created_at_ms: i64,
    /// `true` only for the top of the stack (most recent undoable action).
    pub can_undo: bool,
}

/// One page of newest-first in-memory undo history (F4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UndoHistoryPage {
    pub items: Vec<UndoHistoryEntry>,
    pub total: u32,
    pub page: u32,
    pub page_size: u32,
}

/// An inverse callback: given storage and "now", undo one operation.
pub type UndoCallback = Box<dyn FnOnce(&dyn Storage, i64) -> CoreResult<()> + Send>;

pub struct UndoStep {
    pub label: UndoAction,
    pub created_at_ms: i64,
    pub(crate) card_id: Option<i64>,
    pub(crate) callback: UndoCallback,
}

impl UndoStep {
    pub(crate) fn run(self, storage: &dyn Storage, now_ms: i64) -> CoreResult<()> {
        (self.callback)(storage, now_ms)
    }
}

/// Bounded LIFO stack of reversible operations (`MAX_UNDO_STEPS` = 200).
#[derive(Default)]
pub struct UndoLog {
    steps: VecDeque<UndoStep>,
}

impl UndoLog {
    pub fn record(&mut self, label: UndoAction, callback: UndoCallback) {
        self.record_at(label, 0, callback);
    }

    pub fn record_at(&mut self, label: UndoAction, created_at_ms: i64, callback: UndoCallback) {
        self.push_bounded(UndoStep {
            label,
            created_at_ms,
            card_id: None,
            callback,
        });
    }

    pub fn record_with_card(&mut self, label: UndoAction, card_id: i64, callback: UndoCallback) {
        self.record_with_card_at(label, card_id, 0, callback);
    }

    pub fn record_with_card_at(
        &mut self,
        label: UndoAction,
        card_id: i64,
        created_at_ms: i64,
        callback: UndoCallback,
    ) {
        self.push_bounded(UndoStep {
            label,
            created_at_ms,
            card_id: Some(card_id),
            callback,
        });
    }

    fn push_bounded(&mut self, step: UndoStep) {
        while self.steps.len() >= MAX_UNDO_STEPS {
            self.steps.pop_front();
        }
        self.steps.push_back(step);
    }

    /// Return one newest-first page (`page` is 0-indexed) of recorded actions.
    pub fn history(&self, page: u32, page_size: u32) -> UndoHistoryPage {
        let size = page_size.clamp(1, 100);
        let offset = (page as usize).saturating_mul(size as usize);
        let items = self
            .steps
            .iter()
            .rev()
            .enumerate()
            .skip(offset)
            .take(size as usize)
            .map(|(idx, step)| UndoHistoryEntry {
                action: step.label.clone(),
                created_at_ms: step.created_at_ms,
                can_undo: idx == 0,
            })
            .collect();
        UndoHistoryPage {
            items,
            total: self.steps.len() as u32,
            page,
            page_size: size,
        }
    }

    /// Action of the operation that would be undone next, if any.
    pub fn peek(&self) -> Option<&UndoAction> {
        self.steps.back().map(|s| &s.label)
    }

    pub fn pop(&mut self) -> Option<UndoStep> {
        self.steps.pop_back()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a5_20_undo_log_is_bounded() {
        let mut log = UndoLog::default();
        for i in 0..10_000 {
            log.record(
                UndoAction::CreateDeck {
                    name: format!("D{i}"),
                },
                Box::new(|_, _| Ok(())),
            );
        }
        assert_eq!(log.len(), MAX_UNDO_STEPS);
        assert!(log.len() <= 1_000);
        assert_eq!(
            log.peek(),
            Some(&UndoAction::CreateDeck {
                name: "D9999".into()
            })
        );
    }

    #[test]
    fn f4_undo_history_is_newest_first_and_paged() {
        let mut log = UndoLog::default();
        for i in 0..25 {
            log.record_at(
                UndoAction::CreateDeck {
                    name: format!("Deck {i}"),
                },
                1_000 + i,
                Box::new(|_, _| Ok(())),
            );
        }
        let p0 = log.history(0, UNDO_HISTORY_PAGE_SIZE);
        assert_eq!(p0.total, 25);
        assert_eq!(p0.page, 0);
        assert_eq!(p0.page_size, 20);
        assert_eq!(p0.items.len(), 20);
        assert_eq!(
            p0.items[0].action,
            UndoAction::CreateDeck {
                name: "Deck 24".into()
            }
        );
        assert!(p0.items[0].can_undo);
        assert!(!p0.items[1].can_undo);

        let p1 = log.history(1, UNDO_HISTORY_PAGE_SIZE);
        assert_eq!(p1.items.len(), 5);
        assert!(!p1.items[0].can_undo);
        assert_eq!(
            p1.items[4].action,
            UndoAction::CreateDeck {
                name: "Deck 0".into()
            }
        );
    }
}
