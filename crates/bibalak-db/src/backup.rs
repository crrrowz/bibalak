use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::OsString,
    io::{Read, Write},
    path::{Path, PathBuf},
};

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::IntegrityReport;
use bibalak_core::media_refs::{extract_media_refs, rewrite_media_refs};
use rusqlite::{params, Connection, OpenFlags, MAIN_DB};

/// Maximum uncompressed size allowed when extracting `collection.sqlite` from a backup zip (256 MiB).
pub const MAX_BACKUP_DB_BYTES: u64 = 256 * 1024 * 1024;

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

/// Hot-copy the main database to `dest_path` using SQLite's online backup API.
/// Safe to call while the DB is in active use.
pub fn backup_db(conn: &Connection, dest_path: &Path) -> CoreResult<()> {
    conn.backup(MAIN_DB, dest_path, None::<fn(rusqlite::backup::Progress)>)
        .map_err(err)
}

/// Run `PRAGMA integrity_check` and repair orphan subdecks (decks with `::` in their
/// name whose parent decks are missing or unlinked), returning structured counts.
pub fn integrity_check(conn: &mut Connection, now_ms: i64) -> CoreResult<IntegrityReport> {
    let mut stmt = conn.prepare("PRAGMA integrity_check").map_err(err)?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
    let mut errors = Vec::new();
    for row in rows {
        let s = row.map_err(err)?;
        if s != "ok" {
            errors.push(s);
        }
    }
    drop(stmt);
    let repaired_orphan_subdecks = if errors.is_empty() {
        u32::try_from(repair_orphan_subdecks(conn, now_ms)?).unwrap_or(u32::MAX)
    } else {
        0
    };
    Ok(IntegrityReport {
        errors,
        repaired_orphan_subdecks,
    })
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

    add_template_and_css_refs(conn, None, &mut counts)?;

    Ok(counts.into_iter().collect())
}

/// Add template (`qfmt`/`afmt`) and notetype CSS media reference counts into `counts`.
/// When `notetype_ids` is `Some(ids)`, restricts to those note types; when `None`,
/// scans all templates and note types.
pub(crate) fn add_template_and_css_refs(
    conn: &Connection,
    notetype_ids: Option<&[i64]>,
    counts: &mut BTreeMap<String, u32>,
) -> CoreResult<()> {
    let filter_json = match notetype_ids {
        Some([]) => return Ok(()),
        Some(ids) => Some(serde_json::to_string(ids).map_err(err)?),
        None => None,
    };

    let (tmpl_sql, nt_sql) = if filter_json.is_some() {
        (
            "SELECT qfmt, afmt FROM templates WHERE notetype_id IN (SELECT value FROM json_each(?1))",
            "SELECT config FROM notetypes WHERE id IN (SELECT value FROM json_each(?1))",
        )
    } else {
        (
            "SELECT qfmt, afmt FROM templates",
            "SELECT config FROM notetypes",
        )
    };
    let bind: Vec<&str> = filter_json.as_deref().into_iter().collect();

    let mut stmt = conn.prepare(tmpl_sql).map_err(err)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(bind.iter().copied()), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(err)?;
    for row in rows {
        let (qfmt, afmt) = row.map_err(err)?;
        let mut refs = extract_media_refs(&qfmt);
        refs.extend(extract_media_refs(&afmt));
        for name in refs {
            *counts.entry(name).or_insert(0) += 1;
        }
    }

    let mut stmt = conn.prepare(nt_sql).map_err(err)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(bind.iter().copied()), |r| {
            r.get::<_, String>(0)
        })
        .map_err(err)?;
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

    Ok(())
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

fn is_precompressed_media(name: &str) -> bool {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "jpg"
            | "jpeg"
            | "png"
            | "gif"
            | "webp"
            | "avif"
            | "mp3"
            | "ogg"
            | "oga"
            | "opus"
            | "aac"
            | "m4a"
            | "flac"
            | "weba"
            | "mp4"
            | "m4v"
            | "webm"
            | "mkv"
            | "mov"
            | "avi"
            | "ogv"
            | "woff2"
            | "zip"
            | "gz"
            | "zst"
    )
}

