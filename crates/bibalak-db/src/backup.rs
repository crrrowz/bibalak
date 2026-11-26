use std::{
    collections::{BTreeMap, BTreeSet},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::media_refs::{extract_media_refs, rewrite_media_refs};
use rusqlite::{params, Connection, MAIN_DB};

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

/// Hot-copy the main database to `dest_path` using SQLite's online backup API.
/// Safe to call while the DB is in active use.
pub fn backup_db(conn: &Connection, dest_path: &Path) -> CoreResult<()> {
    conn.backup(MAIN_DB, dest_path, None::<fn(rusqlite::backup::Progress)>)
        .map_err(err)
}

/// Run `PRAGMA integrity_check`. Returns empty vec on a healthy database,
/// or a list of error strings otherwise.
/// Also inspects and repairs orphan subdecks (decks with `::` in their name
/// whose parent decks are missing or unlinked), reporting repairs performed.
pub fn integrity_check(conn: &mut Connection, now_ms: i64) -> CoreResult<Vec<String>> {
    let mut stmt = conn.prepare("PRAGMA integrity_check").map_err(err)?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
    let mut results = Vec::new();
    for row in rows {
        let s = row.map_err(err)?;
        if s != "ok" {
            results.push(s);
        }
    }
    drop(stmt);
    if results.is_empty() {
        let repaired = repair_orphan_subdecks(conn, now_ms)?;
        if repaired > 0 {
            results.push(format!(
                "Repaired {repaired} orphan subdeck(s): created missing parent decks"
            ));
        }
    }
    Ok(results)
}

/// Check for subdecks (`A::B`) that are missing their parent decks or have an unlinked
/// `parent_id`. Synthesizes any missing ancestor deck levels and updates `parent_id`.
/// Returns the number of orphan subdecks repaired. Runs in a single transaction.
pub fn repair_orphan_subdecks(conn: &mut Connection, now_ms: i64) -> CoreResult<usize> {
    let tx = conn.transaction().map_err(err)?;

    let mut stmt = tx
        .prepare("SELECT id, name, parent_id FROM decks")
        .map_err(err)?;
    let deck_rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<i64>>(2)?,
            ))
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    drop(stmt);

    let mut name_to_id: BTreeMap<String, (i64, Option<i64>)> = BTreeMap::new();
    for (id, name, parent_id) in &deck_rows {
        name_to_id.insert(name.clone(), (*id, *parent_id));
    }

    let mut missing_parents = BTreeSet::new();
    for (_, name, _) in &deck_rows {
        let parts: Vec<&str> = name.split("::").collect();
        for i in 1..parts.len() {
            let prefix = parts[..i].join("::");
            if !name_to_id.contains_key(&prefix) {
                missing_parents.insert(prefix);
            }
        }
    }

    let mut sorted_missing: Vec<String> = missing_parents.into_iter().collect();
    sorted_missing.sort_by_key(|n| n.matches("::").count());

    for parent_name in sorted_missing {
        let direct_parent_id = if let Some(idx) = parent_name.rfind("::") {
            let direct_parent_name = &parent_name[..idx];
            name_to_id.get(direct_parent_name).map(|(id, _)| *id)
        } else {
            None
        };

        tx.execute(
            r#"INSERT INTO decks (name, parent_id, config_id, "mod", usn)
               VALUES (?1, ?2, 1, ?3, -1)"#,
            params![parent_name, direct_parent_id, now_ms],
        )
        .map_err(err)?;

        let new_id = tx.last_insert_rowid();
        name_to_id.insert(parent_name, (new_id, direct_parent_id));
    }

    let mut repaired_count = 0;
    for (id, name, current_parent) in &deck_rows {
        if let Some(idx) = name.rfind("::") {
            let expected_parent_name = &name[..idx];
            if let Some((expected_parent_id, _)) = name_to_id.get(expected_parent_name) {
                if current_parent != &Some(*expected_parent_id) {
                    tx.execute(
                        r#"UPDATE decks SET parent_id = ?1, "mod" = ?2, usn = -1 WHERE id = ?3"#,
                        params![expected_parent_id, now_ms, id],
                    )
                    .map_err(err)?;
                    repaired_count += 1;
                }
            }
        }
    }

    tx.commit().map_err(err)?;
    Ok(repaired_count)
}

