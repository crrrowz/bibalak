use std::collections::HashMap;

use bibalak_core::ai::{AIFieldInput, MAX_QUALITY_SCAN_NOTES};
use bibalak_core::error::CoreResult;
use bibalak_core::ipc::{
    parse_field_options, NoteDetail, NoteField, NoteOverview, QualityScanNote,
};
use bibalak_core::model::{Field, NoteIndexRow, Notetype, Template};
use rusqlite::{params, Connection, OptionalExtension};

use super::text::strip_tags;
use super::{err, split_tags, FIELD_SEP};

pub fn list_notes(
    conn: &Connection,
    query: Option<&str>,
    limit: i64,
) -> CoreResult<Vec<NoteOverview>> {
    let map = |r: &rusqlite::Row<'_>| {
        let tags: String = r.get(2)?;
        Ok(NoteOverview {
            note_id: r.get(0)?,
            sort_field: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            tags: split_tags(&tags),
        })
    };

    match query.map(str::trim).filter(|q| !q.is_empty()) {
        Some(q) => {
            let like = format!("%{q}%");
            let mut stmt = conn
                .prepare(
                    "SELECT id, sort_field, tags FROM notes
                     WHERE fields LIKE ?1 OR tags LIKE ?1
                     ORDER BY id DESC LIMIT ?2",
                )
                .map_err(err)?;
            let rows = stmt.query_map(params![like, limit], map).map_err(err)?;
            rows.collect::<rusqlite::Result<_>>().map_err(err)
        }
        None => {
            let mut stmt = conn
                .prepare("SELECT id, sort_field, tags FROM notes ORDER BY id DESC LIMIT ?1")
                .map_err(err)?;
            let rows = stmt.query_map([limit], map).map_err(err)?;
            rows.collect::<rusqlite::Result<_>>().map_err(err)
        }
    }
}

