//! Dump the full canonical collection for export.

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::model::{
    CanonicalModel, Card, Deck, DeckConfig, Field, Note, Notetype, Revlog, Template,
};
use rusqlite::{Connection, OptionalExtension};

const FIELD_SEP: char = '\u{1f}';

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

pub fn dump_collection(conn: &Connection) -> CoreResult<CanonicalModel> {
    let created_ms: Option<i64> = conn
        .query_row("SELECT created FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(err)?;
    Ok(CanonicalModel {
        created_ms,
        deck_configs: dump_deck_configs(conn)?,
        decks: dump_decks(conn)?,
        notetypes: dump_notetypes(conn)?,
        fields: dump_fields(conn)?,
        templates: dump_templates(conn)?,
        notes: dump_notes(conn)?,
        cards: dump_cards(conn)?,
        revlog: dump_revlog(conn)?,
    })
}

fn dump_deck_configs(conn: &Connection) -> CoreResult<Vec<DeckConfig>> {
    let mut stmt = conn
        .prepare("SELECT id, name, mod, usn, config FROM deck_config")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(DeckConfig {
                id: r.get(0)?,
                name: r.get(1)?,
                mod_ms: r.get::<_, i64>(2)?,
                usn: r.get(3)?,
                config_json: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

fn dump_decks(conn: &Connection) -> CoreResult<Vec<Deck>> {
    let mut stmt = conn
        .prepare(
            r#"SELECT id, name, parent_id, config_id, "mod", usn, collapsed, is_filtered
               FROM decks ORDER BY id"#,
        )
        .map_err(err)?;
    let rows = stmt
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
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

fn dump_notetypes(conn: &Connection) -> CoreResult<Vec<Notetype>> {
    let mut stmt = conn
        .prepare("SELECT id, name, kind, mod, usn, config FROM notetypes ORDER BY id")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Notetype {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
                mod_ms: r.get::<_, i64>(3)?,
                usn: r.get(4)?,
                config_json: r
                    .get::<_, Option<String>>(5)?
                    .unwrap_or_else(|| "{}".into()),
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

fn dump_fields(conn: &Connection) -> CoreResult<Vec<Field>> {
    let mut stmt = conn
        .prepare("SELECT notetype_id, ord, name, config FROM fields ORDER BY notetype_id, ord")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Field {
                notetype_id: r.get(0)?,
                ord: r.get(1)?,
                name: r.get(2)?,
                config_json: r
                    .get::<_, Option<String>>(3)?
                    .unwrap_or_else(|| "{}".into()),
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

fn dump_templates(conn: &Connection) -> CoreResult<Vec<Template>> {
    let mut stmt = conn
        .prepare(
            "SELECT notetype_id, ord, name, qfmt, afmt, config
             FROM templates ORDER BY notetype_id, ord",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Template {
                notetype_id: r.get(0)?,
                ord: r.get(1)?,
                name: r.get(2)?,
                qfmt: r.get(3)?,
                afmt: r.get(4)?,
                config_json: r
                    .get::<_, Option<String>>(5)?
                    .unwrap_or_else(|| "{}".into()),
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

fn dump_notes(conn: &Connection) -> CoreResult<Vec<Note>> {
    let mut stmt = conn
        .prepare(
            r#"SELECT id, guid, notetype_id, "mod", usn, tags, fields, sort_field, checksum
               FROM notes ORDER BY id"#,
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            let tags: String = r.get(5)?;
            let fields: String = r.get(6)?;
            Ok(Note {
                id: r.get(0)?,
                guid: r.get(1)?,
                notetype_id: r.get(2)?,
                mod_ms: r.get(3)?,
                usn: r.get(4)?,
                tags: tags.split_whitespace().map(str::to_string).collect(),
                fields: fields.split(FIELD_SEP).map(str::to_string).collect(),
                sort_field: r.get(7)?,
                checksum: r.get(8)?,
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

fn dump_cards(conn: &Connection) -> CoreResult<Vec<Card>> {
    let mut stmt = conn
        .prepare(
            r#"SELECT id, note_id, deck_id, ord, "mod", usn, type, queue, due, interval,
                      ease_factor, reps, lapses, remaining, original_due, original_deck_id,
                      flags, fsrs_stability, fsrs_difficulty, fsrs_last_review, data
               FROM cards ORDER BY id"#,
        )
        .map_err(err)?;
    let rows = stmt
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
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

fn dump_revlog(conn: &Connection) -> CoreResult<Vec<Revlog>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, card_id, usn, ease, interval, last_interval,
                    ease_factor, taken_ms, review_kind
             FROM revlog ORDER BY id",
        )
        .map_err(err)?;
    let rows = stmt
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
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

#[cfg(test)]
mod tests {
    use bibalak_core::ports::*;
    use bibalak_core::productivity::{
        entity_id_v5, CalendarEvent, Habit, HabitFrequencyKind, HabitGoalMode, HabitLog,
        HabitSection, MatrixGroupBy, MatrixListFilter, MatrixQuadrant, MatrixSortBy, QuadrantKey,
        QuadrantRule, TaskItem, TaskList, TaskPriority,
    };
    use bibalak_core::progress::NIL_USER_ID;

    use crate::SqliteStorage;

    #[test]
    fn anki_dump_collection_excludes_all_productivity_tables() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(1_700_000_000_000).unwrap();

        let list_id = "11111111-1111-4111-8111-111111111111".to_string();
        let task_id = "22222222-2222-4222-8222-222222222222".to_string();
        let habit_id = "33333333-3333-4333-8333-333333333333".to_string();
        let event_id = "44444444-4444-4444-8444-444444444444".to_string();

        storage
            .upsert_task_list(&TaskList {
                id: list_id.clone(),
                user_id: NIL_USER_ID.into(),
                name: "ISOLATED_LIST_SENTINEL".into(),
                color_token: "accent".into(),
                icon_key: None,
                sort_order: 0,
                created_at: 1_000,
                updated_at: 1_000,
                deleted_at: None,
                usn: -1,
            })
            .unwrap();
        storage
            .upsert_task(&TaskItem {
                id: task_id.clone(),
                user_id: NIL_USER_ID.into(),
                list_id: Some(list_id),
                title: "ISOLATED_TASK_SENTINEL".into(),
                notes: String::new(),
                priority: TaskPriority::High,
                manual_quadrant: None,
                due_date: None,
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                completed_at: None,
                completed_day: None,
                sort_order: 0,
                created_at: 1_000,
                updated_at: 1_000,
                deleted_at: None,
                usn: -1,
            })
            .unwrap();
        storage
            .upsert_matrix_quadrant(&MatrixQuadrant {
                id: entity_id_v5("matrix_quadrant", NIL_USER_ID, "q1"),
                user_id: NIL_USER_ID.into(),
                quadrant_key: QuadrantKey::Q1,
                title: "ISOLATED_QUADRANT_SENTINEL".into(),
                color_token: "danger".into(),
                group_by: MatrixGroupBy::None,
                sort_by: MatrixSortBy::Date,
                rule: QuadrantRule {
                    lists: MatrixListFilter::All,
                    date_filters: None,
                    priorities: None,
                    types: None,
                    pinned_deck_ids: vec![],
                    excluded_deck_ids: vec![],
                },
                created_at: 0,
                updated_at: 2_000,
                deleted_at: None,
                usn: -1,
            })
            .unwrap();
        storage
            .upsert_habit(&Habit {
                id: habit_id.clone(),
                user_id: NIL_USER_ID.into(),
                title: "ISOLATED_HABIT_SENTINEL".into(),
                notes: String::new(),
                icon_key: "check-circle".into(),
                color_token: "accent".into(),
                frequency_kind: HabitFrequencyKind::Daily,
                weekdays: vec![],
                weekly_target: None,
                interval_days: None,
                goal_mode: HabitGoalMode::AchieveAll,
                goal_target: 1.0,
                goal_unit: String::new(),
                start_day_index: 0,
                target_days: None,
                section: HabitSection::Morning,
                reminders: vec![],
                auto_popup_log: false,
                deck_id: None,
                archived_at: None,
                sort_order: 0,
                created_at: 1_000,
                updated_at: 1_000,
                deleted_at: None,
                usn: -1,
            })
            .unwrap();
        storage
            .upsert_habit_log(
                &HabitLog {
                    id: entity_id_v5("habit_log", NIL_USER_ID, &format!("{habit_id}:0")),
                    user_id: NIL_USER_ID.into(),
                    habit_id: habit_id.clone(),
                    day_index: 0,
                    logged_value: 1.0,
                    goal_target: 1.0,
                    completed: true,
                    status: bibalak_core::productivity::HabitLogStatus::Logged,
                    mood: None,
                    note: "ISOLATED_LOG_SENTINEL".into(),
                    created_at: 1_000,
                    updated_at: 1_000,
                    deleted_at: None,
                    usn: -1,
                },
                None,
                None,
            )
            .unwrap();
        storage
            .upsert_calendar_event(&CalendarEvent {
                id: event_id.clone(),
                user_id: NIL_USER_ID.into(),
                title: "ISOLATED_EVENT_SENTINEL".into(),
                description: String::new(),
                location: String::new(),
                color_token: "accent".into(),
                start_ms: 1_000,
                end_ms: 2_000,
                is_all_day: false,
                recurrence: None,
                linked_task_id: Some(task_id.clone()),
                external_account_id: None,
                external_event_id: None,
                created_at: 1_000,
                updated_at: 1_000,
                deleted_at: None,
                usn: -1,
            })
            .unwrap();

        let dumped = storage.dump_collection().unwrap();
        let json = serde_json::to_string(&dumped).unwrap();
        for sentinel in [
            "ISOLATED_LIST_SENTINEL",
            "ISOLATED_TASK_SENTINEL",
            "ISOLATED_QUADRANT_SENTINEL",
            "ISOLATED_HABIT_SENTINEL",
            "ISOLATED_LOG_SENTINEL",
            "ISOLATED_EVENT_SENTINEL",
        ] {
            assert!(
                !json.contains(sentinel),
                "CanonicalModel dump must exclude {sentinel}"
            );
        }

        // Full Bibalak backup_db must retain all productivity tables and rows.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let backup_path = std::env::temp_dir().join(format!("keepsake_m1_backup_{nanos}.sqlite"));
        storage.backup_db(&backup_path).unwrap();
        let restored = SqliteStorage::open(&backup_path).unwrap();
        assert_eq!(restored.list_task_lists(NIL_USER_ID).unwrap().len(), 1);
        assert!(restored.get_task(NIL_USER_ID, &task_id).unwrap().is_some());
        assert!(restored
            .get_habit(NIL_USER_ID, &habit_id)
            .unwrap()
            .is_some());
        assert_eq!(
            restored
                .list_habit_logs_range(NIL_USER_ID, 0, 0)
                .unwrap()
                .len(),
            1
        );
        assert!(restored
            .get_calendar_event(NIL_USER_ID, &event_id)
            .unwrap()
            .is_some());
        assert_eq!(
            restored
                .list_matrix_quadrants(NIL_USER_ID)
                .unwrap()
                .into_iter()
                .find(|q| q.quadrant_key == QuadrantKey::Q1)
                .unwrap()
                .title,
            "ISOLATED_QUADRANT_SENTINEL"
        );
        drop(restored);
        let _ = std::fs::remove_file(&backup_path);
    }
}
