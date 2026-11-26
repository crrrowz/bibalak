# ADR-014: Sync Journal, Merge Rules, and Unified ID Architecture

**Status:** Accepted (owner, 2026-11-18, together with D27)  
**Date:** 2026-11-18  
**Card:** `S1a` (Backlog Step 6a; Decisions D3, D8; Spec the internal planning notes)  
**Gate:** Step 6 (Pre-requisite for Step 6b sync journal and merge engine implementation)

---

## 1. Context

Bibalak is a spaced-repetition desktop application designed to support both local-first offline study and multi-device synchronization. Phase 2 introduces cloud synchronization across two primary transports:

1. **Google Drive BYO Storage (Free tier):** File-oriented object storage using app data folders (`appDataFolder` / `drive.file`) with device leases.
2. **Bibalak Cloud Hosted Sync (Paid SaaS):** Real-time PostgreSQL database hosted on Supabase (D3), providing authentication, Row-Level Security (RLS), and REST/RPC transport.

Per the internal planning notes §2, both transports must share **one single deterministic merge engine and delta model** in `crates/bibalak-core` and `crates/bibalak-db`.

Historically, Anki's synchronization model was partially implemented in `crates/bibalak-db/src/schema.rs` (`mod`, `usn`, `graves`, `schema_mod`), but several write paths drifted, failing to update `usn`, omit card graves on note deletion, or bump `schema_mod` on notetype renames (findings from `05-Q3.md` and Card S1a audit). Furthermore, Bibalak's future roadmap introduces non-Anki domains (Productivity tasks/habits in ADR-018, Gamification XP/rewards in ADR-019), which require a modern cloud-native identity model.

---

## 2. Decision

### 2.1 Dual ID & Entity Identity Architecture

We adopt a two-tier identifier model:

1. \*\*Anki-Compatible Core Tables (`collection`, `decks`, `deck_config`, `notetypes`, `fields`, `templates`, `notes`, `cards`, `revlog`, `tags`, `graves`):
   - **Primary Key:** 64-bit integer IDs (`i64` / SQLite `INTEGER PRIMARY KEY`).
   - **Rationale:** Preserves exact Anki desktop/mobile schema compatibility, `.apkg`/`.colpkg` export validity, and compact indexing for high-frequency spaced repetition queries.
   - **Deduplication / Cross-device Identity:**
     - Notes: `guid TEXT UNIQUE` (10-character URL-safe string, ADR-007).
     - Cards: `(note_id, ord)` pair.
     - Decks & Notetypes: Name and hierarchy.
     - Media: Exact original filename + SHA-1 content checksum (ADR-010).

2. **New Bibalak Tables (Productivity tasks/habits, Gamification, Sync cursors):**
   - **Primary Key:** UUIDv4 stored as `TEXT` (`TEXT PRIMARY KEY`).
   - **Multi-Tenancy & Authorization:** `user_id UUID NOT NULL` column on every row.
   - **Deletion Model:** Soft delete via `deleted_at TIMESTAMP WITH TIME ZONE NULL`.
   - **Rationale (D3):** Native alignment with Supabase Auth and PostgreSQL RLS policies; eliminates primary key allocation contention across offline devices without centralized sequence counters.

---

### 2.2 What Counts as a Change (The Local Mutation Contract)

To ensure zero drift across all local operations:

1. **Local Writes:** Any local INSERT, UPDATE, or DELETE on a synced table must:
   - Set `"mod" = now_ms` (current UNIX epoch milliseconds).
   - Set `usn = -1` (uncommitted local mutation).
2. **Deletions:** Must record tombstones in `graves (oid, type, usn)` with `usn = -1`:
   - `type = 0`: Card deletion.
   - `type = 1`: Note deletion.
   - `type = 2`: Deck deletion.
3. **Resurrections & Undos:** An undo operation is a **new local mutation**:
   - Resurrected rows are inserted or updated with `"mod" = now_ms, usn = -1`.
   - Active tombstones in `graves` for the resurrected entity (`oid`, `type`) are deleted immediately in the same transaction to prevent stale deletions from propagating on sync.
4. **Sync Commitment:**
   - During sync delta upload/acknowledgment, the remote server assigns an ascending server sequence number (`server_usn`).
   - The local database updates all rows having `usn = -1` to `usn = server_usn` and advances `collection.last_sync = now_ms` and `collection.usn = server_usn`.

---

### 2.3 `graves` vs `schema_mod` Boundary Rules

Forensic audit of `bibalak-db` establishes a strict dichotomy between row-level changes and structural schema changes:

1. **Delta Sync via `graves`:**
   - Deleting notes, cards, or decks writes to `graves` and updates `collection.modified = now_ms`.
   - `collection.schema_mod` is **NOT** modified.
   - These deletions are synchronized through normal delta journals without requiring a full sync.
2. **Full Sync via `schema_mod` (structural changes only, D27):**
   - Only structural note-type changes bump `collection.schema_mod = now_ms` and `collection.modified = now_ms`: adding, removing or reordering a field or a template, deleting a notetype, and changing the note type of notes.
   - Cosmetic note-type changes are normal row changes (`notetypes.mod = now_ms`, `usn = -1`) and do **not** bump `schema_mod`: renaming a notetype, field or template, editing template text, CSS or field options, and adding a new notetype (including stock ones). This matches Anki.
   - `notetypes`, `fields`, and `templates` do not record individual tombstones in `graves` on deletion.
   - When client and server `schema_mod` values diverge, the merge engine disallows delta merging and triggers a **Full Sync Boundary** (unidirectional collection alignment or interactive user confirmation).

