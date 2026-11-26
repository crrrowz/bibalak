# ADR-027: Daily Motivation Loop — Goal, Quests, Monthly Badges, Comeback Bonus, and Onboarding

**Status:** Accepted 2026-11-24 (owner)  
**Date:** 2026-11-24  
**Card:** `16a` (`MOTs` — Daily motivation spec; implements in `16d` `MOTd`, `16e` `TODAY`, `16f` `ONBRD`, `16g` `QUEST`)  
**Related:** `ADR-014`, `ADR-018`, `ADR-019`, `ADR-023`, `ADR-025`, `ADR-026`; `01-daily-loop-spec.md`  
**Migration:** `v14 -> v15` (`MIGRATIONS[14]`, strictly **after `14c` `GPERF`**, which adds `v14`)

---

## 1. Context

`ADR-019` established Bibalak's single `progress_ledger` (integer XP, level curve, `gold_cents`) with strict non-negotiable invariants (`§4.1`): rewards only for real work, zero penalties, no multipliers, no random drops, and atomic undo revocation. `ADR-025` (`v11 -> v12`) added gold spending and `freeze_token_ledger`; `ADR-026` (`v12 -> v13`) added monotonic unlocks, pet growth, paths, and solo achievements; and `14c` (`GPERF`, `v13 -> v14`) indexes `game_pet_credits(user_id, ledger_id)`.

Cycle 3 closes the daily motivation loop across all three presentation styles (`Default`, `Scholar`, `Game`):

1. A synced **daily XP goal** (`10 / 20 / 30 / 50 XP`, default `20`).
2. **First-run onboarding** state (`onboarding_completed_at`) so existing users and synced second devices never repeat first-run setup.
3. **3 daily quests** and **1 weekly quest** drawn deterministically from `day_index` / `week_index` with fixed gold rewards written to `progress_ledger` and soft-revoked on undo.
4. **Monthly badge** for completing `N = 20` daily quests in a calendar month, stored monotonically (`earned_at` never revoked on later undos, matching `ADR-026`).
5. **Comeback bonus** after `K = 7` days away, granted once per return when the daily goal is reached.
6. **Study-streak freeze** support in the existing `freeze_token_ledger` (`freeze_use:study:<day_index>`).

These require a small, account-ready schema migration (`v14 -> v15`), deterministic UUIDv5 keys, `progress_ledger` key-parser extensions, and `SyncDelta` merge rules (`ADR-014`).

---

## 2. Decision

### 2.1 Migration `v14 -> v15` (`MIGRATIONS[14]`)

Appended to `MIGRATIONS` in `crates/bibalak-db/src/schema.rs` immediately after `14c`'s `v13 -> v14` index migration (never editing `MIGRATIONS[0..=13]`). Every table follows Bibalak's account-ready contract (`ADR-018 §2.9`): lowercase UUIDv5 `TEXT` primary key, `user_id` (defaulting to `NIL_USER_ID`), UTC millisecond timestamps (`created_at`, `updated_at`, `deleted_at`), and `usn`.

