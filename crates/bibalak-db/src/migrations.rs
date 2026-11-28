//! Migration runner. Uses SQLite's `user_version` pragma as the schema
//! revision and applies any pending [`schema::MIGRATIONS`] inside a transaction.

use std::path::{Path, PathBuf};

use bibalak_core::error::{CoreError, CoreResult};
use rusqlite::{Connection, MAIN_DB};

use crate::schema::MIGRATIONS;

const MAX_SAFETY_COPIES: usize = 3;

fn user_version(conn: &Connection) -> CoreResult<i64> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| CoreError::Storage(e.to_string()))
}

fn safety_copy_path(db_path: &Path, from_version: i64) -> PathBuf {
    let dir = db_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let stem = db_path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("collection");
    dir.join(format!("{stem}.pre-v{from_version}.sqlite"))
}

fn parse_pre_version(stem: &str, name: &str) -> Option<i64> {
    let prefix = format!("{stem}.pre-v");
    let rest = name.strip_prefix(&prefix)?.strip_suffix(".sqlite")?;
    rest.parse::<i64>().ok()
}

fn rotate_safety_copies(db_path: &Path, keep: usize) -> CoreResult<()> {
    let dir = db_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let stem = db_path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("collection");

    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(());
    };
    let mut copies: Vec<(i64, u128, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(ver) = parse_pre_version(stem, &name) else {
            continue;
        };
        let modified_ns = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        copies.push((ver, modified_ns, entry.path()));
    }
    // Sort newest first by schema version, then modified timestamp, then path.
    copies.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| b.1.cmp(&a.1))
            .then_with(|| b.2.cmp(&a.2))
    });
    for (_, _, old_path) in copies.into_iter().skip(keep) {
        let _ = std::fs::remove_file(old_path);
    }
    Ok(())
}

/// Apply every migration newer than the database's current `user_version`.
/// Refuses databases newer than `MIGRATIONS.len()` with
/// [`CoreError::SchemaTooNew`] without writing.
pub fn run(conn: &mut Connection) -> CoreResult<()> {
    run_with_backup(conn, None)
}

/// Like [`run`], and when `db_path` is provided and an existing database (`user_version > 0`)
/// has pending migrations, writes a consistent SQLite Online Backup copy
/// (`<stem>.pre-v<N>.sqlite`) beside `db_path` before migrating, keeping the latest 3 copies.
pub fn run_with_backup(conn: &mut Connection, db_path: Option<&Path>) -> CoreResult<()> {
    let current = user_version(conn)?;
    let target = MIGRATIONS.len() as i64;

    if current > target {
        return Err(CoreError::SchemaTooNew {
            found: current,
            supported: target,
        });
    }

    if current > 0 && current < target {
        if let Some(path) = db_path {
            let backup_path = safety_copy_path(path, current);
            conn.backup(
                MAIN_DB,
                &backup_path,
                None::<fn(rusqlite::backup::Progress)>,
            )
            .map_err(|e| CoreError::Storage(e.to_string()))?;
            rotate_safety_copies(path, MAX_SAFETY_COPIES)?;
        }
    }

    for version in current..target {
        let sql = MIGRATIONS[version as usize];
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        tx.execute_batch(sql)
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        if version + 1 == 5 {
            backfill_fields_norm(&tx)?;
        }
        if version + 1 == 15 {
            seed_motivation_settings(&tx)?;
        }
        // PRAGMA can't be parameterised; the value is a trusted loop counter.
        tx.pragma_update(None, "user_version", version + 1)
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        tx.commit().map_err(|e| CoreError::Storage(e.to_string()))?;
    }
    Ok(())
}

