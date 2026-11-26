use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::TagCount;
use rusqlite::{params, Connection, OptionalExtension};

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

/// Insert any unseen tag names into `tags` (marked `usn = -1` for sync).
pub(crate) fn register_tags<'a>(
    conn: &Connection,
    tags: impl IntoIterator<Item = &'a str>,
) -> CoreResult<()> {
    let unique: std::collections::BTreeSet<&'a str> = tags
        .into_iter()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .collect();
    if unique.is_empty() {
        return Ok(());
    }
    let mut stmt = conn
        .prepare_cached("INSERT OR IGNORE INTO tags (name, usn, expanded) VALUES (?1, -1, 0)")
        .map_err(err)?;
    for tag in unique {
        stmt.execute([tag]).map_err(err)?;
    }
    Ok(())
}

/// Normalize and deduplicate tags for note storage (trimmed, non-empty, case-folded deduplication).
pub fn normalize_tags<'a>(tags: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for tag in tags {
        let trimmed = tag.trim();
        if !trimmed.is_empty() {
            let key = trimmed.to_lowercase();
            if seen.insert(key) {
                result.push(trimmed.to_string());
            }
        }
    }
    result
}

pub(crate) const TAG_REGISTRY_BACKFILLED_KEY: &str = "tagRegistryBackfilled";

/// Scan `notes.tags` and insert any missing tags into `tags` (`usn = -1`,
/// `expanded = 0`) in one savepoint/transaction. Streams rows without loading
/// all notes into memory and never modifies `notes.tags`. Idempotent.
pub(crate) fn backfill_tag_registry(conn: &Connection) -> CoreResult<()> {
    conn.execute_batch("SAVEPOINT backfill_tag_registry")
        .map_err(err)?;
    let res = (|| -> CoreResult<()> {
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut select = conn
            .prepare("SELECT tags FROM notes WHERE tags != ''")
            .map_err(err)?;
        let mut insert = conn
            .prepare_cached("INSERT OR IGNORE INTO tags (name, usn, expanded) VALUES (?1, -1, 0)")
            .map_err(err)?;
        let mut rows = select.query([]).map_err(err)?;
        while let Some(row) = rows.next().map_err(err)? {
            let blob = row.get_ref(0).map_err(err)?.as_str().map_err(err)?;
            for tag in blob.split_whitespace() {
                if !seen.contains(tag) {
                    insert.execute([tag]).map_err(err)?;
                    seen.insert(tag.to_owned());
                }
            }
        }
        Ok(())
    })();
    match res {
        Ok(()) => conn
            .execute_batch("RELEASE SAVEPOINT backfill_tag_registry")
            .map_err(err),
        Err(e) => {
            let _ = conn.execute_batch(
                "ROLLBACK TO SAVEPOINT backfill_tag_registry; RELEASE SAVEPOINT backfill_tag_registry;",
            );
            Err(e)
        }
    }
}

