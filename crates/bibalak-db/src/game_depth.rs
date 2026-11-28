//! SQLite adapter for Game depth: deterministic unlocks, pets & mounts,
//! Level-10 cosmetic paths, solo achievements, and one-time backfill (ADR-026, R4-1).

use std::collections::{HashMap, HashSet};

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::game::{FREEZE_TOKEN_CAP, STREAK_FREEZE_MILESTONE_DAYS};
use bibalak_core::game_depth::{
    build_achievement_statuses, game_achievement_id, game_pet_credit_id, game_pet_id,
    game_profile_id, game_unlock_id, growth_points_from_sum, next_unearned_threshold,
    BackfillOutcomeDto, DepthMetric, DepthMetricSnapshot, GameAchievement, GameDepthStateDto,
    GameEvalContext, GamePathId, GamePet, GamePetCredit, GameProfile, GameUnlock, PetProgressDto,
    UnlockEventDto, UnlockGrant, ACHIEVEMENT_CATALOG, CURRENT_BACKFILL_VERSION, MAX_PET_GROWTH,
    PATH_SWITCH_COST_CENTS, PATH_UNLOCK_LEVEL, THRESHOLD_UNLOCK_RULES,
};
use bibalak_core::productivity::{compute_habit_streak, Habit, HabitLog, WeekStart};
use bibalak_core::progress::{
    build_top_deck_lookup, created_epoch_day, day_index_for_ms, level_from_xp,
    parse_ledger_source_key, ParsedSourceKey, MS_PER_DAY,
};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

use crate::game::{
    earned_totals, freeze_tokens_held, frozen_study_days, grant_unlocked_cosmetic_tx,
    has_active_ledger_row_on_day, spend_gold_tx, upsert_freeze_entry_tx,
};
use crate::productivity::{map_habit, map_habit_log, HABIT_COLS, HABIT_LOG_COLS};

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

// ── Row Mappers & Column Lists (shared with sync.rs) ─────────────────────────

pub(crate) const GAME_PROFILE_COLS: &str =
    "id, user_id, chosen_path, path_chosen_at, backfill_version, created_at, updated_at, deleted_at, usn";
pub(crate) const GAME_UNLOCK_COLS: &str =
    "id, user_id, unlock_key, reward_kind, reward_ref, unlocked_at, seen_at, created_at, updated_at, deleted_at, usn";
pub(crate) const GAME_PET_COLS: &str =
    "id, user_id, species_key, variant_key, mount_unlocked_at, is_active, is_mounted, created_at, updated_at, deleted_at, usn";
pub(crate) const GAME_PET_CREDIT_COLS: &str =
    "id, user_id, pet_id, ledger_id, points, created_at, updated_at, deleted_at, usn";
pub(crate) const GAME_ACHIEVEMENT_COLS: &str =
    "id, user_id, achievement_key, tier, earned_at, seen_at, created_at, updated_at, deleted_at, usn";

pub(crate) fn map_game_profile(row: &Row<'_>) -> rusqlite::Result<GameProfile> {
    Ok(GameProfile {
        id: row.get(0)?,
        user_id: row.get(1)?,
        chosen_path: row.get(2)?,
        path_chosen_at: row.get(3)?,
        backfill_version: row.get::<_, i64>(4)?.max(0) as u32,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        deleted_at: row.get(7)?,
        usn: row.get(8)?,
    })
}

pub(crate) fn map_game_unlock(row: &Row<'_>) -> rusqlite::Result<GameUnlock> {
    Ok(GameUnlock {
        id: row.get(0)?,
        user_id: row.get(1)?,
        unlock_key: row.get(2)?,
        reward_kind: row.get(3)?,
        reward_ref: row.get(4)?,
        unlocked_at: row.get(5)?,
        seen_at: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        deleted_at: row.get(9)?,
        usn: row.get(10)?,
    })
}

pub(crate) fn map_game_pet(row: &Row<'_>) -> rusqlite::Result<GamePet> {
    Ok(GamePet {
        id: row.get(0)?,
        user_id: row.get(1)?,
        species_key: row.get(2)?,
        variant_key: row.get(3)?,
        mount_unlocked_at: row.get(4)?,
        is_active: row.get::<_, i64>(5)? != 0,
        is_mounted: row.get::<_, i64>(6)? != 0,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        deleted_at: row.get(9)?,
        usn: row.get(10)?,
    })
}

pub(crate) fn map_game_pet_credit(row: &Row<'_>) -> rusqlite::Result<GamePetCredit> {
    Ok(GamePetCredit {
        id: row.get(0)?,
        user_id: row.get(1)?,
        pet_id: row.get(2)?,
        ledger_id: row.get(3)?,
        points: row.get::<_, i64>(4)?.max(1) as u32,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        deleted_at: row.get(7)?,
        usn: row.get(8)?,
    })
}

pub(crate) fn map_game_achievement(row: &Row<'_>) -> rusqlite::Result<GameAchievement> {
    Ok(GameAchievement {
        id: row.get(0)?,
        user_id: row.get(1)?,
        achievement_key: row.get(2)?,
        tier: row.get::<_, i64>(3)?.clamp(1, 3) as u8,
        earned_at: row.get(4)?,
        seen_at: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deleted_at: row.get(8)?,
        usn: row.get(9)?,
    })
}

