# ADR-018: Productivity Data Model — Tasks, Matrix, Habits, and Local Calendar

**Status:** Accepted (2026-11-22, owner approval)  
**Date:** 2026-11-22  
**Card:** `M1s` (Backlog Step 9a; contract for Phase C Steps `9` `M1`, `10` `M2`, `11` `M3`, `12` `CAL1`, `13` `R3`)  
**Related:** Decisions D1, D2, D3, D9, D14, D15, D16, D17, D27, D29, D30, D32; ADR-001, ADR-014, ADR-019  
**Supersedes (where they differ):** internal design notes (and `01`–`03` §1 where noted)

---

## 1. Context

Bibalak adds Stage 1 local productivity tools — **task lists, tasks, Eisenhower matrix rules, habits, habit logs, and local calendar events** — to organize study alongside spaced repetition (D2, the internal planning notes). Under the Phase C workflow (the internal planning notes), Steps `9` (`M1`), `10` (`M2`), `11` (`M3`), `12` (`CAL1`), and `13` (`R3`) are authored in Rust and TypeScript before the Build Window (`BW1`) compiles them. This ADR therefore specifies the exact SQLite `v10` migration, domain types, `Storage` port methods, `Collection` methods, Tauri IPC commands and TypeScript DTOs, sync and undo semantics, Postgres mapping, and failing-first test list.

### Owner Decisions Resolved Before Finalizing This Contract

The following product choices left open by the blueprints were confirmed by the owner on 2026-11-22:

1. **Habit goal modes in `v10`:** Support **both** yes/no (`achieve_all`) and numeric target (`reach_amount` with `goal_target` and `goal_unit`) in `v10`.
2. **Task checklists (sub-items):** **Deferred** beyond `v10` (no checklist table or JSON column in `v10`).
3. **Recurrence in `v10`:**
   - **Tasks:** One-off only (no recurrence on `tasks`; recurring daily/weekly routines belong in `habits`).
   - **Calendar events:** Simple structured recurrence without an external crate — `daily` or `weekly` on selected weekdays, with optional `until` date or occurrence `count`, stored structurally (`freq`, `interval`, `weekdays`, `until`/`count`) so it converts 1:1 to RFC 5545 `RRULE` for `CAL2`. Expansion runs in Rust over a UI-requested time window. Deleting a single occurrence uses an excluded-dates list (`exdates`) only; editing a single occurrence in isolation is deferred.

---

## 2. Decision

### 2.1 Tables for Migration `v9 -> v10` (`MIGRATIONS[9]`)

The live schema is `v9` (`MIGRATIONS` in `crates/bibalak-db/src/schema.rs:L8-L231`). Step `9` (`M1`) appends `MIGRATIONS[9]` (`v9 -> v10`) adding six neutral domain tables (never `rpg_`-prefixed, per D1 and internal design notes §3):

1. `task_lists` — user-defined task folders (`Inbox` is `tasks.list_id IS NULL`).
2. `tasks` — one-off actionable tasks with optional due date, optional calendar time-block, priority, matrix pin, and optional deck link.
3. `matrix_quadrants` — the four Eisenhower matrix quadrant configurations and `QuadrantRule` filters (`q1`–`q4`).
4. `habits` — recurring routines with schedule, boolean/numeric goal mode, section, reminders, and optional deck link.
5. `habit_logs` — per-habit, per-collection-day check-in values, completion flag, mood, and reflection note.
6. `calendar_events` — local calendar events (timed or all-day), optional task link, and structured daily/weekly recurrence with `exdates`.

**Why `habits` and `tasks` are separate tables (overriding `04-unified-sqlite-and-supabase-schema.md` `rpg_tasks`):**

- `tasks` and `habits` have different lifecycles: a task completes once (`completed_at`, `completed_day`, `priority`, `manual_quadrant`, `due_date`, `scheduled_start_ms`/`end_ms`) and appears in the Eisenhower Matrix; a habit never permanently completes, repeats on a schedule (`frequency_kind`, `weekdays_json`, `weekly_target`, `interval_days`), tracks quantitative/boolean daily goals (`goal_mode`, `goal_target`, `goal_unit`), belongs to a time-of-day `section`, and records daily state in `habit_logs`.
- Merging them into one table leaves ~12 columns unused on every task and ~8 columns unused on every habit, weakens SQL `CHECK` constraints, and forces every Matrix query to filter out habits.

**External calendar accounts (D30):**

- **No `calendar_accounts` table in `v10`.** Under D30, Google/Outlook/CalDAV accounts and OAuth tokens belong to Stage 2 through the Bibalak API server (`CAL2`/`CAL3`, ADR-020).
- `calendar_events` reserves only two cheap nullable columns — `external_account_id TEXT NULL` and `external_event_id TEXT NULL` — so Stage 2 can link synced external events without rewriting `calendar_events` or adding half-built sync state (`sync_cursor`, `remote_etag`, `raw_provider_json`) in Stage 1.

---

### 2.2 Account-Ready Rules & Exact SQLite `v10` SQL (`MIGRATIONS[9]`)

Per the internal planning notes ("Account-ready rules for every new table") and D3 / ADR-014 §2.1:

- Every table uses a **lowercase hyphenated RFC 4122 UUID `TEXT PRIMARY KEY`** (no composite primary keys, no integer counters).
- Every table includes `user_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'` (`NIL_USER_ID` in `crates/bibalak-core/src/progress.rs:L21`), `created_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`, `deleted_at INTEGER NULL`, and `usn INTEGER NOT NULL DEFAULT -1`.
- Every JSON column enforces `CHECK (json_valid(...))`.
- Uniqueness that would otherwise be a composite primary key uses a `UNIQUE` constraint (`matrix_quadrants(user_id, quadrant_key)` and `habit_logs(user_id, habit_id, day_index)`), paired with deterministic RFC 4122 v5 UUID `id`s via `entity_id_v5(kind, user_id, natural_key)` (SHA-1 over `"keepsake:{kind}:v1:{user_id}:{natural_key}"`, setting RFC 4122 version 5 and variant bits — identical layout to `ledger_id` in `crates/bibalak-core/src/progress.rs:L475-L498`):
  - `matrix_quadrants`: `kind = "matrix_quadrant"`, `user_id = NIL_USER_ID` (`"00000000-0000-0000-0000-000000000000"`), `natural_key = "q1" | "q2" | "q3" | "q4"`:
    - `entity_id_v5("matrix_quadrant", NIL_USER_ID, "q1")` = `8bf9e921-77c6-5c04-8a24-3543facf8922`
    - `entity_id_v5("matrix_quadrant", NIL_USER_ID, "q2")` = `dc2221a0-4d91-5f4b-ace9-2418543e78ee`
    - `entity_id_v5("matrix_quadrant", NIL_USER_ID, "q3")` = `c6551142-e795-5a1f-bc1f-6031ceba3d2c`
    - `entity_id_v5("matrix_quadrant", NIL_USER_ID, "q4")` = `738cec69-e2ee-5515-8403-5de096b8cbea`
  - `habit_logs`: `kind = "habit_log"`, `user_id = habit.user_id`, `natural_key = "{habit_id}:{day_index}"`.
- Random UUIDv4 `id`s for new rows (`task_lists`, `tasks`, `habits`, `calendar_events`) are generated by `Storage::new_uuid(&self)` (using `fastrand` in `bibalak-db`, never timestamp/counter hashes in `bibalak-core`).
- The four default `matrix_quadrants` rows for `NIL_USER_ID` are seeded with `created_at = 0, updated_at = 0, usn = 0` (matching `MIGRATIONS[0]` default deck seeding at `crates/bibalak-db/src/schema.rs:L146-L149`) so untouched defaults do not emit spurious sync deltas and any user edit (`updated_at > 0`, `usn = -1`) wins LWW cleanly across devices.