fn stream_into_zip<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    entry_name: &str,
    src_path: &Path,
    method: zip::CompressionMethod,
) -> CoreResult<()> {
    let opts: zip::write::FileOptions<()> =
        zip::write::FileOptions::default().compression_method(method);
    zip.start_file(entry_name, opts).map_err(err)?;
    let mut src = std::fs::File::open(src_path).map_err(err)?;
    std::io::copy(&mut src, zip).map_err(err)?;
    Ok(())
}

/// Create a DB-only `.zip` archive at `zip_path` containing only `collection.sqlite` (streamed).
pub fn create_db_only_zip(db_backup: &Path, zip_path: &Path) -> CoreResult<u64> {
    create_zip_inner(db_backup, None, zip_path)
}

/// Create a `.zip` archive at `zip_path` containing:
/// - `collection.sqlite` (the hot-backup copy at `db_backup`, deflated & streamed)
/// - all files under `media_dir/` (non-recursive, streamed; `Stored` for pre-compressed media)
///
/// Returns the archive size in bytes.
pub fn create_zip(db_backup: &Path, media_dir: &Path, zip_path: &Path) -> CoreResult<u64> {
    create_zip_inner(db_backup, Some(media_dir), zip_path)
}

fn create_zip_inner(
    db_backup: &Path,
    media_dir: Option<&Path>,
    zip_path: &Path,
) -> CoreResult<u64> {
    let file = std::fs::File::create(zip_path).map_err(err)?;
    let mut zip = zip::ZipWriter::new(file);

    // Stream the DB backup compressed.
    stream_into_zip(
        &mut zip,
        "collection.sqlite",
        db_backup,
        zip::CompressionMethod::Deflated,
    )?;

    // Stream media files (flat, non-recursive); skip Deflate on already-compressed media.
    if let Some(media_dir) = media_dir.filter(|d| d.is_dir()) {
        for entry in std::fs::read_dir(media_dir).map_err(err)? {
            let entry = entry.map_err(err)?;
            if entry.file_type().map_err(err)?.is_file() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let method = if is_precompressed_media(&name) {
                    zip::CompressionMethod::Stored
                } else {
                    zip::CompressionMethod::Deflated
                };
                stream_into_zip(&mut zip, &format!("media/{name}"), &entry.path(), method)?;
            }
        }
    }
    zip.finish().map_err(err)?;

    let size = std::fs::metadata(zip_path).map_err(err)?.len();
    Ok(size)
}

/// Validate a SQLite file read-only with `PRAGMA integrity_check`. Returns errors, empty = ok.
pub fn validate_sqlite_file(path: &Path) -> CoreResult<Vec<String>> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(path, flags).map_err(err)?;
    let mut stmt = conn.prepare("PRAGMA integrity_check").map_err(err)?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
    let mut results = Vec::new();
    for row in rows {
        let s = row.map_err(err)?;
        if s != "ok" {
            results.push(s);
        }
    }
    Ok(results)
}

fn copy_bounded(reader: &mut dyn Read, writer: &mut dyn Write, max_bytes: u64) -> CoreResult<u64> {
    let mut limited = reader.take(max_bytes.saturating_add(1));
    let copied = std::io::copy(&mut limited, writer).map_err(err)?;
    if copied > max_bytes {
        return Err(CoreError::Format(format!(
            "backup database exceeds maximum allowed size of {max_bytes} bytes"
        )));
    }
    Ok(copied)
}

/// Extract `collection.sqlite` from a backup zip to `dest_path`, bounded by [`MAX_BACKUP_DB_BYTES`].
pub fn extract_db_from_zip(zip_path: &Path, dest_path: &Path) -> CoreResult<()> {
    extract_db_from_zip_with_cap(zip_path, dest_path, MAX_BACKUP_DB_BYTES)
}

/// Extract `collection.sqlite` from a backup zip to `dest_path`, rejecting entries above `max_bytes`.
pub fn extract_db_from_zip_with_cap(
    zip_path: &Path,
    dest_path: &Path,
    max_bytes: u64,
) -> CoreResult<()> {
    let file = std::fs::File::open(zip_path).map_err(err)?;
    let mut archive = zip::ZipArchive::new(file).map_err(err)?;
    let mut entry = archive
        .by_name("collection.sqlite")
        .map_err(|_| CoreError::Storage("backup zip missing collection.sqlite".into()))?;
    if entry.size() > max_bytes {
        return Err(CoreError::Format(format!(
            "backup database exceeds maximum allowed size of {max_bytes} bytes"
        )));
    }
    let result = {
        let mut out = std::fs::File::create(dest_path).map_err(err)?;
        copy_bounded(&mut entry, &mut out, max_bytes)
    };
    if let Err(e) = result {
        let _ = std::fs::remove_file(dest_path);
        return Err(e);
    }
    Ok(())
}

