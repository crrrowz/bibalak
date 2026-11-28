use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::{
    parse_field_options, parse_notetype_sort_field, FieldSummary, NotetypeDetail, TemplateSummary,
};
use bibalak_core::notetype_preset::{
    detect_stock_preset, is_image_occlusion_config, parse_keepsake_preset,
    set_keepsake_preset_in_config, CompiledNotetype, NotetypePreset,
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

    let preset = parse_keepsake_preset(&config_json)
        .or_else(|| detect_stock_preset(kind, &fields, &templates, &css, &config_json));

    let is_image_occlusion = (kind == 1 && is_image_occlusion_config(&config_json)).then_some(true);

    Ok(Some(NotetypeDetail {
        id,
        name,
        kind,
        is_image_occlusion,
        fields,
        templates,
        css,
        sort_field,
        preset,
    }))
}

/// Persist `keepsakePreset` in `notetypes.config` and, when `compiled` is
/// `Some` (Simple mode), atomically update `kind`, `css`, and `templates`
/// (adding/removing card templates and bumping `schema_mod` only when template
/// count changes).
pub fn save_notetype_preset(
    tx: &Transaction<'_>,
    notetype_id: i64,
    preset: &NotetypePreset,
    compiled: Option<&CompiledNotetype>,
    confirm_remove: bool,
    now_ms: i64,
) -> CoreResult<()> {
    let (existing_kind, config_json): (i64, String) = tx
        .query_row(
            "SELECT kind, config FROM notetypes WHERE id = ?1",
            [notetype_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?
        .ok_or_else(|| CoreError::NotFound(format!("notetype {notetype_id}")))?;

    let mut updated_cfg = set_keepsake_preset_in_config(&config_json, Some(preset))?;

    if let Some(compiled) = compiled {
        if compiled.kind != existing_kind {
            let has_notes: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM notes WHERE notetype_id = ?1 LIMIT 1)",
                    [notetype_id],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if has_notes {
                return Err(CoreError::Invalid(
                    "cannot change note type kind while notes exist".into(),
                ));
            }
        }

        let existing_count: usize = tx
            .query_row(
                "SELECT COUNT(*) FROM templates WHERE notetype_id = ?1",
                [notetype_id],
                |r| r.get::<_, i64>(0),
            )
            .map_err(err)? as usize;
        let target_len = compiled.templates.len();
        if existing_count > target_len && !confirm_remove {
            return Err(CoreError::Invalid(
                "removing card templates deletes existing cards; confirmation required".into(),
            ));
        }

        let mut map = match serde_json::from_str::<serde_json::Value>(&updated_cfg) {
            Ok(serde_json::Value::Object(m)) => m,
            _ => serde_json::Map::new(),
        };
        map.insert(
            "css".to_string(),
            serde_json::Value::String(compiled.css.clone()),
        );
        updated_cfg = serde_json::Value::Object(map).to_string();

        tx.execute(
            r#"UPDATE notetypes SET kind = ?1, config = ?2, "mod" = ?3, usn = -1 WHERE id = ?4"#,
            params![compiled.kind, updated_cfg, now_ms, notetype_id],
        )
        .map_err(err)?;

        for (idx, tmpl) in compiled.templates.iter().enumerate() {
            if idx < existing_count {
                tx.execute(
                    "UPDATE templates SET name = ?1, qfmt = ?2, afmt = ?3 \
                     WHERE notetype_id = ?4 AND ord = ?5",
                    params![tmpl.name, tmpl.qfmt, tmpl.afmt, notetype_id, idx as i64],
                )
                .map_err(err)?;
            } else {
                super::templates::add_template(
                    tx,
                    notetype_id,
                    &tmpl.name,
                    &tmpl.qfmt,
                    &tmpl.afmt,
                    now_ms,
                )?;
            }
        }
        if existing_count > target_len {
            for ord in (target_len..existing_count).rev() {
                super::templates::remove_template(tx, notetype_id, ord as i64, now_ms)?;
            }
        }
    } else {
        tx.execute(
            r#"UPDATE notetypes SET config = ?1, "mod" = ?2, usn = -1 WHERE id = ?3"#,
            params![updated_cfg, now_ms, notetype_id],
        )
        .map_err(err)?;
    }

    Ok(())
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
    let clean = name.trim();
    if clean.is_empty() {
        return Err(CoreError::Invalid("note type name cannot be empty".into()));
    }
    let conflict: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM notetypes WHERE lower(name) = lower(?1) AND id != ?2)",
            params![clean, notetype_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if conflict {
        return Err(CoreError::Invalid(format!(
            "a note type named {clean:?} already exists"
        )));
    }
    let affected = conn
        .execute(
            r#"UPDATE notetypes SET name = ?1, "mod" = ?2, usn = -1 WHERE id = ?3"#,
            params![clean, now_ms, notetype_id],
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
            kind: None,
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

    #[test]
    fn get_detail_detects_stock_preset_without_mutating_templates_or_css() {
        use bibalak_core::notetype_preset::{EditorMode, LayoutId, KEEPSAKE_PRESET_CONFIG_KEY};

        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_000).unwrap();
        let stock_id = s.add_stock_notetype(0, 1_000).unwrap();

        let detail = s.get_notetype_detail(stock_id).unwrap().unwrap();
        let detected = detail.preset.expect("stock Basic should detect as Simple");
        assert_eq!(detected.layout, LayoutId::Basic);
        assert_eq!(detected.mode, EditorMode::Simple);

        // Opening must never write keepsakePreset or rewrite templates/css
        let cfg: String = s
            .lock()
            .query_row(
                "SELECT config FROM notetypes WHERE id = ?1",
                [stock_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!cfg.contains(KEEPSAKE_PRESET_CONFIG_KEY));

        // Customising CSS forces Advanced mode (preset == None)
        s.save_notetype_css(stock_id, ".card { color: red; }", 2_000)
            .unwrap();
        let after_css = s.get_notetype_detail(stock_id).unwrap().unwrap();
        assert!(after_css.preset.is_none());
    }

    #[test]
    fn save_notetype_preset_persists_and_syncs_reverse_cards() {
        use bibalak_core::notetype_preset::{EditorMode, LayoutId, NotetypePreset, StyleAlign};
        use bibalak_core::{Collection, SystemClock};
        use std::sync::Arc;

        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_000).unwrap();
        let nt_id = s.create_notetype("Lang", 0, 1_000).unwrap();
        s.rename_field(nt_id, 0, "Word", 1_100).unwrap();
        s.rename_field(nt_id, 1, "Meaning", 1_100).unwrap();
        s.add_note_with_cards(nt_id, 1, &["كتاب".into(), "book".into()], &[], 1_200)
            .unwrap();

        let col = Collection::new(Box::new(s), Arc::new(SystemClock)).unwrap();
        let mut preset = NotetypePreset::for_layout(LayoutId::LanguageCard);
        assert_eq!(preset.style.align, StyleAlign::Auto);
        let d1 = col
            .save_notetype_preset(nt_id, preset.clone(), false)
            .unwrap();
        assert_eq!(d1.templates.len(), 1);
        assert!(d1.preset.as_ref().unwrap().compiled_digest.is_some());

        // Turn reverse ON -> Card 2 created for existing note
        preset.options.include_reverse = true;
        let d2 = col
            .save_notetype_preset(nt_id, preset.clone(), false)
            .unwrap();
        assert_eq!(d2.templates.len(), 2);
        assert_eq!(col.check_template_remove(nt_id, 1).unwrap(), 1);

        // Turn reverse OFF without confirm_remove -> refused, Card 2 kept
        preset.options.include_reverse = false;
        assert!(col
            .save_notetype_preset(nt_id, preset.clone(), false)
            .is_err());
        assert_eq!(col.check_template_remove(nt_id, 1).unwrap(), 1);

        // Turn reverse OFF with confirm_remove=true -> Card 2 deleted
        let d3 = col
            .save_notetype_preset(nt_id, preset.clone(), true)
            .unwrap();
        assert_eq!(d3.templates.len(), 1);

        // Changing kind (standard -> cloze) when notes exist is refused even with confirm_remove=true
        let mut cloze_preset = NotetypePreset::for_layout(LayoutId::Cloze);
        cloze_preset.slots.insert("text".into(), "Word".into());
        assert!(col
            .save_notetype_preset(nt_id, cloze_preset.clone(), true)
            .is_err());

        // Changing kind succeeds when note type has zero notes
        let empty_nt = col.create_notetype("Empty", 0).unwrap().id;
        let mut empty_cloze = NotetypePreset::for_layout(LayoutId::Cloze);
        empty_cloze.slots.insert("text".into(), "Front".into());
        let after_kind = col
            .save_notetype_preset(empty_nt, empty_cloze, false)
            .unwrap();
        assert_eq!(after_kind.kind, 1);

        // Switch to Advanced -> templates & css preserved
        let prev_qfmt = d3.templates[0].qfmt.clone();
        let prev_css = d3.css.clone();
        preset.mode = EditorMode::Advanced;
        let d4 = col.save_notetype_preset(nt_id, preset, false).unwrap();
        assert_eq!(d4.preset.as_ref().unwrap().mode, EditorMode::Advanced);
        assert_eq!(d4.templates[0].qfmt, prev_qfmt);
        assert_eq!(d4.css, prev_css);
    }

    #[test]
    fn nt_iokind_detects_image_occlusion_by_config_and_kind_1() {
        use bibalak_core::{Collection, SystemClock};
        use std::sync::Arc;

        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_000).unwrap();
        let col = Collection::new(Box::new(s), Arc::new(SystemClock)).unwrap();

        let list = col.list_notetypes().unwrap();
        let stock_io = list.iter().find(|n| n.name == "Image Occlusion").unwrap();
        assert_eq!(stock_io.kind, 1);
        assert_eq!(stock_io.is_image_occlusion, Some(true));

        // Renaming must preserve Image Occlusion detection via config, not name.
        col.rename_notetype(stock_io.id, "Custom Diagram Mask")
            .unwrap();
        let renamed_summary = col
            .list_notetypes()
            .unwrap()
            .into_iter()
            .find(|n| n.id == stock_io.id)
            .unwrap();
        assert_eq!(renamed_summary.is_image_occlusion, Some(true));
        let renamed_detail = col.get_notetype_detail(stock_io.id).unwrap().unwrap();
        assert_eq!(renamed_detail.is_image_occlusion, Some(true));

        // Standard note type named "Image Occlusion" (or kind != 1) must not be flagged.
        let fake_io = col.create_notetype("Image Occlusion Fake", 0).unwrap();
        assert_eq!(fake_io.is_image_occlusion, None);
    }

    #[test]
    fn rename_notetype_rejects_case_insensitive_duplicate_and_empty() {
        let Setup { s, .. } = setup();
        let second = s.create_notetype("Second", 0, 1_000).unwrap();
        assert!(s.rename_notetype(second, "basic", 2_000).is_err());
        assert!(s.rename_notetype(second, "   ", 2_000).is_err());
        // Renaming to its own name (changing case) is permitted.
        s.rename_notetype(second, "second", 2_000).unwrap();
    }
}