/// Run [`backfill_tag_registry`] once per collection, guarded by
/// `collection.config["tagRegistryBackfilled"]`. Leaves `collection.modified`
/// and `collection.usn` untouched so sync state is not marked dirty.
pub(crate) fn backfill_tag_registry_once(conn: &Connection) -> CoreResult<()> {
    let json: String = conn
        .query_row("SELECT config FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(err)?
        .unwrap_or_else(|| "{}".to_string());
    let mut v: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
    if v[TAG_REGISTRY_BACKFILLED_KEY].as_bool() == Some(true) {
        return Ok(());
    }
    backfill_tag_registry(conn)?;
    if !v.is_object() {
        v = serde_json::json!({});
    }
    v[TAG_REGISTRY_BACKFILLED_KEY] = serde_json::Value::Bool(true);
    conn.execute(
        "UPDATE collection SET config = ?1 WHERE id = 1",
        [v.to_string()],
    )
    .map_err(err)?;
    Ok(())
}

/// All distinct tag names from the `tags` registry, sorted.
pub fn list_tags(conn: &Connection) -> CoreResult<Vec<String>> {
    let mut stmt = conn
        .prepare("SELECT name FROM tags ORDER BY name")
        .map_err(err)?;
    let names: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    Ok(names)
}

/// All tags in the registry paired with the number of notes carrying each tag, sorted by name.
pub fn list_tag_counts(conn: &Connection) -> CoreResult<Vec<TagCount>> {
    let names = list_tags(conn)?;
    let mut counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let mut stmt = conn
        .prepare("SELECT tags FROM notes WHERE tags != ''")
        .map_err(err)?;
    let mut rows = stmt.query([]).map_err(err)?;
    while let Some(row) = rows.next().map_err(err)? {
        let blob = row.get_ref(0).map_err(err)?.as_str().map_err(err)?;
        let mut seen_on_note: std::collections::HashSet<&str> = std::collections::HashSet::new();
        for tag in blob.split_whitespace() {
            if seen_on_note.insert(tag) {
                *counts.entry(tag.to_owned()).or_insert(0) += 1;
            }
        }
    }
    Ok(names
        .into_iter()
        .map(|name| TagCount {
            count: counts.get(&name).copied().unwrap_or(0),
            name,
        })
        .collect())
}

/// Rename `old_tag` to `new_tag` in every note's tag blob and update the
/// registry. Returns the number of notes affected.
pub fn rename_tag(conn: &Connection, old_tag: &str, new_tag: &str, now_ms: i64) -> CoreResult<u32> {
    let old_needle = format!(" {old_tag} ");
    let new_needle = format!(" {new_tag} ");
    let n = conn
        .execute(
            r#"UPDATE notes SET tags = replace(tags, ?1, ?2), "mod" = ?3, usn = -1
               WHERE instr(tags, ?1) > 0"#,
            params![old_needle, new_needle, now_ms],
        )
        .map_err(err)?;
    conn.execute("DELETE FROM tags WHERE name = ?1", [old_tag])
        .map_err(err)?;
    register_tags(conn, [new_tag])?;
    Ok(n as u32)
}

/// Remove `tag` from every note's tag blob and from the registry.
/// Returns the number of notes affected.
pub fn delete_tag(conn: &Connection, tag: &str, now_ms: i64) -> CoreResult<u32> {
    let needle = format!(" {tag} ");
    let n = conn
        .execute(
            r#"UPDATE notes SET tags = replace(tags, ?1, ' '), "mod" = ?2, usn = -1
               WHERE instr(tags, ?1) > 0"#,
            params![needle, now_ms],
        )
        .map_err(err)?;
    conn.execute("DELETE FROM tags WHERE name = ?1", [tag])
        .map_err(err)?;
    Ok(n as u32)
}

/// Rename each `sources` tag to `target` (and dedup the `target` if already
/// present). Idempotent if `sources` contains `target`.
pub fn merge_tags(
    conn: &Connection,
    sources: &[String],
    target: &str,
    now_ms: i64,
) -> CoreResult<()> {
    for src in sources {
        if src != target {
            rename_tag(conn, src, target, now_ms)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::SqliteStorage;
    use bibalak_core::ports::*;

    fn setup() -> SqliteStorage {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_700_000_000_000).unwrap();
        s
    }

    fn add_note_with_tags(s: &SqliteStorage, note_id: i64, tags_blob: &str) {
        let conn = s.lock();
        conn.execute(
            r#"INSERT INTO notetypes (id, name, kind, "mod", usn) VALUES (1, 'Basic', 0, 0, -1)
               ON CONFLICT DO NOTHING"#,
            [],
        )
        .unwrap();
        conn.execute(
            r#"INSERT OR REPLACE INTO notes (id, guid, notetype_id, "mod", usn, tags, fields)
               VALUES (?1, 'guid1', 1, 0, -1, ?2, 'A\x1fB')"#,
            params![note_id, tags_blob],
        )
        .unwrap();
        for tag in tags_blob.split_whitespace() {
            conn.execute(
                "INSERT OR IGNORE INTO tags (name, usn, expanded) VALUES (?1, -1, 0)",
                [tag],
            )
            .unwrap();
        }
    }

    #[test]
    fn list_tags_returns_registry() {
        let s = setup();
        {
            let conn = s.lock();
            conn.execute(
                "INSERT INTO tags (name, usn, expanded) VALUES ('verb', -1, 0), ('noun', -1, 0)",
                [],
            )
            .unwrap();
            let tags = list_tags(&conn).unwrap();
            assert_eq!(tags, vec!["noun".to_string(), "verb".to_string()]);
        }
    }

    #[test]
    fn rename_tag_updates_notes_and_registry() {
        let s = setup();
        add_note_with_tags(&s, 1, " verb noun ");
        {
            let conn = s.lock();
            let n = rename_tag(&conn, "verb", "v2", 999).unwrap();
            assert_eq!(n, 1);
            let row: String = conn
                .query_row("SELECT tags FROM notes", [], |r| r.get(0))
                .unwrap();
            assert!(row.contains(" v2 "), "tag renamed in notes: {row}");
            let tags = list_tags(&conn).unwrap();
            assert!(tags.contains(&"v2".to_string()));
            assert!(!tags.contains(&"verb".to_string()));
        }
    }

    #[test]
    fn delete_tag_removes_from_notes_and_registry() {
        let s = setup();
        add_note_with_tags(&s, 1, " verb noun ");
        {
            let conn = s.lock();
            let n = delete_tag(&conn, "verb", 999).unwrap();
            assert_eq!(n, 1);
            let row: String = conn
                .query_row("SELECT tags FROM notes", [], |r| r.get(0))
                .unwrap();
            assert!(!row.contains(" verb "), "tag removed from notes: {row}");
            let tags = list_tags(&conn).unwrap();
            assert!(!tags.contains(&"verb".to_string()));
        }
    }

    #[test]
    fn merge_tags_renames_sources_to_target() {
        let s = setup();
        add_note_with_tags(&s, 1, " v1 noun ");
        add_note_with_tags(&s, 2, " v2 noun ");
        {
            let conn = s.lock();
            merge_tags(&conn, &["v1".to_string(), "v2".to_string()], "verb", 999).unwrap();
            let n: i64 = conn
                .query_row(
                    "SELECT count(*) FROM notes WHERE instr(tags, ' verb ') > 0",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 2, "both notes should have verb tag");
        }
    }

    #[test]
    fn ensure_collection_and_integrity_check_backfill_empty_tag_registry() {
        let s = setup();
        // Simulate a pre-5a collection: notes carry tags, `tags` table is empty,
        // and `collection.config` has no backfill flag yet.
        {
            let conn = s.lock();
            conn.execute(
                r#"INSERT INTO notetypes (id, name, kind, "mod", usn) VALUES (1, 'Basic', 0, 0, -1)
                   ON CONFLICT DO NOTHING"#,
                [],
            )
            .unwrap();
            conn.execute(
                r#"INSERT INTO notes (id, guid, notetype_id, "mod", usn, tags, fields)
                   VALUES (1, 'g1', 1, 0, -1, ' verb spanish ', 'A\x1fB'),
                          (2, 'g2', 1, 0, -1, ' grammar::tense verb ', 'C\x1fD')"#,
                [],
            )
            .unwrap();
            conn.execute(
                "UPDATE collection SET modified = 111, usn = 0, config = '{}' WHERE id = 1",
                [],
            )
            .unwrap();
            assert!(list_tags(&conn).unwrap().is_empty());
        }

        // First open / ensure runs the one-time backfill without dirtying sync metadata.
        s.ensure_collection(1_700_000_000_999).unwrap();
        {
            let conn = s.lock();
            assert_eq!(
                list_tags(&conn).unwrap(),
                vec![
                    "grammar::tense".to_string(),
                    "spanish".to_string(),
                    "verb".to_string()
                ]
            );
            let (modified, usn, cfg): (i64, i64, String) = conn
                .query_row(
                    "SELECT modified, usn, config FROM collection WHERE id = 1",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .unwrap();
            assert_eq!(
                modified, 111,
                "backfill flag must not bump collection.modified"
            );
            assert_eq!(usn, 0, "backfill flag must not mark collection usn dirty");
            let v: serde_json::Value = serde_json::from_str(&cfg).unwrap();
            assert_eq!(v["tagRegistryBackfilled"], serde_json::json!(true));

            // Simulate removing a registry row after backfill: startup should NOT
            // re-scan because the flag is set.
            conn.execute("DELETE FROM tags WHERE name = 'spanish'", [])
                .unwrap();
        }
        s.ensure_collection(1_700_000_001_000).unwrap();
        assert_eq!(
            s.list_tags().unwrap(),
            vec!["grammar::tense".to_string(), "verb".to_string()],
            "startup after backfill checks flag only"
        );

        // Running Check database restores missing tags idempotently.
        assert!(s.integrity_check(1_000).unwrap().is_empty());
        assert_eq!(
            s.list_tags().unwrap(),
            vec![
                "grammar::tense".to_string(),
                "spanish".to_string(),
                "verb".to_string()
            ]
        );
    }

    #[test]
    fn backfill_tag_registry_is_idempotent_and_preserves_notes() {
        let s = setup();
        {
            let conn = s.lock();
            conn.execute(
                r#"INSERT INTO notetypes (id, name, kind, "mod", usn) VALUES (1, 'Basic', 0, 0, -1)
                   ON CONFLICT DO NOTHING"#,
                [],
            )
            .unwrap();
            conn.execute(
                r#"INSERT INTO notes (id, guid, notetype_id, "mod", usn, tags, fields)
                   VALUES (1, 'g1', 1, 0, -1, ' alpha beta ', 'A\x1fB'),
                          (2, 'g2', 1, 0, -1, ' beta gamma ', 'C\x1fD'),
                          (3, 'g3', 1, 0, -1, '', 'E\x1fF')"#,
                [],
            )
            .unwrap();

            backfill_tag_registry(&conn).unwrap();
            let first: Vec<(String, i64, i64)> = {
                let mut stmt = conn
                    .prepare("SELECT name, usn, expanded FROM tags ORDER BY name")
                    .unwrap();
                stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                    .unwrap()
                    .map(|r| r.unwrap())
                    .collect()
            };
            assert_eq!(
                first,
                vec![
                    ("alpha".to_string(), -1, 0),
                    ("beta".to_string(), -1, 0),
                    ("gamma".to_string(), -1, 0),
                ]
            );

            // Second run changes nothing (still same rows and notes.tags untouched).
            backfill_tag_registry(&conn).unwrap();
            assert_eq!(
                list_tags(&conn).unwrap(),
                vec!["alpha".to_string(), "beta".to_string(), "gamma".to_string()]
            );
            let note1_tags: String = conn
                .query_row("SELECT tags FROM notes WHERE id = 1", [], |r| r.get(0))
                .unwrap();
            assert_eq!(note1_tags, " alpha beta ");
        }
    }

    #[test]
    fn backfill_tag_registry_10k_notes_under_one_second() {
        let s = setup();
        {
            let mut conn = s.lock();
            conn.execute(
                r#"INSERT INTO notetypes (id, name, kind, "mod", usn) VALUES (1, 'Basic', 0, 0, -1)
                   ON CONFLICT DO NOTHING"#,
                [],
            )
            .unwrap();
            let tx = conn.transaction().unwrap();
            {
                let mut stmt = tx
                    .prepare(
                        r#"INSERT INTO notes (id, guid, notetype_id, "mod", usn, tags, fields)
                           VALUES (?1, ?2, 1, 0, -1, ?3, 'Q\x1fA')"#,
                    )
                    .unwrap();
                for i in 0..10_000_i64 {
                    let t1 = i % 200;
                    let t2 = (i * 7 + 3) % 200;
                    stmt.execute(params![i + 1, format!("g-{i}"), format!(" t{t1} t{t2} ")])
                        .unwrap();
                }
            }
            tx.commit().unwrap();
        }
        let conn = s.lock();
        let start = std::time::Instant::now();
        backfill_tag_registry(&conn).unwrap();
        let elapsed = start.elapsed();
        assert_eq!(list_tags(&conn).unwrap().len(), 200);
        assert!(
            elapsed < std::time::Duration::from_secs(1),
            "10k tag backfill took {elapsed:?}"
        );
    }

    #[test]
    fn list_tag_counts_returns_note_counts_per_tag() {
        let s = setup();
        add_note_with_tags(&s, 1, " verb spanish ");
        add_note_with_tags(&s, 2, " verb ");
        {
            let conn = s.lock();
            conn.execute(
                "INSERT INTO tags (name, usn, expanded) VALUES ('empty_tag', -1, 0)",
                [],
            )
            .unwrap();
            let result = list_tag_counts(&conn).unwrap();
            assert_eq!(
                result,
                vec![
                    TagCount {
                        name: "empty_tag".into(),
                        count: 0,
                    },
                    TagCount {
                        name: "spanish".into(),
                        count: 1,
                    },
                    TagCount {
                        name: "verb".into(),
                        count: 2,
                    },
                ]
            );
        }
    }
}
