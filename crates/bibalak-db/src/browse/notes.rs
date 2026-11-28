use std::collections::{HashMap, HashSet};

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::{parse_notetype_sort_field, EmptyCardItem, QualityNoteEdit};
use bibalak_core::model::NoteSnapshot;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use super::text::{clean_sort_value, compute_sort_and_checksum, field_checksum, strip_tags};
use super::{err, join_tags, split_tags, FIELD_SEP};

pub(super) fn update_note_fields_only(
    conn: &Connection,
    note_id: i64,
    fields: &[String],
    tags: &[String],
    now_ms: i64,
) -> CoreResult<(i64, i64)> {
    let first_field_raw = fields.first().map(|s| s.as_str()).unwrap_or_default();
    if clean_sort_value(first_field_raw).is_empty() {
        return Err(CoreError::Invalid("first field cannot be empty".into()));
    }
    let row: Option<(i64, i64, String)> = conn
        .query_row(
            "SELECT n.notetype_id, nt.kind, nt.config \
             FROM notes n JOIN notetypes nt ON nt.id = n.notetype_id WHERE n.id = ?1",
            [note_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(err)?;
    let Some((notetype_id, kind, nt_config)) = row else {
        return Err(CoreError::NotFound(format!("note {note_id}")));
    };
    let expected_field_count: usize = conn
        .query_row(
            "SELECT COUNT(*) FROM fields WHERE notetype_id = ?1",
            [notetype_id],
            |r| r.get::<_, i64>(0),
        )
        .map_err(err)? as usize;
    if fields.len() != expected_field_count {
        return Err(CoreError::Invalid(format!(
            "expected {expected_field_count} fields, got {}",
            fields.len()
        )));
    }
    let sort_ord = parse_notetype_sort_field(&nt_config) as usize;
    let joined = fields.join(&FIELD_SEP.to_string());
    let (sort_field, checksum) = compute_sort_and_checksum(fields, sort_ord);
    let fields_norm = crate::search::fields_norm_value(&joined, Some(&sort_field));
    conn.execute(
        r#"UPDATE notes SET fields = ?2, sort_field = ?3, tags = ?4, "mod" = ?5, usn = -1, checksum = ?6, fields_norm = ?7
           WHERE id = ?1"#,
        params![note_id, joined, sort_field, join_tags(tags), now_ms, checksum, fields_norm],
    )
    .map_err(err)?;
    crate::tags::register_tags(conn, tags.iter().map(String::as_str))?;
    Ok((notetype_id, kind))
}

pub fn update_note(
    conn: &Connection,
    note_id: i64,
    fields: &[String],
    tags: &[String],
    now_ms: i64,
) -> CoreResult<()> {
    let (notetype_id, kind) = update_note_fields_only(conn, note_id, fields, tags, now_ms)?;
    let expected_ords = expected_card_ords(conn, notetype_id, kind, fields)?;

    let mut existing_ords = HashSet::new();
    let mut home_deck_id: Option<i64> = None;
    {
        let mut stmt = conn
            .prepare(
                "SELECT ord, deck_id, original_deck_id FROM cards WHERE note_id = ?1 ORDER BY id",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([note_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(err)?;
        for row in rows {
            let (ord, deck_id, original_deck_id) = row.map_err(err)?;
            existing_ords.insert(ord);
            if home_deck_id.is_none() {
                home_deck_id = Some(if original_deck_id != 0 {
                    original_deck_id
                } else {
                    deck_id
                });
            }
        }
    }
    let deck_id = home_deck_id.unwrap_or(1);
    for ord in expected_ords {
        if !existing_ords.contains(&ord) {
            insert_new_card(conn, note_id, deck_id, ord, now_ms)?;
            existing_ords.insert(ord);
        }
    }
    Ok(())
}

const GUID_CHARS: &[u8] =
    b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";

pub fn generate_guid() -> String {
    let mut s = String::with_capacity(10);
    for _ in 0..10 {
        let idx = fastrand::usize(..GUID_CHARS.len());
        s.push(GUID_CHARS[idx] as char);
    }
    s
}

/// Find an existing note sharing the same notetype and first field: checks exact Anki `csum` first,
/// then falls back to `normalize_search_text` diacritic/case folding matching `find_duplicates` (`A2-34`).
pub fn find_duplicate_note(
    conn: &Connection,
    notetype_id: i64,
    first_field: &str,
) -> CoreResult<Option<i64>> {
    let csum = field_checksum(first_field);
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM notes WHERE notetype_id = ?1 AND checksum = ?2 LIMIT 1",
            params![notetype_id, csum],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
    {
        return Ok(Some(id));
    }

    let plain_target =
        super::text::decode_entities(&strip_tags(first_field)).replace('\u{a0}', " ");
    let norm_target = bibalak_core::normalize_search_text(
        &plain_target
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" "),
    );
    if norm_target.is_empty() {
        return Ok(None);
    }

    let mut stmt = conn
        .prepare("SELECT id, fields FROM notes WHERE notetype_id = ?1 ORDER BY id ASC")
        .map_err(err)?;
    let rows = stmt
        .query_map([notetype_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(err)?;
    for row in rows {
        let (note_id, blob) = row.map_err(err)?;
        let Some(raw0) = blob.split(FIELD_SEP).next() else {
            continue;
        };
        let plain0 = super::text::decode_entities(&strip_tags(raw0)).replace('\u{a0}', " ");
        let norm0 = bibalak_core::normalize_search_text(
            &plain0.split_whitespace().collect::<Vec<_>>().join(" "),
        );
        if norm0 == norm_target {
            return Ok(Some(note_id));
        }
    }
    Ok(None)
}

fn cloze_template_fields(templates: &[(i64, String, String)]) -> HashSet<String> {
    let mut names = HashSet::new();
    for (_, qfmt, afmt) in templates {
        for tmpl in [qfmt.as_str(), afmt.as_str()] {
            let mut s = tmpl;
            while let Some(open) = s.find("{{") {
                s = &s[open + 2..];
                let Some(close) = s.find("}}") else {
                    break;
                };
                let inner = s[..close].trim();
                let stripped = inner
                    .strip_prefix('#')
                    .or_else(|| inner.strip_prefix('^'))
                    .or_else(|| inner.strip_prefix('/'))
                    .unwrap_or(inner)
                    .trim();
                if let Some((filters_part, field_name)) = stripped.rsplit_once(':') {
                    let has_cloze = filters_part.split(':').any(|f| {
                        let f = f.trim();
                        f == "cloze" || f == "cloze-only"
                    });
                    if has_cloze {
                        let f = field_name.trim();
                        if !f.is_empty() {
                            names.insert(f.to_string());
                        }
                    }
                }
                s = &s[close + 2..];
            }
        }
    }
    names
}

/// Scan field values for unique `{{cN::…}}` ordinals in active cloze fields.
fn cloze_ordinals(
    field_names: &[String],
    templates: &[(i64, String, String)],
    fields: &[String],
) -> std::collections::BTreeSet<u32> {
    let mut set = std::collections::BTreeSet::new();
    let cloze_fields = cloze_template_fields(templates);
    let restrict = !templates.is_empty() && !field_names.is_empty();
    for (idx, field) in fields.iter().enumerate() {
        if restrict
            && !field_names
                .get(idx)
                .is_some_and(|name| cloze_fields.contains(name))
        {
            continue;
        }
        let mut s = field.as_str();
        while let Some(pos) = s.find("{{c") {
            s = &s[pos + 3..];
            let end = s.find(':').unwrap_or(0);
            if let Ok(n) = s[..end].parse::<u32>() {
                if n > 0 {
                    set.insert(n);
                }
            }
        }
    }
    set
}

pub(super) fn insert_new_card(
    conn: &Connection,
    note_id: i64,
    deck_id: i64,
    ord: i64,
    now_ms: i64,
) -> CoreResult<()> {
    // `due` for new cards = position in the global new queue (1-indexed, monotone).
    let next_pos: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(due), 0) + 1 FROM cards WHERE queue = 0",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    conn.execute(
        r#"INSERT INTO cards
           (note_id, deck_id, ord, "mod", usn, type, queue, due,
            interval, ease_factor, reps, lapses, remaining,
            original_due, original_deck_id, flags)
           VALUES (?1, ?2, ?3, ?4, -1, 0, 0, ?5, 0, 0, 0, 0, 0, 0, 0, 0)"#,
        params![note_id, deck_id, ord, now_ms, next_pos],
    )
    .map_err(err)?;
    Ok(())
}

pub(super) fn expected_card_ords_with(
    kind: i64,
    field_names: &[String],
    templates: &[(i64, String, String)],
    fields: &[String],
) -> CoreResult<Vec<i64>> {
    if kind == 1 {
        return Ok(cloze_ordinals(field_names, templates, fields)
            .into_iter()
            .map(|n| (n - 1) as i64)
            .collect());
    }

    let field_pairs: Vec<(String, String)> = field_names
        .iter()
        .cloned()
        .zip(fields.iter().cloned())
        .collect();

    let mut ords = Vec::new();
    for (ord, qfmt, afmt) in templates {
        let rendered = bibalak_render::render(&bibalak_render::RenderRequest {
            template: bibalak_render::Template { qfmt, afmt },
            fields: &field_pairs,
            card_ord: *ord as u16,
            is_cloze: false,
            ..Default::default()
        })
        .map_err(|e| CoreError::Invalid(e.to_string()))?;
        if !clean_sort_value(&rendered.question).is_empty() {
            ords.push(*ord);
        }
    }
    Ok(ords)
}

/// Compute which card `ord`s should exist for `fields` under `(notetype_id, kind)`.
pub(super) fn expected_card_ords(
    conn: &Connection,
    notetype_id: i64,
    kind: i64,
    fields: &[String],
) -> CoreResult<Vec<i64>> {
    let mut f_stmt = conn
        .prepare("SELECT name FROM fields WHERE notetype_id = ?1 ORDER BY ord")
        .map_err(err)?;
    let f_names: Vec<String> = f_stmt
        .query_map([notetype_id], |r| r.get(0))
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;

    let mut t_stmt = conn
        .prepare("SELECT ord, qfmt, afmt FROM templates WHERE notetype_id = ?1 ORDER BY ord")
        .map_err(err)?;
    let tmpls = t_stmt
        .query_map([notetype_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;

    expected_card_ords_with(kind, &f_names, &tmpls, fields)
}

/// Insert a note and generate its cards in a single transaction.
/// Standard notetypes (kind = 0): one card per template whose front renders non-empty.
/// Cloze notetypes (kind = 1): one card per cloze ordinal found in active cloze fields.
pub fn add_note_with_cards(
    tx: &Transaction<'_>,
    notetype_id: i64,
    deck_id: i64,
    fields: &[String],
    tags: &[String],
    now_ms: i64,
) -> CoreResult<(i64, u32)> {
    let first_field_raw = fields.first().map(|s| s.as_str()).unwrap_or_default();
    if clean_sort_value(first_field_raw).is_empty() {
        return Err(CoreError::Invalid("first field cannot be empty".into()));
    }

    let (kind, nt_config): (i64, String) = tx
        .query_row(
            "SELECT kind, config FROM notetypes WHERE id = ?1",
            [notetype_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?
        .ok_or_else(|| CoreError::NotFound(format!("notetype {notetype_id}")))?;
    let expected_field_count: usize = tx
        .query_row(
            "SELECT COUNT(*) FROM fields WHERE notetype_id = ?1",
            [notetype_id],
            |r| r.get::<_, i64>(0),
        )
        .map_err(err)? as usize;
    if fields.len() != expected_field_count {
        return Err(CoreError::Invalid(format!(
            "expected {expected_field_count} fields, got {}",
            fields.len()
        )));
    }

    let sort_ord = parse_notetype_sort_field(&nt_config) as usize;
    let fields_blob = fields.join(&FIELD_SEP.to_string());
    let (sort_field, checksum) = compute_sort_and_checksum(fields, sort_ord);
    let fields_norm = crate::search::fields_norm_value(&fields_blob, Some(&sort_field));
    let tags_str = join_tags(tags);
    let guid = generate_guid();

    tx.execute(
        r#"INSERT INTO notes (guid, notetype_id, "mod", usn, tags, fields, sort_field, checksum, fields_norm)
           VALUES (?1, ?2, ?3, -1, ?4, ?5, ?6, ?7, ?8)"#,
        params![
            guid,
            notetype_id,
            now_ms,
            tags_str,
            fields_blob,
            sort_field,
            checksum,
            fields_norm
        ],
    )
    .map_err(err)?;
    let note_id = tx.last_insert_rowid();

    let ords = expected_card_ords(tx, notetype_id, kind, fields)?;
    if ords.is_empty() {
        return Err(CoreError::Invalid("note creates no cards".into()));
    }
    for ord in &ords {
        insert_new_card(tx, note_id, deck_id, *ord, now_ms)?;
    }
    crate::tags::register_tags(tx, tags.iter().map(String::as_str))?;

    Ok((note_id, ords.len() as u32))
}

/// Insert a batch of notes in a single transaction via [`add_note_with_cards`].
pub fn add_notes_batch(
    tx: &Transaction<'_>,
    notetype_id: i64,
    deck_id: i64,
    notes: &[bibalak_core::ipc::BatchNoteInput],
    now_ms: i64,
) -> CoreResult<(Vec<i64>, u32)> {
    let mut note_ids = Vec::with_capacity(notes.len());
    let mut total_cards = 0u32;
    for note in notes {
        let (note_id, cards) =
            add_note_with_cards(tx, notetype_id, deck_id, &note.fields, &note.tags, now_ms)?;
        note_ids.push(note_id);
        total_cards += cards;
    }
    Ok((note_ids, total_cards))
}

pub fn restore_notes(
    conn: &mut Connection,
    snapshots: &[NoteSnapshot],
    now_ms: i64,
) -> CoreResult<()> {
    if snapshots.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction().map_err(err)?;
    for snap in snapshots {
        update_note(&tx, snap.note_id, &snap.fields, &snap.tags, now_ms)?;
    }
    tx.commit().map_err(err)?;
    Ok(())
}

/// Apply accepted quality rewrites and tag additions inside ONE transaction, rejecting
/// missing notes, and returning pre-edit [`NoteSnapshot`]s for single-step undo.
///
/// Note fields are not deck-specific, so edits are permitted even when a card of the note
/// currently resides in a filtered deck.
pub fn apply_quality_fixes(
    conn: &mut Connection,
    edits: &[QualityNoteEdit],
    now_ms: i64,
) -> CoreResult<Vec<NoteSnapshot>> {
    if edits.is_empty() {
        return Ok(Vec::new());
    }
    let tx = conn.transaction().map_err(err)?;
    let mut snapshots: Vec<NoteSnapshot> = Vec::new();
    let mut captured_ids: HashSet<i64> = HashSet::new();

    // Aggregate per note_id in first-seen order so multiple edits for one note compose cleanly.
    let mut merged: Vec<QualityNoteEdit> = Vec::new();
    let mut index_by_id: HashMap<i64, usize> = HashMap::new();
    for edit in edits {
        if let Some(&idx) = index_by_id.get(&edit.note_id) {
            let existing = &mut merged[idx];
            if edit.fields.is_some() {
                existing.fields = edit.fields.clone();
            }
            existing.add_tags.extend(edit.add_tags.iter().cloned());
        } else {
            index_by_id.insert(edit.note_id, merged.len());
            merged.push(edit.clone());
        }
    }

    for edit in &merged {
        let row: Option<(String, String)> = tx
            .query_row(
                "SELECT fields, tags FROM notes WHERE id = ?1",
                [edit.note_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        let Some((fields_raw, tags_raw)) = row else {
            return Err(CoreError::NotFound(format!("note {}", edit.note_id)));
        };

        let current_fields: Vec<String> = fields_raw.split(FIELD_SEP).map(str::to_string).collect();
        let current_tags = split_tags(&tags_raw);

        if captured_ids.insert(edit.note_id) {
            snapshots.push(NoteSnapshot {
                note_id: edit.note_id,
                fields: current_fields.clone(),
                tags: current_tags.clone(),
            });
        }

        let next_fields = match &edit.fields {
            Some(new_fields) => {
                if new_fields.len() != current_fields.len() {
                    return Err(CoreError::Invalid(format!(
                        "note {} rewrite expected {} fields, got {}",
                        edit.note_id,
                        current_fields.len(),
                        new_fields.len()
                    )));
                }
                new_fields.clone()
            }
            None => current_fields,
        };

        let mut next_tags = current_tags;
        let mut seen: HashSet<String> = next_tags.iter().cloned().collect();
        for tag in &edit.add_tags {
            let trimmed = tag.trim();
            if trimmed.is_empty() {
                continue;
            }
            if trimmed.chars().any(char::is_whitespace) {
                return Err(CoreError::Invalid(format!(
                    "tag '{trimmed}' cannot contain whitespace"
                )));
            }
            if seen.insert(trimmed.to_string()) {
                next_tags.push(trimmed.to_string());
            }
        }

        update_note(&tx, edit.note_id, &next_fields, &next_tags, now_ms)?;
    }

    tx.commit().map_err(err)?;
    Ok(snapshots)
}

/// Find every existing card whose rendered front is empty under current note fields (`A2-12`).
pub fn find_empty_cards(conn: &Connection) -> CoreResult<Vec<EmptyCardItem>> {
    struct CachedNotetype {
        name: String,
        kind: i64,
        field_names: Vec<String>,
        templates: Vec<(i64, String, String)>,
        template_names: HashMap<i64, String>,
    }

    let mut nt_cache: HashMap<i64, CachedNotetype> = HashMap::new();
    let mut nt_stmt = conn
        .prepare("SELECT id, name, kind FROM notetypes")
        .map_err(err)?;
    let nt_rows = nt_stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })
        .map_err(err)?;
    for row in nt_rows {
        let (nt_id, name, kind) = row.map_err(err)?;
        let mut f_stmt = conn
            .prepare("SELECT name FROM fields WHERE notetype_id = ?1 ORDER BY ord")
            .map_err(err)?;
        let field_names = f_stmt
            .query_map([nt_id], |r| r.get(0))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<String>>>()
            .map_err(err)?;

        let mut t_stmt = conn
            .prepare(
                "SELECT ord, name, qfmt, afmt FROM templates WHERE notetype_id = ?1 ORDER BY ord",
            )
            .map_err(err)?;
        let t_rows = t_stmt
            .query_map([nt_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;

        let mut templates = Vec::with_capacity(t_rows.len());
        let mut template_names = HashMap::with_capacity(t_rows.len());
        for (ord, tname, qfmt, afmt) in t_rows {
            template_names.insert(ord, tname);
            templates.push((ord, qfmt, afmt));
        }

        nt_cache.insert(
            nt_id,
            CachedNotetype {
                name,
                kind,
                field_names,
                templates,
                template_names,
            },
        );
    }

    let mut note_stmt = conn
        .prepare("SELECT id, notetype_id, fields, COALESCE(sort_field, '') FROM notes ORDER BY id")
        .map_err(err)?;
    let notes = note_stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;

    let mut card_stmt = conn
        .prepare(
            "SELECT c.id, c.ord, COALESCE(d.name, '') \
             FROM cards c \
             LEFT JOIN decks d ON d.id = c.deck_id \
             WHERE c.note_id = ?1 \
             ORDER BY c.id",
        )
        .map_err(err)?;

    let mut out = Vec::new();
    for (note_id, notetype_id, blob, sort_field) in notes {
        let Some(nt) = nt_cache.get(&notetype_id) else {
            continue;
        };
        let fields: Vec<String> = blob.split(FIELD_SEP).map(str::to_string).collect();
        let expected: HashSet<i64> =
            expected_card_ords_with(nt.kind, &nt.field_names, &nt.templates, &fields)?
                .into_iter()
                .collect();

        let cards = card_stmt
            .query_map([note_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;

        for (card_id, ord, deck_name) in cards {
            if !expected.contains(&ord) {
                let template_name = if nt.kind == 1 {
                    format!("Cloze {}", ord + 1)
                } else {
                    nt.template_names
                        .get(&ord)
                        .cloned()
                        .unwrap_or_else(|| format!("Card {}", ord + 1))
                };
                out.push(EmptyCardItem {
                    card_id,
                    note_id,
                    deck_name,
                    notetype_name: nt.name.clone(),
                    template_name,
                    sort_field: sort_field.clone(),
                    ord,
                });
            }
        }
    }
    Ok(out)
}

/// Delete confirmed empty cards inside one transaction, re-verifying each card is still empty (`A2-12`).
pub fn delete_empty_cards(
    conn: &mut Connection,
    card_ids: &[i64],
    _now_ms: i64,
) -> CoreResult<u32> {
    if card_ids.is_empty() {
        return Ok(0);
    }
    let tx = conn.transaction().map_err(err)?;
    let empty_ids: HashSet<i64> = find_empty_cards(&tx)?
        .into_iter()
        .map(|c| c.card_id)
        .collect();
    let mut deleted = 0u32;
    let mut seen = HashSet::new();
    for &id in card_ids {
        if seen.insert(id) && empty_ids.contains(&id) {
            tx.execute("DELETE FROM cards WHERE id = ?1", [id])
                .map_err(err)?;
            deleted += 1;
        }
    }
    tx.commit().map_err(err)?;
    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::super::model;
    use crate::storage::SqliteStorage;
    use bibalak_core::ports::*;

    #[test]
    fn add_note_rejects_empty_first_field() {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.import(&model(), 1_000).unwrap();
        let nt_id = s.list_notetypes().unwrap()[0].id;

        let mut conn = s.lock();
        let tx = conn.transaction().unwrap();
        let err = super::add_note_with_cards(
            &tx,
            nt_id,
            1,
            &["   ".to_string(), "back".to_string()],
            &[],
            1_000,
        )
        .unwrap_err();
        match err {
            bibalak_core::error::CoreError::Invalid(msg) => {
                assert!(msg.contains("first field"));
            }
            other => panic!("expected CoreError::Invalid, got {other:?}"),
        }
    }

    #[test]
    fn add_note_only_creates_cards_for_non_empty_front_templates() {
        use bibalak_core::model::Template;
        let s = SqliteStorage::open_in_memory().unwrap();
        let mut m = model();
        // Add a second template for reverse card: {{Back}} -> {{Front}}
        m.templates.push(Template {
            notetype_id: 10,
            ord: 1,
            name: "Card 2".into(),
            qfmt: "{{Back}}".into(),
            afmt: "{{Front}}".into(),
            config_json: "{}".into(),
        });
        s.import(&m, 1_000).unwrap();
        let nt_id = s.list_notetypes().unwrap()[0].id;

        let mut conn = s.lock();
        let tx = conn.transaction().unwrap();
        // Back field is empty, so only template 0 renders non-empty front
        let (note_id, count) = super::add_note_with_cards(
            &tx,
            nt_id,
            1,
            &["Question".to_string(), "".to_string()],
            &[],
            1_000,
        )
        .unwrap();
        assert_eq!(
            count, 1,
            "only template with non-empty front should create a card"
        );

        let cards_in_db: i64 = tx
            .query_row(
                "SELECT count(*) FROM cards WHERE note_id = ?1",
                [note_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cards_in_db, 1);
    }

    #[test]
    fn add_note_rejects_cloze_with_no_cloze_markers() {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.import(&model(), 1_000).unwrap();
        let cloze_nt_id = s.create_notetype("Cloze", 1, 1000).unwrap();

        let mut conn = s.lock();
        let tx = conn.transaction().unwrap();
        let err = super::add_note_with_cards(
            &tx,
            cloze_nt_id,
            1,
            &["Text without cloze".to_string(), "extra".to_string()],
            &[],
            1_000,
        )
        .unwrap_err();
        match err {
            bibalak_core::error::CoreError::Invalid(msg) => {
                assert!(msg.contains("no cards"));
            }
            other => panic!("expected CoreError::Invalid, got {other:?}"),
        }
    }

    #[test]
    fn new_notes_get_random_collision_safe_guids() {
        let s1 = SqliteStorage::open_in_memory().unwrap();
        s1.import(&model(), 1_000).unwrap();
        let nt_id1 = s1.list_notetypes().unwrap()[0].id;

        let s2 = SqliteStorage::open_in_memory().unwrap();
        s2.import(&model(), 1_000).unwrap();
        let nt_id2 = s2.list_notetypes().unwrap()[0].id;

        let mut conn1 = s1.lock();
        let tx1 = conn1.transaction().unwrap();
        let (id1, _) = super::add_note_with_cards(
            &tx1,
            nt_id1,
            1,
            &["Front 1".to_string(), "Back 1".to_string()],
            &[],
            1_000,
        )
        .unwrap();

        let mut conn2 = s2.lock();
        let tx2 = conn2.transaction().unwrap();
        let (id2, _) = super::add_note_with_cards(
            &tx2,
            nt_id2,
            1,
            &["Front 1".to_string(), "Back 1".to_string()],
            &[],
            1_000,
        )
        .unwrap();

        let guid1: String = tx1
            .query_row("SELECT guid FROM notes WHERE id = ?1", [id1], |r| r.get(0))
            .unwrap();
        let guid2: String = tx2
            .query_row("SELECT guid FROM notes WHERE id = ?1", [id2], |r| r.get(0))
            .unwrap();

        assert_ne!(
            guid1, guid2,
            "two collections must not share new note guids"
        );
        assert_ne!(
            guid1,
            id1.to_string(),
            "guid must not simply be the note rowid"
        );
        assert_eq!(guid1.len(), 10, "guid should be ~10 chars Anki-style");
    }

    #[test]
    fn new_and_updated_notes_have_checksum() {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.import(&model(), 1_000).unwrap();
        let nt_id = s.list_notetypes().unwrap()[0].id;

        let mut conn = s.lock();
        let tx = conn.transaction().unwrap();
        let (note_id, _) = super::add_note_with_cards(
            &tx,
            nt_id,
            1,
            &["<b>Question</b>".to_string(), "Answer".to_string()],
            &[],
            1_000,
        )
        .unwrap();

        let csum: Option<i64> = tx
            .query_row("SELECT checksum FROM notes WHERE id = ?1", [note_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(csum.is_some(), "new note must have checksum set");
        assert_ne!(csum.unwrap(), 0);
    }

    #[test]
    fn add_note_with_cards_registers_new_tags_in_registry() {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_000).unwrap();
        let nt_id = s.add_stock_notetype(0, 1_000).unwrap();

        s.add_note_with_cards(
            nt_id,
            1,
            &["Q1".into(), "A1".into()],
            &[
                "vocab".into(),
                "Arabic::verb".into(),
                "  spaced  ".into(),
                "vocab".into(),
                "".into(),
            ],
            2_000,
        )
        .unwrap();

        assert_eq!(
            s.list_tags().unwrap(),
            vec![
                "Arabic::verb".to_string(),
                "spaced".to_string(),
                "vocab".to_string(),
            ]
        );

        let usns: Vec<(String, i64)> = {
            let conn = s.lock();
            let mut stmt = conn
                .prepare("SELECT name, usn FROM tags ORDER BY name")
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert_eq!(
            usns,
            vec![
                ("Arabic::verb".to_string(), -1),
                ("spaced".to_string(), -1),
                ("vocab".to_string(), -1),
            ]
        );

        // Adding another note with an existing tag does not duplicate it.
        s.add_note_with_cards(
            nt_id,
            1,
            &["Q2".into(), "A2".into()],
            &["vocab".into()],
            3_000,
        )
        .unwrap();
        assert_eq!(s.list_tags().unwrap().len(), 3);
    }

    #[test]
    fn update_note_registers_tags_without_duplicating_or_deleting() {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_000).unwrap();
        let nt_id = s.add_stock_notetype(0, 1_000).unwrap();
        let (note_id, _) = s
            .add_note_with_cards(
                nt_id,
                1,
                &["Q1".into(), "A1".into()],
                &["vocab".into()],
                1_000,
            )
            .unwrap();

        s.update_note(
            note_id,
            &["Q1".into(), "A1".into()],
            &["grammar".into(), "vocab".into()],
            2_000,
        )
        .unwrap();

        assert_eq!(
            s.list_tags().unwrap(),
            vec!["grammar".to_string(), "vocab".to_string()]
        );

        // Removing "grammar" from the note leaves it in the registry (Anki keeps unused tags).
        s.update_note(
            note_id,
            &["Q1".into(), "A1".into()],
            &["vocab".into()],
            3_000,
        )
        .unwrap();
        assert_eq!(
            s.list_tags().unwrap(),
            vec!["grammar".to_string(), "vocab".to_string()]
        );
    }

    #[test]
    fn add_notes_batch_inserts_notes_cards_and_registers_tags_in_one_transaction() {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_000).unwrap();
        let basic_id = s.add_stock_notetype(0, 1_000).unwrap();

        let (ids, cards) = s
            .add_notes_batch(
                basic_id,
                1,
                &[
                    bibalak_core::ipc::BatchNoteInput {
                        fields: vec!["Q1".into(), "A1".into()],
                        tags: vec!["ai-generated".into()],
                    },
                    bibalak_core::ipc::BatchNoteInput {
                        fields: vec!["Q2".into(), "A2".into()],
                        tags: vec!["ai-generated".into(), "cardiology".into()],
                    },
                ],
                2_000,
            )
            .unwrap();

        assert_eq!(ids.len(), 2);
        assert_eq!(cards, 2);
        assert_eq!(
            s.list_tags().unwrap(),
            vec!["ai-generated".to_string(), "cardiology".to_string()]
        );
    }

    #[test]
    fn update_note_records_undo_and_restores_previous_fields() {
        use bibalak_core::ports::FixedClock;
        use bibalak_core::Collection;
        use std::sync::Arc;

        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_000).unwrap();
        let basic_id = s.add_stock_notetype(0, 1_000).unwrap();
        let (note_id, _) = s
            .add_note_with_cards(
                basic_id,
                1,
                &["Front Q".into(), "Original Back".into()],
                &["tag1".into()],
                1_500,
            )
            .unwrap();

        let col = Collection::new(Box::new(s), Arc::new(FixedClock(2_000))).unwrap();
        col.update_note(
            note_id,
            &[
                "Front Q".into(),
                "Original Back<br><br>Appended tutor note".into(),
            ],
            &["tag1".into(), "added-tag".into()],
        )
        .unwrap();

        assert_eq!(
            col.undo_status(),
            Some(bibalak_core::undo::UndoAction::EditNote)
        );
        let edited = col.note_detail(note_id).unwrap().unwrap();
        assert_eq!(
            edited.fields[1].value,
            "Original Back<br><br>Appended tutor note"
        );
        assert_eq!(edited.tags, vec!["tag1", "added-tag"]);

        let undone = col.undo().unwrap();
        assert_eq!(undone, Some(bibalak_core::undo::UndoAction::EditNote));

        let restored = col.note_detail(note_id).unwrap().unwrap();
        assert_eq!(restored.fields[1].value, "Original Back");
        assert_eq!(restored.tags, vec!["tag1"]);
    }

    #[test]
    fn add_note_records_undo_and_removes_note_and_cards() {
        use bibalak_core::ipc::BatchNoteInput;
        use bibalak_core::ports::FixedClock;
        use bibalak_core::Collection;
        use std::sync::Arc;

        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_000).unwrap();
        let basic_id = s.add_stock_notetype(0, 1_000).unwrap();

        let col = Collection::new(Box::new(s), Arc::new(FixedClock(2_000))).unwrap();
        let added = col
            .add_note(basic_id, 1, &["Q1".into(), "A1".into()], &["added".into()])
            .unwrap();
        assert_eq!(added.cards_added, 1);
        assert_eq!(
            col.undo_status(),
            Some(bibalak_core::undo::UndoAction::AddNote { count: 1 })
        );
        assert!(col.note_detail(added.note_id).unwrap().is_some());
        assert_eq!(col.deck_card_ids(1, false).unwrap().len(), 1);

        let undone = col.undo().unwrap();
        assert_eq!(
            undone,
            Some(bibalak_core::undo::UndoAction::AddNote { count: 1 })
        );
        assert!(col.note_detail(added.note_id).unwrap().is_none());
        assert!(col.deck_card_ids(1, false).unwrap().is_empty());

        let batch = col
            .add_notes_batch(
                basic_id,
                1,
                &[
                    BatchNoteInput {
                        fields: vec!["B1".into(), "A1".into()],
                        tags: vec![],
                    },
                    BatchNoteInput {
                        fields: vec!["B2".into(), "A2".into()],
                        tags: vec![],
                    },
                ],
            )
            .unwrap();
        assert_eq!(
            col.undo_status(),
            Some(bibalak_core::undo::UndoAction::AddNote { count: 2 })
        );
        assert_eq!(col.deck_card_ids(1, false).unwrap().len(), 2);

        col.undo().unwrap();
        assert!(col.deck_card_ids(1, false).unwrap().is_empty());
        assert!(col.note_detail(batch.note_ids[0]).unwrap().is_none());
    }

    #[test]
    fn load_quality_notes_includes_subdecks_and_leeches_only_up_to_200() {
        use bibalak_core::ports::FixedClock;
        use bibalak_core::Collection;
        use std::sync::Arc;

        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_000).unwrap();
        let basic_id = s.add_stock_notetype(0, 1_000).unwrap();
        let parent = s.create_deck("Medicine", 1_000).unwrap();
        let child = s.create_deck("Medicine::Cardiology", 1_000).unwrap();

        let (n1, _) = s
            .add_note_with_cards(
                basic_id,
                parent.id,
                &["Q1".into(), "A1".into()],
                &["leech".into()],
                1_100,
            )
            .unwrap();
        let (n2, _) = s
            .add_note_with_cards(
                basic_id,
                child.id,
                &["Q2".into(), "A2".into()],
                &["anatomy".into()],
                1_200,
            )
            .unwrap();

        let col = Collection::new(Box::new(s), Arc::new(FixedClock(2_000))).unwrap();
        let all = col
            .load_quality_notes(Some(parent.id), None, false)
            .unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|n| n.note_id == n1));
        assert!(all.iter().any(|n| n.note_id == n2));

        let leeches = col.load_quality_notes(Some(parent.id), None, true).unwrap();
        assert_eq!(leeches.len(), 1);
        assert_eq!(leeches[0].note_id, n1);
    }

    #[test]
    fn apply_quality_fixes_updates_checksum_tags_and_undoes_in_one_transaction() {
        use bibalak_core::ipc::QualityNoteEdit;
        use bibalak_core::ports::FixedClock;
        use bibalak_core::undo::UndoAction;
        use bibalak_core::Collection;
        use std::sync::Arc;

        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_000).unwrap();
        let basic_id = s.add_stock_notetype(0, 1_000).unwrap();
        let (n1, _) = s
            .add_note_with_cards(
                basic_id,
                1,
                &["Old Q1".into(), "Old A1".into()],
                &["cardio".into()],
                1_100,
            )
            .unwrap();
        let (n2, _) = s
            .add_note_with_cards(
                basic_id,
                1,
                &["Keep Q2".into(), "Keep A2".into()],
                &[],
                1_200,
            )
            .unwrap();

        let col = Collection::new(Box::new(s), Arc::new(FixedClock(2_000))).unwrap();
        let res = col
            .apply_quality_fixes(&[
                QualityNoteEdit {
                    note_id: n1,
                    fields: Some(vec!["Rewritten Q1".into(), "Clearer A1".into()]),
                    add_tags: vec!["ai-reviewed".into()],
                },
                QualityNoteEdit {
                    note_id: n2,
                    fields: None,
                    add_tags: vec!["pharmacology".into()],
                },
            ])
            .unwrap();
        assert_eq!(res.notes_updated, 2);
        assert_eq!(
            col.undo_status(),
            Some(UndoAction::QualityFixes { count: 2 })
        );

        // Rewritten first field recomputed checksum and registered added tags
        assert_eq!(
            col.check_duplicate(basic_id, "Rewritten Q1").unwrap(),
            Some(n1)
        );
        assert_eq!(col.check_duplicate(basic_id, "Old Q1").unwrap(), None);
        assert!(col
            .list_tags()
            .unwrap()
            .contains(&"ai-reviewed".to_string()));
        assert!(col
            .list_tags()
            .unwrap()
            .contains(&"pharmacology".to_string()));

        // One undo restores both notes completely
        let undone = col.undo().unwrap();
        assert_eq!(undone, Some(UndoAction::QualityFixes { count: 2 }));
        assert_eq!(col.check_duplicate(basic_id, "Old Q1").unwrap(), Some(n1));
        let n2_restored = col.note_detail(n2).unwrap().unwrap();
        assert!(n2_restored.tags.is_empty());
    }

    #[test]
    fn apply_quality_fixes_rejects_missing_and_filtered_deck_notes() {
        use bibalak_core::ipc::QualityNoteEdit;
        use bibalak_core::ports::FixedClock;
        use bibalak_core::Collection;
        use std::sync::Arc;

        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_000).unwrap();
        let basic_id = s.add_stock_notetype(0, 1_000).unwrap();
        let (n1, _) = s
            .add_note_with_cards(basic_id, 1, &["Filtered Q".into(), "A".into()], &[], 1_100)
            .unwrap();
        let filtered = s.create_filtered_deck("Cram", "", 0, 10, 0, 1_200).unwrap();
        {
            let conn = s.lock();
            conn.execute(
                "UPDATE cards SET deck_id = ?1 WHERE note_id = ?2",
                rusqlite::params![filtered.id, n1],
            )
            .unwrap();
        }

        let col = Collection::new(Box::new(s), Arc::new(FixedClock(2_000))).unwrap();
        assert!(col
            .apply_quality_fixes(&[QualityNoteEdit {
                note_id: 999_999,
                fields: None,
                add_tags: vec!["tag".into()],
            }])
            .is_err());
        let res = col
            .apply_quality_fixes(&[QualityNoteEdit {
                note_id: n1,
                fields: Some(vec!["Updated Filtered Q".into(), "A".into()]),
                add_tags: vec!["cardiology".into()],
            }])
            .unwrap();
        assert_eq!(res.notes_updated, 1);
    }

    #[test]
    fn update_note_and_add_note_reject_wrong_field_count() {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.import(&model(), 1_000).unwrap();
        let nt_id = s.list_notetypes().unwrap()[0].id;
        let (note_id, _) = s
            .add_note_with_cards(nt_id, 1, &["Q".into(), "A".into()], &[], 1_000)
            .unwrap();

        let upd_err = s.update_note(note_id, &["OnlyOneField".into()], &[], 2_000);
        assert!(upd_err.is_err(), "update_note must reject 1 vs 2 fields");

        let mut conn = s.lock();
        let tx = conn.transaction().unwrap();
        let add_err = super::add_note_with_cards(&tx, nt_id, 1, &["OnlyOne".into()], &[], 2_000);
        assert!(add_err.is_err(), "add_note must reject 1 vs 2 fields");
    }

    #[test]
    fn media_only_first_field_and_template_front_count_as_content() {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.import(&model(), 1_000).unwrap();
        let nt_id = s.list_notetypes().unwrap()[0].id;

        let (nid, cards) = s
            .add_note_with_cards(
                nt_id,
                1,
                &[r#"<img src="anatomy-diagram.png">"#.into(), "Femur".into()],
                &[],
                1_000,
            )
            .unwrap();
        assert_eq!(cards, 1);
        let detail = s.note_detail(nid).unwrap().unwrap();
        assert_eq!(detail.fields[0].value, r#"<img src="anatomy-diagram.png">"#);

        s.save_template(
            nt_id,
            0,
            "Card 1",
            r#"<img src="cat.png">"#,
            "{{Back}}",
            1_500,
        )
        .unwrap();
        let (_nid2, cards2) = s
            .add_note_with_cards(nt_id, 1, &["Cat".into(), "Animal".into()], &[], 2_000)
            .unwrap();
        assert_eq!(cards2, 1, "media-only template front must create a card");
    }

    #[test]
    fn cloze_ordinals_ignore_unrendered_extra_fields() {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.import(&model(), 1_000).unwrap();
        let cloze_nt = s.create_notetype("ClozeScoped", 1, 1_000).unwrap();
        let (_nid, count) = s
            .add_note_with_cards(
                cloze_nt,
                1,
                &["{{c1::alpha}}".into(), "see {{c3::unused}}".into()],
                &[],
                1_000,
            )
            .unwrap();
        assert_eq!(
            count, 1,
            "only {{cloze:}} template fields should spawn cloze cards"
        );
    }

    #[test]
    fn update_note_generates_newly_valid_cards() {
        use bibalak_core::model::Template;
        let s = SqliteStorage::open_in_memory().unwrap();
        let mut m = model();
        m.templates.push(Template {
            notetype_id: 10,
            ord: 1,
            name: "Reverse".into(),
            qfmt: "{{Back}}".into(),
            afmt: "{{Front}}".into(),
            config_json: "{}".into(),
        });
        s.import(&m, 1_000).unwrap();
        let nt_id = s.list_notetypes().unwrap()[0].id;
        let (note_id, count) = s
            .add_note_with_cards(nt_id, 1, &["Q".into(), "".into()], &[], 1_000)
            .unwrap();
        assert_eq!(count, 1);

        s.update_note(note_id, &["Q".into(), "NowBack".into()], &[], 2_000)
            .unwrap();
        let cards_after: i64 = s
            .lock()
            .query_row(
                "SELECT COUNT(*) FROM cards WHERE note_id = ?1",
                [note_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            cards_after, 2,
            "filling Back on update should generate the reverse card"
        );
    }

    #[test]
    fn a2_12_finds_and_deletes_only_empty_cards() {
        use bibalak_core::model::Template;
        let s = SqliteStorage::open_in_memory().unwrap();
        let mut m = model();
        m.templates.push(Template {
            notetype_id: 10,
            ord: 1,
            name: "Reverse".into(),
            qfmt: "{{Back}}".into(),
            afmt: "{{Front}}".into(),
            config_json: "{}".into(),
        });
        s.import(&m, 1_000).unwrap();
        let nt_id = s.list_notetypes().unwrap()[0].id;
        let (note_id, count) = s
            .add_note_with_cards(nt_id, 1, &["Q".into(), "NowBack".into()], &[], 1_000)
            .unwrap();
        assert_eq!(count, 2);

        // Clear Back field: Reverse (ord=1) card becomes empty on disk without auto-deletion.
        s.update_note(note_id, &["Q".into(), "".into()], &[], 2_000)
            .unwrap();
        let empty = super::find_empty_cards(&s.lock()).unwrap();
        assert_eq!(empty.len(), 1);
        assert_eq!(empty[0].ord, 1);
        assert_eq!(empty[0].template_name, "Reverse");

        let deleted = super::delete_empty_cards(&mut s.lock(), &[empty[0].card_id], 3_000).unwrap();
        assert_eq!(deleted, 1);
        assert!(super::find_empty_cards(&s.lock()).unwrap().is_empty());

        let remaining: i64 = s
            .lock()
            .query_row(
                "SELECT COUNT(*) FROM cards WHERE note_id = ?1",
                [note_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 1);
    }

    #[test]
    fn a2_34_find_duplicate_note_matches_diacritics_like_find_duplicates() {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.import(&model(), 1_000).unwrap();
        let nt_id = s.list_notetypes().unwrap()[0].id;
        let (note_id, _) = s
            .add_note_with_cards(nt_id, 1, &["Café".into(), "Coffee".into()], &[], 1_000)
            .unwrap();

        assert_eq!(
            super::find_duplicate_note(&s.lock(), nt_id, "Café").unwrap(),
            Some(note_id)
        );
        assert_eq!(
            super::find_duplicate_note(&s.lock(), nt_id, "cafe").unwrap(),
            Some(note_id),
            "diacritic-folded duplicate check must agree with find_duplicates"
        );
    }
}
