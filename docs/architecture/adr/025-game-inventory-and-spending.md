# ADR-025: Game Inventory, Equipment, Custom Rewards, Gold Spending, and Freeze Tokens

**Status:** Accepted 2026-11-24 (owner)  
**Date:** 2026-11-24  
**Card:** `14a` (`R2s` — Game style spec; implements in `14` / `R2`, `BW2`)  
**Related:** ADR-014, ADR-018, ADR-019, ADR-023

---

## 1. Context

Bibalak's single progress engine ([ADR-019](019-progress-engine.md)) records earned XP and `gold_cents` in `progress_ledger` across all presentation styles (`Default`, `Scholar`, `Game`). Today:

- Nothing spends gold (`progress_ledger` enforces `CHECK (gold_cents >= 0)`).
- `habit_logs.status` ([ADR-023](023-habit-skip-and-freeze.md), `v11`) already supports `'frozen'`, but `Collection::log_habit` rejects `HabitLogStatus::Frozen` until freeze-token storage and consumption exist.
- The opt-in **Game** style (`14` / `R2`) needs persistent storage for:
  1. Free avatar appearance choices (`body_tone`, `hair_style`, `hair_color`, `starter_outfit`, `starter_accessory`, `backdrop`).
  2. Owned cosmetic inventory items (and future `15a` / `R4` unlocks such as pets, mounts, paths, and badges).
  3. Per-slot equipped items (`avatar_equipped`).
  4. Gold spending (`gold_spend_ledger`) for shop cosmetics, streak freeze tokens, and user-defined custom rewards.
  5. User-defined custom rewards (`custom_rewards`).
  6. Streak freeze token balance and consumption (`freeze_token_ledger`), reversible on `UndoAction::LogHabit` and habit unfreeze/completion.

Following the account-ready rules (Postgres-ready local SQLite), **ADR-014** (sync journal & deterministic LWW merge), **ADR-018 §2.9** (account-ready tables), and **ADR-019 §4.1** (single source of truth, no cached totals, zero penalties), balances must be derived directly from ledger rows rather than stored in mutable counter columns.

---

## 2. Decision

### 2.1 Migration `v11 -> v12` (`MIGRATIONS[11]`)

Append one migration (`MIGRATIONS[11]`, schema `v12`) in `crates/bibalak-db/src/schema.rs` without altering `MIGRATIONS[0..=10]`:

```sql
-- v11 -> v12 (ADR-025, R2): Game avatar, equipment, inventory, spending ledger,
-- custom rewards, and streak freeze token ledger.

CREATE TABLE avatar_profile (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    body_tone         TEXT NOT NULL DEFAULT 'tone_2',
    hair_style        TEXT NOT NULL DEFAULT 'hair_1',
    hair_color        TEXT NOT NULL DEFAULT 'brown',
    starter_outfit    TEXT NOT NULL DEFAULT 'tunic_slate',
    starter_accessory TEXT NOT NULL DEFAULT 'none',
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    deleted_at        INTEGER NULL,
    usn               INTEGER NOT NULL DEFAULT -1,
    UNIQUE (user_id)
);

CREATE TABLE inventory_items (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    item_key    TEXT NOT NULL,
    kind        TEXT NOT NULL
                CHECK (kind IN ('cosmetic')),
    source      TEXT NOT NULL
                CHECK (source IN ('starter', 'shop', 'unlock')),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER NULL,
    usn         INTEGER NOT NULL DEFAULT -1,
    UNIQUE (user_id, item_key)
);
CREATE INDEX idx_inventory_items_active
    ON inventory_items(user_id, deleted_at, kind);

CREATE TABLE avatar_equipped (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    slot        TEXT NOT NULL
                CHECK (slot IN (
                    'head', 'outfit', 'main_hand', 'off_hand',
                    'back', 'accessory', 'backdrop', 'frame'
                )),
    item_key    TEXT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER NULL,
    usn         INTEGER NOT NULL DEFAULT -1,
    UNIQUE (user_id, slot)
);

CREATE TABLE custom_rewards (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    title       TEXT NOT NULL CHECK (length(trim(title)) > 0),
    notes       TEXT NOT NULL DEFAULT '',
    cost_cents  INTEGER NOT NULL CHECK (cost_cents > 0),
    icon_key    TEXT NOT NULL DEFAULT 'gift',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER NULL,
    usn         INTEGER NOT NULL DEFAULT -1
);
CREATE INDEX idx_custom_rewards_active
    ON custom_rewards(user_id, deleted_at, sort_order, created_at);

CREATE TABLE gold_spend_ledger (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    idempotency_key TEXT NOT NULL,
    kind            TEXT NOT NULL
                    CHECK (kind IN ('cosmetic', 'freeze_token', 'custom_reward', 'path_change')),
    ref_key         TEXT NOT NULL,
    amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    deleted_at      INTEGER NULL,
    usn             INTEGER NOT NULL DEFAULT -1,
    UNIQUE (user_id, idempotency_key)
);
CREATE INDEX idx_gold_spend_ledger_active
    ON gold_spend_ledger(user_id, deleted_at, kind, created_at);

CREATE TABLE freeze_token_ledger (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    source_key  TEXT NOT NULL,
    delta       INTEGER NOT NULL CHECK (delta IN (-1, 1)),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER NULL,
    usn         INTEGER NOT NULL DEFAULT -1,
    UNIQUE (user_id, source_key)
);
CREATE INDEX idx_freeze_token_ledger_active
    ON freeze_token_ledger(user_id, deleted_at);
```

