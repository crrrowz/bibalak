//! Write a [`CanonicalModel`] as an Anki v11 `.apkg` file.
//!
//! Format: ZIP containing `collection.anki2` (SQLite v11 schema with JSON-blob
//! `col` table) + `media` (JSON index `{"0":"filename",...}`) + numbered media
//! blobs copied from the on-disk media directory (if provided).
//!
//! v11 is chosen for maximum compatibility: every Anki version ≥ 2.0 can open
//! it. v18 / `.colpkg` export can be added later behind the same `write_apkg`
//! signature.

use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::ExportStage;
use bibalak_core::model::{CanonicalModel, Card, DeckConfig, Note, Notetype, Revlog};
use bibalak_core::ports::MediaStore;
use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};

const FIELD_SEP: char = '\u{1f}';
const ZIP_BUF_BYTES: usize = 256 * 1024;
const MEDIA_CHUNK_BYTES: usize = 64 * 1024;
const PROGRESS_BYTE_STRIDE: u64 = 256 * 1024;
const PROGRESS_MIN_INTERVAL: Duration = Duration::from_millis(50);
const DB_PROGRESS_STRIDE: u32 = 250;

/// Progress snapshot emitted by [`write_apkg_streaming`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExportProgressUpdate {
    pub stage: ExportStage,
    pub notes_done: u32,
    pub notes_total: u32,
    pub cards_done: u32,
    pub cards_total: u32,
    pub media_done: u32,
    pub media_total: u32,
    pub bytes_done: u64,
    pub bytes_total: u64,
}

/// Outcome returned by [`write_apkg_streaming`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamingExportOutcome {
    pub media_exported: u32,
    pub bytes_written: u64,
}

struct PartialFileGuard {
    path: PathBuf,
    armed: bool,
}