```sql
-- v9 -> v10 (ADR-018, M1): productivity tables (task_lists, tasks, matrix_quadrants,
-- habits, habit_logs, calendar_events).

CREATE TABLE task_lists (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
    color_token TEXT NOT NULL DEFAULT 'accent',
    icon_key    TEXT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER NULL,
    usn         INTEGER NOT NULL DEFAULT -1
);
CREATE INDEX idx_task_lists_active
    ON task_lists(user_id, deleted_at, sort_order, name);

CREATE TABLE tasks (
    id                 TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    list_id            TEXT NULL REFERENCES task_lists(id) ON DELETE SET NULL,
    title              TEXT NOT NULL CHECK (length(trim(title)) > 0),
    notes              TEXT NOT NULL DEFAULT '',
    priority           TEXT NOT NULL DEFAULT 'none'
                       CHECK (priority IN ('high', 'medium', 'low', 'none')),
    manual_quadrant    TEXT NULL
                       CHECK (manual_quadrant IS NULL OR manual_quadrant IN ('q1', 'q2', 'q3', 'q4')),
    due_date           TEXT NULL
                       CHECK (due_date IS NULL OR (length(due_date) = 10 AND due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
    scheduled_start_ms INTEGER NULL,
    scheduled_end_ms   INTEGER NULL,
    tags_json          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
    deck_id            INTEGER NULL,
    completed_at       INTEGER NULL,
    completed_day      INTEGER NULL,
    sort_order         INTEGER NOT NULL DEFAULT 0,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL,
    deleted_at         INTEGER NULL,
    usn                INTEGER NOT NULL DEFAULT -1,
    CHECK ((scheduled_start_ms IS NULL) = (scheduled_end_ms IS NULL)),
    CHECK (scheduled_end_ms IS NULL OR scheduled_end_ms > scheduled_start_ms)
);
CREATE INDEX idx_tasks_matrix
    ON tasks(user_id, deleted_at, completed_at, priority, due_date);
CREATE INDEX idx_tasks_list
    ON tasks(user_id, list_id, deleted_at, sort_order);
CREATE INDEX idx_tasks_schedule
    ON tasks(user_id, deleted_at, scheduled_start_ms, scheduled_end_ms);

CREATE TABLE matrix_quadrants (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    quadrant_key TEXT NOT NULL CHECK (quadrant_key IN ('q1', 'q2', 'q3', 'q4')),
    title        TEXT NOT NULL DEFAULT '',
    color_token  TEXT NOT NULL,
    group_by     TEXT NOT NULL DEFAULT 'none'
                 CHECK (group_by IN ('none', 'tag', 'list', 'priority', 'date')),
    sort_by      TEXT NOT NULL DEFAULT 'date'
                 CHECK (sort_by IN ('date', 'priority', 'title', 'manual')),
    rule_json    TEXT NOT NULL CHECK (json_valid(rule_json)),
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER NULL,
    usn          INTEGER NOT NULL DEFAULT -1,
    UNIQUE (user_id, quadrant_key)
);

INSERT OR IGNORE INTO matrix_quadrants
    (id, user_id, quadrant_key, title, color_token, group_by, sort_by, rule_json, created_at, updated_at, deleted_at, usn)
VALUES
    ('8bf9e921-77c6-5c04-8a24-3543facf8922', '00000000-0000-0000-0000-000000000000', 'q1', '', 'danger',  'none', 'date', '{"lists":{"mode":"all"},"date_filters":["overdue","today","tomorrow"],"priorities":["high"],"types":null}', 0, 0, NULL, 0),
    ('dc2221a0-4d91-5f4b-ace9-2418543e78ee', '00000000-0000-0000-0000-000000000000', 'q2', '', 'warning', 'none', 'date', '{"lists":{"mode":"all"},"date_filters":null,"priorities":["high","medium"],"types":null}', 0, 0, NULL, 0),
    ('c6551142-e795-5a1f-bc1f-6031ceba3d2c', '00000000-0000-0000-0000-000000000000', 'q3', '', 'info',    'none', 'date', '{"lists":{"mode":"all"},"date_filters":["overdue","today","tomorrow"],"priorities":["low","none"],"types":null}', 0, 0, NULL, 0),
    ('738cec69-e2ee-5515-8403-5de096b8cbea', '00000000-0000-0000-0000-000000000000', 'q4', '', 'success', 'none', 'date', '{"lists":{"mode":"all"},"date_filters":null,"priorities":["low","none"],"types":null}', 0, 0, NULL, 0);

CREATE TABLE habits (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    title           TEXT NOT NULL CHECK (length(trim(title)) > 0),
    notes           TEXT NOT NULL DEFAULT '',
    icon_key        TEXT NOT NULL DEFAULT 'check-circle',
    color_token     TEXT NOT NULL DEFAULT 'accent',
    frequency_kind  TEXT NOT NULL DEFAULT 'daily'
                    CHECK (frequency_kind IN ('daily', 'weekdays', 'weekly_count', 'every_n_days')),
    weekdays_json   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(weekdays_json)),
    weekly_target   INTEGER NULL CHECK (weekly_target IS NULL OR (weekly_target BETWEEN 1 AND 7)),
    interval_days   INTEGER NULL CHECK (interval_days IS NULL OR interval_days >= 1),
    goal_mode       TEXT NOT NULL DEFAULT 'achieve_all'
                    CHECK (goal_mode IN ('achieve_all', 'reach_amount')),
    goal_target     REAL NOT NULL DEFAULT 1.0 CHECK (goal_target > 0.0),
    goal_unit       TEXT NOT NULL DEFAULT '',
    start_day_index INTEGER NOT NULL,
    target_days     INTEGER NULL CHECK (target_days IS NULL OR target_days >= 1),
    section         TEXT NOT NULL DEFAULT 'others'
                    CHECK (section IN ('morning', 'afternoon', 'night', 'others')),
    reminders_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reminders_json)),
    auto_popup_log  INTEGER NOT NULL DEFAULT 0 CHECK (auto_popup_log IN (0, 1)),
    deck_id         INTEGER NULL,
    archived_at     INTEGER NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    deleted_at      INTEGER NULL,
    usn             INTEGER NOT NULL DEFAULT -1
);
CREATE INDEX idx_habits_active
    ON habits(user_id, deleted_at, archived_at, section, sort_order);

CREATE TABLE habit_logs (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    habit_id     TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    day_index    INTEGER NOT NULL,
    logged_value REAL NOT NULL DEFAULT 0.0 CHECK (logged_value >= 0.0),
    goal_target  REAL NOT NULL DEFAULT 1.0 CHECK (goal_target > 0.0),
    completed    INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    mood         INTEGER NULL CHECK (mood IS NULL OR mood BETWEEN 1 AND 5),
    note         TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER NULL,
    usn          INTEGER NOT NULL DEFAULT -1,
    UNIQUE (user_id, habit_id, day_index)
);
CREATE INDEX idx_habit_logs_day
    ON habit_logs(user_id, day_index, deleted_at);
CREATE INDEX idx_habit_logs_habit
    ON habit_logs(user_id, habit_id, day_index);

CREATE TABLE calendar_events (
    id                       TEXT PRIMARY KEY,
    user_id                  TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    title                    TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description              TEXT NOT NULL DEFAULT '',
    location                 TEXT NOT NULL DEFAULT '',
    color_token              TEXT NOT NULL DEFAULT 'accent',
    start_ms                 INTEGER NOT NULL,
    end_ms                   INTEGER NOT NULL,
    is_all_day               INTEGER NOT NULL DEFAULT 0 CHECK (is_all_day IN (0, 1)),
    recurrence_freq          TEXT NULL
                             CHECK (recurrence_freq IS NULL OR recurrence_freq IN ('daily', 'weekly')),
    recurrence_interval      INTEGER NOT NULL DEFAULT 1 CHECK (recurrence_interval >= 1),
    recurrence_weekdays_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recurrence_weekdays_json)),
    recurrence_until_date    TEXT NULL
                             CHECK (recurrence_until_date IS NULL OR (length(recurrence_until_date) = 10 AND recurrence_until_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
    recurrence_count         INTEGER NULL CHECK (recurrence_count IS NULL OR recurrence_count >= 1),
    recurrence_exdates_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recurrence_exdates_json)),
    linked_task_id           TEXT NULL REFERENCES tasks(id) ON DELETE SET NULL,
    external_account_id      TEXT NULL,
    external_event_id        TEXT NULL,
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL,
    deleted_at               INTEGER NULL,
    usn                      INTEGER NOT NULL DEFAULT -1,
    CHECK (end_ms > start_ms),
    CHECK (NOT (recurrence_until_date IS NOT NULL AND recurrence_count IS NOT NULL))
);
CREATE INDEX idx_calendar_events_window
    ON calendar_events(user_id, deleted_at, start_ms, end_ms);
CREATE INDEX idx_calendar_events_task
    ON calendar_events(linked_task_id);
```

---

### 2.3 Days and Times