pub fn note_detail(conn: &Connection, note_id: i64) -> CoreResult<Option<NoteDetail>> {
    let row = conn
        .query_row(
            "SELECT notetype_id, fields, tags FROM notes WHERE id = ?1",
            [note_id],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(err)?;
    let Some((notetype_id, fields, tags)) = row else {
        return Ok(None);
    };

    let notetype_name: String = conn
        .query_row(
            "SELECT name FROM notetypes WHERE id = ?1",
            [notetype_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .unwrap_or_default();

    let mut stmt = conn
        .prepare("SELECT name, config FROM fields WHERE notetype_id = ?1 ORDER BY ord")
        .map_err(err)?;
    let field_defs: Vec<(String, String)> = stmt
        .query_map([notetype_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;

    let fields = field_defs
        .into_iter()
        .zip(fields.split(FIELD_SEP).map(str::to_string))
        .map(|((name, config), value)| NoteField {
            name,
            value,
            options: parse_field_options(&config),
        })
        .collect();

    Ok(Some(NoteDetail {
        note_id,
        notetype_name,
        fields,
        tags: split_tags(&tags),
    }))
}

/// Flatten every note for the search index: plaintext field content + the
/// note's note-type and (one of) its deck names.
pub fn index_rows(conn: &Connection) -> CoreResult<Vec<NoteIndexRow>> {
    let mut stmt = conn
        .prepare(
            "SELECT n.id, n.fields, n.tags,
                COALESCE((SELECT d.name FROM cards c JOIN decks d ON d.id = c.deck_id
                          WHERE c.note_id = n.id LIMIT 1), ''),
                COALESCE(nt.name, '')
             FROM notes n LEFT JOIN notetypes nt ON nt.id = n.notetype_id",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            let fields: String = r.get(1)?;
            Ok(NoteIndexRow {
                note_id: r.get(0)?,
                text: strip_tags(&fields.replace(FIELD_SEP, " ")),
                tags: r.get(2)?,
                deck: r.get(3)?,
                notetype: r.get(4)?,
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

/// Flatten specified notes for targeted search index updates.
pub fn index_rows_for_notes(conn: &Connection, ids: &[i64]) -> CoreResult<Vec<NoteIndexRow>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let json = serde_json::to_string(ids).map_err(err)?;
    let mut stmt = conn
        .prepare(
            "SELECT n.id, n.fields, n.tags,
                COALESCE((SELECT d.name FROM cards c JOIN decks d ON d.id = c.deck_id
                          WHERE c.note_id = n.id LIMIT 1), ''),
                COALESCE(nt.name, '')
             FROM notes n LEFT JOIN notetypes nt ON nt.id = n.notetype_id
             WHERE n.id IN (SELECT value FROM json_each(?1))",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([json], |r| {
            let fields: String = r.get(1)?;
            Ok(NoteIndexRow {
                note_id: r.get(0)?,
                text: strip_tags(&fields.replace(FIELD_SEP, " ")),
                tags: r.get(2)?,
                deck: r.get(3)?,
                notetype: r.get(4)?,
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

/// Browser rows for a set of note ids (search hits). Order is unspecified;
/// callers that need rank order should reorder by their id list.
pub fn notes_by_ids(conn: &Connection, ids: &[i64]) -> CoreResult<Vec<NoteOverview>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let json = serde_json::to_string(ids).map_err(err)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, sort_field, tags FROM notes
             WHERE id IN (SELECT value FROM json_each(?1))",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([json], |r| {
            let tags: String = r.get(2)?;
            Ok(NoteOverview {
                note_id: r.get(0)?,
                sort_field: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                tags: split_tags(&tags),
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

pub fn list_notetypes(conn: &Connection) -> CoreResult<Vec<Notetype>> {
    let mut stmt = conn
        .prepare(r#"SELECT id, name, kind, "mod", usn, config FROM notetypes ORDER BY name"#)
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Notetype {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
                mod_ms: r.get(3)?,
                usn: r.get(4)?,
                config_json: r.get(5)?,
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

pub fn fields_for_notetype(conn: &Connection, notetype_id: i64) -> CoreResult<Vec<Field>> {
    let mut stmt = conn
        .prepare(
            "SELECT notetype_id, ord, name, config FROM fields \
             WHERE notetype_id = ?1 ORDER BY ord",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([notetype_id], |r| {
            Ok(Field {
                notetype_id: r.get(0)?,
                ord: r.get(1)?,
                name: r.get(2)?,
                config_json: r.get(3)?,
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

pub fn templates_for_notetype(conn: &Connection, notetype_id: i64) -> CoreResult<Vec<Template>> {
    let mut stmt = conn
        .prepare(
            "SELECT notetype_id, ord, name, qfmt, afmt, config FROM templates \
             WHERE notetype_id = ?1 ORDER BY ord",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([notetype_id], |r| {
            Ok(Template {
                notetype_id: r.get(0)?,
                ord: r.get(1)?,
                name: r.get(2)?,
                qfmt: r.get(3)?,
                afmt: r.get(4)?,
                config_json: r.get(5)?,
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

/// Load up to `min(limit, MAX_QUALITY_SCAN_NOTES)` notes with field metadata, CSS,
/// tags, max card lapses, and non-filtered card IDs for AI deck quality scanning.
pub fn load_quality_notes(
    conn: &Connection,
    deck_id: Option<i64>,
    note_ids: Option<&[i64]>,
    leeches_only: bool,
    limit: u32,
) -> CoreResult<Vec<QualityScanNote>> {
    let cap = limit.min(MAX_QUALITY_SCAN_NOTES as u32) as i64;
    if cap == 0 || note_ids.is_some_and(|ids| ids.is_empty()) {
        return Ok(Vec::new());
    }

    let note_ids_json = note_ids
        .map(serde_json::to_string)
        .transpose()
        .map_err(err)?;
    let use_deck = deck_id.is_some() as i64;
    let use_note_ids = note_ids_json.is_some() as i64;
    let leeches_flag = leeches_only as i64;

    let sql = "
        WITH RECURSIVE scope_decks(id) AS (
            SELECT id FROM decks WHERE id = ?1 AND is_filtered = 0
            UNION ALL
            SELECT d.id FROM decks d
            JOIN scope_decks sd ON d.parent_id = sd.id
            WHERE d.is_filtered = 0
        )
        SELECT
            n.id,
            MIN(c.deck_id) AS deck_id,
            n.notetype_id,
            nt.kind,
            coalesce(json_extract(nt.config, '$.css'), '') AS notetype_css,
            n.fields,
            n.tags,
            COALESCE(MAX(c.lapses), 0) AS max_lapses
        FROM notes n
        JOIN notetypes nt ON nt.id = n.notetype_id
        JOIN cards c ON c.note_id = n.id
        JOIN decks d ON d.id = c.deck_id AND d.is_filtered = 0
        WHERE (?2 = 0 OR c.deck_id IN (SELECT id FROM scope_decks))
          AND (?3 = 0 OR n.id IN (SELECT value FROM json_each(?4)))
          AND (?5 = 0 OR n.tags LIKE '% leech %')
        GROUP BY n.id
        ORDER BY max_lapses DESC, n.id ASC
        LIMIT ?6
    ";

    struct RawRow {
        note_id: i64,
        deck_id: i64,
        notetype_id: i64,
        notetype_kind: u8,
        notetype_css: String,
        fields_raw: String,
        tags_raw: String,
        lapses: u32,
    }

    let mut stmt = conn.prepare(sql).map_err(err)?;
    let raw_rows: Vec<RawRow> = stmt
        .query_map(
            params![
                deck_id.unwrap_or(0),
                use_deck,
                use_note_ids,
                note_ids_json.unwrap_or_else(|| "[]".to_string()),
                leeches_flag,
                cap
            ],
            |r| {
                Ok(RawRow {
                    note_id: r.get(0)?,
                    deck_id: r.get(1)?,
                    notetype_id: r.get(2)?,
                    notetype_kind: r.get::<_, i64>(3)?.max(0) as u8,
                    notetype_css: r.get(4)?,
                    fields_raw: r.get(5)?,
                    tags_raw: r.get(6)?,
                    lapses: r.get::<_, i64>(7)?.max(0) as u32,
                })
            },
        )
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;

    if raw_rows.is_empty() {
        return Ok(Vec::new());
    }

    let mut field_names_by_nt: HashMap<i64, Vec<String>> = HashMap::new();
    let mut nt_stmt = conn
        .prepare("SELECT name FROM fields WHERE notetype_id = ?1 ORDER BY ord")
        .map_err(err)?;
    for row in &raw_rows {
        if let std::collections::hash_map::Entry::Vacant(e) =
            field_names_by_nt.entry(row.notetype_id)
        {
            let names: Vec<String> = nt_stmt
                .query_map([row.notetype_id], |r| r.get(0))
                .map_err(err)?
                .collect::<rusqlite::Result<_>>()
                .map_err(err)?;
            e.insert(names);
        }
    }

    let returned_ids: Vec<i64> = raw_rows.iter().map(|r| r.note_id).collect();
    let returned_json = serde_json::to_string(&returned_ids).map_err(err)?;
    let mut card_ids_by_note: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut card_stmt = conn
        .prepare(
            "SELECT note_id, id FROM cards
             WHERE note_id IN (SELECT value FROM json_each(?1))
             ORDER BY note_id, ord, id",
        )
        .map_err(err)?;
    let card_pairs = card_stmt
        .query_map([returned_json], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
        })
        .map_err(err)?;
    for pair in card_pairs {
        let (nid, cid) = pair.map_err(err)?;
        card_ids_by_note.entry(nid).or_default().push(cid);
    }

    let mut out = Vec::with_capacity(raw_rows.len());
    for row in raw_rows {
        let field_names = field_names_by_nt
            .get(&row.notetype_id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let fields = row
            .fields_raw
            .split(FIELD_SEP)
            .enumerate()
            .map(|(i, val)| AIFieldInput {
                name: field_names
                    .get(i)
                    .cloned()
                    .unwrap_or_else(|| format!("Field {}", i + 1)),
                value_html: val.to_string(),
            })
            .collect();
        out.push(QualityScanNote {
            note_id: row.note_id,
            deck_id: row.deck_id,
            notetype_id: row.notetype_id,
            notetype_kind: row.notetype_kind,
            notetype_css: row.notetype_css,
            fields,
            tags: split_tags(&row.tags_raw),
            lapses: row.lapses,
            card_ids: card_ids_by_note.remove(&row.note_id).unwrap_or_default(),
        });
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::super::model;
    use crate::storage::SqliteStorage;
    use bibalak_core::ports::*;

    #[test]
    fn list_detail_and_update() {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.import(&model(), 1_000).unwrap();

        let all = s.list_notes(None, 100).unwrap();
        assert_eq!(all.len(), 1);
        let note_id = all[0].note_id;
        assert_eq!(all[0].tags, vec!["spanish".to_string()]);

        // Substring search hits the field text.
        assert_eq!(s.list_notes(Some("hello"), 100).unwrap().len(), 1);
        assert_eq!(s.list_notes(Some("nope"), 100).unwrap().len(), 0);

        let detail = s.note_detail(note_id).unwrap().unwrap();
        assert_eq!(detail.notetype_name, "Basic");
        assert_eq!(detail.fields.len(), 2);
        assert_eq!(detail.fields[0].name, "Front");
        assert_eq!(detail.fields[0].value, "<b>hola</b>");

        s.update_note(
            note_id,
            &["<i>adios</i>".into(), "bye".into()],
            &["es".into()],
            999,
        )
        .unwrap();
        let updated = s.note_detail(note_id).unwrap().unwrap();
        assert_eq!(updated.fields[0].value, "<i>adios</i>");
        assert_eq!(updated.tags, vec!["es".to_string()]);
        // Sort field is the plaintext of the first field.
        assert_eq!(s.list_notes(None, 100).unwrap()[0].sort_field, "adios");
    }
}
