//! Read an Anki `.apkg` / `.colpkg` package into a [`CanonicalModel`].
//!
//! Pipeline: unzip → locate the collection DB (`collection.anki2` /
//! `.anki21` / zstd-compressed `.anki21b`) → detect schema → map to canonical.
//!
//! Both layouts are supported: legacy **v11** (decks/models/dconf as JSON blobs
//! in the `col` table) and modern **v18** (dedicated tables; only each card
//! template's q/a format needs protobuf decoding — see [`crate::pb`]). Notes,
//! cards and revlog share identical columns across both.

use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::ImportStage;
use bibalak_core::media_refs::normalize_import_media_filename;
use bibalak_core::model::{
    CanonicalModel, Card, Deck, DeckConfig, Field, Note, Notetype, Revlog, Template,
};
use rusqlite::{config::DbConfig, Connection, OpenFlags, OptionalExtension};
use serde_json::Value;

type Archive = zip::ZipArchive<std::fs::File>;

/// Maximum uncompressed size allowed for the collection SQLite file (256 MiB).
pub const MAX_COLLECTION_BYTES: u64 = 256 * 1024 * 1024;
/// Maximum uncompressed size allowed for a single media entry (100 MiB, matching `MAX_MEDIA_BYTES`).
pub const MAX_MEDIA_BYTES: u64 = 100 * 1024 * 1024;
/// Maximum uncompressed size allowed for the `media` index entry (32 MiB).
pub const MAX_MEDIA_MAP_BYTES: u64 = 32 * 1024 * 1024;
/// Maximum total uncompressed bytes extracted from a single `.apkg`/`.colpkg` package (1 GiB).
pub const MAX_TOTAL_PACKAGE_BYTES: u64 = 1024 * 1024 * 1024;
const ZSTD_MAGIC: [u8; 4] = [0x28, 0xB5, 0x2F, 0xFD];

/// Limits enforced while reading a package archive.
#[derive(Debug, Clone, Copy)]
pub struct PackageReadLimits {
    pub max_collection_bytes: u64,
    pub max_media_bytes: u64,
    pub max_media_map_bytes: u64,
    pub max_total_bytes: u64,
}

/// Counts reported for media entries processed during package import.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PackageMediaStats {
    pub imported: u32,
    pub renamed: u32,
    pub skipped: u32,
}

impl Default for PackageReadLimits {
    fn default() -> Self {
        Self {
            max_collection_bytes: MAX_COLLECTION_BYTES,
            max_media_bytes: MAX_MEDIA_BYTES,
            max_media_map_bytes: MAX_MEDIA_MAP_BYTES,
            max_total_bytes: MAX_TOTAL_PACKAGE_BYTES,
        }
    }
}

fn fmt(e: impl std::fmt::Display) -> CoreError {
    CoreError::Format(e.to_string())
}

/// (entry name, zstd-compressed?) in priority order.
const COLLECTION_CANDIDATES: &[(&str, bool)] = &[
    ("collection.anki21b", true),
    ("collection.anki21", false),
    ("collection.anki2", false),
];

/// Read a package with custom decompression/size limits (for tests and hardened callers).
pub fn read_package_with_limits(
    path: &Path,
    media_dir: Option<&Path>,
    limits: PackageReadLimits,
) -> CoreResult<(CanonicalModel, u32)> {
    let cancel = AtomicBool::new(false);
    let (model, stats) =
        read_package_inner(path, media_dir, None, limits, &cancel, &mut |_, _, _| {})?;
    Ok((model, stats.imported))
}

/// Read a package. If `media_dir` is `Some`, media files are extracted there
/// (deduped by the on-disk filename) and the count is returned.
pub fn read_package(path: &Path, media_dir: Option<&Path>) -> CoreResult<(CanonicalModel, u32)> {
    let cancel = AtomicBool::new(false);
    let (model, stats) = read_package_inner(
        path,
        media_dir,
        None,
        PackageReadLimits::default(),
        &cancel,
        &mut |_, _, _| {},
    )?;
    Ok((model, stats.imported))
}

/// Read a package, extracting any bundled media through [`bibalak_core::ports::MediaStore`]
/// so SHA-1 deduplication and collision suffixes apply automatically.
pub fn read_package_with_media(
    path: &Path,
    media_store: Option<&dyn bibalak_core::ports::MediaStore>,
) -> CoreResult<(CanonicalModel, u32)> {
    let cancel = AtomicBool::new(false);
    let (model, stats) = read_package_inner(
        path,
        None,
        media_store,
        PackageReadLimits::default(),
        &cancel,
        &mut |_, _, _| {},
    )?;
    Ok((model, stats.imported))
}