| Field(s)                                                                | Representation                                                                           | Rationale & Timezone-Change Behavior                                                                                                                                                                                                                                                                                                                                                                                                                             |
| :---------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `habits.start_day_index`, `habit_logs.day_index`, `tasks.completed_day` | Collection-relative `i32` day index from `Collection::today()`                           | Uses `Collection::local_day_index` (`crates/bibalak-core/src/collection.rs:L89-L99`), matching `day_bucket` (`crates/bibalak-db/src/stats.rs:L38-L40`), `created_epoch_day`/`day_index_for_ms` (`crates/bibalak-core/src/progress.rs:L217-L233`), and `progress_ledger` review keys (`card_review:<id>:<day_index>`). Anything earning a daily reward uses the exact same rollover hour and timezone offset as study reviews; the UI never computes day indices. |
| `tasks.due_date`, `calendar_events.recurrence_until_date`, `exdates`    | Canonical `"YYYY-MM-DD"` string (`TEXT`)                                                 | Date-only ("due on a date") values must **not** move when the user changes timezones. Storing an explicit calendar date instead of local-midnight UTC ms avoids off-by-one-day shifts across UTC offsets. Evaluated in Rust against `epoch_days_to_date_string(created_epoch_day + i64::from(today))`.                                                                                                                                                           |
| `tasks.scheduled_start_ms`, `tasks.scheduled_end_ms`                    | UTC epoch milliseconds (`i64`)                                                           | Time-blocked task slots represent physical instants on the hourly grid and convert to local wall time using `Collection.tz_offset_minutes`.                                                                                                                                                                                                                                                                                                                      |
| `calendar_events.start_ms`, `end_ms` when `is_all_day == false`         | UTC epoch milliseconds (`i64`)                                                           | Physical instants; shifting timezone changes local display hour while preserving the instant.                                                                                                                                                                                                                                                                                                                                                                    |
| `calendar_events.start_ms`, `end_ms` when `is_all_day == true`          | **UTC midnight (`00:00:00.000Z`)** ms (`start_ms % 86_400_000 == 0`), `end_ms` exclusive | Matches iCalendar `VALUE=DATE` semantics: a 1-day all-day event on `2026-11-22` stores `2026-11-22T00:00:00Z` to `2026-11-23T00:00:00Z`. Rust formats its date directly from `start_ms / 86_400_000` via `epoch_days_to_date_string` without adding `tz_offset_minutes`, so timezone changes never shift all-day events.                                                                                                                                         |
| `created_at`, `updated_at`, `deleted_at`, `completed_at`, `archived_at` | UTC epoch milliseconds (`i64`)                                                           | Supplied exclusively from `Collection.clock.now_ms()` (`crates/bibalak-core/src/ports.rs:L25-L28`), never SQLite wall-clock defaults (`strftime`).                                                                                                                                                                                                                                                                                                               |

**How the UI gets display dates:**

- Every DTO returned by Rust includes pre-formatted `"YYYY-MM-DD"` strings (`date`, `due_date`, `start_date`, `occurrence_date`) computed via `epoch_days_to_date_string` (`crates/bibalak-core/src/ipc.rs:L984-L996`) and its inverse `date_string_to_epoch_days` in `bibalak-core::productivity` (same pattern as `StatsDto.today_date`, `ProgressDay.date`, and `StudyDay.date`).
- For timed events and task blocks, Rust also provides local-offset helper fields or `tz_offset_minutes` from `Collection` (`crates/bibalak-core/src/collection.rs:L148-L150`) so date-bucket placement (which day column an event falls on) is decided in Rust, never in UI date math.

---

### 2.4 Recurrence (Exact `v10` Scope)

- **Tasks:** **No recurrence** in `v10` (owner decision).
- **Habits (`HabitFrequency`):** Supports exactly four variants covering `02-habit-tracker-specification.md` §3:
  1. `Daily` — scheduled every day starting at `start_day_index`.
  2. `Weekdays { weekdays: Vec<u8> }` — non-empty sorted unique ISO weekdays `1..=7` (`1 = Mon .. 7 = Sun`); scheduled on days whose calendar weekday matches.
  3. `WeeklyCount { target: u8 }` — `1..=7` completions per ISO week (`Mon..Sun`). Exact 7-day ring rule (`P_d = sum(min(1.0, logged / goal)) / N_d` when $N_d > 0$, else `0.0`):
     - A habit is inside its active window on day $d$ when `d >= start_day_index` and (`target_days` is `None` or `d < start_day_index + target_days`).
     - Let `week_completions` be the count of active days in $d$'s ISO week (`Mon..Sun`) that have a non-deleted log with `completed == true`.
     - A `WeeklyCount` habit counts as scheduled on active day $d$ (`+1` in `scheduled_count` $N_d$) **iff** `week_completions < target` **or** day $d$ itself has a non-deleted log with `logged_value > 0.0` (including `completed == true`).
     - When counted in $N_d$, day $d$'s numerator contribution is `min(1.0, logged_value / log_goal_target)` if a non-deleted log exists for day $d$, or `0.0` if none exists (`ReachAmount` partial progress counts before completion; `AchieveAll` contributes `0.0` or `1.0`).
     - Once `week_completions >= target`, remaining unlogged days in that week are rest days (`not in N_d`, so hitting 3/3 by Wednesday never penalizes Thursday–Sunday).
  4. `EveryNDays { interval_days: u32 }` — `interval_days >= 1`; scheduled when `(day_index - start_day_index) >= 0 && (day_index - start_day_index) % interval_days == 0`.
  - **Habit duration limit:** `target_days: Option<u32>` (`None` = forever; `Some(n)` = active for `start_day_index .. start_day_index + n`).
  - **Out of scope for habits:** Monthly by day-of-month, yearly, nth-weekday-of-month, arbitrary `RRULE`.
- **Calendar events (`CalendarRecurrence`):** Supports simple structured recurrence without external crates:
  - `freq`: `Daily` or `Weekly`.
  - `interval`: `u32 >= 1` (every `interval` days or every `interval` weeks).
  - `weekdays`: `Vec<u8>` (`1..=7`, ISO weekdays; empty for `Daily`, non-empty sorted unique for `Weekly`).
  - Optional end bound (mutually exclusive): `until_date: Option<String>` (`"YYYY-MM-DD"`, inclusive) **or** `count: Option<u32>` (`>= 1`).
  - `exdates: Vec<String>` (`"YYYY-MM-DD"` dates excluded when deleting a single occurrence).
  - **1:1 `RRULE` formatter (`CalendarRecurrence::to_rrule`):** Produces `FREQ=DAILY|WEEKLY;INTERVAL=<n>[;BYDAY=MO,TU,...][;UNTIL=YYYYMMDD|;COUNT=<c>]` so Stage 2 `CAL2` can export directly without schema changes.
  - **Rust window expansion (`expand_calendar_events`):** Given `[window_start_ms, window_end_ms)` and `tz_offset_minutes`, Rust expands recurring series into `CalendarOccurrenceDto` items, skipping dates in `exdates` and enforcing `until_date` / `count`.
  - **Out of scope for calendar events:** `MONTHLY`, `YEARLY`, `BYMONTHDAY`, `BYSETPOS`, arbitrary RFC 5545 `RRULE` parsing, and editing a single detached occurrence (`RECURRENCE-ID`).

---

### 2.5 Matrix Rules, Validation, Defaults, and Restore

1. **Shape (`QuadrantRule`):** Mirrors `01-eisenhower-matrix-specification.md` §2.2, normalized for unambiguous `serde_json` and `ts-rs` serialization:
   - `lists`: `MatrixListFilter` (`All | Inbox | Tasks | Custom { list_ids: Vec<String>, deck_ids: Vec<i64> }`).
   - `date_filters`: `Option<Vec<MatrixDateFilter>>` (`None` = all dates; `Some(vec)` = non-empty predicate list from `NoDate | Overdue | Today | Tomorrow | Next7Days | ThisMonth`). Note: `"repeat"` from `01` §2.2 is omitted in `v10` because tasks have no recurrence.
   - `priorities`: `Option<Vec<TaskPriority>>` (`None` = all; `Some(vec)` = non-empty subset of `High | Medium | Low | None`).
   - `types`: `Option<Vec<MatrixItemType>>` (`None` = all; `Some(vec)` = non-empty subset of `Task | DeckDue`). Note: `Note` (flagged Anki notes) from `01` §2.2 is deferred because `notes` has no `flags` column in `crates/bibalak-db/src/schema.rs:L70-L81`.
2. **Rust validation (`validate_quadrant_config`):** Returns `CoreError::Invalid(...)` when:
   - `title.trim().chars().count() > 120` (empty string `""` is valid and means "use UI localized default title via `t()`").
   - `color_token.trim().is_empty()` or `color_token.len() > 32`.
   - `lists` is `Custom { list_ids, deck_ids }` with both `list_ids` and `deck_ids` empty, or any `list_id` fails UUID validation.
   - `date_filters` is `Some(v)` and `v.is_empty()`.
   - `priorities` is `Some(v)` and `v.is_empty()`.
   - `types` is `Some(v)` and `v.is_empty()`.
3. **Default rules & first-match evaluation:**
   - `q1`: `lists: All`, `date_filters: Some([Overdue, Today, Tomorrow])`, `priorities: Some([High])`, `types: None`.
   - `q2`: `lists: All`, `date_filters: None`, `priorities: Some([High, Medium])`, `types: None` (`q1` already claims `High` + `Overdue|Today|Tomorrow` by first match, so `q2` captures `High` with a later date or `NoDate` plus all `Medium` tasks, matching `01` §2.3).
   - `q3`: `lists: All`, `date_filters: Some([Overdue, Today, Tomorrow])`, `priorities: Some([Low, None])`, `types: None`.
   - `q4`: `lists: All`, `date_filters: None`, `priorities: Some([Low, None])`, `types: None`.
   - **Precedence & Unsorted fallback:** Incomplete tasks (`completed_at IS NULL && deleted_at IS NULL`) with `manual_quadrant = Some(q)` receive `effective_quadrant = Some(q)`; otherwise Rust evaluates `q1 -> q2 -> q3 -> q4` and assigns `Some(first_matching_quadrant)`. If the user edits quadrant rules and a task matches **none** of `q1..q4` (and has no `manual_quadrant`), it receives `effective_quadrant = None` ("unsorted"); `MatrixBoardDto.tasks` still returns all active tasks so the UI (`M2`) can surface an `"Unsorted"` strip rather than hiding tasks. `DeckDue` items are synthesized from decks with `due_today > 0` when a quadrant's `types` includes `DeckDue` (and `lists` matches `All` or `Custom { deck_ids }` containing that deck).
