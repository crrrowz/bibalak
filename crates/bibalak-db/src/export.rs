//! Dump the full canonical collection for export.

use std::collections::HashSet;

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::model::{
    CanonicalModel, Card, Deck, DeckConfig, Field, Note, Notetype, Revlog, Template,
};
use rusqlite::{Connection, OptionalExtension};

const FIELD_SEP: char = '\u{1f}';

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

fn card_scope_sql(alias: &str, deck_ids_csv: &str) -> String {
    let prefix = if alias.is_empty() {
        String::new()
    } else {
        format!("{alias}.")
    };
    format!(
        "({prefix}deck_id IN ({deck_ids_csv}) OR ({prefix}original_deck_id != 0 AND {prefix}original_deck_id IN ({deck_ids_csv})))"
    )
}

pub fn dump_collection(conn: &Connection) -> CoreResult<CanonicalModel> {
    dump_collection_scoped(conn, None, true)
}

pub fn dump_collection_scoped(
    conn: &Connection,
    deck_ids: Option<&[i64]>,
    include_revlog: bool,
) -> CoreResult<CanonicalModel> {
    let created_ms: Option<i64> = conn
        .query_row("SELECT created FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(err)?;

    let Some(ids) = deck_ids else {
        return Ok(CanonicalModel {
            created_ms,
            deck_configs: dump_deck_configs(conn, None)?,
            decks: dump_decks(conn, None)?,
            notetypes: dump_notetypes(conn, None)?,
            fields: dump_fields(conn, None)?,
            templates: dump_templates(conn, None)?,
            notes: dump_notes(conn, None)?,
            cards: dump_cards(conn, None, None)?,
            revlog: if include_revlog {
                dump_revlog(conn, None)?
            } else {
                Vec::new()
            },
        });
    };

    if ids.is_empty() {
        return Ok(CanonicalModel {
            created_ms,
            ..Default::default()
        });
    }

    let id_list = ids
        .iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let id_set: HashSet<i64> = ids.iter().copied().collect();
    let filter = Some(id_list.as_str());

    Ok(CanonicalModel {
        created_ms,
        deck_configs: dump_deck_configs(conn, filter)?,
        decks: dump_decks(conn, filter)?,
        notetypes: dump_notetypes(conn, filter)?,
        fields: dump_fields(conn, filter)?,
        templates: dump_templates(conn, filter)?,
        notes: dump_notes(conn, filter)?,
        cards: dump_cards(conn, filter, Some(&id_set))?,
        revlog: if include_revlog {
            dump_revlog(conn, filter)?
        } else {
            Vec::new()
        },
    })
}

fn dump_deck_configs(conn: &Connection, deck_filter: Option<&str>) -> CoreResult<Vec<DeckConfig>> {
    let sql = match deck_filter {
        Some(ids) => format!(
            "SELECT id, name, mod, usn, config FROM deck_config
             WHERE id IN (SELECT DISTINCT config_id FROM decks WHERE id IN ({ids}))"
        ),
        None => "SELECT id, name, mod, usn, config FROM deck_config".to_string(),
    };
    let mut stmt = conn.prepare(&sql).map_err(err)?;
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

fn dump_decks(conn: &Connection, deck_filter: Option<&str>) -> CoreResult<Vec<Deck>> {
    let sql = match deck_filter {
        Some(ids) => format!(
            r#"SELECT id, name, parent_id, config_id, "mod", usn, collapsed, is_filtered
               FROM decks WHERE id IN ({ids}) ORDER BY id"#
        ),
        None => r#"SELECT id, name, parent_id, config_id, "mod", usn, collapsed, is_filtered
               FROM decks ORDER BY id"#
            .to_string(),
    };
    let mut stmt = conn.prepare(&sql).map_err(err)?;
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

fn dump_notetypes(conn: &Connection, deck_filter: Option<&str>) -> CoreResult<Vec<Notetype>> {
    let sql = match deck_filter {
        Some(ids) => format!(
            "SELECT id, name, kind, mod, usn, config FROM notetypes
             WHERE id IN (
                 SELECT DISTINCT n.notetype_id FROM notes n
                 JOIN cards c ON c.note_id = n.id
                 WHERE {}
             )
             ORDER BY id",
            card_scope_sql("c", ids)
        ),
        None => "SELECT id, name, kind, mod, usn, config FROM notetypes ORDER BY id".to_string(),
    };
    let mut stmt = conn.prepare(&sql).map_err(err)?;
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

fn dump_fields(conn: &Connection, deck_filter: Option<&str>) -> CoreResult<Vec<Field>> {
    let sql = match deck_filter {
        Some(ids) => format!(
            "SELECT notetype_id, ord, name, config FROM fields
             WHERE notetype_id IN (
                 SELECT DISTINCT n.notetype_id FROM notes n
                 JOIN cards c ON c.note_id = n.id
                 WHERE {}
             )
             ORDER BY notetype_id, ord",
            card_scope_sql("c", ids)
        ),
        None => "SELECT notetype_id, ord, name, config FROM fields ORDER BY notetype_id, ord"
            .to_string(),
    };
    let mut stmt = conn.prepare(&sql).map_err(err)?;
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

fn dump_templates(conn: &Connection, deck_filter: Option<&str>) -> CoreResult<Vec<Template>> {
    let sql = match deck_filter {
        Some(ids) => format!(
            "SELECT notetype_id, ord, name, qfmt, afmt, config
             FROM templates
             WHERE notetype_id IN (
                 SELECT DISTINCT n.notetype_id FROM notes n
                 JOIN cards c ON c.note_id = n.id
                 WHERE {}
             )
             ORDER BY notetype_id, ord",
            card_scope_sql("c", ids)
        ),
        None => "SELECT notetype_id, ord, name, qfmt, afmt, config
             FROM templates ORDER BY notetype_id, ord"
            .to_string(),
    };
    let mut stmt = conn.prepare(&sql).map_err(err)?;
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

fn dump_notes(conn: &Connection, deck_filter: Option<&str>) -> CoreResult<Vec<Note>> {
    let sql = match deck_filter {
        Some(ids) => format!(
            r#"SELECT id, guid, notetype_id, "mod", usn, tags, fields, sort_field, checksum
               FROM notes
               WHERE id IN (SELECT DISTINCT note_id FROM cards WHERE {})
               ORDER BY id"#,
            card_scope_sql("", ids)
        ),
        None => r#"SELECT id, guid, notetype_id, "mod", usn, tags, fields, sort_field, checksum
               FROM notes ORDER BY id"#
            .to_string(),
    };
    let mut stmt = conn.prepare(&sql).map_err(err)?;
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

fn dump_cards(
    conn: &Connection,
    deck_filter: Option<&str>,
    scoped_ids: Option<&HashSet<i64>>,
) -> CoreResult<Vec<Card>> {
    let sql = match deck_filter {
        Some(ids) => format!(
            r#"SELECT id, note_id, deck_id, ord, "mod", usn, type, queue, due, interval,
                      ease_factor, reps, lapses, remaining, original_due, original_deck_id,
                      flags, fsrs_stability, fsrs_difficulty, fsrs_last_review, data
               FROM cards WHERE {} ORDER BY id"#,
            card_scope_sql("", ids)
        ),
        None => r#"SELECT id, note_id, deck_id, ord, "mod", usn, type, queue, due, interval,
                      ease_factor, reps, lapses, remaining, original_due, original_deck_id,
                      flags, fsrs_stability, fsrs_difficulty, fsrs_last_review, data
               FROM cards ORDER BY id"#
            .to_string(),
    };
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            let mut card = Card {
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
            };
            // Like Anki rslib/src/export/package.rs: when exporting a home deck,
            // cards temporarily placed in a filtered deck export under their home deck.
            if let Some(ids) = scoped_ids {
                if !ids.contains(&card.deck_id)
                    && card.original_deck_id != 0
                    && ids.contains(&card.original_deck_id)
                {
                    card.deck_id = card.original_deck_id;
                    card.original_deck_id = 0;
                    if card.original_due != 0 {
                        card.due = card.original_due;
                        card.original_due = 0;
                    }
                }
            }
            Ok(card)
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

fn dump_revlog(conn: &Connection, deck_filter: Option<&str>) -> CoreResult<Vec<Revlog>> {
    let sql = match deck_filter {
        Some(ids) => format!(
            "SELECT id, card_id, usn, ease, interval, last_interval,
                    ease_factor, taken_ms, review_kind
             FROM revlog
             WHERE card_id IN (SELECT id FROM cards WHERE {})
             ORDER BY id",
            card_scope_sql("", ids)
        ),
        None => "SELECT id, card_id, usn, ease, interval, last_interval,
                    ease_factor, taken_ms, review_kind
             FROM revlog ORDER BY id"
            .to_string(),
    };
    let mut stmt = conn.prepare(&sql).map_err(err)?;
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

    #[test]
    fn scoped_dump_isolates_deck_and_partial_split_notes_and_skips_revlog() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(1_700_000_000_000).unwrap();

        let parent = storage.create_deck("Lang", 1_000).unwrap().id;
        let child = storage.create_deck("Lang::Verbs", 1_000).unwrap().id;
        let sibling = storage.create_deck("History", 1_000).unwrap().id;

        let nt_basic = storage
            .list_notetypes()
            .unwrap()
            .into_iter()
            .find(|n| n.name == "Basic")
            .unwrap()
            .id;
        let nt_rev = storage
            .list_notetypes()
            .unwrap()
            .into_iter()
            .find(|n| n.name == "Basic (and reversed card)")
            .unwrap()
            .id;

        // Multi-card note split across Lang::Verbs (card 0) and History (card 1).
        let (split_note_id, _) = storage
            .add_note_with_cards(nt_rev, child, &["hola".into(), "hello".into()], &[], 2_000)
            .unwrap();
        let split_cards: Vec<i64> = storage
            .dump_collection()
            .unwrap()
            .cards
            .into_iter()
            .filter(|c| c.note_id == split_note_id)
            .map(|c| c.id)
            .collect();
        assert_eq!(split_cards.len(), 2);
        storage
            .move_cards_to_deck(&[split_cards[1]], sibling, 2_100)
            .unwrap();

        // Sibling-only note using Basic notetype.
        storage
            .add_note_with_cards(
                nt_basic,
                sibling,
                &["1914".into(), "WWI".into()],
                &[],
                2_200,
            )
            .unwrap();

        // Add revlog entries for both cards.
        {
            let conn = storage.lock();
            conn.execute(
                "INSERT INTO revlog (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
                 VALUES (?1, ?2, 0, 3, 1, 0, 2500, 1200, 0),
                        (?3, ?4, 0, 3, 1, 0, 2500, 1300, 0)",
                rusqlite::params![900_001i64, split_cards[0], 900_002i64, split_cards[1]],
            )
            .unwrap();
        }

        let scoped_with_sched = storage
            .dump_collection_scoped(Some(&[parent, child]), true)
            .unwrap();
        assert_eq!(scoped_with_sched.decks.len(), 2);
        assert!(scoped_with_sched.decks.iter().all(|d| d.id != sibling));
        assert_eq!(scoped_with_sched.cards.len(), 1);
        assert_eq!(scoped_with_sched.cards[0].id, split_cards[0]);
        assert_eq!(scoped_with_sched.notes.len(), 1);
        assert_eq!(scoped_with_sched.notes[0].id, split_note_id);
        assert_eq!(scoped_with_sched.notetypes.len(), 1);
        assert_eq!(scoped_with_sched.notetypes[0].id, nt_rev);
        assert_eq!(scoped_with_sched.revlog.len(), 1);
        assert_eq!(scoped_with_sched.revlog[0].card_id, split_cards[0]);

        let scoped_no_sched = storage
            .dump_collection_scoped(Some(&[parent, child]), false)
            .unwrap();
        assert!(scoped_no_sched.revlog.is_empty());
    }

    #[test]
    fn a2_22_deck_export_includes_filtered_deck_cards_at_home_deck() {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_000).unwrap();
        let nt_id = s.create_notetype("DeckExp", 0, 1_000).unwrap();
        let home_deck = s.create_deck("Home", 1_000).unwrap().id;
        let (_nid, _) = s
            .add_note_with_cards(
                nt_id,
                home_deck,
                &["Front".into(), "Back".into()],
                &[],
                1_000,
            )
            .unwrap();
        {
            let conn = s.lock();
            conn.execute(
                r#"INSERT INTO decks (id, name, parent_id, config_id, "mod", usn, collapsed, is_filtered)
                   VALUES (50, 'Cram', NULL, 1, 1000, -1, 0, 1)"#,
                [],
            )
            .unwrap();
            conn.execute(
                "UPDATE cards SET deck_id = 50, original_deck_id = ?1, original_due = 7 WHERE deck_id = ?1",
                [home_deck],
            )
            .unwrap();
        }
        let scoped = s.dump_collection_scoped(Some(&[home_deck]), false).unwrap();
        assert_eq!(scoped.cards.len(), 1);
        assert_eq!(scoped.cards[0].deck_id, home_deck);
        assert_eq!(scoped.cards[0].original_deck_id, 0);
        assert_eq!(scoped.cards[0].due, 7);
        assert_eq!(scoped.notes.len(), 1);
        assert_eq!(scoped.notetypes.len(), 1);
    }
}