/// Read a package with staged progress callbacks (`ReadingPackage`, `CopyingMedia`)
/// and cooperative cancellation before the database merge starts.
pub fn read_package_with_progress(
    path: &Path,
    media_store: Option<&dyn bibalak_core::ports::MediaStore>,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(ImportStage, u32, u32),
) -> CoreResult<(CanonicalModel, u32)> {
    let (model, stats) = read_package_with_progress_stats(path, media_store, cancel, on_progress)?;
    Ok((model, stats.imported))
}

/// Read a package with progress callbacks and return detailed [`PackageMediaStats`]
/// including imported, normalized/renamed, and skipped media entry counts.
pub fn read_package_with_progress_stats(
    path: &Path,
    media_store: Option<&dyn bibalak_core::ports::MediaStore>,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(ImportStage, u32, u32),
) -> CoreResult<(CanonicalModel, PackageMediaStats)> {
    read_package_inner(
        path,
        None,
        media_store,
        PackageReadLimits::default(),
        cancel,
        on_progress,
    )
}

fn check_cancelled(cancel: &AtomicBool) -> CoreResult<()> {
    if cancel.load(Ordering::Relaxed) {
        Err(CoreError::Cancelled)
    } else {
        Ok(())
    }
}

fn read_bounded(reader: &mut dyn Read, max_bytes: u64, label: &str) -> CoreResult<Vec<u8>> {
    let mut out = Vec::new();
    let copied =
        std::io::copy(&mut reader.take(max_bytes.saturating_add(1)), &mut out).map_err(fmt)?;
    if copied > max_bytes {
        return Err(CoreError::Format(format!(
            "package entry '{label}' exceeds maximum size limit of {max_bytes} bytes"
        )));
    }
    Ok(out)
}

fn account_total_bytes(total: &mut u64, added: u64, max_total: u64) -> CoreResult<()> {
    *total = total.saturating_add(added);
    if *total > max_total {
        return Err(CoreError::Format(format!(
            "package total uncompressed size exceeds maximum limit of {max_total} bytes"
        )));
    }
    Ok(())
}

fn extract_collection_to_file(
    archive: &mut Archive,
    coll_name: &str,
    zstd_compressed: bool,
    db_path: &Path,
    limits: PackageReadLimits,
    total_extracted: &mut u64,
) -> CoreResult<()> {
    let mut entry = archive.by_name(coll_name).map_err(fmt)?;
    if entry.size() > limits.max_collection_bytes {
        return Err(CoreError::Format(format!(
            "collection database '{coll_name}' exceeds maximum size limit of {} bytes",
            limits.max_collection_bytes
        )));
    }

    let mut out = std::fs::File::create(db_path).map_err(fmt)?;
    let written = if zstd_compressed {
        let compressed_cap = limits.max_collection_bytes;
        let mut limited_zip = (&mut entry).take(compressed_cap.saturating_add(1));
        let decoder = zstd::stream::read::Decoder::new(&mut limited_zip).map_err(fmt)?;
        let mut limited_dec = decoder.take(limits.max_collection_bytes.saturating_add(1));
        std::io::copy(&mut limited_dec, &mut out).map_err(fmt)?
    } else {
        let mut limited_zip = (&mut entry).take(limits.max_collection_bytes.saturating_add(1));
        std::io::copy(&mut limited_zip, &mut out).map_err(fmt)?
    };
    out.flush().map_err(fmt)?;

    if written > limits.max_collection_bytes {
        let _ = std::fs::remove_file(db_path);
        return Err(CoreError::Format(format!(
            "collection database '{coll_name}' exceeds maximum size limit of {} bytes",
            limits.max_collection_bytes
        )));
    }
    account_total_bytes(total_extracted, written, limits.max_total_bytes)?;
    Ok(())
}

fn open_package_db_readonly(db_path: &Path) -> CoreResult<Connection> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(db_path, flags).map_err(fmt)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)
        .map_err(fmt)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_TRUSTED_SCHEMA, false)
        .map_err(fmt)?;
    conn.pragma_update(None, "trusted_schema", "OFF")
        .map_err(fmt)?;
    conn.pragma_update(None, "query_only", true).map_err(fmt)?;
    Ok(conn)
}

fn require_base_table(conn: &Connection, name: &str) -> CoreResult<()> {
    if table_exists(conn, name)? {
        Ok(())
    } else {
        Err(CoreError::Format(format!(
            "package database missing base table '{name}'"
        )))
    }
}