4. **Restore defaults (`restore_matrix_quadrants`):**
   - Never hard-deletes or re-inserts rows. Performs an in-place `UPDATE matrix_quadrants SET title = '', color_token = ?, group_by = 'none', sort_by = 'date', rule_json = ?, deleted_at = NULL, updated_at = ?now_ms, usn = -1 WHERE user_id = ? AND quadrant_key = ?`.
   - Preserves the deterministic UUIDv5 `id`, clears any accidental `deleted_at`, and marks `usn = -1` so LWW sync propagates the reset cleanly.

---

### 2.6 Links to Study (`deck_id`)

Both `tasks` and `habits` include `deck_id: Option<i64>` (`INTEGER NULL`) with **no SQLite `FOREIGN KEY` constraint** (same soft-reference pattern as `revlog.card_id` in `crates/bibalak-db/src/schema.rs:L113`):

- **Why no SQLite FK:** `remove_deck` (`crates/bibalak-db/src/storage.rs:L307`) deletes deck rows and can be undone (`undo_remove_deck` restores the original `deck.id`), and `apply_sync_delta` runs `PRAGMA foreign_key_check` (`crates/bibalak-db/src/sync.rs:L881-L898`). A hard SQLite FK would either block `remove_deck`, corrupt `tasks`/`habits` sync timestamps on deck delete, or fail `foreign_key_check` when deltas arrive out of deck order.
- **When a linked deck is deleted:** `tasks`/`habits` keep `deck_id` unchanged; queries `LEFT JOIN decks` and populate `deck_name: Option<String>` (`None` if missing). If deck deletion is undone, the link resumes automatically; otherwise the UI renders an "unlinked / missing deck" state and lets the user re-link or clear it.
- **When a collection is imported (`.apkg`/`.colpkg`):** Per `crates/bibalak-db/src/import.rs:L5-L13` and `AGENTS.md` pitfalls, import matches existing decks by full name (preserving their `deck.id`) and remaps new decks to fresh `deck.id`s. Productivity tables are untouched by Anki import.

---

### 2.7 Rewards Hook (ADR-019 §2.4–2.5 Pattern; Numbers Deferred to `R3`)

- All productivity rewards write exclusively to `progress_ledger` (ADR-019 §2.4, `crates/bibalak-db/src/schema.rs:L218-L229`). No second ledger table is created.
- **Reserved `source_key` formats:**
  - Task completion: `task_done:<task_id>` (one active reward per task).
  - Habit daily completion: `habit_log:<habit_id>:<day_index>` (at most one active reward per habit per collection day index `Collection::today()`).
- **Deterministic ledger `id`:** Computed by `bibalak_core::progress::ledger_id(user_id, &source_key)` (`crates/bibalak-core/src/progress.rs:L475-L498`).
- **Transaction atomicity (exact ADR-019 §2.5 contract):**
  - `Storage::set_task_completion(..., reward: Option<&RewardGrant>, revoke_source_key: Option<&str>, now_ms: i64) -> CoreResult<bool>` and `Storage::upsert_habit_log(..., reward: Option<&RewardGrant>, revoke_source_key: Option<&str>) -> CoreResult<HabitLogWriteOutcome>` run any `progress_ledger` insert / un-revoke in the **same SQLite transaction** as the task/habit write, returning `granted: bool` (`true` iff a new row was inserted or a soft-revoked row was re-activated).
  - In `M1` (step 9), `Collection` passes `reward = None` (and `revoke_source_key = None`). Step `13` (`R3`, spec `13a`) supplies the reward amounts and keys without changing the `v10` schema or `Storage` signatures.
  - Un-completing a task (`reopen_task`), lowering a habit log below `goal_target`, or undoing a completion/log soft-revokes the matching `progress_ledger` row (`SET deleted_at = :now_ms, updated_at = :now_ms, usn = -1 WHERE user_id = :user_id AND source_key = :source_key AND deleted_at IS NULL`) inside the **same SQLite transaction**.
  - **Deleting a task or habit (`delete_task`, `delete_habit`) keeps rewards already earned** (same as deleting a card keeps its review rewards in `progress_ledger`); deletion never revokes ledger rows.
- **No XP or gold constants are defined in ADR-018.** (`R3` / spec `13a` decides all reward amounts.)

---

### 2.8 Undo (`UndoLog` / `UndoAction`)

`crates/bibalak-core/src/undo.rs:L19-L31` (`UndoAction`) gains seven variants; each callback runs inside `Storage` with `now_ms` from `Collection`'s `Clock`:

| Action recorded in `UndoLog`    | Triggering `Collection` method                        | What undo restores in a single transaction                                                                                                                                                                                                                                                                              |
| :------------------------------ | :---------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompleteTask { title }`        | `complete_task`                                       | Restores `tasks.completed_at = prev`, `completed_day = prev`, `updated_at = now_ms`, `usn = -1`; if `granted == true`, soft-revokes `task_done:<task_id>` in `progress_ledger`.                                                                                                                                         |
| `ReopenTask { title }`          | `reopen_task`                                         | Restores `tasks.completed_at = prev`, `completed_day = prev`, `updated_at = now_ms`, `usn = -1`; if `reopen` revoked a reward, re-activates it with its captured `xp`/`gold_cents`.                                                                                                                                     |
| `DeleteTask { title }`          | `delete_task`                                         | Restores `tasks.deleted_at = NULL`, `updated_at = now_ms`, `usn = -1` (does not alter `progress_ledger`).                                                                                                                                                                                                               |
| `DeleteTaskList { name }`       | `delete_task_list`                                    | Restores `task_lists.deleted_at = NULL`, `updated_at = now_ms`, `usn = -1`, and restores `list_id = Some(list_id)` on the tasks that were moved to Inbox when the list was deleted.                                                                                                                                     |
| `LogHabit { title }`            | `log_habit`                                           | Restores the prior `habit_logs` row snapshot (`logged_value`, `goal_target`, `completed`, `mood`, `note`, `deleted_at`) — or soft-deletes a newly created log (`deleted_at = now_ms`) — with `updated_at = now_ms`, `usn = -1`, and reverses any `habit_log:<habit_id>:<day_index>` grant/revocation made by this call. |
| `DeleteHabit { title }`         | `delete_habit`                                        | Restores `habits.deleted_at = NULL` (and restores `deleted_at = NULL` on any `habit_logs` soft-deleted by `delete_habit`), `updated_at = now_ms`, `usn = -1` (does not alter `progress_ledger`).                                                                                                                        |
| `DeleteCalendarEvent { title }` | `delete_calendar_event`, `delete_calendar_occurrence` | Restores `calendar_events.deleted_at = NULL` (whole series) or removes the excluded `occurrence_date` from `recurrence_exdates_json` (single occurrence), `updated_at = now_ms`, `usn = -1`.                                                                                                                            |

Create/update mutations (`create_task`, `update_task`, `create_habit`, `update_habit`, `save_matrix_quadrant`, `restore_matrix_quadrants`, `create_calendar_event`, `update_calendar_event`) persist immediately without pushing onto `UndoLog` (matching `add_note` and `set_deck_config` in `Collection`).

---

### 2.9 Sync (ADR-014, D27, D29)

1. **Export (`crates/bibalak-db/src/sync.rs#export_delta`):** Queries all rows with `usn = -1` ordered by `id` from `task_lists`, `tasks`, `matrix_quadrants`, `habits`, `habit_logs`, and `calendar_events`.
2. **`SyncDelta` & `MergeSummary` (`crates/bibalak-core/src/sync.rs:L39-L99`):**
   - `SyncDelta` adds six `#[serde(default)]` vectors (backward-compatible with pre-v10 deltas):
     - `pub task_lists: Vec<TaskList>`
     - `pub tasks: Vec<TaskItem>`
     - `pub matrix_quadrants: Vec<MatrixQuadrant>`
     - `pub habits: Vec<Habit>`
     - `pub habit_logs: Vec<HabitLog>`
     - `pub calendar_events: Vec<CalendarEvent>`
   - `SyncDelta::is_empty()` checks all six vectors.
   - `MergeSummary` adds `task_lists_updated: u32`, `tasks_updated: u32`, `matrix_quadrants_updated: u32`, `habits_updated: u32`, `habit_logs_updated: u32`, `calendar_events_updated: u32`.
