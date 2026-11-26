# ADR-026: Game Unlocks, Pets & Mounts, Cosmetic Paths, and Solo Achievements

**Status:** Accepted 2026-11-24 (owner, D41)  
**Date:** 2026-11-24  
**Card:** `R4s` (Spec `15a`; Decisions `D1`, `D3`, `D14`, `D30`, `D34`, `D36`, `D40`; `ADR-014`, `ADR-018`, `ADR-019`, `ADR-025`)  
**Migration:** `v12 -> v13` (exact number **after `ADR-025`**, which takes `v11 -> v12`)

---

## 1. Context

`ADR-019` established Bibalak's single `progress_ledger` (integer XP, level curve, and `gold_cents`) with strict non-negotiable invariants (`§4.1`): rewards only for real work, no random drops, no HP/MP/damage/multipliers, and no streak-loss penalties. `ADR-025` (`14a · R2s`, parallel) defines gold spending, the cosmetic inventory, shop purchases, custom rewards, and streak freeze tokens.

`15a · R4s` adds solo Game depth (internal design notes):

1. **Deterministic milestone unlocks** (replacing blueprint random drops).
2. **Cosmetic pets and mounts** grown from real study/task/habit work (`0..50` bond points).
3. **Level 10 cosmetic paths** (crest, avatar frame, title line; zero stats).
4. **25 solo achievements** with one-time historical backfill and permanent retention.
5. **Local sound cue preferences** reusing `apps/desktop/src/stores/sound.ts` (`D28`).

These features require durable, syncable, Postgres-ready (`D3`) persistence that integrates with `ADR-014` sync and references `ADR-025` without duplicating its inventory or gold-spending tables.

---

## 2. Decision

### 2.1 Schema Migration (`v12 -> v13`, after `ADR-025`)

Appended to `MIGRATIONS` in `crates/bibalak-db/src/schema.rs` immediately after `ADR-025`'s migration (`v11 -> v12`). Every table follows Bibalak's account-ready contract (`D3`, `D30`, `ADR-018 §2.9`): lowercase UUIDv5 `TEXT` primary key, `user_id` (defaulting to `NIL_USER_ID`), UTC millisecond timestamps, `updated_at`, `deleted_at`, and `usn`.

```sql
-- v12 -> v13 (ADR-026, R4): deterministic unlocks, pets & mounts, cosmetic paths, solo achievements.

CREATE TABLE game_profile (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    chosen_path      TEXT NULL
                     CHECK (chosen_path IS NULL OR chosen_path IN ('vanguard', 'sage', 'scout', 'artisan')),
    path_chosen_at   INTEGER NULL,
    backfill_version INTEGER NOT NULL DEFAULT 0 CHECK (backfill_version >= 0),
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    deleted_at       INTEGER NULL,
    usn              INTEGER NOT NULL DEFAULT -1,
    UNIQUE (user_id)
);

CREATE TABLE game_unlocks (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    unlock_key   TEXT NOT NULL CHECK (length(trim(unlock_key)) > 0),
    reward_kind  TEXT NOT NULL CHECK (reward_kind IN ('pet', 'cosmetic', 'path_unlocked')),
    reward_ref   TEXT NOT NULL CHECK (length(trim(reward_ref)) > 0),
    unlocked_at  INTEGER NOT NULL,
    seen_at      INTEGER NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER NULL,
    usn          INTEGER NOT NULL DEFAULT -1,
    UNIQUE (user_id, unlock_key)
);

CREATE TABLE game_pets (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    species_key       TEXT NOT NULL CHECK (length(trim(species_key)) > 0),
    variant_key       TEXT NOT NULL DEFAULT 'classic' CHECK (length(trim(variant_key)) > 0),
    mount_unlocked_at INTEGER NULL,
    is_active         INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
    is_mounted        INTEGER NOT NULL DEFAULT 0 CHECK (is_mounted IN (0, 1)),
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    deleted_at        INTEGER NULL,
    usn               INTEGER NOT NULL DEFAULT -1,
    UNIQUE (user_id, species_key, variant_key),
    CHECK (is_mounted = 0 OR mount_unlocked_at IS NOT NULL)
);

CREATE UNIQUE INDEX idx_game_pets_one_active
    ON game_pets(user_id)
    WHERE is_active = 1 AND deleted_at IS NULL;

CREATE TABLE game_pet_credits (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    pet_id      TEXT NOT NULL,
    ledger_id   TEXT NOT NULL,
    points      INTEGER NOT NULL CHECK (points IN (1, 2)),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER NULL,
    usn         INTEGER NOT NULL DEFAULT -1,
    UNIQUE (pet_id, ledger_id)
);

CREATE TABLE game_achievements (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    achievement_key TEXT NOT NULL CHECK (length(trim(achievement_key)) > 0),
    tier            INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 3),
    earned_at       INTEGER NOT NULL,
    seen_at         INTEGER NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    deleted_at      INTEGER NULL,
    usn             INTEGER NOT NULL DEFAULT -1,
    UNIQUE (user_id, achievement_key)
);
```