fn read_package_inner(
    path: &Path,
    media_dir: Option<&Path>,
    media_store: Option<&dyn bibalak_core::ports::MediaStore>,
    limits: PackageReadLimits,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(ImportStage, u32, u32),
) -> CoreResult<(CanonicalModel, PackageMediaStats)> {
    check_cancelled(cancel)?;
    on_progress(ImportStage::ReadingPackage, 0, 0);

    let file = std::fs::File::open(path).map_err(fmt)?;
    let mut archive = zip::ZipArchive::new(file).map_err(fmt)?;

    // zip >= 9 yields each name as a Result (malformed entry names are errors).
    let names: Vec<String> = archive
        .file_names()
        .map(|name| name.map(|n| n.into_owned()))
        .collect::<Result<_, _>>()
        .map_err(fmt)?;
    let (coll_name, zstd_compressed) = COLLECTION_CANDIDATES
        .iter()
        .copied()
        .find(|(name, _)| names.iter().any(|n| n == name))
        .ok_or_else(|| CoreError::Format("no collection database found in package".into()))?;

    check_cancelled(cancel)?;
    // SQLite needs a path; use a temp dir (no lingering file handle, unlike a
    // NamedTempFile, which can clash with SQLite's own open on Windows).
    let dir = tempfile::tempdir().map_err(fmt)?;
    let db_path = dir.path().join("collection.anki2");
    let mut total_extracted = 0u64;
    extract_collection_to_file(
        &mut archive,
        coll_name,
        zstd_compressed,
        &db_path,
        limits,
        &mut total_extracted,
    )?;

    let conn = open_package_db_readonly(&db_path)?;

    let mut model = read_collection(&conn)?;
    drop(conn);
    check_cancelled(cancel)?;

    let media_stats = if let Some(store) = media_store {
        extract_media_to_store(
            &mut archive,
            &mut model,
            store,
            limits,
            &mut total_extracted,
            cancel,
            on_progress,
        )?
    } else if let Some(target) = media_dir {
        let stats = extract_media(&mut archive, target, limits, &mut total_extracted)?;
        check_cancelled(cancel)?;
        stats
    } else {
        check_cancelled(cancel)?;
        PackageMediaStats::default()
    };

    Ok((model, media_stats))
}

fn table_exists(conn: &Connection, name: &str) -> CoreResult<bool> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [name],
            |r| r.get(0),
        )
        .map_err(fmt)?;
    Ok(count > 0)
}

fn read_collection(conn: &Connection) -> CoreResult<CanonicalModel> {
    require_base_table(conn, "col")?;
    require_base_table(conn, "notes")?;
    require_base_table(conn, "cards")?;
    require_base_table(conn, "revlog")?;

    let mut model = CanonicalModel::default();
    let crt_sec: Option<i64> = conn
        .query_row("SELECT crt FROM col LIMIT 1", [], |r| r.get(0))
        .optional()
        .map_err(fmt)?;
    model.created_ms = crt_sec.map(|s| s * 1000);
    // Schema detection: the modern (v18) layout has dedicated tables; the legacy
    // (v11) layout keeps decks/models/dconf as JSON blobs in `col`.
    if table_exists(conn, "notetypes")? {
        require_base_table(conn, "decks")?;
        require_base_table(conn, "fields")?;
        require_base_table(conn, "templates")?;
        read_v18_meta(conn, &mut model)?;
    } else {
        read_v11_meta(conn, &mut model)?;
    }
    // notes/cards/revlog have identical columns in both schemas.
    read_notes(conn, &mut model)?;
    read_cards(conn, &mut model)?;
    read_revlog(conn, &mut model)?;
    Ok(model)
}

