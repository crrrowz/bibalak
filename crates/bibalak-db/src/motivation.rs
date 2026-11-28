//! SQLite adapter for Cycle 3 daily motivation: synced settings, quests,
//! monthly badges, comeback bonus, and study-streak calendar (ADR-027, 16d).

use std::collections::{HashMap, HashSet};

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::epoch_days_to_date_string;
use bibalak_core::motivation::{
    active_comeback_offer, build_quest_dto, build_streak_milestones, can_manual_freeze_day,
    comeback_bonus_source_key, compute_streak_pair, daily_quest_source_key, daily_quests_for_day,
    evaluate_comeback_on_load, is_comeback_reward_eligible, month_day_range, month_key_for_day,
    monthly_badge_id, monthly_badge_source_key, next_streak_milestone,
    should_auto_freeze_study_gap, study_freeze_source_key, validate_daily_goal_xp,
    weekly_quest_for_week, weekly_quest_source_key, EarnedMonthlyBadgeDto, MonthlyBadgeRow,
    MonthlyBadgeStatusDto, MotivationSettingsRow, MotivationStateDto, QuestKind, QuestMetric,
    QuestMetricCounts, QuestTemplate, StreakCalendarDayDto, StreakCalendarDto,
    COMEBACK_BONUS_GOLD_CENTS, DAILY_QUEST_GOLD_CENTS, MONTHLY_BADGE_GOLD_CENTS,
    MONTHLY_BADGE_TARGET_QUESTS, WEEKLY_QUEST_GOLD_CENTS,
};
use bibalak_core::progress::{
    created_epoch_day, day_index_for_ms, ledger_id, parse_ledger_source_key, ParsedSourceKey,
    MS_PER_DAY,
};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

use crate::game::{
    active_ledger_days, freeze_tokens_held, frozen_study_days, upsert_freeze_entry_tx,
};

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

// ── Row Mappers & Column Lists (shared with sync.rs) ─────────────────────────

pub(crate) const MOTIVATION_SETTINGS_COLS: &str =
    "id, user_id, daily_goal_xp, onboarding_completed_at, comeback_return_day, comeback_awarded_return_day, comeback_awarded_day, comeback_dismissed_day, created_at, updated_at, deleted_at, usn";

pub(crate) const MONTHLY_BADGE_COLS: &str =
    "id, user_id, month_key, quest_count_at_earn, earned_at, seen_at, created_at, updated_at, deleted_at, usn";

pub(crate) fn map_motivation_settings(row: &Row<'_>) -> rusqlite::Result<MotivationSettingsRow> {
    Ok(MotivationSettingsRow {
        id: row.get(0)?,
        user_id: row.get(1)?,
        daily_goal_xp: u32::try_from(row.get::<_, i64>(2)?.max(0))
            .unwrap_or(bibalak_core::motivation::DEFAULT_DAILY_GOAL_XP),
        onboarding_completed_at: row.get(3)?,
        comeback_return_day: row.get(4)?,
        comeback_awarded_return_day: row.get(5)?,
        comeback_awarded_day: row.get(6)?,
        comeback_dismissed_day: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        deleted_at: row.get(10)?,
        usn: row.get(11)?,
    })
}

pub(crate) fn map_monthly_badge(row: &Row<'_>) -> rusqlite::Result<MonthlyBadgeRow> {
    Ok(MonthlyBadgeRow {
        id: row.get(0)?,
        user_id: row.get(1)?,
        month_key: row.get(2)?,
        quest_count_at_earn: u32::try_from(row.get::<_, i64>(3)?.max(1)).unwrap_or(1),
        earned_at: row.get(4)?,
        seen_at: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deleted_at: row.get(8)?,
        usn: row.get(9)?,
    })
}

pub(crate) fn upsert_motivation_settings_with_usn(
    conn: &Connection,
    s: &MotivationSettingsRow,
    usn: i64,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO motivation_settings
         (id, user_id, daily_goal_xp, onboarding_completed_at, comeback_return_day,
          comeback_awarded_return_day, comeback_awarded_day, comeback_dismissed_day,
          created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(user_id) DO UPDATE SET
             id = excluded.id,
             daily_goal_xp = excluded.daily_goal_xp,
             onboarding_completed_at = excluded.onboarding_completed_at,
             comeback_return_day = excluded.comeback_return_day,
             comeback_awarded_return_day = excluded.comeback_awarded_return_day,
             comeback_awarded_day = excluded.comeback_awarded_day,
             comeback_dismissed_day = excluded.comeback_dismissed_day,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            s.id,
            s.user_id,
            i64::from(s.daily_goal_xp),
            s.onboarding_completed_at,
            s.comeback_return_day,
            s.comeback_awarded_return_day,
            s.comeback_awarded_day,
            s.comeback_dismissed_day,
            s.created_at,
            s.updated_at,
            s.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub(crate) fn upsert_monthly_badge_with_usn(
    conn: &Connection,
    b: &MonthlyBadgeRow,
    usn: i64,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO monthly_badges
         (id, user_id, month_key, quest_count_at_earn, earned_at, seen_at,
          created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(user_id, month_key) DO UPDATE SET
             id = excluded.id,
             quest_count_at_earn = excluded.quest_count_at_earn,
             earned_at = excluded.earned_at,
             seen_at = excluded.seen_at,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            b.id,
            b.user_id,
            b.month_key,
            i64::from(b.quest_count_at_earn),
            b.earned_at,
            b.seen_at,
            b.created_at,
            b.updated_at,
            b.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

fn ensure_motivation_settings_tx(
    conn: &Connection,
    user_id: &str,
    now_ms: i64,
) -> CoreResult<MotivationSettingsRow> {
    let existing = conn
        .query_row(
            &format!(
                "SELECT {MOTIVATION_SETTINGS_COLS} FROM motivation_settings WHERE user_id = ?1"
            ),
            params![user_id],
            map_motivation_settings,
        )
        .optional()
        .map_err(err)?;
    if let Some(mut row) = existing {
        if row.deleted_at.is_some() {
            row.deleted_at = None;
            row.updated_at = now_ms;
            upsert_motivation_settings_with_usn(conn, &row, -1)?;
        }
        return Ok(row);
    }
    let row = MotivationSettingsRow::new_default(user_id, now_ms);
    upsert_motivation_settings_with_usn(conn, &row, -1)?;
    Ok(row)
}

fn quest_counts_in_window(
    conn: &Connection,
    user_id: &str,
    start_day: i32,
    end_day: i32,
    start_ms: i64,
    end_ms: i64,
    active_days: &HashSet<i32>,
) -> CoreResult<QuestMetricCounts> {
    let (reviews, taken_ms): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(MAX(taken_ms, 0)), 0)
             FROM revlog
             WHERE id >= ?1 AND id < ?2 AND review_kind IN (0, 1, 2, 3)",
            params![start_ms, end_ms],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;

    let new_cards: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT
                r.card_id || ':' || COALESCE(
                    (SELECT MAX(f.id) FROM revlog f
                     WHERE f.card_id = r.card_id AND f.review_kind = 4 AND f.id <= r.id),
                    -1
                )
             )
             FROM revlog r
             WHERE r.id >= ?1 AND r.id < ?2
               AND r.review_kind = 0
               AND NOT EXISTS (
                   SELECT 1 FROM revlog prev
                   WHERE prev.card_id = r.card_id
                     AND prev.review_kind != 4
                     AND prev.id < ?1
                     AND prev.id > COALESCE(
                         (SELECT MAX(f.id) FROM revlog f
                          WHERE f.card_id = r.card_id AND f.review_kind = 4 AND f.id <= r.id),
                         -1
                     )
               )",
            params![start_ms, end_ms],
            |r| r.get(0),
        )
        .map_err(err)?;

    let tasks: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM tasks
             WHERE user_id = ?1
               AND deleted_at IS NULL
               AND completed_at IS NOT NULL
               AND completed_day BETWEEN ?2 AND ?3",
            params![user_id, start_day, end_day],
            |r| r.get(0),
        )
        .map_err(err)?;

    let habits: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM habit_logs
             WHERE user_id = ?1
               AND deleted_at IS NULL
               AND completed = 1
               AND status = 'logged'
               AND day_index BETWEEN ?2 AND ?3",
            params![user_id, start_day, end_day],
            |r| r.get(0),
        )
        .map_err(err)?;

    let mut xp: u64 = 0;
    let mut xp_stmt = conn
        .prepare_cached(
            "SELECT source_key, xp
             FROM progress_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL AND created_at >= ?2 AND created_at < ?3",
        )
        .map_err(err)?;
    let mut xp_rows = xp_stmt
        .query(params![user_id, start_ms, end_ms])
        .map_err(err)?;
    while let Some(r) = xp_rows.next().map_err(err)? {
        let key: String = r.get(0).map_err(err)?;
        let row_xp: i64 = r.get(1).map_err(err)?;
        if let Some(ParsedSourceKey::HabitLog { day_index, .. }) = parse_ledger_source_key(&key) {
            if day_index < start_day || day_index > end_day {
                continue;
            }
        }
        xp = xp.saturating_add(row_xp.max(0) as u64);
    }
    drop(xp_rows);
    drop(xp_stmt);

    let mut h_xp_stmt = conn
        .prepare_cached(
            "SELECT habit_id, day_index
             FROM habit_logs
             WHERE user_id = ?1 AND day_index BETWEEN ?2 AND ?3 AND deleted_at IS NULL AND completed = 1",
        )
        .map_err(err)?;
    let mut h_xp_rows = h_xp_stmt
        .query(params![user_id, start_day, end_day])
        .map_err(err)?;
    let mut l_xp_stmt = conn
        .prepare_cached(
            "SELECT xp, created_at
             FROM progress_ledger
             WHERE user_id = ?1 AND source_key = ?2 AND deleted_at IS NULL",
        )
        .map_err(err)?;
    while let Some(hr) = h_xp_rows.next().map_err(err)? {
        let habit_id: String = hr.get(0).map_err(err)?;
        let day_idx: i32 = hr.get(1).map_err(err)?;
        let key = bibalak_core::progress::habit_source_key(&habit_id, day_idx);
        if let Some((row_xp, created_at)) = l_xp_stmt
            .query_row(params![user_id, key], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            })
            .optional()
            .map_err(err)?
        {
            if created_at < start_ms || created_at >= end_ms {
                xp = xp.saturating_add(row_xp.max(0) as u64);
            }
        }
    }

    let active_days_count = (start_day..=end_day)
        .filter(|d| active_days.contains(d))
        .count() as u32;

    Ok(QuestMetricCounts {
        reviews: reviews.max(0) as u32,
        minutes: u32::try_from((taken_ms.max(0)) / 60_000).unwrap_or(u32::MAX),
        new_cards: new_cards.max(0) as u32,
        tasks: tasks.max(0) as u32,
        habits: habits.max(0) as u32,
        xp,
        active_days: active_days_count,
    })
}