In `v13 -> v14` (`MIGRATIONS[13]`), `CREATE INDEX idx_game_pet_credits_ledger ON game_pet_credits(user_id, ledger_id)` is added so pet-credit revocation resolves by `(user_id, ledger_id)` without scanning `game_pet_credits` (alongside `idx_progress_ledger_active_created` for `ADR-019` §2.4).

### 2.2 Deterministic Keys & Idempotency

All primary keys are deterministic RFC 4122 v5 UUIDs computed in `bibalak-core` (reusing the `sha1` layout of `bibalak-core::progress::ledger_id`) with distinct domain-separated prefixes:

- `game_profile.id`: `sha1("keepsake:game_profile:v1:" + user_id)`
- `game_unlocks.id`: `sha1("keepsake:game_unlock:v1:" + user_id + ":" + unlock_key)`
- `game_pets.id`: `sha1("keepsake:game_pet:v1:" + user_id + ":" + species_key + ":" + variant_key)`
- `game_achievements.id`: `sha1("keepsake:game_achievement:v1:" + user_id + ":" + achievement_key)`

**Idempotency & monotonicity guarantees:**

1. Milestone writes use `INSERT OR IGNORE` inside the triggering transaction (`apply_answer`, `complete_task`, `log_habit`, `choose_game_path`, or `run_unlock_backfill`).
2. `game_unlocks` and `game_achievements` are **never revoked** on review/task undo or missed days (`ADR-019 §4.1`). Because `(user_id, unlock_key)` and `(user_id, achievement_key)` are unique, undoing and re-answering cannot grant duplicates.
3. Pet growth (changed in review, the internal archive): `+1` per rewarded card review and `+2` per rewarded task or habit, credited to the active pet through one row per reward in `game_pet_credits` (`UNIQUE (pet_id, ledger_id)`, `points` 1 or 2). `growth_points` is read as `min(50, SUM(points))` over active credits, never stored as a counter. Undoing a review or task soft-deletes its credit, so undo and re-answer cannot farm bond, and two offline devices never lose each other's growth on merge. Once `mount_unlocked_at` is set it is never cleared, even if later undos take the sum below `50`.
4. `game_profile.backfill_version` ensures historical evaluation runs once (`0 -> 1`) without touching `progress_ledger`.

### 2.3 Integration with `ADR-025` (By Reference)

`ADR-026` relies on two contracts from `ADR-025` (`14a · R2s`) without altering `ADR-025`'s schema:

1. **Cosmetic inventory grants:** When `game_unlocks` grants a `reward_kind = 'cosmetic'` (e.g., `frame_copper_ring`, `backdrop_study_hearth`, `frame_path_<path_id>`), `Collection` calls `ADR-025`'s inventory-grant helper inside the **same SQLite transaction** so the item appears in the user's `ADR-025` inventory as `kind = 'cosmetic'`, `source = 'unlock'` (helper `grant_unlocked_cosmetic`, ADR-025 §2.2).
2. **Path-switch gold spend:** Choosing a path for the first time at `level >= 10` is free (`chosen_path IS NULL`). Switching paths later (if approved in Spec §12 Q1) calls `ADR-025`'s `spend_gold` helper (`kind = 'path_change'`) with idempotency key `path_switch:<uuid>` and amount `10_000` `gold_cents` (`100` gold), verifying `available_gold_cents >= 10_000` atomically before updating `game_profile.chosen_path`.