fn append_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut os: OsString = path.as_os_str().to_os_string();
    os.push(suffix);
    PathBuf::from(os)
}

/// Path of the staged restore file (`<db_path>.pending-restore`) swapped in on next startup.
pub fn pending_restore_path(db_path: &Path) -> PathBuf {
    append_suffix(db_path, ".pending-restore")
}

/// Stage a backup restore next to `db_path` (`collection.sqlite.pending-restore`) without
/// overwriting the open database or its WAL files.
pub fn stage_restore(zip_path: &Path, db_path: &Path) -> CoreResult<PathBuf> {
    let tmp = append_suffix(db_path, ".restore.tmp");
    extract_db_from_zip(zip_path, &tmp)?;
    let errors = match validate_sqlite_file(&tmp) {
        Ok(errs) => errs,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
    };
    if !errors.is_empty() {
        let _ = std::fs::remove_file(&tmp);
        return Err(CoreError::Format(format!(
            "backup integrity check failed: {}",
            errors.join("; ")
        )));
    }
    let pending = pending_restore_path(db_path);
    if let Err(e) = std::fs::rename(&tmp, &pending) {
        let _ = std::fs::remove_file(&tmp);
        return Err(err(e));
    }
    Ok(pending)
}

/// If `<db_path>.pending-restore` exists, validate it, remove stale `-wal`/`-shm` sidecars,
/// and swap it into place before SQLite opens `db_path`. Returns `true` when a restore ran.
pub fn apply_pending_restore(db_path: &Path) -> CoreResult<bool> {
    let pending = pending_restore_path(db_path);
    if !pending.is_file() {
        return Ok(false);
    }
    let errors = validate_sqlite_file(&pending)?;
    if !errors.is_empty() {
        let _ = std::fs::remove_file(&pending);
        return Err(CoreError::Format(format!(
            "staged backup integrity check failed: {}",
            errors.join("; ")
        )));
    }
    for sidecar in ["-wal", "-shm"] {
        let sidecar_path = append_suffix(db_path, sidecar);
        if let Err(e) = std::fs::remove_file(&sidecar_path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(err(e));
            }
        }
    }
    std::fs::rename(&pending, db_path).map_err(err)?;
    Ok(true)
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
        let report = integrity_check(&mut conn, 1_000).unwrap();
        assert!(report.errors.is_empty(), "unexpected errors: {report:?}");
        assert_eq!(report.repaired_orphan_subdecks, 0);
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
        assert!(report.errors.is_empty(), "expected no errors: {report:?}");
        assert_eq!(
            report.repaired_orphan_subdecks, 2,
            "should report 2 repaired orphans: {report:?}"
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
        assert!(
            report2.errors.is_empty() && report2.repaired_orphan_subdecks == 0,
            "second check on healthy DB is empty"
        );
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

    #[test]
    fn a4_05_extract_db_from_zip_rejects_oversized_entry() {
        let dir = std::env::temp_dir().join(format!("bibalak_a4_05_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let zip_path = dir.join("backup.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
            let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            w.start_file("collection.sqlite", opts).unwrap();
            let payload = vec![0u8; 8 * 1024 * 1024];
            w.write_all(&payload).unwrap();
            w.finish().unwrap();
        }

        let out_path = dir.join("out.sqlite");
        let res = extract_db_from_zip_with_cap(&zip_path, &out_path, 4 * 1024 * 1024);
        assert!(res.is_err(), "oversized zip entry must be rejected");
        assert!(
            !out_path.exists(),
            "rejected extraction must not leave partial output file"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_bounded_enforces_streaming_limit_without_header() {
        let mut infinite = std::io::repeat(b'x');
        let mut sink = Vec::new();
        let res = copy_bounded(&mut infinite, &mut sink, 1024);
        assert!(res.is_err(), "unbounded stream must fail at limit + 1");
        assert_eq!(sink.len(), 1025);
    }

    #[test]
    fn stage_restore_leaves_live_db_intact_and_swaps_on_next_open() {
        let dir = std::env::temp_dir().join(format!("bibalak_a5_10_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let db_path = dir.join("collection.sqlite");
        let zip_path = dir.join("snap.zip");
        let backup_tmp = dir.join("snap.tmp.sqlite");

        {
            let s = SqliteStorage::open(&db_path).unwrap();
            seed_note(&s, &["before_backup", "back"], 1_700_000_000_000);
            {
                let conn = s.lock();
                backup_db(&conn, &backup_tmp).unwrap();
            }
            create_zip(&backup_tmp, &dir.join("missing_media"), &zip_path).unwrap();
            let _ = std::fs::remove_file(&backup_tmp);

            // Mutate live DB after backup was taken.
            seed_note(&s, &["after_backup", "back"], 1_700_000_001_000);

            // Stage restore while storage is still open.
            let staged = stage_restore(&zip_path, &db_path).unwrap();
            assert_eq!(staged, pending_restore_path(&db_path));
            assert!(staged.is_file());

            // Live connection still sees both notes and was never renamed over.
            let conn = s.lock();
            let live_count: i64 = conn
                .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
                .unwrap();
            assert_eq!(live_count, 2);
        }

        // Plant stale WAL/SHM sidecars to verify apply_pending_restore cleans them up.
        let wal_path = append_suffix(&db_path, "-wal");
        let shm_path = append_suffix(&db_path, "-shm");
        std::fs::write(&wal_path, b"stale wal").unwrap();
        std::fs::write(&shm_path, b"stale shm").unwrap();

        // Re-opening applies the staged restore before SQLite opens the DB.
        {
            let reopened = SqliteStorage::open(&db_path).unwrap();
            assert!(!pending_restore_path(&db_path).exists());
            let conn = reopened.lock();
            let restored_count: i64 = conn
                .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
                .unwrap();
            assert_eq!(restored_count, 1);
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a5_16_create_zip_uses_stored_for_precompressed_media_and_deflated_for_db_and_svg() {
        let dir = std::env::temp_dir().join(format!("bibalak_a5_16_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let media_dir = dir.join("collection.media");
        std::fs::create_dir_all(&media_dir).unwrap();

        let db_file = dir.join("collection.sqlite");
        std::fs::write(&db_file, vec![b'A'; 4096]).unwrap();
        std::fs::write(media_dir.join("photo.JPG"), b"fake jpeg bytes").unwrap();
        std::fs::write(media_dir.join("clip.mp3"), b"fake mp3 bytes").unwrap();
        std::fs::write(media_dir.join("vector.svg"), b"<svg><rect/></svg>").unwrap();

        let zip_path = dir.join("out.zip");
        create_zip(&db_file, &media_dir, &zip_path).unwrap();

        let mut archive = zip::ZipArchive::new(std::fs::File::open(&zip_path).unwrap()).unwrap();
        assert_eq!(
            archive.by_name("collection.sqlite").unwrap().compression(),
            zip::CompressionMethod::Deflated
        );
        assert_eq!(
            archive.by_name("media/photo.JPG").unwrap().compression(),
            zip::CompressionMethod::Stored
        );
        assert_eq!(
            archive.by_name("media/clip.mp3").unwrap().compression(),
            zip::CompressionMethod::Stored
        );
        assert_eq!(
            archive.by_name("media/vector.svg").unwrap().compression(),
            zip::CompressionMethod::Deflated
        );

        let db_only_zip = dir.join("db-only.zip");
        create_db_only_zip(&db_file, &db_only_zip).unwrap();
        let db_archive = zip::ZipArchive::new(std::fs::File::open(&db_only_zip).unwrap()).unwrap();
        assert_eq!(db_archive.len(), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a5_17_integrity_check_orphan_repair_returns_counts_without_hardcoded_english() {
        let s = make_db();
        {
            let conn = s.lock();
            conn.execute(
                r#"INSERT INTO decks (id, name, parent_id, config_id, "mod", usn)
                   VALUES (10, 'OrphanParent::Child', NULL, 1, 1000, 0)"#,
                [],
            )
            .unwrap();
        }
        let mut conn = s.lock();
        let report = integrity_check(&mut conn, 2000).unwrap();
        assert!(report.errors.is_empty());
        assert_eq!(report.repaired_orphan_subdecks, 1);
    }
}
