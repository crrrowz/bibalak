# ADR-037: Batch `list_deck_algorithms` IPC for Stats

**Status:** Proposed (2026-11-28)
**Date:** 2026-11-28

## Context

`StatsScreen` previously fired one `get_deck_config(deck_id)` IPC call per scoped deck on every mount (`O(D)` IPC round-trips) solely to learn which decks use `Algorithm::Fsrs`.

## Decision

1. **Expose read-only `list_deck_algorithms() -> Vec<DeckAlgorithmDto>`** returning `{ deck_id, algorithm }` for every deck in the collection.
2. **Deduplicate `get_deck_config(config_id)` reads in `Collection::list_deck_algorithms`** across shared `config_id`s with zero schema or port changes.
3. **`StatsScreen` calls `ipc.listDeckAlgorithms()` once** instead of fanning out N `ipc.getDeckConfig(d.id)` calls.

## Consequences

- Zero schema migration (`user_version` stays v16).
- Replaces N+1 `get_deck_config` IPC calls on Stats mount with a single round-trip.