fn monthly_daily_quest_count(
    conn: &Connection,
    user_id: &str,
    month_key: &str,
    created_day: i64,
) -> CoreResult<u32> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT source_key
             FROM progress_ledger
             WHERE user_id = ?1 AND +deleted_at IS NULL
               AND source_key >= 'quest_daily:' AND source_key < 'quest_daily;'",
        )
        .map_err(err)?;
    let mut rows = stmt.query(params![user_id]).map_err(err)?;
    let mut count = 0_u32;
    while let Some(r) = rows.next().map_err(err)? {
        let key: String = r.get(0).map_err(err)?;
        if let Some(ParsedSourceKey::QuestDaily { day_index, .. }) = parse_ledger_source_key(&key) {
            if month_key_for_day(day_index, created_day) == month_key {
                count = count.saturating_add(1);
            }
        }
    }
    Ok(count)
}

fn parse_study_ledger_day(
    key: &str,
    created_at: i64,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_day: i64,
) -> Option<i32> {
    match parse_ledger_source_key(key) {
        Some(ParsedSourceKey::CardReview { day_index, .. })
        | Some(ParsedSourceKey::HabitLog { day_index, .. }) => Some(day_index),
        Some(ParsedSourceKey::TaskDone { .. }) => {
            Some(day_index_for_ms(created_at, tz_offset_minutes, rollover_hour, created_day) as i32)
        }
        Some(ParsedSourceKey::QuestDaily { .. })
        | Some(ParsedSourceKey::QuestWeekly { .. })
        | Some(ParsedSourceKey::ComebackBonus { .. })
        | Some(ParsedSourceKey::MonthlyBadge { .. })
        | None => None,
    }
}

fn prev_active_day_before(
    conn: &Connection,
    user_id: &str,
    today: i32,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_day: i64,
    day_zero_start_ms: i64,
) -> CoreResult<Option<i32>> {
    // B-tree skip scan over `idx_progress_ledger_active_created (user_id, deleted_at, created_at)`,
    // jumping past each visited day once a study row for that day is seen, while keeping a 1-day
    // cushion for back-logged habits whose `created_at` falls on `day + 1`.
    let mut cursor_ms = day_zero_start_ms + i64::from(today + 1) * MS_PER_DAY;
    let mut best_day: Option<i32> = None;
    let mut stop_before_ms: Option<i64> = None;
    let mut next_stmt = conn
        .prepare_cached(
            "SELECT source_key, created_at
             FROM progress_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL AND created_at < ?2
             ORDER BY created_at DESC
             LIMIT 1",
        )
        .map_err(err)?;
    let mut same_ts_stmt = conn
        .prepare_cached(
            "SELECT source_key
             FROM progress_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL AND created_at = ?2",
        )
        .map_err(err)?;

    while stop_before_ms.is_none_or(|cutoff| cursor_ms > cutoff) {
        let Some((key, created_at)) = next_stmt
            .query_row(params![user_id, cursor_ms], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })
            .optional()
            .map_err(err)?
        else {
            break;
        };
        if let Some(cutoff) = stop_before_ms {
            if created_at < cutoff {
                break;
            }
        }
        let created_day_idx =
            day_index_for_ms(created_at, tz_offset_minutes, rollover_hour, created_day) as i32;
        let parsed = parse_study_ledger_day(
            &key,
            created_at,
            tz_offset_minutes,
            rollover_hour,
            created_day,
        );
        if let Some(day) = parsed {
            if day < today && best_day.is_none_or(|b| day > b) {
                best_day = Some(day);
                stop_before_ms = Some(day_zero_start_ms + i64::from(day - 1) * MS_PER_DAY);
            }
            if day == created_day_idx {
                cursor_ms = day_zero_start_ms + i64::from(created_day_idx) * MS_PER_DAY;
                continue;
            }
        }

        // Check any sibling rows sharing the exact `created_at` timestamp before stepping below it.
        let mut jump_to_day_start = false;
        let mut same_rows = same_ts_stmt
            .query(params![user_id, created_at])
            .map_err(err)?;
        while let Some(sr) = same_rows.next().map_err(err)? {
            let skey: String = sr.get(0).map_err(err)?;
            if let Some(day) = parse_study_ledger_day(
                &skey,
                created_at,
                tz_offset_minutes,
                rollover_hour,
                created_day,
            ) {
                if day < today && best_day.is_none_or(|b| day > b) {
                    best_day = Some(day);
                    stop_before_ms = Some(day_zero_start_ms + i64::from(day - 1) * MS_PER_DAY);
                }
                if day == created_day_idx {
                    jump_to_day_start = true;
                }
            }
        }
        cursor_ms = if jump_to_day_start {
            day_zero_start_ms + i64::from(created_day_idx) * MS_PER_DAY
        } else {
            created_at
        };
    }
    Ok(best_day)
}

