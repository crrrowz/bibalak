# ADR-010: MediaStore port and Anki-compatible disk media storage

**Status:** Accepted
**Date:** 2026-11-14

## Context

Previously, media ingestion lived directly inside Tauri IPC commands (`apps/desktop/src-tauri/src/commands/media.rs`) using `std::collections::hash_map::DefaultHasher` and renaming every file to `<stem>-<hash>.<ext>`, while orphan detection and deletion lived inside `commands/maintenance.rs` and `.apkg` import/export read and wrote files directly in `collection.media/`. `crates/bibalak-media` was an empty stub and `bibalak_core::ports::MediaStore` was an empty marker trait.

Renaming files to hash strings breaks card compatibility and `.apkg` exports when Anki expects original filenames, `DefaultHasher` is neither portable across Rust versions nor Anki-compatible (SHA-1), and putting filesystem/dedup logic in Tauri commands bypasses clean architecture boundaries (ADR-001).

## Decision

1. **Pure port in `bibalak-core::ports`:**
   - Extend `Storage` with `note_media_ref_counts()` (distinct notes referencing each `<img src>` or `[sound:]`) and `rewrite_media_ref(old_name, new_name, now_ms)` (updating `fields`, `sort_field`, `checksum`, `fields_norm`, `mod`, `usn = -1`).
   - Define `MediaEntry { filename, size_bytes, sha1 }` and flesh out `MediaStore`:
     - `add(filename, bytes) -> CoreResult<String>`
     - `read(filename) -> CoreResult<Vec<u8>>`
     - `list() -> CoreResult<Vec<MediaEntry>>`
     - `usage_counts(storage: &dyn Storage) -> CoreResult<BTreeMap<String, u32>>`
     - `find_unused(storage: &dyn Storage) -> CoreResult<Vec<String>>`
     - `check_media(storage: &dyn Storage) -> CoreResult<MediaReport>`
     - `delete(filenames: &[String]) -> CoreResult<u32>`
     - `rename(storage: &dyn Storage, old_name, new_name, now_ms) -> CoreResult<u32>`
   - Keep `bibalak-core` free of `std::fs` and filesystem paths; `data_dir` path resolution stays in the Tauri shell.

2. **Filesystem adapter in `bibalak-media` (`FsMediaStore`):**
   - Preserve original filenames by default.
   - Deduplicate by SHA-1 (`sha1 = "0.10"`, matching Anki): identical bytes anywhere in the store return the existing filename with zero duplicate writes.
   - Resolve filename collisions with different content by appending numeric suffixes (`name-1.ext`, `name-2.ext`, ...).
   - Reject path traversal (`..`, `/`, `\`, `:`, NUL, empty, absolute/drive paths) with `CoreError::Invalid` across all methods.
   - Keep no sidecar metadata files inside `collection.media/` so directory exports/backups remain pure Anki media folders; maintain a lazy in-memory index (`name -> (size, mtime, Option<sha1>)` and `size -> names`) updated in-place on `add`/`delete`/`rename`, hashing only same-size candidates outside the index lock and re-scanning only on directory-mtime change, `list`, `usage_counts`, `find_unused`, or `check_media`.

3. **Adapters and thin Tauri shell:**
   - `bibalak-ankifmt` routes `.apkg` media extraction and bundling through `read_package_with_media` and `write_apkg_with_media`, rewriting imported note refs if a collision suffix or SHA-1 dedup renames an entry.
   - `apps/desktop/src-tauri` manages `MediaState(Arc<dyn MediaStore>)` built from `data_dir(app).join("collection.media")`, serves `bibalak-media://` via `MediaState::read`, and makes `commands/media.rs`, `commands/maintenance.rs`, `commands/import.rs`, and `commands/export.rs` thin delegations.

## Consequences

- Tauri commands contain zero media storage, hashing, or orphan-scanning logic.
- Media files keep Anki-valid original names, identical files are stored once (including repeated `.apkg` imports), and renames atomically update note fields with rollback on storage failure.
- No new third-party dependencies were added to `Cargo.lock` beyond existing workspace crates (`sha1`).