/// Read the modern (v18) tabular layout, decoding protobuf blobs for
/// `notetypes.config`, `fields.config`, `templates.config`, `decks.common`/
/// `decks.kind`, and `deck_config.config` (`proto/anki/*.proto`).
fn read_v18_meta(conn: &Connection, model: &mut CanonicalModel) -> CoreResult<()> {
    {
        let mut stmt = conn
            .prepare("SELECT id, name, mtime_secs, usn, common, kind FROM decks")
            .map_err(fmt)?;
        let rows = stmt
            .query_map([], |r| {
                let id: i64 = r.get(0)?;
                let name: String = r.get(1)?;
                let mtime_secs: i64 = r.get::<_, Option<i64>>(2)?.unwrap_or(0);
                let usn: i64 = r.get::<_, Option<i64>>(3)?.unwrap_or(-1);
                let common: Option<Vec<u8>> = r.get(4)?;
                let kind: Option<Vec<u8>> = r.get(5)?;
                let collapsed = common
                    .as_deref()
                    .is_some_and(crate::pb::deck_common_collapsed);
                let (config_id, is_filtered) = kind
                    .as_deref()
                    .map(crate::pb::deck_kind)
                    .unwrap_or((1, false));
                Ok(Deck {
                    id,
                    name: name.replace('\u{1f}', "::"),
                    parent_id: None,
                    config_id,
                    mod_ms: mtime_secs.saturating_mul(1000),
                    usn,
                    collapsed,
                    is_filtered,
                })
            })
            .map_err(fmt)?;
        model.decks = rows.collect::<rusqlite::Result<_>>().map_err(fmt)?;
    }

    if table_exists(conn, "deck_config")? {
        let mut fsrs_enabled = conn
            .query_row("SELECT conf FROM col LIMIT 1", [], |r| {
                r.get::<_, String>(0)
            })
            .optional()
            .map_err(fmt)?
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| v.get("fsrs").and_then(Value::as_bool))
            .unwrap_or(false);
        if !fsrs_enabled && table_exists(conn, "config")? {
            if let Some(val) = conn
                .query_row("SELECT val FROM config WHERE key = 'fsrs'", [], |r| {
                    r.get::<_, Vec<u8>>(0)
                })
                .optional()
                .map_err(fmt)?
            {
                fsrs_enabled = val == b"\x08\x01" || val == b"true" || val == b"1";
            }
        }
        let mut stmt = conn
            .prepare("SELECT id, name, mtime_secs, usn, config FROM deck_config")
            .map_err(fmt)?;
        let rows = stmt
            .query_map([], |r| {
                let id: i64 = r.get(0)?;
                let name: String = r.get(1)?;
                let mtime_secs: i64 = r.get::<_, Option<i64>>(2)?.unwrap_or(0);
                let usn: i64 = r.get::<_, Option<i64>>(3)?.unwrap_or(-1);
                let config: Option<Vec<u8>> = r.get(4)?;
                let config_val = config
                    .as_deref()
                    .map(|b| crate::pb::deck_config_proto(b, fsrs_enabled))
                    .unwrap_or_else(|| serde_json::json!({}));
                Ok(DeckConfig {
                    id,
                    name,
                    mod_ms: mtime_secs.saturating_mul(1000),
                    usn,
                    config_json: config_val.to_string(),
                })
            })
            .map_err(fmt)?;
        model.deck_configs = rows.collect::<rusqlite::Result<_>>().map_err(fmt)?;
    }

    {
        let mut stmt = conn
            .prepare("SELECT id, name, mtime_secs, usn, config FROM notetypes")
            .map_err(fmt)?;
        let rows = stmt
            .query_map([], |r| {
                let id: i64 = r.get(0)?;
                let name: String = r.get(1)?;
                let mtime_secs: i64 = r.get::<_, Option<i64>>(2)?.unwrap_or(0);
                let usn: i64 = r.get::<_, Option<i64>>(3)?.unwrap_or(-1);
                let config: Option<Vec<u8>> = r.get(4)?;
                let decoded = config
                    .as_deref()
                    .map(crate::pb::notetype_config)
                    .unwrap_or_default();
                let mut obj = serde_json::Map::new();
                if !decoded.css.is_empty() {
                    obj.insert("css".into(), Value::String(decoded.css));
                }
                if decoded.sort_field_idx > 0 {
                    obj.insert("sortf".into(), serde_json::json!(decoded.sort_field_idx));
                }
                if !decoded.latex_pre.is_empty() {
                    obj.insert("latexPre".into(), Value::String(decoded.latex_pre));
                }
                if !decoded.latex_post.is_empty() {
                    obj.insert("latexPost".into(), Value::String(decoded.latex_post));
                }
                if decoded.latex_svg {
                    obj.insert("latexsvg".into(), Value::Bool(true));
                }
                if decoded.original_stock_kind > 0 {
                    obj.insert(
                        "originalStockKind".into(),
                        serde_json::json!(decoded.original_stock_kind),
                    );
                    if decoded.original_stock_kind == 6 {
                        obj.insert("kind".into(), Value::String("image-occlusion".into()));
                    }
                }
                Ok(Notetype {
                    id,
                    name,
                    kind: decoded.kind,
                    mod_ms: mtime_secs.saturating_mul(1000),
                    usn,
                    config_json: Value::Object(obj).to_string(),
                })
            })
            .map_err(fmt)?;
        model.notetypes = rows.collect::<rusqlite::Result<_>>().map_err(fmt)?;
    }
    {
        let mut stmt = conn
            .prepare("SELECT ntid, ord, name, config FROM fields ORDER BY ntid, ord")
            .map_err(fmt)?;
        let rows = stmt
            .query_map([], |r| {
                let config: Option<Vec<u8>> = r.get(3)?;
                let decoded = config
                    .as_deref()
                    .map(crate::pb::field_config)
                    .unwrap_or_default();
                let mut obj = serde_json::Map::new();
                if let Some(rtl) = decoded.rtl {
                    if rtl {
                        obj.insert("rtl".into(), Value::Bool(true));
                    }
                }
                if !decoded.font_name.is_empty() {
                    obj.insert("font".into(), Value::String(decoded.font_name));
                }
                if decoded.font_size > 0 {
                    obj.insert("size".into(), serde_json::json!(decoded.font_size));
                }
                if !decoded.description.is_empty() {
                    obj.insert("description".into(), Value::String(decoded.description));
                }
                if decoded.sticky {
                    obj.insert("sticky".into(), Value::Bool(true));
                }
                Ok(Field {
                    notetype_id: r.get(0)?,
                    ord: r.get(1)?,
                    name: r.get(2)?,
                    config_json: Value::Object(obj).to_string(),
                })
            })
            .map_err(fmt)?;
        model.fields = rows.collect::<rusqlite::Result<_>>().map_err(fmt)?;
    }
    {
        let mut stmt = conn
            .prepare("SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord")
            .map_err(fmt)?;
        let rows = stmt
            .query_map([], |r| {
                let config: Vec<u8> = r.get::<_, Option<Vec<u8>>>(3)?.unwrap_or_default();
                let (qfmt, afmt) = crate::pb::template_formats(&config);
                Ok(Template {
                    notetype_id: r.get(0)?,
                    ord: r.get(1)?,
                    name: r.get(2)?,
                    qfmt,
                    afmt,
                    config_json: "{}".into(),
                })
            })
            .map_err(fmt)?;
        model.templates = rows.collect::<rusqlite::Result<_>>().map_err(fmt)?;
    }

    // Refine cloze note types from their templates (`{{cloze:...}}` and `{{cloze-only:...}}`).
    for notetype in &mut model.notetypes {
        if notetype.kind == 0 {
            let is_cloze = model.templates.iter().any(|t| {
                t.notetype_id == notetype.id
                    && (t.qfmt.contains("{{cloze:")
                        || t.qfmt.contains("{{cloze-only:")
                        || t.afmt.contains("{{cloze:")
                        || t.afmt.contains("{{cloze-only:"))
            });
            if is_cloze {
                notetype.kind = 1;
            }
        }
    }
    Ok(())
}