```sql
-- v14 -> v15 (ADR-027, MOTd): synced daily goal, onboarding state, comeback tracking,
-- and monotonic monthly quest badges.

CREATE TABLE motivation_settings (
    id                         TEXT PRIMARY KEY,
    user_id                    TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    daily_goal_xp              INTEGER NOT NULL DEFAULT 20
                               CHECK (daily_goal_xp IN (10, 20, 30, 50)),
    onboarding_completed_at    INTEGER NULL,
    comeback_return_day        INTEGER NULL,
    comeback_awarded_return_day INTEGER NULL,
    comeback_awarded_day       INTEGER NULL,
    comeback_dismissed_day     INTEGER NULL,
    created_at                 INTEGER NOT NULL,
    updated_at                 INTEGER NOT NULL,
    deleted_at                 INTEGER NULL,
    usn                        INTEGER NOT NULL DEFAULT -1,
    UNIQUE (user_id)
);

-- Seed existing non-empty collections as onboarding-completed so upgrading users
-- do not see the first-run onboarding wizard.
INSERT OR IGNORE INTO motivation_settings (
    id,
    user_id,
    daily_goal_xp,
    onboarding_completed_at,
    created_at,
    updated_at,
    deleted_at,
    usn
)
SELECT
    'b4c3a2d1-0000-5000-8000-000000000000',
    '00000000-0000-0000-0000-000000000000',
    20,
    CASE
        WHEN EXISTS (SELECT 1 FROM notes)
          OR EXISTS (SELECT 1 FROM revlog)
          OR EXISTS (SELECT 1 FROM tasks)
          OR EXISTS (SELECT 1 FROM habits)
          OR EXISTS (SELECT 1 FROM progress_ledger)
        THEN COALESCE((SELECT created FROM collection WHERE id = 1), 0)
        ELSE NULL
    END,
    COALESCE((SELECT created FROM collection WHERE id = 1), 0),
    COALESCE((SELECT created FROM collection WHERE id = 1), 0),
    NULL,
    0;

CREATE TABLE monthly_badges (
    id                   TEXT PRIMARY KEY,
    user_id              TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    month_key            TEXT NOT NULL
                         CHECK (length(month_key) = 7 AND month_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
    quest_count_at_earn  INTEGER NOT NULL CHECK (quest_count_at_earn >= 1),
    earned_at            INTEGER NOT NULL,
    seen_at              INTEGER NULL,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    deleted_at           INTEGER NULL,
    usn                  INTEGER NOT NULL DEFAULT -1,
    UNIQUE (user_id, month_key)
);
```

> **Note on Stage 1 ID seed:** `16d` computes the exact RFC 4122 v5 UUID via `motivation_settings_id(NIL_USER_ID)` (or reads via `UNIQUE (user_id)` and upserts with the deterministic `entity_id_v5` in Rust). Using `entity_id_v5("motivation_settings", NIL_USER_ID, "default")` inside a Rust backfill or matching the constant in SQL guarantees `id` matches `entity_id_v5` across devices.

### 2.2 What Goes in Settings vs. Synced Tables vs. Local `sync_state`

| State                                                            | Location                                          | Synced?               | Rationale                                                                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `daily_goal_xp`, `onboarding_completed_at`, `comeback_*`         | `motivation_settings` SQLite table                | **Yes** (`SyncDelta`) | Synced user-wide state; `collection.config` JSON is not synced in `SyncDelta` and is a single-row conflict surface.                                      |
| `monthly_badges` (`month_key`, `earned_at`, `seen_at`)           | `monthly_badges` SQLite table                     | **Yes** (`SyncDelta`) | Monotonic permanent credentials with timestamps, identical to `ADR-026`'s `game_achievements`.                                                           |
| Quest completions, comeback bonus, monthly badge gold            | `progress_ledger` (existing v9 table)             | **Yes** (`SyncDelta`) | Single ledger rule (`ADR-019 §4.1`). No separate quest-completion table needed because deterministic `source_key`s encode `(day/week/month, quest_id)`.  |
| Study-streak freeze uses                                         | `freeze_token_ledger` (existing v12 table)        | **Yes** (`SyncDelta`) | Reuses `freeze_token_ledger` with `source_key = "freeze_use:study:<day_index>"`, `delta = -1`.                                                           |
| Daily/weekly quest definitions & progress                        | **Computed in Rust** (`bibalak-core::motivation`) | N/A                   | Pure deterministic function of `day_index` / `week_index` + live SQL counts over `revlog`, `tasks`, `habits`, `progress_ledger`. Zero duplicate state.   |
| `goal_celebrated_day`                                            | Local `sync_state` (`"goal_celebrated_day"`)      | **No** (per-device)   | Prevents re-toasting the daily goal celebration on a device after raising/lowering or reopening, matching `yesterday_summary_seen_day` (`ADR-019 §4.8`). |
| `locale`, `theme`, `style`, `sound` (`16h`), `reminders` (`16c`) | `localStorage` (`stores/`)                        | **No** (per-device)   | Device UI/audio/notification preferences (`16c`, `16h`).                                                                                                 |

### 2.3 Deterministic Keys & `progress_ledger` Source Keys

Primary keys use `entity_id_v5` (`sha1`, RFC 4122 v5, matching `ADR-019 §2.4` and `ADR-025 §2.4`):

- `motivation_settings.id`: `entity_id_v5("keepsake:motivation_settings:v1", user_id, "default")`
- `monthly_badges.id`: `entity_id_v5("keepsake:monthly_badge:v1", user_id, month_key)`