3. **Clock-skew guard (`validate_delta`):** Validates `updated_at` and `deleted_at` (when `Some`) on all six vectors against `now_ms + MAX_FUTURE_DRIFT_MS`.
4. **Deletions (`deleted_at`, no `graves`):** None of the six tables write to `graves` or `grave_times` (`graves.oid` is `INTEGER` and Anki-only; ADR-014 §2.1). Deletions propagate solely via `deleted_at IS NOT NULL` and `usn = -1`.
5. **Merge rule per table (`apply_sync_delta`):**
   - Applied inside the existing transaction in parent-first order (`task_lists` → `tasks` → `matrix_quadrants` → `habits` → `habit_logs` → `calendar_events`) so `PRAGMA foreign_key_check` (`crates/bibalak-db/src/sync.rs:L881-L898`) always passes.
   - Natural/UUID key lookup: `id` for `task_lists`, `tasks`, `habits`, `calendar_events`; `(user_id, quadrant_key)` (matching deterministic `id`) for `matrix_quadrants`; `(user_id, habit_id, day_index)` (matching deterministic `id`) for `habit_logs`.
   - **Last-Writer-Wins (LWW) on `updated_at`:**
     - `remote.updated_at > local.updated_at` → remote wins, written with `usn = new_usn`.
     - `local.updated_at > remote.updated_at` → local row kept unchanged.
     - `remote.updated_at == local.updated_at` (tie):
       1. Deletion (`deleted_at.is_some()`) wins over active (`deleted_at.is_none()`), matching ADR-019 §2.6 (`crates/bibalak-db/src/sync.rs:L820-L834`).
       2. Otherwise, deterministic lexicographical byte comparison of canonical serialized fields (`remote_repr > local_repr`).
6. **Acknowledge (`acknowledge_delta`, `crates/bibalak-db/src/sync.rs:L906-L920`):** Sets `usn = {server_usn} WHERE usn = -1` on all six new tables.
7. **Full sync (`schema_mod`, D27):** **No** productivity mutation ever modifies `collection.schema_mod` or forces a full sync.

---

### 2.10 Anki Isolation

- `dump_collection` (`crates/bibalak-db/src/export.rs:L15-L33`), `CanonicalModel` (`crates/bibalak-core/src/model/canonical.rs`), `write_apkg` / `build_sqlite` (`crates/bibalak-ankifmt/src/writer.rs:L122-L200`), and `import_with_tz` (`crates/bibalak-db/src/import.rs:L1-L13`) **never** read, write, or export any of the six productivity tables.
- Bibalak's own backups (`Storage::backup_db` in `crates/bibalak-db/src/storage.rs`) hot-copy the full SQLite database file and therefore preserve all productivity tables automatically.

---

### 2.11 Code Contract for Phase C (Steps `9`–`12`)

#### A. Pure Domain Module: `crates/bibalak-core/src/productivity.rs`

Export `pub mod productivity;` in `crates/bibalak-core/src/lib.rs`. Zero IO, zero wall-clock reads (`sha1` already in `crates/bibalak-core/Cargo.toml:L16`).

```rust
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use ts_rs::TS;

// ── Identifiers & Constants ──────────────────────────────────────────────────

pub fn entity_id_v5(kind: &str, user_id: &str, natural_key: &str) -> String { /* SHA-1 over "keepsake:{kind}:v1:{user_id}:{natural_key}" -> RFC 4122 v5, same bit-mask as progress::ledger_id */ }
pub fn is_valid_uuid(s: &str) -> bool { /* 36 chars lowercase hex 8-4-4-4-12 */ }
pub fn date_string_to_epoch_days(date: &str) -> crate::error::CoreResult<i64> { /* strict YYYY-MM-DD -> Unix epoch days */ }

// ── Enums ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TaskPriority { High, Medium, Low, None }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum QuadrantKey { Q1, Q2, Q3, Q4 }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MatrixGroupBy { None, Tag, List, Priority, Date }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MatrixSortBy { Date, Priority, Title, Manual }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MatrixDateFilter { NoDate, Overdue, Today, Tomorrow, Next7Days, ThisMonth }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MatrixItemType { Task, DeckDue }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "mode", rename_all = "snake_case")]
#[ts(export)]
pub enum MatrixListFilter {
    All,
    Inbox,
    Tasks,
    Custom {
        list_ids: Vec<String>,
        #[ts(type = "number[]")]
        deck_ids: Vec<i64>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QuadrantRule {
    pub lists: MatrixListFilter,
    /// `None` = all dates; `Some(vec)` = non-empty predicate list.
    pub date_filters: Option<Vec<MatrixDateFilter>>,
    /// `None` = all priorities; `Some(vec)` = non-empty subset.
    pub priorities: Option<Vec<TaskPriority>>,
    /// `None` = all item types; `Some(vec)` = non-empty subset.
    pub types: Option<Vec<MatrixItemType>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HabitFrequencyKind { Daily, Weekdays, WeeklyCount, EveryNDays }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HabitGoalMode { AchieveAll, ReachAmount }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HabitSection { Morning, Afternoon, Night, Others }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CalendarRecurrenceFreq { Daily, Weekly }

// ── Sync / Row Entities (mirrors SQLite rows 1:1) ────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskList {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub color_token: String,
    pub icon_key: Option<String>,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskItem {
    pub id: String,
    pub user_id: String,
    pub list_id: Option<String>,
    pub title: String,
    pub notes: String,
    pub priority: TaskPriority,
    pub manual_quadrant: Option<QuadrantKey>,
    pub due_date: Option<String>,
    pub scheduled_start_ms: Option<i64>,
    pub scheduled_end_ms: Option<i64>,
    pub tags: Vec<String>,
    pub deck_id: Option<i64>,
    pub completed_at: Option<i64>,
    pub completed_day: Option<i32>,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatrixQuadrant {
    pub id: String,
    pub user_id: String,
    pub quadrant_key: QuadrantKey,
    pub title: String,
    pub color_token: String,
    pub group_by: MatrixGroupBy,
    pub sort_by: MatrixSortBy,
    pub rule: QuadrantRule,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Habit {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub notes: String,
    pub icon_key: String,
    pub color_token: String,
    pub frequency_kind: HabitFrequencyKind,
    pub weekdays: Vec<u8>,
    pub weekly_target: Option<u8>,
    pub interval_days: Option<u32>,
    pub goal_mode: HabitGoalMode,
    pub goal_target: f64,
    pub goal_unit: String,
    pub start_day_index: i32,
    pub target_days: Option<u32>,
    pub section: HabitSection,
    pub reminders: Vec<String>,
    pub auto_popup_log: bool,
    pub deck_id: Option<i64>,
    pub archived_at: Option<i64>,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HabitLog {
    pub id: String,
    pub user_id: String,
    pub habit_id: String,
    pub day_index: i32,
    pub logged_value: f64,
    pub goal_target: f64,
    pub completed: bool,
    pub mood: Option<u8>,
    pub note: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CalendarRecurrence {
    pub freq: CalendarRecurrenceFreq,
    pub interval: u32,
    pub weekdays: Vec<u8>,
    pub until_date: Option<String>,
    pub count: Option<u32>,
    pub exdates: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub description: String,
    pub location: String,
    pub color_token: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub is_all_day: bool,
    pub recurrence: Option<CalendarRecurrence>,
    pub linked_task_id: Option<String>,
    pub external_account_id: Option<String>,
    pub external_event_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

// ── IPC Request & Response DTOs ──────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskListDto {
    pub id: String,
    pub name: String,
    pub color_token: String,
    pub icon_key: Option<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskListInput {
    pub name: String,
    pub color_token: String,
    pub icon_key: Option<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskDto {
    pub id: String,
    pub list_id: Option<String>,
    pub list_name: Option<String>,
    pub title: String,
    pub notes: String,
    pub priority: TaskPriority,
    pub manual_quadrant: Option<QuadrantKey>,
    pub effective_quadrant: Option<QuadrantKey>,
    pub due_date: Option<String>,
    #[ts(type = "number | null")]
    pub scheduled_start_ms: Option<i64>,
    #[ts(type = "number | null")]
    pub scheduled_end_ms: Option<i64>,
    pub tags: Vec<String>,
    #[ts(type = "number | null")]
    pub deck_id: Option<i64>,
    pub deck_name: Option<String>,
    #[ts(type = "number | null")]
    pub completed_at: Option<i64>,
    pub completed_day: Option<i32>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskInput {
    pub list_id: Option<String>,
    pub title: String,
    pub notes: String,
    pub priority: TaskPriority,
    pub manual_quadrant: Option<QuadrantKey>,
    pub due_date: Option<String>,
    #[ts(type = "number | null")]
    pub scheduled_start_ms: Option<i64>,
    #[ts(type = "number | null")]
    pub scheduled_end_ms: Option<i64>,
    pub tags: Vec<String>,
    #[ts(type = "number | null")]
    pub deck_id: Option<i64>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MatrixQuadrantDto {
    pub quadrant_key: QuadrantKey,
    pub title: String,
    pub color_token: String,
    pub group_by: MatrixGroupBy,
    pub sort_by: MatrixSortBy,
    pub rule: QuadrantRule,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MatrixDeckDueItemDto {
    #[ts(type = "number")]
    pub deck_id: i64,
    pub deck_name: String,
    pub due_count: u32,
    pub quadrant_key: QuadrantKey,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MatrixBoardDto {
    pub today_date: String,
    pub quadrants: Vec<MatrixQuadrantDto>,
    pub tasks: Vec<TaskDto>,
    pub deck_due_items: Vec<MatrixDeckDueItemDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HabitDto {
    pub id: String,
    pub title: String,
    pub notes: String,
    pub icon_key: String,
    pub color_token: String,
    pub frequency_kind: HabitFrequencyKind,
    pub weekdays: Vec<u8>,
    pub weekly_target: Option<u8>,
    pub interval_days: Option<u32>,
    pub goal_mode: HabitGoalMode,
    pub goal_target: f64,
    pub goal_unit: String,
    pub start_day_index: i32,
    pub start_date: String,
    pub target_days: Option<u32>,
    pub section: HabitSection,
    pub reminders: Vec<String>,
    pub auto_popup_log: bool,
    #[ts(type = "number | null")]
    pub deck_id: Option<i64>,
    pub deck_name: Option<String>,
    #[ts(type = "number | null")]
    pub archived_at: Option<i64>,
    pub sort_order: i32,
    pub current_streak: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HabitInput {
    pub title: String,
    pub notes: String,
    pub icon_key: String,
    pub color_token: String,
    pub frequency_kind: HabitFrequencyKind,
    pub weekdays: Vec<u8>,
    pub weekly_target: Option<u8>,
    pub interval_days: Option<u32>,
    pub goal_mode: HabitGoalMode,
    pub goal_target: f64,
    pub goal_unit: String,
    /// ISO `"YYYY-MM-DD"`; `None` defaults to backend `today`.
    pub start_date: Option<String>,
    pub target_days: Option<u32>,
    pub section: HabitSection,
    pub reminders: Vec<String>,
    pub auto_popup_log: bool,
    #[ts(type = "number | null")]
    pub deck_id: Option<i64>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HabitLogDto {
    pub habit_id: String,
    pub day_index: i32,
    pub date: String,
    pub logged_value: f64,
    pub goal_target: f64,
    pub completed: bool,
    pub mood: Option<u8>,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HabitLogInput {
    pub habit_id: String,
    /// Collection day index; `None` defaults to `Collection::today()`.
    pub day_index: Option<i32>,
    pub logged_value: f64,
    pub mood: Option<u8>,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HabitDayRingDto {
    pub day_index: i32,
    pub date: String,
    pub scheduled_count: u32,
    pub completed_count: u32,
    /// `0.0 ..= 1.0` partial-aware completion ratio (`P_d`).
    pub completion_ratio: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HabitBoardDto {
    pub today_day_index: i32,
    pub today_date: String,
    pub week_days: Vec<HabitDayRingDto>,
    pub habits: Vec<HabitDto>,
    pub logs: Vec<HabitLogDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CalendarEventInput {
    pub title: String,
    pub description: String,
    pub location: String,
    pub color_token: String,
    #[ts(type = "number")]
    pub start_ms: i64,
    #[ts(type = "number")]
    pub end_ms: i64,
    pub is_all_day: bool,
    pub recurrence: Option<CalendarRecurrence>,
    pub linked_task_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CalendarOccurrenceDto {
    pub event_id: String,
    pub occurrence_date: String,
    pub is_recurring: bool,
    pub title: String,
    pub description: String,
    pub location: String,
    pub color_token: String,
    #[ts(type = "number")]
    pub start_ms: i64,
    #[ts(type = "number")]
    pub end_ms: i64,
    pub is_all_day: bool,
    pub linked_task_id: Option<String>,
    pub recurrence: Option<CalendarRecurrence>,
}

// ── Internal Storage Helper Outcomes ─────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct HabitLogWriteOutcome {
    pub previous: Option<HabitLog>,
    pub current: HabitLog,
    pub reward_granted: bool,
    pub reward_revoked: bool,
}
```