/// Parse the `col` table's JSON blobs (models, decks, dconf) — the v11 layout.
fn read_v11_meta(conn: &Connection, model: &mut CanonicalModel) -> CoreResult<()> {
    let (models, decks, dconf): (String, String, String) = conn
        .query_row("SELECT models, decks, dconf FROM col LIMIT 1", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .map_err(fmt)?;

    let models: Value = serde_json::from_str(&models).map_err(fmt)?;
    for entry in models
        .as_object()
        .ok_or_else(|| fmt("models is not an object"))?
        .values()
    {
        let id = json_i64(entry, "id").ok_or_else(|| fmt("notetype missing id"))?;
        let config_json =
            if json_i64(entry, "originalStockKind") == Some(6) && entry.get("kind").is_none() {
                let mut cloned = entry.clone();
                if let Some(obj) = cloned.as_object_mut() {
                    obj.insert("kind".into(), Value::String("image-occlusion".into()));
                }
                cloned.to_string()
            } else {
                entry.to_string()
            };
        model.notetypes.push(Notetype {
            id,
            name: json_str(entry, "name"),
            kind: json_i64(entry, "type").unwrap_or(0),
            mod_ms: json_i64(entry, "mod").unwrap_or(0) * 1000,
            usn: -1,
            config_json,
        });
        if let Some(flds) = entry.get("flds").and_then(Value::as_array) {
            for f in flds {
                model.fields.push(Field {
                    notetype_id: id,
                    ord: json_i64(f, "ord").unwrap_or(0),
                    name: json_str(f, "name"),
                    config_json: f.to_string(),
                });
            }
        }
        if let Some(tmpls) = entry.get("tmpls").and_then(Value::as_array) {
            for t in tmpls {
                model.templates.push(Template {
                    notetype_id: id,
                    ord: json_i64(t, "ord").unwrap_or(0),
                    name: json_str(t, "name"),
                    qfmt: json_str(t, "qfmt"),
                    afmt: json_str(t, "afmt"),
                    config_json: "{}".into(),
                });
            }
        }
    }

    let decks: Value = serde_json::from_str(&decks).map_err(fmt)?;
    for entry in decks
        .as_object()
        .ok_or_else(|| fmt("decks is not an object"))?
        .values()
    {
        let id = json_i64(entry, "id").ok_or_else(|| fmt("deck missing id"))?;
        model.decks.push(Deck {
            id,
            // Anki may store the deck-name separator as 0x1f; normalise to "::".
            name: json_str(entry, "name").replace('\u{1f}', "::"),
            parent_id: None,
            config_id: json_i64(entry, "conf").unwrap_or(1),
            mod_ms: json_i64(entry, "mod").unwrap_or(0) * 1000,
            usn: -1,
            collapsed: entry
                .get("collapsed")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            is_filtered: json_i64(entry, "dyn").unwrap_or(0) != 0,
        });
    }

    let dconf: Value = serde_json::from_str(&dconf).map_err(fmt)?;
    if let Some(obj) = dconf.as_object() {
        for entry in obj.values() {
            if let Some(id) = json_i64(entry, "id") {
                model.deck_configs.push(DeckConfig {
                    id,
                    name: json_str(entry, "name"),
                    mod_ms: 0,
                    usn: -1,
                    config_json: entry.to_string(),
                });
            }
        }
    }

    Ok(())
}

fn read_notes(conn: &Connection, model: &mut CanonicalModel) -> CoreResult<()> {
    let mut stmt = conn
        .prepare("SELECT id, guid, mid, mod, tags, flds, CAST(sfld AS TEXT), csum FROM notes")
        .map_err(fmt)?;
    let rows = stmt
        .query_map([], |r| {
            let tags: String = r.get(4)?;
            let flds: String = r.get(5)?;
            Ok(Note {
                id: r.get(0)?,
                guid: r.get(1)?,
                notetype_id: r.get(2)?,
                mod_ms: r.get::<_, i64>(3)? * 1000,
                usn: -1,
                tags: tags.split_whitespace().map(str::to_string).collect(),
                fields: flds.split('\u{1f}').map(str::to_string).collect(),
                sort_field: r.get::<_, Option<String>>(6)?,
                checksum: r.get::<_, Option<i64>>(7)?,
            })
        })
        .map_err(fmt)?;
    model.notes = rows.collect::<rusqlite::Result<_>>().map_err(fmt)?;
    Ok(())
}

fn read_cards(conn: &Connection, model: &mut CanonicalModel) -> CoreResult<()> {
    let created_ms = model.created_ms;
    let mut stmt = conn
        .prepare(
            "SELECT id, nid, did, ord, mod, type, queue, due, ivl, factor, reps, lapses, left, \
             odue, odid, flags, data FROM cards",
        )
        .map_err(fmt)?;
    let rows = stmt
        .query_map([], |r| {
            let data: Option<String> = r.get(16)?;
            let (fsrs_stability, fsrs_difficulty, fsrs_last_review) = data
                .as_deref()
                .and_then(|s| {
                    let trimmed = s.trim();
                    if trimmed.is_empty() {
                        return None;
                    }
                    serde_json::from_str::<Value>(trimmed).ok()
                })
                .map(|v| {
                    let s = v.get("s").and_then(Value::as_f64);
                    let d = v.get("d").and_then(Value::as_f64);
                    let lrt = v.get("lrt").and_then(Value::as_i64).map(|raw| {
                        if raw >= 1_000_000 {
                            let ms = if raw >= 100_000_000_000 {
                                raw
                            } else {
                                raw.saturating_mul(1000)
                            };
                            match created_ms {
                                Some(crt) => (ms - crt).div_euclid(86_400_000),
                                None => raw,
                            }
                        } else {
                            raw
                        }
                    });
                    (s, d, lrt)
                })
                .unwrap_or((None, None, None));
            Ok(Card {
                id: r.get(0)?,
                note_id: r.get(1)?,
                deck_id: r.get(2)?,
                ord: r.get(3)?,
                mod_ms: r.get::<_, i64>(4)? * 1000,
                usn: -1,
                ctype: r.get(5)?,
                queue: r.get(6)?,
                due: r.get(7)?,
                interval: r.get(8)?,
                ease_factor: r.get(9)?,
                reps: r.get(10)?,
                lapses: r.get(11)?,
                remaining: r.get(12)?,
                original_due: r.get(13)?,
                original_deck_id: r.get(14)?,
                flags: r.get(15)?,
                fsrs_stability,
                fsrs_difficulty,
                fsrs_last_review,
                data,
            })
        })
        .map_err(fmt)?;
    model.cards = rows.collect::<rusqlite::Result<_>>().map_err(fmt)?;
    Ok(())
}

fn read_revlog(conn: &Connection, model: &mut CanonicalModel) -> CoreResult<()> {
    let mut stmt = conn
        .prepare("SELECT id, cid, ease, ivl, lastIvl, factor, time, type FROM revlog")
        .map_err(fmt)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Revlog {
                id: r.get(0)?,
                card_id: r.get(1)?,
                usn: -1,
                ease: r.get(2)?,
                interval: r.get(3)?,
                last_interval: r.get(4)?,
                ease_factor: r.get(5)?,
                taken_ms: r.get(6)?,
                review_kind: r.get(7)?,
            })
        })
        .map_err(fmt)?;
    model.revlog = rows.collect::<rusqlite::Result<_>>().map_err(fmt)?;
    Ok(())
}