impl PartialFileGuard {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for PartialFileGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

fn partial_sibling_path(dest_path: &Path) -> PathBuf {
    let parent = dest_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let file_name = dest_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("export.apkg");
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    parent.join(format!(
        ".{file_name}.keepsake-partial-{}-{nanos}",
        std::process::id()
    ))
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

fn check_cancelled(cancel: &AtomicBool) -> CoreResult<()> {
    if cancel.load(Ordering::Relaxed) {
        Err(CoreError::Cancelled)
    } else {
        Ok(())
    }
}

fn fmt(e: impl std::fmt::Display) -> CoreError {
    CoreError::Format(e.to_string())
}

/// Write `model` as an `.apkg` file to `dest_path`. If `media_dir` is `Some`,
/// all regular files in that directory are streamed as media entries.
pub fn write_apkg(
    model: &CanonicalModel,
    dest_path: &Path,
    media_dir: Option<&Path>,
) -> CoreResult<u32> {
    let media_files = collect_media_entries(media_dir)?;
    let cancel = AtomicBool::new(false);
    let outcome = write_apkg_with_opener(
        model,
        dest_path,
        &media_files,
        &mut |filename| {
            let dir = media_dir.ok_or_else(|| CoreError::NotFound("no media dir".into()))?;
            let file = std::fs::File::open(dir.join(filename)).map_err(fmt)?;
            Ok(Box::new(BufReader::new(file)))
        },
        &cancel,
        &mut |_| {},
    )?;
    Ok(outcome.media_exported)
}

/// Write `model` as an `.apkg` file to `dest_path`, sourcing media entries from
/// `media_store` via streaming readers without SHA-1 hashing.
pub fn write_apkg_with_media(
    model: &CanonicalModel,
    dest_path: &Path,
    media_store: Option<&dyn MediaStore>,
) -> CoreResult<u32> {
    let media_files = match media_store {
        Some(store) => store.list_sizes()?,
        None => Vec::new(),
    };
    let cancel = AtomicBool::new(false);
    let outcome = write_apkg_streaming(
        model,
        dest_path,
        media_store,
        &media_files,
        &cancel,
        &mut |_| {},
    )?;
    Ok(outcome.media_exported)
}

/// Stream `model` and `media_files` into an Anki-valid `.apkg` at `dest_path`,
/// writing via a hidden sibling temp file and atomic rename, polling `cancel`,
/// and emitting progress updates.
pub fn write_apkg_streaming(
    model: &CanonicalModel,
    dest_path: &Path,
    media_store: Option<&dyn MediaStore>,
    media_files: &[(String, u64)],
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(ExportProgressUpdate),
) -> CoreResult<StreamingExportOutcome> {
    write_apkg_with_opener(
        model,
        dest_path,
        media_files,
        &mut |filename| {
            let store = media_store
                .ok_or_else(|| CoreError::NotFound(format!("no media store for {filename}")))?;
            store.open_reader(filename)
        },
        cancel,
        on_progress,
    )
}

fn write_apkg_with_opener(
    model: &CanonicalModel,
    dest_path: &Path,
    media_files: &[(String, u64)],
    open_media: &mut dyn FnMut(&str) -> CoreResult<Box<dyn Read + Send>>,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(ExportProgressUpdate),
) -> CoreResult<StreamingExportOutcome> {
    check_cancelled(cancel)?;

    let notes_total = model.notes.len() as u32;
    let cards_total = model.cards.len() as u32;
    let media_total = media_files.len() as u32;
    let bytes_total: u64 = media_files.iter().map(|(_, s)| *s).sum();

    on_progress(ExportProgressUpdate {
        stage: ExportStage::WritingDb,
        notes_done: 0,
        notes_total,
        cards_done: 0,
        cards_total,
        media_done: 0,
        media_total,
        bytes_done: 0,
        bytes_total,
    });

    // 1. Build collection.anki2 in a temp directory (never buffered into Vec<u8>).
    let db_dir = tempfile::tempdir().map_err(fmt)?;
    let db_path = db_dir.path().join("collection.anki2");
    build_sqlite_to_file(
        model,
        &db_path,
        notes_total,
        cards_total,
        media_total,
        bytes_total,
        cancel,
        on_progress,
    )?;
    check_cancelled(cancel)?;

    // 2. Write the ZIP to a hidden sibling temp file guarded by RAII cleanup.
    if let Some(parent) = dest_path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(fmt)?;
    }
    let temp_path = partial_sibling_path(dest_path);
    let mut partial_guard = PartialFileGuard::new(temp_path.clone());

    let file = std::fs::File::create(&temp_path).map_err(fmt)?;
    let buf_writer = BufWriter::with_capacity(ZIP_BUF_BYTES, file);
    let mut zip = zip::ZipWriter::new(buf_writer);
    let deflate_opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let stored_opts =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

    // Stream collection.anki2 (Deflated)
    zip.start_file("collection.anki2", deflate_opts)
        .map_err(fmt)?;
    {
        let db_file = std::fs::File::open(&db_path).map_err(fmt)?;
        let mut reader = BufReader::with_capacity(ZIP_BUF_BYTES, db_file);
        std::io::copy(&mut reader, &mut zip).map_err(fmt)?;
    }
    check_cancelled(cancel)?;

    // Stream media files in 64 KB chunks without buffering whole blobs.
    on_progress(ExportProgressUpdate {
        stage: ExportStage::PackingMedia,
        notes_done: notes_total,
        notes_total,
        cards_done: cards_total,
        cards_total,
        media_done: 0,
        media_total,
        bytes_done: 0,
        bytes_total,
    });

    let mut index: Map<String, Value> = Map::new();
    let mut media_done = 0u32;
    let mut bytes_done = 0u64;
    let mut last_emitted_bytes = 0u64;
    let mut last_emit = Instant::now();
    let mut chunk = vec![0u8; MEDIA_CHUNK_BYTES];

    for (i, (filename, _size)) in media_files.iter().enumerate() {
        check_cancelled(cancel)?;
        let mut reader = open_media(filename)?;
        let entry = i.to_string();
        let media_opts = if is_precompressed_media(filename) {
            stored_opts
        } else {
            deflate_opts
        };
        zip.start_file(&entry, media_opts).map_err(fmt)?;
        loop {
            check_cancelled(cancel)?;
            let n = reader.read(&mut chunk).map_err(fmt)?;
            if n == 0 {
                break;
            }
            zip.write_all(&chunk[..n]).map_err(fmt)?;
            bytes_done = bytes_done.saturating_add(n as u64);
            if bytes_done.saturating_sub(last_emitted_bytes) >= PROGRESS_BYTE_STRIDE
                || last_emit.elapsed() >= PROGRESS_MIN_INTERVAL
            {
                last_emitted_bytes = bytes_done;
                last_emit = Instant::now();
                on_progress(ExportProgressUpdate {
                    stage: ExportStage::PackingMedia,
                    notes_done: notes_total,
                    notes_total,
                    cards_done: cards_total,
                    cards_total,
                    media_done,
                    media_total,
                    bytes_done,
                    bytes_total,
                });
            }
        }
        index.insert(entry, Value::String(filename.clone()));
        media_done += 1;
    }

    check_cancelled(cancel)?;
    on_progress(ExportProgressUpdate {
        stage: ExportStage::Finalizing,
        notes_done: notes_total,
        notes_total,
        cards_done: cards_total,
        cards_total,
        media_done,
        media_total,
        bytes_done,
        bytes_total,
    });

    zip.start_file("media", deflate_opts).map_err(fmt)?;
    zip.write_all(
        serde_json::to_string(&Value::Object(index))
            .map_err(fmt)?
            .as_bytes(),
    )
    .map_err(fmt)?;

    let mut finished_writer = zip.finish().map_err(fmt)?;
    finished_writer.flush().map_err(fmt)?;
    drop(finished_writer);

    check_cancelled(cancel)?;

    std::fs::rename(&temp_path, dest_path).map_err(fmt)?;
    partial_guard.disarm();

    let bytes_written = std::fs::metadata(dest_path).map_err(fmt)?.len();
    Ok(StreamingExportOutcome {
        media_exported: media_done,
        bytes_written,
    })
}

fn collect_media_entries(media_dir: Option<&Path>) -> CoreResult<Vec<(String, u64)>> {
    let Some(dir) = media_dir else {
        return Ok(vec![]);
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(vec![]);
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        out.push((name.to_string(), size));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

// ── SQLite v11 writer ────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn build_sqlite_to_file(
    model: &CanonicalModel,
    db_path: &Path,
    notes_total: u32,
    cards_total: u32,
    media_total: u32,
    bytes_total: u64,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(ExportProgressUpdate),
) -> CoreResult<()> {
    let conn = Connection::open(db_path).map_err(fmt)?;
    create_v11_schema(&conn)?;
    conn.execute_batch("BEGIN").map_err(fmt)?;
    insert_col(&conn, model)?;
    insert_notes(
        &conn,
        &model.notes,
        notes_total,
        cards_total,
        media_total,
        bytes_total,
        cancel,
        on_progress,
    )?;
    insert_cards(
        &conn,
        model,
        notes_total,
        cards_total,
        media_total,
        bytes_total,
        cancel,
        on_progress,
    )?;
    insert_revlog(&conn, &model.revlog, cancel)?;
    conn.execute_batch("COMMIT").map_err(fmt)?;
    Ok(())
}

fn create_v11_schema(conn: &Connection) -> CoreResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode=DELETE;
         CREATE TABLE IF NOT EXISTS col (
             id    INTEGER PRIMARY KEY,
             crt   INTEGER NOT NULL,
             mod   INTEGER NOT NULL,
             scm   INTEGER NOT NULL,
             ver   INTEGER NOT NULL,
             dty   INTEGER NOT NULL,
             usn   INTEGER NOT NULL,
             ls    INTEGER NOT NULL,
             conf  TEXT NOT NULL,
             models TEXT NOT NULL,
             decks  TEXT NOT NULL,
             dconf  TEXT NOT NULL,
             tags   TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS notes (
             id    INTEGER PRIMARY KEY,
             guid  TEXT NOT NULL,
             mid   INTEGER NOT NULL,
             mod   INTEGER NOT NULL,
             usn   INTEGER NOT NULL,
             tags  TEXT NOT NULL,
             flds  TEXT NOT NULL,
             sfld  INTEGER NOT NULL,
             csum  INTEGER NOT NULL,
             flags INTEGER NOT NULL,
             data  TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS cards (
             id    INTEGER PRIMARY KEY,
             nid   INTEGER NOT NULL,
             did   INTEGER NOT NULL,
             ord   INTEGER NOT NULL,
             mod   INTEGER NOT NULL,
             usn   INTEGER NOT NULL,
             type  INTEGER NOT NULL,
             queue INTEGER NOT NULL,
             due   INTEGER NOT NULL,
             ivl   INTEGER NOT NULL,
             factor INTEGER NOT NULL,
             reps  INTEGER NOT NULL,
             lapses INTEGER NOT NULL,
             left  INTEGER NOT NULL,
             odue  INTEGER NOT NULL,
             odid  INTEGER NOT NULL,
             flags INTEGER NOT NULL,
             data  TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS revlog (
             id      INTEGER PRIMARY KEY,
             cid     INTEGER NOT NULL,
             usn     INTEGER NOT NULL,
             ease    INTEGER NOT NULL,
             ivl     INTEGER NOT NULL,
             lastIvl INTEGER NOT NULL,
             factor  INTEGER NOT NULL,
             time    INTEGER NOT NULL,
             type    INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS graves (
             usn  INTEGER NOT NULL,
             oid  INTEGER NOT NULL,
             type INTEGER NOT NULL
         );",
    )
    .map_err(fmt)
}

fn insert_col(conn: &Connection, model: &CanonicalModel) -> CoreResult<()> {
    let now_sec = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let crt_sec = model
        .created_ms
        .map(|ms| ms.div_euclid(1000))
        .unwrap_or(now_sec);

    let models_json = build_models_json(model);
    let decks_json = build_decks_json(model);
    let dconf_json = build_dconf_json(model);

    conn.execute(
        "INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
         VALUES (1, ?1, ?2, ?3, 11, 0, 0, 0, '{}', ?4, ?5, ?6, '{}')",
        params![
            crt_sec,
            now_sec,
            now_sec,
            models_json,
            decks_json,
            dconf_json
        ],
    )
    .map_err(fmt)?;
    Ok(())
}

fn build_models_json(model: &CanonicalModel) -> String {
    let mut map = Map::new();
    for nt in &model.notetypes {
        let fields: Vec<Value> = model
            .fields
            .iter()
            .filter(|f| f.notetype_id == nt.id)
            .map(|f| {
                let opts = bibalak_core::ipc::parse_field_options(&f.config_json);
                let mut obj = Map::new();
                obj.insert("name".into(), Value::String(f.name.clone()));
                obj.insert("ord".into(), json!(f.ord));
                obj.insert("sticky".into(), Value::Bool(false));
                match opts.direction {
                    bibalak_core::ipc::FieldDirection::Auto => {}
                    bibalak_core::ipc::FieldDirection::Rtl => {
                        obj.insert("rtl".into(), Value::Bool(true));
                    }
                    bibalak_core::ipc::FieldDirection::Ltr => {
                        obj.insert("rtl".into(), Value::Bool(false));
                    }
                }
                if !opts.font.is_empty() {
                    obj.insert("font".into(), Value::String(opts.font));
                }
                if opts.size > 0 {
                    obj.insert("size".into(), json!(opts.size));
                }
                if !opts.description.is_empty() {
                    obj.insert("description".into(), Value::String(opts.description));
                }
                obj.insert("searchable".into(), Value::Bool(false));
                Value::Object(obj)
            })
            .collect();

        let tmpls: Vec<Value> = model
            .templates
            .iter()
            .filter(|t| t.notetype_id == nt.id)
            .map(|t| {
                json!({
                    "name": t.name,
                    "ord": t.ord,
                    "qfmt": t.qfmt,
                    "afmt": t.afmt,
                    "bqfmt": "",
                    "bafmt": "",
                    "did": null,
                    "bfont": "",
                    "bsize": 0
                })
            })
            .collect();

        let entry = notetype_to_v11(nt, fields, tmpls);
        map.insert(nt.id.to_string(), entry);
    }
    serde_json::to_string(&Value::Object(map)).unwrap_or_else(|_| "{}".into())
}

fn notetype_to_v11(nt: &Notetype, fields: Vec<Value>, tmpls: Vec<Value>) -> Value {
    // Try to extract css and sortf from config_json; default to empty / 0.
    // Never export internal `keepsakePreset` metadata.
    let parsed = serde_json::from_str::<Value>(&nt.config_json).ok();
    let css = parsed
        .as_ref()
        .and_then(|v| v.get("css").and_then(|c| c.as_str()).map(str::to_string))
        .unwrap_or_default();
    let sortf = bibalak_core::ipc::parse_notetype_sort_field(&nt.config_json);
    let is_io = bibalak_core::notetype_preset::is_image_occlusion_config(&nt.config_json)
        || parsed
            .as_ref()
            .and_then(|v| v.get("originalStockKind").and_then(Value::as_i64))
            == Some(6);

    let mut obj = match json!({
        "id": nt.id,
        "name": nt.name,
        "type": nt.kind,
        "mod": nt.mod_ms / 1000,
        "usn": nt.usn,
        "sortf": sortf,
        "did": null,
        "tmpls": tmpls,
        "flds": fields,
        "css": css,
        "latexPre": "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
        "latexPost": "\\end{document}",
        "latexsvg": false,
        "req": [],
        "tags": [],
        "vers": []
    }) {
        Value::Object(m) => m,
        _ => unreachable!(),
    };
    if is_io {
        obj.insert("originalStockKind".into(), json!(6));
        obj.insert("kind".into(), Value::String("image-occlusion".into()));
        if let Some(mode) = parsed
            .as_ref()
            .and_then(|v| v.get("occlusionMode").and_then(Value::as_str))
        {
            obj.insert("occlusionMode".into(), Value::String(mode.to_string()));
        }
    }
    Value::Object(obj)
}

fn build_decks_json(model: &CanonicalModel) -> String {
    if model.decks.is_empty() {
        return r#"{"1":{"id":1,"name":"Default","conf":1,"mod":0,"usn":-1,"lrnToday":[0,0],"revToday":[0,0],"newToday":[0,0],"timeToday":[0,0],"collapsed":false,"dyn":0,"desc":""}}"#.into();
    }

    let mut map = Map::new();
    for d in &model.decks {
        let entry = json!({
            "id": d.id,
            "name": d.name,
            "conf": d.config_id,
            "mod": d.mod_ms / 1000,
            "usn": d.usn,
            "lrnToday": [0, 0],
            "revToday": [0, 0],
            "newToday": [0, 0],
            "timeToday": [0, 0],
            "collapsed": d.collapsed,
            "dyn": if d.is_filtered { 1 } else { 0 },
            "desc": ""
        });
        map.insert(d.id.to_string(), entry);
    }
    serde_json::to_string(&Value::Object(map)).unwrap_or_else(|_| "{}".into())
}

fn build_dconf_json(model: &CanonicalModel) -> String {
    let mut map = Map::new();
    let configs: &[DeckConfig] = &model.deck_configs;

    // If no configs in model, emit a minimal default.
    if configs.is_empty() {
        map.insert(
            "1".into(),
            json!({
                "id": 1,
                "name": "Default",
                "mod": 0,
                "usn": -1,
                "maxTaken": 60,
                "autoplay": true,
                "timer": 0,
                "replayq": true,
                "new": {"bury": true, "delays": [1, 10], "initialFactor": 2500, "ints": [1, 4, 7], "order": 1, "perDay": 20},
                "lapse": {"delays": [10], "leechAction": 0, "leechFails": 8, "minInt": 1, "mult": 0.0},
                "rev": {"bury": false, "ease4": 1.3, "fuzz": 0.05, "ivlFct": 1.0, "maxIvl": 36500, "minSpace": 1, "perDay": 100}
            }),
        );
    } else {
        for cfg in configs {
            // Try to reuse existing config JSON; fall back to minimal.
            let entry = match serde_json::from_str::<Value>(&cfg.config_json) {
                Ok(mut v) => {
                    if let Some(obj) = v.as_object_mut() {
                        obj.insert("id".into(), json!(cfg.id));
                        obj.insert("name".into(), json!(cfg.name));
                        obj.insert("mod".into(), json!(cfg.mod_ms / 1000));
                        obj.insert("usn".into(), json!(cfg.usn));
                    }
                    v
                }
                Err(_) => {
                    json!({"id": cfg.id, "name": cfg.name, "mod": cfg.mod_ms / 1000, "usn": cfg.usn})
                }
            };
            map.insert(cfg.id.to_string(), entry);
        }
    }
    serde_json::to_string(&Value::Object(map)).unwrap_or_else(|_| "{}".into())
}

#[allow(clippy::too_many_arguments)]
fn insert_notes(
    conn: &Connection,
    notes: &[Note],
    notes_total: u32,
    cards_total: u32,
    media_total: u32,
    bytes_total: u64,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(ExportProgressUpdate),
) -> CoreResult<()> {
    let mut stmt = conn
        .prepare(
            "INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, '')",
        )
        .map_err(fmt)?;

    for (idx, n) in notes.iter().enumerate() {
        check_cancelled(cancel)?;
        let tags = if n.tags.is_empty() {
            String::new()
        } else {
            format!(" {} ", n.tags.join(" "))
        };
        let flds = n.fields.join(&FIELD_SEP.to_string());
        let sfld = n.sort_field.as_deref().unwrap_or_default();
        let csum = n.checksum.unwrap_or(0);
        stmt.execute(params![
            n.id,
            n.guid,
            n.notetype_id,
            n.mod_ms / 1000,
            n.usn,
            tags,
            flds,
            sfld,
            csum,
        ])
        .map_err(fmt)?;
        let done = (idx + 1) as u32;
        if done.is_multiple_of(DB_PROGRESS_STRIDE) || done == notes_total {
            on_progress(ExportProgressUpdate {
                stage: ExportStage::WritingDb,
                notes_done: done,
                notes_total,
                cards_done: 0,
                cards_total,
                media_done: 0,
                media_total,
                bytes_done: 0,
                bytes_total,
            });
        }
    }
    Ok(())
}

/// Convert a learning timestamp from Bibalak ms to Anki seconds when exporting.
fn to_anki_learn_due(due: i64) -> i64 {
    if due >= 100_000_000_000 {
        due.div_euclid(1000)
    } else {
        due
    }
}

fn card_data_json(c: &Card, created_ms: Option<i64>, desired_retention: Option<f64>) -> String {
    let mut map = c
        .data
        .as_deref()
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .and_then(|v| match v {
            Value::Object(m) => Some(m),
            _ => None,
        })
        .unwrap_or_default();

    if let Some(s) = c.fsrs_stability {
        map.insert("s".into(), json!(s));
    }
    if let Some(d) = c.fsrs_difficulty {
        map.insert("d".into(), json!(d));
    }
    if !map.contains_key("dr") && (c.fsrs_stability.is_some() || c.fsrs_difficulty.is_some()) {
        if let Some(dr) = desired_retention {
            map.insert("dr".into(), json!(dr));
        }
    }
    if let Some(lrt) = c.fsrs_last_review {
        let lrt_secs = if lrt >= 100_000_000_000 {
            Some(lrt.div_euclid(1000))
        } else if lrt >= 1_000_000 {
            Some(lrt)
        } else {
            created_ms.map(|crt| crt.div_euclid(1000) + lrt.saturating_mul(86_400))
        };
        if let Some(secs) = lrt_secs {
            map.insert("lrt".into(), json!(secs));
        }
    }

    if map.is_empty() {
        String::new()
    } else {
        Value::Object(map).to_string()
    }
}

#[allow(clippy::too_many_arguments)]
fn insert_cards(
    conn: &Connection,
    model: &CanonicalModel,
    notes_total: u32,
    cards_total: u32,
    media_total: u32,
    bytes_total: u64,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(ExportProgressUpdate),
) -> CoreResult<()> {
    let deck_config_by_deck: std::collections::HashMap<i64, i64> =
        model.decks.iter().map(|d| (d.id, d.config_id)).collect();
    let dr_by_config: std::collections::HashMap<i64, f64> = model
        .deck_configs
        .iter()
        .filter_map(|cfg| {
            let v: Value = serde_json::from_str(&cfg.config_json).ok()?;
            let dr = v
                .pointer("/fsrs/desiredRetention")
                .and_then(Value::as_f64)
                .filter(|x| x.is_finite() && *x > 0.0)?;
            Some((cfg.id, dr))
        })
        .collect();

    let mut stmt = conn
        .prepare(
            "INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl,
                                factor, reps, lapses, left, odue, odid, flags, data)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                     ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        )
        .map_err(fmt)?;

    for (idx, c) in model.cards.iter().enumerate() {
        check_cancelled(cancel)?;
        let due = if c.queue == 1 || (c.queue < 0 && (c.ctype == 1 || c.ctype == 3)) {
            to_anki_learn_due(c.due)
        } else {
            c.due
        };
        let odue = if c.original_deck_id != 0 && (c.ctype == 1 || c.ctype == 3) {
            to_anki_learn_due(c.original_due)
        } else {
            c.original_due
        };
        let dr = deck_config_by_deck
            .get(&c.deck_id)
            .and_then(|cid| dr_by_config.get(cid))
            .copied();
        let data_json = card_data_json(c, model.created_ms, dr);
        stmt.execute(params![
            c.id,
            c.note_id,
            c.deck_id,
            c.ord,
            c.mod_ms / 1000,
            c.usn,
            c.ctype,
            c.queue,
            due,
            c.interval,
            c.ease_factor,
            c.reps,
            c.lapses,
            c.remaining,
            odue,
            c.original_deck_id,
            c.flags,
            data_json,
        ])
        .map_err(fmt)?;
        let done = (idx + 1) as u32;
        if done.is_multiple_of(DB_PROGRESS_STRIDE) || done == cards_total {
            on_progress(ExportProgressUpdate {
                stage: ExportStage::WritingDb,
                notes_done: notes_total,
                notes_total,
                cards_done: done,
                cards_total,
                media_done: 0,
                media_total,
                bytes_done: 0,
                bytes_total,
            });
        }
    }
    Ok(())
}

fn insert_revlog(conn: &Connection, revlog: &[Revlog], cancel: &AtomicBool) -> CoreResult<()> {
    let mut stmt = conn
        .prepare(
            "INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .map_err(fmt)?;

    for r in revlog {
        check_cancelled(cancel)?;
        stmt.execute(params![
            r.id,
            r.card_id,
            r.usn,
            r.ease,
            r.interval,
            r.last_interval,
            r.ease_factor,
            r.taken_ms,
            r.review_kind,
        ])
        .map_err(fmt)?;
    }
    Ok(())
}
