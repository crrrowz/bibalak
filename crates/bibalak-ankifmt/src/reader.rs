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
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::ImportStage;
use bibalak_core::model::{
    CanonicalModel, Card, Deck, DeckConfig, Field, Note, Notetype, Revlog, Template,
};
use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;

type Archive = zip::ZipArchive<std::fs::File>;

fn fmt(e: impl std::fmt::Display) -> CoreError {
    CoreError::Format(e.to_string())
}

/// (entry name, zstd-compressed?) in priority order.
const COLLECTION_CANDIDATES: &[(&str, bool)] = &[
    ("collection.anki21b", true),
    ("collection.anki21", false),
    ("collection.anki2", false),
];

/// Read a package. If `media_dir` is `Some`, media files are extracted there
/// (deduped by the on-disk filename) and the count is returned.
pub fn read_package(path: &Path, media_dir: Option<&Path>) -> CoreResult<(CanonicalModel, u32)> {
    let cancel = AtomicBool::new(false);
    read_package_inner(path, media_dir, None, &cancel, &mut |_, _, _| {})
}

/// Read a package, extracting any bundled media through [`bibalak_core::ports::MediaStore`]
/// so SHA-1 deduplication and collision suffixes apply automatically.
pub fn read_package_with_media(
    path: &Path,
    media_store: Option<&dyn bibalak_core::ports::MediaStore>,
) -> CoreResult<(CanonicalModel, u32)> {
    let cancel = AtomicBool::new(false);
    read_package_inner(path, None, media_store, &cancel, &mut |_, _, _| {})
}

/// Read a package with staged progress callbacks (`ReadingPackage`, `CopyingMedia`)
/// and cooperative cancellation before the database merge starts.
pub fn read_package_with_progress(
    path: &Path,
    media_store: Option<&dyn bibalak_core::ports::MediaStore>,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(ImportStage, u32, u32),
) -> CoreResult<(CanonicalModel, u32)> {
    read_package_inner(path, None, media_store, cancel, on_progress)
}

fn check_cancelled(cancel: &AtomicBool) -> CoreResult<()> {
    if cancel.load(Ordering::Relaxed) {
        Err(CoreError::Cancelled)
    } else {
        Ok(())
    }
}