/// Run `PRAGMA optimize` then `VACUUM` to compact and tune the database.
pub fn optimize(conn: &Connection) -> CoreResult<()> {
    conn.execute_batch("PRAGMA optimize; VACUUM;").map_err(err)
}

/// Extract media filenames referenced in note fields.
/// Matches `<img src="name">`, `<img src='name'>`, and `[sound:name]` patterns.
pub fn note_media_refs(conn: &Connection) -> CoreResult<Vec<String>> {
    Ok(note_media_ref_counts(conn)?
        .into_iter()
        .map(|(name, _)| name)
        .collect())
}

/// Collect distinct-note media ref counts from any query returning a single
/// `fields` text column per distinct note row.
pub(crate) fn collect_media_ref_counts(
    stmt: &mut rusqlite::Statement<'_>,
    params: impl rusqlite::Params,
) -> CoreResult<Vec<(String, u32)>> {
    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
    let rows = stmt
        .query_map(params, |r| r.get::<_, String>(0))
        .map_err(err)?;
    for row in rows {
        let flds = row.map_err(err)?;
        for name in extract_media_refs(&flds) {
            *counts.entry(name).or_insert(0) += 1;
        }
    }
    Ok(counts.into_iter().collect())
}

/// Extract media filenames referenced in note fields, notetype templates, and CSS
/// alongside the count of distinct notes/templates/notetypes referencing each filename.
pub fn note_media_ref_counts(conn: &Connection) -> CoreResult<Vec<(String, u32)>> {
    let mut counts: BTreeMap<String, u32> = BTreeMap::new();

    {
        let mut stmt = conn.prepare("SELECT fields FROM notes").map_err(err)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        for row in rows {
            let flds = row.map_err(err)?;
            for name in extract_media_refs(&flds) {
                *counts.entry(name).or_insert(0) += 1;
            }
        }
    }

    {
        let mut stmt = conn
            .prepare("SELECT qfmt, afmt FROM templates")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?;
        for row in rows {
            let (qfmt, afmt) = row.map_err(err)?;
            let mut refs = extract_media_refs(&qfmt);
            refs.extend(extract_media_refs(&afmt));
            for name in refs {
                *counts.entry(name).or_insert(0) += 1;
            }
        }
    }

    {
        let mut stmt = conn.prepare("SELECT config FROM notetypes").map_err(err)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        for row in rows {
            let cfg = row.map_err(err)?;
            let css = serde_json::from_str::<serde_json::Value>(&cfg)
                .ok()
                .and_then(|v| v.get("css").and_then(|c| c.as_str()).map(str::to_string));
            let target = css.as_deref().unwrap_or(&cfg);
            for name in extract_media_refs(target) {
                *counts.entry(name).or_insert(0) += 1;
            }
        }
    }

    Ok(counts.into_iter().collect())
}

/// Rewrite `<img src="old_name">`, `<img src='old_name'>`, and `[sound:old_name]`
/// across all notes, keeping `sort_field`, `checksum`, and `fields_norm` in sync.
pub fn rewrite_media_ref(
    conn: &Connection,
    old_name: &str,
    new_name: &str,
    now_ms: i64,
) -> CoreResult<u32> {
    if old_name == new_name {
        return Ok(0);
    }
    let notes: Vec<(i64, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT n.id, n.fields, COALESCE(nt.config, '{}')
                 FROM notes n LEFT JOIN notetypes nt ON nt.id = n.notetype_id",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(err)?
            .collect::<rusqlite::Result<_>>()
            .map_err(err)?;
        rows
    };

    let tx = conn.unchecked_transaction().map_err(err)?;
    let mut updated = 0u32;
    {
        let mut update_stmt = tx
            .prepare(
                r#"UPDATE notes
                   SET fields = ?1, sort_field = ?2, checksum = ?3, fields_norm = ?4, "mod" = ?5, usn = -1
                   WHERE id = ?6"#,
            )
            .map_err(err)?;
        for (id, blob, nt_config) in notes {
            let new_blob = rewrite_media_refs(&blob, old_name, new_name);
            if new_blob == blob {
                continue;
            }
            let sort_ord = bibalak_core::ipc::parse_notetype_sort_field(&nt_config) as usize;
            let parts: Vec<String> = new_blob.split('\u{1f}').map(str::to_string).collect();
            let (sort_field, checksum) = crate::browse::compute_sort_and_checksum(&parts, sort_ord);
            let fields_norm = crate::search::fields_norm_value(&new_blob, Some(&sort_field));
            update_stmt
                .execute(params![
                    new_blob,
                    sort_field,
                    checksum,
                    fields_norm,
                    now_ms,
                    id
                ])
                .map_err(err)?;
            updated += 1;
        }
    }
    tx.commit().map_err(err)?;
    Ok(updated)
}