3. **Card state changes (D27):** bury and unbury mark the card dirty (`mod = now_ms`, `usn = -1`) like suspend, so they sync (as in Anki).
4. **One clock (D27):** every `Storage` write receives `now_ms` from the `Collection` clock; bibalak-db never reads the system clock for sync markers.

---

### 2.4 Deterministic Merge Rules

When merging deltas between local and remote states:

1. **`revlog` (Study Reviews):**
   - **Rule:** Append-only union keyed by `(id, card_id)`.
   - Reviews recorded on separate devices never conflict or overwrite each other. Duplicate review timestamps are idempotent.
2. **Mutable Entities (`notes`, `cards`, `decks`, `deck_config`):**
   - **Rule:** Last-Writer-Wins (LWW) by row `"mod"` timestamp.
   - If `remote.mod > local.mod`, remote row overwrites local row.
   - If `local.mod > remote.mod`, local row is retained and queued for remote upload.
   - If `local.mod == remote.mod`, tie-breaker is deterministic byte comparison of serialized content.
3. **Tombstones (`graves` vs Edits):**
   - **Rule:** Tombstone wins over stale edits.
   - The deletion time lives in the local-only table `grave_times (oid, type, deleted_ms)`, because Anki's `graves` has no time column. It is written in the same transaction as each `graves` row (D29, 2026-11-18).
   - If a `graves` entry exists with `grave.usn > row.usn` or `deleted_ms >= row.mod`, the row is deleted locally.
   - If a local edit occurred strictly _after_ the deletion timestamp (e.g. offline edit before receiving tombstone), the local edit resurrects the entity: the tombstone is removed and `usn = -1`.
4. **Media Store (`media`):**
   - **Rule:** Deduplication by `(filename, SHA-1 checksum)` (ADR-010).
   - Filenames are preserved exactly as referenced in card HTML.
   - Media sync is decoupled from metadata sync: missing files are queued for asynchronous background download without blocking review database availability.

---

### 2.5 Safety & Consistency Invariants

1. **Pre-Sync Local Backup:**
   - Prior to executing any remote pull or merge, the client executes a WAL checkpoint and creates a timestamped local snapshot via `Storage::backup_db` into `<data_dir>/backups/pre-sync-<timestamp>.db`.
2. **Post-Merge Integrity Check:**
   - After merging all downloaded deltas and before committing the new `last_sync` / `usn` cursor, the client runs `Storage::integrity_check` and `PRAGMA foreign_key_check`.
   - If any structural inconsistency, orphaned card, or corruption is detected, the transaction aborts, rolls back, and restores the pre-sync backup.
3. **Monotonic Clock-Skew Guard:**
   - System clocks across clients may drift.
   - A client rejects or clamps remote entity modifications where `remote.mod > local_now_ms + MAX_FUTURE_DRIFT_MS` (default: 10 minutes / 600,000 ms).
   - Local `now_ms` generation is guarded to be monotonically increasing: `mod = max(now_ms, last_seen_mod + 1)`.

---

## 3. Plan for Step 6b (Implementation Gate)

Following acceptance of ADR-014 by the project owner:

1. **Sync State Storage:** Introduce schema migration v7 defining local sync tracking (`sync_state` table or collection cursor metadata).
2. **Journal / Change Capture:** Implement `SyncJournal` extraction in `bibalak-db` to query rows where `usn = -1` or `graves.usn = -1`.
3. **Deterministic Merge Engine:** Implement `MergeEngine` in `crates/bibalak-core` containing the LWW, revlog union, and tombstone reconciliation algorithms.
4. **Two-Device Simulation Test Suite:** Build simulated multi-device test harness using `TestClock` verifying:
   - Simultaneous card reviews on Device A and Device B merge cleanly into `revlog`.
   - Concurrent note edits resolve via LWW.
   - Deletion on Device A deletes row on Device B.
   - Undo on Device A resurrects row and cancels tombstone on Device B.

---

## 4. Open Questions for the Owner

The following design decisions are flagged for owner review before Step 6b code is written:

1. **New Tables Sync Representation (D3):**
   - For productivity tasks/habits and gamification tables, should sync deltas be tracked via row-level `updated_at` / `deleted_at` timestamps queried with `WHERE updated_at > last_sync_time`, or should a unified changelog table (`sync_journal`) record every change?
   - _Recommendation:_ Use row-level `updated_at` + `deleted_at` directly with Supabase Postgres RLS; it eliminates journal bloat and maps 1:1 to Postgres change-data capture.
2. **Full Sync UX Trigger:**
   - When `schema_mod` differs between local and remote, Anki displays a modal: _"The collections differ structurally. Do you want to Upload to Cloud or Download from Cloud?"_
   - Should Bibalak adopt the same explicit user prompt, or attempt an automated schema reconciliation?
   - _Recommendation:_ Adopt the explicit user choice prompt (safety first; prevents accidental field loss).
3. **CloudStore Lease Duration (Google Drive, ADR-016):**
   - For object-based sync on Google Drive, what should the lease lock duration be for `lease.json`?
   - _Recommendation:_ 120 seconds with automatic heartbeats, preventing stalled sync locks if an app process crashes.

---

## 5. Consequences

### Positive

- Every write path in `bibalak-db` is verified and hardened; sync markers (`mod`, `usn`, `graves`, `schema_mod`) are guaranteed correct before any sync transport is hooked up.
- The merge engine is isolated in pure Rust crates (`bibalak-core`), enabling identical behavior across Google Drive and Supabase.
- Clean boundary between Anki-compatible 64-bit integer entities and modern cloud-native UUID tables.

### Negative / Trade-offs

- Anki's structural `schema_mod` model forces full syncs on notetype structural changes rather than fine-grained field merging. This is a known Anki design trade-off preserved for compatibility.