fn read_package_inner(
    path: &Path,
    media_dir: Option<&Path>,
    media_store: Option<&dyn bibalak_core::ports::MediaStore>,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(ImportStage, u32, u32),
) -> CoreResult<(CanonicalModel, u32)> {
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
    let mut bytes = Vec::new();
    {
        let mut entry = archive.by_name(coll_name).map_err(fmt)?;
        entry.read_to_end(&mut bytes).map_err(fmt)?;
    }
    if zstd_compressed {
        bytes = zstd::stream::decode_all(std::io::Cursor::new(bytes)).map_err(fmt)?;
    }

    check_cancelled(cancel)?;
    // SQLite needs a path; use a temp dir (no lingering file handle, unlike a
    // NamedTempFile, which can clash with SQLite's own open on Windows).
    let dir = tempfile::tempdir().map_err(fmt)?;
    let db_path = dir.path().join("collection.anki2");
    std::fs::write(&db_path, &bytes).map_err(fmt)?;
    let conn = Connection::open(&db_path).map_err(fmt)?;

    let mut model = read_collection(&conn)?;
    drop(conn);
    check_cancelled(cancel)?;

    let media_count = if let Some(store) = media_store {
        extract_media_to_store(&mut archive, &mut model, store, cancel, on_progress)?
    } else if let Some(target) = media_dir {
        let count = extract_media(&mut archive, target)?;
        check_cancelled(cancel)?;
        count
    } else {
        check_cancelled(cancel)?;
        0
    };

    Ok((model, media_count))
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
    let mut model = CanonicalModel::default();
    let crt_sec: Option<i64> = conn
        .query_row("SELECT crt FROM col LIMIT 1", [], |r| r.get(0))
        .optional()
        .map_err(fmt)?;
    model.created_ms = crt_sec.map(|s| s * 1000);
    // Schema detection: the modern (v18) layout has dedicated tables; the legacy
    // (v11) layout keeps decks/models/dconf as JSON blobs in `col`.
    if table_exists(conn, "notetypes")? {
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

/// Read the modern (v18) tabular layout. Deck/notetype/field/template *ids and
/// names* are plain columns; only per-row `config` is protobuf — and the only
/// piece we must decode is each template's q/a format.
fn read_v18_meta(conn: &Connection, model: &mut CanonicalModel) -> CoreResult<()> {
    {
        let mut stmt = conn.prepare("SELECT id, name FROM decks").map_err(fmt)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(fmt)?;
        for row in rows {
            let (id, name) = row.map_err(fmt)?;
            model.decks.push(Deck {
                id,
                name: name.replace('\u{1f}', "::"),
                parent_id: None,
                config_id: 1,
                mod_ms: 0,
                usn: -1,
                collapsed: false,
                is_filtered: false,
            });
        }
    }
    {
        let mut stmt = conn
            .prepare("SELECT id, name FROM notetypes")
            .map_err(fmt)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(fmt)?;
        for row in rows {
            let (id, name) = row.map_err(fmt)?;
            model.notetypes.push(Notetype {
                id,
                name,
                kind: 0, // refined to cloze below by inspecting templates
                mod_ms: 0,
                usn: -1,
                config_json: "{}".into(),
            });
        }
    }
    {
        let mut stmt = conn
            .prepare("SELECT ntid, ord, name FROM fields")
            .map_err(fmt)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Field {
                    notetype_id: r.get(0)?,
                    ord: r.get(1)?,
                    name: r.get(2)?,
                    config_json: "{}".into(),
                })
            })
            .map_err(fmt)?;
        model.fields = rows.collect::<rusqlite::Result<_>>().map_err(fmt)?;
    }
    {
        let mut stmt = conn
            .prepare("SELECT ntid, ord, name, config FROM templates")
            .map_err(fmt)?;
        let rows = stmt
            .query_map([], |r| {
                let config: Vec<u8> = r.get(3)?;
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

    // Infer cloze note types from their templates (v18 keeps `kind` in the
    // notetype's protobuf config, but the {{cloze:}} marker is unambiguous).
    for notetype in &mut model.notetypes {
        let is_cloze = model
            .templates
            .iter()
            .any(|t| t.notetype_id == notetype.id && t.qfmt.contains("{{cloze:"));
        if is_cloze {
            notetype.kind = 1;
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
        model.notetypes.push(Notetype {
            id,
            name: json_str(entry, "name"),
            kind: json_i64(entry, "type").unwrap_or(0),
            mod_ms: json_i64(entry, "mod").unwrap_or(0) * 1000,
            usn: -1,
            config_json: entry.to_string(),
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
    let mut stmt = conn
        .prepare(
            "SELECT id, nid, did, ord, mod, type, queue, due, ivl, factor, reps, lapses, left, \
             odue, odid, flags, data FROM cards",
        )
        .map_err(fmt)?;
    let rows = stmt
        .query_map([], |r| {
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
                fsrs_stability: None,
                fsrs_difficulty: None,
                fsrs_last_review: None,
                data: r.get::<_, Option<String>>(16)?,
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

fn read_media_mapping(archive: &mut Archive) -> Vec<(String, String)> {
    let Some(raw) = read_entry_to_bytes(archive, "media") else {
        return Vec::new();
    };

    match serde_json::from_slice::<Value>(&raw) {
        Ok(Value::Object(map)) => map
            .into_iter()
            .filter_map(|(index, name)| name.as_str().map(|n| (index, n.to_string())))
            .collect(),
        _ => crate::pb::media_entry_names(&raw)
            .into_iter()
            .enumerate()
            .map(|(i, name)| (i.to_string(), name))
            .collect(),
    }
}

/// Extract media into `dir`. The `media` map is JSON `{"0":"name.png"}` in v2
/// packages and a protobuf `MediaEntries` in v3; media blobs may be zstd
/// compressed (v3).
fn extract_media(archive: &mut Archive, dir: &Path) -> CoreResult<u32> {
    let mapping = read_media_mapping(archive);
    if mapping.is_empty() {
        return Ok(0);
    }

    std::fs::create_dir_all(dir).map_err(fmt)?;
    let mut count = 0;
    for (entry_name, filename) in mapping {
        // Use only the file-name component to prevent path traversal.
        let Some(safe) = Path::new(&filename).file_name() else {
            continue;
        };
        let Some(bytes) = read_entry_to_bytes(archive, &entry_name) else {
            continue;
        };
        std::fs::write(dir.join(safe), maybe_unzstd(bytes)).map_err(fmt)?;
        count += 1;
    }
    Ok(count)
}

fn extract_media_to_store(
    archive: &mut Archive,
    model: &mut CanonicalModel,
    store: &dyn bibalak_core::ports::MediaStore,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(ImportStage, u32, u32),
) -> CoreResult<u32> {
    let mapping = read_media_mapping(archive);
    if mapping.is_empty() {
        return Ok(0);
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
    let mut count = 0u32;
    let mut processed = 0u32;
    let mut renames: Vec<(String, String)> = Vec::new();
    let mut last_emit = Instant::now();

    for (entry_name, filename) in mapping {
        check_cancelled(cancel)?;
        processed += 1;
        let Some(safe) = Path::new(&filename).file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(bytes) = read_entry_to_bytes(archive, &entry_name) else {
            continue;
        };
        let decoded = maybe_unzstd(bytes);
        let stored_name = match store.add(safe, &decoded) {
            Ok(name) => name,
            Err(CoreError::Invalid(_)) => continue,
            Err(e) => return Err(e),
        };
        if !existing_before.contains(&stored_name) {
            newly_added.names.push(stored_name.clone());
        }
        if stored_name != safe {
            renames.push((safe.to_string(), stored_name));
        }
        count += 1;
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
    Ok(count)
}

fn read_entry_to_bytes(archive: &mut Archive, name: &str) -> Option<Vec<u8>> {
    let mut entry = archive.by_name(name).ok()?;
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

/// Decompress if the bytes start with the zstd magic, else return them as-is.
fn maybe_unzstd(bytes: Vec<u8>) -> Vec<u8> {
    const ZSTD_MAGIC: [u8; 4] = [0x28, 0xB5, 0x2F, 0xFD];
    if bytes.len() >= 4 && bytes[..4] == ZSTD_MAGIC {
        zstd::stream::decode_all(std::io::Cursor::new(&bytes)).unwrap_or(bytes)
    } else {
        bytes
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
