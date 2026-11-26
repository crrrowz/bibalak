//! SQLite implementation of sync journal export and delta application (ADR-014).

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::model::{Card, Deck, DeckConfig, Field, Note, Notetype, Revlog, Template};
use bibalak_core::sync::{
    should_remote_resurrect, should_remote_win_lww, should_tombstone_win, validate_delta, Grave,
    MergeSummary, SyncDelta, SyncTag,
};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

use crate::game::{
    map_avatar_equipped, map_avatar_profile, map_custom_reward, map_freeze_token, map_gold_spend,
    map_inventory_item, upsert_avatar_equipped_with_usn, upsert_avatar_profile_with_usn,
    upsert_custom_reward_with_usn, upsert_freeze_token_with_usn, upsert_gold_spend_with_usn,
    upsert_inventory_item_with_usn, AVATAR_EQUIPPED_COLS, AVATAR_PROFILE_COLS, CUSTOM_REWARD_COLS,
    FREEZE_TOKEN_COLS, GOLD_SPEND_COLS, INVENTORY_ITEM_COLS,
};
use crate::game_depth::{
    map_game_achievement, map_game_pet, map_game_pet_credit, map_game_profile, map_game_unlock,
    upsert_game_achievement_with_usn, upsert_game_pet_credit_with_usn, upsert_game_pet_with_usn,
    upsert_game_profile_with_usn, upsert_game_unlock_with_usn, GAME_ACHIEVEMENT_COLS,
    GAME_PET_COLS, GAME_PET_CREDIT_COLS, GAME_PROFILE_COLS, GAME_UNLOCK_COLS,
};
use crate::motivation::{
    map_monthly_badge, map_motivation_settings, upsert_monthly_badge_with_usn,
    upsert_motivation_settings_with_usn, MONTHLY_BADGE_COLS, MOTIVATION_SETTINGS_COLS,
};
use crate::productivity::{
    map_calendar_event, map_habit, map_habit_log, map_matrix_quadrant, map_task, map_task_list,
    upsert_calendar_event_with_usn, upsert_habit_log_with_usn, upsert_habit_with_usn,
    upsert_matrix_quadrant_with_usn, upsert_task_list_with_usn, upsert_task_with_usn,
    CALENDAR_EVENT_COLS, HABIT_COLS, HABIT_LOG_COLS, MATRIX_QUADRANT_COLS, TASK_COLS,
    TASK_LIST_COLS,
};

fn min_some_i64(a: Option<i64>, b: Option<i64>) -> Option<i64> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x.min(y)),
        (Some(x), None) | (None, Some(x)) => Some(x),
        (None, None) => None,
    }
}

fn err<E: std::fmt::Display>(e: E) -> CoreError {
    CoreError::Storage(e.to_string())
}

fn query_dirty_rows<T>(
    conn: &Connection,
    table: &str,
    cols: &str,
    mapper: fn(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> CoreResult<Vec<T>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {cols} FROM {table} WHERE usn = -1 ORDER BY id"
        ))
        .map_err(err)?;
    let rows = stmt
        .query_map([], mapper)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

fn should_remote_win_soft_delete<T: Serialize>(
    remote_updated_at: i64,
    local_updated_at: i64,
    remote_deleted_at: Option<i64>,
    local_deleted_at: Option<i64>,
    remote: &T,
    local: &T,
) -> CoreResult<bool> {
    if remote_updated_at != local_updated_at {
        return Ok(remote_updated_at > local_updated_at);
    }
    if remote_deleted_at.is_some() != local_deleted_at.is_some() {
        return Ok(remote_deleted_at.is_some());
    }
    let remote_repr = serde_json::to_string(remote).map_err(err)?;
    let local_repr = serde_json::to_string(local).map_err(err)?;
    Ok(remote_repr > local_repr)
}

