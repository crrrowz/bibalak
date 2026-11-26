# ADR-005: Covering index for the study queue and deck counts

**Status:** Accepted
**Date:** 2026-11-13

## Context

The 100k-card benchmark (`docs/architecture/performance/README.md`) showed the two things users
feel most, the next card after every answer (57 ms) and the home-screen deck
list with due counts (48 ms), growing much faster than the data. Their queries
filter on `deck_id`, `type` and `due` with `queue NOT IN (-1, -2, -3)`; the
only card index, `idx_cards_sched(deck_id, queue, due)`, can serve the
`deck_id` part only, so SQLite read every card row of the deck.

"Studied today" (`study::today_studied`) joined `cards` to `revlog`; the
planner started from all cards of the deck and probed the review log per card,
instead of reading only today's reviews.

## Decision

1. Migration v3 → v4 adds
   `idx_cards_study ON cards(deck_id, type, due, queue)`. Together with the
   rowid it covers the study-queue, per-type count and deck-count queries, so
   they never touch the table. `idx_cards_sched` stays for queries that filter
   on `queue` directly.
2. `TODAY_STUDIED_SQL` uses `revlog r CROSS JOIN cards c`, which fixes the
   join order: SQLite reads today's slice of the review log (its primary key
   is the review timestamp) and looks each card up by id.
3. No `ANALYZE` in the migration: on a new, empty collection it would store
   misleading statistics. The plans use the index without them.

Tests in `crates/bibalak-db/src/migrations.rs` check the plans with
`EXPLAIN QUERY PLAN` (covering index for the five study/count queries, revlog
range first for "studied today") and that a v3 collection upgrades in place.

## Consequences

- 100k cards, same machine: next card 57 → 16.5 ms, deck list 48 → 20 ms.
- The file grows by about 4 % (45.7 → 47.4 MB) and bulk import is about 12 %
  slower (1.32 → 1.50 s) because the index is maintained on insert.
- Existing collections build the index once on first open after the update
  (about a second at 100k cards), inside the migration transaction.
- A shipped migration is never edited; any later index change is a new
  migration.
