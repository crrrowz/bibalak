# Performance

## Benchmark

`crates/bibalak-db/examples/perf.rs` builds a synthetic collection through
the real bulk-import path and times what users feel. Run it in release mode:

```sh
cargo run --release -p bibalak-db --example perf                 # 100k notes
cargo run --release -p bibalak-db --example perf -- --notes 20000
cargo run --release -p bibalak-db --example perf -- --check       # vs baseline.json
```

The collection: 100,000 notes/cards in 20 decks (two levels), 40 % new,
10 % learning, 50 % review (due −30…+60 days), ~150,000 review-log rows,
1–5 tags per note from 200, mixed English/Arabic text; 47.4 MB on disk. Each
step's **median** of 5 runs is reported and written to
`target/perf/results.json`.

`--check` fails when a step is more than 1.5× slower than
[`baseline.json`](baseline.json) (and more than 1 ms). Timings depend on the
machine, so compare runs on the same computer; regenerate the baseline when
hardware or the data generator changes.

## Baseline (2026-11-13)

Machine: AMD Ryzen 7 3700X, 32 GB RAM, SSD, Windows 11; release build.

| Step                       | What the user does                                   | Before | Cache tuning | + study index (ADR-005) |
| -------------------------- | ---------------------------------------------------- | ------ | ------------ | ----------------------- |
| `open_ms`                  | App start (open collection)                          | 2.6 ms | 2.5 ms       | 1.9 ms                  |
| `deck_list_with_counts_ms` | Home screen deck list with due counts                | 231 ms | 48 ms        | **20 ms**               |
| `next_card_top_deck_ms`    | Next card after every answer (deck with 4 sub-decks) | 181 ms | 57 ms        | **16.5 ms**             |
| `search_tag_due_ms`        | Browse: `tag:t7 is:due`                              | 2.7 ms | 2.3 ms       | 2.6 ms                  |
| `search_text_ms`           | Browse: two words                                    | 1.6 ms | 1.7 ms       | 1.8 ms                  |
| `stats_all_365d_ms`        | Stats screen, whole collection, one year             | 805 ms | 567 ms       | 628 ms                  |
| `stats_deck_30d_ms`        | Stats screen, one deck tree, 30 days                 | 909 ms | 362 ms       | 375 ms                  |
| `search_index_rebuild_ms`  | Full-text index rebuild (background, at start)       | 882 ms | 860 ms       | 970 ms                  |
| `import_ms`                | Import 100k notes + 150k reviews                     | 1.38 s | 1.32 s       | 1.50 s                  |

At 20,000 notes everything except stats was under 10 ms; deck counts and the
study queue grew far faster than the data (×27 and ×19 for ×5 cards) because
SQLite's default 2 MiB page cache could not hold a 45 MB collection's hot pages.

### Changes made

`SqliteStorage::init` sets `cache_size = 64 MiB`, `mmap_size = 256 MiB` and
`temp_store = MEMORY`. No schema change. Memory cost: up to 64 MiB of cache
per open collection (desktop opens one). **The future server (SaaS) must
lower these per user**.

[ADR-005](../adr/005-study-index.md) adds the covering index
`cards(deck_id, type, due, queue)` (migration v4) and makes "studied today"
read only today's review-log slice. Cost: +4 % file size, +12 % bulk import
time, a one-time index build when an existing collection is first opened.
Stats and the index rebuild moved within run-to-run noise.

## Follow-ups completed (2026-11-14, E8 / ADR-012)

Measured on the 100,000-note / 150,543-revlog benchmark (Windows 11 release):

| Step                    | Pre-E8 baseline | After E8    | Speedup |
| ----------------------- | --------------- | ----------- | ------- |
| `next_card_top_deck_ms` | 14.7 ms         | **7.5 ms**  | 2.0x    |
| `stats_all_365d_ms`     | 571.0 ms        | **75.1 ms** | 7.6x    |
| `stats_deck_30d_ms`     | 356.8 ms        | **64.3 ms** | 5.5x    |

1. **Next card (`7.5 ms`)**: `study_queue` now caps the inner new-card `ORDER BY due`
   scan at `new_limit + NEW_ORDER_JITTER` rows via `idx_cards_study`, preserving
   exact jitter reachability without ranking every new card in the sub-deck.
2. **Statistics (`64–75 ms`)**: [ADR-012](../adr/012-stats-revlog-index.md) adds
   `idx_revlog_stats ON revlog(id, card_id)` (migration v6) and replaces repeated
   `MIN(id) GROUP BY` subqueries and 6-pass card scans with one `cards ORDER BY id`
   scan plus one `revlog ORDER BY id` linear aggregation pass.
3. **Incremental search updates**: runtime edits/imports already call
   `index_rows_for_notes` incrementally; full `NoteIndex::rebuild` runs only when
   creating or repairing an index on open.