/// Collect all local mutations with `usn = -1` into a [`SyncDelta`].
pub fn export_delta(conn: &Connection) -> CoreResult<SyncDelta> {
    let (schema_mod, collection_mod): (i64, i64) = conn
        .query_row(
            "SELECT schema_mod, modified FROM collection WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or((0, 0));

    // 1. DeckConfig
    let mut stmt = conn
        .prepare("SELECT id, name, \"mod\", usn, config FROM deck_config WHERE usn = -1")
        .map_err(err)?;
    let deck_configs = stmt
        .query_map([], |r| {
            Ok(DeckConfig {
                id: r.get(0)?,
                name: r.get(1)?,
                mod_ms: r.get(2)?,
                usn: r.get(3)?,
                config_json: r.get(4)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    // 2. Decks
    let mut stmt = conn
        .prepare(
            "SELECT id, name, parent_id, config_id, \"mod\", usn, collapsed, is_filtered FROM decks WHERE usn = -1",
        )
        .map_err(err)?;
    let decks = stmt
        .query_map([], |r| {
            Ok(Deck {
                id: r.get(0)?,
                name: r.get(1)?,
                parent_id: r.get(2)?,
                config_id: r.get(3)?,
                mod_ms: r.get(4)?,
                usn: r.get(5)?,
                collapsed: r.get::<_, i64>(6)? != 0,
                is_filtered: r.get::<_, i64>(7)? != 0,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    // 3. Notetypes
    let mut stmt = conn
        .prepare("SELECT id, name, kind, \"mod\", usn, config FROM notetypes WHERE usn = -1")
        .map_err(err)?;
    let notetypes = stmt
        .query_map([], |r| {
            Ok(Notetype {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
                mod_ms: r.get(3)?,
                usn: r.get(4)?,
                config_json: r.get(5)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    // Fields & templates for dirty notetypes
    let mut fields = Vec::new();
    let mut templates = Vec::new();
    if !notetypes.is_empty() {
        for nt in &notetypes {
            let mut f_stmt = conn
                .prepare(
                    "SELECT notetype_id, ord, name, config FROM fields WHERE notetype_id = ?1 ORDER BY ord",
                )
                .map_err(err)?;
            let f_rows = f_stmt
                .query_map([nt.id], |r| {
                    Ok(Field {
                        notetype_id: r.get(0)?,
                        ord: r.get(1)?,
                        name: r.get(2)?,
                        config_json: r.get(3)?,
                    })
                })
                .map_err(err)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(err)?;
            fields.extend(f_rows);

            let mut t_stmt = conn
                .prepare(
                    "SELECT notetype_id, ord, name, qfmt, afmt, config FROM templates WHERE notetype_id = ?1 ORDER BY ord",
                )
                .map_err(err)?;
            let t_rows = t_stmt
                .query_map([nt.id], |r| {
                    Ok(Template {
                        notetype_id: r.get(0)?,
                        ord: r.get(1)?,
                        name: r.get(2)?,
                        qfmt: r.get(3)?,
                        afmt: r.get(4)?,
                        config_json: r.get(5)?,
                    })
                })
                .map_err(err)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(err)?;
            templates.extend(t_rows);
        }
    }

    // 4. Notes
    let mut stmt = conn
        .prepare(
            "SELECT id, guid, notetype_id, \"mod\", usn, tags, fields, sort_field, checksum FROM notes WHERE usn = -1",
        )
        .map_err(err)?;
    let notes = stmt
        .query_map([], |r| {
            let tags_str: String = r.get(5)?;
            let tags = tags_str.split_whitespace().map(String::from).collect();
            let fields_str: String = r.get(6)?;
            let fields = fields_str.split('\x1f').map(String::from).collect();
            Ok(Note {
                id: r.get(0)?,
                guid: r.get(1)?,
                notetype_id: r.get(2)?,
                mod_ms: r.get(3)?,
                usn: r.get(4)?,
                tags,
                fields,
                sort_field: r.get(7)?,
                checksum: r.get(8)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    // 5. Cards
    let mut stmt = conn
        .prepare(
            "SELECT id, note_id, deck_id, ord, \"mod\", usn, type, queue, due, interval, ease_factor, reps, lapses, remaining, original_due, original_deck_id, flags, fsrs_stability, fsrs_difficulty, fsrs_last_review, data
             FROM cards WHERE usn = -1",
        )
        .map_err(err)?;
    let cards = stmt
        .query_map([], |r| {
            Ok(Card {
                id: r.get(0)?,
                note_id: r.get(1)?,
                deck_id: r.get(2)?,
                ord: r.get(3)?,
                mod_ms: r.get(4)?,
                usn: r.get(5)?,
                ctype: r.get(6)?,
                queue: r.get(7)?,
                due: r.get(8)?,
                interval: r.get(9)?,
                ease_factor: r.get(10)?,
                reps: r.get(11)?,
                lapses: r.get(12)?,
                remaining: r.get(13)?,
                original_due: r.get(14)?,
                original_deck_id: r.get(15)?,
                flags: r.get(16)?,
                fsrs_stability: r.get(17)?,
                fsrs_difficulty: r.get(18)?,
                fsrs_last_review: r.get(19)?,
                data: r.get(20)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    // 6. Revlog
    let mut stmt = conn
        .prepare(
            "SELECT id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind FROM revlog WHERE usn = -1",
        )
        .map_err(err)?;
    let revlog = stmt
        .query_map([], |r| {
            Ok(Revlog {
                id: r.get(0)?,
                card_id: r.get(1)?,
                usn: r.get(2)?,
                ease: r.get(3)?,
                interval: r.get(4)?,
                last_interval: r.get(5)?,
                ease_factor: r.get(6)?,
                taken_ms: r.get(7)?,
                review_kind: r.get(8)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    // 7. Graves (carrying deleted_ms from grave_times, D29)
    let mut stmt = conn
        .prepare(
            "SELECT g.oid, g.type, g.usn, COALESCE(gt.deleted_ms, col.modified)
             FROM graves g
             LEFT JOIN grave_times gt ON g.oid = gt.oid AND g.type = gt.type
             CROSS JOIN collection col
             WHERE g.usn = -1",
        )
        .map_err(err)?;
    let graves = stmt
        .query_map([], |r| {
            Ok(Grave {
                oid: r.get(0)?,
                kind: r.get(1)?,
                usn: r.get(2)?,
                mod_ms: r.get(3)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    // 8. Tags
    let mut stmt = conn
        .prepare("SELECT name, usn FROM tags WHERE usn = -1")
        .map_err(err)?;
    let tags = stmt
        .query_map([], |r| {
            Ok(SyncTag {
                name: r.get(0)?,
                usn: r.get(1)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    // 9. Progress ledger (ADR-019 §2.5)
    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn
             FROM progress_ledger WHERE usn = -1 ORDER BY id",
        )
        .map_err(err)?;
    let progress_ledger = stmt
        .query_map([], |r| {
            Ok(bibalak_core::progress::ProgressLedgerEntry {
                id: r.get(0)?,
                user_id: r.get(1)?,
                source_key: r.get(2)?,
                xp: r.get(3)?,
                gold_cents: r.get(4)?,
                created_at: r.get(5)?,
                updated_at: r.get(6)?,
                deleted_at: r.get(7)?,
                usn: r.get(8)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    // 10. Productivity tables (ADR-018 §2.9)
    let task_lists = query_dirty_rows(conn, "task_lists", TASK_LIST_COLS, map_task_list)?;
    let tasks = query_dirty_rows(conn, "tasks", TASK_COLS, map_task)?;
    let matrix_quadrants = query_dirty_rows(
        conn,
        "matrix_quadrants",
        MATRIX_QUADRANT_COLS,
        map_matrix_quadrant,
    )?;
    let habits = query_dirty_rows(conn, "habits", HABIT_COLS, map_habit)?;
    let habit_logs = query_dirty_rows(conn, "habit_logs", HABIT_LOG_COLS, map_habit_log)?;
    let calendar_events = query_dirty_rows(
        conn,
        "calendar_events",
        CALENDAR_EVENT_COLS,
        map_calendar_event,
    )?;

    // 11. Game tables (ADR-025 & ADR-026)
    let avatar_profile = query_dirty_rows(
        conn,
        "avatar_profile",
        AVATAR_PROFILE_COLS,
        map_avatar_profile,
    )?;
    let inventory_items = query_dirty_rows(
        conn,
        "inventory_items",
        INVENTORY_ITEM_COLS,
        map_inventory_item,
    )?;
    let avatar_equipped = query_dirty_rows(
        conn,
        "avatar_equipped",
        AVATAR_EQUIPPED_COLS,
        map_avatar_equipped,
    )?;
    let custom_rewards = query_dirty_rows(
        conn,
        "custom_rewards",
        CUSTOM_REWARD_COLS,
        map_custom_reward,
    )?;
    let gold_spend_ledger =
        query_dirty_rows(conn, "gold_spend_ledger", GOLD_SPEND_COLS, map_gold_spend)?;
    let freeze_token_ledger = query_dirty_rows(
        conn,
        "freeze_token_ledger",
        FREEZE_TOKEN_COLS,
        map_freeze_token,
    )?;
    let game_profile = query_dirty_rows(conn, "game_profile", GAME_PROFILE_COLS, map_game_profile)?;
    let game_unlocks = query_dirty_rows(conn, "game_unlocks", GAME_UNLOCK_COLS, map_game_unlock)?;
    let game_pets = query_dirty_rows(conn, "game_pets", GAME_PET_COLS, map_game_pet)?;
    let game_pet_credits = query_dirty_rows(
        conn,
        "game_pet_credits",
        GAME_PET_CREDIT_COLS,
        map_game_pet_credit,
    )?;
    let game_achievements = query_dirty_rows(
        conn,
        "game_achievements",
        GAME_ACHIEVEMENT_COLS,
        map_game_achievement,
    )?;
    let motivation_settings = query_dirty_rows(
        conn,
        "motivation_settings",
        MOTIVATION_SETTINGS_COLS,
        map_motivation_settings,
    )?;
    let monthly_badges = query_dirty_rows(
        conn,
        "monthly_badges",
        MONTHLY_BADGE_COLS,
        map_monthly_badge,
    )?;

    Ok(SyncDelta {
        schema_mod,
        collection_mod,
        deck_configs,
        decks,
        notetypes,
        fields,
        templates,
        notes,
        cards,
        revlog,
        graves,
        tags,
        progress_ledger,
        task_lists,
        tasks,
        matrix_quadrants,
        habits,
        habit_logs,
        calendar_events,
        avatar_profile,
        inventory_items,
        avatar_equipped,
        custom_rewards,
        gold_spend_ledger,
        freeze_token_ledger,
        game_profile,
        game_unlocks,
        game_pets,
        game_pet_credits,
        game_achievements,
        motivation_settings,
        monthly_badges,
    })
}

/// Apply a remote [`SyncDelta`] using ADR-014 deterministic merge rules.
pub fn apply_sync_delta(
    conn: &mut Connection,
    delta: &SyncDelta,
    new_usn: i64,
    now_ms: i64,
) -> CoreResult<MergeSummary> {
    let (local_schema_mod, _local_collection_mod): (i64, i64) = conn
        .query_row(
            "SELECT schema_mod, modified FROM collection WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;

    // ADR-014 validations: schema_mod divergence & clock skew guard
    validate_delta(delta, local_schema_mod, now_ms)?;

    let tx = conn.transaction().map_err(err)?;

    let mut summary = MergeSummary::default();

    // 1. DeckConfig (LWW)
    for dc in &delta.deck_configs {
        let existing: Option<(i64, String)> = tx
            .query_row(
                "SELECT \"mod\", config FROM deck_config WHERE id = ?1",
                [dc.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;

        match existing {
            None => {
                tx.execute(
                    "INSERT INTO deck_config (id, name, \"mod\", usn, config) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![dc.id, dc.name, dc.mod_ms, new_usn, dc.config_json],
                )
                .map_err(err)?;
                summary.deck_configs_updated += 1;
            }
            Some((local_mod, local_config)) => {
                if should_remote_win_lww(dc.mod_ms, local_mod, &dc.config_json, &local_config) {
                    tx.execute(
                        "UPDATE deck_config SET name = ?1, \"mod\" = ?2, usn = ?3, config = ?4 WHERE id = ?5",
                        rusqlite::params![dc.name, dc.mod_ms, new_usn, dc.config_json, dc.id],
                    )
                    .map_err(err)?;
                    summary.deck_configs_updated += 1;
                }
            }
        }
    }

    // 2. Decks (LWW + Graves)
    for d in &delta.decks {
        let grave_deleted_ms: Option<i64> = tx
            .query_row(
                "SELECT COALESCE((SELECT deleted_ms FROM grave_times WHERE oid = ?1 AND type = 2), \
                         (SELECT modified FROM collection WHERE id = 1)) FROM graves WHERE oid = ?1 AND type = 2",
                [d.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;

        if let Some(del_ms) = grave_deleted_ms {
            if should_remote_resurrect(d.mod_ms, del_ms) {
                tx.execute("DELETE FROM graves WHERE oid = ?1 AND type = 2", [d.id])
                    .map_err(err)?;
                tx.execute(
                    "DELETE FROM grave_times WHERE oid = ?1 AND type = 2",
                    [d.id],
                )
                .map_err(err)?;
            } else {
                continue; // local tombstone wins
            }
        }

        let existing: Option<(i64, String)> = tx
            .query_row(
                "SELECT \"mod\", name FROM decks WHERE id = ?1",
                [d.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;

        match existing {
            None => {
                tx.execute(
                    "INSERT INTO decks (id, name, parent_id, config_id, \"mod\", usn, collapsed, is_filtered)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![d.id, d.name, d.parent_id, d.config_id, d.mod_ms, new_usn, d.collapsed as i64, d.is_filtered as i64],
                )
                .map_err(err)?;
                summary.decks_updated += 1;
            }
            Some((local_mod, local_name)) => {
                if should_remote_win_lww(d.mod_ms, local_mod, &d.name, &local_name) {
                    tx.execute(
                        "UPDATE decks SET name = ?1, parent_id = ?2, config_id = ?3, \"mod\" = ?4, usn = ?5, collapsed = ?6, is_filtered = ?7 WHERE id = ?8",
                        rusqlite::params![d.name, d.parent_id, d.config_id, d.mod_ms, new_usn, d.collapsed as i64, d.is_filtered as i64, d.id],
                    )
                    .map_err(err)?;
                    summary.decks_updated += 1;
                }
            }
        }
    }

    // 3. Notetypes, Fields, Templates (Cosmetic LWW)
    for nt in &delta.notetypes {
        let existing: Option<(i64, String)> = tx
            .query_row(
                "SELECT \"mod\", name FROM notetypes WHERE id = ?1",
                [nt.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;

        match existing {
            None => {
                tx.execute(
                    "INSERT INTO notetypes (id, name, kind, \"mod\", usn, config) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![nt.id, nt.name, nt.kind, nt.mod_ms, new_usn, nt.config_json],
                )
                .map_err(err)?;
                summary.notetypes_updated += 1;
            }
            Some((local_mod, local_name)) => {
                if should_remote_win_lww(nt.mod_ms, local_mod, &nt.name, &local_name) {
                    tx.execute(
                        "UPDATE notetypes SET name = ?1, kind = ?2, \"mod\" = ?3, usn = ?4, config = ?5 WHERE id = ?6",
                        rusqlite::params![nt.name, nt.kind, nt.mod_ms, new_usn, nt.config_json, nt.id],
                    )
                    .map_err(err)?;
                    summary.notetypes_updated += 1;
                }
            }
        }
    }
    for f in &delta.fields {
        tx.execute(
            "INSERT INTO fields (notetype_id, ord, name, config) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(notetype_id, ord) DO UPDATE SET name = excluded.name, config = excluded.config",
            rusqlite::params![f.notetype_id, f.ord, f.name, f.config_json],
        )
        .map_err(err)?;
    }
    for t in &delta.templates {
        tx.execute(
            "INSERT INTO templates (notetype_id, ord, name, qfmt, afmt, config) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(notetype_id, ord) DO UPDATE SET name = excluded.name, qfmt = excluded.qfmt, afmt = excluded.afmt, config = excluded.config",
            rusqlite::params![t.notetype_id, t.ord, t.name, t.qfmt, t.afmt, t.config_json],
        )
        .map_err(err)?;
    }

    // 4. Notes (LWW + Graves + Tag registry)
    for n in &delta.notes {
        let grave_deleted_ms: Option<i64> = tx
            .query_row(
                "SELECT COALESCE((SELECT deleted_ms FROM grave_times WHERE oid = ?1 AND type = 1), \
                         (SELECT modified FROM collection WHERE id = 1)) FROM graves WHERE oid = ?1 AND type = 1",
                [n.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;

        if let Some(del_ms) = grave_deleted_ms {
            if should_remote_resurrect(n.mod_ms, del_ms) {
                tx.execute("DELETE FROM graves WHERE oid = ?1 AND type = 1", [n.id])
                    .map_err(err)?;
                tx.execute(
                    "DELETE FROM grave_times WHERE oid = ?1 AND type = 1",
                    [n.id],
                )
                .map_err(err)?;
            } else {
                continue; // local tombstone wins
            }
        }

        let fields_str = n.fields.join("\x1f");
        let clean_tags = crate::tags::normalize_tags(n.tags.iter().map(String::as_str));
        let tags_str = crate::browse::join_tags(&clean_tags);
        let checksum = n.fields.first().map(|s| crate::browse::field_checksum(s));
        let norm = crate::search::fields_norm_value(&fields_str, n.sort_field.as_deref());

        let existing: Option<(i64, String)> = tx
            .query_row(
                "SELECT \"mod\", fields FROM notes WHERE id = ?1",
                [n.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;

        match existing {
            None => {
                tx.execute(
                    "INSERT INTO notes (id, guid, notetype_id, \"mod\", usn, tags, fields, sort_field, checksum, fields_norm)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    rusqlite::params![n.id, n.guid, n.notetype_id, n.mod_ms, new_usn, tags_str, fields_str, n.sort_field, checksum, norm],
                )
                .map_err(err)?;
                for tag in &clean_tags {
                    tx.execute(
                        "INSERT OR IGNORE INTO tags (name, usn, expanded) VALUES (?1, ?2, 0)",
                        rusqlite::params![tag, new_usn],
                    )
                    .map_err(err)?;
                }
                summary.notes_updated += 1;
            }
            Some((local_mod, local_fields)) => {
                if should_remote_win_lww(n.mod_ms, local_mod, &fields_str, &local_fields) {
                    tx.execute(
                        "UPDATE notes SET guid = ?1, notetype_id = ?2, \"mod\" = ?3, usn = ?4, tags = ?5, fields = ?6, sort_field = ?7, checksum = ?8, fields_norm = ?9 WHERE id = ?10",
                        rusqlite::params![n.guid, n.notetype_id, n.mod_ms, new_usn, tags_str, fields_str, n.sort_field, checksum, norm, n.id],
                    )
                    .map_err(err)?;
                    for tag in &clean_tags {
                        tx.execute(
                            "INSERT OR IGNORE INTO tags (name, usn, expanded) VALUES (?1, ?2, 0)",
                            rusqlite::params![tag, new_usn],
                        )
                        .map_err(err)?;
                    }
                    summary.notes_updated += 1;
                }
            }
        }
    }

    // 5. Cards (LWW + Graves)
    for c in &delta.cards {
        let grave_deleted_ms: Option<i64> = tx
            .query_row(
                "SELECT COALESCE((SELECT deleted_ms FROM grave_times WHERE oid = ?1 AND type = 0), \
                         (SELECT modified FROM collection WHERE id = 1)) FROM graves WHERE oid = ?1 AND type = 0",
                [c.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;

        if let Some(del_ms) = grave_deleted_ms {
            if should_remote_resurrect(c.mod_ms, del_ms) {
                tx.execute("DELETE FROM graves WHERE oid = ?1 AND type = 0", [c.id])
                    .map_err(err)?;
                tx.execute(
                    "DELETE FROM grave_times WHERE oid = ?1 AND type = 0",
                    [c.id],
                )
                .map_err(err)?;
            } else {
                continue; // local tombstone wins
            }
        }

        let existing: Option<i64> = tx
            .query_row("SELECT \"mod\" FROM cards WHERE id = ?1", [c.id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;

        match existing {
            None => {
                tx.execute(
                    "INSERT INTO cards (id, note_id, deck_id, ord, \"mod\", usn, type, queue, due, interval, ease_factor, reps, lapses, remaining, original_due, original_deck_id, flags, fsrs_stability, fsrs_difficulty, fsrs_last_review, data)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
                    rusqlite::params![c.id, c.note_id, c.deck_id, c.ord, c.mod_ms, new_usn, c.ctype, c.queue, c.due, c.interval, c.ease_factor, c.reps, c.lapses, c.remaining, c.original_due, c.original_deck_id, c.flags, c.fsrs_stability, c.fsrs_difficulty, c.fsrs_last_review, c.data],
                )
                .map_err(err)?;
                summary.cards_updated += 1;
            }
            Some(local_mod) => {
                let remote_content = format!("{}:{}:{}", c.deck_id, c.queue, c.due);
                let local_content = format!("{}:{}:{}", c.deck_id, c.queue, c.due);
                if should_remote_win_lww(c.mod_ms, local_mod, &remote_content, &local_content) {
                    tx.execute(
                        "UPDATE cards SET note_id = ?1, deck_id = ?2, ord = ?3, \"mod\" = ?4, usn = ?5, type = ?6, queue = ?7, due = ?8, interval = ?9, ease_factor = ?10, reps = ?11, lapses = ?12, remaining = ?13, original_due = ?14, original_deck_id = ?15, flags = ?16, fsrs_stability = ?17, fsrs_difficulty = ?18, fsrs_last_review = ?19, data = ?20 WHERE id = ?21",
                        rusqlite::params![c.note_id, c.deck_id, c.ord, c.mod_ms, new_usn, c.ctype, c.queue, c.due, c.interval, c.ease_factor, c.reps, c.lapses, c.remaining, c.original_due, c.original_deck_id, c.flags, c.fsrs_stability, c.fsrs_difficulty, c.fsrs_last_review, c.data, c.id],
                    )
                    .map_err(err)?;
                    summary.cards_updated += 1;
                }
            }
        }
    }

    // 6. Revlog (Append-only union keyed by (id, card_id))
    for r in &delta.revlog {
        let exists: bool = tx
            .query_row(
                "SELECT 1 FROM revlog WHERE id = ?1 AND card_id = ?2",
                [r.id, r.card_id],
                |_| Ok(1),
            )
            .optional()
            .map_err(err)?
            .is_some();

        if !exists {
            tx.execute(
                "INSERT INTO revlog (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![r.id, r.card_id, new_usn, r.ease, r.interval, r.last_interval, r.ease_factor, r.taken_ms, r.review_kind],
            )
            .map_err(err)?;
            summary.revlog_added += 1;
        }
    }

    // 7. Graves (Tombstones)
    for g in &delta.graves {
        match g.kind {
            0 => {
                // Card grave
                let card_mod: Option<i64> = tx
                    .query_row("SELECT \"mod\" FROM cards WHERE id = ?1", [g.oid], |r| {
                        r.get(0)
                    })
                    .optional()
                    .map_err(err)?;

                if let Some(local_mod) = card_mod {
                    if should_tombstone_win(g.mod_ms, local_mod) {
                        tx.execute("DELETE FROM cards WHERE id = ?1", [g.oid])
                            .map_err(err)?;
                        tx.execute(
                            "INSERT INTO graves (oid, type, usn) VALUES (?1, 0, ?2)
                             ON CONFLICT(oid, type) DO UPDATE SET usn = excluded.usn",
                            rusqlite::params![g.oid, new_usn],
                        )
                        .map_err(err)?;
                        tx.execute(
                            "INSERT INTO grave_times (oid, type, deleted_ms) VALUES (?1, 0, ?2)
                             ON CONFLICT(oid, type) DO UPDATE SET deleted_ms = MAX(deleted_ms, excluded.deleted_ms)",
                            rusqlite::params![g.oid, g.mod_ms],
                        )
                        .map_err(err)?;
                        summary.graves_applied += 1;
                    }
                } else {
                    tx.execute(
                        "INSERT INTO graves (oid, type, usn) VALUES (?1, 0, ?2)
                         ON CONFLICT(oid, type) DO UPDATE SET usn = excluded.usn",
                        rusqlite::params![g.oid, new_usn],
                    )
                    .map_err(err)?;
                    tx.execute(
                        "INSERT INTO grave_times (oid, type, deleted_ms) VALUES (?1, 0, ?2)
                         ON CONFLICT(oid, type) DO UPDATE SET deleted_ms = MAX(deleted_ms, excluded.deleted_ms)",
                        rusqlite::params![g.oid, g.mod_ms],
                    )
                    .map_err(err)?;
                }
            }
            1 => {
                // Note grave
                let note_mod: Option<i64> = tx
                    .query_row("SELECT \"mod\" FROM notes WHERE id = ?1", [g.oid], |r| {
                        r.get(0)
                    })
                    .optional()
                    .map_err(err)?;

                if let Some(local_mod) = note_mod {
                    if should_tombstone_win(g.mod_ms, local_mod) {
                        tx.execute("DELETE FROM cards WHERE note_id = ?1", [g.oid])
                            .map_err(err)?;
                        tx.execute("DELETE FROM notes WHERE id = ?1", [g.oid])
                            .map_err(err)?;
                        tx.execute(
                            "INSERT INTO graves (oid, type, usn) VALUES (?1, 1, ?2)
                             ON CONFLICT(oid, type) DO UPDATE SET usn = excluded.usn",
                            rusqlite::params![g.oid, new_usn],
                        )
                        .map_err(err)?;
                        tx.execute(
                            "INSERT INTO grave_times (oid, type, deleted_ms) VALUES (?1, 1, ?2)
                             ON CONFLICT(oid, type) DO UPDATE SET deleted_ms = MAX(deleted_ms, excluded.deleted_ms)",
                            rusqlite::params![g.oid, g.mod_ms],
                        )
                        .map_err(err)?;
                        summary.graves_applied += 1;
                    }
                } else {
                    tx.execute(
                        "INSERT INTO graves (oid, type, usn) VALUES (?1, 1, ?2)
                         ON CONFLICT(oid, type) DO UPDATE SET usn = excluded.usn",
                        rusqlite::params![g.oid, new_usn],
                    )
                    .map_err(err)?;
                    tx.execute(
                        "INSERT INTO grave_times (oid, type, deleted_ms) VALUES (?1, 1, ?2)
                         ON CONFLICT(oid, type) DO UPDATE SET deleted_ms = MAX(deleted_ms, excluded.deleted_ms)",
                        rusqlite::params![g.oid, g.mod_ms],
                    )
                    .map_err(err)?;
                }
            }
            2 => {
                // Deck grave
                let deck_mod: Option<i64> = tx
                    .query_row("SELECT \"mod\" FROM decks WHERE id = ?1", [g.oid], |r| {
                        r.get(0)
                    })
                    .optional()
                    .map_err(err)?;

                if let Some(local_mod) = deck_mod {
                    if should_tombstone_win(g.mod_ms, local_mod) {
                        tx.execute("DELETE FROM decks WHERE id = ?1", [g.oid])
                            .map_err(err)?;
                        tx.execute(
                            "INSERT INTO graves (oid, type, usn) VALUES (?1, 2, ?2)
                             ON CONFLICT(oid, type) DO UPDATE SET usn = excluded.usn",
                            rusqlite::params![g.oid, new_usn],
                        )
                        .map_err(err)?;
                        tx.execute(
                            "INSERT INTO grave_times (oid, type, deleted_ms) VALUES (?1, 2, ?2)
                             ON CONFLICT(oid, type) DO UPDATE SET deleted_ms = MAX(deleted_ms, excluded.deleted_ms)",
                            rusqlite::params![g.oid, g.mod_ms],
                        )
                        .map_err(err)?;
                        summary.graves_applied += 1;
                    }
                } else {
                    tx.execute(
                        "INSERT INTO graves (oid, type, usn) VALUES (?1, 2, ?2)
                         ON CONFLICT(oid, type) DO UPDATE SET usn = excluded.usn",
                        rusqlite::params![g.oid, new_usn],
                    )
                    .map_err(err)?;
                    tx.execute(
                        "INSERT INTO grave_times (oid, type, deleted_ms) VALUES (?1, 2, ?2)
                         ON CONFLICT(oid, type) DO UPDATE SET deleted_ms = MAX(deleted_ms, excluded.deleted_ms)",
                        rusqlite::params![g.oid, g.mod_ms],
                    )
                    .map_err(err)?;
                }
            }
            _ => {}
        }
    }

    // 8. Tags
    for t in &delta.tags {
        tx.execute(
            "INSERT OR IGNORE INTO tags (name, usn, expanded) VALUES (?1, ?2, 0)",
            rusqlite::params![t.name, new_usn],
        )
        .map_err(err)?;
        summary.tags_registered += 1;
    }

    // 9. Progress ledger (ADR-019 §2.5: LWW by updated_at; on tie, deleted_at.is_some() wins)
    for p in &delta.progress_ledger {
        let existing: Option<(String, i64, i64, i64, i64, Option<i64>)> = tx
            .query_row(
                "SELECT id, xp, gold_cents, created_at, updated_at, deleted_at
                 FROM progress_ledger
                 WHERE user_id = ?1 AND source_key = ?2",
                rusqlite::params![p.user_id, p.source_key],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                    ))
                },
            )
            .optional()
            .map_err(err)?;

        match existing {
            None => {
                tx.execute(
                    "INSERT INTO progress_ledger
                     (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    rusqlite::params![
                        p.id,
                        p.user_id,
                        p.source_key,
                        p.xp,
                        p.gold_cents,
                        p.created_at,
                        p.updated_at,
                        p.deleted_at,
                        new_usn,
                    ],
                )
                .map_err(err)?;
                summary.progress_ledger_updated += 1;
            }
            Some((local_id, local_xp, local_gold, local_created, local_updated, local_deleted)) => {
                if local_id == p.id
                    && local_xp == p.xp
                    && local_gold == p.gold_cents
                    && local_created == p.created_at
                    && local_updated == p.updated_at
                    && local_deleted == p.deleted_at
                {
                    continue;
                }
                let remote_wins = if p.updated_at != local_updated {
                    p.updated_at > local_updated
                } else if p.deleted_at.is_some() != local_deleted.is_some() {
                    p.deleted_at.is_some()
                } else {
                    let remote_repr = format!(
                        "{}:{}:{}:{}:{:?}",
                        p.id, p.xp, p.gold_cents, p.created_at, p.deleted_at
                    );
                    let local_repr = format!(
                        "{}:{}:{}:{}:{:?}",
                        local_id, local_xp, local_gold, local_created, local_deleted
                    );
                    remote_repr > local_repr
                };
                if remote_wins {
                    tx.execute(
                        "UPDATE progress_ledger
                         SET id = ?1, xp = ?2, gold_cents = ?3, created_at = ?4, updated_at = ?5, deleted_at = ?6, usn = ?7
                         WHERE user_id = ?8 AND source_key = ?9",
                        rusqlite::params![
                            p.id,
                            p.xp,
                            p.gold_cents,
                            p.created_at,
                            p.updated_at,
                            p.deleted_at,
                            new_usn,
                            p.user_id,
                            p.source_key,
                        ],
                    )
                    .map_err(err)?;
                    summary.progress_ledger_updated += 1;
                }
            }
        }
    }
    if summary.progress_ledger_updated > 0 {
        crate::game_depth::invalidate_all_earned_xp_caches_tx(&tx)?;
    }

    // 10. Productivity tables in parent-first order (ADR-018 §2.9)
    for tl in &delta.task_lists {
        let local = tx
            .query_row(
                &format!("SELECT {TASK_LIST_COLS} FROM task_lists WHERE id = ?1"),
                [&tl.id],
                map_task_list,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_task_list_with_usn(&tx, tl, new_usn)?;
                summary.task_lists_updated += 1;
            }
            Some(mut l) => {
                let mut r_cmp = tl.clone();
                r_cmp.usn = 0;
                l.usn = 0;
                if l == r_cmp {
                    continue;
                }
                if should_remote_win_soft_delete(
                    tl.updated_at,
                    l.updated_at,
                    tl.deleted_at,
                    l.deleted_at,
                    &r_cmp,
                    &l,
                )? {
                    upsert_task_list_with_usn(&tx, tl, new_usn)?;
                    summary.task_lists_updated += 1;
                }
            }
        }
    }

    for t in &delta.tasks {
        let local = tx
            .query_row(
                &format!("SELECT {TASK_COLS} FROM tasks WHERE id = ?1"),
                [&t.id],
                map_task,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_task_with_usn(&tx, t, new_usn)?;
                summary.tasks_updated += 1;
            }
            Some(mut l) => {
                let mut r_cmp = t.clone();
                r_cmp.usn = 0;
                l.usn = 0;
                if l == r_cmp {
                    continue;
                }
                if should_remote_win_soft_delete(
                    t.updated_at,
                    l.updated_at,
                    t.deleted_at,
                    l.deleted_at,
                    &r_cmp,
                    &l,
                )? {
                    upsert_task_with_usn(&tx, t, new_usn)?;
                    summary.tasks_updated += 1;
                }
            }
        }
    }

    for mq in &delta.matrix_quadrants {
        let local = tx
            .query_row(
                &format!(
                    "SELECT {MATRIX_QUADRANT_COLS} FROM matrix_quadrants
                     WHERE user_id = ?1 AND quadrant_key = ?2"
                ),
                rusqlite::params![mq.user_id, mq.quadrant_key.as_str()],
                map_matrix_quadrant,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_matrix_quadrant_with_usn(&tx, mq, new_usn)?;
                summary.matrix_quadrants_updated += 1;
            }
            Some(mut l) => {
                let mut r_cmp = mq.clone();
                r_cmp.usn = 0;
                l.usn = 0;
                if l == r_cmp {
                    continue;
                }
                if should_remote_win_soft_delete(
                    mq.updated_at,
                    l.updated_at,
                    mq.deleted_at,
                    l.deleted_at,
                    &r_cmp,
                    &l,
                )? {
                    upsert_matrix_quadrant_with_usn(&tx, mq, new_usn)?;
                    summary.matrix_quadrants_updated += 1;
                }
            }
        }
    }

    for h in &delta.habits {
        let local = tx
            .query_row(
                &format!("SELECT {HABIT_COLS} FROM habits WHERE id = ?1"),
                [&h.id],
                map_habit,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_habit_with_usn(&tx, h, new_usn)?;
                summary.habits_updated += 1;
            }
            Some(mut l) => {
                let mut r_cmp = h.clone();
                r_cmp.usn = 0;
                l.usn = 0;
                if l == r_cmp {
                    continue;
                }
                if should_remote_win_soft_delete(
                    h.updated_at,
                    l.updated_at,
                    h.deleted_at,
                    l.deleted_at,
                    &r_cmp,
                    &l,
                )? {
                    upsert_habit_with_usn(&tx, h, new_usn)?;
                    summary.habits_updated += 1;
                }
            }
        }
    }

    for hl in &delta.habit_logs {
        let local = tx
            .query_row(
                &format!(
                    "SELECT {HABIT_LOG_COLS} FROM habit_logs
                     WHERE user_id = ?1 AND habit_id = ?2 AND day_index = ?3"
                ),
                rusqlite::params![hl.user_id, hl.habit_id, hl.day_index],
                map_habit_log,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_habit_log_with_usn(&tx, hl, new_usn)?;
                summary.habit_logs_updated += 1;
            }
            Some(mut l) => {
                let mut r_cmp = hl.clone();
                r_cmp.usn = 0;
                l.usn = 0;
                if l == r_cmp {
                    continue;
                }
                if should_remote_win_soft_delete(
                    hl.updated_at,
                    l.updated_at,
                    hl.deleted_at,
                    l.deleted_at,
                    &r_cmp,
                    &l,
                )? {
                    upsert_habit_log_with_usn(&tx, hl, new_usn)?;
                    summary.habit_logs_updated += 1;
                }
            }
        }
    }

    for ce in &delta.calendar_events {
        let local = tx
            .query_row(
                &format!("SELECT {CALENDAR_EVENT_COLS} FROM calendar_events WHERE id = ?1"),
                [&ce.id],
                map_calendar_event,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_calendar_event_with_usn(&tx, ce, new_usn)?;
                summary.calendar_events_updated += 1;
            }
            Some(mut l) => {
                let mut r_cmp = ce.clone();
                r_cmp.usn = 0;
                l.usn = 0;
                if l == r_cmp {
                    continue;
                }
                if should_remote_win_soft_delete(
                    ce.updated_at,
                    l.updated_at,
                    ce.deleted_at,
                    l.deleted_at,
                    &r_cmp,
                    &l,
                )? {
                    upsert_calendar_event_with_usn(&tx, ce, new_usn)?;
                    summary.calendar_events_updated += 1;
                }
            }
        }
    }

    // 10b. Game (R2, ADR-025)
    for ap in &delta.avatar_profile {
        let local = tx
            .query_row(
                &format!("SELECT {AVATAR_PROFILE_COLS} FROM avatar_profile WHERE user_id = ?1"),
                [&ap.user_id],
                map_avatar_profile,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_avatar_profile_with_usn(&tx, ap, new_usn)?;
                summary.avatar_profile_updated += 1;
            }
            Some(mut l) => {
                let mut r_cmp = ap.clone();
                r_cmp.usn = 0;
                l.usn = 0;
                if l != r_cmp
                    && should_remote_win_soft_delete(
                        ap.updated_at,
                        l.updated_at,
                        ap.deleted_at,
                        l.deleted_at,
                        &r_cmp,
                        &l,
                    )?
                {
                    upsert_avatar_profile_with_usn(&tx, ap, new_usn)?;
                    summary.avatar_profile_updated += 1;
                }
            }
        }
    }

    for inv in &delta.inventory_items {
        let local = tx
            .query_row(
                &format!(
                    "SELECT {INVENTORY_ITEM_COLS} FROM inventory_items WHERE user_id = ?1 AND item_key = ?2"
                ),
                rusqlite::params![inv.user_id, inv.item_key],
                map_inventory_item,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_inventory_item_with_usn(&tx, inv, new_usn)?;
                summary.inventory_items_updated += 1;
            }
            Some(mut l) => {
                let mut r_cmp = inv.clone();
                r_cmp.usn = 0;
                l.usn = 0;
                if l != r_cmp
                    && should_remote_win_soft_delete(
                        inv.updated_at,
                        l.updated_at,
                        inv.deleted_at,
                        l.deleted_at,
                        &r_cmp,
                        &l,
                    )?
                {
                    upsert_inventory_item_with_usn(&tx, inv, new_usn)?;
                    summary.inventory_items_updated += 1;
                }
            }
        }
    }

    for eq in &delta.avatar_equipped {
        let local = tx
            .query_row(
                &format!(
                    "SELECT {AVATAR_EQUIPPED_COLS} FROM avatar_equipped WHERE user_id = ?1 AND slot = ?2"
                ),
                rusqlite::params![eq.user_id, eq.slot],
                map_avatar_equipped,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_avatar_equipped_with_usn(&tx, eq, new_usn)?;
                summary.avatar_equipped_updated += 1;
            }
            Some(mut l) => {
                let mut r_cmp = eq.clone();
                r_cmp.usn = 0;
                l.usn = 0;
                if l != r_cmp
                    && should_remote_win_soft_delete(
                        eq.updated_at,
                        l.updated_at,
                        eq.deleted_at,
                        l.deleted_at,
                        &r_cmp,
                        &l,
                    )?
                {
                    upsert_avatar_equipped_with_usn(&tx, eq, new_usn)?;
                    summary.avatar_equipped_updated += 1;
                }
            }
        }
    }

    for cr in &delta.custom_rewards {
        let local = tx
            .query_row(
                &format!("SELECT {CUSTOM_REWARD_COLS} FROM custom_rewards WHERE id = ?1"),
                [&cr.id],
                map_custom_reward,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_custom_reward_with_usn(&tx, cr, new_usn)?;
                summary.custom_rewards_updated += 1;
            }
            Some(mut l) => {
                let mut r_cmp = cr.clone();
                r_cmp.usn = 0;
                l.usn = 0;
                if l != r_cmp
                    && should_remote_win_soft_delete(
                        cr.updated_at,
                        l.updated_at,
                        cr.deleted_at,
                        l.deleted_at,
                        &r_cmp,
                        &l,
                    )?
                {
                    upsert_custom_reward_with_usn(&tx, cr, new_usn)?;
                    summary.custom_rewards_updated += 1;
                }
            }
        }
    }

    for gs in &delta.gold_spend_ledger {
        let local = tx
            .query_row(
                &format!(
                    "SELECT {GOLD_SPEND_COLS} FROM gold_spend_ledger WHERE user_id = ?1 AND idempotency_key = ?2"
                ),
                rusqlite::params![gs.user_id, gs.idempotency_key],
                map_gold_spend,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_gold_spend_with_usn(&tx, gs, new_usn)?;
                summary.gold_spend_ledger_updated += 1;
            }
            Some(mut l) => {
                let mut r_cmp = gs.clone();
                r_cmp.usn = 0;
                l.usn = 0;
                if l != r_cmp
                    && should_remote_win_soft_delete(
                        gs.updated_at,
                        l.updated_at,
                        gs.deleted_at,
                        l.deleted_at,
                        &r_cmp,
                        &l,
                    )?
                {
                    upsert_gold_spend_with_usn(&tx, gs, new_usn)?;
                    summary.gold_spend_ledger_updated += 1;
                }
            }
        }
    }

    for ft in &delta.freeze_token_ledger {
        let local = tx
            .query_row(
                &format!(
                    "SELECT {FREEZE_TOKEN_COLS} FROM freeze_token_ledger WHERE user_id = ?1 AND source_key = ?2"
                ),
                rusqlite::params![ft.user_id, ft.source_key],
                map_freeze_token,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_freeze_token_with_usn(&tx, ft, new_usn)?;
                summary.freeze_token_ledger_updated += 1;
            }
            Some(mut l) => {
                let mut r_cmp = ft.clone();
                r_cmp.usn = 0;
                l.usn = 0;
                if l != r_cmp
                    && should_remote_win_soft_delete(
                        ft.updated_at,
                        l.updated_at,
                        ft.deleted_at,
                        l.deleted_at,
                        &r_cmp,
                        &l,
                    )?
                {
                    upsert_freeze_token_with_usn(&tx, ft, new_usn)?;
                    summary.freeze_token_ledger_updated += 1;
                }
            }
        }
    }

    // 10c. Game depth (R4, ADR-026 §2.5)
    for gp in &delta.game_profile {
        let local = tx
            .query_row(
                &format!("SELECT {GAME_PROFILE_COLS} FROM game_profile WHERE user_id = ?1"),
                [&gp.user_id],
                map_game_profile,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_game_profile_with_usn(&tx, gp, new_usn)?;
                summary.game_profile_updated += 1;
            }
            Some(l) => {
                let mut l_cmp = l.clone();
                let mut r_cmp = gp.clone();
                l_cmp.usn = 0;
                r_cmp.usn = 0;
                let remote_wins_lww = should_remote_win_soft_delete(
                    gp.updated_at,
                    l.updated_at,
                    gp.deleted_at,
                    l.deleted_at,
                    &r_cmp,
                    &l_cmp,
                )?;
                let mut merged = if remote_wins_lww {
                    gp.clone()
                } else {
                    l.clone()
                };
                merged.backfill_version = l.backfill_version.max(gp.backfill_version);
                merged.created_at = l.created_at.min(gp.created_at);
                merged.updated_at = l.updated_at.max(gp.updated_at);
                merged.usn = 0;
                if merged != l_cmp {
                    upsert_game_profile_with_usn(&tx, &merged, new_usn)?;
                    summary.game_profile_updated += 1;
                }
            }
        }
    }

    for gu in &delta.game_unlocks {
        let local = tx
            .query_row(
                &format!(
                    "SELECT {GAME_UNLOCK_COLS} FROM game_unlocks WHERE user_id = ?1 AND unlock_key = ?2"
                ),
                rusqlite::params![gu.user_id, gu.unlock_key],
                map_game_unlock,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_game_unlock_with_usn(&tx, gu, new_usn)?;
                summary.game_unlocks_updated += 1;
            }
            Some(l) => {
                let deleted_at = match (l.deleted_at, gu.deleted_at) {
                    (None, _) | (_, None) => None,
                    (Some(a), Some(b)) => Some(a.min(b)),
                };
                let mut merged = bibalak_core::game_depth::GameUnlock {
                    id: l.id.clone(),
                    user_id: l.user_id.clone(),
                    unlock_key: l.unlock_key.clone(),
                    reward_kind: if gu.deleted_at.is_none() {
                        gu.reward_kind.clone()
                    } else {
                        l.reward_kind.clone()
                    },
                    reward_ref: if gu.deleted_at.is_none() {
                        gu.reward_ref.clone()
                    } else {
                        l.reward_ref.clone()
                    },
                    unlocked_at: l.unlocked_at.min(gu.unlocked_at),
                    seen_at: min_some_i64(l.seen_at, gu.seen_at),
                    created_at: l.created_at.min(gu.created_at),
                    updated_at: l.updated_at.max(gu.updated_at),
                    deleted_at,
                    usn: 0,
                };
                let mut l_cmp = l.clone();
                l_cmp.usn = 0;
                if merged != l_cmp {
                    upsert_game_unlock_with_usn(&tx, &merged, new_usn)?;
                    summary.game_unlocks_updated += 1;
                }
                let _ = &mut merged;
            }
        }
    }

    for pet in &delta.game_pets {
        let local = tx
            .query_row(
                &format!(
                    "SELECT {GAME_PET_COLS} FROM game_pets WHERE user_id = ?1 AND species_key = ?2 AND variant_key = ?3"
                ),
                rusqlite::params![pet.user_id, pet.species_key, pet.variant_key],
                map_game_pet,
            )
            .optional()
            .map_err(err)?;
        let mut merged = match local {
            None => {
                let mut m = pet.clone();
                if m.mount_unlocked_at.is_none() {
                    m.is_mounted = false;
                }
                m
            }
            Some(l) => {
                let deleted_at = match (l.deleted_at, pet.deleted_at) {
                    (None, _) | (_, None) => None,
                    (Some(a), Some(b)) => Some(a.min(b)),
                };
                let mount_unlocked_at = min_some_i64(l.mount_unlocked_at, pet.mount_unlocked_at);
                let mut l_cmp = l.clone();
                let mut r_cmp = pet.clone();
                l_cmp.usn = 0;
                r_cmp.usn = 0;
                let r_repr = serde_json::to_string(&r_cmp).map_err(err)?;
                let l_repr = serde_json::to_string(&l_cmp).map_err(err)?;
                let remote_wins =
                    should_remote_win_lww(pet.updated_at, l.updated_at, &r_repr, &l_repr);
                let (is_active, is_mounted) = if remote_wins {
                    (pet.is_active, pet.is_mounted && mount_unlocked_at.is_some())
                } else {
                    (l.is_active, l.is_mounted && mount_unlocked_at.is_some())
                };
                let m = bibalak_core::game_depth::GamePet {
                    id: l.id.clone(),
                    user_id: l.user_id.clone(),
                    species_key: l.species_key.clone(),
                    variant_key: l.variant_key.clone(),
                    mount_unlocked_at,
                    is_active,
                    is_mounted,
                    created_at: l.created_at.min(pet.created_at),
                    updated_at: l.updated_at.max(pet.updated_at),
                    deleted_at,
                    usn: 0,
                };
                if m == l_cmp {
                    continue;
                }
                m
            }
        };

        // Enforce partial unique index `idx_game_pets_one_active`: at most one active pet per user_id,
        // keeping the one with newest updated_at.
        if merged.is_active && merged.deleted_at.is_none() {
            let other_active: Option<(String, i64)> = tx
                .query_row(
                    "SELECT id, updated_at FROM game_pets
                     WHERE user_id = ?1 AND is_active = 1 AND deleted_at IS NULL AND id != ?2",
                    rusqlite::params![merged.user_id, merged.id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(err)?;
            if let Some((other_id, other_updated)) = other_active {
                if merged.updated_at >= other_updated {
                    tx.execute(
                        "UPDATE game_pets SET is_active = 0, is_mounted = 0, usn = ?1 WHERE id = ?2",
                        rusqlite::params![new_usn, other_id],
                    )
                    .map_err(err)?;
                } else {
                    merged.is_active = false;
                    merged.is_mounted = false;
                }
            }
        }
        upsert_game_pet_with_usn(&tx, &merged, new_usn)?;
        summary.game_pets_updated += 1;
    }

    for pc in &delta.game_pet_credits {
        let local = tx
            .query_row(
                &format!(
                    "SELECT {GAME_PET_CREDIT_COLS} FROM game_pet_credits WHERE pet_id = ?1 AND ledger_id = ?2"
                ),
                rusqlite::params![pc.pet_id, pc.ledger_id],
                map_game_pet_credit,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_game_pet_credit_with_usn(&tx, pc, new_usn)?;
                summary.game_pet_credits_updated += 1;
            }
            Some(mut l) => {
                let mut r_cmp = pc.clone();
                r_cmp.usn = 0;
                l.usn = 0;
                if l != r_cmp
                    && should_remote_win_soft_delete(
                        pc.updated_at,
                        l.updated_at,
                        pc.deleted_at,
                        l.deleted_at,
                        &r_cmp,
                        &l,
                    )?
                {
                    upsert_game_pet_credit_with_usn(&tx, pc, new_usn)?;
                    summary.game_pet_credits_updated += 1;
                }
            }
        }
    }

    for ach in &delta.game_achievements {
        let local = tx
            .query_row(
                &format!(
                    "SELECT {GAME_ACHIEVEMENT_COLS} FROM game_achievements WHERE user_id = ?1 AND achievement_key = ?2"
                ),
                rusqlite::params![ach.user_id, ach.achievement_key],
                map_game_achievement,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_game_achievement_with_usn(&tx, ach, new_usn)?;
                summary.game_achievements_updated += 1;
            }
            Some(l) => {
                let deleted_at = match (l.deleted_at, ach.deleted_at) {
                    (None, _) | (_, None) => None,
                    (Some(a), Some(b)) => Some(a.min(b)),
                };
                let merged = bibalak_core::game_depth::GameAchievement {
                    id: l.id.clone(),
                    user_id: l.user_id.clone(),
                    achievement_key: l.achievement_key.clone(),
                    tier: l.tier.max(ach.tier),
                    earned_at: l.earned_at.min(ach.earned_at),
                    seen_at: min_some_i64(l.seen_at, ach.seen_at),
                    created_at: l.created_at.min(ach.created_at),
                    updated_at: l.updated_at.max(ach.updated_at),
                    deleted_at,
                    usn: 0,
                };
                let mut l_cmp = l.clone();
                l_cmp.usn = 0;
                if merged != l_cmp {
                    upsert_game_achievement_with_usn(&tx, &merged, new_usn)?;
                    summary.game_achievements_updated += 1;
                }
            }
        }
    }

    // Motivation (16d, ADR-027 §2.5)
    for ms in &delta.motivation_settings {
        let local = tx
            .query_row(
                &format!(
                    "SELECT {MOTIVATION_SETTINGS_COLS} FROM motivation_settings WHERE user_id = ?1"
                ),
                rusqlite::params![ms.user_id],
                map_motivation_settings,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_motivation_settings_with_usn(&tx, ms, new_usn)?;
                summary.motivation_settings_updated += 1;
            }
            Some(l) => {
                let mut l_cmp = l.clone();
                let mut r_cmp = ms.clone();
                l_cmp.usn = 0;
                r_cmp.usn = 0;
                let remote_wins = should_remote_win_soft_delete(
                    ms.updated_at,
                    l.updated_at,
                    ms.deleted_at,
                    l.deleted_at,
                    &r_cmp,
                    &l_cmp,
                )?;
                let winner = if remote_wins { ms } else { &l };
                let merged = bibalak_core::motivation::MotivationSettingsRow {
                    id: l.id.clone(),
                    user_id: l.user_id.clone(),
                    daily_goal_xp: winner.daily_goal_xp,
                    onboarding_completed_at: min_some_i64(
                        l.onboarding_completed_at,
                        ms.onboarding_completed_at,
                    ),
                    comeback_return_day: winner.comeback_return_day,
                    comeback_awarded_return_day: winner.comeback_awarded_return_day,
                    comeback_awarded_day: winner.comeback_awarded_day,
                    comeback_dismissed_day: winner.comeback_dismissed_day,
                    created_at: l.created_at.min(ms.created_at),
                    updated_at: l.updated_at.max(ms.updated_at),
                    deleted_at: winner.deleted_at,
                    usn: 0,
                };
                if merged != l_cmp {
                    upsert_motivation_settings_with_usn(&tx, &merged, new_usn)?;
                    summary.motivation_settings_updated += 1;
                }
            }
        }
    }

    for mb in &delta.monthly_badges {
        let local = tx
            .query_row(
                &format!(
                    "SELECT {MONTHLY_BADGE_COLS} FROM monthly_badges WHERE user_id = ?1 AND month_key = ?2"
                ),
                rusqlite::params![mb.user_id, mb.month_key],
                map_monthly_badge,
            )
            .optional()
            .map_err(err)?;
        match local {
            None => {
                upsert_monthly_badge_with_usn(&tx, mb, new_usn)?;
                summary.monthly_badges_updated += 1;
            }
            Some(l) => {
                let deleted_at = match (l.deleted_at, mb.deleted_at) {
                    (None, _) | (_, None) => None,
                    (Some(a), Some(b)) => Some(a.min(b)),
                };
                let merged = bibalak_core::motivation::MonthlyBadgeRow {
                    id: l.id.clone(),
                    user_id: l.user_id.clone(),
                    month_key: l.month_key.clone(),
                    quest_count_at_earn: l.quest_count_at_earn.max(mb.quest_count_at_earn),
                    earned_at: l.earned_at.min(mb.earned_at),
                    seen_at: min_some_i64(l.seen_at, mb.seen_at),
                    created_at: l.created_at.min(mb.created_at),
                    updated_at: l.updated_at.max(mb.updated_at),
                    deleted_at,
                    usn: 0,
                };
                let mut l_cmp = l.clone();
                l_cmp.usn = 0;
                if merged != l_cmp {
                    upsert_monthly_badge_with_usn(&tx, &merged, new_usn)?;
                    summary.monthly_badges_updated += 1;
                }
            }
        }
    }

    // 11. Update collection sync cursor
    tx.execute(
        "UPDATE collection SET last_sync = ?1, usn = ?2 WHERE id = 1",
        rusqlite::params![now_ms, new_usn],
    )
    .map_err(err)?;

    // 10. Post-merge safety: PRAGMA integrity_check + PRAGMA foreign_key_check (ADR-014 §2.5)
    let mut check_stmt = tx.prepare("PRAGMA integrity_check").map_err(err)?;
    let check_rows = check_stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?;
    for r in check_rows {
        let msg = r.map_err(err)?;
        if msg != "ok" {
            return Err(CoreError::Storage(format!(
                "integrity check failed post-merge: {msg}"
            )));
        }
    }
    drop(check_stmt);

    let fk_violation: Option<(String, i64, String)> = {
        let mut fk_stmt = tx.prepare("PRAGMA foreign_key_check").map_err(err)?;
        let mut fk_rows = fk_stmt.query([]).map_err(err)?;
        if let Some(r) = fk_rows.next().map_err(err)? {
            Some((
                r.get(0).map_err(err)?,
                r.get(1).map_err(err)?,
                r.get(2).map_err(err)?,
            ))
        } else {
            None
        }
    };
    if let Some((table, rowid, parent)) = fk_violation {
        return Err(CoreError::Storage(format!(
            "foreign key check failed post-merge: table {table} rowid {rowid} references missing {parent}"
        )));
    }

    if !delta.revlog.is_empty() || !delta.cards.is_empty() || !delta.decks.is_empty() {
        crate::game_depth::invalidate_studied_top_decks_tx(&tx)?;
    }

    tx.commit().map_err(err)?;

    Ok(summary)
}

/// Mark local uncommitted mutations (`usn = -1`) as clean with `server_usn`.
pub fn acknowledge_delta(conn: &Connection, server_usn: i64) -> CoreResult<()> {
    conn.execute_batch(&format!(
        "UPDATE notes SET usn = {server_usn} WHERE usn = -1;
         UPDATE cards SET usn = {server_usn} WHERE usn = -1;
         UPDATE decks SET usn = {server_usn} WHERE usn = -1;
         UPDATE deck_config SET usn = {server_usn} WHERE usn = -1;
         UPDATE notetypes SET usn = {server_usn} WHERE usn = -1;
         UPDATE tags SET usn = {server_usn} WHERE usn = -1;
         UPDATE graves SET usn = {server_usn} WHERE usn = -1;
         UPDATE revlog SET usn = {server_usn} WHERE usn = -1;
         UPDATE progress_ledger SET usn = {server_usn} WHERE usn = -1;
         UPDATE task_lists SET usn = {server_usn} WHERE usn = -1;
         UPDATE tasks SET usn = {server_usn} WHERE usn = -1;
         UPDATE matrix_quadrants SET usn = {server_usn} WHERE usn = -1;
         UPDATE habits SET usn = {server_usn} WHERE usn = -1;
         UPDATE habit_logs SET usn = {server_usn} WHERE usn = -1;
         UPDATE calendar_events SET usn = {server_usn} WHERE usn = -1;
         UPDATE avatar_profile SET usn = {server_usn} WHERE usn = -1;
         UPDATE inventory_items SET usn = {server_usn} WHERE usn = -1;
         UPDATE avatar_equipped SET usn = {server_usn} WHERE usn = -1;
         UPDATE custom_rewards SET usn = {server_usn} WHERE usn = -1;
         UPDATE gold_spend_ledger SET usn = {server_usn} WHERE usn = -1;
         UPDATE freeze_token_ledger SET usn = {server_usn} WHERE usn = -1;
         UPDATE game_profile SET usn = {server_usn} WHERE usn = -1;
         UPDATE game_unlocks SET usn = {server_usn} WHERE usn = -1;
         UPDATE game_pets SET usn = {server_usn} WHERE usn = -1;
         UPDATE game_pet_credits SET usn = {server_usn} WHERE usn = -1;
         UPDATE game_achievements SET usn = {server_usn} WHERE usn = -1;
         UPDATE motivation_settings SET usn = {server_usn} WHERE usn = -1;
         UPDATE monthly_badges SET usn = {server_usn} WHERE usn = -1;"
    ))
    .map_err(err)?;
    Ok(())
}

/// Read a key from the `sync_state` table.
pub fn get_sync_state(conn: &Connection, key: &str) -> CoreResult<Option<String>> {
    let mut stmt = conn
        .prepare("SELECT value FROM sync_state WHERE key = ?1")
        .map_err(err)?;
    stmt.query_row([key], |r| r.get(0)).optional().map_err(err)
}

/// Upsert a key-value pair in the `sync_state` table.
pub fn set_sync_state(conn: &Connection, key: &str, value: &str) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO sync_state (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(err)?;
    Ok(())
}
