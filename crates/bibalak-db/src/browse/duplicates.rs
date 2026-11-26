use std::collections::HashMap;

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::DuplicateGroup;
use bibalak_core::normalize_search_text;
use rusqlite::{Connection, OptionalExtension};

use super::read::fields_for_notetype;
use super::text::{decode_entities, strip_tags};
use super::{err, FIELD_SEP};

pub fn find_duplicates(
    conn: &Connection,
    notetype_id: i64,
    field_ord: i64,
) -> CoreResult<Vec<DuplicateGroup>> {
    let exists: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM notetypes WHERE id = ?1",
            [notetype_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if exists.is_none() {
        return Err(CoreError::NotFound(format!("notetype {notetype_id}")));
    }
    let fields = fields_for_notetype(conn, notetype_id)?;
    let ord_usize = usize::try_from(field_ord)
        .map_err(|_| CoreError::Invalid(format!("invalid field ordinal {field_ord}")))?;
    if ord_usize >= fields.len() {
        return Err(CoreError::Invalid(format!(
            "field ordinal {field_ord} out of range for notetype {notetype_id}"
        )));
    }

    let mut stmt = conn
        .prepare("SELECT id, fields FROM notes WHERE notetype_id = ?1 ORDER BY id ASC")
        .map_err(err)?;
    let rows = stmt
        .query_map([notetype_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(err)?;

    let mut grouped: HashMap<String, (String, Vec<i64>)> = HashMap::new();
    for row in rows {
        let (note_id, blob) = row.map_err(err)?;
        let Some(raw) = blob.split(FIELD_SEP).nth(ord_usize) else {
            continue;
        };
        let plain = decode_entities(&strip_tags(raw)).replace('\u{a0}', " ");
        let sample: String = plain.split_whitespace().collect::<Vec<_>>().join(" ");
        let norm = normalize_search_text(&sample);
        if norm.is_empty() {
            continue;
        }
        grouped
            .entry(norm)
            .and_modify(|(_, ids)| ids.push(note_id))
            .or_insert_with(|| (sample, vec![note_id]));
    }

    let mut groups: Vec<DuplicateGroup> = grouped
        .into_iter()
        .filter(|(_, (_, ids))| ids.len() >= 2)
        .map(|(normalized, (sample_value, note_ids))| DuplicateGroup {
            normalized,
            sample_value,
            note_ids,
        })
        .collect();
    groups.sort_by(|a, b| {
        a.sample_value
            .to_lowercase()
            .cmp(&b.sample_value.to_lowercase())
            .then_with(|| a.note_ids[0].cmp(&b.note_ids[0]))
    });
    Ok(groups)
}

#[cfg(test)]
mod tests {
    use super::super::model;
    use crate::storage::SqliteStorage;
    use bibalak_core::ports::*;

    #[test]
    fn find_duplicates_groups_by_search_norm_and_ignores_empty_and_other_notetypes() {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.import(&model(), 1000).unwrap();
        let nt_basic = s.list_notetypes().unwrap()[0].id;
        let nt_cloze = s.create_notetype("ClozeDup", 1, 1000).unwrap();

        let n1;
        let n2;
        let n3;
        let n_cafe1;
        let n_cafe2;
        {
            let mut conn = s.lock();
            let tx = conn.transaction().unwrap();
            n1 = super::super::add_note_with_cards(
                &tx,
                nt_basic,
                1,
                &["الإسلام".into(), "A1".into()],
                &[],
                100,
            )
            .unwrap()
            .0;
            n2 = super::super::add_note_with_cards(
                &tx,
                nt_basic,
                1,
                &["<b>الْإِسْلَامُ</b>".into(), "A2".into()],
                &[],
                200,
            )
            .unwrap()
            .0;
            n3 = super::super::add_note_with_cards(
                &tx,
                nt_basic,
                1,
                &["Unique word".into(), "".into()],
                &[],
                300,
            )
            .unwrap()
            .0;
            n_cafe1 = super::super::add_note_with_cards(
                &tx,
                nt_basic,
                1,
                &["Café".into(), "".into()],
                &[],
                400,
            )
            .unwrap()
            .0;
            n_cafe2 = super::super::add_note_with_cards(
                &tx,
                nt_basic,
                1,
                &["cafe".into(), "".into()],
                &[],
                500,
            )
            .unwrap()
            .0;
            // Same text in another notetype should not collide with nt_basic
            super::super::add_note_with_cards(
                &tx,
                nt_cloze,
                1,
                &["{{c1::cafe}}".into(), "cafe".into()],
                &[],
                600,
            )
            .unwrap();
            tx.commit().unwrap();
        }
        let _ = n3;

        // Back field has empty values on n3/n_cafe1/n_cafe2 — must NOT group empties as duplicates
        let back_dups = s.find_duplicates(nt_basic, 1).unwrap();
        assert!(back_dups.is_empty());

        let front_dups = s.find_duplicates(nt_basic, 0).unwrap();
        assert_eq!(front_dups.len(), 2);
        let arabic = front_dups.iter().find(|g| g.normalized == "الاسلام").unwrap();
        assert_eq!(arabic.note_ids, vec![n1, n2]);
        let latin = front_dups.iter().find(|g| g.normalized == "cafe").unwrap();
        assert_eq!(latin.note_ids, vec![n_cafe1, n_cafe2]);

        assert!(s.find_duplicates(nt_basic, 99).is_err());
    }
}