New `progress_ledger.source_key` formats (all `xp = 0`, fixed `gold_cents`, `ledger_id(user_id, source_key)`):

| Reward kind    | `source_key` format                    | `xp` | `gold_cents` | Undo / Revoke rule                                                                              |
| -------------- | -------------------------------------- | ---- | ------------ | ----------------------------------------------------------------------------------------------- |
| Daily quest    | `quest_daily:<day_index>:<quest_id>`   | `0`  | `200`        | Soft-revoked if live daily count drops `< target`; un-revoked in place if re-reached.           |
| Weekly quest   | `quest_weekly:<week_index>:<quest_id>` | `0`  | `1000`       | Soft-revoked if live weekly count drops `< target`; un-revoked in place if re-reached.          |
| Comeback bonus | `comeback_bonus:<day_index>`           | `0`  | `500`        | Soft-revoked if undo drops `today_xp < daily_goal_xp` on `day_index`; un-revoked if re-reached. |
| Monthly badge  | `badge_monthly:<yyyy_mm>`              | `0`  | `1000`       | **Monotonic:** never revoked once `monthly_badges.earned_at` is set (`ADR-026 §2.2`).           |

**`ParsedSourceKey` (`crates/bibalak-core/src/progress.rs`) extension:**

```rust
pub enum ParsedSourceKey {
    CardReview { card_id: i64, day_index: i32 },
    TaskDone { task_id: String },
    HabitLog { habit_id: String, day_index: i32 },
    QuestDaily { day_index: i32, quest_id: String },
    QuestWeekly { week_index: i32, quest_id: String },
    ComebackBonus { day_index: i32 },
    MonthlyBadge { month_key: String },
}
```

- **`progress_summary()` / `progress_totals()`:** Unchanged SQL (`created_at >= today_start_ms AND created_at < today_end_ms`) includes quest/comeback/badge gold automatically in `today_gold_cents` and `gold_cents` (`available_gold_cents`), while leaving `today_xp` purely reflective of study/task/habit work (`xp = 0` on motivation bonuses).
- **`progress_history()` / `study_days()`:** `QuestDaily` and `ComebackBonus` bucket onto `day_index`; `QuestWeekly` and `MonthlyBadge` bucket onto `day_index_for_ms(created_at, ...)` (matching `TaskDone`).
- **`progress_by_deck()`:** Omits motivation bonuses (same as `TaskDone`, collection-wide).

### 2.4 Freeze Token Extension (`freeze_use:study:<day_index>`)

- Reuses `freeze_token_ledger` (`ADR-025`, `v12`) without schema changes.
- `freeze_study_day(day_index)` validates `day_index` is yesterday (`today - 1`) or `today - 2` (within allowed grace), verifies `freeze_tokens_held >= 1`, confirms the day is not already active in `progress_ledger`, and inserts `source_key = "freeze_use:study:<day_index>"`, `delta = -1`.
- `study_streak_from_days` treats days with an active `freeze_use:study:<day_index>` row as bridging the study streak (without adding XP or counting as an active review day for quests).

### 2.5 `SyncDelta` Integration (`ADR-014`)

`SyncDelta` (`crates/bibalak-core/src/sync.rs`) adds two `#[serde(default)]` vectors:

- `motivation_settings: Vec<MotivationSettingsRow>`
- `monthly_badges: Vec<MonthlyBadgeRow>`

(`progress_ledger` and `freeze_token_ledger` are already in `SyncDelta`.)

**Export & Acknowledge:** Export rows with `usn = -1`; acknowledge sets `usn = server_usn`. Excluded from `.apkg` / `.colpkg` import and export.

**Deterministic Merge Rules:**

1. **`motivation_settings`** (keyed by `user_id` / `id`):
   - `daily_goal_xp` and `comeback_*` fields: LWW by `updated_at` (`should_remote_win_soft_delete`).
   - `onboarding_completed_at`: `min_some(local, remote)` — once completed on any device, merging never re-opens onboarding.
2. **`monthly_badges`** (keyed by `(user_id, month_key)` / `id`):
   - Active (`deleted_at IS NULL`) always wins over soft-deleted (`ADR-026 §2.5`, monotonic).
   - `earned_at`: `min_some(local, remote)`.
   - `seen_at`: `min_some(local, remote)`.
   - `quest_count_at_earn`: `max(local, remote)`.