#[allow(clippy::too_many_arguments)]
fn eval_quest_completed_bounded(
    conn: &Connection,
    user_id: &str,
    tpl: QuestTemplate,
    start_day: i32,
    end_day: i32,
    start_ms: i64,
    end_ms: i64,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_day: i64,
) -> CoreResult<bool> {
    let target = i64::from(tpl.target);
    match tpl.metric {
        QuestMetric::Reviews => {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM (
                        SELECT 1 FROM revlog
                        WHERE id >= ?1 AND id < ?2 AND review_kind IN (0, 1, 2, 3)
                        LIMIT ?3
                     )",
                    params![start_ms, end_ms, target],
                    |r| r.get(0),
                )
                .map_err(err)?;
            Ok(count >= target)
        }
        QuestMetric::Minutes => {
            let target_ms = i64::from(tpl.target).saturating_mul(60_000);
            let mut stmt = conn
                .prepare_cached(
                    "SELECT taken_ms FROM revlog
                     WHERE id >= ?1 AND id < ?2 AND review_kind IN (0, 1, 2, 3)",
                )
                .map_err(err)?;
            let mut rows = stmt.query(params![start_ms, end_ms]).map_err(err)?;
            let mut total_ms = 0_i64;
            while let Some(r) = rows.next().map_err(err)? {
                let t: i64 = r.get(0).map_err(err)?;
                total_ms = total_ms.saturating_add(t.max(0));
                if total_ms >= target_ms {
                    return Ok(true);
                }
            }
            Ok(false)
        }
        QuestMetric::NewCards => {
            let mut stmt = conn
                .prepare_cached(
                    "SELECT r.card_id,
                            COALESCE(
                                (SELECT MAX(f.id) FROM revlog f
                                 WHERE f.card_id = r.card_id AND f.review_kind = 4 AND f.id <= r.id),
                                -1
                            ) AS reset_id
                     FROM revlog r
                     WHERE r.id >= ?1 AND r.id < ?2 AND r.review_kind = 0",
                )
                .map_err(err)?;
            let mut prev_stmt = conn
                .prepare_cached(
                    "SELECT 1 FROM revlog
                     WHERE card_id = ?1 AND review_kind != 4 AND id < ?2 AND id > ?3
                     LIMIT 1",
                )
                .map_err(err)?;
            let mut rows = stmt.query(params![start_ms, end_ms]).map_err(err)?;
            let mut seen_new = HashSet::new();
            while let Some(r) = rows.next().map_err(err)? {
                let cid: i64 = r.get(0).map_err(err)?;
                let reset_id: i64 = r.get(1).map_err(err)?;
                let key = (cid, reset_id);
                if seen_new.contains(&key) {
                    continue;
                }
                let has_prev = prev_stmt
                    .query_row(params![cid, start_ms, reset_id], |_| Ok(()))
                    .optional()
                    .map_err(err)?
                    .is_some();
                if !has_prev {
                    seen_new.insert(key);
                    if seen_new.len() >= tpl.target as usize {
                        return Ok(true);
                    }
                }
            }
            Ok(false)
        }
        QuestMetric::Tasks => {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM tasks
                     WHERE user_id = ?1 AND deleted_at IS NULL AND completed_at IS NOT NULL
                       AND completed_day BETWEEN ?2 AND ?3",
                    params![user_id, start_day, end_day],
                    |r| r.get(0),
                )
                .map_err(err)?;
            Ok(count >= target)
        }
        QuestMetric::Habits => {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM habit_logs
                     WHERE user_id = ?1 AND deleted_at IS NULL AND completed = 1 AND status = 'logged'
                       AND day_index BETWEEN ?2 AND ?3",
                    params![user_id, start_day, end_day],
                    |r| r.get(0),
                )
                .map_err(err)?;
            Ok(count >= target)
        }
        QuestMetric::TasksOrHabits => {
            let tasks: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM tasks
                     WHERE user_id = ?1 AND deleted_at IS NULL AND completed_at IS NOT NULL
                       AND completed_day BETWEEN ?2 AND ?3",
                    params![user_id, start_day, end_day],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if tasks >= target {
                return Ok(true);
            }
            let habits: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM habit_logs
                     WHERE user_id = ?1 AND deleted_at IS NULL AND completed = 1 AND status = 'logged'
                       AND day_index BETWEEN ?2 AND ?3",
                    params![user_id, start_day, end_day],
                    |r| r.get(0),
                )
                .map_err(err)?;
            Ok(tasks.saturating_add(habits) >= target)
        }
        QuestMetric::Xp => {
            let mut stmt = conn
                .prepare_cached(
                    "SELECT xp FROM progress_ledger
                     WHERE user_id = ?1 AND deleted_at IS NULL AND created_at >= ?2 AND created_at < ?3",
                )
                .map_err(err)?;
            let mut rows = stmt
                .query(params![user_id, start_ms, end_ms])
                .map_err(err)?;
            let mut total_xp = 0_i64;
            while let Some(r) = rows.next().map_err(err)? {
                let xp: i64 = r.get(0).map_err(err)?;
                total_xp = total_xp.saturating_add(xp.max(0));
                if total_xp >= target {
                    return Ok(true);
                }
            }
            Ok(false)
        }
        QuestMetric::ActiveDays => {
            let day_zero_start_ms = start_ms - i64::from(start_day) * MS_PER_DAY;
            let mut cursor_ms = start_ms - MS_PER_DAY;
            let upper_ms = end_ms + MS_PER_DAY;
            let mut stmt = conn
                .prepare_cached(
                    "SELECT created_at, source_key FROM progress_ledger
                     WHERE user_id = ?1 AND deleted_at IS NULL AND created_at >= ?2 AND created_at < ?3
                     ORDER BY created_at ASC
                     LIMIT 1",
                )
                .map_err(err)?;
            let mut days = HashSet::new();
            while let Some((created_at, key)) = stmt
                .query_row(params![user_id, cursor_ms, upper_ms], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
                })
                .optional()
                .map_err(err)?
            {
                let created_day_idx =
                    day_index_for_ms(created_at, tz_offset_minutes, rollover_hour, created_day)
                        as i32;
                let parsed_day = match parse_ledger_source_key(&key) {
                    Some(ParsedSourceKey::CardReview { day_index, .. })
                    | Some(ParsedSourceKey::HabitLog { day_index, .. }) => Some(day_index),
                    Some(ParsedSourceKey::TaskDone { .. }) => Some(created_day_idx),
                    _ => None,
                };
                if let Some(d) = parsed_day {
                    if d >= start_day && d <= end_day {
                        days.insert(d);
                        if days.len() >= tpl.target as usize {
                            return Ok(true);
                        }
                    }
                    cursor_ms = if d == created_day_idx {
                        day_zero_start_ms + i64::from(created_day_idx + 1) * MS_PER_DAY
                    } else {
                        created_at.saturating_add(1)
                    };
                } else {
                    cursor_ms = created_at.saturating_add(1);
                }
            }
            Ok(false)
        }
    }
}

