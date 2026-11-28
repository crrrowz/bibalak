# ADR-033: Index for default Browse sort (`notes.sort_field COLLATE NOCASE`)

**Status:** Proposed (2026-11-28)
**Date:** 2026-11-28

## Context

The default Browse sort (`search_cards` / `search_note_rows` with `sort_key = Some("sort_field")`) orders rows by `n.sort_field COLLATE NOCASE`. Without an index on `notes(sort_field COLLATE NOCASE)`, `EXPLAIN QUERY PLAN` shows `USE TEMP B-TREE FOR ORDER BY`, forcing SQLite to scan and sort the entire result set on every page load.

Furthermore, `search_cards` previously ordered ties by `c.id` directly (`ORDER BY n.sort_field COLLATE NOCASE {dir}, c.id {dir}`). Because `notes` is indexed by `(sort_field COLLATE NOCASE, n.id)` rather than `c.id`, SQLite could not elide the temp B-tree across `notes` → `cards` unless `n.id` appears between `n.sort_field` and `c.id`.

## Decision

1. **Append migration v15 → v16** in `crates/bibalak-db/src/schema.rs` creating:
   ```sql
   CREATE INDEX idx_notes_sort_field
       ON notes(sort_field COLLATE NOCASE);
   ```
   (Shipped migrations v0–v15 are never edited.)
2. **Tie-break `search_cards` `sort_field` sort by `(n.sort_field COLLATE NOCASE, n.id, c.id)`** so SQLite walks `idx_notes_sort_field` as the outer loop and joins `cards` via `idx_cards_note(note_id)` in `c.id` order without allocating a temp B-tree.
3. **Keyset pagination and incremental Tantivy updates remain deferred** (outside this ADR/card).

## Consequences

- `user_version` advances from `15` to `16`. Existing v15 collections upgrade in place on first open (`run_with_backup` creates a pre-v15 safety copy).
- Default Browse page queries use `idx_notes_sort_field` without `USE TEMP B-TREE FOR ORDER BY`.
- Minor write overhead on `notes` insert/update to maintain the index.