3. **`progress_ledger`** (unchanged from `ADR-019 §2.6`):
   - LWW by `updated_at`; on tie, revoke (`deleted_at IS NOT NULL`) wins.

### 2.6 PostgreSQL Mapping

Both v15 tables map 1:1 to PostgreSQL (Stage 2 `progress` / `motivation` schema in `ADR-017`):

| SQLite column / constraint           | PostgreSQL mapping                                        | Notes                                                                                          |
| ------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `id TEXT PRIMARY KEY`                | `UUID PRIMARY KEY`                                        | Lowercase hyphenated UUIDv5.                                                                   |
| `user_id TEXT NOT NULL`              | `UUID NOT NULL`                                           | Mapped to `auth.uid()` on Stage 2 claim.                                                       |
| `INTEGER` timestamps (`*_at`)        | `BIGINT NOT NULL / NULL`                                  | UTC epoch milliseconds.                                                                        |
| `INTEGER` day / goal / count         | `INTEGER NOT NULL / NULL`                                 | Matches `i32` / `u32`.                                                                         |
| `month_key TEXT` (`GLOB '[0-9]...'`) | `TEXT NOT NULL CHECK (month_key ~ '^[0-9]{4}-[0-9]{2}$')` | Regex `CHECK` equivalent in Postgres (no SQLite-specific functions stored in runtime queries). |
| `usn INTEGER`                        | `BIGINT NOT NULL DEFAULT -1`                              | Sync cursor.                                                                                   |

---

## 3. Alternatives Considered

1. **Store `daily_goal_xp`, `onboarding_completed_at`, and `comeback_*` in `collection.config` JSON (`collection` table):**
   - _Rejected._ `SyncDelta` does not sync `collection.config` today, and merging a multi-key JSON blob across devices under LWW would overwrite unrelated settings (e.g., `rolloverHour` on Device A overwritten by a goal change on Device B). A normalized `motivation_settings` table is account-ready, type-safe, and sync-safe.
2. **Store daily and weekly quest rows in a new `quests` SQLite table:**
   - _Rejected._ Because daily quests (3/day) and weekly quests (1/week) are deterministically derived from `day_index` / `week_index` and live counts (`revlog`, `tasks`, `habits`), storing active quest rows would create stale cache/sync drift when two offline devices complete different parts of the same day's quest. Computing live counts from synced source tables + recording payouts in `progress_ledger` via deterministic `source_key`s has zero cache drift.
3. **Grant XP (`xp > 0`) on daily quests and comeback bonus:**
   - _Rejected (proposed `xp = 0`, Gold only)._ If quest/comeback bonuses granted XP, completing a quest would inflate `today_xp` and could recursively trigger the daily XP goal or an XP quest (`ADR-019 §4.1` rewards real study work). Gold-only bonuses (`200 / 500 / 1000 gold_cents`) keep XP purely tied to cards, tasks, and habits while rewarding engagement in every style.
4. **Store `monthly_badges` inside `game_achievements`:**
   - _Rejected._ `game_achievements` is scoped to fixed one-time Game tiers (`1..=3`), whereas monthly badges repeat per `YYYY-MM`, are visible in Default and Scholar as well as Game, and carry `month_key` + `quest_count_at_earn`.

---

## 4. Consequences

### Positive

- **Zero cached totals & zero sync drift:** Quest progress is derived from live synced tables; rewards and freezes flow through `progress_ledger` and `freeze_token_ledger` with deterministic UUIDv5 keys.
- **Minimal schema footprint:** Only 2 small account-ready tables (`motivation_settings`, `monthly_badges`) in `v14 -> v15`.
- **Clean parallel split:** Once `16d` lands the migration, pure core rules, IPC, and preview mocks, `16e`, `16f`, and `16g` proceed in parallel in TypeScript with zero Rust compiles.

### Negative / Trade-offs

- **Cross-device mid-day quest sync:** Two devices working offline on the same day merge their `revlog`, `tasks`, `habit_logs`, and `progress_ledger` rows via `ADR-014`; on next load, `reconcile_motivation_tx` reconciles combined counts cleanly.
- **Ordering dependency:** `16d` (`v14 -> v15`) must merge **after `14c` (`v13 -> v14`)** so `MIGRATIONS` indices remain strictly sequential.
