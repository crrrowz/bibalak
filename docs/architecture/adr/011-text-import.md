# ADR-011: CSV/TSV and Markdown text import

**Status:** Accepted  
**Date:** 2026-11-14

## Context

Users frequently bring flashcards from spreadsheets (CSV, TSV, semicolon-delimited text) or Markdown study notes. Previously Bibalak only imported binary Anki packages (`.apkg` / `.colpkg`). Adding text import must respect Bibalak's clean architecture boundaries (`ADR-001`) and Anki-compatible duplicate detection (`ADR-007`).

## Decision

1. **Dependencies scoped to the adapter crate (`crates/bibalak-ankifmt`):**
   - Add `csv = "1"` for RFC 4180 CSV/TSV/semicolon parsing (handling quoted fields with embedded newlines, delimiter auto-detection, and exact 1-based record line numbers).
   - Add `pulldown-cmark = "0.13"` for rendering Markdown note bodies to HTML, supporting `##` heading sections, `Q:` / `A:` pairs, and `==text==` cloze conversion (`{{cN::text}}`).
   - Keep `bibalak-core` and `bibalak-db` free of `csv` and `pulldown-cmark` dependencies.

2. **Clean core port and incremental sync:**
   - `bibalak-core::ipc` defines typed preview/mapping/result DTOs exported to TypeScript (`TextImportFormat`, `TextImportDelimiter`, `DuplicatePolicy`, `TextColumnTarget`, `TextImportOptions`, `TextImportError`, `TextImportPreview`, `TextImportMapping`, `TextImportSummary`).
   - `bibalak-core::ports::Storage::import_text_notes` imports parsed `ParsedTextNote` entries inside a single SQLite transaction, resolving duplicates via Anki's first-field SHA-1 checksum (`field_checksum`, `ADR-007`) with `skip`, `update`, or `keep-both` policies and reporting skipped/invalid lines with 1-based line numbers.
   - `Collection::import_text_notes` validates the target deck (rejecting filtered decks) and note type, delegates to `Storage::import_text_notes`, and emits `DomainEvent::NotesUpdated` and `DomainEvent::DeckChanged` so the Tantivy search index updates incrementally in one batch.

3. **Thin Tauri IPC & Desktop UI:**
   - `preview_text_import(path, options)` returns the detected format/delimiter, columns, first 20 sample rows, total row count, and parse warnings.
   - `import_text(path, mapping)` parses the file in `bibalak_ankifmt::text_import` and commits via `Collection::import_text_notes`.
   - `TextImportDialog` provides format/delimiter/header/HTML options, live 20-row preview table, per-column mapping selectors (field / tags / ignore), deck and note type pickers, and duplicate policy selection.

## Consequences

- `bibalak-core` remains pure and zero-IO; `bibalak-db` stays decoupled from file formats.
- Single-transaction batch import handles 10,000+ rows cleanly while keeping incremental search indexing fast.