/// Create a `.zip` archive at `zip_path` containing:
/// - `collection.sqlite` (the hot-backup copy at `db_backup`)
/// - all files under `media_dir/` (non-recursive, skipping dirs)
///
/// Returns the archive size in bytes.
pub fn create_zip(db_backup: &Path, media_dir: &Path, zip_path: &Path) -> CoreResult<u64> {
    let file = std::fs::File::create(zip_path).map_err(err)?;
    let mut zip = zip::ZipWriter::new(file);
    let opts: zip::write::FileOptions<()> =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // Add the DB backup.
    zip.start_file("collection.sqlite", opts).map_err(err)?;
    let mut db_bytes = Vec::new();
    std::fs::File::open(db_backup)
        .map_err(err)?
        .read_to_end(&mut db_bytes)
        .map_err(err)?;
    zip.write_all(&db_bytes).map_err(err)?;

    // Add media files (flat, non-recursive).
    if media_dir.is_dir() {
        for entry in std::fs::read_dir(media_dir).map_err(err)? {
            let entry = entry.map_err(err)?;
            if entry.file_type().map_err(err)?.is_file() {
                let name = entry.file_name().to_string_lossy().into_owned();
                zip.start_file(format!("media/{name}"), opts).map_err(err)?;
                let mut bytes = Vec::new();
                std::fs::File::open(entry.path())
                    .map_err(err)?
                    .read_to_end(&mut bytes)
                    .map_err(err)?;
                zip.write_all(&bytes).map_err(err)?;
            }
        }
    }
    zip.finish().map_err(err)?;

    let size = std::fs::metadata(zip_path).map_err(err)?.len();
    Ok(size)
}

/// Validate a SQLite file with `PRAGMA integrity_check`. Returns errors, empty = ok.
pub fn validate_sqlite_file(path: &Path) -> CoreResult<Vec<String>> {
    let mut conn = Connection::open(path).map_err(err)?;
    integrity_check(&mut conn, 0)
}

/// Extract `collection.sqlite` from a backup zip to `dest_path`.
/// Returns an error if the zip doesn't contain the expected file.
pub fn extract_db_from_zip(zip_path: &Path, dest_path: &Path) -> CoreResult<()> {
    let file = std::fs::File::open(zip_path).map_err(err)?;
    let mut archive = zip::ZipArchive::new(file).map_err(err)?;
    let mut entry = archive
        .by_name("collection.sqlite")
        .map_err(|_| CoreError::Storage("backup zip missing collection.sqlite".into()))?;
    let mut out = std::fs::File::create(dest_path).map_err(err)?;
    std::io::copy(&mut entry, &mut out).map_err(err)?;
    Ok(())
}

/// List `.zip` files in `backup_dir`, sorted newest-first.
/// Returns `(filename, modified_ms, size_bytes)`.
pub fn list_zips(backup_dir: &Path) -> CoreResult<Vec<(String, i64, u64)>> {
    if !backup_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries: Vec<(String, i64, u64)> = std::fs::read_dir(backup_dir)
        .map_err(err)?
        .filter_map(|e| {
            let e = e.ok()?;
            let name = e.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".zip") {
                return None;
            }
            let meta = e.metadata().ok()?;
            let size = meta.len();
            let modified = meta
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            Some((name, modified, size))
        })
        .collect();
    entries.sort_by_key(|e| -(e.1)); // newest first (negate ms timestamp)
    Ok(entries)
}

