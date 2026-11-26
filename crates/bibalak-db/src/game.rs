//! SQLite adapter for Game style inventory, avatar, equipment, shop spending,
//! custom rewards, and streak freeze tokens (ADR-025, R2a).

use std::collections::{HashMap, HashSet};

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::game::{
    available_gold_cents, catalog_item, cosmetic_slot_for_item, game_entity_id,
    is_valid_cosmetic_key, study_streak_with_freezes, AvatarEquippedSlot, AvatarProfile,
    AvatarProfileDto, AvatarProfileInput, CustomReward, CustomRewardDto, CustomRewardInput,
    EquipmentSlot, EquippedSlotDto, FreezeTokenEntry, GameSnapshot, GoldSpendEntry, InventoryItem,
    SpendHistoryEntryDto, SpendKind, FREEZE_TOKEN_CAP, MAX_CUSTOM_REWARDS, REFUND_WINDOW_MS,
};
use bibalak_core::motivation::parse_study_freeze_source_key;
use bibalak_core::progress::{
    created_epoch_day, day_index_for_ms, habit_source_key, parse_ledger_source_key,
    ParsedSourceKey, MS_PER_DAY,
};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

// ── Row Mappers & Column Lists (shared with sync.rs) ─────────────────────────

pub(crate) const AVATAR_PROFILE_COLS: &str =
    "id, user_id, body_tone, hair_style, hair_color, starter_outfit, starter_accessory, created_at, updated_at, deleted_at, usn";
pub(crate) const INVENTORY_ITEM_COLS: &str =
    "id, user_id, item_key, kind, source, created_at, updated_at, deleted_at, usn";
pub(crate) const AVATAR_EQUIPPED_COLS: &str =
    "id, user_id, slot, item_key, created_at, updated_at, deleted_at, usn";
pub(crate) const CUSTOM_REWARD_COLS: &str =
    "id, user_id, title, notes, cost_cents, icon_key, sort_order, created_at, updated_at, deleted_at, usn";
pub(crate) const GOLD_SPEND_COLS: &str =
    "id, user_id, idempotency_key, kind, ref_key, amount_cents, created_at, updated_at, deleted_at, usn";
pub(crate) const FREEZE_TOKEN_COLS: &str =
    "id, user_id, source_key, delta, created_at, updated_at, deleted_at, usn";

pub(crate) fn map_avatar_profile(row: &Row<'_>) -> rusqlite::Result<AvatarProfile> {
    Ok(AvatarProfile {
        id: row.get(0)?,
        user_id: row.get(1)?,
        body_tone: row.get(2)?,
        hair_style: row.get(3)?,
        hair_color: row.get(4)?,
        starter_outfit: row.get(5)?,
        starter_accessory: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        deleted_at: row.get(9)?,
        usn: row.get(10)?,
    })
}

pub(crate) fn map_inventory_item(row: &Row<'_>) -> rusqlite::Result<InventoryItem> {
    Ok(InventoryItem {
        id: row.get(0)?,
        user_id: row.get(1)?,
        item_key: row.get(2)?,
        kind: row.get(3)?,
        source: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        deleted_at: row.get(7)?,
        usn: row.get(8)?,
    })
}

pub(crate) fn map_avatar_equipped(row: &Row<'_>) -> rusqlite::Result<AvatarEquippedSlot> {
    Ok(AvatarEquippedSlot {
        id: row.get(0)?,
        user_id: row.get(1)?,
        slot: row.get(2)?,
        item_key: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        deleted_at: row.get(6)?,
        usn: row.get(7)?,
    })
}

pub(crate) fn map_custom_reward(row: &Row<'_>) -> rusqlite::Result<CustomReward> {
    Ok(CustomReward {
        id: row.get(0)?,
        user_id: row.get(1)?,
        title: row.get(2)?,
        notes: row.get(3)?,
        cost_cents: row.get(4)?,
        icon_key: row.get(5)?,
        sort_order: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        deleted_at: row.get(9)?,
        usn: row.get(10)?,
    })
}

pub(crate) fn map_gold_spend(row: &Row<'_>) -> rusqlite::Result<GoldSpendEntry> {
    Ok(GoldSpendEntry {
        id: row.get(0)?,
        user_id: row.get(1)?,
        idempotency_key: row.get(2)?,
        kind: row.get(3)?,
        ref_key: row.get(4)?,
        amount_cents: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deleted_at: row.get(8)?,
        usn: row.get(9)?,
    })
}

pub(crate) fn map_freeze_token(row: &Row<'_>) -> rusqlite::Result<FreezeTokenEntry> {
    Ok(FreezeTokenEntry {
        id: row.get(0)?,
        user_id: row.get(1)?,
        source_key: row.get(2)?,
        delta: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        deleted_at: row.get(6)?,
        usn: row.get(7)?,
    })
}