fn seed_motivation_settings(tx: &rusqlite::Transaction<'_>) -> CoreResult<()> {
    let map_err = |e: rusqlite::Error| CoreError::Storage(e.to_string());
    let user_id = bibalak_core::progress::NIL_USER_ID;
    let id = bibalak_core::motivation::motivation_settings_id(user_id);
    let created: i64 = tx
        .query_row(
            "SELECT COALESCE((SELECT created FROM collection WHERE id = 1), 0)",
            [],
            |r| r.get(0),
        )
        .map_err(map_err)?;
    let has_data: bool = tx
        .query_row(
            "SELECT (
                EXISTS (SELECT 1 FROM notes)
                OR EXISTS (SELECT 1 FROM revlog)
                OR EXISTS (SELECT 1 FROM tasks)
                OR EXISTS (SELECT 1 FROM habits)
                OR EXISTS (SELECT 1 FROM progress_ledger)
            )",
            [],
            |r| r.get(0),
        )
        .map_err(map_err)?;
    let onboarding_completed_at = has_data.then_some(created);
    tx.execute(
        "INSERT OR IGNORE INTO motivation_settings
         (id, user_id, daily_goal_xp, onboarding_completed_at, created_at, updated_at, deleted_at, usn)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, NULL, 0)",
        rusqlite::params![
            id,
            user_id,
            i64::from(bibalak_core::motivation::DEFAULT_DAILY_GOAL_XP),
            onboarding_completed_at,
            created
        ],
    )
    .map_err(map_err)?;
    Ok(())
}

