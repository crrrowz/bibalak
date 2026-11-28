# ADR-034: Full deck progress reset (`reset_deck_progress` IPC)

**Status:** Proposed (2026-11-28)
**Date:** 2026-11-28

## Context

Owner testing (F1) showed that reusing `forget_cards` for Deck Menu **Reset progress…** leaves the deck's `revlog` rows (plus adds `review_kind = 4` markers), `progress_ledger` XP/gold rows, `game_pet_credits`, and `day_limit_overrides` intact. As a result, a deck whose user studied 70 learning/relearning cards and clicked Reset opened with 0 New cards instead of the full daily new limit and kept the wiped session's XP and daily quests active. Browse's card-level **Forget** must remain Anki-compatible, whereas deck-level **Reset progress…** must give a clean fresh start for that deck while keeping user level, achievements already unlocked, and existing gold spends (`available_gold_cents >= 0`).

## Decision

1. **Add `bibalak_db::deck_reset` + `StudyStore::{reset_deck_progress, restore_deck_reset}`** running inside one SQLite transaction:
   - Return any deck card currently inside a filtered deck back to its home deck, and reset all matching cards (`type = 0, queue = 0, reps = 0, lapses = 0, interval = 0, ease_factor = 0, fsrs_* = NULL`).
   - Delete matching `revlog` rows (`DELETE FROM revlog WHERE card_id IN ...`) with no `review_kind = 4` marker.
   - Soft-delete matching `card_review:<card_id>:<day>` rows in `progress_ledger`, revoke their `game_pet_credits` via `revoke_pet_credit_tx`, clear today's `day_limit_overrides` for those decks, and call `invalidate_all_earned_xp_caches_tx` + `invalidate_studied_top_decks_tx`.
   - Call `reconcile_motivation(true)` and emit `DeckChanged`, `SchemaChanged`, and `GameChanged`.
2. **Expose `reset_deck_progress(deck_id, include_subdecks?) -> u32`** in `APP_COMMANDS`, `generate_handler!`, `lib/ipc.ts`, and `previewMocks.ts`, recording `UndoAction::ResetDeckProgress { name, count }` with full transactional undo restoration (`restore_deck_reset`).
3. **Note Anki sync boundary:** Standard Anki sync does not propagate revlog deletion to remote servers; document this in sync/reset notes.

## Consequences

- No schema migration required (`user_version` stays v15).
- Gold remains clamped via `available_gold_cents = earned.saturating_sub(spent) >= 0`.
- Unlocked achievements and cosmetics stay intact.