pub(crate) fn upsert_avatar_profile_with_usn(
    conn: &Connection,
    p: &AvatarProfile,
    usn: i64,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO avatar_profile
         (id, user_id, body_tone, hair_style, hair_color, starter_outfit, starter_accessory,
          created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(user_id) DO UPDATE SET
             id = excluded.id,
             body_tone = excluded.body_tone,
             hair_style = excluded.hair_style,
             hair_color = excluded.hair_color,
             starter_outfit = excluded.starter_outfit,
             starter_accessory = excluded.starter_accessory,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            p.id,
            p.user_id,
            p.body_tone,
            p.hair_style,
            p.hair_color,
            p.starter_outfit,
            p.starter_accessory,
            p.created_at,
            p.updated_at,
            p.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub(crate) fn upsert_inventory_item_with_usn(
    conn: &Connection,
    i: &InventoryItem,
    usn: i64,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO inventory_items
         (id, user_id, item_key, kind, source, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(user_id, item_key) DO UPDATE SET
             id = excluded.id,
             kind = excluded.kind,
             source = excluded.source,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            i.id,
            i.user_id,
            i.item_key,
            i.kind,
            i.source,
            i.created_at,
            i.updated_at,
            i.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub(crate) fn upsert_avatar_equipped_with_usn(
    conn: &Connection,
    e: &AvatarEquippedSlot,
    usn: i64,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO avatar_equipped
         (id, user_id, slot, item_key, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(user_id, slot) DO UPDATE SET
             id = excluded.id,
             item_key = excluded.item_key,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            e.id,
            e.user_id,
            e.slot,
            e.item_key,
            e.created_at,
            e.updated_at,
            e.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub(crate) fn upsert_custom_reward_with_usn(
    conn: &Connection,
    r: &CustomReward,
    usn: i64,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO custom_rewards
         (id, user_id, title, notes, cost_cents, icon_key, sort_order, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET
             user_id = excluded.user_id,
             title = excluded.title,
             notes = excluded.notes,
             cost_cents = excluded.cost_cents,
             icon_key = excluded.icon_key,
             sort_order = excluded.sort_order,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            r.id,
            r.user_id,
            r.title,
            r.notes,
            r.cost_cents,
            r.icon_key,
            r.sort_order,
            r.created_at,
            r.updated_at,
            r.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub(crate) fn upsert_gold_spend_with_usn(
    conn: &Connection,
    s: &GoldSpendEntry,
    usn: i64,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO gold_spend_ledger
         (id, user_id, idempotency_key, kind, ref_key, amount_cents, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(user_id, idempotency_key) DO UPDATE SET
             id = excluded.id,
             kind = excluded.kind,
             ref_key = excluded.ref_key,
             amount_cents = excluded.amount_cents,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            s.id,
            s.user_id,
            s.idempotency_key,
            s.kind,
            s.ref_key,
            s.amount_cents,
            s.created_at,
            s.updated_at,
            s.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub(crate) fn upsert_freeze_token_with_usn(
    conn: &Connection,
    f: &FreezeTokenEntry,
    usn: i64,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO freeze_token_ledger
         (id, user_id, source_key, delta, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(user_id, source_key) DO UPDATE SET
             id = excluded.id,
             delta = excluded.delta,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            f.id,
            f.user_id,
            f.source_key,
            f.delta,
            f.created_at,
            f.updated_at,
            f.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

// ── Balance & Transactional Helpers ──────────────────────────────────────────

pub fn spent_gold_cents(conn: &Connection, user_id: &str) -> CoreResult<u64> {
    let spent: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(amount_cents), 0)
             FROM gold_spend_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL",
            params![user_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok(spent.max(0) as u64)
}

pub(crate) fn earned_totals(conn: &Connection, user_id: &str) -> CoreResult<(u64, u64)> {
    let (xp, gold): (i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(xp), 0), COALESCE(SUM(gold_cents), 0)
             FROM progress_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL",
            params![user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;
    Ok((xp.max(0) as u64, gold.max(0) as u64))
}

pub fn freeze_tokens_held(conn: &Connection, user_id: &str) -> CoreResult<u32> {
    let sum: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(delta), 0)
             FROM freeze_token_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL",
            params![user_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok(u32::try_from(sum.max(0)).unwrap_or(u32::MAX))
}

/// R2a helper for R4-1: grant a cosmetic unlocked via milestone/path inside the caller's transaction.
pub(crate) fn grant_unlocked_cosmetic_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    item_key: &str,
    now_ms: i64,
) -> CoreResult<bool> {
    if !is_valid_cosmetic_key(item_key) {
        return Err(CoreError::Invalid(format!(
            "unknown cosmetic key '{item_key}'"
        )));
    }
    let existing: Option<Option<i64>> = tx
        .query_row(
            "SELECT deleted_at FROM inventory_items WHERE user_id = ?1 AND item_key = ?2",
            params![user_id, item_key],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    match existing {
        None => {
            let id = game_entity_id("inventory_item", user_id, item_key);
            tx.execute(
                "INSERT INTO inventory_items
                 (id, user_id, item_key, kind, source, created_at, updated_at, deleted_at, usn)
                 VALUES (?1, ?2, ?3, 'cosmetic', 'unlock', ?4, ?4, NULL, -1)",
                params![id, user_id, item_key, now_ms],
            )
            .map_err(err)?;
            Ok(true)
        }
        Some(Some(_)) => {
            tx.execute(
                "UPDATE inventory_items
                 SET source = 'unlock', created_at = ?1, updated_at = ?1, deleted_at = NULL, usn = -1
                 WHERE user_id = ?2 AND item_key = ?3",
                params![now_ms, user_id, item_key],
            )
            .map_err(err)?;
            Ok(true)
        }
        Some(None) => Ok(false),
    }
}

/// R2a helper for R4-1: spend gold atomically inside the caller's transaction.
pub(crate) fn spend_gold_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    kind: SpendKind,
    ref_key: &str,
    idempotency_key: &str,
    amount_cents: u64,
    now_ms: i64,
) -> CoreResult<String> {
    if amount_cents == 0 {
        return Err(CoreError::Invalid("spend amount_cents must be > 0".into()));
    }
    let existing: Option<(String, Option<i64>)> = tx
        .query_row(
            "SELECT id, deleted_at FROM gold_spend_ledger WHERE user_id = ?1 AND idempotency_key = ?2",
            params![user_id, idempotency_key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((id, None)) = existing {
        return Ok(id);
    }

    let (_, earned) = earned_totals(tx, user_id)?;
    let spent = spent_gold_cents(tx, user_id)?;
    if available_gold_cents(earned, spent) < amount_cents {
        return Err(CoreError::Invalid("insufficient gold".into()));
    }

    let id = existing
        .map(|(id, _)| id)
        .unwrap_or_else(|| game_entity_id("gold_spend_ledger", user_id, idempotency_key));
    tx.execute(
        "INSERT INTO gold_spend_ledger
         (id, user_id, idempotency_key, kind, ref_key, amount_cents, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, NULL, -1)
         ON CONFLICT(user_id, idempotency_key) DO UPDATE SET
             kind = excluded.kind,
             ref_key = excluded.ref_key,
             amount_cents = excluded.amount_cents,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = NULL,
             usn = -1",
        params![
            id,
            user_id,
            idempotency_key,
            kind.as_str(),
            ref_key,
            amount_cents as i64,
            now_ms,
        ],
    )
    .map_err(err)?;
    Ok(id)
}

pub(crate) fn upsert_freeze_entry_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    source_key: &str,
    delta: i32,
    now_ms: i64,
) -> CoreResult<bool> {
    let existing: Option<(i32, Option<i64>)> = tx
        .query_row(
            "SELECT delta, deleted_at FROM freeze_token_ledger WHERE user_id = ?1 AND source_key = ?2",
            params![user_id, source_key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    let changed = match existing {
        None => true,
        Some((d, del)) => del.is_some() || d != delta,
    };
    let id = game_entity_id("freeze_token_ledger", user_id, source_key);
    tx.execute(
        "INSERT INTO freeze_token_ledger
         (id, user_id, source_key, delta, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, NULL, -1)
         ON CONFLICT(user_id, source_key) DO UPDATE SET
             delta = excluded.delta,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = NULL,
             usn = -1",
        params![id, user_id, source_key, delta, now_ms],
    )
    .map_err(err)?;
    Ok(changed)
}

pub(crate) fn soft_delete_freeze_entry_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    source_key: &str,
    now_ms: i64,
) -> CoreResult<bool> {
    let rows = tx
        .execute(
            "UPDATE freeze_token_ledger
             SET deleted_at = ?1, updated_at = ?1, usn = -1
             WHERE user_id = ?2 AND source_key = ?3 AND deleted_at IS NULL",
            params![now_ms, user_id, source_key],
        )
        .map_err(err)?;
    Ok(rows > 0)
}

pub(crate) fn active_ledger_days(
    conn: &Connection,
    user_id: &str,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
) -> CoreResult<HashSet<i32>> {
    let created_day = created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
    let mut stmt = conn
        .prepare(
            "SELECT source_key, created_at
             FROM progress_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL",
        )
        .map_err(err)?;
    let mut rows = stmt.query(params![user_id]).map_err(err)?;
    let mut days = HashSet::new();
    while let Some(r) = rows.next().map_err(err)? {
        let key: String = r.get(0).map_err(err)?;
        let created_at: i64 = r.get(1).map_err(err)?;
        match parse_ledger_source_key(&key) {
            Some(ParsedSourceKey::CardReview { day_index, .. })
            | Some(ParsedSourceKey::HabitLog { day_index, .. }) => {
                days.insert(day_index);
            }
            Some(ParsedSourceKey::TaskDone { .. }) => {
                let d = day_index_for_ms(created_at, tz_offset_minutes, rollover_hour, created_day)
                    as i32;
                days.insert(d);
            }
            Some(ParsedSourceKey::QuestDaily { .. })
            | Some(ParsedSourceKey::QuestWeekly { .. })
            | Some(ParsedSourceKey::ComebackBonus { .. })
            | Some(ParsedSourceKey::MonthlyBadge { .. })
            | None => {}
        }
    }
    Ok(days)
}

pub(crate) fn frozen_study_days(conn: &Connection, user_id: &str) -> CoreResult<HashSet<i32>> {
    let mut stmt = conn
        .prepare(
            "SELECT source_key
             FROM freeze_token_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL AND delta < 0 AND source_key LIKE 'freeze_use:study:%'",
        )
        .map_err(err)?;
    let mut rows = stmt.query(params![user_id]).map_err(err)?;
    let mut days = HashSet::new();
    while let Some(r) = rows.next().map_err(err)? {
        let key: String = r.get(0).map_err(err)?;
        if let Some(d) = parse_study_freeze_source_key(&key) {
            days.insert(d);
        }
    }
    Ok(days)
}

/// Indexed existence check for any active `progress_ledger` row belonging to `day`,
/// optionally excluding `exclude_ledger_id` (used to detect the first reward of a day).
pub(crate) fn has_active_ledger_row_on_day(
    conn: &Connection,
    user_id: &str,
    day: i32,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
    exclude_ledger_id: Option<&str>,
) -> CoreResult<bool> {
    let tz_off_ms = i64::from(tz_offset_minutes) * 60_000;
    let rollover_ms = i64::from(rollover_hour) * 3_600_000;
    let created_day = created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
    let day_zero_start_ms = created_day * MS_PER_DAY + rollover_ms - tz_off_ms;
    let start_ms = day_zero_start_ms + i64::from(day) * MS_PER_DAY;
    let end_ms = start_ms + MS_PER_DAY;

    let mut stmt = conn
        .prepare_cached(
            "SELECT id, source_key
             FROM progress_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL AND created_at >= ?2 AND created_at < ?3",
        )
        .map_err(err)?;
    let mut rows = stmt
        .query(params![user_id, start_ms, end_ms])
        .map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        let id: String = r.get(0).map_err(err)?;
        if exclude_ledger_id == Some(id.as_str()) {
            continue;
        }
        let key: String = r.get(1).map_err(err)?;
        let row_day = match parse_ledger_source_key(&key) {
            Some(ParsedSourceKey::CardReview { day_index, .. })
            | Some(ParsedSourceKey::HabitLog { day_index, .. }) => Some(day_index),
            Some(ParsedSourceKey::TaskDone { .. }) => Some(day),
            Some(ParsedSourceKey::QuestDaily { .. })
            | Some(ParsedSourceKey::QuestWeekly { .. })
            | Some(ParsedSourceKey::ComebackBonus { .. })
            | Some(ParsedSourceKey::MonthlyBadge { .. })
            | None => None,
        };
        if row_day == Some(day) {
            return Ok(true);
        }
    }
    drop(rows);
    drop(stmt);

    // A habit completed for `day` may have been back-logged on `day + 1`, putting its
    // `created_at` in `day + 1`. Check `habit_logs` via `idx_habit_logs_day` and probe
    // `progress_ledger` by its unique `(user_id, source_key)`.
    let mut h_stmt = conn
        .prepare_cached(
            "SELECT habit_id FROM habit_logs
             WHERE user_id = ?1 AND day_index = ?2 AND deleted_at IS NULL AND completed = 1",
        )
        .map_err(err)?;
    let mut h_rows = h_stmt.query(params![user_id, day]).map_err(err)?;
    let mut l_stmt = conn
        .prepare_cached(
            "SELECT id FROM progress_ledger
             WHERE user_id = ?1 AND source_key = ?2 AND deleted_at IS NULL",
        )
        .map_err(err)?;
    while let Some(hr) = h_rows.next().map_err(err)? {
        let habit_id: String = hr.get(0).map_err(err)?;
        let key = habit_source_key(&habit_id, day);
        if let Some(id) = l_stmt
            .query_row(params![user_id, key], |r| r.get::<_, String>(0))
            .optional()
            .map_err(err)?
        {
            if exclude_ledger_id != Some(id.as_str()) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

// ── Public Storage Operations (R2a) ──────────────────────────────────────────

pub fn load_game_snapshot(
    conn: &Connection,
    user_id: &str,
    today: i32,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
) -> CoreResult<GameSnapshot> {
    let (total_xp, earned_gold_cents) = earned_totals(conn, user_id)?;
    let spent = spent_gold_cents(conn, user_id)?;
    let days = active_ledger_days(conn, user_id, tz_offset_minutes, rollover_hour, created_ms)?;
    let frozen = frozen_study_days(conn, user_id)?;
    let (study_streak, studied_today) = study_streak_with_freezes(&days, &frozen, today);
    let freeze_held = freeze_tokens_held(conn, user_id)?;

    let avatar = conn
        .query_row(
            "SELECT body_tone, hair_style, hair_color, starter_outfit, starter_accessory
             FROM avatar_profile
             WHERE user_id = ?1 AND deleted_at IS NULL",
            params![user_id],
            |r| {
                Ok(AvatarProfileDto {
                    body_tone: r.get(0)?,
                    hair_style: r.get(1)?,
                    hair_color: r.get(2)?,
                    starter_outfit: r.get(3)?,
                    starter_accessory: r.get(4)?,
                })
            },
        )
        .optional()
        .map_err(err)?
        .unwrap_or_default();

    let mut eq_stmt = conn
        .prepare(
            "SELECT slot, item_key FROM avatar_equipped
             WHERE user_id = ?1 AND deleted_at IS NULL",
        )
        .map_err(err)?;
    let eq_rows = eq_stmt
        .query_map(params![user_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .map_err(err)?;
    let mut equipped = Vec::new();
    for row in eq_rows {
        let (slot_str, item_key) = row.map_err(err)?;
        if let Ok(slot) = EquipmentSlot::parse(&slot_str) {
            equipped.push(EquippedSlotDto { slot, item_key });
        }
    }

    let mut inv_stmt = conn
        .prepare(
            "SELECT item_key FROM inventory_items
             WHERE user_id = ?1 AND deleted_at IS NULL
             ORDER BY item_key ASC",
        )
        .map_err(err)?;
    let owned_item_keys = inv_stmt
        .query_map(params![user_id], |r| r.get(0))
        .map_err(err)?
        .collect::<Result<Vec<String>, _>>()
        .map_err(err)?;

    Ok(GameSnapshot {
        total_xp,
        earned_gold_cents,
        spent_gold_cents: spent,
        study_streak,
        studied_today,
        freeze_tokens_held: freeze_held,
        avatar,
        equipped,
        owned_item_keys,
    })
}

pub fn update_avatar_profile(
    conn: &Connection,
    user_id: &str,
    input: &AvatarProfileInput,
    now_ms: i64,
) -> CoreResult<AvatarProfileDto> {
    let id = game_entity_id("avatar_profile", user_id, "default");
    conn.execute(
        "INSERT INTO avatar_profile
         (id, user_id, body_tone, hair_style, hair_color, starter_outfit, starter_accessory,
          created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, NULL, -1)
         ON CONFLICT(user_id) DO UPDATE SET
             body_tone = excluded.body_tone,
             hair_style = excluded.hair_style,
             hair_color = excluded.hair_color,
             starter_outfit = excluded.starter_outfit,
             starter_accessory = excluded.starter_accessory,
             updated_at = excluded.updated_at,
             deleted_at = NULL,
             usn = -1",
        params![
            id,
            user_id,
            input.body_tone,
            input.hair_style,
            input.hair_color,
            input.starter_outfit,
            input.starter_accessory,
            now_ms,
        ],
    )
    .map_err(err)?;
    Ok(AvatarProfileDto {
        body_tone: input.body_tone.clone(),
        hair_style: input.hair_style.clone(),
        hair_color: input.hair_color.clone(),
        starter_outfit: input.starter_outfit.clone(),
        starter_accessory: input.starter_accessory.clone(),
    })
}

pub fn equip_game_item(
    conn: &Connection,
    user_id: &str,
    slot: EquipmentSlot,
    item_key: &str,
    now_ms: i64,
) -> CoreResult<()> {
    if cosmetic_slot_for_item(item_key) != Some(slot) {
        return Err(CoreError::Invalid(
            "item does not belong to this equipment slot".into(),
        ));
    }
    let owned: Option<String> = conn
        .query_row(
            "SELECT id FROM inventory_items
             WHERE user_id = ?1 AND item_key = ?2 AND deleted_at IS NULL",
            params![user_id, item_key],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if owned.is_none() {
        return Err(CoreError::Invalid("item is not owned".into()));
    }
    let slot_str = slot.as_str();
    let id = game_entity_id("avatar_equipped", user_id, slot_str);
    conn.execute(
        "INSERT INTO avatar_equipped
         (id, user_id, slot, item_key, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, NULL, -1)
         ON CONFLICT(user_id, slot) DO UPDATE SET
             item_key = excluded.item_key,
             updated_at = excluded.updated_at,
             deleted_at = NULL,
             usn = -1",
        params![id, user_id, slot_str, item_key, now_ms],
    )
    .map_err(err)?;
    Ok(())
}

pub fn unequip_game_slot(
    conn: &Connection,
    user_id: &str,
    slot: EquipmentSlot,
    now_ms: i64,
) -> CoreResult<()> {
    let slot_str = slot.as_str();
    let id = game_entity_id("avatar_equipped", user_id, slot_str);
    conn.execute(
        "INSERT INTO avatar_equipped
         (id, user_id, slot, item_key, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, NULL, ?4, ?4, NULL, -1)
         ON CONFLICT(user_id, slot) DO UPDATE SET
             item_key = NULL,
             updated_at = excluded.updated_at,
             deleted_at = NULL,
             usn = -1",
        params![id, user_id, slot_str, now_ms],
    )
    .map_err(err)?;
    Ok(())
}

pub fn buy_shop_item(
    conn: &mut Connection,
    user_id: &str,
    item_key: &str,
    client_tx_id: &str,
    now_ms: i64,
) -> CoreResult<String> {
    let item = catalog_item(item_key)
        .ok_or_else(|| CoreError::Invalid(format!("unknown shop item '{item_key}'")))?;
    let tx = conn.transaction().map_err(err)?;
    let spend_id = match item.kind {
        SpendKind::Cosmetic => {
            let idemp = format!("shop_buy:{item_key}");
            let active_spend: Option<String> = tx
                .query_row(
                    "SELECT id FROM gold_spend_ledger
                     WHERE user_id = ?1 AND idempotency_key = ?2 AND deleted_at IS NULL",
                    params![user_id, idemp],
                    |r| r.get(0),
                )
                .optional()
                .map_err(err)?;
            let active_inv: bool = tx
                .query_row(
                    "SELECT EXISTS(
                         SELECT 1 FROM inventory_items
                         WHERE user_id = ?1 AND item_key = ?2 AND deleted_at IS NULL
                     )",
                    params![user_id, item_key],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if let (Some(id), true) = (active_spend, active_inv) {
                tx.commit().map_err(err)?;
                return Ok(id);
            }
            if active_inv {
                return Err(CoreError::Invalid("cosmetic item is already owned".into()));
            }
            let sid = spend_gold_tx(
                &tx,
                user_id,
                SpendKind::Cosmetic,
                item_key,
                &idemp,
                item.price_cents,
                now_ms,
            )?;
            let inv_id = game_entity_id("inventory_item", user_id, item_key);
            tx.execute(
                "INSERT INTO inventory_items
                 (id, user_id, item_key, kind, source, created_at, updated_at, deleted_at, usn)
                 VALUES (?1, ?2, ?3, 'cosmetic', 'shop', ?4, ?4, NULL, -1)
                 ON CONFLICT(user_id, item_key) DO UPDATE SET
                     source = 'shop',
                     created_at = excluded.created_at,
                     updated_at = excluded.updated_at,
                     deleted_at = NULL,
                     usn = -1",
                params![inv_id, user_id, item_key, now_ms],
            )
            .map_err(err)?;
            sid
        }
        SpendKind::FreezeToken => {
            let idemp = format!("freeze_buy:{client_tx_id}");
            let active_spend: Option<String> = tx
                .query_row(
                    "SELECT id FROM gold_spend_ledger
                     WHERE user_id = ?1 AND idempotency_key = ?2 AND deleted_at IS NULL",
                    params![user_id, idemp],
                    |r| r.get(0),
                )
                .optional()
                .map_err(err)?;
            if let Some(id) = active_spend {
                tx.commit().map_err(err)?;
                return Ok(id);
            }
            if freeze_tokens_held(&tx, user_id)? >= FREEZE_TOKEN_CAP {
                return Err(CoreError::Invalid("streak freeze token cap reached".into()));
            }
            let sid = spend_gold_tx(
                &tx,
                user_id,
                SpendKind::FreezeToken,
                item_key,
                &idemp,
                item.price_cents,
                now_ms,
            )?;
            upsert_freeze_entry_tx(&tx, user_id, &idemp, 1, now_ms)?;
            sid
        }
        _ => return Err(CoreError::Invalid("item cannot be bought in shop".into())),
    };
    tx.commit().map_err(err)?;
    Ok(spend_id)
}

pub fn refund_shop_purchase(
    conn: &mut Connection,
    user_id: &str,
    spend_id: &str,
    now_ms: i64,
) -> CoreResult<()> {
    let tx = conn.transaction().map_err(err)?;
    let row: Option<(String, String, String, i64)> = tx
        .query_row(
            "SELECT idempotency_key, kind, ref_key, created_at
             FROM gold_spend_ledger
             WHERE user_id = ?1 AND id = ?2 AND deleted_at IS NULL",
            params![user_id, spend_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(err)?;
    let Some((idempotency_key, kind_str, ref_key, created_at)) = row else {
        return Err(CoreError::NotFound(format!(
            "purchase '{spend_id}' not found"
        )));
    };
    if now_ms < created_at || now_ms - created_at > REFUND_WINDOW_MS {
        return Err(CoreError::Invalid("refund window has expired".into()));
    }
    let kind = SpendKind::parse(&kind_str)?;
    if kind == SpendKind::PathChange {
        return Err(CoreError::Invalid("path changes cannot be refunded".into()));
    }
    if kind == SpendKind::FreezeToken && freeze_tokens_held(&tx, user_id)? < 1 {
        return Err(CoreError::Invalid(
            "cannot refund an already used freeze token".into(),
        ));
    }
    tx.execute(
        "UPDATE gold_spend_ledger
         SET deleted_at = ?1, updated_at = ?1, usn = -1
         WHERE user_id = ?2 AND id = ?3 AND deleted_at IS NULL",
        params![now_ms, user_id, spend_id],
    )
    .map_err(err)?;

    match kind {
        SpendKind::Cosmetic => {
            tx.execute(
                "UPDATE inventory_items
                 SET deleted_at = ?1, updated_at = ?1, usn = -1
                 WHERE user_id = ?2 AND item_key = ?3 AND deleted_at IS NULL",
                params![now_ms, user_id, ref_key],
            )
            .map_err(err)?;
            tx.execute(
                "UPDATE avatar_equipped
                 SET item_key = NULL, updated_at = ?1, usn = -1
                 WHERE user_id = ?2 AND item_key = ?3 AND deleted_at IS NULL",
                params![now_ms, user_id, ref_key],
            )
            .map_err(err)?;
        }
        SpendKind::FreezeToken => {
            soft_delete_freeze_entry_tx(&tx, user_id, &idempotency_key, now_ms)?;
        }
        SpendKind::CustomReward | SpendKind::PathChange => {}
    }
    tx.commit().map_err(err)?;
    Ok(())
}

pub fn list_custom_rewards(conn: &Connection, user_id: &str) -> CoreResult<Vec<CustomRewardDto>> {
    let mut counts: HashMap<String, u32> = HashMap::new();
    let mut c_stmt = conn
        .prepare(
            "SELECT ref_key, COUNT(*) FROM gold_spend_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL AND kind = 'custom_reward'
             GROUP BY ref_key",
        )
        .map_err(err)?;
    let c_rows = c_stmt
        .query_map(params![user_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })
        .map_err(err)?;
    for row in c_rows {
        let (k, cnt) = row.map_err(err)?;
        counts.insert(k, cnt.max(0) as u32);
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, title, notes, cost_cents, icon_key, sort_order
             FROM custom_rewards
             WHERE user_id = ?1 AND deleted_at IS NULL
             ORDER BY sort_order ASC, created_at ASC",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![user_id], |r| {
            let id: String = r.get(0)?;
            let claim_count = counts.get(&id).copied().unwrap_or(0);
            Ok(CustomRewardDto {
                id,
                title: r.get(1)?,
                notes: r.get(2)?,
                cost_cents: r.get::<_, i64>(3)?.max(0) as u64,
                icon_key: r.get(4)?,
                sort_order: r.get(5)?,
                claim_count,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

pub fn create_custom_reward(
    conn: &mut Connection,
    user_id: &str,
    input: &CustomRewardInput,
    now_ms: i64,
) -> CoreResult<CustomRewardDto> {
    let tx = conn.transaction().map_err(err)?;
    let active_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM custom_rewards WHERE user_id = ?1 AND deleted_at IS NULL",
            params![user_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if active_count as usize >= MAX_CUSTOM_REWARDS {
        return Err(CoreError::Invalid(format!(
            "maximum of {MAX_CUSTOM_REWARDS} active custom rewards reached"
        )));
    }
    let id = crate::productivity::new_uuid();
    let sort_order = input.sort_order.unwrap_or(active_count as i32);
    tx.execute(
        "INSERT INTO custom_rewards
         (id, user_id, title, notes, cost_cents, icon_key, sort_order, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, NULL, -1)",
        params![
            id,
            user_id,
            input.title,
            input.notes,
            input.cost_cents as i64,
            input.icon_key,
            sort_order,
            now_ms,
        ],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(CustomRewardDto {
        id,
        title: input.title.clone(),
        notes: input.notes.clone(),
        cost_cents: input.cost_cents,
        icon_key: input.icon_key.clone(),
        sort_order,
        claim_count: 0,
    })
}

pub fn update_custom_reward(
    conn: &Connection,
    user_id: &str,
    id: &str,
    input: &CustomRewardInput,
    now_ms: i64,
) -> CoreResult<CustomRewardDto> {
    let existing_sort: Option<i32> = conn
        .query_row(
            "SELECT sort_order FROM custom_rewards
             WHERE user_id = ?1 AND id = ?2 AND deleted_at IS NULL",
            params![user_id, id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let Some(prev_sort) = existing_sort else {
        return Err(CoreError::NotFound(format!(
            "custom reward '{id}' not found"
        )));
    };
    let sort_order = input.sort_order.unwrap_or(prev_sort);
    conn.execute(
        "UPDATE custom_rewards
         SET title = ?1, notes = ?2, cost_cents = ?3, icon_key = ?4, sort_order = ?5,
             updated_at = ?6, usn = -1
         WHERE user_id = ?7 AND id = ?8 AND deleted_at IS NULL",
        params![
            input.title,
            input.notes,
            input.cost_cents as i64,
            input.icon_key,
            sort_order,
            now_ms,
            user_id,
            id,
        ],
    )
    .map_err(err)?;
    let claim_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM gold_spend_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL AND kind = 'custom_reward' AND ref_key = ?2",
            params![user_id, id],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok(CustomRewardDto {
        id: id.to_string(),
        title: input.title.clone(),
        notes: input.notes.clone(),
        cost_cents: input.cost_cents,
        icon_key: input.icon_key.clone(),
        sort_order,
        claim_count: claim_count.max(0) as u32,
    })
}

pub fn delete_custom_reward(
    conn: &Connection,
    user_id: &str,
    id: &str,
    now_ms: i64,
) -> CoreResult<()> {
    let rows = conn
        .execute(
            "UPDATE custom_rewards
             SET deleted_at = ?1, updated_at = ?1, usn = -1
             WHERE user_id = ?2 AND id = ?3 AND deleted_at IS NULL",
            params![now_ms, user_id, id],
        )
        .map_err(err)?;
    if rows == 0 {
        return Err(CoreError::NotFound(format!(
            "custom reward '{id}' not found"
        )));
    }
    Ok(())
}

pub fn claim_custom_reward(
    conn: &mut Connection,
    user_id: &str,
    reward_id: &str,
    client_tx_id: &str,
    now_ms: i64,
) -> CoreResult<String> {
    let tx = conn.transaction().map_err(err)?;
    let idemp = format!("reward_claim:{reward_id}:{client_tx_id}");
    let existing: Option<String> = tx
        .query_row(
            "SELECT id FROM gold_spend_ledger
             WHERE user_id = ?1 AND idempotency_key = ?2 AND deleted_at IS NULL",
            params![user_id, idemp],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if let Some(id) = existing {
        tx.commit().map_err(err)?;
        return Ok(id);
    }
    let cost_cents: Option<i64> = tx
        .query_row(
            "SELECT cost_cents FROM custom_rewards
             WHERE user_id = ?1 AND id = ?2 AND deleted_at IS NULL",
            params![user_id, reward_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let Some(cost) = cost_cents else {
        return Err(CoreError::NotFound(format!(
            "custom reward '{reward_id}' not found"
        )));
    };
    let spend_id = spend_gold_tx(
        &tx,
        user_id,
        SpendKind::CustomReward,
        reward_id,
        &idemp,
        cost.max(0) as u64,
        now_ms,
    )?;
    tx.commit().map_err(err)?;
    Ok(spend_id)
}

pub fn list_spend_history(
    conn: &Connection,
    user_id: &str,
    limit: u32,
    now_ms: i64,
) -> CoreResult<Vec<SpendHistoryEntryDto>> {
    let held = freeze_tokens_held(conn, user_id)?;
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.kind, s.ref_key, COALESCE(cr.title, s.ref_key), s.amount_cents, s.created_at
             FROM gold_spend_ledger s
             LEFT JOIN custom_rewards cr
               ON s.kind = 'custom_reward' AND cr.id = s.ref_key AND cr.user_id = s.user_id
             WHERE s.user_id = ?1 AND s.deleted_at IS NULL
             ORDER BY s.created_at DESC, s.id DESC
             LIMIT ?2",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![user_id, i64::from(limit)], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
            ))
        })
        .map_err(err)?;
    let mut out = Vec::new();
    for row in rows {
        let (spend_id, kind_str, ref_key, label, amount_cents, created_at) = row.map_err(err)?;
        let kind = SpendKind::parse(&kind_str)?;
        let within_window = now_ms >= created_at && now_ms - created_at <= REFUND_WINDOW_MS;
        let refundable = within_window
            && match kind {
                SpendKind::Cosmetic | SpendKind::CustomReward => true,
                SpendKind::FreezeToken => held >= 1,
                SpendKind::PathChange => false,
            };
        out.push(SpendHistoryEntryDto {
            spend_id,
            kind,
            ref_key,
            label,
            amount_cents: amount_cents.max(0) as u64,
            created_at,
            refundable,
        });
    }
    Ok(out)
}