/// Delete oldest zips in `backup_dir` keeping at most `keep` files.
pub fn rotate_backups(backup_dir: &Path, keep: usize) -> CoreResult<()> {
    let mut entries = list_zips(backup_dir)?;
    // entries is newest-first; truncate to keep newest `keep`.
    if entries.len() <= keep {
        return Ok(());
    }
    entries.drain(..keep); // keep the first `keep` (newest)
    for (name, _, _) in entries {
        let _ = std::fs::remove_file(backup_dir.join(name));
    }
    Ok(())
}

/// Full paths helper.
pub fn backup_path(backup_dir: &Path, name: &str) -> PathBuf {
    backup_dir.join(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::SqliteStorage;

    fn make_db() -> SqliteStorage {
        SqliteStorage::open_in_memory().unwrap()
    }

    #[test]
    fn integrity_check_clean_db_returns_ok() {
        let s = make_db();
        let mut conn = s.lock();
        let errs = integrity_check(&mut conn, 1_000).unwrap();
        assert!(errs.is_empty(), "unexpected errors: {errs:?}");
    }

    #[test]
    fn optimize_runs_without_error() {
        let s = make_db();
        let conn = s.lock();
        optimize(&conn).unwrap();
    }

    #[test]
    fn note_media_refs_empty_collection() {
        let s = make_db();
        let conn = s.lock();
        let refs = note_media_refs(&conn).unwrap();
        assert!(refs.is_empty());
    }

    fn seed_note(s: &SqliteStorage, fields: &[&str], now_ms: i64) -> i64 {
        use bibalak_core::ports::*;
        s.ensure_collection(now_ms).unwrap();
        let nt_id = s
            .list_notetypes()
            .unwrap()
            .into_iter()
            .next()
            .map(|n| n.id)
            .unwrap_or_else(|| s.add_stock_notetype(0, now_ms).unwrap());
        let owned: Vec<String> = fields.iter().map(|v| (*v).to_string()).collect();
        s.add_note_with_cards(nt_id, 1, &owned, &[], now_ms)
            .unwrap()
            .0
    }

    #[test]
    fn note_media_ref_counts_counts_distinct_notes_for_img_and_sound() {
        let s = make_db();
        let now_ms = 1_700_000_000_000;
        seed_note(
            &s,
            &[
                r#"q1 <img src="a.png"> <img class="x" src='b.jpg'> [sound:c.mp3]"#,
                r#"<img src="a.png"> <img src="https://example.com/x.png"> <img src="data:image/png;base64,AAA">"#,
            ],
            now_ms,
        );
        seed_note(&s, &[r#"q2 <img src="a.png">"#, "back"], now_ms);

        let conn = s.lock();
        let counts = note_media_ref_counts(&conn).unwrap();
        assert_eq!(
            counts,
            vec![
                ("a.png".to_string(), 2),
                ("b.jpg".to_string(), 1),
                ("c.mp3".to_string(), 1),
            ]
        );
    }

    #[test]
    fn rewrite_media_ref_updates_img_and_sound_without_touching_substrings() {
        let s = make_db();
        let now_ms = 1_700_000_000_000;
        let n1 = seed_note(
            &s,
            &[
                r#"front <img src="a.png"> <img class="pic" src='a.png'> [sound:a.png]"#,
                r#"<img src="extra-a.png"> <img src="a.png.bak">"#,
            ],
            now_ms,
        );

        let updated = {
            let conn = s.lock();
            rewrite_media_ref(&conn, "a.png", "renamed.png", now_ms + 1).unwrap()
        };
        assert_eq!(updated, 1);

        let conn = s.lock();
        let (fields, mod_ms, usn): (String, i64, i64) = conn
            .query_row(
                r#"SELECT fields, "mod", usn FROM notes WHERE id = ?1"#,
                [n1],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert!(fields.contains(r#"<img src="renamed.png">"#));
        assert!(fields.contains(r#"src='renamed.png'"#));
        assert!(fields.contains("[sound:renamed.png]"));
        assert!(fields.contains(r#"src="extra-a.png""#));
        assert!(fields.contains(r#"src="a.png.bak""#));
        assert_eq!(mod_ms, now_ms + 1);
        assert_eq!(usn, -1);
    }

    #[test]
    fn integrity_check_repairs_orphan_subdecks_and_creates_missing_parents() {
        let s = make_db();
        {
            let conn = s.lock();
            // Insert orphan subdecks directly (as happened in OT-09):
            // Deck "Classical Music Themes::Part I" with parent_id = NULL
            conn.execute(
                r#"INSERT INTO decks (name, parent_id, config_id, "mod", usn)
                   VALUES ('Classical Music Themes::Part I', NULL, 1, 100, -1)"#,
                [],
            )
            .unwrap();
            // Deeper orphan: "X::Y::Z" with parent_id = NULL
            conn.execute(
                r#"INSERT INTO decks (name, parent_id, config_id, "mod", usn)
                   VALUES ('X::Y::Z', NULL, 1, 100, -1)"#,
                [],
            )
            .unwrap();
        }

        // Run integrity check
        let mut conn = s.lock();
        let report = integrity_check(&mut conn, 1_000).unwrap();
        assert_eq!(
            report.len(),
            1,
            "should report repaired orphans: {report:?}"
        );
        assert!(
            report[0].contains('2') && report[0].to_lowercase().contains("orphan"),
            "report must state how many were fixed: {}",
            report[0]
        );

        // Verify parents were created and linked
        let cmt_id: i64 = conn
            .query_row(
                "SELECT id FROM decks WHERE name = 'Classical Music Themes'",
                [],
                |r| r.get(0),
            )
            .expect("parent 'Classical Music Themes' must be created");
        let part_i_parent: Option<i64> = conn
            .query_row(
                "SELECT parent_id FROM decks WHERE name = 'Classical Music Themes::Part I'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(part_i_parent, Some(cmt_id));

        let x_id: i64 = conn
            .query_row("SELECT id FROM decks WHERE name = 'X'", [], |r| r.get(0))
            .expect("parent 'X' must be created");
        let xy_id: i64 = conn
            .query_row(
                "SELECT id, parent_id FROM decks WHERE name = 'X::Y'",
                [],
                |r| {
                    assert_eq!(r.get::<_, Option<i64>>(1)?, Some(x_id));
                    r.get(0)
                },
            )
            .expect("parent 'X::Y' must be created and linked to X");
        let xyz_parent: Option<i64> = conn
            .query_row(
                "SELECT parent_id FROM decks WHERE name = 'X::Y::Z'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(xyz_parent, Some(xy_id));

        // Running integrity_check again on now-healthy DB reports no errors/repairs
        let report2 = integrity_check(&mut conn, 1_000).unwrap();
        assert!(report2.is_empty(), "second check on healthy DB is empty");
    }

    #[test]
    fn template_and_css_refs_count_as_used() {
        let s = make_db();
        {
            let conn = s.lock();
            conn.execute(
                "INSERT INTO notetypes (id, name, kind, mod, usn, config) VALUES (20, 'Styled', 0, 0, -1, ?1)",
                [r#"{"css":".card { background: url(bg.png); } @font-face { src: url('_font.woff2'); }"}"#],
            )
            .unwrap();
            conn.execute(
                r#"INSERT INTO templates (notetype_id, ord, name, qfmt, afmt, config) VALUES (20, 0, 'Card 1', '<img src="tpl_icon.png">{{Front}}', '{{Back}}', '{}')"#,
                [],
            )
            .unwrap();
        }

        let conn = s.lock();
        let counts: std::collections::BTreeMap<String, u32> =
            note_media_ref_counts(&conn).unwrap().into_iter().collect();
        assert_eq!(counts.get("bg.png"), Some(&1));
        assert_eq!(counts.get("_font.woff2"), Some(&1));
        assert_eq!(counts.get("tpl_icon.png"), Some(&1));
    }
}