#### B. `Storage` Port Methods (`crates/bibalak-core/src/ports.rs` & `fake_storage.rs`)

Added inside a new `// ── Productivity (M1) ──` section at the bottom of `pub trait Storage` (`crates/bibalak-core/src/ports.rs:L834`) and implemented in `FakeStorage` (`crates/bibalak-core/src/collection/fake_storage.rs`):

```rust
    // ── Productivity (M1) ────────────────────────────────────────────────────
    /// Generate a lowercase RFC 4122 v4 UUID (`fastrand` in `bibalak-db`, atomic counter in `FakeStorage`).
    fn new_uuid(&self) -> String;

    fn list_task_lists(&self, user_id: &str) -> CoreResult<Vec<crate::productivity::TaskList>>;
    fn upsert_task_list(&self, list: &crate::productivity::TaskList) -> CoreResult<()>;
    fn soft_delete_task_list(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<Vec<String>>;
    fn restore_task_list(&self, user_id: &str, id: &str, task_ids: &[String], now_ms: i64) -> CoreResult<()>;

    fn list_tasks(&self, user_id: &str, include_completed: bool) -> CoreResult<Vec<crate::productivity::TaskItem>>;
    fn get_task(&self, user_id: &str, id: &str) -> CoreResult<Option<crate::productivity::TaskItem>>;
    fn upsert_task(&self, task: &crate::productivity::TaskItem) -> CoreResult<()>;
    fn set_task_completion(
        &self,
        user_id: &str,
        id: &str,
        completed_at: Option<i64>,
        completed_day: Option<i32>,
        reward: Option<&crate::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
        now_ms: i64,
    ) -> CoreResult<bool>;
    fn soft_delete_task(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()>;
    fn restore_task(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()>;

    fn list_matrix_quadrants(&self, user_id: &str) -> CoreResult<Vec<crate::productivity::MatrixQuadrant>>;
    fn upsert_matrix_quadrant(&self, q: &crate::productivity::MatrixQuadrant) -> CoreResult<()>;

    fn list_habits(&self, user_id: &str, include_archived: bool) -> CoreResult<Vec<crate::productivity::Habit>>;
    fn get_habit(&self, user_id: &str, id: &str) -> CoreResult<Option<crate::productivity::Habit>>;
    fn upsert_habit(&self, habit: &crate::productivity::Habit) -> CoreResult<()>;
    fn soft_delete_habit(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<Vec<String>>;
    fn restore_habit(&self, user_id: &str, id: &str, log_ids: &[String], now_ms: i64) -> CoreResult<()>;

    fn list_habit_logs_range(
        &self,
        user_id: &str,
        from_day: i32,
        to_day: i32,
    ) -> CoreResult<Vec<crate::productivity::HabitLog>>;
    fn upsert_habit_log(
        &self,
        log: &crate::productivity::HabitLog,
        reward: Option<&crate::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
    ) -> CoreResult<crate::productivity::HabitLogWriteOutcome>;
    fn restore_habit_log_snapshot(
        &self,
        user_id: &str,
        habit_id: &str,
        day_index: i32,
        previous: Option<&crate::productivity::HabitLog>,
        restore_reward: Option<&crate::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
        now_ms: i64,
    ) -> CoreResult<()>;

    fn list_calendar_events(&self, user_id: &str) -> CoreResult<Vec<crate::productivity::CalendarEvent>>;
    fn get_calendar_event(&self, user_id: &str, id: &str) -> CoreResult<Option<crate::productivity::CalendarEvent>>;
    fn upsert_calendar_event(&self, event: &crate::productivity::CalendarEvent) -> CoreResult<()>;
    fn soft_delete_calendar_event(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()>;
    fn restore_calendar_event(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()>;
```

#### C. `Collection` Methods (`crates/bibalak-core/src/collection/productivity.rs`)

- **Task lists:** `list_task_lists(&self) -> CoreResult<Vec<TaskListDto>>`, `create_task_list(&self, input: TaskListInput) -> CoreResult<TaskListDto>`, `update_task_list(&self, id: &str, input: TaskListInput) -> CoreResult<TaskListDto>`, `delete_task_list(&self, id: &str) -> CoreResult<()>`.
- **Tasks & Matrix:** `get_matrix_board(&self, include_completed: bool) -> CoreResult<MatrixBoardDto>`, `create_task(&self, input: TaskInput) -> CoreResult<TaskDto>`, `update_task(&self, id: &str, input: TaskInput) -> CoreResult<TaskDto>`, `complete_task(&self, id: &str) -> CoreResult<()>`, `reopen_task(&self, id: &str) -> CoreResult<()>`, `delete_task(&self, id: &str) -> CoreResult<()>`, `move_task_to_quadrant(&self, id: &str, quadrant: QuadrantKey) -> CoreResult<TaskDto>`, `save_matrix_quadrant(&self, q: MatrixQuadrantDto) -> CoreResult<MatrixQuadrantDto>`, `restore_matrix_defaults(&self, quadrant: Option<QuadrantKey>) -> CoreResult<Vec<MatrixQuadrantDto>>`.
- **Habits:** `get_habit_board(&self, week_start_day: Option<i32>) -> CoreResult<HabitBoardDto>`, `create_habit(&self, input: HabitInput) -> CoreResult<HabitDto>`, `update_habit(&self, id: &str, input: HabitInput) -> CoreResult<HabitDto>`, `archive_habit(&self, id: &str, archived: bool) -> CoreResult<()>`, `delete_habit(&self, id: &str) -> CoreResult<()>`, `log_habit(&self, input: HabitLogInput) -> CoreResult<HabitLogDto>`.
- **Calendar:** `list_calendar_occurrences(&self, window_start_ms: i64, window_end_ms: i64) -> CoreResult<Vec<CalendarOccurrenceDto>>`, `create_calendar_event(&self, input: CalendarEventInput) -> CoreResult<CalendarOccurrenceDto>`, `update_calendar_event(&self, id: &str, input: CalendarEventInput) -> CoreResult<CalendarOccurrenceDto>`, `delete_calendar_event(&self, id: &str) -> CoreResult<()>`, `delete_calendar_occurrence(&self, id: &str, occurrence_date: &str) -> CoreResult<()>`.

