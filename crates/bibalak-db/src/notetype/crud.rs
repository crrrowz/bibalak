use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::{
    parse_field_options, parse_notetype_sort_field, FieldSummary, NotetypeDetail, TemplateSummary,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use super::{bump_schema_mod, err};

pub fn get_notetype_detail(
    conn: &Connection,
    notetype_id: i64,
) -> CoreResult<Option<NotetypeDetail>> {
    let row = conn
        .query_row(
            "SELECT id, name, kind, coalesce(json_extract(config, '$.css'), ''), config FROM notetypes WHERE id = ?1",
            [notetype_id],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            },
        )
        .optional()
        .map_err(err)?;
    let Some((id, name, kind, css, config_json)) = row else {
        return Ok(None);
    };

    let mut stmt = conn
        .prepare("SELECT ord, name, config FROM fields WHERE notetype_id = ?1 ORDER BY ord")
        .map_err(err)?;
    let fields: Vec<FieldSummary> = stmt
        .query_map([id], |r| {
            let f_cfg: String = r.get(2)?;
            Ok(FieldSummary {
                ord: r.get(0)?,
                name: r.get(1)?,
                options: parse_field_options(&f_cfg),
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;

    let mut sort_field = parse_notetype_sort_field(&config_json);
    if fields.is_empty() || sort_field as usize >= fields.len() {
        sort_field = 0;
    }

    let mut stmt = conn
        .prepare(
            "SELECT ord, name, qfmt, afmt FROM templates \
             WHERE notetype_id = ?1 ORDER BY ord",
        )
        .map_err(err)?;
    let templates: Vec<TemplateSummary> = stmt
        .query_map([id], |r| {
            Ok(TemplateSummary {
                ord: r.get(0)?,
                name: r.get(1)?,
                qfmt: r.get(2)?,
                afmt: r.get(3)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;

    Ok(Some(NotetypeDetail {
        id,
        name,
        kind,
        fields,
        templates,
        css,
        sort_field,
    }))
}

/// Save a notetype's custom card CSS, preserving other keys in `config`.
pub fn save_notetype_css(
    conn: &Connection,
    notetype_id: i64,
    css: &str,
    now_ms: i64,
) -> CoreResult<()> {
    conn.execute(
        r#"UPDATE notetypes
           SET config = json_set(config, '$.css', ?2), "mod" = ?3, usn = -1
           WHERE id = ?1"#,
        params![notetype_id, css, now_ms],
    )
    .map_err(err)?;
    Ok(())
}

pub fn create_notetype(
    tx: &Transaction<'_>,
    name: &str,
    kind: i64,
    now_ms: i64,
) -> CoreResult<i64> {
    let css_escaped = serde_json::to_string(crate::stock::DEFAULT_CARD_CSS).map_err(err)?;
    let config = format!("{{\"css\":{css_escaped}}}");
    tx.execute(
        r#"INSERT INTO notetypes (name, kind, "mod", usn, config) VALUES (?1, ?2, ?3, -1, ?4)"#,
        params![name, kind, now_ms, config],
    )
    .map_err(err)?;
    let id = tx.last_insert_rowid();

    if kind == 0 {
        // Standard: two fields + one Card 1 template
        tx.execute(
            "INSERT INTO fields (notetype_id, ord, name, config) VALUES (?1, 0, 'Front', '{}')",
            [id],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO fields (notetype_id, ord, name, config) VALUES (?1, 1, 'Back', '{}')",
            [id],
        )
        .map_err(err)?;
        tx.execute(
            r#"INSERT INTO templates (notetype_id, ord, name, qfmt, afmt, config)
               VALUES (?1, 0, 'Card 1', '{{Front}}',
                       '{{FrontSide}}<hr id=answer>{{Back}}', '{}')"#,
            [id],
        )
        .map_err(err)?;
    } else {
        // Cloze: Text + Extra fields, one Cloze template
        tx.execute(
            "INSERT INTO fields (notetype_id, ord, name, config) VALUES (?1, 0, 'Text', '{}')",
            [id],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO fields (notetype_id, ord, name, config) VALUES (?1, 1, 'Extra', '{}')",
            [id],
        )
        .map_err(err)?;
        tx.execute(
            r#"INSERT INTO templates (notetype_id, ord, name, qfmt, afmt, config)
               VALUES (?1, 0, 'Cloze', '{{cloze:Text}}',
                       '{{cloze:Text}}<br>{{Extra}}', '{}')"#,
            [id],
        )
        .map_err(err)?;
    }

    Ok(id)
}

pub fn delete_notetype(tx: &Transaction<'_>, notetype_id: i64, now_ms: i64) -> CoreResult<()> {
    let note_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM notes WHERE notetype_id = ?1",
            [notetype_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if note_count > 0 {
        return Err(CoreError::Invalid(format!(
            "cannot delete note type: {note_count} note{} reference it",
            if note_count == 1 { "" } else { "s" }
        )));
    }
    let affected = tx
        .execute("DELETE FROM notetypes WHERE id = ?1", [notetype_id])
        .map_err(err)?;
    if affected == 0 {
        return Err(CoreError::NotFound(format!("notetype {notetype_id}")));
    }
    bump_schema_mod(tx, now_ms)?;
    Ok(())
}

pub fn rename_notetype(
    conn: &Connection,
    notetype_id: i64,
    name: &str,
    now_ms: i64,
) -> CoreResult<()> {
    let affected = conn
        .execute(
            r#"UPDATE notetypes SET name = ?1, "mod" = ?2, usn = -1 WHERE id = ?3"#,
            params![name, now_ms, notetype_id],
        )
        .map_err(err)?;
    if affected == 0 {
        return Err(CoreError::NotFound(format!("notetype {notetype_id}")));
    }
    Ok(())
}

/// Clone a note type (fields with configs, templates with configs, CSS, sort field)
/// under `new_name` with zero notes.
pub fn duplicate_notetype(
    tx: &Transaction<'_>,
    notetype_id: i64,
    new_name: &str,
    now_ms: i64,
) -> CoreResult<i64> {
    let clean = new_name.trim();
    if clean.is_empty() {
        return Err(CoreError::Invalid("note type name cannot be empty".into()));
    }
    let orig: Option<(i64, String)> = tx
        .query_row(
            "SELECT kind, config FROM notetypes WHERE id = ?1",
            [notetype_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    let Some((kind, config)) = orig else {
        return Err(CoreError::NotFound(format!("notetype {notetype_id}")));
    };
    let conflict: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM notetypes WHERE lower(name) = lower(?1))",
            [clean],
            |r| r.get(0),
        )
        .map_err(err)?;
    if conflict {
        return Err(CoreError::Invalid(format!(
            "a note type named {clean:?} already exists"
        )));
    }

    tx.execute(
        r#"INSERT INTO notetypes (name, kind, "mod", usn, config) VALUES (?1, ?2, ?3, -1, ?4)"#,
        params![clean, kind, now_ms, config],
    )
    .map_err(err)?;
    let new_id = tx.last_insert_rowid();

    tx.execute(
        "INSERT INTO fields (notetype_id, ord, name, config)
         SELECT ?1, ord, name, config FROM fields WHERE notetype_id = ?2 ORDER BY ord",
        params![new_id, notetype_id],
    )
    .map_err(err)?;

    tx.execute(
        "INSERT INTO templates (notetype_id, ord, name, qfmt, afmt, config)
         SELECT ?1, ord, name, qfmt, afmt, config FROM templates WHERE notetype_id = ?2 ORDER BY ord",
        params![new_id, notetype_id],
    )
    .map_err(err)?;

    Ok(new_id)
}

pub fn note_count_for_notetype(conn: &Connection, notetype_id: i64) -> CoreResult<u32> {
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM notes WHERE notetype_id = ?1",
            [notetype_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok(count as u32)
}

#[cfg(test)]
mod tests {
    use super::super::{setup, Setup};
    use crate::storage::SqliteStorage;
    use bibalak_core::ports::*;

    #[test]
    fn get_detail_returns_fields_and_templates() {
        let Setup { s, nt_id, .. } = setup();
        let detail = s.get_notetype_detail(nt_id).unwrap().unwrap();
        assert_eq!(detail.name, "Basic");
        assert_eq!(detail.kind, 0);
        assert_eq!(detail.fields.len(), 2);
        assert_eq!(detail.fields[0].name, "Front");
        assert_eq!(detail.fields[1].name, "Back");
        assert_eq!(detail.templates.len(), 1);
        assert_eq!(detail.templates[0].name, "Card 1");
    }

    #[test]
    fn create_standard_notetype_seeds_fields_and_template() {
        let Setup { s, .. } = setup();
        let id = s.create_notetype("New Basic", 0, 1_000).unwrap();
        let detail = s.get_notetype_detail(id).unwrap().unwrap();
        assert_eq!(detail.name, "New Basic");
        assert_eq!(detail.fields.len(), 2);
        assert_eq!(detail.templates.len(), 1);
    }

    #[test]
    fn create_cloze_notetype_seeds_text_and_extra() {
        let Setup { s, .. } = setup();
        let id = s.create_notetype("New Cloze", 1, 1_000).unwrap();
        let detail = s.get_notetype_detail(id).unwrap().unwrap();
        assert_eq!(detail.kind, 1);
        assert_eq!(detail.fields[0].name, "Text");
        assert_eq!(detail.fields[1].name, "Extra");
    }

    #[test]
    fn delete_notetype_rejects_when_notes_exist() {
        let Setup { s, nt_id, .. } = setup();
        assert!(s.delete_notetype(nt_id, 1_000).is_err());
    }

    #[test]
    fn delete_empty_notetype_succeeds() {
        let Setup { s, .. } = setup();
        let id = s.create_notetype("Empty", 0, 1_000).unwrap();
        s.delete_notetype(id, 2_000).unwrap();
        assert!(s.get_notetype_detail(id).unwrap().is_none());
    }

    #[test]
    fn rename_notetype() {
        let Setup { s, nt_id, .. } = setup();
        s.rename_notetype(nt_id, "Renamed", 1_000).unwrap();
        let detail = s.get_notetype_detail(nt_id).unwrap().unwrap();
        assert_eq!(detail.name, "Renamed");
    }

    #[test]
    fn duplicate_notetype_copies_options_templates_css_with_zero_notes_and_stays_independent() {
        use bibalak_core::ipc::{FieldDirection, FieldOptions};
        use bibalak_core::{Collection, SystemClock};
        use std::sync::Arc;

        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_000).unwrap();
        let orig_id = s.create_notetype("Arabic", 0, 1_000).unwrap();
        s.save_notetype_css(orig_id, ".card { color: teal; }", 1_100)
            .unwrap();
        let opts = FieldOptions {
            direction: FieldDirection::Rtl,
            font: "Amiri".into(),
            size: 22,
            description: "Word".into(),
        };
        s.save_field_options(orig_id, 0, &opts, 1_200).unwrap();
        s.set_sort_field(orig_id, 1, 1_300).unwrap();
        s.add_note_with_cards(orig_id, 1, &["Q".into(), "A".into()], &[], 1_400)
            .unwrap();

        let col = Collection::new(Box::new(s), Arc::new(SystemClock)).unwrap();
        let copy1 = col.duplicate_notetype(orig_id, "Arabic copy").unwrap();
        assert_ne!(copy1.id, orig_id);
        assert_eq!(copy1.name, "Arabic copy");
        assert_eq!(copy1.css, ".card { color: teal; }");
        assert_eq!(copy1.sort_field, 1);
        assert_eq!(copy1.fields.len(), 2);
        assert_eq!(copy1.fields[0].options, opts);
        assert_eq!(copy1.templates.len(), 1);

        // Zero notes copied; second duplicate gets unique name ("Arabic copy 2").
        let copy1_summary = col
            .list_notetypes()
            .unwrap()
            .into_iter()
            .find(|n| n.id == copy1.id)
            .unwrap();
        assert_eq!(copy1_summary.note_count, 0);

        let copy2 = col.duplicate_notetype(orig_id, "Arabic copy").unwrap();
        assert_eq!(copy2.name, "Arabic copy 2");

        // Mutating the clone leaves the original unchanged.
        col.save_notetype_css(copy1.id, ".card { color: red; }")
            .unwrap();
        col.rename_field(copy1.id, 0, "ClonedFront").unwrap();
        let orig_after = col.get_notetype_detail(orig_id).unwrap().unwrap();
        assert_eq!(orig_after.css, ".card { color: teal; }");
        assert_eq!(orig_after.fields[0].name, "Front");
    }
}
