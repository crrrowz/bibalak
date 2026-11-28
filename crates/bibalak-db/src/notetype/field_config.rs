use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::{
    apply_field_options_to_config, parse_notetype_sort_field, set_notetype_sort_field_in_config,
    FieldOptions,
};
use rusqlite::{params, OptionalExtension, Transaction};

use super::{bump_schema_mod, err, FIELD_SEP};

pub fn reorder_fields(
    tx: &Transaction<'_>,
    notetype_id: i64,
    new_order: &[i64],
    now_ms: i64,
) -> CoreResult<()> {
    // Fetch all fields ordered by their current ord (which is 0..n-1 by invariant).
    let old_fields: Vec<(String, String)> = {
        let mut stmt = tx
            .prepare(
                "SELECT name, config FROM fields \
                 WHERE notetype_id = ?1 ORDER BY ord",
            )
            .map_err(err)?;
        let fields = stmt
            .query_map([notetype_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?
            .collect::<rusqlite::Result<_>>()
            .map_err(err)?;
        fields
    };

    if new_order.len() != old_fields.len() {
        return Err(CoreError::Invalid(format!(
            "reorder_fields: expected {} elements, got {}",
            old_fields.len(),
            new_order.len()
        )));
    }

    let mut seen = vec![false; old_fields.len()];
    for &old_ord in new_order {
        let Some(slot) = usize::try_from(old_ord)
            .ok()
            .and_then(|idx| seen.get_mut(idx))
        else {
            return Err(CoreError::Invalid(format!(
                "reorder_fields: field ordinal {old_ord} out of range (0..{})",
                old_fields.len()
            )));
        };
        if *slot {
            return Err(CoreError::Invalid(format!(
                "reorder_fields: duplicate field ordinal {old_ord}"
            )));
        }
        *slot = true;
    }

    // Rebuild the fields table in the new order.
    tx.execute("DELETE FROM fields WHERE notetype_id = ?1", [notetype_id])
        .map_err(err)?;
    for (new_ord, &old_ord) in new_order.iter().enumerate() {
        let (ref name, ref config) = old_fields[old_ord as usize];
        tx.execute(
            "INSERT INTO fields (notetype_id, ord, name, config) VALUES (?1, ?2, ?3, ?4)",
            params![notetype_id, new_ord as i64, name, config],
        )
        .map_err(err)?;
    }

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
    let new_sortf = new_order
        .iter()
        .position(|&o| o == old_sortf)
        .map(|i| i as i64)
        .unwrap_or(0);
    if new_sortf != old_sortf {
        let updated_cfg = set_notetype_sort_field_in_config(&nt_config, new_sortf);
        tx.execute(
            r#"UPDATE notetypes SET config = ?1, "mod" = ?2, usn = -1 WHERE id = ?3"#,
            params![updated_cfg, now_ms, notetype_id],
        )
        .map_err(err)?;
    }

    // Permute each note's field values in the same order.
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
    let sep = FIELD_SEP.to_string();
    let first_changed = new_order.first().copied().unwrap_or(0) != 0;
    for (note_id, blob) in note_rows {
        let parts: Vec<&str> = blob.split(FIELD_SEP).collect();
        let new_parts: Vec<String> = new_order
            .iter()
            .map(|&old_ord| {
                parts
                    .get(old_ord as usize)
                    .copied()
                    .unwrap_or("")
                    .to_string()
            })
            .collect();
        let new_blob = new_parts.join(&sep);
        let (sort_field, checksum) =
            crate::browse::compute_sort_and_checksum(&new_parts, new_sortf as usize);
        let fields_norm = crate::search::fields_norm_value(&new_blob, Some(&sort_field));
        if first_changed {
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

/// Update Anki-compatible options (`"rtl"`, `"font"`, `"size"`, `"description"`) on a field.
pub fn save_field_options(
    tx: &Transaction<'_>,
    notetype_id: i64,
    ord: i64,
    options: &FieldOptions,
    now_ms: i64,
) -> CoreResult<()> {
    let existing_cfg: Option<String> = tx
        .query_row(
            "SELECT config FROM fields WHERE notetype_id = ?1 AND ord = ?2",
            params![notetype_id, ord],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let Some(existing_cfg) = existing_cfg else {
        return Err(CoreError::NotFound(format!(
            "field {ord} in notetype {notetype_id}"
        )));
    };
    let new_cfg = apply_field_options_to_config(&existing_cfg, options);
    tx.execute(
        "UPDATE fields SET config = ?1 WHERE notetype_id = ?2 AND ord = ?3",
        params![new_cfg, notetype_id, ord],
    )
    .map_err(err)?;
    tx.execute(
        r#"UPDATE notetypes SET "mod" = ?1, usn = -1 WHERE id = ?2"#,
        params![now_ms, notetype_id],
    )
    .map_err(err)?;
    Ok(())
}

/// Change the note type's sort field (`notetypes.config.$.sortf`) and recompute
/// `notes.sort_field` + `notes.fields_norm` for all existing notes of this note type
/// in the same transaction. Duplicate `checksum` stays on the FIRST field (ord 0).
pub fn set_sort_field(
    tx: &Transaction<'_>,
    notetype_id: i64,
    ord: i64,
    now_ms: i64,
) -> CoreResult<()> {
    let config: Option<String> = tx
        .query_row(
            "SELECT config FROM notetypes WHERE id = ?1",
            [notetype_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let Some(config) = config else {
        return Err(CoreError::NotFound(format!("notetype {notetype_id}")));
    };
    let field_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM fields WHERE notetype_id = ?1",
            [notetype_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if ord < 0 || ord >= field_count {
        return Err(CoreError::Invalid(format!(
            "sort field ordinal {ord} out of range (0..{field_count})"
        )));
    }

    let updated_cfg = set_notetype_sort_field_in_config(&config, ord);
    tx.execute(
        r#"UPDATE notetypes SET config = ?1, "mod" = ?2, usn = -1 WHERE id = ?3"#,
        params![updated_cfg, now_ms, notetype_id],
    )
    .map_err(err)?;

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

    let sort_idx = ord as usize;
    for (note_id, blob) in note_rows {
        let raw = blob.split(FIELD_SEP).nth(sort_idx).unwrap_or_default();
        let sort_field = crate::browse::clean_sort_value(raw);
        let fields_norm = crate::search::fields_norm_value(&blob, Some(&sort_field));
        // Note: checksum MUST remain on field 0 (Anki's duplicate check rule).
        tx.execute(
            r#"UPDATE notes SET sort_field = ?1, fields_norm = ?2, "mod" = ?3, usn = -1 WHERE id = ?4"#,
            params![sort_field, fields_norm, now_ms, note_id],
        )
        .map_err(err)?;
    }

    bump_schema_mod(tx, now_ms)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::{setup, Setup};
    use crate::storage::SqliteStorage;
    use bibalak_core::ports::*;

    #[test]
    fn reorder_fields_permutes_note_blob() {
        let Setup { s, nt_id, note_id } = setup();
        // Swap Front (ord=0) and Back (ord=1): new_order = [1, 0]
        s.reorder_fields(nt_id, &[1, 0], 1_000).unwrap();
        let detail = s.get_notetype_detail(nt_id).unwrap().unwrap();
        assert_eq!(detail.fields[0].name, "Back");
        assert_eq!(detail.fields[1].name, "Front");

        let note = s.note_detail(note_id).unwrap().unwrap();
        assert_eq!(note.fields[0].value, "world"); // was Back
        assert_eq!(note.fields[1].value, "hello"); // was Front
    }

    /// The sort field follows its field when fields move or are removed, and
    /// falls back to the first field when the sort field itself is removed.
    #[test]
    fn sort_field_follows_reorder_and_remove() {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_000).unwrap();
        let nt_id = s.create_notetype("Vocab", 0, 1_000).unwrap();
        s.add_field(nt_id, "Extra", 1_000).unwrap(); // Front, Back, Extra
        let (note, _) = s
            .add_note_with_cards(nt_id, 1, &["f".into(), "b".into(), "x".into()], &[], 2_000)
            .unwrap();
        let sort_value = |s: &SqliteStorage| -> String {
            s.lock()
                .query_row("SELECT sort_field FROM notes WHERE id = ?1", [note], |r| {
                    r.get(0)
                })
                .unwrap()
        };
        let sortf = |s: &SqliteStorage| s.get_notetype_detail(nt_id).unwrap().unwrap().sort_field;

        s.set_sort_field(nt_id, 2, 3_000).unwrap(); // Extra
        assert_eq!((sortf(&s), sort_value(&s)), (2, "x".to_string()));

        s.reorder_fields(nt_id, &[2, 0, 1], 4_000).unwrap(); // Extra, Front, Back
        let names: Vec<String> = s
            .get_notetype_detail(nt_id)
            .unwrap()
            .unwrap()
            .fields
            .into_iter()
            .map(|f| f.name)
            .collect();
        let extra_pos = names.iter().position(|n| n == "Extra").unwrap() as i64;
        assert_eq!(sortf(&s), extra_pos, "sort field moves with its field");
        assert_eq!(sort_value(&s), "x");

        let front_pos = names.iter().position(|n| n == "Front").unwrap() as i64;
        s.remove_field(nt_id, front_pos, 5_000).unwrap();
        let names: Vec<String> = s
            .get_notetype_detail(nt_id)
            .unwrap()
            .unwrap()
            .fields
            .into_iter()
            .map(|f| f.name)
            .collect();
        let extra_pos = names.iter().position(|n| n == "Extra").unwrap() as i64;
        assert_eq!(sortf(&s), extra_pos, "removing another field keeps it");
        assert_eq!(sort_value(&s), "x");

        s.remove_field(nt_id, extra_pos, 6_000).unwrap();
        assert_eq!(
            sortf(&s),
            0,
            "removing the sort field falls back to the first"
        );
        assert_eq!(sort_value(&s), "b");
    }

    #[test]
    fn field_options_and_sort_field_update_existing_notes_and_keep_checksum_on_first_field() {
        use bibalak_core::ipc::{FieldDirection, FieldOptions};

        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_000).unwrap();
        let nt_id = s.create_notetype("Vocab", 0, 1_000).unwrap();

        let opts = FieldOptions {
            direction: FieldDirection::Rtl,
            font: "Amiri".into(),
            size: 24,
            description: "Arabic word".into(),
            kind: None,
        };
        s.save_field_options(nt_id, 0, &opts, 2_000).unwrap();
        let detail = s.get_notetype_detail(nt_id).unwrap().unwrap();
        assert_eq!(detail.fields[0].options, opts);

        // Add two notes: Back ("zeta" vs "aardvark") should determine order once sort_field = 1.
        let (n1, _) = s
            .add_note_with_cards(nt_id, 1, &["alpha".into(), "zeta".into()], &[], 3_000)
            .unwrap();
        let (n2, _) = s
            .add_note_with_cards(nt_id, 1, &["beta".into(), "aardvark".into()], &[], 4_000)
            .unwrap();

        let expected_csum1 = crate::browse::field_checksum("alpha");
        let expected_csum2 = crate::browse::field_checksum("beta");

        s.set_sort_field(nt_id, 1, 5_000).unwrap();
        let detail = s.get_notetype_detail(nt_id).unwrap().unwrap();
        assert_eq!(detail.sort_field, 1);

        let (sf1, cs1): (String, i64) = s
            .lock()
            .query_row(
                "SELECT sort_field, checksum FROM notes WHERE id = ?1",
                [n1],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        let (sf2, cs2): (String, i64) = s
            .lock()
            .query_row(
                "SELECT sort_field, checksum FROM notes WHERE id = ?1",
                [n2],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(sf1, "zeta");
        assert_eq!(sf2, "aardvark");
        assert_eq!(cs1, expected_csum1, "checksum must stay on field 0");
        assert_eq!(cs2, expected_csum2, "checksum must stay on field 0");

        // Adding a new note while sort_field = 1 uses field 1 for sort_field, field 0 for checksum.
        let (n3, _) = s
            .add_note_with_cards(nt_id, 1, &["gamma".into(), "middle".into()], &[], 6_000)
            .unwrap();
        let (sf3, cs3): (String, i64) = s
            .lock()
            .query_row(
                "SELECT sort_field, checksum FROM notes WHERE id = ?1",
                [n3],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(sf3, "middle");
        assert_eq!(cs3, crate::browse::field_checksum("gamma"));

        // Sorting Browse cards by sort_field ascending puts aardvark, middle, zeta.
        let sorted = s
            .search_cards("", 0, 6_000, 50, 0, Some("sort_field"), true)
            .unwrap();
        let sort_values: Vec<&str> = sorted.iter().map(|c| c.sort_field.as_str()).collect();
        assert_eq!(sort_values, vec!["aardvark", "middle", "zeta"]);

        // Updating note respects sort_field = 1 while keeping duplicate detection on field 0.
        s.update_note(n1, &["alpha2".into(), "bravo".into()], &[], 7_000)
            .unwrap();
        let (sf1_after, cs1_after): (String, i64) = s
            .lock()
            .query_row(
                "SELECT sort_field, checksum FROM notes WHERE id = ?1",
                [n1],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(sf1_after, "bravo");
        assert_eq!(cs1_after, crate::browse::field_checksum("alpha2"));
        assert_eq!(s.find_duplicate_note(nt_id, "alpha2").unwrap(), Some(n1));
    }

    #[test]
    fn reorder_fields_rejects_duplicate_ord_without_mutating() {
        use bibalak_core::error::CoreError;

        let Setup { s, nt_id, note_id } = setup();
        let err = s
            .reorder_fields(nt_id, &[0, 0], 2_000)
            .expect_err("duplicate ord must fail");
        assert!(matches!(err, CoreError::Invalid(_)), "got {err:?}");

        let detail = s.get_notetype_detail(nt_id).unwrap().unwrap();
        assert_eq!(
            detail
                .fields
                .iter()
                .map(|f| f.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Front", "Back"]
        );
        let note = s.note_detail(note_id).unwrap().unwrap();
        assert_eq!(
            note.fields
                .iter()
                .map(|f| f.value.as_str())
                .collect::<Vec<_>>(),
            vec!["hello", "world"]
        );
    }

    #[test]
    fn reorder_fields_rejects_negative_ord_without_mutating() {
        use bibalak_core::error::CoreError;

        let Setup { s, nt_id, note_id } = setup();
        let err = s
            .reorder_fields(nt_id, &[-1, 0], 2_000)
            .expect_err("negative ord must return CoreError::Invalid");
        assert!(matches!(err, CoreError::Invalid(_)), "got {err:?}");

        let detail = s.get_notetype_detail(nt_id).unwrap().unwrap();
        assert_eq!(
            detail
                .fields
                .iter()
                .map(|f| f.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Front", "Back"]
        );
        let note = s.note_detail(note_id).unwrap().unwrap();
        assert_eq!(
            note.fields
                .iter()
                .map(|f| f.value.as_str())
                .collect::<Vec<_>>(),
            vec!["hello", "world"]
        );
    }

    #[test]
    fn reorder_fields_rejects_out_of_range_ord_without_mutating() {
        use bibalak_core::error::CoreError;

        let Setup { s, nt_id, note_id } = setup();
        let err = s
            .reorder_fields(nt_id, &[0, 2], 2_000)
            .expect_err("ord >= field count must return CoreError::Invalid");
        assert!(matches!(err, CoreError::Invalid(_)), "got {err:?}");

        let detail = s.get_notetype_detail(nt_id).unwrap().unwrap();
        assert_eq!(
            detail
                .fields
                .iter()
                .map(|f| f.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Front", "Back"]
        );
        let note = s.note_detail(note_id).unwrap().unwrap();
        assert_eq!(
            note.fields
                .iter()
                .map(|f| f.value.as_str())
                .collect::<Vec<_>>(),
            vec!["hello", "world"]
        );
    }
}
