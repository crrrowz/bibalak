//! SQLite persistence for productivity tables (`task_lists`, `tasks`,
//! `matrix_quadrants`, `habits`, `habit_logs`, `calendar_events`) (ADR-018).

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::productivity::{
    CalendarEvent, CalendarRecurrence, CalendarRecurrenceFreq, Habit, HabitFrequencyKind,
    HabitGoalMode, HabitLog, HabitLogStatus, HabitLogWriteOutcome, HabitSection, MatrixGroupBy,
    MatrixQuadrant, MatrixSortBy, QuadrantKey, TaskItem, TaskList, TaskOrderItem, TaskPriority,
};
use bibalak_core::progress::RewardGrant;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

fn json_err(e: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
}

fn core_to_sql_err(e: CoreError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
}

/// Generate a lowercase RFC 4122 v4 UUID using `fastrand`.
pub fn new_uuid() -> String {
    let hi = fastrand::u64(..).to_be_bytes();
    let lo = fastrand::u64(..).to_be_bytes();
    let mut b = [0_u8; 16];
    b[..8].copy_from_slice(&hi);
    b[8..].copy_from_slice(&lo);
    // RFC 4122 version 4
    b[6] = (b[6] & 0x0f) | 0x40;
    // RFC 4122 variant (10xx)
    b[8] = (b[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3],
        b[4], b[5],
        b[6], b[7],
        b[8], b[9],
        b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

// ── Shared Ledger Hook Helper ────────────────────────────────────────────────

fn apply_ledger_hook(
    tx: &Transaction<'_>,
    user_id: &str,
    reward: Option<&RewardGrant>,
    revoke_source_key: Option<&str>,
    now_ms: i64,
) -> CoreResult<(bool, bool)> {
    let granted = if let Some(r) = reward {
        let existing: Option<Option<i64>> = tx
            .query_row(
                "SELECT deleted_at FROM progress_ledger WHERE user_id = ?1 AND source_key = ?2",
                params![r.user_id, r.source_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(err)?;
        match existing {
            None => {
                tx.execute(
                    "INSERT INTO progress_ledger
                     (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, -1)",
                    params![
                        r.id,
                        r.user_id,
                        r.source_key,
                        r.xp,
                        r.gold_cents,
                        r.now_ms,
                        now_ms,
                    ],
                )
                .map_err(err)?;
                true
            }
            Some(Some(_deleted_at)) => {
                tx.execute(
                    "UPDATE progress_ledger
                     SET xp = ?1, gold_cents = ?2, created_at = ?3, updated_at = ?4, deleted_at = NULL, usn = -1
                     WHERE user_id = ?5 AND source_key = ?6",
                    params![r.xp, r.gold_cents, r.now_ms, now_ms, r.user_id, r.source_key],
                )
                .map_err(err)?;
                true
            }
            Some(None) => false,
        }
    } else {
        false
    };

    let revoked = if let Some(source_key) = revoke_source_key {
        tx.execute(
            "UPDATE progress_ledger
             SET deleted_at = ?1, updated_at = ?1, usn = -1
             WHERE user_id = ?2 AND source_key = ?3 AND deleted_at IS NULL",
            params![now_ms, user_id, source_key],
        )
        .map_err(err)?
            > 0
    } else {
        false
    };

    Ok((granted, revoked))
}

// ── Row Mappers (shared with sync.rs) ────────────────────────────────────────

pub(crate) fn map_task_list(row: &Row<'_>) -> rusqlite::Result<TaskList> {
    Ok(TaskList {
        id: row.get(0)?,
        user_id: row.get(1)?,
        name: row.get(2)?,
        color_token: row.get(3)?,
        icon_key: row.get(4)?,
        sort_order: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deleted_at: row.get(8)?,
        usn: row.get(9)?,
    })
}

pub(crate) fn map_task(row: &Row<'_>) -> rusqlite::Result<TaskItem> {
    let priority_str: String = row.get(5)?;
    let manual_str: Option<String> = row.get(6)?;
    let tags_json: String = row.get(10)?;
    Ok(TaskItem {
        id: row.get(0)?,
        user_id: row.get(1)?,
        list_id: row.get(2)?,
        title: row.get(3)?,
        notes: row.get(4)?,
        priority: TaskPriority::parse(&priority_str).map_err(core_to_sql_err)?,
        manual_quadrant: manual_str
            .as_deref()
            .map(QuadrantKey::parse)
            .transpose()
            .map_err(core_to_sql_err)?,
        due_date: row.get(7)?,
        scheduled_start_ms: row.get(8)?,
        scheduled_end_ms: row.get(9)?,
        tags: serde_json::from_str(&tags_json).map_err(json_err)?,
        deck_id: row.get(11)?,
        completed_at: row.get(12)?,
        completed_day: row.get(13)?,
        sort_order: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
        deleted_at: row.get(17)?,
        usn: row.get(18)?,
    })
}

pub(crate) fn map_matrix_quadrant(row: &Row<'_>) -> rusqlite::Result<MatrixQuadrant> {
    let key_str: String = row.get(2)?;
    let group_str: String = row.get(5)?;
    let sort_str: String = row.get(6)?;
    let rule_json: String = row.get(7)?;
    Ok(MatrixQuadrant {
        id: row.get(0)?,
        user_id: row.get(1)?,
        quadrant_key: QuadrantKey::parse(&key_str).map_err(core_to_sql_err)?,
        title: row.get(3)?,
        color_token: row.get(4)?,
        group_by: MatrixGroupBy::parse(&group_str).map_err(core_to_sql_err)?,
        sort_by: MatrixSortBy::parse(&sort_str).map_err(core_to_sql_err)?,
        rule: serde_json::from_str(&rule_json).map_err(json_err)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        deleted_at: row.get(10)?,
        usn: row.get(11)?,
    })
}

pub(crate) fn map_habit(row: &Row<'_>) -> rusqlite::Result<Habit> {
    let freq_str: String = row.get(6)?;
    let weekdays_json: String = row.get(7)?;
    let weekly_target: Option<i64> = row.get(8)?;
    let interval_days: Option<i64> = row.get(9)?;
    let goal_mode_str: String = row.get(10)?;
    let target_days: Option<i64> = row.get(14)?;
    let section_str: String = row.get(15)?;
    let reminders_json: String = row.get(16)?;
    let auto_popup: i64 = row.get(17)?;
    Ok(Habit {
        id: row.get(0)?,
        user_id: row.get(1)?,
        title: row.get(2)?,
        notes: row.get(3)?,
        icon_key: row.get(4)?,
        color_token: row.get(5)?,
        frequency_kind: HabitFrequencyKind::parse(&freq_str).map_err(core_to_sql_err)?,
        weekdays: serde_json::from_str(&weekdays_json).map_err(json_err)?,
        weekly_target: weekly_target.map(|v| v as u8),
        interval_days: interval_days.map(|v| v as u32),
        goal_mode: HabitGoalMode::parse(&goal_mode_str).map_err(core_to_sql_err)?,
        goal_target: row.get(11)?,
        goal_unit: row.get(12)?,
        start_day_index: row.get(13)?,
        target_days: target_days.map(|v| v as u32),
        section: HabitSection::parse(&section_str).map_err(core_to_sql_err)?,
        reminders: serde_json::from_str(&reminders_json).map_err(json_err)?,
        auto_popup_log: auto_popup != 0,
        deck_id: row.get(18)?,
        archived_at: row.get(19)?,
        sort_order: row.get(20)?,
        created_at: row.get(21)?,
        updated_at: row.get(22)?,
        deleted_at: row.get(23)?,
        usn: row.get(24)?,
    })
}

pub(crate) fn map_habit_log(row: &Row<'_>) -> rusqlite::Result<HabitLog> {
    let completed: i64 = row.get(6)?;
    let mood: Option<i64> = row.get(7)?;
    let status_str: String = row.get(13)?;
    Ok(HabitLog {
        id: row.get(0)?,
        user_id: row.get(1)?,
        habit_id: row.get(2)?,
        day_index: row.get(3)?,
        logged_value: row.get(4)?,
        goal_target: row.get(5)?,
        completed: completed != 0,
        status: HabitLogStatus::parse(&status_str).map_err(core_to_sql_err)?,
        mood: mood.map(|v| v as u8),
        note: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        deleted_at: row.get(11)?,
        usn: row.get(12)?,
    })
}

pub(crate) fn map_calendar_event(row: &Row<'_>) -> rusqlite::Result<CalendarEvent> {
    let is_all_day: i64 = row.get(8)?;
    let rec_freq: Option<String> = row.get(9)?;
    let rec_interval: i64 = row.get(10)?;
    let rec_weekdays_json: String = row.get(11)?;
    let rec_until_date: Option<String> = row.get(12)?;
    let rec_count: Option<i64> = row.get(13)?;
    let rec_exdates_json: String = row.get(14)?;

    let recurrence = match rec_freq {
        Some(freq_str) => Some(CalendarRecurrence {
            freq: CalendarRecurrenceFreq::parse(&freq_str).map_err(core_to_sql_err)?,
            interval: rec_interval.max(1) as u32,
            weekdays: serde_json::from_str(&rec_weekdays_json).map_err(json_err)?,
            until_date: rec_until_date,
            count: rec_count.map(|v| v as u32),
            exdates: serde_json::from_str(&rec_exdates_json).map_err(json_err)?,
        }),
        None => None,
    };

    Ok(CalendarEvent {
        id: row.get(0)?,
        user_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        location: row.get(4)?,
        color_token: row.get(5)?,
        start_ms: row.get(6)?,
        end_ms: row.get(7)?,
        is_all_day: is_all_day != 0,
        recurrence,
        linked_task_id: row.get(15)?,
        external_account_id: row.get(16)?,
        external_event_id: row.get(17)?,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
        deleted_at: row.get(20)?,
        usn: row.get(21)?,
    })
}

pub(crate) const TASK_LIST_COLS: &str =
    "id, user_id, name, color_token, icon_key, sort_order, created_at, updated_at, deleted_at, usn";
pub(crate) const TASK_COLS: &str = "id, user_id, list_id, title, notes, priority, manual_quadrant, due_date, scheduled_start_ms, scheduled_end_ms, tags_json, deck_id, completed_at, completed_day, sort_order, created_at, updated_at, deleted_at, usn";
pub(crate) const MATRIX_QUADRANT_COLS: &str = "id, user_id, quadrant_key, title, color_token, group_by, sort_by, rule_json, created_at, updated_at, deleted_at, usn";
pub(crate) const HABIT_COLS: &str = "id, user_id, title, notes, icon_key, color_token, frequency_kind, weekdays_json, weekly_target, interval_days, goal_mode, goal_target, goal_unit, start_day_index, target_days, section, reminders_json, auto_popup_log, deck_id, archived_at, sort_order, created_at, updated_at, deleted_at, usn";
pub(crate) const HABIT_LOG_COLS: &str = "id, user_id, habit_id, day_index, logged_value, goal_target, completed, mood, note, created_at, updated_at, deleted_at, usn, status";
pub(crate) const CALENDAR_EVENT_COLS: &str = "id, user_id, title, description, location, color_token, start_ms, end_ms, is_all_day, recurrence_freq, recurrence_interval, recurrence_weekdays_json, recurrence_until_date, recurrence_count, recurrence_exdates_json, linked_task_id, external_account_id, external_event_id, created_at, updated_at, deleted_at, usn";

// ── Task Lists ───────────────────────────────────────────────────────────────

pub fn list_task_lists(conn: &Connection, user_id: &str) -> CoreResult<Vec<TaskList>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {TASK_LIST_COLS} FROM task_lists
             WHERE user_id = ?1 AND deleted_at IS NULL
             ORDER BY sort_order ASC, name ASC, id ASC"
        ))
        .map_err(err)?;
    let rows = stmt
        .query_map([user_id], map_task_list)
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(rows)
}

pub(crate) fn upsert_task_list_with_usn(
    conn: &Connection,
    list: &TaskList,
    usn: i64,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO task_lists
         (id, user_id, name, color_token, icon_key, sort_order, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
             user_id = excluded.user_id,
             name = excluded.name,
             color_token = excluded.color_token,
             icon_key = excluded.icon_key,
             sort_order = excluded.sort_order,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            list.id,
            list.user_id,
            list.name,
            list.color_token,
            list.icon_key,
            list.sort_order,
            list.created_at,
            list.updated_at,
            list.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub fn upsert_task_list(conn: &Connection, list: &TaskList) -> CoreResult<()> {
    upsert_task_list_with_usn(conn, list, list.usn)
}

pub fn soft_delete_task_list(
    conn: &mut Connection,
    user_id: &str,
    id: &str,
    now_ms: i64,
) -> CoreResult<Vec<String>> {
    let tx = conn.transaction().map_err(err)?;
    let task_ids: Vec<String> = {
        let mut stmt = tx
            .prepare(
                "SELECT id FROM tasks
                 WHERE user_id = ?1 AND list_id = ?2 AND deleted_at IS NULL
                 ORDER BY id ASC",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map(params![user_id, id], |r| r.get(0))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        rows
    };

    tx.execute(
        "UPDATE tasks
         SET list_id = NULL, updated_at = ?1, usn = -1
         WHERE user_id = ?2 AND list_id = ?3 AND deleted_at IS NULL",
        params![now_ms, user_id, id],
    )
    .map_err(err)?;

    let changed = tx
        .execute(
            "UPDATE task_lists
             SET deleted_at = ?1, updated_at = ?1, usn = -1
             WHERE user_id = ?2 AND id = ?3 AND deleted_at IS NULL",
            params![now_ms, user_id, id],
        )
        .map_err(err)?;
    if changed == 0 {
        return Err(CoreError::NotFound(format!("task list '{id}' not found")));
    }

    tx.commit().map_err(err)?;
    Ok(task_ids)
}

pub fn restore_task_list(
    conn: &mut Connection,
    user_id: &str,
    id: &str,
    task_ids: &[String],
    now_ms: i64,
) -> CoreResult<()> {
    let tx = conn.transaction().map_err(err)?;
    let changed = tx
        .execute(
            "UPDATE task_lists
             SET deleted_at = NULL, updated_at = ?1, usn = -1
             WHERE user_id = ?2 AND id = ?3",
            params![now_ms, user_id, id],
        )
        .map_err(err)?;
    if changed == 0 {
        return Err(CoreError::NotFound(format!("task list '{id}' not found")));
    }
    for task_id in task_ids {
        tx.execute(
            "UPDATE tasks
             SET list_id = ?1, updated_at = ?2, usn = -1
             WHERE user_id = ?3 AND id = ?4 AND deleted_at IS NULL",
            params![id, now_ms, user_id, task_id],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(())
}

// ── Tasks ────────────────────────────────────────────────────────────────────

pub fn list_tasks(
    conn: &Connection,
    user_id: &str,
    include_completed: bool,
) -> CoreResult<Vec<TaskItem>> {
    let include_flag = i64::from(include_completed);
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {TASK_COLS} FROM tasks
             WHERE user_id = ?1 AND deleted_at IS NULL AND (?2 = 1 OR completed_at IS NULL)
             ORDER BY sort_order ASC, created_at ASC, id ASC"
        ))
        .map_err(err)?;
    let rows = stmt
        .query_map(params![user_id, include_flag], map_task)
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(rows)
}

pub fn get_task(conn: &Connection, user_id: &str, id: &str) -> CoreResult<Option<TaskItem>> {
    conn.query_row(
        &format!(
            "SELECT {TASK_COLS} FROM tasks
             WHERE user_id = ?1 AND id = ?2 AND deleted_at IS NULL"
        ),
        params![user_id, id],
        map_task,
    )
    .optional()
    .map_err(err)
}

pub(crate) fn upsert_task_with_usn(conn: &Connection, task: &TaskItem, usn: i64) -> CoreResult<()> {
    let tags_json = serde_json::to_string(&task.tags).map_err(err)?;
    conn.execute(
        "INSERT INTO tasks
         (id, user_id, list_id, title, notes, priority, manual_quadrant, due_date,
          scheduled_start_ms, scheduled_end_ms, tags_json, deck_id, completed_at, completed_day,
          sort_order, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
         ON CONFLICT(id) DO UPDATE SET
             user_id = excluded.user_id,
             list_id = excluded.list_id,
             title = excluded.title,
             notes = excluded.notes,
             priority = excluded.priority,
             manual_quadrant = excluded.manual_quadrant,
             due_date = excluded.due_date,
             scheduled_start_ms = excluded.scheduled_start_ms,
             scheduled_end_ms = excluded.scheduled_end_ms,
             tags_json = excluded.tags_json,
             deck_id = excluded.deck_id,
             completed_at = excluded.completed_at,
             completed_day = excluded.completed_day,
             sort_order = excluded.sort_order,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            task.id,
            task.user_id,
            task.list_id,
            task.title,
            task.notes,
            task.priority.as_str(),
            task.manual_quadrant.map(QuadrantKey::as_str),
            task.due_date,
            task.scheduled_start_ms,
            task.scheduled_end_ms,
            tags_json,
            task.deck_id,
            task.completed_at,
            task.completed_day,
            task.sort_order,
            task.created_at,
            task.updated_at,
            task.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub fn upsert_task(conn: &Connection, task: &TaskItem) -> CoreResult<()> {
    upsert_task_with_usn(conn, task, task.usn)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn set_task_completion_tx(
    tx: &Transaction<'_>,
    user_id: &str,
    id: &str,
    completed_at: Option<i64>,
    completed_day: Option<i32>,
    reward: Option<&RewardGrant>,
    revoke_source_key: Option<&str>,
    now_ms: i64,
) -> CoreResult<(bool, bool)> {
    let changed = tx
        .execute(
            "UPDATE tasks
             SET completed_at = ?1, completed_day = ?2, updated_at = ?3, usn = -1
             WHERE user_id = ?4 AND id = ?5 AND deleted_at IS NULL",
            params![completed_at, completed_day, now_ms, user_id, id],
        )
        .map_err(err)?;
    if changed == 0 {
        return Err(CoreError::NotFound(format!("task '{id}' not found")));
    }

    let (granted, revoked) = apply_ledger_hook(tx, user_id, reward, revoke_source_key, now_ms)?;
    if revoked {
        if let Some(key) = revoke_source_key {
            let lid = bibalak_core::progress::ledger_id(user_id, key);
            crate::game_depth::revoke_pet_credit_tx(tx, user_id, &lid, now_ms)?;
        }
        crate::game_depth::invalidate_earned_xp_cache_tx(tx, user_id)?;
    }
    Ok((granted, revoked))
}

#[allow(clippy::too_many_arguments)]
pub fn set_task_completion(
    conn: &mut Connection,
    user_id: &str,
    id: &str,
    completed_at: Option<i64>,
    completed_day: Option<i32>,
    reward: Option<&RewardGrant>,
    revoke_source_key: Option<&str>,
    now_ms: i64,
) -> CoreResult<bool> {
    let tx = conn.transaction().map_err(err)?;
    let (granted, _) = set_task_completion_tx(
        &tx,
        user_id,
        id,
        completed_at,
        completed_day,
        reward,
        revoke_source_key,
        now_ms,
    )?;
    if granted {
        crate::game_depth::invalidate_earned_xp_cache_tx(&tx, user_id)?;
        if let Some(r) = reward {
            let _ = crate::game_depth::grant_pet_credit_tx(
                &tx,
                user_id,
                &r.id,
                bibalak_core::game_depth::PET_CREDIT_PRODUCTIVITY_POINTS,
                now_ms,
            )?;
        }
    }
    tx.commit().map_err(err)?;
    Ok(granted)
}

#[allow(clippy::too_many_arguments)]
pub fn set_task_completion_with_game(
    conn: &mut Connection,
    user_id: &str,
    id: &str,
    completed_at: Option<i64>,
    completed_day: Option<i32>,
    reward: Option<&RewardGrant>,
    revoke_source_key: Option<&str>,
    ctx: &bibalak_core::game_depth::GameEvalContext,
) -> CoreResult<bibalak_core::game_depth::GameWriteOutcome> {
    let tx = conn.transaction().map_err(err)?;
    let (reward_granted, _) = set_task_completion_tx(
        &tx,
        user_id,
        id,
        completed_at,
        completed_day,
        reward,
        revoke_source_key,
        ctx.now_ms,
    )?;
    let game_changed = if reward_granted || completed_at.is_some() {
        let lid = reward.filter(|_| reward_granted).map(|r| r.id.as_str());
        let granted_xp = reward.filter(|_| reward_granted).map_or(0, |r| r.xp);
        crate::game_depth::on_task_committed_tx(&tx, ctx, lid, granted_xp)?
    } else {
        false
    };
    tx.commit().map_err(err)?;
    Ok(bibalak_core::game_depth::GameWriteOutcome {
        reward_granted,
        game_changed,
    })
}

pub fn reorder_tasks(
    conn: &mut Connection,
    user_id: &str,
    items: &[TaskOrderItem],
    now_ms: i64,
) -> CoreResult<()> {
    let tx = conn.transaction().map_err(err)?;
    {
        let mut stmt = tx
            .prepare(
                "UPDATE tasks
                 SET sort_order = ?1, updated_at = ?2, usn = -1
                 WHERE user_id = ?3 AND id = ?4 AND deleted_at IS NULL",
            )
            .map_err(err)?;
        for item in items {
            let changed = stmt
                .execute(params![item.sort_order, now_ms, user_id, item.id])
                .map_err(err)?;
            if changed == 0 {
                return Err(CoreError::NotFound(format!("task '{}' not found", item.id)));
            }
        }
    }
    tx.commit().map_err(err)?;
    Ok(())
}

pub fn reschedule_overdue_tasks(
    conn: &mut Connection,
    user_id: &str,
    today_date: &str,
    target_date: &str,
    now_ms: i64,
) -> CoreResult<u32> {
    let tx = conn.transaction().map_err(err)?;
    let changed = tx
        .execute(
            "UPDATE tasks
             SET due_date = ?1, updated_at = ?2, usn = -1
             WHERE user_id = ?3
               AND deleted_at IS NULL
               AND completed_at IS NULL
               AND due_date IS NOT NULL
               AND due_date < ?4",
            params![target_date, now_ms, user_id, today_date],
        )
        .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(changed as u32)
}

pub fn soft_delete_task(conn: &Connection, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()> {
    let changed = conn
        .execute(
            "UPDATE tasks
             SET deleted_at = ?1, updated_at = ?1, usn = -1
             WHERE user_id = ?2 AND id = ?3 AND deleted_at IS NULL",
            params![now_ms, user_id, id],
        )
        .map_err(err)?;
    if changed == 0 {
        return Err(CoreError::NotFound(format!("task '{id}' not found")));
    }
    Ok(())
}

pub fn restore_task(conn: &Connection, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()> {
    let changed = conn
        .execute(
            "UPDATE tasks
             SET deleted_at = NULL, updated_at = ?1, usn = -1
             WHERE user_id = ?2 AND id = ?3",
            params![now_ms, user_id, id],
        )
        .map_err(err)?;
    if changed == 0 {
        return Err(CoreError::NotFound(format!("task '{id}' not found")));
    }
    Ok(())
}

// ── Matrix Quadrants ─────────────────────────────────────────────────────────

pub fn list_matrix_quadrants(conn: &Connection, user_id: &str) -> CoreResult<Vec<MatrixQuadrant>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {MATRIX_QUADRANT_COLS} FROM matrix_quadrants
             WHERE user_id = ?1 AND deleted_at IS NULL
             ORDER BY quadrant_key ASC"
        ))
        .map_err(err)?;
    let rows = stmt
        .query_map([user_id], map_matrix_quadrant)
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(rows)
}

pub(crate) fn upsert_matrix_quadrant_with_usn(
    conn: &Connection,
    q: &MatrixQuadrant,
    usn: i64,
) -> CoreResult<()> {
    let rule_json = serde_json::to_string(&q.rule).map_err(err)?;
    conn.execute(
        "INSERT INTO matrix_quadrants
         (id, user_id, quadrant_key, title, color_token, group_by, sort_by, rule_json, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(user_id, quadrant_key) DO UPDATE SET
             id = excluded.id,
             title = excluded.title,
             color_token = excluded.color_token,
             group_by = excluded.group_by,
             sort_by = excluded.sort_by,
             rule_json = excluded.rule_json,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            q.id,
            q.user_id,
            q.quadrant_key.as_str(),
            q.title,
            q.color_token,
            q.group_by.as_str(),
            q.sort_by.as_str(),
            rule_json,
            q.created_at,
            q.updated_at,
            q.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub fn upsert_matrix_quadrant(conn: &Connection, q: &MatrixQuadrant) -> CoreResult<()> {
    upsert_matrix_quadrant_with_usn(conn, q, q.usn)
}

// ── Habits & Habit Logs ──────────────────────────────────────────────────────

pub fn list_habits(
    conn: &Connection,
    user_id: &str,
    include_archived: bool,
) -> CoreResult<Vec<Habit>> {
    let include_flag = i64::from(include_archived);
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {HABIT_COLS} FROM habits
             WHERE user_id = ?1 AND deleted_at IS NULL AND (?2 = 1 OR archived_at IS NULL)
             ORDER BY sort_order ASC, created_at ASC, id ASC"
        ))
        .map_err(err)?;
    let rows = stmt
        .query_map(params![user_id, include_flag], map_habit)
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(rows)
}

pub fn get_habit(conn: &Connection, user_id: &str, id: &str) -> CoreResult<Option<Habit>> {
    conn.query_row(
        &format!(
            "SELECT {HABIT_COLS} FROM habits
             WHERE user_id = ?1 AND id = ?2 AND deleted_at IS NULL"
        ),
        params![user_id, id],
        map_habit,
    )
    .optional()
    .map_err(err)
}

pub(crate) fn upsert_habit_with_usn(conn: &Connection, habit: &Habit, usn: i64) -> CoreResult<()> {
    let weekdays_json = serde_json::to_string(&habit.weekdays).map_err(err)?;
    let reminders_json = serde_json::to_string(&habit.reminders).map_err(err)?;
    conn.execute(
        "INSERT INTO habits
         (id, user_id, title, notes, icon_key, color_token, frequency_kind, weekdays_json,
          weekly_target, interval_days, goal_mode, goal_target, goal_unit, start_day_index,
          target_days, section, reminders_json, auto_popup_log, deck_id, archived_at, sort_order,
          created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)
         ON CONFLICT(id) DO UPDATE SET
             user_id = excluded.user_id,
             title = excluded.title,
             notes = excluded.notes,
             icon_key = excluded.icon_key,
             color_token = excluded.color_token,
             frequency_kind = excluded.frequency_kind,
             weekdays_json = excluded.weekdays_json,
             weekly_target = excluded.weekly_target,
             interval_days = excluded.interval_days,
             goal_mode = excluded.goal_mode,
             goal_target = excluded.goal_target,
             goal_unit = excluded.goal_unit,
             start_day_index = excluded.start_day_index,
             target_days = excluded.target_days,
             section = excluded.section,
             reminders_json = excluded.reminders_json,
             auto_popup_log = excluded.auto_popup_log,
             deck_id = excluded.deck_id,
             archived_at = excluded.archived_at,
             sort_order = excluded.sort_order,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            habit.id,
            habit.user_id,
            habit.title,
            habit.notes,
            habit.icon_key,
            habit.color_token,
            habit.frequency_kind.as_str(),
            weekdays_json,
            habit.weekly_target.map(i64::from),
            habit.interval_days.map(i64::from),
            habit.goal_mode.as_str(),
            habit.goal_target,
            habit.goal_unit,
            habit.start_day_index,
            habit.target_days.map(i64::from),
            habit.section.as_str(),
            reminders_json,
            i64::from(habit.auto_popup_log),
            habit.deck_id,
            habit.archived_at,
            habit.sort_order,
            habit.created_at,
            habit.updated_at,
            habit.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub fn upsert_habit(conn: &Connection, habit: &Habit) -> CoreResult<()> {
    upsert_habit_with_usn(conn, habit, habit.usn)
}

pub fn soft_delete_habit(
    conn: &mut Connection,
    user_id: &str,
    id: &str,
    now_ms: i64,
) -> CoreResult<Vec<String>> {
    let tx = conn.transaction().map_err(err)?;
    let log_ids: Vec<String> = {
        let mut stmt = tx
            .prepare(
                "SELECT id FROM habit_logs
                 WHERE user_id = ?1 AND habit_id = ?2 AND deleted_at IS NULL
                 ORDER BY id ASC",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map(params![user_id, id], |r| r.get(0))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        rows
    };

    tx.execute(
        "UPDATE habit_logs
         SET deleted_at = ?1, updated_at = ?1, usn = -1
         WHERE user_id = ?2 AND habit_id = ?3 AND deleted_at IS NULL",
        params![now_ms, user_id, id],
    )
    .map_err(err)?;

    let changed = tx
        .execute(
            "UPDATE habits
             SET deleted_at = ?1, updated_at = ?1, usn = -1
             WHERE user_id = ?2 AND id = ?3 AND deleted_at IS NULL",
            params![now_ms, user_id, id],
        )
        .map_err(err)?;
    if changed == 0 {
        return Err(CoreError::NotFound(format!("habit '{id}' not found")));
    }

    tx.commit().map_err(err)?;
    Ok(log_ids)
}

pub fn restore_habit(
    conn: &mut Connection,
    user_id: &str,
    id: &str,
    log_ids: &[String],
    now_ms: i64,
) -> CoreResult<()> {
    let tx = conn.transaction().map_err(err)?;
    let changed = tx
        .execute(
            "UPDATE habits
             SET deleted_at = NULL, updated_at = ?1, usn = -1
             WHERE user_id = ?2 AND id = ?3",
            params![now_ms, user_id, id],
        )
        .map_err(err)?;
    if changed == 0 {
        return Err(CoreError::NotFound(format!("habit '{id}' not found")));
    }
    for log_id in log_ids {
        tx.execute(
            "UPDATE habit_logs
             SET deleted_at = NULL, updated_at = ?1, usn = -1
             WHERE user_id = ?2 AND id = ?3",
            params![now_ms, user_id, log_id],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(())
}

pub fn list_habit_logs_range(
    conn: &Connection,
    user_id: &str,
    from_day: i32,
    to_day: i32,
) -> CoreResult<Vec<HabitLog>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {HABIT_LOG_COLS} FROM habit_logs
             WHERE user_id = ?1 AND deleted_at IS NULL AND day_index >= ?2 AND day_index <= ?3
             ORDER BY day_index ASC, id ASC"
        ))
        .map_err(err)?;
    let rows = stmt
        .query_map(params![user_id, from_day, to_day], map_habit_log)
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(rows)
}

pub fn list_habit_logs_for_habit(
    conn: &Connection,
    user_id: &str,
    habit_id: &str,
    from_day: i32,
    to_day: i32,
) -> CoreResult<Vec<HabitLog>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {HABIT_LOG_COLS} FROM habit_logs
             WHERE user_id = ?1 AND habit_id = ?2 AND deleted_at IS NULL
               AND day_index >= ?3 AND day_index <= ?4
             ORDER BY day_index ASC, id ASC"
        ))
        .map_err(err)?;
    let rows = stmt
        .query_map(params![user_id, habit_id, from_day, to_day], map_habit_log)
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(rows)
}

pub(crate) fn upsert_habit_log_with_usn(
    conn: &Connection,
    log: &HabitLog,
    usn: i64,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO habit_logs
         (id, user_id, habit_id, day_index, logged_value, goal_target, completed, mood, note,
          created_at, updated_at, deleted_at, usn, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(user_id, habit_id, day_index) DO UPDATE SET
             id = excluded.id,
             logged_value = excluded.logged_value,
             goal_target = excluded.goal_target,
             completed = excluded.completed,
             mood = excluded.mood,
             note = excluded.note,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn,
             status = excluded.status",
        params![
            log.id,
            log.user_id,
            log.habit_id,
            log.day_index,
            log.logged_value,
            log.goal_target,
            i64::from(log.completed),
            log.mood.map(i64::from),
            log.note,
            log.created_at,
            log.updated_at,
            log.deleted_at,
            usn,
            log.status.as_str(),
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub(crate) fn upsert_habit_log_tx(
    tx: &Transaction<'_>,
    log: &HabitLog,
    reward: Option<&RewardGrant>,
    revoke_source_key: Option<&str>,
) -> CoreResult<HabitLogWriteOutcome> {
    let previous = tx
        .query_row(
            &format!(
                "SELECT {HABIT_LOG_COLS} FROM habit_logs
                 WHERE user_id = ?1 AND habit_id = ?2 AND day_index = ?3"
            ),
            params![log.user_id, log.habit_id, log.day_index],
            map_habit_log,
        )
        .optional()
        .map_err(err)?;

    let created_at = match &previous {
        Some(prev) if prev.deleted_at.is_none() => prev.created_at,
        _ => log.created_at,
    };
    let current = HabitLog {
        created_at,
        ..log.clone()
    };

    upsert_habit_log_with_usn(tx, &current, current.usn)?;
    let (reward_granted, reward_revoked) = apply_ledger_hook(
        tx,
        &current.user_id,
        reward,
        revoke_source_key,
        current.updated_at,
    )?;
    if reward_revoked {
        if let Some(key) = revoke_source_key {
            let lid = bibalak_core::progress::ledger_id(&current.user_id, key);
            crate::game_depth::revoke_pet_credit_tx(
                tx,
                &current.user_id,
                &lid,
                current.updated_at,
            )?;
        }
        crate::game_depth::invalidate_earned_xp_cache_tx(tx, &current.user_id)?;
    }

    Ok(HabitLogWriteOutcome {
        previous,
        current,
        reward_granted,
        reward_revoked,
    })
}

pub fn upsert_habit_log(
    conn: &mut Connection,
    log: &HabitLog,
    reward: Option<&RewardGrant>,
    revoke_source_key: Option<&str>,
) -> CoreResult<HabitLogWriteOutcome> {
    let tx = conn.transaction().map_err(err)?;
    let outcome = upsert_habit_log_tx(&tx, log, reward, revoke_source_key)?;
    if outcome.reward_granted {
        crate::game_depth::invalidate_earned_xp_cache_tx(&tx, &outcome.current.user_id)?;
        if let Some(r) = reward {
            let _ = crate::game_depth::grant_pet_credit_tx(
                &tx,
                &outcome.current.user_id,
                &r.id,
                bibalak_core::game_depth::PET_CREDIT_PRODUCTIVITY_POINTS,
                outcome.current.updated_at,
            )?;
        }
    }
    tx.commit().map_err(err)?;
    Ok(outcome)
}

pub fn upsert_habit_log_with_game(
    conn: &mut Connection,
    log: &HabitLog,
    reward: Option<&RewardGrant>,
    revoke_source_key: Option<&str>,
    ctx: &bibalak_core::game_depth::GameEvalContext,
) -> CoreResult<bibalak_core::game_depth::HabitLogGameOutcome> {
    let tx = conn.transaction().map_err(err)?;
    let freeze_key = format!("freeze_use:{}:{}", log.habit_id, log.day_index);
    let mut game_changed = false;

    if log.status == bibalak_core::productivity::HabitLogStatus::Frozen {
        let prev_row: Option<(bool, String)> = tx
            .query_row(
                "SELECT completed, status FROM habit_logs
                 WHERE user_id = ?1 AND habit_id = ?2 AND day_index = ?3 AND deleted_at IS NULL",
                params![log.user_id, log.habit_id, log.day_index],
                |r| Ok((r.get::<_, i64>(0)? != 0, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        if let Some((completed, status)) = prev_row {
            if completed {
                return Err(CoreError::Invalid(
                    "cannot freeze an already completed habit day".into(),
                ));
            }
            if status != "frozen" {
                if crate::game::freeze_tokens_held(&tx, &ctx.user_id)? < 1 {
                    return Err(CoreError::Invalid(
                        "no streak freeze tokens available".into(),
                    ));
                }
                if crate::game::upsert_freeze_entry_tx(
                    &tx,
                    &ctx.user_id,
                    &freeze_key,
                    -1,
                    log.updated_at,
                )? {
                    game_changed = true;
                }
            }
        } else {
            if crate::game::freeze_tokens_held(&tx, &ctx.user_id)? < 1 {
                return Err(CoreError::Invalid(
                    "no streak freeze tokens available".into(),
                ));
            }
            if crate::game::upsert_freeze_entry_tx(
                &tx,
                &ctx.user_id,
                &freeze_key,
                -1,
                log.updated_at,
            )? {
                game_changed = true;
            }
        }
    } else if crate::game::soft_delete_freeze_entry_tx(
        &tx,
        &ctx.user_id,
        &freeze_key,
        log.updated_at,
    )? {
        game_changed = true;
    }

    let habit_outcome = upsert_habit_log_tx(&tx, log, reward, revoke_source_key)?;
    if habit_outcome.reward_granted || log.completed {
        let lid = reward
            .filter(|_| habit_outcome.reward_granted)
            .map(|r| r.id.as_str());
        let granted_xp = reward
            .filter(|_| habit_outcome.reward_granted)
            .map_or(0, |r| r.xp);
        if crate::game_depth::on_habit_committed_tx(&tx, ctx, lid, granted_xp, log.completed)? {
            game_changed = true;
        }
    }
    tx.commit().map_err(err)?;
    Ok(bibalak_core::game_depth::HabitLogGameOutcome {
        habit_outcome,
        game_changed,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn restore_habit_log_snapshot(
    conn: &mut Connection,
    user_id: &str,
    habit_id: &str,
    day_index: i32,
    previous: Option<&HabitLog>,
    restore_reward: Option<&RewardGrant>,
    revoke_source_key: Option<&str>,
    now_ms: i64,
) -> CoreResult<()> {
    let tx = conn.transaction().map_err(err)?;
    let freeze_key = format!("freeze_use:{habit_id}:{day_index}");
    let restoring_frozen = previous.is_some_and(|p| {
        p.status == bibalak_core::productivity::HabitLogStatus::Frozen && p.deleted_at.is_none()
    });
    if restoring_frozen {
        let already_frozen_in_ledger: bool = tx
            .query_row(
                "SELECT EXISTS(
                     SELECT 1 FROM freeze_token_ledger
                     WHERE user_id = ?1 AND source_key = ?2 AND deleted_at IS NULL
                 )",
                params![user_id, freeze_key],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !already_frozen_in_ledger && crate::game::freeze_tokens_held(&tx, user_id)? < 1 {
            return Err(CoreError::Invalid(
                "cannot restore frozen habit status without an available streak freeze token"
                    .into(),
            ));
        }
    }
    match previous {
        Some(prev) => {
            tx.execute(
                "UPDATE habit_logs
                 SET logged_value = ?1, goal_target = ?2, completed = ?3, status = ?4, mood = ?5,
                     note = ?6, deleted_at = ?7, updated_at = ?8, usn = -1
                 WHERE user_id = ?9 AND habit_id = ?10 AND day_index = ?11",
                params![
                    prev.logged_value,
                    prev.goal_target,
                    i64::from(prev.completed),
                    prev.status.as_str(),
                    prev.mood.map(i64::from),
                    prev.note,
                    prev.deleted_at,
                    now_ms,
                    user_id,
                    habit_id,
                    day_index,
                ],
            )
            .map_err(err)?;
        }
        None => {
            tx.execute(
                "UPDATE habit_logs
                 SET deleted_at = ?1, updated_at = ?1, usn = -1
                 WHERE user_id = ?2 AND habit_id = ?3 AND day_index = ?4",
                params![now_ms, user_id, habit_id, day_index],
            )
            .map_err(err)?;
        }
    }

    let (granted, revoked) =
        apply_ledger_hook(&tx, user_id, restore_reward, revoke_source_key, now_ms)?;
    if revoked {
        if let Some(key) = revoke_source_key {
            let lid = bibalak_core::progress::ledger_id(user_id, key);
            crate::game_depth::revoke_pet_credit_tx(&tx, user_id, &lid, now_ms)?;
        }
        crate::game_depth::invalidate_earned_xp_cache_tx(&tx, user_id)?;
    }
    if granted {
        crate::game_depth::invalidate_earned_xp_cache_tx(&tx, user_id)?;
        if let Some(r) = restore_reward {
            let _ = crate::game_depth::grant_pet_credit_tx(
                &tx,
                user_id,
                &r.id,
                bibalak_core::game_depth::PET_CREDIT_PRODUCTIVITY_POINTS,
                now_ms,
            )?;
        }
    }
    if restoring_frozen {
        let _ = crate::game::upsert_freeze_entry_tx(&tx, user_id, &freeze_key, -1, now_ms)?;
    } else {
        let _ = crate::game::soft_delete_freeze_entry_tx(&tx, user_id, &freeze_key, now_ms)?;
    }
    tx.commit().map_err(err)?;
    Ok(())
}

// ── Calendar Events ──────────────────────────────────────────────────────────

pub fn list_calendar_events(conn: &Connection, user_id: &str) -> CoreResult<Vec<CalendarEvent>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {CALENDAR_EVENT_COLS} FROM calendar_events
             WHERE user_id = ?1 AND deleted_at IS NULL
             ORDER BY start_ms ASC, id ASC"
        ))
        .map_err(err)?;
    let rows = stmt
        .query_map([user_id], map_calendar_event)
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(rows)
}

pub fn get_calendar_event(
    conn: &Connection,
    user_id: &str,
    id: &str,
) -> CoreResult<Option<CalendarEvent>> {
    conn.query_row(
        &format!(
            "SELECT {CALENDAR_EVENT_COLS} FROM calendar_events
             WHERE user_id = ?1 AND id = ?2 AND deleted_at IS NULL"
        ),
        params![user_id, id],
        map_calendar_event,
    )
    .optional()
    .map_err(err)
}

pub(crate) fn upsert_calendar_event_with_usn(
    conn: &Connection,
    event: &CalendarEvent,
    usn: i64,
) -> CoreResult<()> {
    let (rec_freq, rec_interval, rec_weekdays_json, rec_until, rec_count, rec_exdates_json) =
        match &event.recurrence {
            Some(rec) => (
                Some(rec.freq.as_str()),
                i64::from(rec.interval.max(1)),
                serde_json::to_string(&rec.weekdays).map_err(err)?,
                rec.until_date.clone(),
                rec.count.map(i64::from),
                serde_json::to_string(&rec.exdates).map_err(err)?,
            ),
            None => (None, 1_i64, "[]".to_string(), None, None, "[]".to_string()),
        };

    conn.execute(
        "INSERT INTO calendar_events
         (id, user_id, title, description, location, color_token, start_ms, end_ms, is_all_day,
          recurrence_freq, recurrence_interval, recurrence_weekdays_json, recurrence_until_date,
          recurrence_count, recurrence_exdates_json, linked_task_id, external_account_id,
          external_event_id, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
         ON CONFLICT(id) DO UPDATE SET
             user_id = excluded.user_id,
             title = excluded.title,
             description = excluded.description,
             location = excluded.location,
             color_token = excluded.color_token,
             start_ms = excluded.start_ms,
             end_ms = excluded.end_ms,
             is_all_day = excluded.is_all_day,
             recurrence_freq = excluded.recurrence_freq,
             recurrence_interval = excluded.recurrence_interval,
             recurrence_weekdays_json = excluded.recurrence_weekdays_json,
             recurrence_until_date = excluded.recurrence_until_date,
             recurrence_count = excluded.recurrence_count,
             recurrence_exdates_json = excluded.recurrence_exdates_json,
             linked_task_id = excluded.linked_task_id,
             external_account_id = excluded.external_account_id,
             external_event_id = excluded.external_event_id,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             usn = excluded.usn",
        params![
            event.id,
            event.user_id,
            event.title,
            event.description,
            event.location,
            event.color_token,
            event.start_ms,
            event.end_ms,
            i64::from(event.is_all_day),
            rec_freq,
            rec_interval,
            rec_weekdays_json,
            rec_until,
            rec_count,
            rec_exdates_json,
            event.linked_task_id,
            event.external_account_id,
            event.external_event_id,
            event.created_at,
            event.updated_at,
            event.deleted_at,
            usn,
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub fn upsert_calendar_event(conn: &Connection, event: &CalendarEvent) -> CoreResult<()> {
    upsert_calendar_event_with_usn(conn, event, event.usn)
}

pub fn soft_delete_calendar_event(
    conn: &Connection,
    user_id: &str,
    id: &str,
    now_ms: i64,
) -> CoreResult<()> {
    let changed = conn
        .execute(
            "UPDATE calendar_events
             SET deleted_at = ?1, updated_at = ?1, usn = -1
             WHERE user_id = ?2 AND id = ?3 AND deleted_at IS NULL",
            params![now_ms, user_id, id],
        )
        .map_err(err)?;
    if changed == 0 {
        return Err(CoreError::NotFound(format!(
            "calendar event '{id}' not found"
        )));
    }
    Ok(())
}

pub fn restore_calendar_event(
    conn: &Connection,
    user_id: &str,
    id: &str,
    now_ms: i64,
) -> CoreResult<()> {
    let changed = conn
        .execute(
            "UPDATE calendar_events
             SET deleted_at = NULL, updated_at = ?1, usn = -1
             WHERE user_id = ?2 AND id = ?3",
            params![now_ms, user_id, id],
        )
        .map_err(err)?;
    if changed == 0 {
        return Err(CoreError::NotFound(format!(
            "calendar event '{id}' not found"
        )));
    }
    Ok(())
}