fn upsert_motivation_ledger_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    source_key: &str,
    gold_cents: i64,
    now_ms: i64,
) -> CoreResult<bool> {
    let existing: Option<Option<i64>> = tx
        .query_row(
            "SELECT deleted_at FROM progress_ledger WHERE user_id = ?1 AND source_key = ?2",
            params![user_id, source_key],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    match existing {
        None => {
            let id = ledger_id(user_id, source_key);
            tx.execute(
                "INSERT INTO progress_ledger
                 (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
                 VALUES (?1, ?2, ?3, 0, ?4, ?5, ?5, NULL, -1)",
                params![id, user_id, source_key, gold_cents, now_ms],
            )
            .map_err(err)?;
            Ok(true)
        }
        Some(Some(_deleted_at)) => {
            tx.execute(
                "UPDATE progress_ledger
                 SET xp = 0, gold_cents = ?1, created_at = ?2, updated_at = ?2, deleted_at = NULL, usn = -1
                 WHERE user_id = ?3 AND source_key = ?4",
                params![gold_cents, now_ms, user_id, source_key],
            )
            .map_err(err)?;
            Ok(true)
        }
        Some(None) => Ok(false),
    }
}

fn soft_revoke_motivation_ledger_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    source_key: &str,
    now_ms: i64,
) -> CoreResult<bool> {
    let rows = tx
        .execute(
            "UPDATE progress_ledger
             SET deleted_at = ?1, updated_at = ?1, usn = -1
             WHERE user_id = ?2 AND source_key = ?3 AND deleted_at IS NULL",
            params![now_ms, user_id, source_key],
        )
        .map_err(err)?;
    Ok(rows > 0)
}

fn day_windows(
    today: i32,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
) -> (i64, i64, i64, i64) {
    let created_day = created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
    let tz_off_ms = i64::from(tz_offset_minutes) * 60_000;
    let rollover_ms = i64::from(rollover_hour) * 3_600_000;
    let day_zero_start_ms = created_day * MS_PER_DAY + rollover_ms - tz_off_ms;
    let today_start_ms = day_zero_start_ms + i64::from(today) * MS_PER_DAY;
    let today_end_ms = today_start_ms + MS_PER_DAY;
    (created_day, day_zero_start_ms, today_start_ms, today_end_ms)
}

// ── Public Storage Operations ────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub fn get_motivation_state(
    conn: &mut Connection,
    user_id: &str,
    today: i32,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
    now_ms: i64,
    allow_auto_freeze: bool,
) -> CoreResult<MotivationStateDto> {
    let tx = conn.transaction().map_err(err)?;
    let mut settings = ensure_motivation_settings_tx(&tx, user_id, now_ms)?;
    let active_days =
        active_ledger_days(&tx, user_id, tz_offset_minutes, rollover_hour, created_ms)?;
    let mut frozen_days = frozen_study_days(&tx, user_id)?;

    let prev_active_day = active_days.iter().copied().filter(|&d| d < today).max();
    if evaluate_comeback_on_load(&mut settings, prev_active_day, today, now_ms) {
        upsert_motivation_settings_with_usn(&tx, &settings, -1)?;
    }

    let mut auto_frozen_day = None;
    if allow_auto_freeze {
        let held = freeze_tokens_held(&tx, user_id)?;
        if let Some(gap_day) = should_auto_freeze_study_gap(&active_days, &frozen_days, today, held)
        {
            let key = study_freeze_source_key(gap_day);
            if upsert_freeze_entry_tx(&tx, user_id, &key, -1, now_ms)? {
                frozen_days.insert(gap_day);
                auto_frozen_day = Some(gap_day);
            }
        }
    }

    let (created_day, day_zero_start_ms, today_start_ms, today_end_ms) =
        day_windows(today, tz_offset_minutes, rollover_hour, created_ms);
    let daily_counts = quest_counts_in_window(
        &tx,
        user_id,
        today,
        today,
        today_start_ms,
        today_end_ms,
        &active_days,
    )?;
    let daily_quests = daily_quests_for_day(today)
        .into_iter()
        .map(|tpl| build_quest_dto(tpl, QuestKind::Daily, &daily_counts))
        .collect();

    let (week_index, week_start_day, week_end_day) =
        bibalak_core::motivation::iso_week_bounds(today, created_day);
    let week_start_ms = day_zero_start_ms + i64::from(week_start_day) * MS_PER_DAY;
    let week_end_ms = day_zero_start_ms + i64::from(week_end_day + 1) * MS_PER_DAY;
    let weekly_counts = quest_counts_in_window(
        &tx,
        user_id,
        week_start_day,
        week_end_day,
        week_start_ms,
        week_end_ms,
        &active_days,
    )?;
    let weekly_quest = build_quest_dto(
        weekly_quest_for_week(week_index),
        QuestKind::Weekly,
        &weekly_counts,
    );

    let month_key = month_key_for_day(today, created_day);
    let completed_daily_quests = monthly_daily_quest_count(&tx, user_id, &month_key, created_day)?;

    let mut badge_stmt = tx
        .prepare(&format!(
            "SELECT {MONTHLY_BADGE_COLS} FROM monthly_badges
             WHERE user_id = ?1 AND deleted_at IS NULL
             ORDER BY month_key DESC"
        ))
        .map_err(err)?;
    let badges: Vec<MonthlyBadgeRow> = badge_stmt
        .query_map(params![user_id], map_monthly_badge)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    drop(badge_stmt);

    let current_badge = badges.iter().find(|b| b.month_key == month_key);
    let monthly_badge = MonthlyBadgeStatusDto {
        month_key,
        completed_daily_quests,
        target_daily_quests: MONTHLY_BADGE_TARGET_QUESTS,
        earned: current_badge.is_some(),
        earned_at: current_badge.map(|b| b.earned_at),
        seen: current_badge.is_some_and(|b| b.seen_at.is_some()),
        reward_gold_cents: MONTHLY_BADGE_GOLD_CENTS,
    };
    let earned_monthly_badges = badges
        .iter()
        .map(|b| EarnedMonthlyBadgeDto {
            month_key: b.month_key.clone(),
            quest_count_at_earn: b.quest_count_at_earn,
            earned_at: b.earned_at,
            seen: b.seen_at.is_some(),
        })
        .collect();

    let (current_streak, studied_today, best_streak) =
        compute_streak_pair(&active_days, &frozen_days, today);
    let prev_before_return = settings
        .comeback_return_day
        .and_then(|rd| active_days.iter().copied().filter(|&d| d < rd).max());
    let comeback_offer = active_comeback_offer(&settings, prev_before_return, today);

    tx.commit().map_err(err)?;

    Ok(MotivationStateDto {
        daily_goal_xp: settings.daily_goal_xp,
        today_xp: daily_counts.xp,
        goal_met_today: daily_counts.xp >= u64::from(settings.daily_goal_xp),
        current_streak,
        best_streak,
        studied_today,
        next_milestone: next_streak_milestone(current_streak),
        today_day_index: today,
        today_date: epoch_days_to_date_string(created_day + i64::from(today)),
        days_remaining_in_week: (week_end_day - today).max(0) as u32,
        daily_quests,
        weekly_quest,
        monthly_badge,
        earned_monthly_badges,
        comeback_offer,
        onboarding_completed: settings.onboarding_completed_at.is_some(),
        auto_frozen_day,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn reconcile_motivation(
    conn: &mut Connection,
    user_id: &str,
    today: i32,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
    now_ms: i64,
    allow_comeback_revoke: bool,
) -> CoreResult<bool> {
    let tx = conn.transaction().map_err(err)?;
    let mut changed = false;
    let mut settings = ensure_motivation_settings_tx(&tx, user_id, now_ms)?;
    let (created_day, day_zero_start_ms, today_start_ms, today_end_ms) =
        day_windows(today, tz_offset_minutes, rollover_hour, created_ms);

    if settings.comeback_return_day != Some(today) {
        let prev_active_day = prev_active_day_before(
            &tx,
            user_id,
            today,
            tz_offset_minutes,
            rollover_hour,
            created_day,
            day_zero_start_ms,
        )?;
        if evaluate_comeback_on_load(&mut settings, prev_active_day, today, now_ms) {
            upsert_motivation_settings_with_usn(&tx, &settings, -1)?;
            changed = true;
        }
    }

    let daily_tpls = daily_quests_for_day(today);
    let daily_keys: [String; 3] = [
        daily_quest_source_key(today, daily_tpls[0].id),
        daily_quest_source_key(today, daily_tpls[1].id),
        daily_quest_source_key(today, daily_tpls[2].id),
    ];
    let (week_index, week_start_day, week_end_day) =
        bibalak_core::motivation::iso_week_bounds(today, created_day);
    let weekly_tpl = weekly_quest_for_week(week_index);
    let weekly_key = weekly_quest_source_key(week_index, weekly_tpl.id);

    let mut active_quest_keys = HashSet::new();
    {
        let mut qstmt = tx
            .prepare_cached(
                "SELECT source_key FROM progress_ledger
                 WHERE user_id = ?1 AND +deleted_at IS NULL AND source_key IN (?2, ?3, ?4, ?5)",
            )
            .map_err(err)?;
        let mut qrows = qstmt
            .query(params![
                user_id,
                daily_keys[0],
                daily_keys[1],
                daily_keys[2],
                weekly_key
            ])
            .map_err(err)?;
        while let Some(r) = qrows.next().map_err(err)? {
            active_quest_keys.insert(r.get::<_, String>(0).map_err(err)?);
        }
    }

    let mut daily_quest_activated = false;
    for (tpl, key) in daily_tpls.iter().zip(daily_keys.iter()) {
        if !allow_comeback_revoke && active_quest_keys.contains(key) {
            continue;
        }
        let completed = eval_quest_completed_bounded(
            &tx,
            user_id,
            *tpl,
            today,
            today,
            today_start_ms,
            today_end_ms,
            tz_offset_minutes,
            rollover_hour,
            created_day,
        )?;
        if completed {
            if upsert_motivation_ledger_tx(
                &tx,
                user_id,
                key,
                DAILY_QUEST_GOLD_CENTS as i64,
                now_ms,
            )? {
                changed = true;
                daily_quest_activated = true;
            }
        } else if soft_revoke_motivation_ledger_tx(&tx, user_id, key, now_ms)? {
            changed = true;
        }
    }

    if allow_comeback_revoke || !active_quest_keys.contains(&weekly_key) {
        let week_start_ms = day_zero_start_ms + i64::from(week_start_day) * MS_PER_DAY;
        let week_end_ms = day_zero_start_ms + i64::from(week_end_day + 1) * MS_PER_DAY;
        let completed = eval_quest_completed_bounded(
            &tx,
            user_id,
            weekly_tpl,
            week_start_day,
            week_end_day,
            week_start_ms,
            week_end_ms,
            tz_offset_minutes,
            rollover_hour,
            created_day,
        )?;
        if completed {
            if upsert_motivation_ledger_tx(
                &tx,
                user_id,
                &weekly_key,
                WEEKLY_QUEST_GOLD_CENTS as i64,
                now_ms,
            )? {
                changed = true;
            }
        } else if soft_revoke_motivation_ledger_tx(&tx, user_id, &weekly_key, now_ms)? {
            changed = true;
        }
    }

    // Comeback bonus (only query today's XP if eligible or checking revoke).
    let eligible_for_award = is_comeback_reward_eligible(&settings, today);
    let can_revoke_award = allow_comeback_revoke && settings.comeback_awarded_day == Some(today);
    if eligible_for_award || can_revoke_award {
        let today_xp: i64 = tx
            .query_row(
                "SELECT COALESCE(SUM(xp), 0)
                 FROM progress_ledger
                 WHERE user_id = ?1 AND deleted_at IS NULL AND created_at >= ?2 AND created_at < ?3",
                params![user_id, today_start_ms, today_end_ms],
                |r| r.get(0),
            )
            .map_err(err)?;
        let comeback_key = comeback_bonus_source_key(today);
        if eligible_for_award && today_xp.max(0) as u64 >= u64::from(settings.daily_goal_xp) {
            let _ = upsert_motivation_ledger_tx(
                &tx,
                user_id,
                &comeback_key,
                COMEBACK_BONUS_GOLD_CENTS as i64,
                now_ms,
            )?;
            settings.comeback_awarded_return_day = settings.comeback_return_day;
            settings.comeback_awarded_day = Some(today);
            settings.updated_at = now_ms;
            upsert_motivation_settings_with_usn(&tx, &settings, -1)?;
            changed = true;
        } else if can_revoke_award && (today_xp.max(0) as u64) < u64::from(settings.daily_goal_xp) {
            let _ = soft_revoke_motivation_ledger_tx(&tx, user_id, &comeback_key, now_ms)?;
            settings.comeback_awarded_return_day = None;
            settings.comeback_awarded_day = None;
            settings.updated_at = now_ms;
            upsert_motivation_settings_with_usn(&tx, &settings, -1)?;
            changed = true;
        }
    }

    // Monthly badge (monotonic): only check when a daily quest was newly activated.
    if daily_quest_activated {
        let month_key = month_key_for_day(today, created_day);
        let existing_badge: Option<MonthlyBadgeRow> = tx
            .query_row(
                &format!(
                    "SELECT {MONTHLY_BADGE_COLS} FROM monthly_badges
                     WHERE user_id = ?1 AND month_key = ?2"
                ),
                params![user_id, month_key],
                map_monthly_badge,
            )
            .optional()
            .map_err(err)?;
        let should_check_badge = existing_badge
            .as_ref()
            .is_none_or(|b| b.deleted_at.is_some());
        if should_check_badge {
            let monthly_done = monthly_daily_quest_count(&tx, user_id, &month_key, created_day)?;
            if monthly_done >= MONTHLY_BADGE_TARGET_QUESTS {
                let row = match existing_badge {
                    Some(mut b) => {
                        b.deleted_at = None;
                        b.updated_at = now_ms;
                        b.usn = -1;
                        b
                    }
                    None => MonthlyBadgeRow {
                        id: monthly_badge_id(user_id, &month_key),
                        user_id: user_id.to_string(),
                        month_key: month_key.clone(),
                        quest_count_at_earn: monthly_done,
                        earned_at: now_ms,
                        seen_at: None,
                        created_at: now_ms,
                        updated_at: now_ms,
                        deleted_at: None,
                        usn: -1,
                    },
                };
                upsert_monthly_badge_with_usn(&tx, &row, -1)?;
                let badge_key = monthly_badge_source_key(&month_key);
                upsert_motivation_ledger_tx(
                    &tx,
                    user_id,
                    &badge_key,
                    MONTHLY_BADGE_GOLD_CENTS as i64,
                    now_ms,
                )?;
                changed = true;
            }
        }
    }

    tx.commit().map_err(err)?;
    Ok(changed)
}

pub fn set_daily_goal(
    conn: &Connection,
    user_id: &str,
    goal_xp: u32,
    now_ms: i64,
) -> CoreResult<()> {
    let valid_goal = validate_daily_goal_xp(goal_xp)?;
    let mut settings = ensure_motivation_settings_tx(conn, user_id, now_ms)?;
    settings.daily_goal_xp = valid_goal;
    settings.updated_at = now_ms;
    upsert_motivation_settings_with_usn(conn, &settings, -1)
}

pub fn dismiss_comeback_offer(conn: &Connection, user_id: &str, now_ms: i64) -> CoreResult<()> {
    let mut settings = ensure_motivation_settings_tx(conn, user_id, now_ms)?;
    if settings.comeback_return_day.is_some() {
        settings.comeback_dismissed_day = settings.comeback_return_day;
        settings.updated_at = now_ms;
        upsert_motivation_settings_with_usn(conn, &settings, -1)?;
    }
    Ok(())
}

pub fn complete_onboarding(conn: &Connection, user_id: &str, now_ms: i64) -> CoreResult<()> {
    let mut settings = ensure_motivation_settings_tx(conn, user_id, now_ms)?;
    if settings.onboarding_completed_at.is_none() {
        settings.onboarding_completed_at = Some(now_ms);
        settings.updated_at = now_ms;
        upsert_motivation_settings_with_usn(conn, &settings, -1)?;
    }
    Ok(())
}

pub fn mark_monthly_badge_seen(
    conn: &Connection,
    user_id: &str,
    month_key: &str,
    now_ms: i64,
) -> CoreResult<()> {
    conn.execute(
        "UPDATE monthly_badges
         SET seen_at = COALESCE(seen_at, ?1), updated_at = ?1, usn = -1
         WHERE user_id = ?2 AND month_key = ?3 AND deleted_at IS NULL",
        params![now_ms, user_id, month_key],
    )
    .map_err(err)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn freeze_study_day(
    conn: &mut Connection,
    user_id: &str,
    day_index: i32,
    today: i32,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
    now_ms: i64,
) -> CoreResult<bool> {
    if day_index != today - 1 && day_index != today - 2 {
        return Err(CoreError::Invalid(
            "study streak freeze is only allowed for yesterday or two days ago".into(),
        ));
    }
    let tx = conn.transaction().map_err(err)?;
    let active_days =
        active_ledger_days(&tx, user_id, tz_offset_minutes, rollover_hour, created_ms)?;
    if active_days.contains(&day_index) {
        return Err(CoreError::Invalid(
            "cannot freeze an already active study day".into(),
        ));
    }
    let frozen_days = frozen_study_days(&tx, user_id)?;
    if frozen_days.contains(&day_index) {
        tx.commit().map_err(err)?;
        return Ok(false);
    }
    if freeze_tokens_held(&tx, user_id)? < 1 {
        return Err(CoreError::Invalid(
            "no streak freeze tokens available".into(),
        ));
    }
    let key = study_freeze_source_key(day_index);
    let consumed = upsert_freeze_entry_tx(&tx, user_id, &key, -1, now_ms)?;
    tx.commit().map_err(err)?;
    Ok(consumed)
}

#[allow(clippy::too_many_arguments)]
pub fn get_streak_calendar(
    conn: &Connection,
    user_id: &str,
    year: i32,
    month: u8,
    today: i32,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
) -> CoreResult<StreakCalendarDto> {
    let (created_day, day_zero_start_ms, _, _) =
        day_windows(today, tz_offset_minutes, rollover_hour, created_ms);
    let month_days = month_day_range(year, month, created_day)?;
    let min_day = month_days.first().map_or(0, |d| d.0);
    let max_day = month_days.last().map_or(0, |d| d.0);
    let range_start_ms = day_zero_start_ms + i64::from(min_day) * MS_PER_DAY;
    let range_end_ms = day_zero_start_ms + i64::from(max_day + 1) * MS_PER_DAY;

    let active_days =
        active_ledger_days(conn, user_id, tz_offset_minutes, rollover_hour, created_ms)?;
    let frozen_days = frozen_study_days(conn, user_id)?;
    let (current_streak, studied_today, best_streak) =
        compute_streak_pair(&active_days, &frozen_days, today);
    let freeze_tokens_held = freeze_tokens_held(conn, user_id)?;

    let daily_goal_xp: u32 = conn
        .query_row(
            "SELECT daily_goal_xp FROM motivation_settings WHERE user_id = ?1 AND deleted_at IS NULL",
            params![user_id],
            |r| r.get::<_, i64>(0),
        )
        .optional()
        .map_err(err)?
        .and_then(|v| u32::try_from(v.max(0)).ok())
        .unwrap_or(bibalak_core::motivation::DEFAULT_DAILY_GOAL_XP);

    let mut reviews_by_day: HashMap<i32, u32> = HashMap::new();
    let mut rev_stmt = conn
        .prepare(
            "SELECT id FROM revlog
             WHERE id >= ?1 AND id < ?2 AND review_kind IN (0, 1, 2, 3)",
        )
        .map_err(err)?;
    let mut rev_rows = rev_stmt
        .query(params![range_start_ms, range_end_ms])
        .map_err(err)?;
    while let Some(r) = rev_rows.next().map_err(err)? {
        let id: i64 = r.get(0).map_err(err)?;
        let d = day_index_for_ms(id, tz_offset_minutes, rollover_hour, created_day) as i32;
        *reviews_by_day.entry(d).or_insert(0) += 1;
    }

    let mut tasks_by_day: HashMap<i32, u32> = HashMap::new();
    let mut t_stmt = conn
        .prepare(
            "SELECT completed_day, COUNT(*)
             FROM tasks
             WHERE user_id = ?1 AND deleted_at IS NULL AND completed_at IS NOT NULL
               AND completed_day BETWEEN ?2 AND ?3
             GROUP BY completed_day",
        )
        .map_err(err)?;
    for row in t_stmt
        .query_map(params![user_id, min_day, max_day], |r| {
            Ok((r.get::<_, i32>(0)?, r.get::<_, i64>(1)?))
        })
        .map_err(err)?
    {
        let (d, cnt) = row.map_err(err)?;
        tasks_by_day.insert(d, cnt.max(0) as u32);
    }

    let mut habits_by_day: HashMap<i32, u32> = HashMap::new();
    let mut h_stmt = conn
        .prepare(
            "SELECT day_index, COUNT(*)
             FROM habit_logs
             WHERE user_id = ?1 AND deleted_at IS NULL AND completed = 1 AND status = 'logged'
               AND day_index BETWEEN ?2 AND ?3
             GROUP BY day_index",
        )
        .map_err(err)?;
    for row in h_stmt
        .query_map(params![user_id, min_day, max_day], |r| {
            Ok((r.get::<_, i32>(0)?, r.get::<_, i64>(1)?))
        })
        .map_err(err)?
    {
        let (d, cnt) = row.map_err(err)?;
        habits_by_day.insert(d, cnt.max(0) as u32);
    }

    let mut xp_by_day: HashMap<i32, u64> = HashMap::new();
    let mut l_stmt = conn
        .prepare(
            "SELECT source_key, xp, created_at
             FROM progress_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL",
        )
        .map_err(err)?;
    let mut l_rows = l_stmt.query(params![user_id]).map_err(err)?;
    while let Some(r) = l_rows.next().map_err(err)? {
        let key: String = r.get(0).map_err(err)?;
        let xp: i64 = r.get(1).map_err(err)?;
        let created_at: i64 = r.get(2).map_err(err)?;
        let d = match parse_ledger_source_key(&key) {
            Some(ParsedSourceKey::CardReview { day_index, .. })
            | Some(ParsedSourceKey::HabitLog { day_index, .. }) => day_index,
            Some(ParsedSourceKey::TaskDone { .. }) => {
                day_index_for_ms(created_at, tz_offset_minutes, rollover_hour, created_day) as i32
            }
            _ => continue,
        };
        if d >= min_day && d <= max_day {
            *xp_by_day.entry(d).or_insert(0) += xp.max(0) as u64;
        }
    }

    let days = month_days
        .into_iter()
        .map(|(day_index, date, day_of_month)| {
            let studied = active_days.contains(&day_index);
            let xp = xp_by_day.get(&day_index).copied().unwrap_or(0);
            StreakCalendarDayDto {
                day_index,
                date,
                day_of_month,
                is_future: day_index > today,
                studied,
                goal_met: studied && xp >= u64::from(daily_goal_xp),
                frozen: frozen_days.contains(&day_index),
                xp,
                reviews: reviews_by_day.get(&day_index).copied().unwrap_or(0),
                tasks_completed: tasks_by_day.get(&day_index).copied().unwrap_or(0),
                habits_completed: habits_by_day.get(&day_index).copied().unwrap_or(0),
            }
        })
        .collect();

    Ok(StreakCalendarDto {
        year,
        month,
        today_day_index: today,
        today_date: epoch_days_to_date_string(created_day + i64::from(today)),
        daily_goal_xp,
        current_streak,
        best_streak,
        studied_today,
        next_milestone: next_streak_milestone(current_streak),
        milestones: build_streak_milestones(current_streak, best_streak),
        freeze_tokens_held,
        freeze_token_cap: bibalak_core::game::FREEZE_TOKEN_CAP,
        can_freeze_day: can_manual_freeze_day(
            &active_days,
            &frozen_days,
            today,
            freeze_tokens_held,
        ),
        days,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use bibalak_core::model::Revlog;
    use bibalak_core::motivation::{
        comeback_bonus_source_key, daily_quest_source_key, daily_quests_for_day,
        monthly_badge_source_key, COMEBACK_BONUS_GOLD_CENTS, DAILY_QUEST_GOLD_CENTS,
        MONTHLY_BADGE_GOLD_CENTS, MONTHLY_BADGE_TARGET_QUESTS,
    };
    use bibalak_core::ports::TestClock;
    use bibalak_core::productivity::{TaskInput, TaskPriority};
    use bibalak_core::progress::{ledger_id, NIL_USER_ID};
    use bibalak_core::scheduling::{CardPhase, CardState};
    use bibalak_core::Collection;

    use crate::SqliteStorage;

    const DAY_MS: i64 = 86_400_000;
    const BASE_MS: i64 = 1_794_601_800_000; // 2026-11-13

    fn setup_collection() -> (Collection, Arc<TestClock>, i64, i64) {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let clock = Arc::new(TestClock::new(BASE_MS));
        let col = Collection::new(Box::new(storage), clock.clone()).unwrap();
        let nt_id = col.list_notetypes().unwrap()[0].id;
        let added = col
            .add_note(nt_id, 1, &["Front".into(), "Back".into()], &[])
            .unwrap();
        let card_id = col.next_card(1).unwrap().unwrap().id;
        (col, clock, added.note_id, card_id)
    }

    fn answer_card(col: &Collection, card_id: i64, note_id: i64, now_ms: i64) {
        let prev = CardState::new(2500);
        let next = CardState {
            phase: CardPhase::Review,
            interval_days: 1,
            reps: 1,
            ..prev
        };
        let log = Revlog {
            id: now_ms,
            card_id,
            usn: -1,
            ease: 3,
            interval: 1,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 2_000,
            review_kind: 0,
        };
        col.apply_answer(card_id, note_id, &prev, 0, &next, 1, &log, 8)
            .unwrap();
    }

    #[test]
    fn sqlite_quest_reward_revokes_on_undo_and_reawards_in_place() {
        let (col, clock, _, _) = setup_collection();
        let off = (0..=10)
            .find(|&d| daily_quests_for_day(d)[2].id == "tasks_2")
            .expect("days 0..=10 must include a tasks_2 day");
        let day_ms = BASE_MS + i64::from(off) * DAY_MS;
        clock.set(day_ms);
        let t1 = col
            .create_task(TaskInput {
                list_id: None,
                title: "Task 1".into(),
                notes: "".into(),
                priority: TaskPriority::None,
                due_date: None,
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                manual_quadrant: None,
                sort_order: 0,
            })
            .unwrap();
        let t2 = col
            .create_task(TaskInput {
                list_id: None,
                title: "Task 2".into(),
                notes: "".into(),
                priority: TaskPriority::None,
                due_date: None,
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                manual_quadrant: None,
                sort_order: 0,
            })
            .unwrap();

        col.complete_task(&t1.id).unwrap();
        clock.set(day_ms + 1_000);
        col.complete_task(&t2.id).unwrap();
        assert_eq!(
            col.progress_summary().unwrap().gold_cents,
            200 + DAILY_QUEST_GOLD_CENTS
        );

        clock.set(day_ms + 2_000);
        col.undo().unwrap();
        assert_eq!(col.progress_summary().unwrap().gold_cents, 100);

        clock.set(day_ms + 3_000);
        col.complete_task(&t2.id).unwrap();
        assert_eq!(
            col.progress_summary().unwrap().gold_cents,
            200 + DAILY_QUEST_GOLD_CENTS
        );
    }

    #[test]
    fn sqlite_streak_calendar_counts_any_study_day_and_marks_goal_met() {
        let (col, clock, note_id, card_id) = setup_collection();
        col.set_daily_goal(10).unwrap();

        // Day 0: 1 review (3 XP < 10 XP goal) -> studied = true, goal_met = false.
        answer_card(&col, card_id, note_id, BASE_MS + 1_000);

        // Day 1: 1 task (10 XP >= 10 XP goal) -> studied = true, goal_met = true.
        clock.set(BASE_MS + DAY_MS);
        let t1 = col
            .create_task(TaskInput {
                list_id: None,
                title: "Reach goal".into(),
                notes: "".into(),
                priority: TaskPriority::None,
                due_date: None,
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                manual_quadrant: None,
                sort_order: 0,
            })
            .unwrap();
        col.complete_task(&t1.id).unwrap();

        let cal = col.get_streak_calendar(2026, 11).unwrap();
        assert_eq!(cal.current_streak, 2);
        assert_eq!(cal.best_streak, 2);
        let d0 = cal.days.iter().find(|d| d.day_index == 0).unwrap();
        assert!(d0.studied);
        assert!(!d0.goal_met);
        let d1 = cal.days.iter().find(|d| d.day_index == 1).unwrap();
        assert!(d1.studied);
        assert!(d1.goal_met);
    }

    #[test]
    fn sqlite_game_auto_freeze_and_quest_rows_never_count_as_study_days() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        {
            let conn = storage.lock();
            let id = bibalak_core::game::game_entity_id(
                "freeze_token_ledger",
                NIL_USER_ID,
                "freeze_buy:seed",
            );
            conn.execute(
                "INSERT INTO freeze_token_ledger (id, user_id, source_key, delta, created_at, updated_at, deleted_at, usn)
                 VALUES (?1, ?2, 'freeze_buy:seed', 1, ?3, ?3, NULL, -1)",
                rusqlite::params![id, NIL_USER_ID, BASE_MS],
            )
            .unwrap();
            let quest_key = daily_quest_source_key(5, "reviews_15");
            conn.execute(
                "INSERT INTO progress_ledger (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
                 VALUES (?1, ?2, ?3, 0, ?4, ?5, ?5, NULL, -1)",
                rusqlite::params![
                    ledger_id(NIL_USER_ID, &quest_key),
                    NIL_USER_ID,
                    quest_key,
                    DAILY_QUEST_GOLD_CENTS as i64,
                    BASE_MS + 5 * DAY_MS
                ],
            )
            .unwrap();
        }
        let clock = Arc::new(TestClock::new(BASE_MS));
        let col = Collection::new(Box::new(storage), clock.clone()).unwrap();
        let nt_id = col.list_notetypes().unwrap()[0].id;
        let added = col
            .add_note(nt_id, 1, &["Q".into(), "A".into()], &[])
            .unwrap();
        let card_id = col.next_card(1).unwrap().unwrap().id;
        answer_card(&col, card_id, added.note_id, BASE_MS + 100);

        // Day 2 (1-day gap on day 1): Game auto-freezes day 1.
        clock.set(BASE_MS + 2 * DAY_MS);
        let state = col.get_motivation_state_for_style(Some("game")).unwrap();
        assert_eq!(state.auto_frozen_day, Some(1));
        assert_eq!(state.current_streak, 1);

        // Day 5 has a quest_daily row only -> must NOT count as studied!
        clock.set(BASE_MS + 5 * DAY_MS);
        let day5 = col.get_motivation_state().unwrap();
        assert!(!day5.studied_today);
        assert_eq!(day5.current_streak, 0);
    }

    #[test]
    fn sqlite_monthly_badge_and_comeback_bonus() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        bibalak_core::ports::MaintenanceStore::ensure_collection(&storage, BASE_MS).unwrap();
        // BASE_MS is 2026-11-13 (day 0). Pick a day in Nov 21..=30 (off in 8..=17)
        // whose Slot 3 is `tasks_2`, so all 19 pre-seeded days `(off - 19)..=(off - 1)`
        // fall strictly inside `2026-11`.
        let off = (8..=17)
            .find(|&d| daily_quests_for_day(d)[2].id == "tasks_2")
            .expect("Nov 21..=30 must include a tasks_2 day");
        let now_ms = BASE_MS + i64::from(off) * DAY_MS;
        {
            let conn = storage.lock();
            for offset in 1..=19 {
                let d = off - offset;
                let q = daily_quests_for_day(d)[0];
                let key = daily_quest_source_key(d, q.id);
                conn.execute(
                    "INSERT INTO progress_ledger (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
                     VALUES (?1, ?2, ?3, 0, ?4, ?5, ?5, NULL, -1)",
                    rusqlite::params![
                        ledger_id(NIL_USER_ID, &key),
                        NIL_USER_ID,
                        key,
                        DAILY_QUEST_GOLD_CENTS as i64,
                        now_ms - i64::from(offset) * DAY_MS
                    ],
                )
                .unwrap();
            }
        }
        let clock = Arc::new(TestClock::new(now_ms));
        let col = Collection::new(Box::new(storage), clock.clone()).unwrap();
        // Ensure created_ms aligns with BASE_MS even when clock is Nov 21..=30 by checking month_key.
        col.set_daily_goal(10).unwrap();

        let t1 = col
            .create_task(TaskInput {
                list_id: None,
                title: "T1".into(),
                notes: "".into(),
                priority: TaskPriority::None,
                due_date: None,
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                manual_quadrant: None,
                sort_order: 0,
            })
            .unwrap();
        let t2 = col
            .create_task(TaskInput {
                list_id: None,
                title: "T2".into(),
                notes: "".into(),
                priority: TaskPriority::None,
                due_date: None,
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                manual_quadrant: None,
                sort_order: 0,
            })
            .unwrap();
        col.complete_task(&t1.id).unwrap();
        clock.set(now_ms + 1_000);
        col.complete_task(&t2.id).unwrap();

        let state = col.get_motivation_state().unwrap();
        assert_eq!(
            state.monthly_badge.completed_daily_quests,
            MONTHLY_BADGE_TARGET_QUESTS
        );
        assert!(state.monthly_badge.earned);
        let badge_key = monthly_badge_source_key(&state.monthly_badge.month_key);
        assert_eq!(
            col.storage()
                .get_active_ledger_reward(NIL_USER_ID, &badge_key)
                .unwrap()
                .unwrap()
                .gold_cents,
            MONTHLY_BADGE_GOLD_CENTS as i64
        );

        // Undo t2 -> monthly badge remains monotonic.
        clock.set(now_ms + 2_000);
        col.undo().unwrap();
        let after_undo = col.get_motivation_state().unwrap();
        assert!(after_undo.monthly_badge.earned);
        assert_eq!(after_undo.monthly_badge.completed_daily_quests, 19);

        // Comeback after 8 days away from last active study day.
        clock.set(now_ms + 8 * DAY_MS);
        let cb_state = col.get_motivation_state().unwrap();
        assert!(cb_state.comeback_offer.is_some());
        let t3 = col
            .create_task(TaskInput {
                list_id: None,
                title: "Comeback task".into(),
                notes: "".into(),
                priority: TaskPriority::None,
                due_date: None,
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                manual_quadrant: None,
                sort_order: 0,
            })
            .unwrap();
        col.complete_task(&t3.id).unwrap();
        let cb_key = comeback_bonus_source_key(off + 8);
        assert_eq!(
            col.storage()
                .get_active_ledger_reward(NIL_USER_ID, &cb_key)
                .unwrap()
                .unwrap()
                .gold_cents,
            COMEBACK_BONUS_GOLD_CENTS as i64
        );
    }

    #[test]
    fn fresh_collection_defaults_daily_goal_to_10_while_existing_row_keeps_20() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let clock = Arc::new(TestClock::new(1_794_830_400_000));
        let col = Collection::new(Box::new(storage), clock).unwrap();

        let state = col.get_motivation_state().unwrap();
        assert_eq!(state.daily_goal_xp, 10);

        // Existing saved goal (20) must be preserved when reloaded.
        let after = col.set_daily_goal(20).unwrap();
        assert_eq!(after.daily_goal_xp, 20);
        assert_eq!(col.get_motivation_state().unwrap().daily_goal_xp, 20);
    }
}
