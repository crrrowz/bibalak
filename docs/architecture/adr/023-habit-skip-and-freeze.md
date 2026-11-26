# ADR-023: Habit Skip and Freeze States in `habit_logs`

**Status:** Accepted 2026-11-24 (owner)  
**Date:** 2026-11-23  
**Card:** `13p` (`PLNs` — Plan screens redesign spec)  
**Related:** ADR-014, ADR-018, ADR-019, ADR-022

---

## 1. Context

In schema `v10` ([ADR-018](018-productivity-data-model.md)), `habit_logs` tracks only `logged_value REAL` and `completed INTEGER CHECK (completed IN (0, 1))`. Any scheduled day without a row where `completed = 1` breaks `compute_habit_streak` (`crates/bibalak-core/src/productivity.rs:L1475-L1561`) and drags down completion rings (`compute_habit_day_rings`, `L1381-L1472`).

The project defines two non-penalizing protection states on a habit day:

1. **Skip (`skipped`):** A neutral day state available in **every** presentation style (`Default`, `Scholar`, `Game`) for planned rest, illness, travel, or clinical rotation emergencies. A skipped day preserves the streak without incrementing it and earns no XP or gold.
2. **Freeze (`frozen`):** Earned streak protection available **only in Game style** (when `14a` / `R2` introduces the Game shop and reward inventory). It preserves the streak across an otherwise missed scheduled day without incrementing it and earns no XP or gold.

Adding a day-state column requires a schema migration (`v10 -> v11`) and updates to streak, ring, stats, sync, and Anki-linked auto-habit rules.

---

## 2. Decision

### 2.1 Migration `v10 -> v11` (`MIGRATIONS[10]`)

Append `MIGRATIONS[10]` in `crates/bibalak-db/src/schema.rs` (never modifying shipped `MIGRATIONS[0..=9]`):

```sql
-- v10 -> v11 (ADR-023, PLN0): habit skip and Game-only freeze states.
ALTER TABLE habit_logs
    ADD COLUMN status TEXT NOT NULL DEFAULT 'logged'
    CHECK (status IN ('logged', 'skipped', 'frozen'));
```

- **Backward compatibility:** Every existing `v10` row receives `status = 'logged'` automatically, preserving `completed IN (0, 1)` and `logged_value >= 0.0` with no table rewrite.
- **Invariant enforced in Rust (`validate_habit_log_input` and `Collection::log_habit`):** Whenever `status != HabitLogStatus::Logged` (`Skipped` or `Frozen`), `completed = false` and `logged_value = 0.0`. (SQLite `ALTER TABLE ADD COLUMN` supports column-level `CHECK` only; cross-column invariants are enforced in `bibalak-core`.)
- **Postgres Stage 2 mapping (ADR-018 §2.12):** Maps 1:1 to `status TEXT NOT NULL DEFAULT 'logged' CHECK (status IN ('logged', 'skipped', 'frozen'))` in the `productivity` schema.

### 2.2 Domain & IPC Types (`crates/bibalak-core/src/productivity.rs`)

Add one enum and extend `HabitLog`, `HabitLogDto`, and `HabitLogInput`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HabitLogStatus {
    #[default]
    Logged,
    Skipped,
    Frozen,
}
```

- `HabitLog` (sync/storage entity): adds `#[serde(default)] pub status: HabitLogStatus`.
- `HabitLogDto`: adds `pub status: HabitLogStatus`.
- `HabitLogInput`: adds `#[serde(default)] pub status: HabitLogStatus`. Existing UI callers that omit or pass `"logged"` behave identically to `v10`.
- `HabitDayRingDto`: keeps `scheduled_count`, `completed_count`, `completion_ratio`, and adds `pub excused_count: u32` (`Skipped` + `Frozen` active-scheduled habits on that day) so the 7-day ring and tooltips distinguish an excused day from an unscheduled rest day.

### 2.3 Cycle 1 vs. Cycle 2 Guard on `Frozen`

- **Cycle 1 (`PLN0` / `PLN3`):** Users may set `status = Logged` or `status = Skipped`. Calling `log_habit` with `HabitLogStatus::Frozen` returns `CoreError::Invalid("freeze status requires Game streak-freeze inventory")` until Cycle 2 (`14a` / `R2`–`R4`) adds the freeze-token inventory, earning rules, and Game-only UI toggle.
- **Read path (`HabitLogDto`, `compute_habit_streak`, `compute_habit_day_rings`):** Already handles all three variants (`Logged`, `Skipped`, `Frozen`) uniformly so `R2` only needs to plug in token consumption.

### 2.4 Streak, Ring, Stats, Reward, and Auto-Habit Semantics