#### D. Tauri Commands, TypeScript Bindings, and `DomainEvent`

- **Commands (`apps/desktop/src-tauri/src/commands/productivity.rs`, registered in `apps/desktop/src-tauri/src/lib.rs`):**
  1. `list_task_lists() -> Result<Vec<TaskListDto>, IpcError>`
  2. `create_task_list(input: TaskListInput) -> Result<TaskListDto, IpcError>`
  3. `update_task_list(id: String, input: TaskListInput) -> Result<TaskListDto, IpcError>`
  4. `delete_task_list(id: String) -> Result<(), IpcError>`
  5. `get_matrix_board(include_completed: bool) -> Result<MatrixBoardDto, IpcError>`
  6. `create_task(input: TaskInput) -> Result<TaskDto, IpcError>`
  7. `update_task(id: String, input: TaskInput) -> Result<TaskDto, IpcError>`
  8. `complete_task(id: String) -> Result<(), IpcError>`
  9. `reopen_task(id: String) -> Result<(), IpcError>`
  10. `delete_task(id: String) -> Result<(), IpcError>`
  11. `move_task_to_quadrant(id: String, quadrant: QuadrantKey) -> Result<TaskDto, IpcError>`
  12. `save_matrix_quadrant(quadrant: MatrixQuadrantDto) -> Result<MatrixQuadrantDto, IpcError>`
  13. `restore_matrix_defaults(quadrant: Option<QuadrantKey>) -> Result<Vec<MatrixQuadrantDto>, IpcError>`
  14. `get_habit_board(week_start_day: Option<i32>) -> Result<HabitBoardDto, IpcError>`
  15. `create_habit(input: HabitInput) -> Result<HabitDto, IpcError>`
  16. `update_habit(id: String, input: HabitInput) -> Result<HabitDto, IpcError>`
  17. `archive_habit(id: String, archived: bool) -> Result<(), IpcError>`
  18. `delete_habit(id: String) -> Result<(), IpcError>`
  19. `log_habit(input: HabitLogInput) -> Result<HabitLogDto, IpcError>`
  20. `list_calendar_occurrences(window_start_ms: i64, window_end_ms: i64) -> Result<Vec<CalendarOccurrenceDto>, IpcError>`
  21. `create_calendar_event(input: CalendarEventInput) -> Result<CalendarOccurrenceDto, IpcError>`
  22. `update_calendar_event(id: String, input: CalendarEventInput) -> Result<CalendarOccurrenceDto, IpcError>`
  23. `delete_calendar_event(id: String) -> Result<(), IpcError>`
  24. `delete_calendar_occurrence(id: String, occurrence_date: String) -> Result<(), IpcError>`

- **Generated TS files under `packages/ipc-types/src/generated/` (re-exported in `packages/ipc-types/src/index.ts`):**
  `TaskPriority.ts`, `QuadrantKey.ts`, `MatrixGroupBy.ts`, `MatrixSortBy.ts`, `MatrixDateFilter.ts`, `MatrixItemType.ts`, `MatrixListFilter.ts`, `QuadrantRule.ts`, `HabitFrequencyKind.ts`, `HabitGoalMode.ts`, `HabitSection.ts`, `CalendarRecurrenceFreq.ts`, `CalendarRecurrence.ts`, `TaskListDto.ts`, `TaskListInput.ts`, `TaskDto.ts`, `TaskInput.ts`, `MatrixQuadrantDto.ts`, `MatrixDeckDueItemDto.ts`, `MatrixBoardDto.ts`, `HabitDto.ts`, `HabitInput.ts`, `HabitLogDto.ts`, `HabitLogInput.ts`, `HabitDayRingDto.ts`, `HabitBoardDto.ts`, `CalendarEventInput.ts`, `CalendarOccurrenceDto.ts` (plus updated `UndoAction.ts`).

- **`DomainEvent` & Query Invalidation:**
  - Add one variant `DomainEvent::ProductivityChanged` (`crates/bibalak-core/src/events.rs:L12-L23`), mapped to `"productivity-changed"` in `event_name` (`apps/desktop/src-tauri/src/lib.rs:L71-L84`).
  - Emitted after every mutating productivity use-case (`create_*`, `update_*`, `delete_*`, `complete_task`, `reopen_task`, `move_task_to_quadrant`, `save_matrix_quadrant`, `restore_matrix_defaults`, `archive_habit`, `log_habit`).
  - In `apps/desktop/src/lib/useCoreEvents.ts:L25-L61`, `"productivity-changed"` (as well as `"schema-changed"` for undo/sync) invalidates:
    - `queryKeys.undoStatus`
    - `queryKeys.progressSummary` and `queryKeys.progressHistory`
    - `["task-lists"]`, `["matrix"]`, `["habits"]`, `["calendar"]`
  - And `"deck-changed"` / `"card-answered"` / `"notes-changed"` also invalidate `["matrix"]` (so `DeckDue` items stay fresh) and `["calendar"]` (so FSRS study forecast stays fresh).

---

### 2.12 PostgreSQL Mapping (Stage 2, D30)

In Stage 2 (`SUPA1`), all six tables live in a dedicated schema (e.g. `productivity`), isolated behind the Bibalak API server (D30) and Postgres RLS (ADR-017).