fn read_media_mapping(
    archive: &mut Archive,
    limits: PackageReadLimits,
    total_extracted: &mut u64,
) -> CoreResult<Vec<(String, String)>> {
    let Some(raw) = read_entry_to_bytes_bounded(archive, "media", limits.max_media_map_bytes)?
    else {
        return Ok(Vec::new());
    };
    account_total_bytes(total_extracted, raw.len() as u64, limits.max_total_bytes)?;

    let entries = match serde_json::from_slice::<Value>(&raw) {
        Ok(Value::Object(map)) => map
            .into_iter()
            .filter_map(|(index, name)| name.as_str().map(|n| (index, n.to_string())))
            .collect(),
        _ => crate::pb::media_entry_names(&raw)
            .into_iter()
            .enumerate()
            .map(|(i, name)| (i.to_string(), name))
            .collect(),
    };
    Ok(entries)
}

/// Extract media into `dir`. The `media` map is JSON `{"0":"name.png"}` in v2
/// packages and a protobuf `MediaEntries` in v3; media blobs may be zstd
/// compressed (v3).
fn extract_media(
    archive: &mut Archive,
    dir: &Path,
    limits: PackageReadLimits,
    total_extracted: &mut u64,
) -> CoreResult<PackageMediaStats> {
    let mapping = read_media_mapping(archive, limits, total_extracted)?;
    if mapping.is_empty() {
        return Ok(PackageMediaStats::default());
    }

    std::fs::create_dir_all(dir).map_err(fmt)?;
    let mut stats = PackageMediaStats::default();
    for (entry_name, filename) in mapping {
        let Some(safe) = normalize_import_media_filename(&filename) else {
            stats.skipped += 1;
            continue;
        };
        let Some(decoded) = read_media_entry_bounded(archive, &entry_name, limits.max_media_bytes)?
        else {
            stats.skipped += 1;
            continue;
        };
        account_total_bytes(
            total_extracted,
            decoded.len() as u64,
            limits.max_total_bytes,
        )?;
        std::fs::write(dir.join(&safe), decoded).map_err(fmt)?;
        if safe != filename {
            stats.renamed += 1;
        }
        stats.imported += 1;
    }
    Ok(stats)
}

