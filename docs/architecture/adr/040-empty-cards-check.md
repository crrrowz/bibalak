# ADR-040: Empty Cards Check and Removal IPC

- **Status:** Proposed (2026-11-28)
- **Date:** 2026-11-28

## Context

When templates or note fields are edited (for example clearing a field or removing a cloze marker), previously generated cards can begin rendering an empty question stem. Anki exposes a dedicated **Empty Cards** check (`find_empty_cards` / `remove_empty_cards`) so users can inspect every empty card and delete only those cards with explicit confirmation, rather than deleting them silently during note save.

## Decision

Add two IPC commands scoped to Browse:

- `find_empty_cards() -> Vec<EmptyCardItem>`: evaluates every note using the canonical `expected_card_ords` logic and returns existing cards whose `ord` is no longer expected.
- `delete_empty_cards(card_ids: Vec<i64>) -> u32`: re-verifies each supplied `card_id` is still empty inside a SQLite transaction, deletes only those cards (`DELETE FROM cards WHERE id = ?1`), clears the in-memory undo stack, and emits `DomainEvent::SchemaChanged`.

## Consequences

- Matches Anki: empty cards are never deleted silently while editing; users trigger cleanup deliberately with confirmation.
- Requires one new exported IPC DTO `EmptyCardItem`.
