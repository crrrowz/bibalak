# ADR-009: Arabic- and accent-insensitive search normalization

**Status:** Accepted
**Date:** 2026-11-14

## Context

Users studying Arabic and European-language decks frequently search without full vowel diacritics (_tashkeel_) or type normalized letter forms (`الاسلام` for `الإسلام`, `مدرسه` for `مَدْرَسَة`, `cafe` for `café`). Both search paths—the FTS5 full-text index (`bibalak-search`) and the Browse SQL `LIKE` query builder (`bibalak-db/src/search.rs`)—previously matched raw characters, causing missed hits on Arabic spelling variants and accented Latin words.

Adding a SQLite scalar UDF on every row during `WHERE ... LIKE` would introduce per-row FFI/allocation overhead on 100k-note collections, risking the 1.5× search latency budget. Meanwhile, structured facets (`tag:`, `deck:`, `note:`) must remain exact.

## Decision

1. **Pure shared normalizer (`bibalak-core::search_norm::normalize_search_text`):**
   - Depend on `unicode-normalization = "0.1"` in `crates/bibalak-core/Cargo.toml` (only adds `unicode-normalization`, with existing `tinyvec`, and zero network/IO dependencies).
   - Strip Arabic tashkeel (`U+064B–U+065F`, `U+0670`) and tatweel (`U+0640`), fold Arabic variants (`أ إ آ ٱ → ا`, `ة → ه`, `ى → ي`, `ؤ → و`, `ئ → ي`), lower-case text, and strip Latin combining diacritics via selective NFKD (`decompose_compatible` applied only when strippable combining diacritics are produced, keeping precomposed scripts such as Japanese kana intact, with an ASCII lowercase fast path).
2. **Symmetric FTS5 normalization (`bibalak-search`):**
   - Normalize `NoteIndexRow::text` during `NoteIndex::rebuild` and normalize plain-text terms in `build_match_expr`, keeping `tag:`, `deck:`, and `note:` exact.
3. **Database migration v4 → v5 (`notes.fields_norm`):**
   - Append migration v5 adding `notes.fields_norm TEXT NOT NULL DEFAULT ''` and backfilling existing notes in the migration transaction using `fields_norm_value(fields, sort_field)` (which includes `sort_field` when HTML inside the first field differs from the raw blob).
   - Populate `fields_norm` on all note inserts and updates (`browse`, `import`, undo restore, and note-type field mutations), while leaving `notes.fields` and `sort_field` untouched so rendered cards retain their original orthography.
   - Update `bibalak-db/src/search.rs` plain-text `LIKE` queries to match `n.fields_norm LIKE ?` with normalized query terms instead of `(n.fields LIKE ? OR n.sort_field LIKE ?)`, keeping `tag:`, `deck:`, and `note:` exact.

## Consequences

- `الاسلام`, `مدرسه`, and `cafe` match `الإسلام`, `مَدْرَسَة`, and `café` in both Browse SQL search and FTS5 search, while `tag:`/`deck:` filters remain exact.
- Storing `fields_norm` avoids per-row normalization during search and keeps `search_text_ms` fast on 100k-note collections at the cost of one extra text column per note.
- No unrelated dependencies in `Cargo.lock` are modified.