fn extract_media_to_store(
    archive: &mut Archive,
    model: &mut CanonicalModel,
    store: &dyn bibalak_core::ports::MediaStore,
    limits: PackageReadLimits,
    total_extracted: &mut u64,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(ImportStage, u32, u32),
) -> CoreResult<PackageMediaStats> {
    let mapping = read_media_mapping(archive, limits, total_extracted)?;
    if mapping.is_empty() {
        return Ok(PackageMediaStats::default());
    }

    let total = mapping.len() as u32;
    on_progress(ImportStage::CopyingMedia, 0, total);
    let existing_before: HashSet<String> = store
        .list_sizes()?
        .into_iter()
        .map(|(name, _)| name)
        .collect();
    struct NewlyAddedGuard<'a> {
        store: &'a dyn bibalak_core::ports::MediaStore,
        names: Vec<String>,
        armed: bool,
    }

    impl Drop for NewlyAddedGuard<'_> {
        fn drop(&mut self) {
            if self.armed && !self.names.is_empty() {
                let _ = self.store.delete(&self.names);
            }
        }
    }

    let mut newly_added = NewlyAddedGuard {
        store,
        names: Vec::new(),
        armed: true,
    };
    let mut stats = PackageMediaStats::default();
    let mut processed = 0u32;
    let mut renames: Vec<(String, String)> = Vec::new();
    let mut last_emit = Instant::now();

    for (entry_name, filename) in mapping {
        check_cancelled(cancel)?;
        processed += 1;
        let Some(safe) = normalize_import_media_filename(&filename) else {
            stats.skipped += 1;
            continue;
        };
        let Some(decoded) = read_media_entry_bounded(archive, &entry_name, limits.max_media_bytes)?
        else {
            stats.skipped += 1;
            continue;
        };
        account_total_bytes(
            total_extracted,
            decoded.len() as u64,
            limits.max_total_bytes,
        )?;
        let stored_name = match store.add(&safe, &decoded) {
            Ok(name) => name,
            Err(CoreError::Invalid(_)) => {
                stats.skipped += 1;
                continue;
            }
            Err(e) => return Err(e),
        };
        if !existing_before.contains(&stored_name) {
            newly_added.names.push(stored_name.clone());
        }
        let orig_ref = filename.rsplit(['/', '\\']).next().unwrap_or(&filename);
        if stored_name != orig_ref {
            renames.push((orig_ref.to_string(), stored_name));
            stats.renamed += 1;
        }
        stats.imported += 1;
        if processed == total
            || processed.is_multiple_of(10)
            || last_emit.elapsed() >= Duration::from_millis(50)
        {
            last_emit = Instant::now();
            on_progress(ImportStage::CopyingMedia, processed, total);
        }
    }

    if processed != total {
        on_progress(ImportStage::CopyingMedia, total, total);
    }

    check_cancelled(cancel)?;

    if !renames.is_empty() {
        let rename_map: std::collections::HashMap<&str, &str> = renames
            .iter()
            .map(|(old_name, new_name)| (old_name.as_str(), new_name.as_str()))
            .collect();
        for note in &mut model.notes {
            for field in &mut note.fields {
                *field = bibalak_core::media_refs::rewrite_media_refs_with(field, |name| {
                    rename_map.get(name).copied()
                });
            }
            if let Some(sort) = note.sort_field.as_mut() {
                if let Some(&new_name) = rename_map.get(sort.as_str()) {
                    *sort = new_name.to_string();
                } else {
                    *sort = bibalak_core::media_refs::rewrite_media_refs_with(sort, |name| {
                        rename_map.get(name).copied()
                    });
                }
            }
        }
        for tpl in &mut model.templates {
            tpl.qfmt = bibalak_core::media_refs::rewrite_media_refs_with(&tpl.qfmt, |name| {
                rename_map.get(name).copied()
            });
            tpl.afmt = bibalak_core::media_refs::rewrite_media_refs_with(&tpl.afmt, |name| {
                rename_map.get(name).copied()
            });
        }
        for nt in &mut model.notetypes {
            nt.config_json =
                bibalak_core::media_refs::rewrite_media_refs_with(&nt.config_json, |name| {
                    rename_map.get(name).copied()
                });
        }
    }

    check_cancelled(cancel)?;
    newly_added.armed = false;
    Ok(stats)
}