fn backfill_fields_norm(tx: &rusqlite::Transaction<'_>) -> CoreResult<()> {
    let map_err = |e: rusqlite::Error| CoreError::Storage(e.to_string());
    let rows: Vec<(i64, String, Option<String>)> = {
        let mut stmt = tx
            .prepare("SELECT id, fields, sort_field FROM notes")
            .map_err(map_err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(map_err)?
            .collect::<rusqlite::Result<_>>()
            .map_err(map_err)?;
        rows
    };
    let mut update = tx
        .prepare("UPDATE notes SET fields_norm = ?1 WHERE id = ?2")
        .map_err(map_err)?;
    for (id, fields, sort_field) in rows {
        let norm = crate::search::fields_norm_value(&fields, sort_field.as_deref());
        update
            .execute(rusqlite::params![norm, id])
            .map_err(map_err)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `EXPLAIN QUERY PLAN` detail lines for `sql`.
    fn plan(conn: &Connection, sql: &str) -> String {
        let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(3))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        rows.join(" | ")
    }

    /// An existing v3 collection upgrades in place: the index appears and the
    /// cards are untouched.
    #[test]
    fn v3_collection_upgrades_to_v4_keeping_cards() {
        let mut conn = Connection::open_in_memory().unwrap();
        for (version, sql) in MIGRATIONS.iter().take(3).enumerate() {
            conn.execute_batch(sql).unwrap();
            conn.pragma_update(None, "user_version", version as i64 + 1)
                .unwrap();
        }
        conn.execute_batch(
            r#"INSERT INTO notetypes (id, name, kind, "mod", usn, config) VALUES (10, 'Basic', 0, 0, 0, '{}');
               INSERT INTO notes (id, guid, notetype_id, "mod", usn, tags, fields) VALUES (100, 'g', 10, 0, 0, '', 'a');
               INSERT INTO cards (id, note_id, deck_id, ord, "mod", type, queue, due) VALUES (1000, 100, 1, 0, 0, 2, 2, 7);"#,
        )
        .unwrap();

        run(&mut conn).unwrap();

        assert_eq!(user_version(&conn).unwrap(), MIGRATIONS.len() as i64);
        let has_index: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_cards_study'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_index, 1);
        let due: i64 = conn
            .query_row("SELECT due FROM cards WHERE id = 1000", [], |r| r.get(0))
            .unwrap();
        assert_eq!(due, 7);
    }

    /// ADR-005: "studied today" starts from today's slice of the review log
    /// (its primary key is the review timestamp), not from every card of the
    /// deck.
    #[test]
    fn today_studied_scans_only_todays_reviews() {
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn).unwrap();
        let p = plan(
            &conn,
            &crate::study::TODAY_STUDIED_SQL
                .replace("?1", "1")
                .replace("?2", "0"),
        );
        let first = p
            .split(" | ")
            .find(|step| step.starts_with("SEARCH") || step.starts_with("SCAN"))
            .unwrap_or_default();
        assert!(
            first.contains("SEARCH r USING INTEGER PRIMARY KEY (rowid>?)")
                || first.contains("SEARCH r USING COVERING INDEX idx_revlog_stats (id>?)"),
            "today_studied should start from revlog's id range, plan: {p}"
        );
    }

    /// ADR-005: the study queue, per-deck counts and the deck list read only
    /// the covering index, never the card rows.
    #[test]
    fn study_queries_use_the_covering_study_index() {
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn).unwrap();
        let queries = [
            // study_queue: due learning, new, reviews, learn-ahead
            "SELECT id FROM cards WHERE deck_id = 1 AND queue NOT IN (-1,-2,-3) AND type IN (1, 3) AND due <= 5 ORDER BY due",
            "SELECT id, ROW_NUMBER() OVER (ORDER BY due) FROM cards WHERE deck_id = 1 AND queue NOT IN (-1,-2,-3) AND type = 0",
            "SELECT id FROM cards WHERE deck_id = 1 AND queue NOT IN (-1,-2,-3) AND type = 2 AND due <= 5 ORDER BY RANDOM() LIMIT 10",
            // count_due_by_type
            "SELECT COUNT(*) FROM cards WHERE deck_id = 1 AND queue NOT IN (-1,-2,-3) AND type = 2 AND due <= 5",
            // deck_due_counts (home screen)
            "SELECT deck_id, SUM(CASE WHEN type = 0 THEN 1 ELSE 0 END) FROM cards WHERE queue NOT IN (-1, -2, -3) GROUP BY deck_id",
        ];
        for sql in queries {
            let p = plan(&conn, sql);
            assert!(
                p.contains("COVERING INDEX idx_cards_study"),
                "expected the covering study index for:\n  {sql}\nplan: {p}"
            );
        }
    }

    #[test]
    fn v4_collection_upgrades_to_v5_backfilling_fields_norm() {
        let mut conn = Connection::open_in_memory().unwrap();
        for (version, sql) in MIGRATIONS.iter().take(4).enumerate() {
            conn.execute_batch(sql).unwrap();
            conn.pragma_update(None, "user_version", version as i64 + 1)
                .unwrap();
        }
        conn.execute_batch(
            r#"INSERT INTO notetypes (id, name, kind, "mod", usn, config) VALUES (10, 'Basic', 0, 0, 0, '{}');
               INSERT INTO notes (id, guid, notetype_id, "mod", usn, tags, fields, sort_field)
               VALUES (100, 'g1', 10, 0, 0, '', 'الإسلام' || char(31) || 'مَدْرَسَة', 'الإسلام');
               INSERT INTO notes (id, guid, notetype_id, "mod", usn, tags, fields, sort_field)
               VALUES (101, 'g2', 10, 0, 0, '', 'café', 'café');"#,
        )
        .unwrap();

        run(&mut conn).unwrap();

        assert_eq!(user_version(&conn).unwrap(), MIGRATIONS.len() as i64);
        let norm_100: String = conn
            .query_row("SELECT fields_norm FROM notes WHERE id = 100", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(norm_100.contains("الاسلام"));
        assert!(norm_100.contains("مدرسه"));

        let norm_101: String = conn
            .query_row("SELECT fields_norm FROM notes WHERE id = 101", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(norm_101, "cafe");
    }

    #[test]
    fn v5_collection_upgrades_to_v6_with_revlog_stats_index() {
        let mut conn = Connection::open_in_memory().unwrap();
        for (version, sql) in MIGRATIONS.iter().take(5).enumerate() {
            conn.execute_batch(sql).unwrap();
            conn.pragma_update(None, "user_version", version as i64 + 1)
                .unwrap();
        }
        conn.execute_batch(
            "INSERT INTO revlog (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
             VALUES (1700000000000, 42, 0, 3, 10, 5, 2500, 3500, 1);",
        )
        .unwrap();

        run(&mut conn).unwrap();

        assert_eq!(user_version(&conn).unwrap(), MIGRATIONS.len() as i64);
        let kept: (i64, i64, i64) = conn
            .query_row(
                "SELECT card_id, ease, taken_ms FROM revlog WHERE id = 1700000000000",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(kept, (42, 3, 3500));

        let stats_plan = plan(
            &conn,
            "SELECT id, card_id FROM revlog WHERE id >= 1700000000000",
        );
        assert!(
            stats_plan.contains("COVERING INDEX idx_revlog_stats"),
            "stats scan should use covering revlog stats index, plan: {stats_plan}"
        );

        let new_q_plan = plan(
            &conn,
            "SELECT id FROM (
                 SELECT id, ROW_NUMBER() OVER (ORDER BY due) AS rank
                 FROM cards WHERE deck_id = 1 AND queue NOT IN (-1,-2,-3) AND type = 0
                 ORDER BY due LIMIT 25
             ) ORDER BY rank + ((RANDOM() & 2147483647) % 5), id LIMIT 20",
        );
        assert!(
            new_q_plan.contains("COVERING INDEX idx_cards_study"),
            "bounded new-card queue should use covering study index, plan: {new_q_plan}"
        );
    }

    #[test]
    fn v6_collection_upgrades_to_v7_with_sync_state_table() {
        let mut conn = Connection::open_in_memory().unwrap();
        for (version, sql) in MIGRATIONS.iter().take(6).enumerate() {
            conn.execute_batch(sql).unwrap();
            conn.pragma_update(None, "user_version", version as i64 + 1)
                .unwrap();
        }

        run(&mut conn).unwrap();

        assert_eq!(user_version(&conn).unwrap(), MIGRATIONS.len() as i64);
        let has_table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'sync_state'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_table, 1, "migration v7 must create sync_state table");

        conn.execute(
            "INSERT INTO sync_state (key, value) VALUES (?1, ?2)",
            ["cursor", "12345"],
        )
        .unwrap();
        let val: String = conn
            .query_row(
                "SELECT value FROM sync_state WHERE key = ?1",
                ["cursor"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(val, "12345");
    }

    #[test]
    fn v7_collection_upgrades_to_v8_with_grave_times_table_and_backfills_graves() {
        let mut conn = Connection::open_in_memory().unwrap();
        for (version, sql) in MIGRATIONS.iter().take(7).enumerate() {
            conn.execute_batch(sql).unwrap();
            conn.pragma_update(None, "user_version", version as i64 + 1)
                .unwrap();
        }

        // Insert legacy graves and collection row with modified timestamp
        conn.execute(
            "INSERT INTO collection (id, created, modified, schema_mod, anki_ver, usn, last_sync, config)
             VALUES (1, 1000, 1700000000500, 1000, 18, 0, 0, '{}')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO graves (oid, type, usn) VALUES (101, 1, -1), (202, 0, -1)",
            [],
        )
        .unwrap();

        run(&mut conn).unwrap();

        assert_eq!(user_version(&conn).unwrap(), MIGRATIONS.len() as i64);
        let has_table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'grave_times'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_table, 1, "migration v8 must create grave_times table");

        // Backfill check: both graves must have been copied into grave_times
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM grave_times", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            count, 2,
            "existing graves must be backfilled into grave_times"
        );

        let del_ms: i64 = conn
            .query_row(
                "SELECT deleted_ms FROM grave_times WHERE oid = 101 AND type = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            del_ms > 0,
            "backfilled deleted_ms must be positive, got {del_ms}"
        );
    }

    #[test]
    fn v8_collection_upgrades_to_v9_with_progress_ledger_table_and_unique_key() {
        let mut conn = Connection::open_in_memory().unwrap();
        for (version, sql) in MIGRATIONS.iter().take(8).enumerate() {
            conn.execute_batch(sql).unwrap();
            conn.pragma_update(None, "user_version", version as i64 + 1)
                .unwrap();
        }

        run(&mut conn).unwrap();

        assert_eq!(user_version(&conn).unwrap(), MIGRATIONS.len() as i64);
        let has_table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'progress_ledger'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            has_table, 1,
            "migration v9 must create progress_ledger table"
        );

        let user_id = bibalak_core::progress::NIL_USER_ID;
        let source_key = "card_review:1:0";
        let id = bibalak_core::progress::ledger_id(user_id, source_key);

        conn.execute(
            "INSERT INTO progress_ledger
             (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
             VALUES (?1, ?2, ?3, 3, 25, 1000, 1000, NULL, -1)",
            rusqlite::params![id, user_id, source_key],
        )
        .unwrap();

        // Duplicate (user_id, source_key) must fail UNIQUE constraint
        let dup = conn.execute(
            "INSERT INTO progress_ledger
             (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
             VALUES ('other-id', ?1, ?2, 3, 25, 2000, 2000, NULL, -1)",
            rusqlite::params![user_id, source_key],
        );
        assert!(dup.is_err(), "duplicate (user_id, source_key) must fail");

        // Negative xp or gold_cents must fail CHECK constraint
        let neg_xp = conn.execute(
            "INSERT INTO progress_ledger
             (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
             VALUES ('neg-xp', ?1, 'card_review:2:0', -1, 25, 1000, 1000, NULL, -1)",
            rusqlite::params![user_id],
        );
        assert!(neg_xp.is_err(), "negative xp must fail CHECK");

        let neg_gold = conn.execute(
            "INSERT INTO progress_ledger
             (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
             VALUES ('neg-gold', ?1, 'card_review:3:0', 1, -25, 1000, 1000, NULL, -1)",
            rusqlite::params![user_id],
        );
        assert!(neg_gold.is_err(), "negative gold_cents must fail CHECK");

        // Soft-delete (deleted_at) and re-activation (deleted_at = NULL)
        conn.execute(
            "UPDATE progress_ledger SET deleted_at = 1500, updated_at = 1500 WHERE id = ?1",
            [&id],
        )
        .unwrap();
        let del_at: Option<i64> = conn
            .query_row(
                "SELECT deleted_at FROM progress_ledger WHERE id = ?1",
                [&id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(del_at, Some(1500));

        conn.execute(
            "UPDATE progress_ledger SET deleted_at = NULL, updated_at = 2000 WHERE id = ?1",
            [&id],
        )
        .unwrap();
        let reactivated: Option<i64> = conn
            .query_row(
                "SELECT deleted_at FROM progress_ledger WHERE id = ?1",
                [&id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(reactivated, None);
    }

    #[test]
    fn v14_to_v15_migrates_and_seeds_settings_with_v5_id() {
        let mut conn = Connection::open_in_memory().unwrap();
        for (version, sql) in MIGRATIONS.iter().take(14).enumerate() {
            conn.execute_batch(sql).unwrap();
            conn.pragma_update(None, "user_version", version as i64 + 1)
                .unwrap();
        }

        run(&mut conn).unwrap();

        assert_eq!(user_version(&conn).unwrap(), MIGRATIONS.len() as i64);
        let expected_id =
            bibalak_core::motivation::motivation_settings_id(bibalak_core::progress::NIL_USER_ID);
        let (id, goal, usn): (String, i64, i64) = conn
            .query_row(
                "SELECT id, daily_goal_xp, usn FROM motivation_settings WHERE user_id = ?1",
                [bibalak_core::progress::NIL_USER_ID],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(id, expected_id);
        assert_eq!(goal, 10);
        assert_eq!(usn, 0);
    }

    #[test]
    fn existing_collection_skips_onboarding_new_one_does_not() {
        // New empty collection: onboarding_completed_at stays NULL.
        let mut fresh = Connection::open_in_memory().unwrap();
        run(&mut fresh).unwrap();
        let fresh_done: Option<i64> = fresh
            .query_row(
                "SELECT onboarding_completed_at FROM motivation_settings WHERE user_id = ?1",
                [bibalak_core::progress::NIL_USER_ID],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fresh_done, None);

        // Existing v14 collection with a note: onboarding_completed_at is seeded non-NULL.
        let mut existing = Connection::open_in_memory().unwrap();
        for (version, sql) in MIGRATIONS.iter().take(14).enumerate() {
            existing.execute_batch(sql).unwrap();
            existing
                .pragma_update(None, "user_version", version as i64 + 1)
                .unwrap();
        }
        existing
            .execute_batch(
                "INSERT INTO collection (id, created, modified, schema_mod, anki_ver, usn, last_sync, config)
                 VALUES (1, 1700000000000, 1700000000000, 1700000000000, 18, 0, 0, '{}');
                 INSERT INTO notetypes (id, name, kind, \"mod\", usn, config) VALUES (1, 'Basic', 0, 0, 0, '{}');
                 INSERT INTO notes (id, guid, notetype_id, \"mod\", usn, tags, fields)
                 VALUES (1, 'g1', 1, 0, 0, '', 'Q' || char(31) || 'A');",
            )
            .unwrap();

        run(&mut existing).unwrap();
        let existing_done: Option<i64> = existing
            .query_row(
                "SELECT onboarding_completed_at FROM motivation_settings WHERE user_id = ?1",
                [bibalak_core::progress::NIL_USER_ID],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(existing_done, Some(1_700_000_000_000));
    }

    #[test]
    fn pending_migration_makes_safety_copy_first() {
        let dir = H2TempDir::new("pending_safety_copy");
        let db_path = dir.path().join("collection.sqlite");
        {
            let conn = Connection::open(&db_path).unwrap();
            for (version, sql) in MIGRATIONS.iter().take(11).enumerate() {
                conn.execute_batch(sql).unwrap();
                conn.pragma_update(None, "user_version", version as i64 + 1)
                    .unwrap();
            }
        }

        let mut conn = Connection::open(&db_path).unwrap();
        run_with_backup(&mut conn, Some(&db_path)).unwrap();

        assert_eq!(user_version(&conn).unwrap(), MIGRATIONS.len() as i64);
        let copy_path = dir.path().join("collection.pre-v11.sqlite");
        assert!(copy_path.is_file(), "pre-v11 safety copy must exist");
        let copy_conn = Connection::open(&copy_path).unwrap();
        assert_eq!(user_version(&copy_conn).unwrap(), 11);
    }

    #[test]
    fn keeps_only_three_safety_copies() {
        let dir = H2TempDir::new("three_safety_copies");
        let db_path = dir.path().join("collection.sqlite");
        for ver in [8_i64, 9, 10] {
            std::fs::write(
                dir.path().join(format!("collection.pre-v{ver}.sqlite")),
                b"old",
            )
            .unwrap();
        }
        {
            let conn = Connection::open(&db_path).unwrap();
            for (version, sql) in MIGRATIONS.iter().take(11).enumerate() {
                conn.execute_batch(sql).unwrap();
                conn.pragma_update(None, "user_version", version as i64 + 1)
                    .unwrap();
            }
        }

        let mut conn = Connection::open(&db_path).unwrap();
        run_with_backup(&mut conn, Some(&db_path)).unwrap();

        assert!(!dir.path().join("collection.pre-v8.sqlite").exists());
        assert!(dir.path().join("collection.pre-v9.sqlite").exists());
        assert!(dir.path().join("collection.pre-v10.sqlite").exists());
        assert!(dir.path().join("collection.pre-v11.sqlite").exists());
    }

    #[test]
    fn newer_schema_refused_without_writes() {
        let dir = H2TempDir::new("newer_schema_refused");
        let db_path = dir.path().join("collection.sqlite");
        {
            let mut conn = Connection::open(&db_path).unwrap();
            run(&mut conn).unwrap();
            conn.pragma_update(None, "user_version", 99_i64).unwrap();
        }

        let err = match crate::SqliteStorage::open(&db_path) {
            Err(err) => err,
            Ok(_) => panic!("expected SchemaTooNew error"),
        };
        assert!(matches!(
            err,
            CoreError::SchemaTooNew {
                found: 99,
                supported
            } if supported == MIGRATIONS.len() as i64
        ));

        let check = Connection::open(&db_path).unwrap();
        assert_eq!(user_version(&check).unwrap(), 99);
        assert!(!dir.path().join("collection.pre-v99.sqlite").exists());
    }

    struct H2TempDir(PathBuf);

    impl H2TempDir {
        fn new(label: &str) -> Self {
            static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let dir = std::env::temp_dir()
                .join(format!("keepsake_h2_{label}_{}_{n}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for H2TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn migration_v10_on_disk_to_v15_creates_safety_copy_and_preserves_all_data() {
        use bibalak_core::ports::*;
        use bibalak_core::productivity::HabitLogStatus;
        use bibalak_core::progress::NIL_USER_ID;

        let dir = H2TempDir::new("mig_v10");
        let db_path = dir.path().join("collection.sqlite");
        let t0: i64 = 1_700_000_000_000;

        {
            let conn = Connection::open(&db_path).unwrap();
            for (version, sql) in MIGRATIONS.iter().take(10).enumerate() {
                conn.execute_batch(sql).unwrap();
                conn.pragma_update(None, "user_version", version as i64 + 1)
                    .unwrap();
            }
            conn.execute_batch(&format!(
                r#"
                INSERT INTO collection (id, created, modified, schema_mod, anki_ver, usn, last_sync, config)
                VALUES (1, {t0}, {t0}, {t0}, 18, 0, 0, '{{}}');
                INSERT INTO decks (id, name, parent_id, config_id, "mod", usn)
                VALUES (2, 'Biology', NULL, 1, {t0}, 0);
                INSERT INTO notetypes (id, name, kind, "mod", usn, config)
                VALUES (10, 'Basic', 0, {t0}, 0, '{{}}');
                INSERT INTO fields (notetype_id, ord, name, config)
                VALUES (10, 0, 'Front', '{{}}'), (10, 1, 'Back', '{{}}');
                INSERT INTO templates (notetype_id, ord, name, qfmt, afmt, config)
                VALUES (10, 0, 'Card 1', '{{{{Front}}}}', '{{{{Back}}}}', '{{}}');
                INSERT INTO notes (id, guid, notetype_id, "mod", usn, tags, fields)
                VALUES (100, 'guid-v10-100', 10, {t0}, 0, ' bio ', 'Mitochondria' || char(31) || 'Powerhouse');
                INSERT INTO cards (id, note_id, deck_id, ord, "mod", usn, type, queue, due, interval, ease_factor, reps)
                VALUES (200, 100, 2, 0, {t0}, 0, 2, 2, 5, 7, 2500, 3);
                INSERT INTO revlog (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
                VALUES (1700000000123, 200, 0, 3, 7, 1, 2500, 4200, 1);
                INSERT INTO task_lists (id, user_id, name, color_token, sort_order, created_at, updated_at, usn)
                VALUES ('tl-v10', '{NIL_USER_ID}', 'Study', 'accent', 0, {t0}, {t0}, 0);
                INSERT INTO tasks (id, user_id, list_id, title, priority, deck_id, sort_order, created_at, updated_at, usn)
                VALUES ('task-v10', '{NIL_USER_ID}', 'tl-v10', 'Review bio', 'high', 2, 0, {t0}, {t0}, 0);
                INSERT INTO habits (id, user_id, title, start_day_index, deck_id, sort_order, created_at, updated_at, usn)
                VALUES ('hab-v10', '{NIL_USER_ID}', 'Daily deck', 0, 2, 0, {t0}, {t0}, 0);
                INSERT INTO habit_logs (id, user_id, habit_id, day_index, logged_value, goal_target, completed, created_at, updated_at, usn)
                VALUES ('hlog-v10', '{NIL_USER_ID}', 'hab-v10', 10, 1.0, 1.0, 1, {t0}, {t0}, 0);
                "#
            ))
            .unwrap();
        }

        let storage = crate::SqliteStorage::open(&db_path).unwrap();

        // Pre-migration safety copy was written before upgrading v10 -> v15.
        let copy_path = dir.path().join("collection.pre-v10.sqlite");
        assert!(copy_path.is_file(), "pre-v10 safety copy must exist");
        let copy_conn = Connection::open(&copy_path).unwrap();
        assert_eq!(user_version(&copy_conn).unwrap(), 10);
        drop(copy_conn);

        {
            let conn = storage.lock();
            assert_eq!(user_version(&conn).unwrap(), MIGRATIONS.len() as i64);
            let rev_count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM revlog WHERE id = 1700000000123 AND card_id = 200",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(rev_count, 1);
            let done_at: Option<i64> = conn
                .query_row(
                    "SELECT onboarding_completed_at FROM motivation_settings WHERE user_id = ?1",
                    [NIL_USER_ID],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(done_at, Some(t0));
        }

        let decks = storage.list_decks().unwrap();
        assert!(decks.iter().any(|d| d.id == 2 && d.name == "Biology"));

        let note = storage.note_detail(100).unwrap().expect("note 100");
        let field_vals: Vec<&str> = note.fields.iter().map(|f| f.value.as_str()).collect();
        assert_eq!(field_vals, vec!["Mitochondria", "Powerhouse"]);
        assert_eq!(note.tags, vec!["bio"]);

        let card = storage.study_card(200).unwrap().expect("card 200");
        assert_eq!(card.deck_id, 2);
        assert_eq!(card.state.reps, 3);

        let lists = storage.list_task_lists(NIL_USER_ID).unwrap();
        assert_eq!(lists.len(), 1);
        assert_eq!(lists[0].name, "Study");

        let tasks = storage.list_tasks(NIL_USER_ID, true).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "Review bio");

        let habits = storage.list_habits(NIL_USER_ID, true).unwrap();
        assert_eq!(habits.len(), 1);
        assert_eq!(habits[0].title, "Daily deck");

        let logs = storage.list_habit_logs_range(NIL_USER_ID, 10, 10).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].status, HabitLogStatus::Logged);
    }

    #[test]
    fn opening_user_version_99_is_refused_with_schema_too_new_without_writes() {
        let dir = H2TempDir::new("future_v99");
        let db_path = dir.path().join("collection.sqlite");
        {
            let mut conn = Connection::open(&db_path).unwrap();
            run(&mut conn).unwrap();
            conn.pragma_update(None, "user_version", 99_i64).unwrap();
        }

        let err = match crate::SqliteStorage::open(&db_path) {
            Err(err) => err,
            Ok(_) => panic!("expected SchemaTooNew error"),
        };
        assert!(matches!(
            err,
            CoreError::SchemaTooNew {
                found: 99,
                supported
            } if supported == MIGRATIONS.len() as i64
        ));

        let check = Connection::open(&db_path).unwrap();
        assert_eq!(user_version(&check).unwrap(), 99);
        assert!(!dir.path().join("collection.pre-v99.sqlite").exists());
    }

    #[test]
    fn migration_v15_on_disk_to_v16_creates_notes_sort_field_index() {
        let dir = H2TempDir::new("mig_v15");
        let db_path = dir.path().join("collection.sqlite");
        {
            let conn = Connection::open(&db_path).unwrap();
            for (version, sql) in MIGRATIONS.iter().take(15).enumerate() {
                conn.execute_batch(sql).unwrap();
                conn.pragma_update(None, "user_version", version as i64 + 1)
                    .unwrap();
            }
            conn.execute_batch(
                r#"
                INSERT INTO notetypes (id, name, kind, "mod", usn, config)
                VALUES (1, 'Basic', 0, 1000, 0, '{}');
                INSERT INTO notes (id, guid, notetype_id, "mod", usn, tags, fields, sort_field)
                VALUES (1, 'guid-v15-1', 1, 1000, 0, '', 'Alpha' || char(31) || 'Beta', 'Alpha');
                "#,
            )
            .unwrap();
        }

        let storage = crate::SqliteStorage::open(&db_path).unwrap();
        let conn = storage.lock();
        assert_eq!(user_version(&conn).unwrap(), MIGRATIONS.len() as i64);
        let idx_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_notes_sort_field'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(idx_count, 1);
        let sort_field: String = conn
            .query_row("SELECT sort_field FROM notes WHERE id = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(sort_field, "Alpha");
    }
}
