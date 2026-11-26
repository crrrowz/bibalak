use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::{
    parse_notetype_sort_field, set_notetype_sort_field_in_config, FieldRemoveWarning,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use super::templates::{rewrite_template_field, template_uses_field};
use super::{bump_schema_mod, err, FIELD_SEP};

/// Field names appear inside `{{…}}` in templates and are rewritten on
/// rename, so they must not contain template syntax.
fn check_field_name_syntax(name: &str) -> CoreResult<&str> {
    let clean = name.trim();
    if clean.is_empty() {
        return Err(CoreError::Invalid("field name cannot be empty".into()));
    }
    if clean.contains([':', '{', '}', '"']) || clean.starts_with(['#', '^', '/']) {
        return Err(CoreError::Invalid(format!(
            "field name {clean:?} cannot contain : {{ }} \" or start with # ^ /"
        )));
    }
    Ok(clean)
}

/// Lower-cased names of the note type's fields, except `skip_ord`.
fn other_field_names(
    tx: &Transaction<'_>,
    notetype_id: i64,
    skip_ord: Option<i64>,
) -> CoreResult<Vec<String>> {
    let mut stmt = tx
        .prepare("SELECT ord, name FROM fields WHERE notetype_id = ?1")
        .map_err(err)?;
    let rows = stmt
        .query_map([notetype_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(rows
        .into_iter()
        .filter(|(ord, _)| Some(*ord) != skip_ord)
        .map(|(_, name)| name.to_lowercase())
        .collect())
}

pub fn add_field(
    tx: &Transaction<'_>,
    notetype_id: i64,
    name: &str,
    now_ms: i64,
) -> CoreResult<()> {
    // A taken name gets " 2", " 3", … (Anki rejects duplicates, case-insensitive).
    let base = check_field_name_syntax(name)?;
    let taken = other_field_names(tx, notetype_id, None)?;
    let mut name = base.to_string();
    let mut n = 2;
    while taken.contains(&name.to_lowercase()) {
        name = format!("{base} {n}");
        n += 1;
    }
    let next_ord: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(ord) + 1, 0) FROM fields WHERE notetype_id = ?1",
            [notetype_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    tx.execute(
        "INSERT INTO fields (notetype_id, ord, name, config) VALUES (?1, ?2, ?3, '{}')",
        params![notetype_id, next_ord, name],
    )
    .map_err(err)?;

    // Append FIELD_SEP + empty value to every note of this notetype.
    let note_ids: Vec<i64> = {
        let mut stmt = tx
            .prepare("SELECT id FROM notes WHERE notetype_id = ?1")
            .map_err(err)?;
        let ids = stmt
            .query_map([notetype_id], |r| r.get(0))
            .map_err(err)?
            .collect::<rusqlite::Result<_>>()
            .map_err(err)?;
        ids
    };
    for note_id in note_ids {
        tx.execute(
            r#"UPDATE notes SET fields = fields || ?1, fields_norm = fields_norm || ?1, "mod" = ?2, usn = -1 WHERE id = ?3"#,
            params![FIELD_SEP.to_string(), now_ms, note_id],
        )
        .map_err(err)?;
    }

    bump_schema_mod(tx, now_ms)?;
    Ok(())
}

pub fn check_field_remove(
    conn: &Connection,
    notetype_id: i64,
    ord: i64,
) -> CoreResult<FieldRemoveWarning> {
    let field_name: String = conn
        .query_row(
            "SELECT name FROM fields WHERE notetype_id = ?1 AND ord = ?2",
            params![notetype_id, ord],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .unwrap_or_default();

    let mut stmt = conn
        .prepare("SELECT fields FROM notes WHERE notetype_id = ?1")
        .map_err(err)?;
    let blobs: Vec<String> = stmt
        .query_map([notetype_id], |r| r.get(0))
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;

    let ord_idx = ord as usize;
    let count = blobs
        .iter()
        .filter(|blob| {
            let parts: Vec<&str> = blob.split(FIELD_SEP).collect();
            parts
                .get(ord_idx)
                .map(|v| !v.trim().is_empty())
                .unwrap_or(false)
        })
        .count();

    let mut tmpl_stmt = conn
        .prepare("SELECT name, qfmt, afmt FROM templates WHERE notetype_id = ?1")
        .map_err(err)?;
    let using_templates: Vec<String> = tmpl_stmt
        .query_map([notetype_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(err)?
        .filter_map(|r| r.ok())
        .filter(|(_, qfmt, afmt)| {
            template_uses_field(qfmt, &field_name) || template_uses_field(afmt, &field_name)
        })
        .map(|(name, _, _)| name)
        .collect();

    Ok(FieldRemoveWarning {
        notes_with_content: count as u32,
        using_templates,
    })
}

pub fn remove_field(
    tx: &Transaction<'_>,
    notetype_id: i64,
    ord: i64,
    now_ms: i64,
) -> CoreResult<()> {
    let field_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM fields WHERE notetype_id = ?1",
            [notetype_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if field_count <= 1 {
        return Err(CoreError::Invalid("cannot remove the last field".into()));
    }

    tx.execute(
        "DELETE FROM fields WHERE notetype_id = ?1 AND ord = ?2",
        params![notetype_id, ord],
    )
    .map_err(err)?;
    tx.execute(
        "UPDATE fields SET ord = ord - 1 WHERE notetype_id = ?1 AND ord > ?2",
        params![notetype_id, ord],
    )
    .map_err(err)?;

    let nt_config: String = tx
        .query_row(
            "SELECT config FROM notetypes WHERE id = ?1",
            [notetype_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .ok_or_else(|| CoreError::NotFound(format!("notetype {notetype_id}")))?;
    let old_sortf = parse_notetype_sort_field(&nt_config);
    let new_sortf = if ord < old_sortf {
        old_sortf - 1
    } else if ord == old_sortf || old_sortf >= field_count - 1 {
        0
    } else {
        old_sortf
    };
    if new_sortf != old_sortf {
        let updated_cfg = set_notetype_sort_field_in_config(&nt_config, new_sortf);
        tx.execute(
            r#"UPDATE notetypes SET config = ?1, "mod" = ?2, usn = -1 WHERE id = ?3"#,
            params![updated_cfg, now_ms, notetype_id],
        )
        .map_err(err)?;
    }

    // Splice value at position `ord` out of every note's field blob.
    let note_rows: Vec<(i64, String)> = {
        let mut stmt = tx
            .prepare("SELECT id, fields FROM notes WHERE notetype_id = ?1")
            .map_err(err)?;
        let rows = stmt
            .query_map([notetype_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?
            .collect::<rusqlite::Result<_>>()
            .map_err(err)?;
        rows
    };
    let ord_idx = ord as usize;
    let sep = FIELD_SEP.to_string();
    for (note_id, blob) in note_rows {
        let mut parts: Vec<String> = blob.split(FIELD_SEP).map(str::to_string).collect();
        if ord_idx < parts.len() {
            parts.remove(ord_idx);
        }
        let new_blob = parts.join(&sep);
        let (sort_field, checksum) =
            crate::browse::compute_sort_and_checksum(&parts, new_sortf as usize);
        let fields_norm = crate::search::fields_norm_value(&new_blob, Some(&sort_field));
        if ord == 0 {
            tx.execute(
                r#"UPDATE notes SET fields = ?1, sort_field = ?2, checksum = ?3, fields_norm = ?4, "mod" = ?5, usn = -1 WHERE id = ?6"#,
                params![new_blob, sort_field, checksum, fields_norm, now_ms, note_id],
            )
            .map_err(err)?;
        } else {
            tx.execute(
                r#"UPDATE notes SET fields = ?1, sort_field = ?2, fields_norm = ?3, "mod" = ?4, usn = -1 WHERE id = ?5"#,
                params![new_blob, sort_field, fields_norm, now_ms, note_id],
            )
            .map_err(err)?;
        }
    }

    bump_schema_mod(tx, now_ms)?;
    Ok(())
}

pub fn rename_field(
    tx: &Transaction<'_>,
    notetype_id: i64,
    ord: i64,
    name: &str,
    now_ms: i64,
) -> CoreResult<()> {
    let clean_name = check_field_name_syntax(name)?;
    if other_field_names(tx, notetype_id, Some(ord))?.contains(&clean_name.to_lowercase()) {
        return Err(CoreError::Invalid(format!(
            "a field named {clean_name:?} already exists"
        )));
    }
    let old_name: String = tx
        .query_row(
            "SELECT name FROM fields WHERE notetype_id = ?1 AND ord = ?2",
            params![notetype_id, ord],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .ok_or_else(|| CoreError::NotFound(format!("field {ord} in notetype {notetype_id}")))?;

    let affected = tx
        .execute(
            "UPDATE fields SET name = ?1 WHERE notetype_id = ?2 AND ord = ?3",
            params![clean_name, notetype_id, ord],
        )
        .map_err(err)?;
    if affected == 0 {
        return Err(CoreError::NotFound(format!(
            "field {ord} in notetype {notetype_id}"
        )));
    }

    // Rewrite all templates of this notetype in the same transaction
    let mut tmpl_stmt = tx
        .prepare("SELECT ord, qfmt, afmt FROM templates WHERE notetype_id = ?1")
        .map_err(err)?;
    let templates: Vec<(i64, String, String)> = tmpl_stmt
        .query_map([notetype_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;

    for (t_ord, qfmt, afmt) in templates {
        let new_qfmt = rewrite_template_field(&qfmt, &old_name, clean_name);
        let new_afmt = rewrite_template_field(&afmt, &old_name, clean_name);
        if new_qfmt != qfmt || new_afmt != afmt {
            tx.execute(
                "UPDATE templates SET qfmt = ?1, afmt = ?2 WHERE notetype_id = ?3 AND ord = ?4",
                params![new_qfmt, new_afmt, notetype_id, t_ord],
            )
            .map_err(err)?;
        }
    }

    tx.execute(
        r#"UPDATE notetypes SET "mod" = ?1, usn = -1 WHERE id = ?2"#,
        params![now_ms, notetype_id],
    )
    .map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::{setup, Setup};
    use bibalak_core::ports::*;

    #[test]
    fn add_field_appends_to_notes() {
        let Setup { s, nt_id, note_id } = setup();
        s.add_field(nt_id, "Extra", 1_000).unwrap();
        let detail = s.get_notetype_detail(nt_id).unwrap().unwrap();
        assert_eq!(detail.fields.len(), 3);
        assert_eq!(detail.fields[2].name, "Extra");

        let note = s.note_detail(note_id).unwrap().unwrap();
        assert_eq!(note.fields.len(), 3);
        assert_eq!(note.fields[2].value, "");
    }

    #[test]
    fn check_field_remove_counts_non_empty() {
        let Setup { s, nt_id, .. } = setup();
        let warn = s.check_field_remove(nt_id, 0).unwrap();
        assert_eq!(warn.notes_with_content, 1); // "hello" in Front

        let warn2 = s.check_field_remove(nt_id, 1).unwrap();
        assert_eq!(warn2.notes_with_content, 1); // "world" in Back
    }

    #[test]
    fn remove_field_splices_note_blob() {
        let Setup { s, nt_id, note_id } = setup();
        s.remove_field(nt_id, 0, 1_000).unwrap(); // remove Front
        let detail = s.get_notetype_detail(nt_id).unwrap().unwrap();
        assert_eq!(detail.fields.len(), 1);
        assert_eq!(detail.fields[0].name, "Back");
        assert_eq!(detail.fields[0].ord, 0); // shifted

        let note = s.note_detail(note_id).unwrap().unwrap();
        assert_eq!(note.fields.len(), 1);
        assert_eq!(note.fields[0].value, "world");
    }

    #[test]
    fn remove_last_field_is_rejected() {
        let Setup { s, nt_id, .. } = setup();
        s.remove_field(nt_id, 0, 1_000).unwrap(); // now 1 field
        assert!(s.remove_field(nt_id, 0, 2_000).is_err());
    }

    /// Renaming rewrites templates, so a name must be unique within the note
    /// type (case-insensitive, like Anki) and free of template syntax.
    #[test]
    fn rename_field_rejects_duplicate_and_template_syntax() {
        let Setup { s, nt_id, .. } = setup();
        // Fields are "Front" (0) and "Back" (1).
        assert!(s.rename_field(nt_id, 1, "Front", 1_000).is_err());
        assert!(s.rename_field(nt_id, 1, "front", 1_000).is_err());
        for bad in ["A:B", "A{B", "A}B", "A\"B", "#A", "^A", "/A", "   "] {
            assert!(
                s.rename_field(nt_id, 1, bad, 1_000).is_err(),
                "{bad:?} must be rejected"
            );
        }
        let detail = s.get_notetype_detail(nt_id).unwrap().unwrap();
        assert_eq!(
            detail.fields[1].name, "Back",
            "a rejected rename changes nothing"
        );
        assert!(detail.templates[0].afmt.contains("{{Back}}"));
        // Renaming a field to its own name with different case is allowed.
        s.rename_field(nt_id, 1, "BACK", 1_000).unwrap();
    }

    /// Adding a field twice with the default name yields unique names.
    #[test]
    fn add_field_makes_names_unique() {
        let Setup { s, nt_id, .. } = setup();
        s.add_field(nt_id, "New Field", 1_000).unwrap();
        s.add_field(nt_id, "New Field", 1_000).unwrap();
        s.add_field(nt_id, "front", 1_000).unwrap();
        let names: Vec<String> = s
            .get_notetype_detail(nt_id)
            .unwrap()
            .unwrap()
            .fields
            .into_iter()
            .map(|f| f.name)
            .collect();
        assert_eq!(
            names,
            ["Front", "Back", "New Field", "New Field 2", "front 2"]
        );
        assert!(s.add_field(nt_id, "A:B", 1_000).is_err());
    }

    #[test]
    fn rename_field_updates_name_and_all_template_syntax() {
        let Setup { s, nt_id, .. } = setup();
        // Add template with various syntax: {{#Front}}, {{^Front}}, {{/Front}}, {{text:Front}}
        s.add_template(
            nt_id,
            "Card 2",
            "{{#Front}}{{text:Front}}{{/Front}}",
            "{{FrontSide}}\n\n{{^Front}}No front{{/Front}}",
            1_000,
        )
        .unwrap();

        let warn = s.check_field_remove(nt_id, 0).unwrap();
        assert_eq!(warn.using_templates, vec!["Card 1", "Card 2"]);

        s.rename_field(nt_id, 0, "Question", 1_000).unwrap();
        let detail = s.get_notetype_detail(nt_id).unwrap().unwrap();
        assert_eq!(detail.fields[0].name, "Question");
        assert_eq!(detail.templates[0].qfmt, "{{Question}}");
        assert_eq!(
            detail.templates[1].qfmt,
            "{{#Question}}{{text:Question}}{{/Question}}"
        );
        assert_eq!(
            detail.templates[1].afmt,
            "{{FrontSide}}\n\n{{^Question}}No front{{/Question}}"
        );
    }
}
