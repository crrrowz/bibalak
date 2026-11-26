# ADR-031: Scoped Deck Export, Streaming Media ZIP Writer, and Export Cancellation (`EXP1`)

**Status:** Accepted (D48, 2026-11-26) — Phase 2 builds it after the `STUDY1` merge  
**Date:** 2026-11-26  
**Card:** `EXP1` (fixes `BW2-17`)  
**Related:** Deck Export Spec · [ADR-001](001-clean-architecture.md) · [ADR-007](007-note-ids-and-checksums.md) · [ADR-010](010-media-store.md) · [ADR-029](029-ipc-security-hardening.md) · [ADR-030](030-note-type-presets.md) · `decisions.md` (`D6`, `D32`, `D45`)

---

## Context

`BW2-17` identified three structural limitations in Bibalak's `.apkg` export pipeline (`apps/desktop/src-tauri/src/commands/export.rs`, `crates/bibalak-ankifmt/src/writer.rs`):

1. **Public IPC API has no scope or options:** `export_package(path: String) -> u32` accepts only a file path. There is no way to export a single deck (with or without subdecks), toggle media, toggle scheduling history, track progress, or cancel a running export.
2. **Full-collection SHA-1 hashing & RAM buffering:** `write_apkg_with_media` calls `MediaStore::list()` (which lazily computes SHA-1 on every unhashed file in `collection.media/`, reading all 400 MB on a cold index) and `MediaStore::read()` into `Vec<(String, Vec<u8>)>`, materializing the entire media folder in RAM before writing a byte to the ZIP. `build_sqlite` likewise reads the full temp SQLite database back into `Vec<u8>`.
3. **Non-atomic output:** `zip::ZipWriter` writes directly to `dest_path`, so an error or interruption leaves a corrupt partial `.apkg` at the user's chosen path.

Because `EXP1` changes the public IPC contract (`export_package`, new commands/events, new `CoreError`/`IpcErrorKind` variant) and extends the `MediaStore` port trait (`ADR-001`, `ADR-010`), an ADR is required before Phase 2 implementation (`AGENTS.md` "Agent workflow" §3).

---

## Decision

### 1. Extend `MediaStore` Port for Streaming Reads (`bibalak-core::ports`)

Add a streaming read method to `MediaStore` (`crates/bibalak-core/src/ports/mod.rs`) without introducing `std::fs` or filesystem paths into `bibalak-core`:

```rust
fn open_reader(&self, filename: &str) -> CoreResult<Box<dyn std::io::Read + Send>> {
    Ok(Box::new(std::io::Cursor::new(self.read(filename)?)))
}
```

- `FsMediaStore` (`crates/bibalak-media/src/lib.rs`) overrides `open_reader` to validate `filename` via `validate_media_filename` and return `Box::new(std::io::BufReader::new(fs::File::open(self.root.join(filename))?))`.
- Export enumerates available files using the existing hash-free `MediaStore::list_sizes()` (`crates/bibalak-media/src/lib.rs:L610`), completely eliminating cold-cache SHA-1 hashing during export.

### 2. Scoped Export, Media Filtering & Scheduling Stripping (`bibalak-core` + `bibalak-db`)

- Add `dump_collection_scoped(conn, deck_ids: Option<&[i64]>, include_revlog: bool) -> CoreResult<CanonicalModel>` in `crates/bibalak-db/src/export.rs` (keeping `dump_collection` as `(conn, None, true)`).
- Pure preparation logic in `bibalak-core` resolves `deck_and_descendants(deck_id)` when `include_subdecks == true`, preserves full `::`-delimited deck names, rejects filtered decks (`CoreError::Invalid`, hidden in UI), and strips scheduling/FSRS fields to Anki new-card defaults when `include_scheduling == false` (default off for deck export, on for collection export).
- Media selection (`include_media == true`):
  - **Collection scope:** Packs **all** regular files in `collection.media` enumerated via `list_sizes()` (backup semantics).
  - **Deck scope:** Filters strictly to local media referenced by exported note fields, template `qfmt`/`afmt`, and notetype `css` via `bibalak_core::media_refs::extract_media_refs` (extended to also match `<script ... src=...>`, so `_`-prefixed assets are included only when referenced).
- Missing media files on disk are skipped without failing the export and counted in `ExportSummary.media_skipped_missing`.
- Browse-selection export is deferred to a later card outside `EXP1` Phase 2.

### 3. Streaming `.apkg` Writer & Atomic Temp-File Replacement (`bibalak-ankifmt`)

Add `write_apkg_streaming` in `crates/bibalak-ankifmt/src/writer.rs` (keeping existing `write_apkg` / `write_apkg_with_media` wrappers for test backwards compatibility or delegating to the streaming path):