| Subsystem                                                         | `Logged` (`completed = true`)                                                     | `Logged` (`completed = false`)                               | `Skipped` (all styles)                                                                             | `Frozen` (Game only, Cycle 2+)                                                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Daily / Weekdays / EveryNDays streak** (`compute_habit_streak`) | `streak += 1`, continue                                                           | Break streak (unless today-in-progress grace applies)        | **Bridge:** `streak += 0`, continue                                                                | **Bridge:** `streak += 0`, continue                                                                |
| **`WeeklyCount` streak** (`compute_habit_streak`)                 | Counts toward `week_done` (`streak += week_done`)                                 | Does not count                                               | Counts as `week_excused`; effective target = `max(0, target - week_excused)`; adds `0` to `streak` | Counts as `week_excused`; effective target = `max(0, target - week_excused)`; adds `0` to `streak` |
| **7-day day rings** (`compute_habit_day_rings`)                   | In `scheduled_count`, `completed_count`, `ratio_sum += 1.0`                       | In `scheduled_count`, `ratio_sum += min(1, logged / target)` | Omitted from `scheduled_count` ($N_d$); increments `excused_count`                                 | Omitted from `scheduled_count` ($N_d$); increments `excused_count`                                 |
| **Habit history stats** (`get_habit_history`)                     | In completed & denominator                                                        | In denominator (`missed` if past)                            | Excluded from completion-rate denominator; counted in `skipped_days`                               | Excluded from completion-rate denominator; counted in `frozen_days`                                |
| **Rewards (`ADR-019`)**                                           | Grants `10 XP`, `100 gold_cents` (if `day_index` is `today` or `today - 1`)       | Soft-revokes active `habit_log:<id>:<day>` reward            | **No reward** (`reward = None`); soft-revokes any prior active reward for that day                 | **No reward** (`reward = None`); soft-revokes any prior active reward for that day                 |
| **Undo (`UndoAction::LogHabit`)**                                 | Restores prior `HabitLog` snapshot (including `status`) and reverses ledger delta | Same                                                         | Same                                                                                               | Same (plus Cycle 2 restores consumed freeze token when implemented)                                |

#### Deck-Linked Auto Habits (`deck_id.is_some()`)

In `sync_deck_linked_habits_for_day` (`crates/bibalak-core/src/collection/productivity.rs:L170-L240`):

1. If an active non-deleted `HabitLog` for `(habit_id, day_index)` has `status == Skipped || status == Frozen`:
   - If `review_count` reaches `goal_target` (`completed == true`), auto-sync **promotes** the row back to `status = Logged`, `completed = true`, `logged_value = review_count`, and grants the `ADR-019` reward (completing the real study work overrides the skip).
   - If `review_count < goal_target` (including `0`), auto-sync **preserves** `status` (`Skipped` / `Frozen`), `logged_value = 0.0`, `completed = false`, and writes nothing (`changed = false`), so reviewing 1–2 cards on a sick/rest day never erases an explicit skip or freeze.
2. Manual `Collection::log_habit` on a `deck_id.is_some()` habit accepts `status = Skipped` (recording `logged_value = 0.0, completed = false, status = Skipped` and soft-revoking any active reward for that day), while `status = Logged` continues to substitute the authoritative `revlog` count (`ADR-019 §4.5`).

### 2.5 Sync (`ADR-014`, `ADR-018 §2.9`)

- `HABIT_LOG_COLS`, `map_habit_log`, and `upsert_habit_log_with_usn` in `crates/bibalak-db/src/productivity.rs` include `status` (`TEXT`).
- `SyncDelta.habit_logs` (`crates/bibalak-core/src/sync.rs`) uses `HabitLog` with `#[serde(default)] pub status: HabitLogStatus`, so pre-v11 JSON deltas deserialize cleanly as `HabitLogStatus::Logged`.
- LWW tie-break rules (`updated_at`, then `deleted_at.is_some()`, then canonical serialized comparison) and `schema_mod` (untouched; no full sync forced) remain unchanged.
- Anki `.apkg` / `.colpkg` export and import continue to ignore `habit_logs` (`ADR-018 §2.10`).

---

## 3. Alternatives Considered

1. **Separate `habit_skips` table:** Rejected. `habit_logs` already owns `(user_id, habit_id, day_index)` uniqueness, deterministic UUIDv5 `id`, LWW sync merge, and `UndoAction::LogHabit` snapshot restoration. A second table would duplicate sync and allow conflicting skip + log rows for the same day.
2. **Sentinel `logged_value = -1.0` in `v10`:** Rejected. Violates `CHECK (logged_value >= 0.0)` in `v10`, mixes quantitative amounts with day state, and cannot distinguish `Skipped` from `Frozen`.
3. **Setting `completed = 1` with `logged_value = 0.0`:** Rejected. Falsely increments `current_streak`, inflates `completed_count` in 7-day rings, and triggers `ADR-019` XP/gold payouts on days with no work.

---

## 4. Consequences

### Positive

- One lightweight `ALTER TABLE` (`v10 -> v11`) handles both all-style neutral skips (`PLN3`) and future Game-only freezes (`14a` / `R2`).
- Zero reward inflation, zero streak inflation, and zero penalty — preserving `ADR-019 §4.1`.
- Existing `UndoLog` snapshot mechanics (`restore_habit_log_snapshot`) and `ADR-014` sync work unchanged once `status` is included in `HabitLog`.

### Negative / Trade-offs

- Requires a schema bump (`v10 -> v11`) and one Rust compile batch (`BW1b`) before `PLN3` can persist `Skipped` days.
- `Frozen` status validation rejects writes until Cycle 2 defines freeze-token storage and consumption rules.
