# ADR-019: Progress Engine — XP, Level, Gold, and Undo-Safe Reward Ledger

**Status:** Accepted (owner, 2026-11-21)  
**Date:** 2026-11-21  
**Card:** `R1` (Backlog Step 7; Decisions D1, D3, D14, D15, D30; ADR-001, ADR-007, ADR-014)  
**Gate:** Step 7 (Owner acceptance required before Part B implementation)

---

## 1. Context

Bibalak makes learning progress visible to every user through points earned from real study activity: **XP, levels, and gold** (D1). Presentation styles (`Default`, `Scholar`, `Game`, built in Step 8 `P1` and Step 14 `G1`) only change how this progress is displayed; the underlying points engine and ledger are one and the same.

To integrate with Bibalak's local SQLite collection today and Stage 2 multi-device sync tomorrow (D3, D14, D30, ADR-014), the progress engine must:

1. Prevent the **answer → undo → re-answer farming exploit** (at most one reward per card per collection day, cleanly revoked on undo without revoking an earlier same-day answer's reward).
2. Store all amounts as exact integers (no floating-point drift in SQLite or PostgreSQL).
3. Use a deterministic UUID primary key so reviewing the same card on two offline devices on the same day merges into a single reward row on sync.
4. Keep all reward math and leveling curves pure in `bibalak-core::progress` with original constants (D15).

---

## 2. Decision

### 2.1 Card Review Reward Rule & Idempotency Key (D15)

- **Per-rating rewards:**
  - `Rating::Again` (`ease = 1`): **1 XP**, **25 gold_cents** (`0.25` gold)
  - `Rating::Hard` (`ease = 2`): **2 XP**, **25 gold_cents** (`0.25` gold)
  - `Rating::Good` (`ease = 3`): **3 XP**, **25 gold_cents** (`0.25` gold)
  - `Rating::Easy` (`ease = 4`): **3 XP**, **25 gold_cents** (`0.25` gold) — equal to `Good` so rating choices stay honest.
- **Eligible `review_kind` values:**
  - `0` (Learn), `1` (Review), `2` (Relearn), and `3` (Filtered / Cram) earn a reward.
  - `4` (Manual reschedule: set due date, forget, reposition) earns **no reward** (`None`).
- **Once per card per collection day:**
  - Key format: `source_key = "card_review:<card_id>:<day_index>"`, where `day_index` comes exclusively from `Collection::today()` (rollover hour + timezone offset).
  - No hard daily cap; the `(user_id, source_key)` uniqueness constraint prevents same-day farming of a card.

### 2.2 Units

- **XP:** integer (`i64` in SQLite `INTEGER`, `u64` in domain totals).
- **Gold:** integer hundredths (`gold_cents: i64` in SQLite `INTEGER`, `25` per rewarded review = `0.25` gold). Floating-point columns are never used in the database.

### 2.3 Level Curve (Bibalak Constants, D15)

Players start at **Level 1** (`0 XP`). The XP required to advance from Level $L$ to $L + 1$ is:

$$\text{xp\_to\_next}(L) = 50 \times L + 50$$

The cumulative total XP required to reach Level $L$ ($L \ge 1$) is:

$$\text{cumulative\_xp}(L) = \sum_{k=1}^{L-1} (50k + 50) = 25 \times (L - 1) \times (L + 2)$$

| Level ($L$) | XP to Next ($L \to L+1$) | Cumulative XP at Start of $L$ | Good Reviews (`3 XP`) to Reach $L$ |
| :---------: | :----------------------: | :---------------------------: | :--------------------------------: |
|    **1**    |          `100`           |              `0`              |                `0`                 |
|    **2**    |          `150`           |             `100`             |                `34`                |
|    **3**    |          `200`           |             `250`             |                `84`                |
|    **4**    |          `250`           |             `450`             |               `150`                |
|    **5**    |          `300`           |             `700`             |               `234`                |
|    **6**    |          `350`           |            `1,000`            |               `334`                |
|    **7**    |          `400`           |            `1,350`            |               `450`                |
|    **8**    |          `450`           |            `1,750`            |               `584`                |
|    **9**    |          `500`           |            `2,200`            |               `734`                |
|   **10**    |          `550`           |            `2,700`            |               `900`                |
|   **25**    |         `1,300`          |           `16,200`            |              `5,400`               |
|   **50**    |         `2,550`          |           `63,700`            |              `21,234`              |

- **Pacing to Level 10 (`2,700 XP` = `900` Good reviews):** ~30 days at 30 Good reviews/day, ~20 days at 45 Good reviews/day, or ~15 days at 60 Good reviews/day.

### 2.4 Reward Ledger Table `progress_ledger` (Migration `v8 -> v9`)

Added as `MIGRATIONS[8]` (`v8 -> v9`) in `crates/bibalak-db/src/schema.rs` (never altering `v1–v8` or any Anki table):

```sql
CREATE TABLE progress_ledger (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    source_key  TEXT NOT NULL,
    xp          INTEGER NOT NULL CHECK (xp >= 0),
    gold_cents  INTEGER NOT NULL CHECK (gold_cents >= 0),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER NULL,
    usn         INTEGER NOT NULL DEFAULT -1,
    UNIQUE (user_id, source_key)
);
```

In `v13 -> v14` (`MIGRATIONS[13]`), `CREATE INDEX idx_progress_ledger_active_created ON progress_ledger(user_id, deleted_at, created_at)` is added for indexed per-day ledger existence checks and skip scans.

- **No historical backfill:** Imported `.apkg` / `.colpkg` `revlog` rows and pre-v9 review history earn no rewards. Upgrading users start at Level 1 (`0 XP`, `0 gold_cents`).
- **Local `user_id`:** Nil UUID (`"00000000-0000-0000-0000-000000000000"`) in Stage 1 (D3, ADR-014 §2.1).
- **Deterministic `id`:** Lowercase hyphenated UUID (RFC 4122 v5 layout: version `5`, variant `10xx`) derived from SHA-1 over a fixed Bibalak progress namespace + `user_id` + `":"` + `source_key` using the existing `sha1` (`0.10`) crate in the workspace. Two devices reviewing the same card on the same day generate the exact same `id`.
- **Grant, Undo, and Re-answer semantics:**
  1. **First answer on day $D$:** Inserts row with `deleted_at = NULL, created_at = now_ms, updated_at = now_ms, usn = -1`. `Storage::apply_answer` returns `Ok(true)` (reward was granted by this answer).
  2. **Answer again on day $D$ while active (`deleted_at IS NULL`):** No-op on `progress_ledger`; the existing active reward is preserved unchanged, and `Storage::apply_answer` returns `Ok(false)` (this answer did not grant or re-activate a reward).
  3. **Undo (`undo_answer`):** The undo closure constructed in `Collection::apply_answer` captures the **answer-time `source_key`** (using the `day_index` when the card was answered, never `Collection::today()` at undo time) **only when `Storage::apply_answer` returned `true`**; if `Storage::apply_answer` returned `false`, the undo closure passes `reward_source_key = None`. Consequently, `answer → second same-day answer (no-op) → undo of the second answer` leaves the first answer's reward active (covered by an explicit Part B test). When `reward_source_key` is `Some(key)`, `undo_answer` soft-revokes the row (`SET deleted_at = :now_ms, updated_at = :now_ms, usn = -1 WHERE user_id = :user_id AND source_key = :source_key AND deleted_at IS NULL`).
  4. **Re-answer on day $D$ after undo (`deleted_at IS NOT NULL`):** Un-revokes the existing row in place (`SET xp = :xp, gold_cents = :gold_cents, created_at = :now_ms, updated_at = :now_ms, deleted_at = NULL, usn = -1`) and `Storage::apply_answer` returns `Ok(true)` (so undoing this re-answer revokes it again). The `UNIQUE (user_id, source_key)` constraint guarantees a second active reward row can never exist.
- **Totals:** Computed via `SUM(xp)` and `SUM(gold_cents)` over rows where `deleted_at IS NULL` for all-time totals, and filtered by the colon-delimited suffix `source_key LIKE 'card_review:%:' || :today_day` for today's study rewards (because the day index is preceded by `':'`, `today = 1` matches `...:1` and never `...:11` or `...:21`; pinned by an explicit Part B test). No cached totals table in Stage 1.

### 2.5 Atomicity & `Storage` Port Changes

- Reward grant runs inside the **same SQLite transaction** as `Storage::apply_answer`; reward revocation runs inside the **same SQLite transaction** as `Storage::undo_answer`.
- **Port changes (`crates/bibalak-core/src/ports.rs` and `fake_storage.rs`):**
  - `Storage::apply_answer(&self, card_id: i64, next: &CardState, due: i64, log: &Revlog, reward: Option<&RewardGrant>) -> CoreResult<bool>` — returns `true` iff this call inserted a new reward row or re-activated a soft-revoked (`deleted_at IS NOT NULL`) row.
  - `Storage::undo_answer(&self, card_id: i64, prev_state: &CardState, prev_due: i64, revlog_id: i64, buried_siblings: &[i64], leech_note: Option<i64>, reward_source_key: Option<&str>, now_ms: i64) -> CoreResult<()>` — receives the answer-time `reward_source_key` (or `None` if that answer did not grant/re-activate a reward) and `now_ms` from `Collection`'s `Clock` via the `UndoLog` closure, removing the `SystemTime::now()` call in `bibalak-db/src/study.rs`.
  - New read method in a dedicated `// ── Progress (R1) ──` section in `ports.rs` and `fake_storage.rs`:
    `fn progress_totals(&self, user_id: &str, today: i32) -> CoreResult<ProgressTotals>`.

### 2.6 Sync Integration (D14, ADR-014)

- `SyncDelta` (`bibalak-core::sync`) gains `#[serde(default)] pub progress_ledger: Vec<ProgressLedgerEntry>`.
- **Export:** Includes all `progress_ledger` rows with `usn = -1`.
- **Merge rule:** Keyed by `id` / `(user_id, source_key)`. Last-writer-wins by `updated_at`; **on an `updated_at` tie, a revoke (`deleted_at IS NOT NULL`) wins** over an active grant.
- **Acknowledge:** Sets `usn = server_usn` for all `progress_ledger` rows with `usn = -1`.
- **Anki export isolation:** `progress_ledger` is excluded from `.apkg` / `.colpkg` import and export.

### 2.7 Pure Core (`bibalak-core::progress`) & Read-Only IPC

- **`bibalak-core::progress`:** Pure functions with no IO and no clock reads (`reward_for_review`, `review_source_key`, `ledger_id`, `xp_to_next`, `cumulative_xp_for_level`, `level_from_xp` using checked/saturating integer math). `sha1 = "0.10"` is newly added to `crates/bibalak-core/Cargo.toml` (reusing the crate version already in the workspace `Cargo.lock` and `bibalak-db`) so `ledger_id` is pure and unit-tested in `bibalak-core`.
- **IPC (`progress_summary`):** Read-only command returning `ProgressSummaryDto { level, xp_into_level, xp_to_next_level, total_xp, gold_cents, today_xp, today_gold_cents }`, exported via `ts-rs` to `@bibalak/ipc-types`, bound in `apps/desktop/src/lib/ipc.ts`, and mocked in `apps/desktop/src/dev/mocks/progress.ts`.

### 2.8 Accepted Limitations

- **Cross-device same-day undo:** Because devices share one deterministic row per `(user_id, card_id, day_index)`, if a user reviews a card on Device A and also reviews+undoes that same card on Device B on the same day, Device B's soft-revoke (`deleted_at IS NOT NULL`) has a newer (or tied) `updated_at` and revokes the shared row on merge, so Device A's genuine review on that day can lose its reward.

### 2.9 Out of Scope (Later Cards)

- Progress UI panel & presentation styles (`Default`, `Scholar`, `Game`) → Step 8 (`P1`).
- Tasks, matrix, habits, dailies, calendar → Steps 9–13 (`M1`–`CAL1`, ADR-018).
- Avatar, shop, spending gold, HP, mana, streaks, parties, bosses → Step 14 (`G1`).
- Hosted API server & Supabase sync transport → Stage 2 (ADR-017, D30).

---

## 3. Addendum (P2): Read-Only History Queries

Step `8a` (`P2`) adds three read-only queries and IPC commands for Scholar extras (certificate milestone dates, Transcript courses table, and daily Lecture Log), with **no schema change**:

1. **`progress_history()` -> `Vec<ProgressDay>`**
   - `ProgressDay { day: i32, date: String, xp: u64, gold_cents: u64, cumulative_xp: u64, level_after: u32 }`.
   - Reads active (`deleted_at IS NULL`) `progress_ledger` rows for `NIL_USER_ID`, parses the collection `day_index` from `source_key` in Rust (`parse_review_source_key`, splitting on `:` — malformed keys are skipped and counted in a debug log), sums XP/gold per day in ascending `day` order, computes `cumulative_xp` and `level_after` via `level_from_xp` in Rust (so the UI never computes levels, D1), and formats `date` (`YYYY-MM-DD`) using the collection's timezone offset and rollover hour. Only days with active rewards appear.

2. **`study_days(limit: Option<u32>)` -> `Vec<StudyDay>`**
   - `StudyDay { day: i32, date: String, reviews: u32, minutes: f64, deck_ids: Vec<i64>, xp: u64, gold_cents: u64 }`.
   - Returns the last `limit` study days (default `30`, max `365`), newest first.
   - `reviews` and `minutes` (`sum(taken_ms) / 60_000.0`, rounded to **one decimal place**) come from `revlog` bucketed with the same day logic as Stats (`day_bucket`), excluding manual reschedules (`review_kind == 4`). `deck_ids` are the deduplicated top-level deck IDs studied that day. `xp` and `gold_cents` come from active `progress_ledger` rows matching that day.

3. **`progress_by_deck()` -> `Vec<DeckProgress>`**
   - `DeckProgress { deck_id: i64, name: String, total_cards: u32, mature_pct: f64, retention_pct: f64, xp: u64, gold_cents: u64, last_studied_date: Option<String> }`.
   - Returns one row per top-level deck that has cards (`total_cards > 0`), ordered by name.
   - Subdecks fold into their top deck. `total_cards`, mature counts (`mature_pct`), and 30-day true retention (`retention_pct`) reuse Stats' exact card/revlog rules. Active ledger rewards join in Rust via the parsed `card_id` to the card's **current** top deck; rewards for deleted cards are omitted from per-deck rows while remaining in `progress_summary` totals. `last_studied_date` reflects the latest study review (`review_kind` in `0..=3`) for cards currently in that top deck.

---

## 4. Addendum (R3): rewards from tasks and habits

**Status:** Accepted (owner, 2026-11-22)  
**Card:** `R3s` (spec for Phase C Step `13` `R3`, building on ADR-018 `Accepted` and ADR-019 `Accepted`)  
**Related:** Decisions D1, D3, D14, D15, D16, D30; `apps/desktop/PRODUCT.md`; internal design notes §6–7  
**Overrides:** internal design notes §5 and `08-implementation-roadmap.md` Phase 3 where they differ (no HP, no damage, no streak/crit multipliers, no random drops in Stage 1 Cycle 1).

### 4.1 Voice & Non-Negotiable Invariants

- **Rewards only for real work; zero penalties (D1, `PRODUCT.md`):** No HP, no damage, no losing XP or gold on a missed day, and no "streak lost" shaming.
- **No manipulative multipliers:** No streak multiplier, no critical-hit roll, and no random rewards. Easy work is never worth more than careful work (D15).
- **One engine for all styles:** `Default`, `Scholar`, and `Game` read from the exact same `progress_ledger` and Rust computations; styles only alter presentation.
- **Single ledger, no cached totals:** All productivity rewards go exclusively through `progress_ledger` (`crates/bibalak-db/src/schema.rs:L218-L229`) with deterministic UUIDv5 keys (`ledger_id`, `crates/bibalak-core/src/progress.rs:L475-L498`). No second ledger table and no cached totals table.
- **Backend day boundaries only:** All "today" and "yesterday" checks use `Collection::today()`, `Collection::today_start_ms()`, and `Collection::today_end_ms()` (`crates/bibalak-core/src/collection.rs:L89-L120`). The UI never computes day indices.
- **ADR-018 schema & `Storage` signatures unchanged:** `MIGRATIONS[9]` (`v9 -> v10`) and every ADR-018 `Storage` port method keep their exact SQL columns and signatures.

### 4.2 Owner Decisions Recorded (2026-11-22)

> **Task & habit amounts:** "المهمة: الخيار أ — 10 XP و100 gold_cents، والأولوية ما تغيّر المكافأة. حدّد أيضاً مكافأة العادة: نفس القيمة (10 XP و100 gold_cents)، مرة واحدة باليوم لكل عادة. عادة الرقم: بدون مكافأة جزئية، المكافأة فقط عند الوصول للهدف."
>
> **Task daily cap:** "الحد اليومي: 10 مهام بمكافأة باليوم، بدون عمر أدنى. تصحيح: العداد يُحسب على يوم الإنجاز (يوم قيد الـ ledger على يوم الباكند)، مو على created_at للمهمة."
>
> **Back-logging:** "التسجيل بأثر رجعي: موافق — اليوم وأمس فقط (today - 1 على يوم الباكند، يحترم ساعة بداية اليوم والمنطقة الزمنية). الأيام الأقدم تنحفظ بدون مكافأة."
>
> **Deck-linked habits:** "العادات المرتبطة برزمة: موافق على التعبئة التلقائية من الـ revlog، وتنقص مع الـ Undo، والعدد للقراءة فقط. المكافأة الإضافية موافق: مرة باليوم عند اكتمال الهدف فقط. إذا Undo نزّل العدد تحت الهدف، تنسحب المكافأة (نفس قاعدة ADR-018)."
>
> **"Yesterday" summary:** "ملخص أمس: موافق — مرة واحدة، قابل للإغلاق، فقط إذا كان أكو نشاط أمس. تصحيح: كل نمط يعرض بعملته — Game يعرض XP/ذهب، Scholar نقاط المعرفة، Default أعداد فقط (بطاقات، مهام، عادات) بدون XP ولا ذهب. بدون أي لوم أو خسارة نقاط."
>
> **Owner correction (2026-11-22):** Default shows XP and gold like the existing progress panel.

### 4.3 Task Rewards & Anti-Farming Cap

1. **Reward amount (owner decision, Option A):**
   - `TASK_REWARD_XP = 10`, `TASK_REWARD_GOLD_CENTS = 100` (`1.00` gold) — ~3.3× a `Good` card review (`3 XP`, `25 gold_cents` in §2.1), rewarding task completion without overshadowing spaced-repetition study.
   - `TaskPriority` (`high | medium | low | none`) **never** alters the reward; otherwise users are incentivized to mark every task `high`.
   - **Idempotency key:** `task_done:<task_id>` (`ADR-018 §2.7`).
2. **Daily cap & anti-farming rule (no minimum age):**
   - **`TASK_DAILY_REWARD_CAP = 10`** rewarded task completions per collection day. No minimum age is required between `tasks.created_at` and completion.
   - **Exact ledger counter formula:** Because `task_done:<task_id>` carries no day index in `source_key`, the counter queries `progress_ledger` by **grant day** (`progress_ledger.created_at` inside today's backend rollover window `[today_start_ms, today_end_ms)`):
     ```sql
     SELECT COUNT(*)
     FROM progress_ledger
     WHERE user_id = ?1
       AND deleted_at IS NULL
       AND source_key LIKE 'task_done:%'
       AND created_at >= ?2
       AND created_at < ?3
     ```
     where `?2 = Collection::today_start_ms()` and `?3 = Collection::today_end_ms()` (`crates/bibalak-core/src/collection.rs:L110-L120`).
   - **Why this prevents every farming / double-counting edge case:**
     - **Delete cannot bypass the cap:** `delete_task` does not revoke `progress_ledger` (ADR-018 §2.7), so completing and deleting 10 tasks still counts as 10 active `task_done:%` rows in today's window.
     - **Reopen → re-complete on the same day never double-counts or exceeds 10:** `UNIQUE (user_id, source_key)` guarantees at most one row per `(user_id, task_done:<task_id>)`. `reopen_task` soft-revokes that row (`deleted_at = now_ms`), reducing the active count from $N$ to $N - 1$. Re-completing it while active count $< 10$ updates that same row **in place** (`created_at = now_ms, updated_at = now_ms, deleted_at = NULL, usn = -1`, identical to `apply_answer` at `crates/bibalak-db/src/study.rs:L889-L898`), returning the count to $N$ (never $N + 1$). If another task took the 10th slot while it was reopened, active count is already `10`, so re-completing grants no reward.
     - **Reopen on a later day:** `reopen_task` revokes the earlier day's row; re-completing on a new day sets `created_at = now_ms` inside the new day's window, counting `1` toward the new day's cap and `0` toward the old day.
   - **Capped completion UX:** Tasks beyond the 10th still complete normally (`completed_at = Some(now_ms)`, `completed_day = Some(today)`), pass `reward = None` to `Storage::set_task_completion`, record `UndoAction::CompleteTask` (with `revoke_key = None`), and emit `DomainEvent::ProductivityChanged`. The UI reads `ProgressSummaryDto.tasks_rewarded_today >= task_reward_daily_cap` (and checks whether `total_xp` did not increase on completion) to display a calm notice explaining that the daily task reward cap (`10`) was reached.

### 4.4 Habit Rewards & Back-Logging

1. **Reward amount (owner decision):**
   - `HABIT_REWARD_XP = 10`, `HABIT_REWARD_GOLD_CENTS = 100` (`1.00` gold), at most once per habit per day.
   - **Idempotency key:** `habit_log:<habit_id>:<day_index>` (`ADR-018 §2.7`).
2. **Numeric goals (`HabitGoalMode::ReachAmount`):**
   - **No partial rewards.** XP and gold are granted **only** when `logged_value >= goal_target` (`completed == true`). Partial values (`0 < logged_value < goal_target`) still update `habit_logs.logged_value` and the 7-day completion ring (`completion_ratio` in ADR-018 §2.4).
3. **Cross-habit daily cap:**
   - **None.** Each habit is already capped at 1 reward per day by `(user_id, habit_log:<habit_id>:<day_index>)`, habits are user-configured recurring routines rather than disposable tasks, and back-logging is bounded to 2 days.
4. **Back-logging window:**
   - Only **`day_index == today`** and **`day_index == today - 1`** (today and yesterday on the backend day index, respecting `rollover_hour` and `tz_offset_minutes`) earn rewards (`is_habit_day_reward_eligible`). Future days (`day_index > today`) and older days (`day_index <= today - 2`) earn **no reward** (`reward = None`).
   - Older logs (`day_index <= today - 2`) still save normally to `habit_logs`, updating `current_streak` and the 7-day rings. If a log from an older day had previously earned a reward when that day was current and is later lowered below `goal_target`, `upsert_habit_log` still passes `revoke_source_key` so the ledger stays truthful; raising an older day (`<= today - 2`) back to `completed` grants no reward.

### 4.5 Deck-Linked Habits ("Deck-Linked Dailies")

1. **Scope & calculation:**
   - Any active (non-deleted, non-archived) habit with `deck_id: Some(d)` tracks `revlog` reviews for deck `d` and all descendant subdecks (`deck_subtree_ids` via `decks.parent_id`).
   - Eligible reviews: rows in `revlog` whose timestamp (`revlog.id`) falls inside the backend day window `[day_start_ms, day_end_ms)` with `review_kind IN (0, 1, 2, 3)` (excluding `4` manual reschedules, matching `aggregate_study_days` at `crates/bibalak-core/src/progress.rs:L326-L328`) for cards whose **current** `cards.deck_id` is in `d`'s subtree.
   - Mapping to `HabitLog`:
     - `HabitGoalMode::ReachAmount`: `logged_value = review_count as f64`, `completed = logged_value >= habit.goal_target`.
     - `HabitGoalMode::AchieveAll`: `logged_value = if review_count > 0 { 1.0 } else { 0.0 }`, `completed = review_count > 0`.
   - If the linked deck is missing/deleted, `deck_subtree_ids` is empty and auto-sync is a no-op (ADR-018 §2.6).
2. **When auto-fill runs (both):**
   - **On card answer & card undo:** At the end of `Collection::apply_answer` (for `today`), and inside the `UndoAction::AnswerCard` callback closure after `undo_answer` commits. Because `UndoAction` (`crates/bibalak-core/src/undo.rs:L19-L31`) is a `ts`-exported label enum and `AnswerCard` has no fields, **do not add a field to `UndoAction::AnswerCard`**; instead, the undo callback closure recorded by `Collection::apply_answer` (`crates/bibalak-core/src/collection/study.rs:L471-L482`) captures `answer_day` (`today`) at answer time and passes it to `sync_deck_linked_habits_for_day` (reconciling when `answer_day` is within `today - 1 ..= today` at undo time).
   - **On habit board load:** At the start of `Collection::get_habit_board`, reconciling `today` so moved cards, timezone/rollover shifts, or external imports are always up to date.
   - **Idempotency & no refetch loop:** `sync_deck_linked_habits_for_day` compares the computed `logged_value` and `completed` against the existing non-deleted `HabitLog` row (and whether a ledger grant/revoke is required). It calls `Storage::upsert_habit_log` and emits `DomainEvent::ProductivityChanged` **only when a `habit_log` or `progress_ledger` row actually changed** (same `logged_value` and `completed` = no write, no event).
   - Auto-sync never pushes onto `UndoLog`, so pressing Undo after answering a card undoes the card review rather than a hidden habit step.
3. **Undo & manual logging interaction:**
   - **Card undo lowers count below `goal_target`:** Auto-sync updates `habit_logs.logged_value`, sets `completed = false`, and passes `revoke_source_key = Some("habit_log:<habit_id>:<day_index>")`, atomically soft-revoking the habit reward in `progress_ledger` inside `upsert_habit_log`.
   - **Read-only count on manual `log_habit`:** The UI displays deck-linked habit counts as read-only (while still allowing mood/note reflection). In Rust, when `Collection::log_habit` is called for a habit with `deck_id.is_some()`, it **ignores `input.logged_value`** and substitutes the authoritative `revlog` count for `(deck_id, target_day)` while saving `input.mood` and `input.note`.
4. **Extra reward & why it is not double-paying:**
   - Reaching the deck-linked habit's daily goal grants the normal habit reward (**10 XP**, **100 `gold_cents`**) via `habit_log:<habit_id>:<day_index>` **in addition** to each card's review reward (`card_review:<card_id>:<day_index>`).
   - This is not paying twice for the same click: card review rewards compensate individual card effort (1–3 XP, 25 `gold_cents`), whereas the habit reward is a **once-per-day goal-completion milestone** earned only when the full target (e.g., 50 cards) is reached and revoked if undone below target.

### 4.6 Today's Totals (`progress_summary`)

- **Current code:** `crates/bibalak-db/src/study.rs:L992-L1022` (`progress_totals` at `L1006-L1015`) and `crates/bibalak-core/src/collection/fake_storage.rs:L879-L901` (`L895-L898`) currently count only `card_review:%:<today>` keys, omitting tasks and habits.
- **Unified R3 rule (one rule for all kinds):**
  - `progress_totals(&self, user_id: &str, today_start_ms: i64, today_end_ms: i64)` sums active (`deleted_at IS NULL`) `progress_ledger` rows for `user_id` where **`created_at >= today_start_ms AND created_at < today_end_ms`** across all key prefixes (`card_review:`, `task_done:`, `habit_log:`), and simultaneously counts `tasks_rewarded_today` (`source_key LIKE 'task_done:%'` in the same window).
  - `Collection::progress_summary` (`crates/bibalak-core/src/collection/study.rs:L488-L503`) supplies `self.today_start_ms()` and `self.today_end_ms()` (`crates/bibalak-core/src/collection.rs:L110-L120`).
  - Note: A yesterday habit (`habit_log:<id>:<today - 1>`) back-logged _today_ has `created_at` inside today's window, so its XP/gold appears in `today_xp` / `today_gold_cents` (earned in today's session), while history views (`progress_history`, `study_days`) bucket it on `today - 1` (the habit's day).

### 4.7 History Views & Unified Key Parser

1. **One parser for all key kinds (`crates/bibalak-core/src/progress.rs`):**
   - `parse_ledger_source_key(key: &str) -> Option<ParsedSourceKey>`:
     - `card_review:<i64>:<i32>` → `ParsedSourceKey::CardReview { card_id, day_index }` (rejects leading `+`).
     - `task_done:<uuid>` → `ParsedSourceKey::TaskDone { task_id }` (exact 2 parts; `is_valid_uuid(task_id)`).
     - `habit_log:<uuid>:<i32>` → `ParsedSourceKey::HabitLog { habit_id, day_index }` (exact 3 parts; `is_valid_uuid(habit_id)`, rejects leading `+`).
     - Anything else returns `None` (skipped and counted in `skipped`).
   - `parse_review_source_key` (`crates/bibalak-core/src/progress.rs:L158-L172`) delegates to `parse_ledger_source_key` for backward compatibility.
   - `LedgerRewardInput` (`crates/bibalak-core/src/progress.rs:L176-L180`) adds `pub created_at: i64` (loaded by `load_active_rewards` at `crates/bibalak-db/src/study.rs:L1024-L1049` and `FakeStorage`).
2. **Behavior of each query:**
   - **`progress_history()` (`aggregate_progress_history`, `crates/bibalak-core/src/progress.rs:L261-L297`):** Includes `CardReview` (at `day_index`), `HabitLog` (at `day_index`), and `TaskDone` (at `day_index_for_ms(created_at, tz_offset_minutes, rollover_hour, created_day)`), so `cumulative_xp` and `level_after` match `progress_summary`.
   - **`study_days(limit)` (`aggregate_study_days`, `crates/bibalak-core/src/progress.rs:L300-L361`):**
     - Adds `tasks_completed: u32` and `habits_completed: u32` to `StudyDay` (counting non-deleted `tasks` with `completed_day == Some(day)` and non-deleted `habit_logs` with `completed == true && day_index == day`), and includes task/habit `xp` and `gold_cents` from `progress_ledger` via `parse_ledger_source_key`.
     - Days with `reviews > 0 || tasks_completed > 0 || habits_completed > 0 || xp > 0 || gold_cents > 0` appear in the newest-first list (`reviews = 0, minutes = 0.0, deck_ids = []` on productivity-only days).
   - **`progress_by_deck()` (`aggregate_progress_by_deck`, `crates/bibalak-core/src/progress.rs:L366-L472`):**
     - `CardReview` joins to the card's current top-level deck (unchanged).
     - `TaskDone` is **omitted** from per-deck rows (tasks are general productivity).
     - `HabitLog` is **included if and only if** the habit is non-deleted (`habits.deleted_at IS NULL`) and has `deck_id = Some(d)` present in `top_lookup`, rolling subdeck-linked habits up to their top-level deck (`habit_top_decks: &HashMap<String, i64>`). Non-deck habits and habits pointing to deleted decks remain in `progress_summary`, `progress_history`, and `study_days`.

### 4.8 Daily Rollover, Streaks & "Yesterday" Summary

1. **Lazy rollover (no penalties):**
   - No background midnight thread and no rollover penalty. On a new backend `Collection::today()`, nothing deducts XP, gold, or HP, and no "streak lost" guilt message is ever shown.
2. **Habit streak calculation (`compute_habit_streak`):**
   - Pure function in `bibalak-core` (`HabitDto.current_streak: u32`, ADR-018 §2.11 A) operating on non-deleted `habit_logs` with `completed == true`:
     - Active day window for the habit: `d >= habit.start_day_index` and (`target_days` is `None` or `d < start_day_index + target_days`).
     - **Today-in-progress grace rule:** If `today` is not yet completed, start walking backwards from `today - 1` (never breaking today's streak mid-day); if `today` is completed, include `today` and walk backwards.
     - **`Daily`, `Weekdays`, `EveryNDays`:** Walk backwards down to `start_day_index`. Unscheduled days are skipped; scheduled days with `completed == true` increment `streak += 1`; the first missed scheduled day breaks the loop (resetting the count on a missed day, with zero penalty).
     - **`WeeklyCount { target }`:** Walk backwards by ISO week (`Mon..Sun`, matching ADR-018 §2.4). In the current ISO week, add the week's completed days (`completed == true`) up through `today` (never breaking while the week is still open). For each earlier ISO week containing active days of the habit: if `week_completions >= target`, add `week_completions` to `streak`; otherwise stop (week missed its target).
3. **"Yesterday" summary (`yesterday_summary`):**
   - **When shown:** Once on the first launch/load of a new day (`today >= 1` and stored `yesterday_summary_seen_day < today`), **only if yesterday (`today - 1`) had at least one completed activity** (`reviews > 0 || tasks_completed > 0 || habits_completed > 0`). If yesterday had no activity, `yesterday_summary()` returns `Ok(None)` and **writes nothing** (the read command stays strictly read-only; only `dismiss_yesterday_summary` writes `yesterday_summary_seen_day`).
   - **Where & dismissal:** Non-blocking, dismissible summary card/banner at the top of the Home/Decks view (themed per presentation style). Calling `dismiss_yesterday_summary(day)` stores `day.to_string()` in the existing local `sync_state` key-value table (`Storage::get_sync_state` / `set_sync_state`, `crates/bibalak-core/src/ports.rs:L791-L795`) under `YESTERDAY_SUMMARY_SEEN_KEY = "yesterday_summary_seen_day"` (per-device, not synced, zero schema change).
   - **What each style displays (same `YesterdaySummaryDto`, zero blame):**
     - **`Default`:** Counts (`reviews`, `tasks_completed`, `habits_completed`) + `xp` + `gold_cents / 100` named **"gold"**, like the existing progress panel (internal design notes §4).
     - **`Scholar`:** Counts + `xp` + `gold_cents / 100` rendered as **knowledge points** (per `01-scholar-style.md` §4).
     - **`Game`:** Counts + `xp` + `gold_cents / 100` rendered as **XP and gold** (styled in R2).

### 4.9 Undo, Reopen, and Sync Matrix

| Path                                                  | Behavior (ADR-018 §2.7–2.8 & ADR-019 §2.4–2.6)                                                                                                                                                                                                                                                                                                                                                                                                         |
| :---------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`complete_task` → `undo`**                          | `complete_task` passes `Some(RewardGrant)` iff `tasks_rewarded_today < 10`; `UndoAction::CompleteTask` captures `revoke_key = granted.then_some(source_key)` and soft-revokes `task_done:<task_id>` in the same transaction as restoring `completed_at`/`completed_day`.                                                                                                                                                                               |
| **`complete_task` → `reopen_task` → `complete_task`** | `reopen_task` captures any active `RewardGrant` via `get_active_ledger_reward` (for `UndoAction::ReopenTask`) and passes `revoke_source_key = Some("task_done:<id>")` to `set_task_completion`. Re-completing checks active `task_done:%` count in `[today_start_ms, today_end_ms)`: if `< 10`, un-revokes the single row in place (`created_at = now_ms, deleted_at = NULL`); if `10` (another task filled the slot), completes with `reward = None`. |
| **`log_habit` → lower below goal → raise again**      | Lowering `logged_value < goal_target` sets `completed = false` and soft-revokes `habit_log:<habit_id>:<day_index>` in the same transaction. Raising `logged_value >= goal_target` again un-revokes the row in place if `day_index` is `today` or `today - 1`, or saves with `reward = None` if `day_index <= today - 2`.                                                                                                                               |
| **`delete_task` / `delete_habit`**                    | Soft-deletes the productivity row(s) without modifying `progress_ledger` (ADR-018 §2.7). Earned XP/gold stays intact, and a same-day deleted task still counts toward the 10-task daily cap.                                                                                                                                                                                                                                                           |
| **Two devices completing the same task/habit**        | Both compute the identical deterministic `ledger_id(user_id, source_key)` (`progress.rs:L475-L498`). `SyncDelta.progress_ledger` merges by `(user_id, source_key)` using LWW on `updated_at`, with **revoke (`deleted_at.is_some()`) winning on an `updated_at` tie** (`crates/bibalak-db/src/sync.rs:L820-L834`).                                                                                                                                     |

### 4.10 Code Contract for Step 13 (`R3`, Phase C)

1. **`crates/bibalak-core/src/progress.rs` (pure, zero IO, zero clock reads):**
   - **Constants:** `TASK_REWARD_XP: u64 = 10`, `TASK_REWARD_GOLD_CENTS: u64 = 100`, `TASK_DAILY_REWARD_CAP: u32 = 10`, `HABIT_REWARD_XP: u64 = 10`, `HABIT_REWARD_GOLD_CENTS: u64 = 100`, `YESTERDAY_SUMMARY_SEEN_KEY: &str = "yesterday_summary_seen_day"`.
   - **Structs & Enums:**
     - `pub struct FixedReward { pub xp: u64, pub gold_cents: u64 }`
     - `pub enum ParsedSourceKey { CardReview { card_id: i64, day_index: i32 }, TaskDone { task_id: String }, HabitLog { habit_id: String, day_index: i32 } }`
     - `LedgerRewardInput` adds `pub created_at: i64`.
     - `ProgressTotals` adds `pub tasks_rewarded_today: u32`.
     - `pub struct YesterdayActivity { pub reviews: u32, pub tasks_completed: u32, pub habits_completed: u32, pub xp: u64, pub gold_cents: u64 }`
     - `ProgressSummaryDto` (`#[ts(export)]`) adds `pub tasks_rewarded_today: u32` and `pub task_reward_daily_cap: u32`.
     - `StudyDay` (`#[ts(export)]`) adds `pub tasks_completed: u32` and `pub habits_completed: u32`.
     - `#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)] #[ts(export)] pub struct YesterdaySummaryDto { pub day: i32, pub date: String, pub reviews: u32, pub tasks_completed: u32, pub habits_completed: u32, #[ts(type = "number")] pub xp: u64, #[ts(type = "number")] pub gold_cents: u64 }`.
   - **Functions:**
     - `pub fn task_source_key(task_id: &str) -> String`
     - `pub fn habit_source_key(habit_id: &str, day_index: i32) -> String`
     - `pub fn parse_ledger_source_key(key: &str) -> Option<ParsedSourceKey>`
     - `pub fn parse_review_source_key(key: &str) -> Option<ParsedReviewSourceKey>` (delegates to `parse_ledger_source_key`)
     - `pub fn reward_for_task(tasks_rewarded_today: u32) -> Option<FixedReward>`
     - `pub fn is_habit_day_reward_eligible(day_index: i32, today: i32) -> bool`
     - `pub fn reward_for_habit(completed: bool, day_index: i32, today: i32) -> Option<FixedReward>`
     - `pub fn deck_subtree_ids(decks: &[(i64, Option<i64>)], root_deck_id: i64) -> HashSet<i64>`
     - `pub fn count_deck_reviews_in_window(revlogs: &[StudyRevlogInput], card_decks: &HashMap<i64, i64>, subtree_deck_ids: &HashSet<i64>, start_ms: i64, end_ms: i64) -> u32`
     - `pub fn compute_habit_streak(habit: &Habit, completed_days: &HashSet<i32>, today: i32, created_epoch_day: i64) -> u32`
     - `pub fn aggregate_study_days(..., completed_task_days: impl IntoIterator<Item = i32>, completed_habit_days: impl IntoIterator<Item = i32>, ...)`
     - `pub fn aggregate_progress_by_deck(..., habit_top_decks: &HashMap<String, i64>, ...)`
     - `pub fn build_yesterday_summary(day: i32, created_epoch_day: i64, activity: YesterdayActivity) -> Option<YesterdaySummaryDto>` (returns `None` when `reviews == 0 && tasks_completed == 0 && habits_completed == 0`).

2. **`Storage` port (`crates/bibalak-core/src/ports.rs`, `fake_storage.rs`, `crates/bibalak-db/src/storage.rs`):**
   - **ADR-018 methods (`set_task_completion`, `upsert_habit_log`, `restore_habit_log_snapshot`) keep their exact signatures.**
   - **Updated ADR-019 read method (`ports.rs:L800-L804`):**
     `fn progress_totals(&self, user_id: &str, today_start_ms: i64, today_end_ms: i64) -> CoreResult<crate::progress::ProgressTotals>;`
   - **New read methods in `// ── Progress engine (ADR-019, R3) ──`:**
     - `fn get_active_ledger_reward(&self, user_id: &str, source_key: &str) -> CoreResult<Option<crate::progress::RewardGrant>>;`
     - `fn deck_review_count_in_window(&self, deck_id: i64, start_ms: i64, end_ms: i64) -> CoreResult<u32>;`
     - `fn yesterday_activity(&self, user_id: &str, yesterday_day: i32, yesterday_start_ms: i64, yesterday_end_ms: i64) -> CoreResult<crate::progress::YesterdayActivity>;`

3. **`Collection` & `RewardGrant` wiring (`crates/bibalak-core/src/collection/productivity.rs` & `study.rs`):**
   - `complete_task`: checks `progress_totals(NIL_USER_ID, today_start_ms, today_end_ms).tasks_rewarded_today`, calls `reward_for_task(...)`, constructs `RewardGrant` with `task_source_key(id)`, passes `reward.as_ref()` and `None` to `set_task_completion`.
   - `reopen_task`: reads `prev_grant = get_active_ledger_reward(NIL_USER_ID, &task_source_key(id))?`, passes `None` and `Some(&task_source_key(id))` to `set_task_completion`, and captures `prev_grant` inside `UndoAction::ReopenTask`.
   - `log_habit`: when `habit.deck_id.is_some()`, replaces `input.logged_value` with the authoritative count from `deck_review_count_in_window` for `target_day`; computes `completed` and passes `reward_for_habit(completed, target_day, today)` (or `revoke_source_key` when `!completed`) to `upsert_habit_log`.
   - `sync_deck_linked_habits_for_day`: reconciles active `deck_id.is_some()` habits for `day_index` (`apply_answer` → `today`; the undo callback closure in `Collection::apply_answer` captures `answer_day` at answer time — without adding any field to `UndoAction::AnswerCard` — and passes `answer_day` to `sync_deck_linked_habits_for_day` when within `today - 1 ..= today`; `get_habit_board` → `today`) without pushing to `UndoLog`. Writes via `upsert_habit_log` and emits `DomainEvent::ProductivityChanged` only when a `habit_log` or `progress_ledger` row actually changed.
   - `yesterday_summary(&self) -> CoreResult<Option<YesterdaySummaryDto>>` (strictly read-only; returns `Ok(None)` and writes nothing when yesterday had no activity) and `dismiss_yesterday_summary(&self, day: i32) -> CoreResult<()>`.
   - Note for Step `13`: `Collection::today_start_ms` / `today_end_ms` / `day_zero_start_ms` (`crates/bibalak-core/src/collection.rs:L103-L120`) compute `[day_start_ms, day_end_ms)` for any `day_index` as `day_zero_start_ms + i64::from(day_index) * MS_PER_DAY`.

4. **Tauri IPC, `@bibalak/ipc-types`, and `DomainEvent` invalidations:**
   - New Tauri commands (`apps/desktop/src-tauri/src/commands/progress.rs`, registered in `lib.rs`):
     - `yesterday_summary() -> Result<Option<YesterdaySummaryDto>, IpcError>`
     - `dismiss_yesterday_summary(day: i32) -> Result<(), IpcError>`
   - Generated TS types (`packages/ipc-types/src/generated/`, written by hand in Phase C per the internal planning notes and re-exported in `packages/ipc-types/src/index.ts`):
     - Updated `ProgressSummaryDto.ts`: `{ level: number, xp_into_level: number, xp_to_next_level: number, total_xp: number, gold_cents: number, today_xp: number, today_gold_cents: number, tasks_rewarded_today: number, task_reward_daily_cap: number }`
     - Updated `StudyDay.ts`: adds `tasks_completed: number, habits_completed: number`
     - New `YesterdaySummaryDto.ts`: `{ day: number, date: string, reviews: number, tasks_completed: number, habits_completed: number, xp: number, gold_cents: number }`
   - Frontend bindings & mocks: `apps/desktop/src/lib/ipc.ts` (`yesterdaySummary`, `dismissYesterdaySummary`), `apps/desktop/src/lib/queryKeys.ts` (`yesterdaySummary: ["yesterday-summary"] as const`), `apps/desktop/src/dev/mocks/progress.ts`.
   - **`useCoreEvents.ts` invalidations (`apps/desktop/src/lib/useCoreEvents.ts:L25-L61`):**
     - `"productivity-changed"` invalidates `undoStatus`, `progressSummary`, `progressHistory`, `["study-days"]`, `progressByDeck`, `yesterdaySummary`, `["task-lists"]`, `["matrix"]`, `["habits"]`, `["calendar"]`.
     - `"card-answered"` and `"schema-changed"` also invalidate `["habits"]` and `yesterdaySummary` (in addition to `progressSummary`, `progressHistory`, `["study-days"]`, `progressByDeck` already at `L33-L44`).

### 4.11 Failing-First Test List for Step 13 (`R3`, Phase C)

1. **`bibalak-core` pure tests (`crates/bibalak-core/src/progress.rs`):**
   - `task_and_habit_reward_constants_and_priority_invariance`: asserts `10 XP / 100 gold_cents`, `reward_for_task(0..9) == Some(...)`, `reward_for_task(10) == None`, and `reward_for_habit` grants only when `completed && (day == today || day == today - 1)` (rejecting partial progress and `today - 2` or `today + 1`).
   - `parse_ledger_source_key_parses_all_three_kinds_and_rejects_malformed`: tests `card_review:<i64>:<i32>`, `task_done:<uuid>`, `habit_log:<uuid>:<i32>`, bad UUIDs, leading `+`, extra colons.
   - `aggregate_history_study_days_and_deck_progress_include_tasks_and_habits`: asserts `progress_history` includes all 3 kinds (tasks bucketed by `created_at` day), `study_days` populates `tasks_completed` / `habits_completed` + productivity-only days, and `progress_by_deck` includes deck-linked habits (including subdecks) while omitting tasks and unlinked habits.
   - `compute_habit_streak_covers_all_frequencies_with_today_grace_and_no_penalties`: tests `Daily`, `Weekdays`, `WeeklyCount`, `EveryNDays`, today-uncompleted grace, and missed-day reset to `0`.
   - `build_yesterday_summary_returns_none_when_empty_and_some_on_activity`: verifies suppression of inactive days and non-zero totals on active days.
2. **`Collection` + `FakeStorage` tests (`crates/bibalak-core/src/collection/productivity.rs` / `study_tests.rs`):**
   - `task_daily_cap_of_ten_and_reopen_recomplete_same_day_does_not_double_count`: completes 10 tasks (`100 XP`, `1000 gold_cents`), completes an 11th (succeeds, `0 XP`), reopens task #3 (drops to 9 active, `90 XP`) and re-completes task #3 same day (returns to `100 XP`, count stays `10`, never `11`), plus reopen-then-11th-fills-slot blocks re-complete reward.
   - `habit_backlogging_today_and_yesterday_reward_older_days_save_without_reward`: tests `today`, `today - 1`, `today - 2`, and `today + 1` across `rollover_hour` and `tz_offset_minutes`.
   - `deck_linked_habit_autofills_from_revlog_ignores_manual_value_and_revokes_on_card_undo`: answers cards up to `goal_target` (grants card rewards + 10 XP / 100 `gold_cents` habit bonus), verifies `log_habit` preserves `mood`/`note` while keeping the `revlog` count read-only, then undoes one card review dropping below `goal_target` and asserts `completed == false` and the habit reward is revoked (`progress_summary` drops by card review + 10 XP / 100 `gold_cents`).
   - `deck_linked_autofill_is_idempotent_and_emits_no_event_when_unchanged`: calls `get_habit_board` twice with unchanged `revlog` state and asserts zero redundant `habit_log` writes and zero `DomainEvent::ProductivityChanged` emissions when `logged_value` and `completed` match existing state.
   - `yesterday_summary_shows_once_per_day_and_skips_inactive_days`: advances clock across days with `TestClock`, verifies `None` on day 0 and after empty yesterday (with nothing written to `sync_state`), `Some` once on new day after active yesterday, and `None` after `dismiss_yesterday_summary`.
3. **`bibalak-db` SQLite tests (`crates/bibalak-db/src/productivity_tests.rs` / `study.rs`):**
   - `progress_totals_window_counts_cards_tasks_and_habits_and_respects_rollover`: verifies `today_xp`, `today_gold_cents`, and `tasks_rewarded_today` across `card_review:`, `task_done:`, and `habit_log:` keys inside `[today_start_ms, today_end_ms)`, including deleted tasks still counting toward the cap and cross-rollover reset.
   - `reopen_task_undo_and_habit_lower_raise_cycle_preserve_ledger_integrity`: tests `complete → undo`, `complete → reopen → undo(reopen)` (restoring exact grant), `complete → reopen → complete` same day (`1` row, `created_at` updated, cap respected), and `log_habit` goal-reached → lowered → raised again (`today` vs `today - 2`).
   - `deck_linked_habit_counts_subdecks_and_excludes_manual_reschedules`: verifies `deck_review_count_in_window` includes child subdecks, excludes `review_kind == 4`, and `progress_by_deck` rolls subdeck-linked habit rewards into the top-level deck.
   - `delete_task_and_delete_habit_keep_earned_rewards_and_cap_count`: verifies `progress_ledger` rows survive soft-delete and same-day deleted rewarded tasks still count toward `tasks_rewarded_today`.
4. **Sync tests (`crates/bibalak-db/src/sync_tests.rs`):**
   - `sync_two_devices_completing_same_task_or_habit_merges_to_single_reward_and_tie_prefers_revoke`: verifies identical `ledger_id`, single row after merge (10 XP, not 20 XP), and revoke winning on an `updated_at` tie.

### 4.12 Out of Scope

- `Game` style presentation (avatar, HUD, equipment, shop, custom rewards) → Step `14` (`R2`).
- Random item drops, pets, mounts, classes, skills, solo achievements, sound effects → Step `15` (`R4`).
- Any UI screen layouts beyond naming where `tasks_rewarded_today`, `YesterdaySummaryDto`, read-only deck-linked habit counts, and Lecture Log columns appear (`M2`, `M3`, `CAL1`, `R3`).
