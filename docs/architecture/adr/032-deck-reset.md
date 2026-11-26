# ADR-032: Deck progress reset and `deck_card_ids` IPC

**Status:** Accepted (2026-11-26)
**Date:** 2026-11-26

## Context

Users need a way to reset all cards in a deck (and optionally its non-filtered subdecks) back to the new queue from the deck menu (`Reset progress…`), with a confirmation dialog showing the exact card count and options to include subdecks and reset `reps` and `lapses`.

Card reset logic already exists in `Collection::forget_cards(card_ids, reset_counts)` (which resets `type = 0, queue = 0`, assigns sequential `due` positions, clears FSRS memory fields, records one `UndoAction::ForgetCards`, and emits `DomainEvent::CardAnswered`). However, the frontend only had `search_cards` (paginated `CardRow`s using `deck:Name*` `LIKE 'Name%'`, which can match sibling prefixes such as `Name2`) and had no direct way to fetch the exact card IDs belonging to a deck or its non-filtered subtree.

## Decision

1. **Add `Storage::deck_card_ids(&self, deck_ids: &[i64]) -> CoreResult<Vec<i64>>`** in `bibalak-core::ports::study`, implemented in `SqliteStorage` (`bibalak-db::cards::deck_card_ids`) and `FakeStorage`.
2. **Add `Collection::deck_card_ids(&self, deck_id: i64, include_subdecks: bool) -> CoreResult<Vec<i64>>`** in `bibalak-core`. It validates that `deck_id` exists (`CoreError::NotFound`), resolves `study_subtree(deck_id)` when `include_subdecks` is `true` (excluding filtered subdecks) or `vec![deck_id]` when `false`, and returns matching `cards.id` ordered deterministically.
3. **Expose one read-only Tauri IPC command `deck_card_ids(deck_id: i64, include_subdecks: bool) -> Vec<i64>`** (added to `APP_COMMANDS` in `build.rs`, `generate_handler!`, `lib/ipc.ts`, and `previewMocks.ts`).
4. **Reuse `Collection::forget_cards`** for the reset write itself — no new scheduler or undo code, no database schema change, and full undo support (`UndoAction::ForgetCards`).

## Consequences

- Zero schema migration (`user_version` stays v15) and zero duplication of scheduling/forget rules.
- Exact subtree scoping by `deck_id` (not string prefix matching), safe for deck names containing spaces, quotes, or shared prefixes.
- Filtered decks are excluded when resetting a parent deck with `include_subdecks = true`, and filtered decks do not expose `Reset progress…` in the deck menu.
- Closed in a follow-up: `deck_card_ids` also matches `original_deck_id` in the deck set, and `forget_cards` returns any filtered-deck card to its home deck (`deck_id = original_deck_id`, `original_deck_id = 0`, `original_due = 0`) in the same transaction before resetting it, with one undo step restoring filtered-deck membership and scheduling state.