### 2.2 What `15a` (`ADR-026`) Uses Here

Changed in review (the internal archive) so the two ADRs share one source of truth:

- Pets and mounts live only in `ADR-026`'s `game_pets` (active pet and mounted flag included). This table therefore has no `'pet'` / `'mount'` inventory kinds or equipment slots, and no `'path_emblem'` / `'achievement_badge'` kinds (achievements live in `game_achievements`).
- Cosmetics that `15a` unlocks (`frame_copper_ring`, `backdrop_study_hearth`, `frame_path_<path_id>`) are ordinary `inventory_items` rows: `kind = 'cosmetic'`, `source = 'unlock'`. The `'frame'` slot is reserved for them; `R2` does not write it.
- `gold_spend_ledger.kind = 'path_change'` is reserved for `15a`'s path switch. `R2` writes only `'cosmetic' | 'freeze_token' | 'custom_reward'`.
- `R2a` exposes two helpers for `R4-1`, each running inside the caller's transaction: `grant_unlocked_cosmetic(item_key)` and `spend_gold(kind, ref_key, idempotency_key, amount_cents)`.

### 2.3 Computing Balances from the Ledgers (No Cached Totals)

1. **Earned gold (`progress_ledger`):** Unchanged. `SUM(xp)` and `SUM(gold_cents)` over active (`deleted_at IS NULL`) rows in `progress_ledger` continue to drive `total_xp`, `level`, `today_xp`, `today_gold_cents`, `progress_history`, `study_days`, and `progress_by_deck` ([ADR-019](019-progress-engine.md)).
2. **Spent gold (`gold_spend_ledger`):**
   $$\text{spent\_gold\_cents} = \text{COALESCE}(\sum \text{amount\_cents WHERE user\_id} = u \text{ AND deleted\_at IS NULL}, 0)$$
3. **Available gold balance:**
   $$\text{available\_gold\_cents} = \max(0,\ \text{earned\_gold\_cents} - \text{spent\_gold\_cents})$$
   Using `saturating_sub` in Rust guarantees the balance can never go negative even if a later review undo (`undo_answer`) or task reopen reduces `earned_gold_cents` slightly below `spent_gold_cents`. `ProgressSummaryDto.gold_cents` reports `available_gold_cents` across all styles because the engine is shared.
4. **Streak freeze token balance (`freeze_token_ledger`):**
   $$\text{freeze\_tokens\_held} = \max(0,\ \text{COALESCE}(\sum \text{delta WHERE user\_id} = u \text{ AND deleted\_at IS NULL}, 0))$$
   - Cap enforced in Rust transactions: `FREEZE_TOKEN_CAP = 3`.
   - Purchases (`freeze_buy:<tx_uuid>`, `delta = +1`) and milestone grants (`freeze_earn:streak:<day_index>`, `delta = +1`) fail or skip cleanly when `freeze_tokens_held >= 3`.
   - Uses (`freeze_use:<habit_id>:<day_index>`, `delta = -1`) require `freeze_tokens_held >= 1`.

### 2.4 Idempotency, Atomic Transactions, and Undo / Refund

#### Deterministic IDs (`entity_id_v5`)

All singleton or key-addressed rows use deterministic RFC 4122 v5 UUIDs derived from `(table_namespace, user_id, natural_key)` (matching `ledger_id` in `crates/bibalak-core/src/progress.rs`):

| Table                 | Natural key for UUIDv5       | Purpose                                                           |
| --------------------- | ---------------------------- | ----------------------------------------------------------------- |
| `avatar_profile`      | `"default"`                  | One profile row per `user_id` merges cleanly across devices.      |
| `inventory_items`     | `item_key`                   | Duplicate unlocks/purchases merge into one row per item.          |
| `avatar_equipped`     | `slot`                       | Equipping `head` on Device A and `back` on Device B never blocks. |
| `gold_spend_ledger`   | `idempotency_key`            | Retrying the same purchase request never charges twice.           |
| `freeze_token_ledger` | `source_key`                 | Using or earning a freeze on a given day is strictly once.        |
| `custom_rewards`      | Random UUIDv4 (`new_uuid()`) | Distinct user-created reward definitions.                         |