| SQLite (`v10`) Column / Type                                                                                                                                                 | PostgreSQL Type                                             | Notes / Non-1:1 Mapping Items                                                                                                                                                                       |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id TEXT PRIMARY KEY`                                                                                                                                                        | `UUID PRIMARY KEY`                                          | Lowercase hyphenated UUID maps 1:1 with `::uuid`.                                                                                                                                                   |
| `user_id TEXT NOT NULL`                                                                                                                                                      | `UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` | `NIL_USER_ID` is claimed and rewritten to `auth.uid()` by Stage 2's first-upload migration RPC (`SUPA2`).                                                                                           |
| `created_at`, `updated_at`, `deleted_at`, `completed_at`, `archived_at`, `start_ms`, `end_ms`, `scheduled_start_ms`, `scheduled_end_ms` (`INTEGER`)                          | `BIGINT` (or `TIMESTAMPTZ` at API boundary)                 | Keeping `BIGINT` UTC ms preserves exact LWW integer comparison parity with SQLite; if `TIMESTAMPTZ` is chosen in ADR-017, convert via `to_timestamp(ms / 1000.0)` and expect millisecond precision. |
| `day_index`, `start_day_index`, `completed_day`, `sort_order`, `interval_days`, `target_days`, `recurrence_interval`, `recurrence_count`, `weekly_target`, `usn` (`INTEGER`) | `INTEGER` / `SMALLINT` / `BIGINT`                           | `usn` maps to `BIGINT` (matching `SyncDelta` `i64`); `weekly_target` maps to `SMALLINT`.                                                                                                            |
| `due_date`, `recurrence_until_date` (`TEXT` `YYYY-MM-DD`)                                                                                                                    | `DATE`                                                      | SQLite enforces `GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`; Stage 2 migration casts `::date` cleanly.                                                                                      |
| `tags_json`, `rule_json`, `weekdays_json`, `reminders_json`, `recurrence_weekdays_json`, `recurrence_exdates_json` (`TEXT` with `json_valid()`)                              | `JSONB NOT NULL`                                            | SQLite `CHECK (json_valid(...))` guarantees lossless `::jsonb` cast.                                                                                                                                |
| `auto_popup_log`, `completed`, `is_all_day` (`INTEGER IN (0, 1)`)                                                                                                            | `BOOLEAN NOT NULL`                                          | **Non-1:1:** SQLite `0/1` integer requires explicit `col <> 0` boolean conversion in the Postgres adapter/migration.                                                                                |
| `goal_target`, `logged_value` (`REAL`)                                                                                                                                       | `DOUBLE PRECISION`                                          | Matches IEEE-754 64-bit float (`f64`).                                                                                                                                                              |
| `deck_id INTEGER NULL`                                                                                                                                                       | `BIGINT NULL`                                               | **Non-1:1:** Anki `decks.id` is per-user / device-generated integer, not globally unique across users; Stage 2 scopes deck links by `(user_id, deck_id)`.                                           |
| Partial/covering indexes (`deleted_at IS NULL`)                                                                                                                              | Partial B-tree / GIN indexes                                | Per `supabase-postgres-best-practices`, Postgres adds `WHERE deleted_at IS NULL` partial indexes (e.g. `(user_id, start_ms, end_ms) WHERE deleted_at IS NULL`).                                     |

---

### 2.13 Failing-First Test List for Step `9` (`M1`)

Step `9` writes these tests **before** each implementation step (per Phase C/D rules in the internal planning notes):

1. **`bibalak-core` pure tests (`crates/bibalak-core/src/productivity.rs`):**
   - `quadrant_rule_validation_rejects_empty_filters_and_bad_uuids` — asserts `CoreError::Invalid` on empty `Some(vec![])`, long title, or bad custom UUID.
   - `evaluate_matrix_respects_manual_pin_and_first_match_precedence` — asserts `manual_quadrant` overrides automatic rules and `q1 -> q2 -> q3 -> q4` picks the first match without duplicates.
   - `default_matrix_rules_cover_every_priority_and_date_combination` — tests every combination of `TaskPriority` (`High|Medium|Low|None`) × due-date bucket (`NoDate|Overdue|Today|Tomorrow|Future`) against the 4 default rules (`q1`..`q4`), asserting each lands in **exactly one** quadrant (notably `High` + `Future`/`NoDate` → `Q2`), plus a custom-rule gap returning `effective_quadrant == None`.
   - `habit_schedule_and_ring_ratio_cover_all_four_frequencies` — tests `Daily`, `Weekdays`, `WeeklyCount`, `EveryNDays`, `target_days`, and partial `completion_ratio` ($P_d$).
   - `weekly_count_ring_worked_example_mon_to_sun` — tests a 3-per-week `WeeklyCount` habit over `Mon..Sun`: completing Mon/Wed/Fri yields `scheduled_count = 1, completion_ratio = 1.0` on Mon/Wed/Fri and `scheduled_count = 0, completion_ratio = 0.0` on Tue/Thu/Sat/Sun; completing only Mon/Wed with partial `0.5` on Tue yields `scheduled_count = 1` on all 7 days with `1.0` on Mon/Wed, `0.5` on Tue, and `0.0` on Thu–Sun.
   - `calendar_recurrence_to_rrule_and_window_expansion_respects_exdates_and_bounds` — tests `FREQ=DAILY|WEEKLY;INTERVAL=...;BYDAY=...;UNTIL|COUNT`, window clipping, `exdates` skipping, and all-day UTC-midnight invariance across TZ changes.
   - `date_string_roundtrip_and_invalid_dates_rejected` — tests leap days, invalid months/days (`2026-02-30`), and `epoch_days_to_date_string` parity.
2. **`Collection` + `FakeStorage` tests (`crates/bibalak-core/src/collection/productivity.rs`):**
   - `complete_and_reopen_task_record_undo_and_emit_event` — verifies `UndoAction::CompleteTask`/`ReopenTask`, `DomainEvent::ProductivityChanged`, and `completed_day == Collection::today()`.
   - `log_habit_undo_restores_prior_snapshot_and_day_index` — verifies `day_index` uses rollover-aware `Collection::today()`, and undo restores exact prior log state (or soft-deletes a new log).
   - `delete_task_list_moves_tasks_to_inbox_and_undo_restores_links` — verifies soft-delete clears `list_id` on tasks and undo restores both list and task links.
   - `restore_matrix_defaults_preserves_ids_and_marks_dirty` — verifies `id` unchanged, `deleted_at == None`, `usn == -1`.
3. **`bibalak-db` SQLite & migration tests (`crates/bibalak-db/src/productivity_tests.rs`):**
   - `migration_v9_to_v10_upgrades_real_v9_fixture_and_seeds_quadrants` — opens an existing v9 fixture with Anki data + `progress_ledger` rows, runs `MIGRATIONS[9]`, verifies `user_version == 10`, all 6 tables exist, all `CHECK`/`json_valid` constraints enforce invalid inputs, and the 4 seeded `matrix_quadrants` rows match `entity_id_v5("matrix_quadrant", NIL_USER_ID, "q1".."q4")` with `usn == 0`.
   - `deleted_deck_leaves_task_and_habit_links_recoverable_on_undo` — deletes linked deck, verifies `deck_name == None` and `PRAGMA foreign_key_check` is clean, then undoes `remove_deck` and verifies `deck_name == Some(...)`.
   - `task_and_habit_reward_hook_commits_and_revokes_atomically` — passes a `RewardGrant` (`task_done:<id>` / `habit_log:<id>:<day>`) to `set_task_completion` and `upsert_habit_log`, asserts `progress_ledger` grant, `reopen_task` / lowered-log revocation, rollback on injected storage failure, and that `soft_delete_task` / `soft_delete_habit` **preserves** already-earned rewards.
4. **Sync & Anki isolation tests (`crates/bibalak-db/src/sync_tests.rs`, `crates/bibalak-db/src/export.rs`):**
   - `sync_delta_roundtrips_all_six_productivity_tables_and_acknowledges_usn` — exports `usn = -1` rows, applies on second DB, verifies `acknowledge_delta` clears `usn`, and verifies `schema_mod` is unchanged.
   - `sync_merge_lww_tie_prefers_soft_delete_and_preserves_fk_order` — tests `updated_at` tie with `deleted_at.is_some()` winning, plus child-with-parent delta passing `PRAGMA foreign_key_check`.
   - `anki_dump_collection_excludes_all_productivity_tables` — seeds tasks, habits, logs, events, and quadrants, runs `dump_collection` + `write_apkg`, and asserts exported `.apkg` contains zero productivity tables/rows while `backup_db` retains all of them.

---

## 3. Accepted Limitations

- **Task checklists:** Tasks have no sub-item checklists in `v10`; deferred to a future migration.
- **Single-occurrence calendar edits:** Users can delete one occurrence of a recurring calendar event (`exdates`), but editing one occurrence's title/time without splitting the series (`RECURRENCE-ID`) is deferred to `CAL2` / later.
- **Note flagging in Matrix:** `MatrixItemType` supports `Task` and `DeckDue` in `v10`; Anki `Note` flag projection waits until note/card flag workflows are surfaced in Browse.
- **Cross-device deck links:** Because Anki `decks.id` is a per-collection integer (`crates/bibalak-db/src/import.rs:L11-L13`), a task/habit `deck_id` synced to another device assumes matching deck IDs (same limitation as `progress_by_deck` in ADR-019 §3).

---

## 4. Out of Scope

- External calendar accounts, OAuth tokens, and Google/Outlook/CalDAV sync (`CAL2`, `CAL3`, ADR-020).
- XP and gold reward amounts, daily rollover penalties, and deck-linked daily auto-completion rules (`R3`, spec `13a`).
- Any UI screens, routes, or localized strings (`M2`, `M3`, `CAL1`).
- Game presentation style (avatar, HUD, shop, pets, bosses — `R2`, `R4`).

---

## 5. Consequences

### Positive

- One clean migration (`v10`) powers Steps `9`–`13` without further schema changes before Stage 2.
- Every new table satisfies Stage 2 Postgres / account readiness (UUID PKs, `user_id`, UTC ms, `usn`, `deleted_at`, `json_valid()`) and joins ADR-014 delta sync with zero `schema_mod` full-sync triggers.
- Exact Rust/TS/port/command signatures let Phase C agents write code across Steps `9`–`12` before Build Window 1 (`BW1`).

### Negative / Trade-offs

- Storing calendar recurrence structurally (`daily` / `weekly` + `exdates`) means `monthly`/`yearly` local events cannot be created until a later extension adds them (or `CAL2` introduces an `RRULE` crate).
- Soft-referencing `deck_id` without a SQLite FK preserves deck-delete undo and sync FK safety, at the cost of checking missing decks at read time (`deck_name: None`).

---

## 6. Open Questions (For Later Cards)

- **RRULE crate in `CAL2` (Stage 2):** When Stage 2 adds Google/Outlook/CalDAV sync (`CAL2`), evaluate whether to keep our pure formatter/expander or adopt an `rrule` crate (requires owner dependency approval per D6 and `AGENTS.md`).
- **Reward numbers (`13a` / `R3`):** XP and gold constants for `task_done:<task_id>` and `habit_log:<habit_id>:<day_index>` are decided in spec `13a` (`R3s`).
- **Claiming deterministic IDs in Stage 2 (`SUPA2`, ADR-017):** Deterministic RFC 4122 v5 IDs derived from `NIL_USER_ID` (`matrix_quadrants`, `habit_logs`, `progress_ledger`) must be re-derived from the signed-in account's `user_id` or remapped when local data is claimed.
