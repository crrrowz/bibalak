# ADR-012: Single-pass collection stats and `revlog(id, card_id)` index

Date: 2026-11-14
Status: Accepted

## Context

Profiling a 100,000-note / 150,543-revlog collection (`cargo run --release -p bibalak-db --example perf`)
identified two remaining hot paths after ADR-005 and ADR-009:

1. `stats()` (`571.0 ms` all-collection 365d, `356.8 ms` deck-filtered 30d on Windows release) ran
   repeated full scans over `revlog` joined to `cards`, re-evaluated `SELECT MIN(id) FROM revlog GROUP BY card_id, day`
   four times (including in `deck_stats`), and executed six separate full scans of `cards` for card-maturity
   and backlog snapshot counts.
2. `study_queue()` (`14.7 ms` on a parent deck) evaluated `ROW_NUMBER() OVER (ORDER BY due)` across every
   eligible new card in a sub-deck before `LIMIT new_limit`, even though a card past rank
   `new_limit + NEW_ORDER_JITTER` can never finish inside the top `new_limit`.

## Decision

1. **Migration v5 → v6 (`idx_revlog_stats`):** Add `CREATE INDEX idx_revlog_stats ON revlog(id, card_id)`
   in `schema.rs` so timestamp-bounded `revlog -> card_id` queries (including `today_studied`) read
   a compact covering B-tree index.
2. **Single-pass `cards` + single-pass `revlog` aggregation (`stats.rs`):** Scan `cards ORDER BY id`
   once (computing maturity counts, forecast buckets, FSRS distributions, deck rollups, and a sorted
   `(card_id, deck_id)` lookup table) and scan `revlog ORDER BY id` once in ascending timestamp order.
   Because `id` increases monotonically, collection-day indexes are non-decreasing and a single per-day
   `HashSet<i64>` identifies exact `MIN(id)` first answers without SQLite temporary B-tree sorts.
3. **Bounded new-card fetch (`study.rs`):** Cap the inner `ORDER BY due` subquery at
   `new_limit + NEW_ORDER_JITTER` rows using `idx_cards_study`, preserving identical ranking and
   jitter reachability while scanning a constant small prefix.

## Consequences

- `stats_all_365d_ms` improves from `571.0 ms` to `75.1 ms` and `stats_deck_30d_ms` from `356.8 ms`
  to `64.3 ms` with identical `StatsDto` outputs.
- `next_card_top_deck_ms` drops from `14.7 ms` to `7.5 ms`.
- Adding `idx_revlog_stats` on `(id, card_id)` adds +3.6 MB (67.1 -> 70.7 MB) and keeps 100k bulk
  import within ~10%.