fn read_entry_to_bytes_bounded(
    archive: &mut Archive,
    name: &str,
    max_bytes: u64,
) -> CoreResult<Option<Vec<u8>>> {
    let mut entry = match archive.by_name(name) {
        Ok(e) => e,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(fmt(e)),
    };
    if entry.size() > max_bytes {
        return Err(CoreError::Format(format!(
            "package entry '{name}' exceeds maximum size limit of {max_bytes} bytes"
        )));
    }
    read_bounded(&mut entry, max_bytes, name).map(Some)
}

/// Read a media blob from the zip archive, streaming zstd decompression when
/// the payload begins with the zstd magic, enforcing `max_bytes` on both layers.
fn read_media_entry_bounded(
    archive: &mut Archive,
    name: &str,
    max_bytes: u64,
) -> CoreResult<Option<Vec<u8>>> {
    let mut entry = match archive.by_name(name) {
        Ok(e) => e,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(fmt(e)),
    };
    if entry.size() > max_bytes {
        return Err(CoreError::Format(format!(
            "media entry '{name}' exceeds maximum size limit of {max_bytes} bytes"
        )));
    }
    let mut header = [0u8; 4];
    let mut hdr_len = 0;
    while hdr_len < 4 {
        let n = entry.read(&mut header[hdr_len..]).map_err(fmt)?;
        if n == 0 {
            break;
        }
        hdr_len += n;
    }
    if hdr_len == 4 && header == ZSTD_MAGIC {
        let chained = std::io::Cursor::new(header).chain((&mut entry).take(max_bytes));
        let mut decoder = zstd::stream::read::Decoder::new(chained).map_err(fmt)?;
        read_bounded(&mut decoder, max_bytes, name).map(Some)
    } else {
        let mut out = Vec::with_capacity(hdr_len);
        out.extend_from_slice(&header[..hdr_len]);
        let remaining_cap = max_bytes.saturating_sub(hdr_len as u64);
        let copied = std::io::copy(
            &mut (&mut entry).take(remaining_cap.saturating_add(1)),
            &mut out,
        )
        .map_err(fmt)?;
        if hdr_len as u64 + copied > max_bytes {
            return Err(CoreError::Format(format!(
                "media entry '{name}' exceeds maximum size limit of {max_bytes} bytes"
            )));
        }
        Ok(Some(out))
    }
}

fn json_i64(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(|v| {
        v.as_i64()
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
    })
}

fn json_str(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}