#### Transaction Patterns

1. **Shop cosmetic purchase (`buy_shop_item(item_key, idempotency_key)`):**
   - Idempotency key: `shop_buy:<item_key>`.
   - Single SQLite transaction:
     - Look up item in static Rust catalog (`is_purchasable`, `price_cents > 0`, `kind = 'cosmetic'`).
     - If an active row exists in `gold_spend_ledger` for `(user_id, 'shop_buy:<item_key>')` AND an active row exists in `inventory_items` for `(user_id, item_key)`, return the existing purchase without spending again.
     - Verify `available_gold_cents >= price_cents` (`CoreError::Invalid("insufficient gold")`).
     - Upsert `gold_spend_ledger` (`deleted_at = NULL, created_at = now_ms, updated_at = now_ms, usn = -1`).
     - Upsert `inventory_items` (`source = 'shop'`, `deleted_at = NULL, updated_at = now_ms, usn = -1`).
2. **Freeze token purchase (`buy_shop_item("streak_freeze", client_tx_id)`):**
   - Idempotency key: `freeze_buy:<client_tx_id>` (UUID generated per click in UI).
   - Single SQLite transaction:
     - If `gold_spend_ledger` already has active `(user_id, 'freeze_buy:<client_tx_id>')`, return idempotently.
     - Verify `freeze_tokens_held < 3` and `available_gold_cents >= 2500` (`25` gold).
     - Insert `gold_spend_ledger` (`kind = 'freeze_token', ref_key = 'streak_freeze', amount_cents = 2500`).
     - Insert `freeze_token_ledger` (`source_key = 'freeze_buy:<client_tx_id>', delta = 1`).
3. **Custom reward claim (`claim_custom_reward(reward_id, client_tx_id)`):**
   - Idempotency key: `reward_claim:<reward_id>:<client_tx_id>`.
   - Single SQLite transaction:
     - If `gold_spend_ledger` already has active `(user_id, idempotency_key)`, return idempotently.
     - Load active `custom_rewards` row (`deleted_at IS NULL`); verify `available_gold_cents >= reward.cost_cents`.
     - Insert `gold_spend_ledger` (`kind = 'custom_reward', ref_key = reward_id, amount_cents = reward.cost_cents`).
4. **Accidental purchase refund (`refund_shop_purchase(spend_id)`):**
   - **Window:** Allowed within `REFUND_WINDOW_MS = 300_000` (5 minutes of `created_at`), strictly in one transaction:
     - Verify `now_ms - row.created_at <= 300_000` and `row.deleted_at IS NULL`.
     - Soft-delete `gold_spend_ledger` row (`deleted_at = now_ms, updated_at = now_ms, usn = -1`).
     - If `kind = 'cosmetic'`: soft-delete `inventory_items` row for `ref_key` and clear `avatar_equipped.item_key = NULL` where `item_key = ref_key`.
     - If `kind = 'freeze_token'`: require `freeze_tokens_held >= 1` (cannot refund an already-consumed token) and soft-delete the matching `freeze_token_ledger` row (`source_key = row.idempotency_key`).
5. **Using and undoing a habit streak freeze (`Collection::log_habit` with `HabitLogStatus::Frozen`):**
   - Allowed only when `day_index == today || day_index == today - 1`.
   - If the active `habit_logs` row for `(habit_id, day_index)` already has `status == Frozen`, return it as an idempotent no-op (no extra token spent).
   - Otherwise, in one transaction:
     - Verify `freeze_tokens_held >= 1` (`CoreError::Invalid("no streak freeze tokens available")`).
     - Upsert `freeze_token_ledger` (`source_key = "freeze_use:<habit_id>:<day_index>"`, `delta = -1`, `deleted_at = NULL`, `updated_at = now_ms`, `usn = -1`).
     - Upsert `habit_logs` (`status = 'frozen', completed = 0, logged_value = 0.0`) and soft-revoke any active `habit_log:<habit_id>:<day_index>` reward.
   - **Undo & automatic refund:**
     - `UndoAction::LogHabit` captures the prior `HabitLog` snapshot (`ADR-023`). When restoring a prior non-frozen snapshot (or deleting a newly created frozen log), `restore_habit_log_snapshot` soft-deletes `freeze_use:<habit_id>:<day_index>` (`deleted_at = now_ms, usn = -1`). If undoing _back into_ a frozen state from an unfreeze, it re-activates `freeze_use:<habit_id>:<day_index>` if `freeze_tokens_held >= 1` (or clamps safely if 0 tokens remain).
     - When `log_habit` or `sync_deck_linked_habits_for_day` overwrites/promotes a `Frozen` day to `Logged` or `Skipped`, it soft-deletes `freeze_use:<habit_id>:<day_index>` in the same transaction, refunding the token automatically.