pub(crate) fn upsert_game_profile_with_usn(
    conn: &Connection,
    p: &GameProfile,
    usn: i64,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO game_profile
         (id, user_id, chosen_path, path_chosen_at, backfill_version, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(user_id) DO UPDATE SET
             id = excluded.id,
             chosen_path = excluded.chosen_path,
             path_chosen_at = excluded.path_chosen_at,
             backfill_version = excluded.backfill_version,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            p.id,
            p.user_id,
            p.chosen_path,
            p.path_chosen_at,
            i64::from(p.backfill_version),
            p.created_at,
            p.updated_at,
            p.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub(crate) fn upsert_game_unlock_with_usn(
    conn: &Connection,
    u: &GameUnlock,
    usn: i64,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO game_unlocks
         (id, user_id, unlock_key, reward_kind, reward_ref, unlocked_at, seen_at, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(user_id, unlock_key) DO UPDATE SET
             id = excluded.id,
             reward_kind = excluded.reward_kind,
             reward_ref = excluded.reward_ref,
             unlocked_at = excluded.unlocked_at,
             seen_at = excluded.seen_at,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            u.id,
            u.user_id,
            u.unlock_key,
            u.reward_kind,
            u.reward_ref,
            u.unlocked_at,
            u.seen_at,
            u.created_at,
            u.updated_at,
            u.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub(crate) fn upsert_game_pet_with_usn(conn: &Connection, p: &GamePet, usn: i64) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO game_pets
         (id, user_id, species_key, variant_key, mount_unlocked_at, is_active, is_mounted, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(user_id, species_key, variant_key) DO UPDATE SET
             id = excluded.id,
             mount_unlocked_at = excluded.mount_unlocked_at,
             is_active = excluded.is_active,
             is_mounted = excluded.is_mounted,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            p.id,
            p.user_id,
            p.species_key,
            p.variant_key,
            p.mount_unlocked_at,
            i64::from(p.is_active),
            i64::from(p.is_mounted),
            p.created_at,
            p.updated_at,
            p.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub(crate) fn upsert_game_pet_credit_with_usn(
    conn: &Connection,
    c: &GamePetCredit,
    usn: i64,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO game_pet_credits
         (id, user_id, pet_id, ledger_id, points, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(pet_id, ledger_id) DO UPDATE SET
             id = excluded.id,
             user_id = excluded.user_id,
             points = excluded.points,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            c.id,
            c.user_id,
            c.pet_id,
            c.ledger_id,
            i64::from(c.points),
            c.created_at,
            c.updated_at,
            c.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub(crate) fn upsert_game_achievement_with_usn(
    conn: &Connection,
    a: &GameAchievement,
    usn: i64,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO game_achievements
         (id, user_id, achievement_key, tier, earned_at, seen_at, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(user_id, achievement_key) DO UPDATE SET
             id = excluded.id,
             tier = excluded.tier,
             earned_at = excluded.earned_at,
             seen_at = excluded.seen_at,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            a.id,
            a.user_id,
            a.achievement_key,
            i64::from(a.tier),
            a.earned_at,
            a.seen_at,
            a.created_at,
            a.updated_at,
            a.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

// ── Internal Transaction Helpers ─────────────────────────────────────────────

fn ensure_game_profile_tx(tx: &Transaction<'_>, user_id: &str, now_ms: i64) -> CoreResult<()> {
    let id = game_profile_id(user_id);
    tx.execute(
        "INSERT OR IGNORE INTO game_profile
         (id, user_id, chosen_path, path_chosen_at, backfill_version, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, NULL, NULL, 0, ?3, ?3, NULL, -1)",
        params![id, user_id, now_ms],
    )
    .map_err(err)?;
    Ok(())
}

fn insert_unlock_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    unlock_key: &str,
    reward_kind: &str,
    reward_ref: &str,
    now_ms: i64,
) -> CoreResult<bool> {
    let id = game_unlock_id(user_id, unlock_key);
    let rows = tx
        .execute(
            "INSERT OR IGNORE INTO game_unlocks
             (id, user_id, unlock_key, reward_kind, reward_ref, unlocked_at, seen_at, created_at, updated_at, deleted_at, usn)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?6, ?6, NULL, -1)",
            params![id, user_id, unlock_key, reward_kind, reward_ref, now_ms],
        )
        .map_err(err)?;
    Ok(rows > 0)
}

fn insert_pet_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    species_key: &str,
    variant_key: &str,
    now_ms: i64,
) -> CoreResult<bool> {
    let has_active: bool = tx
        .query_row(
            "SELECT EXISTS(
                 SELECT 1 FROM game_pets
                 WHERE user_id = ?1 AND is_active = 1 AND deleted_at IS NULL
             )",
            params![user_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    let id = game_pet_id(user_id, species_key, variant_key);
    let is_active = i64::from(!has_active);
    let rows = tx
        .execute(
            "INSERT OR IGNORE INTO game_pets
             (id, user_id, species_key, variant_key, mount_unlocked_at, is_active, is_mounted, created_at, updated_at, deleted_at, usn)
             VALUES (?1, ?2, ?3, ?4, NULL, ?5, 0, ?6, ?6, NULL, -1)",
            params![id, user_id, species_key, variant_key, is_active, now_ms],
        )
        .map_err(err)?;
    Ok(rows > 0)
}

fn insert_achievement_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    achievement_key: &str,
    tier: u8,
    now_ms: i64,
) -> CoreResult<bool> {
    let id = game_achievement_id(user_id, achievement_key);
    let rows = tx
        .execute(
            "INSERT OR IGNORE INTO game_achievements
             (id, user_id, achievement_key, tier, earned_at, seen_at, created_at, updated_at, deleted_at, usn)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?5, ?5, NULL, -1)",
            params![id, user_id, achievement_key, i64::from(tier), now_ms],
        )
        .map_err(err)?;
    Ok(rows > 0)
}

fn existing_unlock_and_ach_keys(
    conn: &Connection,
    user_id: &str,
) -> CoreResult<(HashSet<String>, HashSet<String>)> {
    let mut u_stmt = conn
        .prepare("SELECT unlock_key FROM game_unlocks WHERE user_id = ?1 AND deleted_at IS NULL")
        .map_err(err)?;
    let unlocks = u_stmt
        .query_map(params![user_id], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<Result<HashSet<String>, _>>()
        .map_err(err)?;

    let mut a_stmt = conn
        .prepare(
            "SELECT achievement_key FROM game_achievements WHERE user_id = ?1 AND deleted_at IS NULL",
        )
        .map_err(err)?;
    let achs = a_stmt
        .query_map(params![user_id], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<Result<HashSet<String>, _>>()
        .map_err(err)?;

    Ok((unlocks, achs))
}

/// Bounded indexed check for `reviews >= threshold` (`LIMIT 1 OFFSET threshold - 1`).
fn has_at_least_reviews(conn: &Connection, threshold: u32) -> CoreResult<bool> {
    if threshold == 0 {
        return Ok(true);
    }
    let offset = i64::from(threshold - 1);
    conn.query_row(
        "SELECT EXISTS(
             SELECT 1 FROM revlog
             WHERE review_kind IN (0, 1, 2, 3)
             LIMIT 1 OFFSET ?1
         )",
        params![offset],
        |r| r.get(0),
    )
    .map_err(err)
}

/// Bounded indexed check for `mature_cards >= threshold`.
fn has_at_least_mature_cards(conn: &Connection, threshold: u32) -> CoreResult<bool> {
    if threshold == 0 {
        return Ok(true);
    }
    let offset = i64::from(threshold - 1);
    conn.query_row(
        "SELECT EXISTS(
             SELECT 1 FROM cards
             WHERE type = 2 AND queue != -1 AND interval >= 21
             LIMIT 1 OFFSET ?1
         )",
        params![offset],
        |r| r.get(0),
    )
    .map_err(err)
}

const STUDIED_TOP_DECKS_SYNC_KEY: &str = "game:studied_top_decks";
const REVIEWS_COUNT_SYNC_KEY: &str = "game:reviews_count";

pub(crate) fn invalidate_studied_top_decks_tx(tx: &Transaction<'_>) -> CoreResult<()> {
    tx.execute(
        "DELETE FROM sync_state WHERE key IN (?1, ?2)",
        params![STUDIED_TOP_DECKS_SYNC_KEY, REVIEWS_COUNT_SYNC_KEY],
    )
    .map_err(err)?;
    Ok(())
}

fn read_cached_reviews_count(conn: &Connection) -> CoreResult<Option<u32>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM sync_state WHERE key = ?1",
            params![REVIEWS_COUNT_SYNC_KEY],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    Ok(raw.and_then(|s| s.parse::<u32>().ok()))
}

fn write_cached_reviews_count(conn: &Connection, count: u32) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO sync_state (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![REVIEWS_COUNT_SYNC_KEY, count.to_string()],
    )
    .map_err(err)?;
    Ok(())
}

fn increment_cached_reviews_count_tx(tx: &Transaction<'_>) -> CoreResult<()> {
    if let Some(prev) = read_cached_reviews_count(tx)? {
        write_cached_reviews_count(tx, prev.saturating_add(1))?;
    }
    Ok(())
}

fn top_level_deck_id_for_card(conn: &Connection, card_id: i64) -> CoreResult<Option<i64>> {
    let mut cur: Option<i64> = conn
        .query_row(
            "SELECT deck_id FROM cards WHERE id = ?1",
            params![card_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    for _ in 0..64 {
        let Some(did) = cur else {
            return Ok(None);
        };
        let parent: Option<Option<i64>> = conn
            .query_row(
                "SELECT parent_id FROM decks WHERE id = ?1",
                params![did],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        match parent {
            Some(Some(pid)) => cur = Some(pid),
            Some(None) => return Ok(Some(did)),
            None => return Ok(None),
        }
    }
    Ok(cur)
}

fn scan_studied_top_decks(conn: &Connection) -> CoreResult<HashSet<i64>> {
    let mut d_stmt = conn
        .prepare("SELECT id, name, parent_id FROM decks")
        .map_err(err)?;
    let decks = d_stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(err)?
        .collect::<Result<Vec<(i64, String, Option<i64>)>, _>>()
        .map_err(err)?;
    let top_lookup = build_top_deck_lookup(decks);
    let mut cd_stmt = conn
        .prepare(
            "SELECT DISTINCT c.deck_id FROM cards c
             JOIN revlog r ON r.card_id = c.id
             WHERE r.review_kind IN (0, 1, 2, 3)",
        )
        .map_err(err)?;
    let mut studied_top = HashSet::new();
    for row in cd_stmt.query_map([], |r| r.get::<_, i64>(0)).map_err(err)? {
        let did = row.map_err(err)?;
        if let Some(&(top, _)) = top_lookup.get(&did) {
            studied_top.insert(top);
        }
    }
    Ok(studied_top)
}

fn save_studied_top_decks_tx(tx: &Transaction<'_>, studied: &HashSet<i64>) -> CoreResult<()> {
    let mut ids: Vec<i64> = studied.iter().copied().collect();
    ids.sort_unstable();
    let json = serde_json::to_string(&ids).map_err(err)?;
    tx.execute(
        "INSERT INTO sync_state (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![STUDIED_TOP_DECKS_SYNC_KEY, json],
    )
    .map_err(err)?;
    Ok(())
}

/// Evaluate `DepthMetric::DecksStudied` on a card answer by checking only the
/// answered card's top-level deck against the cached set in `sync_state`.
fn evaluate_decks_studied_on_answer_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    now_ms: i64,
    card_id: i64,
    revlog_id: i64,
    unlocks: &mut HashSet<String>,
    achs: &mut HashSet<String>,
) -> CoreResult<bool> {
    if next_unearned_threshold(DepthMetric::DecksStudied, unlocks, achs).is_none() {
        return Ok(false);
    }
    let Some(top_id) = top_level_deck_id_for_card(tx, card_id)? else {
        return Ok(false);
    };

    let cached_raw: Option<String> = tx
        .query_row(
            "SELECT value FROM sync_state WHERE key = ?1",
            params![STUDIED_TOP_DECKS_SYNC_KEY],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;

    let mut studied: HashSet<i64> = match cached_raw {
        Some(raw) => serde_json::from_str::<Vec<i64>>(&raw)
            .unwrap_or_default()
            .into_iter()
            .collect(),
        None => {
            let has_prior_revlog: bool = tx
                .query_row(
                    "SELECT EXISTS(
                         SELECT 1 FROM revlog
                         WHERE review_kind IN (0, 1, 2, 3) AND id != ?1
                         LIMIT 1
                     )",
                    params![revlog_id],
                    |r| r.get(0),
                )
                .map_err(err)?;
            let mut initial = if has_prior_revlog {
                scan_studied_top_decks(tx)?
            } else {
                HashSet::new()
            };
            initial.insert(top_id);
            save_studied_top_decks_tx(tx, &initial)?;
            let count = initial.len() as u32;
            let (p, c, a) = apply_metric_thresholds_tx(
                tx,
                user_id,
                DepthMetric::DecksStudied,
                now_ms,
                unlocks,
                achs,
                |th| Ok(count >= th),
            )?;
            return Ok(p > 0 || c > 0 || a > 0);
        }
    };

    if !studied.insert(top_id) {
        return Ok(false);
    }
    save_studied_top_decks_tx(tx, &studied)?;
    let count = studied.len() as u32;
    let (p, c, a) = apply_metric_thresholds_tx(
        tx,
        user_id,
        DepthMetric::DecksStudied,
        now_ms,
        unlocks,
        achs,
        |th| Ok(count >= th),
    )?;
    Ok(p > 0 || c > 0 || a > 0)
}

fn collect_study_days(
    conn: &Connection,
    user_id: &str,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
    early_threshold: Option<u32>,
) -> CoreResult<HashSet<i32>> {
    if early_threshold == Some(0) {
        return Ok(HashSet::new());
    }
    let tz_off_ms = i64::from(tz_offset_minutes) * 60_000;
    let rollover_ms = i64::from(rollover_hour) * 3_600_000;
    let created_day = created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
    let day_zero_start_ms = created_day * MS_PER_DAY + rollover_ms - tz_off_ms;

    let mut days = HashSet::new();
    let mut cursor_ms = i64::MIN;
    let mut next_rev_stmt = conn
        .prepare(
            "SELECT id FROM revlog
             WHERE id >= ?1 AND review_kind IN (0, 1, 2, 3)
             ORDER BY id ASC
             LIMIT 1",
        )
        .map_err(err)?;
    while let Some(rev_id) = next_rev_stmt
        .query_row(params![cursor_ms], |r| r.get::<_, i64>(0))
        .optional()
        .map_err(err)?
    {
        let day = day_index_for_ms(rev_id, tz_offset_minutes, rollover_hour, created_day) as i32;
        days.insert(day);
        if early_threshold.is_some_and(|th| days.len() as u32 >= th) {
            return Ok(days);
        }
        cursor_ms = day_zero_start_ms + i64::from(day + 1) * MS_PER_DAY;
    }

    let mut t_stmt = conn
        .prepare(
            "SELECT DISTINCT completed_day FROM tasks
             WHERE user_id = ?1 AND deleted_at IS NULL AND completed_day IS NOT NULL",
        )
        .map_err(err)?;
    for row in t_stmt
        .query_map(params![user_id], |r| r.get::<_, i32>(0))
        .map_err(err)?
    {
        days.insert(row.map_err(err)?);
        if early_threshold.is_some_and(|th| days.len() as u32 >= th) {
            return Ok(days);
        }
    }

    let mut h_stmt = conn
        .prepare(
            "SELECT DISTINCT day_index FROM habit_logs
             WHERE user_id = ?1 AND deleted_at IS NULL AND completed = 1",
        )
        .map_err(err)?;
    for row in h_stmt
        .query_map(params![user_id], |r| r.get::<_, i32>(0))
        .map_err(err)?
    {
        days.insert(row.map_err(err)?);
        if early_threshold.is_some_and(|th| days.len() as u32 >= th) {
            return Ok(days);
        }
    }

    let mut ledger_cursor_ms = i64::MIN;
    let mut next_ledger_stmt = conn
        .prepare(
            "SELECT created_at, source_key FROM progress_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL AND created_at >= ?2
             ORDER BY created_at ASC
             LIMIT 1",
        )
        .map_err(err)?;
    while let Some((created_at, source_key)) = next_ledger_stmt
        .query_row(params![user_id, ledger_cursor_ms], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })
        .optional()
        .map_err(err)?
    {
        let created_day_idx =
            day_index_for_ms(created_at, tz_offset_minutes, rollover_hour, created_day) as i32;
        let parsed_day = match parse_ledger_source_key(&source_key) {
            Some(ParsedSourceKey::CardReview { day_index, .. })
            | Some(ParsedSourceKey::HabitLog { day_index, .. }) => Some(day_index),
            Some(ParsedSourceKey::TaskDone { .. }) => Some(created_day_idx),
            Some(ParsedSourceKey::QuestDaily { .. })
            | Some(ParsedSourceKey::QuestWeekly { .. })
            | Some(ParsedSourceKey::ComebackBonus { .. })
            | Some(ParsedSourceKey::MonthlyBadge { .. })
            | None => None,
        };
        if let Some(d) = parsed_day {
            days.insert(d);
            if early_threshold.is_some_and(|th| days.len() as u32 >= th) {
                return Ok(days);
            }
        }
        ledger_cursor_ms = if parsed_day == Some(created_day_idx) {
            day_zero_start_ms + i64::from(created_day_idx + 1) * MS_PER_DAY
        } else {
            created_at.saturating_add(1)
        };
    }

    Ok(days)
}

/// O(K log N) B-tree skip scan over `revlog.id` + `progress_ledger(user_id, deleted_at, created_at)`
/// (+ small `tasks`/`habit_logs`) to test whether at least `threshold` distinct active study days exist.
fn has_at_least_study_days(
    conn: &Connection,
    user_id: &str,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
    threshold: u32,
) -> CoreResult<bool> {
    if threshold == 0 {
        return Ok(true);
    }
    let days = collect_study_days(
        conn,
        user_id,
        tz_offset_minutes,
        rollover_hour,
        created_ms,
        Some(threshold),
    )?;
    Ok(days.len() as u32 >= threshold)
}

fn max_active_habit_streak(
    conn: &Connection,
    user_id: &str,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
    today: i32,
) -> CoreResult<u32> {
    let mut h_stmt = conn
        .prepare(&format!(
            "SELECT {HABIT_COLS} FROM habits
             WHERE user_id = ?1 AND deleted_at IS NULL AND archived_at IS NULL"
        ))
        .map_err(err)?;
    let habits: Vec<Habit> = h_stmt
        .query_map(params![user_id], map_habit)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    if habits.is_empty() {
        return Ok(0);
    }

    let mut l_stmt = conn
        .prepare(&format!(
            "SELECT {HABIT_LOG_COLS} FROM habit_logs
             WHERE user_id = ?1 AND deleted_at IS NULL"
        ))
        .map_err(err)?;
    let logs: Vec<HabitLog> = l_stmt
        .query_map(params![user_id], map_habit_log)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    let created_day = created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
    let max_streak = habits
        .iter()
        .map(|h| compute_habit_streak(h, &logs, today, created_day, WeekStart::Mon))
        .max()
        .unwrap_or(0);
    Ok(max_streak)
}

fn apply_metric_thresholds_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    metric: DepthMetric,
    now_ms: i64,
    unlocks: &mut HashSet<String>,
    achs: &mut HashSet<String>,
    mut check_fn: impl FnMut(u32) -> CoreResult<bool>,
) -> CoreResult<(u32, u32, u32)> {
    let mut pets_granted = 0_u32;
    let mut cosmetics_granted = 0_u32;
    let mut achievements_granted = 0_u32;

    while let Some(threshold) = next_unearned_threshold(metric, unlocks, achs) {
        if !check_fn(threshold)? {
            break;
        }
        for rule in &THRESHOLD_UNLOCK_RULES {
            if rule.metric == metric
                && rule.threshold <= threshold
                && !unlocks.contains(rule.unlock_key)
            {
                let _ = insert_unlock_tx(
                    tx,
                    user_id,
                    rule.unlock_key,
                    rule.reward_kind(),
                    &rule.reward_ref(),
                    now_ms,
                )?;
                unlocks.insert(rule.unlock_key.to_string());
                match rule.grant {
                    UnlockGrant::Pet {
                        species_key,
                        variant_key,
                        ..
                    } => {
                        if insert_pet_tx(tx, user_id, species_key, variant_key, now_ms)? {
                            pets_granted += 1;
                        }
                    }
                    UnlockGrant::Cosmetic { item_key } => {
                        if grant_unlocked_cosmetic_tx(tx, user_id, item_key, now_ms)? {
                            cosmetics_granted += 1;
                        }
                    }
                }
            }
        }
        for ach in &ACHIEVEMENT_CATALOG {
            if ach.metric == metric
                && ach.threshold <= threshold
                && !achs.contains(ach.achievement_key)
            {
                if insert_achievement_tx(tx, user_id, ach.achievement_key, ach.tier, now_ms)? {
                    achievements_granted += 1;
                }
                achs.insert(ach.achievement_key.to_string());
            }
        }
    }

    Ok((pets_granted, cosmetics_granted, achievements_granted))
}

fn evaluate_pet_collection_achievements_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    now_ms: i64,
    achs: &mut HashSet<String>,
) -> CoreResult<u32> {
    let mut granted = 0_u32;
    if !achs.contains("ach:first_pet") || !achs.contains("ach:collect_5_pets") {
        let pet_count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM game_pets WHERE user_id = ?1 AND deleted_at IS NULL",
                params![user_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if pet_count >= 1
            && !achs.contains("ach:first_pet")
            && insert_achievement_tx(tx, user_id, "ach:first_pet", 1, now_ms)?
        {
            achs.insert("ach:first_pet".to_string());
            granted += 1;
        }
        if pet_count >= 5
            && !achs.contains("ach:collect_5_pets")
            && insert_achievement_tx(tx, user_id, "ach:collect_5_pets", 3, now_ms)?
        {
            achs.insert("ach:collect_5_pets".to_string());
            granted += 1;
        }
    }
    if !achs.contains("ach:first_mount") {
        let has_mount: bool = tx
            .query_row(
                "SELECT EXISTS(
                     SELECT 1 FROM game_pets
                     WHERE user_id = ?1 AND deleted_at IS NULL AND mount_unlocked_at IS NOT NULL
                 )",
                params![user_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if has_mount && insert_achievement_tx(tx, user_id, "ach:first_mount", 2, now_ms)? {
            achs.insert("ach:first_mount".to_string());
            granted += 1;
        }
    }
    Ok(granted)
}

/// Credit `+points` to the currently active pet for `ledger_id`, unlocking mount at `50`.
pub(crate) fn grant_pet_credit_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    ledger_id: &str,
    points: u32,
    now_ms: i64,
) -> CoreResult<bool> {
    let active: Option<(String, Option<i64>)> = tx
        .query_row(
            "SELECT id, mount_unlocked_at FROM game_pets
             WHERE user_id = ?1 AND is_active = 1 AND deleted_at IS NULL",
            params![user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    let Some((pet_id, mount_unlocked_at)) = active else {
        return Ok(false);
    };
    if mount_unlocked_at.is_some() {
        return Ok(false);
    }

    let credit_id = game_pet_credit_id(user_id, &pet_id, ledger_id);
    tx.execute(
        "INSERT INTO game_pet_credits
         (id, user_id, pet_id, ledger_id, points, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, NULL, -1)
         ON CONFLICT(pet_id, ledger_id) DO UPDATE SET
             points = excluded.points,
             updated_at = excluded.updated_at,
             deleted_at = NULL,
             usn = -1
         WHERE game_pet_credits.deleted_at IS NOT NULL",
        params![
            credit_id,
            user_id,
            pet_id,
            ledger_id,
            i64::from(points),
            now_ms
        ],
    )
    .map_err(err)?;

    let sum: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(points), 0) FROM game_pet_credits
             WHERE user_id = ?1 AND pet_id = ?2 AND deleted_at IS NULL",
            params![user_id, pet_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if sum as u32 >= MAX_PET_GROWTH {
        tx.execute(
            "UPDATE game_pets
             SET mount_unlocked_at = COALESCE(mount_unlocked_at, ?1), updated_at = ?1, usn = -1
             WHERE id = ?2 AND deleted_at IS NULL",
            params![now_ms, pet_id],
        )
        .map_err(err)?;
        return Ok(true);
    }
    Ok(false)
}

/// Soft-delete any active `game_pet_credits` rows matching `(user_id, ledger_id)` on undo/reopen.
pub(crate) fn revoke_pet_credit_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    ledger_id: &str,
    now_ms: i64,
) -> CoreResult<()> {
    tx.execute(
        "UPDATE game_pet_credits
         SET deleted_at = ?1, updated_at = ?1, usn = -1
         WHERE user_id = ?2 AND ledger_id = ?3 AND deleted_at IS NULL",
        params![now_ms, user_id, ledger_id],
    )
    .map_err(err)?;
    Ok(())
}

fn evaluate_streak_freeze_milestone_tx(
    tx: &Transaction<'_>,
    ctx: &GameEvalContext,
    new_ledger_id: &str,
) -> CoreResult<bool> {
    if freeze_tokens_held(tx, &ctx.user_id)? >= FREEZE_TOKEN_CAP {
        return Ok(false);
    }
    if has_active_ledger_row_on_day(
        tx,
        &ctx.user_id,
        ctx.awarded_day,
        ctx.tz_offset_minutes,
        ctx.rollover_hour,
        ctx.created_ms,
        Some(new_ledger_id),
    )? {
        return Ok(false);
    }
    let frozen = frozen_study_days(tx, &ctx.user_id)?;
    let mut streak = 1_u32;
    let mut day = ctx.awarded_day.saturating_sub(1);
    loop {
        if has_active_ledger_row_on_day(
            tx,
            &ctx.user_id,
            day,
            ctx.tz_offset_minutes,
            ctx.rollover_hour,
            ctx.created_ms,
            None,
        )? {
            streak += 1;
        } else if !frozen.contains(&day) {
            break;
        }
        if day == i32::MIN {
            break;
        }
        day -= 1;
    }
    if !streak.is_multiple_of(STREAK_FREEZE_MILESTONE_DAYS) {
        return Ok(false);
    }
    let key = format!("freeze_earn:streak:{}", ctx.awarded_day);
    let already_recorded: bool = tx
        .query_row(
            "SELECT EXISTS(
                 SELECT 1 FROM freeze_token_ledger
                 WHERE user_id = ?1 AND source_key = ?2 AND deleted_at IS NULL
             )",
            params![ctx.user_id, key],
            |r| r.get(0),
        )
        .map_err(err)?;
    if already_recorded {
        return Ok(false);
    }
    upsert_freeze_entry_tx(tx, &ctx.user_id, &key, 1, ctx.now_ms)
}

const EARNED_XP_CACHE_PREFIX: &str = "game:earned_xp:";

fn earned_xp_cache_key(user_id: &str) -> String {
    format!("{EARNED_XP_CACHE_PREFIX}{user_id}")
}

/// Invalidate the per-device cached `total_xp` for `user_id` after non-incremental ledger changes.
pub(crate) fn invalidate_earned_xp_cache_tx(tx: &Transaction<'_>, user_id: &str) -> CoreResult<()> {
    tx.execute(
        "DELETE FROM sync_state WHERE key = ?1",
        params![earned_xp_cache_key(user_id)],
    )
    .map_err(err)?;
    Ok(())
}

/// Invalidate all per-device `total_xp` caches (e.g. after `SyncDelta` applies remote ledger rows).
pub(crate) fn invalidate_all_earned_xp_caches_tx(tx: &Transaction<'_>) -> CoreResult<()> {
    tx.execute(
        "DELETE FROM sync_state WHERE key LIKE 'game:earned_xp:%'",
        [],
    )
    .map_err(err)?;
    Ok(())
}

fn evaluate_level_if_needed_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    now_ms: i64,
    granted_xp: i64,
    unlocks: &mut HashSet<String>,
    achs: &mut HashSet<String>,
) -> CoreResult<bool> {
    if next_unearned_threshold(DepthMetric::Level, unlocks, achs).is_none() {
        return Ok(false);
    }
    let key = earned_xp_cache_key(user_id);
    let cached: Option<u64> = tx
        .query_row(
            "SELECT value FROM sync_state WHERE key = ?1",
            params![key],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(err)?
        .and_then(|raw| raw.parse::<u64>().ok());

    let total_xp = match cached {
        Some(prev_xp) => prev_xp.saturating_add(u64::try_from(granted_xp.max(0)).unwrap_or(0)),
        None => earned_totals(tx, user_id)?.0,
    };
    tx.execute(
        "INSERT INTO sync_state (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, total_xp.to_string()],
    )
    .map_err(err)?;

    let level = level_from_xp(total_xp).level;
    let (p, c, a) = apply_metric_thresholds_tx(
        tx,
        user_id,
        DepthMetric::Level,
        now_ms,
        unlocks,
        achs,
        |th| Ok(level >= th),
    )?;
    Ok(p > 0 || c > 0 || a > 0)
}

/// Evaluate study-answer unlocks, freeze milestone, and pet credit inside `apply_answer`'s transaction.
pub(crate) fn on_answer_committed_tx(
    tx: &Transaction<'_>,
    ctx: &GameEvalContext,
    ledger_id: Option<&str>,
    granted_xp: i64,
    review_kind: i64,
    card_id: i64,
    revlog_id: i64,
) -> CoreResult<bool> {
    if !(0..=3).contains(&review_kind) {
        return Ok(false);
    }
    increment_cached_reviews_count_tx(tx)?;
    let mut changed = false;
    let (mut unlocks, mut achs) = existing_unlock_and_ach_keys(tx, &ctx.user_id)?;

    if let Some(lid) = ledger_id {
        if evaluate_streak_freeze_milestone_tx(tx, ctx, lid)? {
            changed = true;
        }
    }

    let (p, c, a) = apply_metric_thresholds_tx(
        tx,
        &ctx.user_id,
        DepthMetric::Reviews,
        ctx.now_ms,
        &mut unlocks,
        &mut achs,
        |th| has_at_least_reviews(tx, th),
    )?;
    if p > 0 || c > 0 || a > 0 {
        changed = true;
    }

    if ledger_id.is_some()
        && evaluate_level_if_needed_tx(
            tx,
            &ctx.user_id,
            ctx.now_ms,
            granted_xp,
            &mut unlocks,
            &mut achs,
        )?
    {
        changed = true;
    }

    if ctx.card_is_mature {
        let (p, c, a) = apply_metric_thresholds_tx(
            tx,
            &ctx.user_id,
            DepthMetric::MatureCards,
            ctx.now_ms,
            &mut unlocks,
            &mut achs,
            |th| has_at_least_mature_cards(tx, th),
        )?;
        if p > 0 || c > 0 || a > 0 {
            changed = true;
        }
    }

    if evaluate_decks_studied_on_answer_tx(
        tx,
        &ctx.user_id,
        ctx.now_ms,
        card_id,
        revlog_id,
        &mut unlocks,
        &mut achs,
    )? {
        changed = true;
    }

    let (p, c, a) = apply_metric_thresholds_tx(
        tx,
        &ctx.user_id,
        DepthMetric::StudyDays,
        ctx.now_ms,
        &mut unlocks,
        &mut achs,
        |th| {
            has_at_least_study_days(
                tx,
                &ctx.user_id,
                ctx.tz_offset_minutes,
                ctx.rollover_hour,
                ctx.created_ms,
                th,
            )
        },
    )?;
    if p > 0 || c > 0 || a > 0 {
        changed = true;
    }

    if let Some(lid) = ledger_id {
        if grant_pet_credit_tx(
            tx,
            &ctx.user_id,
            lid,
            bibalak_core::game_depth::PET_CREDIT_REVIEW_POINTS,
            ctx.now_ms,
        )? {
            changed = true;
        }
    }

    if evaluate_pet_collection_achievements_tx(tx, &ctx.user_id, ctx.now_ms, &mut achs)? > 0 {
        changed = true;
    }

    Ok(changed)
}

/// Evaluate task-completion unlocks, freeze milestone, and pet credit inside `set_task_completion`'s transaction.
pub(crate) fn on_task_committed_tx(
    tx: &Transaction<'_>,
    ctx: &GameEvalContext,
    ledger_id: Option<&str>,
    granted_xp: i64,
) -> CoreResult<bool> {
    let mut changed = false;
    let (mut unlocks, mut achs) = existing_unlock_and_ach_keys(tx, &ctx.user_id)?;

    if let Some(lid) = ledger_id {
        if evaluate_streak_freeze_milestone_tx(tx, ctx, lid)? {
            changed = true;
        }
    }

    let (p, c, a) = apply_metric_thresholds_tx(
        tx,
        &ctx.user_id,
        DepthMetric::CompletedTasks,
        ctx.now_ms,
        &mut unlocks,
        &mut achs,
        |th| {
            let off = i64::from(th - 1);
            tx.query_row(
                "SELECT EXISTS(
                     SELECT 1 FROM tasks
                     WHERE user_id = ?1 AND deleted_at IS NULL AND completed_at IS NOT NULL
                     LIMIT 1 OFFSET ?2
                 )",
                params![ctx.user_id, off],
                |r| r.get(0),
            )
            .map_err(err)
        },
    )?;
    if p > 0 || c > 0 || a > 0 {
        changed = true;
    }

    if ledger_id.is_some()
        && evaluate_level_if_needed_tx(
            tx,
            &ctx.user_id,
            ctx.now_ms,
            granted_xp,
            &mut unlocks,
            &mut achs,
        )?
    {
        changed = true;
    }

    let (p, c, a) = apply_metric_thresholds_tx(
        tx,
        &ctx.user_id,
        DepthMetric::StudyDays,
        ctx.now_ms,
        &mut unlocks,
        &mut achs,
        |th| {
            has_at_least_study_days(
                tx,
                &ctx.user_id,
                ctx.tz_offset_minutes,
                ctx.rollover_hour,
                ctx.created_ms,
                th,
            )
        },
    )?;
    if p > 0 || c > 0 || a > 0 {
        changed = true;
    }

    if let Some(lid) = ledger_id {
        if grant_pet_credit_tx(
            tx,
            &ctx.user_id,
            lid,
            bibalak_core::game_depth::PET_CREDIT_PRODUCTIVITY_POINTS,
            ctx.now_ms,
        )? {
            changed = true;
        }
    }

    if evaluate_pet_collection_achievements_tx(tx, &ctx.user_id, ctx.now_ms, &mut achs)? > 0 {
        changed = true;
    }

    Ok(changed)
}

/// Evaluate habit-completion unlocks, freeze milestone, and pet credit inside `upsert_habit_log`'s transaction.
pub(crate) fn on_habit_committed_tx(
    tx: &Transaction<'_>,
    ctx: &GameEvalContext,
    ledger_id: Option<&str>,
    granted_xp: i64,
    habit_completed: bool,
) -> CoreResult<bool> {
    let mut changed = false;
    let (mut unlocks, mut achs) = existing_unlock_and_ach_keys(tx, &ctx.user_id)?;

    if let Some(lid) = ledger_id {
        if evaluate_streak_freeze_milestone_tx(tx, ctx, lid)? {
            changed = true;
        }
    }

    if habit_completed {
        let (p, c, a) = apply_metric_thresholds_tx(
            tx,
            &ctx.user_id,
            DepthMetric::CompletedHabitLogs,
            ctx.now_ms,
            &mut unlocks,
            &mut achs,
            |th| {
                let off = i64::from(th - 1);
                tx.query_row(
                    "SELECT EXISTS(
                         SELECT 1 FROM habit_logs
                         WHERE user_id = ?1 AND deleted_at IS NULL AND completed = 1
                         LIMIT 1 OFFSET ?2
                     )",
                    params![ctx.user_id, off],
                    |r| r.get(0),
                )
                .map_err(err)
            },
        )?;
        if p > 0 || c > 0 || a > 0 {
            changed = true;
        }

        if next_unearned_threshold(DepthMetric::MaxHabitStreak, &unlocks, &achs).is_some() {
            let max_streak = max_active_habit_streak(
                tx,
                &ctx.user_id,
                ctx.tz_offset_minutes,
                ctx.rollover_hour,
                ctx.created_ms,
                ctx.today,
            )?;
            let (p, c, a) = apply_metric_thresholds_tx(
                tx,
                &ctx.user_id,
                DepthMetric::MaxHabitStreak,
                ctx.now_ms,
                &mut unlocks,
                &mut achs,
                |th| Ok(max_streak >= th),
            )?;
            if p > 0 || c > 0 || a > 0 {
                changed = true;
            }
        }
    }

    if ledger_id.is_some()
        && evaluate_level_if_needed_tx(
            tx,
            &ctx.user_id,
            ctx.now_ms,
            granted_xp,
            &mut unlocks,
            &mut achs,
        )?
    {
        changed = true;
    }

    let (p, c, a) = apply_metric_thresholds_tx(
        tx,
        &ctx.user_id,
        DepthMetric::StudyDays,
        ctx.now_ms,
        &mut unlocks,
        &mut achs,
        |th| {
            has_at_least_study_days(
                tx,
                &ctx.user_id,
                ctx.tz_offset_minutes,
                ctx.rollover_hour,
                ctx.created_ms,
                th,
            )
        },
    )?;
    if p > 0 || c > 0 || a > 0 {
        changed = true;
    }

    if let Some(lid) = ledger_id {
        if grant_pet_credit_tx(
            tx,
            &ctx.user_id,
            lid,
            bibalak_core::game_depth::PET_CREDIT_PRODUCTIVITY_POINTS,
            ctx.now_ms,
        )? {
            changed = true;
        }
    }

    if evaluate_pet_collection_achievements_tx(tx, &ctx.user_id, ctx.now_ms, &mut achs)? > 0 {
        changed = true;
    }

    Ok(changed)
}

fn load_full_depth_metrics(
    conn: &Connection,
    user_id: &str,
    now_ms: i64,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
) -> CoreResult<DepthMetricSnapshot> {
    let created_day = created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
    let today = day_index_for_ms(now_ms, tz_offset_minutes, rollover_hour, created_day) as i32;

    let reviews: u32 = match read_cached_reviews_count(conn)? {
        Some(cached) => cached,
        None => {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM revlog WHERE review_kind IN (0, 1, 2, 3)",
                    [],
                    |r| r.get(0),
                )
                .map_err(err)?;
            let count_u32 = u32::try_from(count.max(0)).unwrap_or(u32::MAX);
            write_cached_reviews_count(conn, count_u32)?;
            count_u32
        }
    };
    let (total_xp, _) = earned_totals(conn, user_id)?;
    let level = level_from_xp(total_xp).level;
    let completed_tasks: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks
             WHERE user_id = ?1 AND deleted_at IS NULL AND completed_at IS NOT NULL",
            params![user_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    let completed_habit_logs: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM habit_logs
             WHERE user_id = ?1 AND deleted_at IS NULL AND completed = 1",
            params![user_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    let max_habit_streak = max_active_habit_streak(
        conn,
        user_id,
        tz_offset_minutes,
        rollover_hour,
        created_ms,
        today,
    )?;

    let study_days_set = collect_study_days(
        conn,
        user_id,
        tz_offset_minutes,
        rollover_hour,
        created_ms,
        None,
    )?;

    let mature_cards: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM cards
             WHERE type = 2 AND queue != -1 AND interval >= 21",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;

    let cached_decks_raw: Option<String> = conn
        .query_row(
            "SELECT value FROM sync_state WHERE key = ?1",
            params![STUDIED_TOP_DECKS_SYNC_KEY],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let studied_top: HashSet<i64> = match cached_decks_raw {
        Some(raw) => serde_json::from_str::<Vec<i64>>(&raw)
            .unwrap_or_default()
            .into_iter()
            .collect(),
        None => {
            let scanned = scan_studied_top_decks(conn)?;
            let mut ids: Vec<i64> = scanned.iter().copied().collect();
            ids.sort_unstable();
            let json = serde_json::to_string(&ids).map_err(err)?;
            conn.execute(
                "INSERT INTO sync_state (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![STUDIED_TOP_DECKS_SYNC_KEY, json],
            )
            .map_err(err)?;
            scanned
        }
    };

    let (unlocked_pets, has_mount): (i64, bool) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(MAX(CASE WHEN mount_unlocked_at IS NOT NULL THEN 1 ELSE 0 END), 0)
             FROM game_pets
             WHERE user_id = ?1 AND deleted_at IS NULL",
            params![user_id],
            |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
        )
        .map_err(err)?;

    let path_chosen: bool = conn
        .query_row(
            "SELECT EXISTS(
                 SELECT 1 FROM game_profile
                 WHERE user_id = ?1 AND deleted_at IS NULL AND chosen_path IS NOT NULL
             )",
            params![user_id],
            |r| r.get(0),
        )
        .map_err(err)?;

    Ok(DepthMetricSnapshot {
        reviews,
        level,
        completed_tasks: completed_tasks.max(0) as u32,
        completed_habit_logs: completed_habit_logs.max(0) as u32,
        max_habit_streak,
        study_days: study_days_set.len() as u32,
        mature_cards: mature_cards.max(0) as u32,
        decks_studied: studied_top.len() as u32,
        unlocked_pets: unlocked_pets.max(0) as u32,
        has_mount,
        path_chosen,
    })
}

fn run_unlock_backfill_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    now_ms: i64,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
) -> CoreResult<BackfillOutcomeDto> {
    ensure_game_profile_tx(tx, user_id, now_ms)?;
    let version: i64 = tx
        .query_row(
            "SELECT backfill_version FROM game_profile WHERE user_id = ?1 AND deleted_at IS NULL",
            params![user_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if version as u32 >= CURRENT_BACKFILL_VERSION {
        return Ok(BackfillOutcomeDto {
            already_applied: true,
            pets_granted: 0,
            cosmetics_granted: 0,
            achievements_granted: 0,
        });
    }

    let mut metrics = load_full_depth_metrics(
        tx,
        user_id,
        now_ms,
        tz_offset_minutes,
        rollover_hour,
        created_ms,
    )?;
    let studied_top = scan_studied_top_decks(tx)?;
    save_studied_top_decks_tx(tx, &studied_top)?;
    let (mut unlocks, mut achs) = existing_unlock_and_ach_keys(tx, user_id)?;
    let mut pets_granted = 0_u32;
    let mut cosmetics_granted = 0_u32;
    let mut achievements_granted = 0_u32;

    for rule in &THRESHOLD_UNLOCK_RULES {
        if metrics.value_for(rule.metric) >= rule.threshold {
            if !unlocks.contains(rule.unlock_key) {
                let _ = insert_unlock_tx(
                    tx,
                    user_id,
                    rule.unlock_key,
                    rule.reward_kind(),
                    &rule.reward_ref(),
                    now_ms,
                )?;
                unlocks.insert(rule.unlock_key.to_string());
            }
            match rule.grant {
                UnlockGrant::Pet {
                    species_key,
                    variant_key,
                    ..
                } => {
                    if insert_pet_tx(tx, user_id, species_key, variant_key, now_ms)? {
                        pets_granted += 1;
                        metrics.unlocked_pets += 1;
                    }
                }
                UnlockGrant::Cosmetic { item_key } => {
                    if grant_unlocked_cosmetic_tx(tx, user_id, item_key, now_ms)? {
                        cosmetics_granted += 1;
                    }
                }
            }
        }
    }

    for ach in &ACHIEVEMENT_CATALOG {
        let achieved = if ach.achievement_key == "ach:level_10" {
            metrics.level >= 10 || metrics.path_chosen
        } else {
            metrics.value_for(ach.metric) >= ach.threshold
        };
        if achieved && !achs.contains(ach.achievement_key) {
            if insert_achievement_tx(tx, user_id, ach.achievement_key, ach.tier, now_ms)? {
                achievements_granted += 1;
            }
            achs.insert(ach.achievement_key.to_string());
        }
    }

    tx.execute(
        "UPDATE game_profile
         SET backfill_version = ?1, updated_at = ?2, usn = -1
         WHERE user_id = ?3 AND deleted_at IS NULL",
        params![i64::from(CURRENT_BACKFILL_VERSION), now_ms, user_id],
    )
    .map_err(err)?;

    Ok(BackfillOutcomeDto {
        already_applied: false,
        pets_granted,
        cosmetics_granted,
        achievements_granted,
    })
}

/// Reset `backfill_version` to 0 and re-run [`run_unlock_backfill_tx`] idempotently
/// (e.g. after importing `.apkg` review history).
pub(crate) fn rerun_unlock_backfill_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    now_ms: i64,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
) -> CoreResult<BackfillOutcomeDto> {
    tx.execute(
        "UPDATE game_profile
         SET backfill_version = 0
         WHERE user_id = ?1 AND deleted_at IS NULL",
        params![user_id],
    )
    .map_err(err)?;
    run_unlock_backfill_tx(
        tx,
        user_id,
        now_ms,
        tz_offset_minutes,
        rollover_hour,
        created_ms,
    )
}

// ── Public Storage Operations (R4-1) ─────────────────────────────────────────

pub fn run_unlock_backfill(
    conn: &mut Connection,
    user_id: &str,
    now_ms: i64,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
) -> CoreResult<BackfillOutcomeDto> {
    let tx = conn.transaction().map_err(err)?;
    let outcome = run_unlock_backfill_tx(
        &tx,
        user_id,
        now_ms,
        tz_offset_minutes,
        rollover_hour,
        created_ms,
    )?;
    tx.commit().map_err(err)?;
    Ok(outcome)
}

pub fn load_game_depth_state(
    conn: &mut Connection,
    user_id: &str,
    now_ms: i64,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
) -> CoreResult<(GameDepthStateDto, bool)> {
    let tx = conn.transaction().map_err(err)?;
    let outcome = run_unlock_backfill_tx(
        &tx,
        user_id,
        now_ms,
        tz_offset_minutes,
        rollover_hour,
        created_ms,
    )?;
    tx.commit().map_err(err)?;
    let backfill_granted_any = !outcome.already_applied
        && (outcome.pets_granted > 0
            || outcome.cosmetics_granted > 0
            || outcome.achievements_granted > 0);

    let (total_xp, _) = earned_totals(conn, user_id)?;
    let level = level_from_xp(total_xp).level;
    let profile_row: Option<(Option<String>, Option<i64>, i64)> = conn
        .query_row(
            "SELECT chosen_path, path_chosen_at, backfill_version
             FROM game_profile WHERE user_id = ?1 AND deleted_at IS NULL",
            params![user_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(err)?;
    let (chosen_path, path_chosen_at, backfill_applied) = match profile_row {
        Some((cp, pca, bv)) => (
            cp.as_deref().and_then(|s| GamePathId::parse(s).ok()),
            pca,
            bv as u32 >= CURRENT_BACKFILL_VERSION,
        ),
        None => (None, None, false),
    };

    let mut pet_stmt = conn
        .prepare(
            "SELECT p.id, p.species_key, p.variant_key, p.mount_unlocked_at, p.is_active, p.is_mounted,
                    COALESCE(SUM(c.points), 0)
             FROM game_pets p
             LEFT JOIN game_pet_credits c
               ON c.pet_id = p.id AND c.user_id = p.user_id AND c.deleted_at IS NULL
             WHERE p.user_id = ?1 AND p.deleted_at IS NULL
             GROUP BY p.id
             ORDER BY p.species_key ASC, p.variant_key ASC",
        )
        .map_err(err)?;
    let pets = pet_stmt
        .query_map(params![user_id], |r| {
            let sum: i64 = r.get(6)?;
            Ok(PetProgressDto {
                id: r.get(0)?,
                species_key: r.get(1)?,
                variant_key: r.get(2)?,
                growth_points: growth_points_from_sum(sum.max(0) as u32),
                mount_unlocked: r.get::<_, Option<i64>>(3)?.is_some(),
                is_active: r.get::<_, i64>(4)? != 0,
                is_mounted: r.get::<_, i64>(5)? != 0,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    let active_pet = pets.iter().find(|p| p.is_active);
    let active_pet_id = active_pet.map(|p| p.id.clone());
    let mounted = active_pet.is_some_and(|p| p.is_mounted);

    let metrics = load_full_depth_metrics(
        conn,
        user_id,
        now_ms,
        tz_offset_minutes,
        rollover_hour,
        created_ms,
    )?;
    let mut ach_stmt = conn
        .prepare(
            "SELECT achievement_key, earned_at FROM game_achievements
             WHERE user_id = ?1 AND deleted_at IS NULL",
        )
        .map_err(err)?;
    let earned_map: HashMap<String, i64> = ach_stmt
        .query_map(params![user_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<Result<HashMap<_, _>, _>>()
        .map_err(err)?;
    let achievements = build_achievement_statuses(&metrics, &earned_map);

    let mut unseen_unlocks = Vec::new();
    let mut u_stmt = conn
        .prepare(
            "SELECT id, reward_kind, unlock_key, reward_ref, unlocked_at
             FROM game_unlocks
             WHERE user_id = ?1 AND deleted_at IS NULL AND seen_at IS NULL",
        )
        .map_err(err)?;
    for row in u_stmt
        .query_map(params![user_id], |r| {
            Ok(UnlockEventDto {
                id: r.get(0)?,
                kind: r.get(1)?,
                key: r.get(2)?,
                reward_ref: r.get(3)?,
                unlocked_at: r.get(4)?,
            })
        })
        .map_err(err)?
    {
        unseen_unlocks.push(row.map_err(err)?);
    }

    let badge_by_key: HashMap<&str, &str> = ACHIEVEMENT_CATALOG
        .iter()
        .map(|a| (a.achievement_key, a.badge_ref))
        .collect();
    let mut ua_stmt = conn
        .prepare(
            "SELECT id, achievement_key, earned_at
             FROM game_achievements
             WHERE user_id = ?1 AND deleted_at IS NULL AND seen_at IS NULL",
        )
        .map_err(err)?;
    for row in ua_stmt
        .query_map(params![user_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })
        .map_err(err)?
    {
        let (id, key, earned_at) = row.map_err(err)?;
        let reward_ref = badge_by_key
            .get(key.as_str())
            .copied()
            .unwrap_or("badge_spark")
            .to_string();
        unseen_unlocks.push(UnlockEventDto {
            id,
            kind: "achievement".to_string(),
            key,
            reward_ref,
            unlocked_at: earned_at,
        });
    }
    unseen_unlocks.sort_by(|a, b| {
        a.unlocked_at
            .cmp(&b.unlocked_at)
            .then_with(|| a.id.cmp(&b.id))
    });

    Ok((
        GameDepthStateDto {
            level,
            chosen_path,
            path_chosen_at,
            path_switch_gold_cents: PATH_SWITCH_COST_CENTS,
            active_pet_id,
            mounted,
            pets,
            achievements,
            unseen_unlocks,
            backfill_applied,
        },
        backfill_granted_any,
    ))
}

pub fn choose_game_path(
    conn: &mut Connection,
    user_id: &str,
    path_id: GamePathId,
    now_ms: i64,
) -> CoreResult<()> {
    let tx = conn.transaction().map_err(err)?;
    let (total_xp, _) = earned_totals(&tx, user_id)?;
    let level = level_from_xp(total_xp).level;
    if level < PATH_UNLOCK_LEVEL {
        return Err(CoreError::Invalid("paths unlock at level 10".into()));
    }
    ensure_game_profile_tx(&tx, user_id, now_ms)?;
    let current: Option<String> = tx
        .query_row(
            "SELECT chosen_path FROM game_profile WHERE user_id = ?1 AND deleted_at IS NULL",
            params![user_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if current.as_deref() == Some(path_id.as_str()) {
        tx.commit().map_err(err)?;
        return Ok(());
    }
    if current.is_some() {
        let idemp = format!("path_switch:{}", crate::productivity::new_uuid());
        let _ = spend_gold_tx(
            &tx,
            user_id,
            bibalak_core::game::SpendKind::PathChange,
            path_id.as_str(),
            &idemp,
            PATH_SWITCH_COST_CENTS,
            now_ms,
        )?;
    }
    tx.execute(
        "UPDATE game_profile
         SET chosen_path = ?1, path_chosen_at = ?2, updated_at = ?2, usn = -1
         WHERE user_id = ?3 AND deleted_at IS NULL",
        params![path_id.as_str(), now_ms, user_id],
    )
    .map_err(err)?;
    let ukey = path_id.unlock_key();
    let frame = path_id.frame_item_key();
    let _ = insert_unlock_tx(&tx, user_id, &ukey, "cosmetic", frame, now_ms)?;
    let _ = grant_unlocked_cosmetic_tx(&tx, user_id, frame, now_ms)?;
    let _ = insert_achievement_tx(&tx, user_id, "ach:level_10", 2, now_ms)?;
    tx.commit().map_err(err)?;
    Ok(())
}

pub fn set_active_pet(
    conn: &mut Connection,
    user_id: &str,
    pet_id: Option<&str>,
    mounted: bool,
    now_ms: i64,
) -> CoreResult<()> {
    let tx = conn.transaction().map_err(err)?;
    match pet_id {
        Some(pid) => {
            let mount_unlocked: Option<Option<i64>> = tx
                .query_row(
                    "SELECT mount_unlocked_at FROM game_pets
                     WHERE user_id = ?1 AND id = ?2 AND deleted_at IS NULL",
                    params![user_id, pid],
                    |r| r.get(0),
                )
                .optional()
                .map_err(err)?;
            let Some(mount_at) = mount_unlocked else {
                return Err(CoreError::NotFound(format!("pet '{pid}' not found")));
            };
            if mounted && mount_at.is_none() {
                return Err(CoreError::Invalid(
                    "pet has not unlocked mount yet (requires 50 bond points)".into(),
                ));
            }
            tx.execute(
                "UPDATE game_pets
                 SET is_active = 0, is_mounted = 0, updated_at = ?1, usn = -1
                 WHERE user_id = ?2 AND id != ?3 AND (is_active = 1 OR is_mounted = 1) AND deleted_at IS NULL",
                params![now_ms, user_id, pid],
            )
            .map_err(err)?;
            tx.execute(
                "UPDATE game_pets
                 SET is_active = 1, is_mounted = ?1, updated_at = ?2, usn = -1
                 WHERE user_id = ?3 AND id = ?4 AND deleted_at IS NULL",
                params![i64::from(mounted), now_ms, user_id, pid],
            )
            .map_err(err)?;
        }
        None => {
            if mounted {
                return Err(CoreError::Invalid(
                    "cannot mount without an active pet".into(),
                ));
            }
            tx.execute(
                "UPDATE game_pets
                 SET is_active = 0, is_mounted = 0, updated_at = ?1, usn = -1
                 WHERE user_id = ?2 AND (is_active = 1 OR is_mounted = 1) AND deleted_at IS NULL",
                params![now_ms, user_id],
            )
            .map_err(err)?;
        }
    }
    tx.commit().map_err(err)?;
    Ok(())
}

pub fn acknowledge_unlocks(
    conn: &mut Connection,
    user_id: &str,
    unlock_ids: &[String],
    now_ms: i64,
) -> CoreResult<()> {
    if unlock_ids.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction().map_err(err)?;
    let mut u_stmt = tx
        .prepare(
            "UPDATE game_unlocks
             SET seen_at = ?1, updated_at = ?1, usn = -1
             WHERE user_id = ?2 AND id = ?3 AND seen_at IS NULL AND deleted_at IS NULL",
        )
        .map_err(err)?;
    let mut a_stmt = tx
        .prepare(
            "UPDATE game_achievements
             SET seen_at = ?1, updated_at = ?1, usn = -1
             WHERE user_id = ?2 AND id = ?3 AND seen_at IS NULL AND deleted_at IS NULL",
        )
        .map_err(err)?;
    for id in unlock_ids {
        u_stmt.execute(params![now_ms, user_id, id]).map_err(err)?;
        a_stmt.execute(params![now_ms, user_id, id]).map_err(err)?;
    }
    drop(u_stmt);
    drop(a_stmt);
    tx.commit().map_err(err)?;
    Ok(())
}