### 2.4 Sound Preference Storage (No Schema Column)

Per **D28**, audio preferences (`volume`, `muted`, and `R4`'s `gameSfxEnabled`) are **per-device app preferences** stored in `localStorage` (`apps/desktop/src/stores/sound.ts`), not inside the synced SQLite collection.

### 2.5 Sync Integration (`ADR-014`, `D14`)

`SyncDelta` (`crates/bibalak-core/src/sync.rs`) gains five `#[serde(default)]` vectors: `game_profile`, `game_unlocks`, `game_pets`, `game_pet_credits`, and `game_achievements`. `game_pet_credits` merges by `id` with LWW on `updated_at`.

- **Export:** All rows with `usn = -1`.
- **Merge rules:**
  - `game_unlocks` and `game_achievements`: Keyed by `(user_id, *_key)`. Active row (`deleted_at IS NULL`) always wins over soft-deleted; `unlocked_at` / `earned_at` keeps the minimum timestamp; `seen_at` keeps the earliest non-null timestamp (`min_some`).
  - `game_pets`: Keyed by `(user_id, species_key, variant_key)`. growth comes from the merged `game_pet_credits` rows, `mount_unlocked_at = min_some(local, remote)`, and `is_active` / `is_mounted` follow LWW on `updated_at` (post-merge invariant re-enforces at most one `is_active = 1` per `user_id` by keeping the newest `updated_at`).
  - `game_profile`: Keyed by `user_id`. `chosen_path` / `path_chosen_at` follow LWW on `updated_at`; `backfill_version = max(local, remote)`.
- **Acknowledge:** Sets `usn = server_usn` for exported rows with `usn = -1`.
- **Anki isolation:** Excluded from `.apkg` and `.colpkg` import/export.

### 2.6 PostgreSQL Readiness (`D3`)

- All five tables map 1:1 to PostgreSQL (`TEXT` UUIDs or `UUID` columns, `BIGINT` UTC ms, `INTEGER` flags/counts, partial unique index `WHERE is_active = 1 AND deleted_at IS NULL`).
- No SQLite-only syntax (`AUTOINCREMENT`, `GLOB`, `json_extract`) is used in `v12 -> v13`.

---

## 3. Alternatives Considered

1. **Overloading `progress_ledger` with `xp = 0, gold_cents = 0` for unlocks and achievements:**
   - _Rejected._ `progress_ledger` rows are soft-revoked on undo (`ADR-019 §2.4`) and store only numeric point deltas. Unlocks, pets, and achievements are monotonic, never revoked on undo, and require structured fields (`tier`, `seen_at`, `mount_unlocked_at`, `species_key`).
2. **Computing achievements purely on read without a table:**
   - _Rejected._ Pure read-time queries cannot record `earned_at` timestamps, `seen_at` toast acknowledgement, or syncable profile badges for Stage 2 (`D30`).
3. **Storing pet growth and unlocked badges as a JSON blob in `sync_state` or `game_profile`:**
   - _Rejected._ Row-level `SyncDelta` merge cannot cleanly combine two offline devices that each unlocked a different pet or raised bond points; normalized tables with deterministic UUIDv5 keys merge losslessly (`ADR-014`).
4. **Adding `game_sfx_enabled` to `game_profile` in SQLite:**
   - _Rejected._ Contradicts `D28`, which keeps sound volume and mute as local per-device preferences alongside `keepsake-sound-volume`.

---

## 4. Consequences

- **Positive:** Cleanly separates monotonic game depth (`ADR-026`) from revocable points (`ADR-019`) and gold spending/equipment (`ADR-025`), while remaining 100% deterministic, offline-safe, and Postgres-ready.
- **Cost:** Adds 5 small tables (`v12 -> v13`), 5 `SyncDelta` vectors, and one backfill pass on first Game-depth load.
- **Sequencing:** `R4` Rust work (`R4-1`) must land **after `R2`'s `ADR-025` migration (`v11 -> v12`)** so `MIGRATIONS` indices stay strictly ordered.