### 2.5 Sync Integration (`ADR-014`, `ADR-018 §2.9`)

`SyncDelta` (`crates/bibalak-core/src/sync.rs`) adds `#[serde(default)]` vectors for all 6 new tables:

- `avatar_profile: Vec<AvatarProfile>`
- `inventory_items: Vec<InventoryItem>`
- `avatar_equipped: Vec<AvatarEquippedSlot>`
- `custom_rewards: Vec<CustomReward>`
- `gold_spend_ledger: Vec<GoldSpendEntry>`
- `freeze_token_ledger: Vec<FreezeTokenEntry>`

**Merge & Ack rules:**

- Export rows where `usn = -1`; acknowledge sets `usn = server_usn`.
- Keyed by `id` (with unique secondary index `(user_id, ...)`).
- Last-writer-wins on `updated_at`.
- **Tie-break on `updated_at` equal:**
  - For `gold_spend_ledger` and `freeze_token_ledger`: `deleted_at IS NOT NULL` (revoke/refund) wins over active grant/spend, matching `progress_ledger` ([ADR-019 §2.6](019-progress-engine.md#26-sync-integration-d14-adr-014)).
  - For `avatar_profile`, `inventory_items`, `avatar_equipped`, `custom_rewards`: standard `ADR-018 §2.9` tie-break (`deleted_at.is_some()` wins, then canonical serialized value comparison).
- Excluded from `.apkg` / `.colpkg` export and import.

### 2.6 Postgres Stage 2 Mapping

Every v12 table maps 1:1 to PostgreSQL (in the Stage 2 `game` or `progress` schema defined by `ADR-017`):

| SQLite type                   | PostgreSQL type               | Notes                                               |
| ----------------------------- | ----------------------------- | --------------------------------------------------- |
| `id TEXT PRIMARY KEY`         | `UUID PRIMARY KEY`            | All v12 PKs are lowercase hyphenated UUIDv4/v5.     |
| `user_id TEXT NOT NULL`       | `UUID NOT NULL`               | Replaced with authenticated `auth.uid()` on upload. |
| `INTEGER` timestamps (`*_at`) | `BIGINT NOT NULL / NULL`      | UTC epoch milliseconds.                             |
| `usn INTEGER`                 | `BIGINT NOT NULL DEFAULT -1`  | Sync sequence cursor.                               |
| `CHECK (...)`                 | Identical `CHECK` constraints | Enforced identically in both engines.               |

---

## 3. Alternatives Considered

1. **Allow negative `gold_cents` in `progress_ledger` instead of adding `gold_spend_ledger`:** Rejected. `MIGRATIONS[8]` (`schema.rs:L223`) enforces `CHECK (gold_cents >= 0)`, which cannot be relaxed in SQLite without rebuilding `progress_ledger`. Mixing negative spending rows into `progress_ledger` would also distort `today_gold_cents`, `progress_history`, and `yesterday_summary`.
2. **Store mutable `gold_cents` and `freeze_tokens` columns on `avatar_profile`:** Rejected. Violates ADR-019 §4.1 ("no cached totals") and causes silent lost-update races when two offline devices spend or earn concurrently before syncing.
3. **Store equipped gear as a single `equipped_json` column on `avatar_profile`:** Rejected. Equipping a hat on Device A and a cape on Device B offline would overwrite one change during LWW sync. One row per `(user_id, slot)` in `avatar_equipped` isolates per-slot sync merges.
4. **Store `quantity` on `inventory_items` for streak freeze tokens:** Rejected. A mutable `quantity` column suffers LWW lost updates between buying a token on Device A and using a token on Device B. `freeze_token_ledger` (`+1` / `-1` keyed by unique `source_key`) merges cleanly with zero lost updates.

---

## 4. Consequences

### Positive

- **Zero cached totals:** Available gold and freeze tokens are computed cleanly from immutable/soft-revocable ledger rows, eliminating drift.
- **Sync-safe by construction:** Per-slot equipment, deterministic UUIDv5 keys, and additive token/spend ledgers merge cleanly across devices under `ADR-014`.
- **15a-ready:** `inventory_items`, `avatar_equipped`, and `gold_spend_ledger` already reserve kinds and slots for pets, mounts, cosmetic paths, and achievements (`ADR-026`).
- **ADR-019 compliant:** No negative XP, no penalties, no negative gold balances (`saturating_sub`), and full undo refund for habit streak freezes.

### Negative / Trade-offs

- Six new tables in `v11 -> v12` require updating `SyncDelta`, `Storage` port, `FakeStorage`, `SqliteStorage`, and `H2` (`DB1`) sync write-path tests during `BW2`.
- `ProgressSummaryDto.gold_cents` transitions from "lifetime earned gold" to "available gold" (`earned - spent`); lifetime earned totals remain queryable via `progress_history` and `progress_by_deck`.