- Writes `collection.anki2` to a temp directory via `rusqlite`, closes the DB, and copies it into `ZipWriter<BufWriter<File>>` (256 KB buffer) via `std::io::copy` — zero full-DB `Vec<u8>` buffer.
- Streams each selected media file from `MediaStore::open_reader` in 64 KB chunks — zero full-archive `Vec<u8>` buffer.
- Polls `cancel: &AtomicBool` between notes/cards, SQLite copy, and every 64 KB media chunk; emits throttled `ExportProgress` callbacks.
- Writes the ZIP to a sibling temp file (`<parent>/.<name>.keepsake-partial-<export_id>`) guarded by a RAII cleanup guard that deletes the temp file on any error or cancellation, renaming atomically onto `dest_path` only after `zip.finish()` and `flush()` succeed.

### 4. Public IPC Contract, Events, Cancellation & Security (`bibalak-core::ipc`, `src-tauri`)

- **Breaking/updated IPC shape (single monorepo client):** Replace `export_package(path: String) -> u32` with:
  - `get_export_estimate(scope: ExportScope, include_media: bool) -> IpcResult<ExportEstimate>`
  - `export_package(request: ExportPackageRequest) -> IpcResult<ExportSummary>`
  - `cancel_export(export_id: String) -> IpcResult<bool>`
- **Progress event:** `bibalak://export-progress` emitting `ExportProgress` (`export_id`, `stage`, `notes_done`/`notes_total`, `cards_done`/`cards_total`, `media_done`/`media_total`, `bytes_done`/`bytes_total`), matching the existing `bibalak://import-progress` pattern (`commands/import.rs:L31`).
- **Cancellation error variant:** Add `CoreError::Cancelled` and `IpcErrorKind::Cancelled` so the frontend handles user cancellation without parsing error text.
- **Per-job cancel registry:** Managed Tauri state `ExportJobsState` (`Mutex<HashMap<String, Arc<AtomicBool>>>`) keyed by client-supplied `export_id` (validated non-empty, ≤ 64 chars).
- **Security (`ADR-029`):**
  - `export_package` continues to verify `request.path` exclusively through `PickedPathsState::verify_save_file(&request.path, &["apkg"])` (rejecting unpicked paths, traversal, UNC paths, and `data_dir`).
  - `get_export_estimate`, `export_package`, and `cancel_export` are added to `APP_COMMANDS` (`build.rs`) and granted only to the `main` window (`capabilities/default.json`), **never** to `quick-add` (`capabilities/quick-add.json`).
- **No new Rust or npm dependencies:** Uses existing workspace `zip` (`9`), `rusqlite` (`0.42`), `tempfile` (`3`), `serde`, `ts-rs`, and standard library I/O/atomics (`D6`).

---

## Alternatives Considered

1. **Keep `export_package(path)` and add a separate `export_deck_package(...)` command:**  
   Rejected because Settings collection export also needs `include_media`, `include_scheduling`, progress events, and cancellation (`BW2-17`). One `ExportPackageRequest` with `ExportScope` serves both entry points and future scopes (such as Browse selection) without duplicating streaming, cancellation, or guard logic.
2. **Use Anki `.colpkg` / v18 protobuf format for deck exports:**  
   Rejected for `EXP1`. Anki v11 `.apkg` (`writer.rs`) already opens in every Anki version ≥ 2.0 and round-trips cleanly through `reader.rs`. Switching container format is orthogonal and can be added later without changing the IPC contract.
3. **Keep media in memory and only add `include_media` filtering:**  
   Rejected because a single deck with heavy audio/video can still exceed 200–400 MB, and `MediaStore::list()` would still waste time hashing unrelated files on disk.

---

## Consequences

- **Positive:**
  - Peak memory during export drops from `O(total media bytes)` (400+ MB) to `O(1)` (~320 KB of stream/ZIP buffers).
  - Cold-cache export skips 400 MB of redundant SHA-1 disk reads.
  - Deck export includes only the cards, notes, notetypes, and media that belong to that deck (and optional subdecks).
  - Cancellation is responsive mid-stream and never leaves a corrupt or partial `.apkg` on disk.
  - Pure core + platform-agnostic `MediaStore::open_reader` keeps desktop, future mobile (`MOB`), and web (`W1`) aligned (`D45`).
- **Negative / Migration:**
  - `export_package`'s IPC signature changes from `(path: String) -> u32` to `(request: ExportPackageRequest) -> ExportSummary`, requiring updates to `apps/desktop/src/lib/ipc.ts`, `SettingsScreen.tsx`, `CommandPalette.tsx`, their tests, and `packages/ipc-types`.
  - No database schema migration (`v15` unchanged).
