# ADR-035: Bounded undo stack and paged `undo_history` IPC

**Status:** Proposed (2026-11-28)
**Date:** 2026-11-28

## Context

Owner feedback (F4) and performance profiling highlighted two issues with undo:

1. `UndoLog` stored an unbounded `Vec<UndoStep>` in memory.
2. Toolbars across decks, calendar, habits, and matrix exposed bare "Undo" buttons that acted across screens without showing the user what would be undone or letting them inspect recent changes.

Persisted cross-restart undo journals require a schema migration and are scheduled for a later feature card (`FEAT-UNDO`).

## Decision

1. **Bound `UndoLog` at `MAX_UNDO_STEPS = 200`** using a `VecDeque<UndoStep>`, evicting the oldest entry on push.
2. **Track timestamp (`created_at_ms`) per recorded step** and expose `Collection::undo_history(page: u32) -> UndoHistoryPage` returning 20 newest-first items (`items`, `total`, `page`, `page_size`) where `can_undo` is `true` only on the top step (index 0 on page 0).
3. **Expose read-only IPC `undo_history(page?: number)`** in `APP_COMMANDS`, `generate_handler!`, `lib/ipc.ts`, and `previewMocks.ts`, backing a paged Activity view while keeping `Ctrl+Z`, action-specific 8 s toasts (`"<action> · Undo"`), and study's in-session `← Previous card` undo control.

## Consequences

- Zero schema migration (`user_version` stays v15).
- Bounded memory footprint for long sessions.
- Clear migration path to `FEAT-UNDO` persistent storage later.
