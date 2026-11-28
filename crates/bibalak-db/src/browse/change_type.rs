use std::collections::{HashMap, HashSet};

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::model::{Card, NoteTypeChangeSnapshot};
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use super::notes::{expected_card_ords, insert_new_card, update_note_fields_only};
use super::{err, split_tags, FIELD_SEP};

fn load_note_cards(tx: &Transaction<'_>, note_id: i64) -> CoreResult<Vec<Card>> {
    let sql = format!(
        "SELECT {} FROM cards WHERE note_id = ?1 ORDER BY ord, id",
        crate::cards::CARD_SNAPSHOT_COLS
    );
    let mut stmt = tx.prepare(&sql).map_err(err)?;
    let rows = stmt
        .query_map([note_id], crate::cards::row_to_card)
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(rows)
}

pub fn change_note_type(
    conn: &mut Connection,
    note_ids: &[i64],
    target_notetype_id: i64,
    field_map: &[Option<usize>],
    template_map: &[(i64, Option<i64>)],
    now_ms: i64,
) -> CoreResult<Vec<NoteTypeChangeSnapshot>> {
    if note_ids.is_empty() {
        return Ok(vec![]);
    }
    let tx = conn.transaction().map_err(err)?;
    let dst_kind: i64 = tx
        .query_row(
            "SELECT kind FROM notetypes WHERE id = ?1",
            [target_notetype_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .ok_or_else(|| CoreError::NotFound(format!("notetype {target_notetype_id}")))?;
    let dst_field_count: usize = tx
        .query_row(
            "SELECT COUNT(*) FROM fields WHERE notetype_id = ?1",
            [target_notetype_id],
            |r| r.get::<_, i64>(0),
        )
        .map_err(err)? as usize;
    if field_map.len() != dst_field_count {
        return Err(CoreError::Invalid(format!(
            "field_map length {} does not match target field count {dst_field_count}",
            field_map.len()
        )));
    }

    let mut dst_template_ords: HashSet<i64> = HashSet::new();
    {
        let mut t_stmt = tx
            .prepare("SELECT ord FROM templates WHERE notetype_id = ?1")
            .map_err(err)?;
        let ords = t_stmt
            .query_map([target_notetype_id], |r| r.get::<_, i64>(0))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        dst_template_ords.extend(ords);
    }

    let tmpl_lookup: HashMap<i64, Option<i64>> = template_map.iter().copied().collect();
    let mut seen_notes = HashSet::new();
    let unique_ids: Vec<i64> = note_ids
        .iter()
        .copied()
        .filter(|id| seen_notes.insert(*id))
        .collect();

    let mut src_notetype_id: Option<i64> = None;
    let mut snapshots = Vec::with_capacity(unique_ids.len());

    for note_id in unique_ids {
        let row: Option<(i64, String, String)> = tx
            .query_row(
                "SELECT notetype_id, fields, tags FROM notes WHERE id = ?1",
                [note_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(err)?;
        let Some((nt_id, fields_blob, tags_blob)) = row else {
            return Err(CoreError::NotFound(format!("note {note_id}")));
        };
        if let Some(expected) = src_notetype_id {
            if nt_id != expected {
                return Err(CoreError::Invalid(
                    "all selected notes must have the same note type".into(),
                ));
            }
        } else {
            src_notetype_id = Some(nt_id);
        }

        let old_fields: Vec<String> = fields_blob.split(FIELD_SEP).map(str::to_string).collect();
        let tags = split_tags(&tags_blob);
        let cards = load_note_cards(&tx, note_id)?;
        let default_deck_id = cards
            .first()
            .map(|c| {
                if c.original_deck_id != 0 {
                    c.original_deck_id
                } else {
                    c.deck_id
                }
            })
            .unwrap_or(1);

        snapshots.push(NoteTypeChangeSnapshot {
            note_id,
            notetype_id: nt_id,
            fields: old_fields.clone(),
            tags: tags.clone(),
            cards: cards.clone(),
        });

        let new_fields: Vec<String> = field_map
            .iter()
            .map(|src_idx| {
                src_idx
                    .and_then(|i| old_fields.get(i).cloned())
                    .unwrap_or_default()
            })
            .collect();

        tx.execute(
            "UPDATE notes SET notetype_id = ?2 WHERE id = ?1",
            params![note_id, target_notetype_id],
        )
        .map_err(err)?;
        update_note_fields_only(&tx, note_id, &new_fields, &tags, now_ms)?;

        let expected_ords = expected_card_ords(&tx, target_notetype_id, dst_kind, &new_fields)?;
        let expected_set: HashSet<i64> = expected_ords.iter().copied().collect();
        let valid_dst_ords = if dst_kind == 1 {
            &expected_set
        } else {
            &dst_template_ords
        };

        let mut assigned_ords: HashSet<i64> = HashSet::new();
        for card in cards {
            let mapped = tmpl_lookup
                .get(&card.ord)
                .copied()
                .flatten()
                .filter(|ord| valid_dst_ords.contains(ord) && !assigned_ords.contains(ord));
            if let Some(new_ord) = mapped {
                assigned_ords.insert(new_ord);
                tx.execute(
                    r#"UPDATE cards SET ord = ?2, "mod" = ?3, usn = -1 WHERE id = ?1"#,
                    params![card.id, new_ord, now_ms],
                )
                .map_err(err)?;
            } else {
                tx.execute(
                    "INSERT OR IGNORE INTO graves (usn, oid, type) VALUES (-1, ?1, 0)",
                    [card.id],
                )
                .map_err(err)?;
                tx.execute(
                    "INSERT OR REPLACE INTO grave_times (oid, type, deleted_ms) VALUES (?1, 0, ?2)",
                    params![card.id, now_ms],
                )
                .map_err(err)?;
                tx.execute("DELETE FROM cards WHERE id = ?1", [card.id])
                    .map_err(err)?;
            }
        }

        for ord in expected_ords {
            if !assigned_ords.contains(&ord) {
                insert_new_card(&tx, note_id, default_deck_id, ord, now_ms)?;
                assigned_ords.insert(ord);
            }
        }
        if assigned_ords.is_empty() {
            return Err(CoreError::Invalid("note creates no cards".into()));
        }
    }

    crate::notetype::bump_schema_mod(&tx, now_ms)?;
    tx.commit().map_err(err)?;
    Ok(snapshots)
}

pub fn restore_note_type_changes(
    conn: &mut Connection,
    snapshots: &[NoteTypeChangeSnapshot],
    now_ms: i64,
) -> CoreResult<()> {
    if snapshots.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction().map_err(err)?;
    for snap in snapshots {
        tx.execute(
            "UPDATE notes SET notetype_id = ?2 WHERE id = ?1",
            params![snap.note_id, snap.notetype_id],
        )
        .map_err(err)?;
        update_note_fields_only(&tx, snap.note_id, &snap.fields, &snap.tags, now_ms)?;
        tx.execute("DELETE FROM cards WHERE note_id = ?1", [snap.note_id])
            .map_err(err)?;
        for c in &snap.cards {
            tx.execute(
                r#"INSERT INTO cards
                   (id, note_id, deck_id, ord, "mod", usn, type, queue, due,
                    interval, ease_factor, reps, lapses, remaining,
                    original_due, original_deck_id, flags,
                    fsrs_stability, fsrs_difficulty, fsrs_last_review, data)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                           ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
                           ?18, ?19, ?20, ?21)"#,
                params![
                    c.id,
                    c.note_id,
                    c.deck_id,
                    c.ord,
                    now_ms,
                    -1,
                    c.ctype,
                    c.queue,
                    c.due,
                    c.interval,
                    c.ease_factor,
                    c.reps,
                    c.lapses,
                    c.remaining,
                    c.original_due,
                    c.original_deck_id,
                    c.flags,
                    c.fsrs_stability,
                    c.fsrs_difficulty,
                    c.fsrs_last_review,
                    c.data,
                ],
            )
            .map_err(err)?;
            tx.execute("DELETE FROM graves WHERE oid = ?1 AND type = 0", [c.id])
                .map_err(err)?;
            tx.execute(
                "DELETE FROM grave_times WHERE oid = ?1 AND type = 0",
                [c.id],
            )
            .map_err(err)?;
        }
    }
    crate::notetype::bump_schema_mod(&tx, now_ms)?;
    tx.commit().map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::storage::SqliteStorage;
    use bibalak_core::ports::*;

    #[test]
    fn change_note_type_remaps_fields_cards_checksum_and_undoes() {
        let s = SqliteStorage::open_in_memory().unwrap();
        let src_nt = s.create_notetype("SrcTwoCard", 0, 1_000).unwrap();
        s.add_template(src_nt, "Reverse", "{{Back}}", "{{Front}}", 1_000)
            .unwrap();

        let dst_nt = s.create_notetype("DstThreeField", 0, 1_000).unwrap();
        s.add_field(dst_nt, "Hint", 1_000).unwrap();
        s.add_template(dst_nt, "Extra", "{{Hint}}", "{{Front}}", 1_000)
            .unwrap();

        let other_nt = s.create_notetype("Other", 0, 1_000).unwrap();

        let (n1, _) = s
            .add_note_with_cards(
                src_nt,
                1,
                &["Question 1".into(), "Answer 1".into()],
                &["tagA".into()],
                1_000,
            )
            .unwrap();
        let (n_other, _) = s
            .add_note_with_cards(other_nt, 1, &["Other".into(), "B".into()], &[], 1_000)
            .unwrap();

        // Give card ord 0 of n1 review state so we verify scheduling is preserved across mapping.
        let card0_id: i64 = s
            .lock()
            .query_row(
                "SELECT id FROM cards WHERE note_id = ?1 AND ord = 0",
                [n1],
                |r| r.get(0),
            )
            .unwrap();
        s.lock()
            .execute(
                "UPDATE cards SET type = 2, queue = 2, due = 50, interval = 12, reps = 4 WHERE id = ?1",
                [card0_id],
            )
            .unwrap();

        // Mixed note types must fail atomically.
        assert!(s
            .change_note_type(
                &[n1, n_other],
                dst_nt,
                &[Some(1), Some(0), None],
                &[(0, Some(0))],
                2_000
            )
            .is_err());

        // Swap Front/Back (so new field 0 = "Answer 1"), put "Fixed Hint" via None->"", map old ord 0 -> new ord 0, drop old ord 1.
        // Wait: to exercise new card creation on template ord 1, update n1's Hint or map Hint from field 0?
        // Map dst fields: [old Front (0), old Front (0) as Back, old Back (1) as Hint] so template 1 (Extra: {{Hint}}) renders non-empty!
        let snaps = s
            .change_note_type(
                &[n1],
                dst_nt,
                &[Some(1), Some(0), Some(0)],
                &[(0, Some(0)), (1, None)],
                2_000,
            )
            .unwrap();
        assert_eq!(snaps.len(), 1);
        assert_eq!(snaps[0].cards.len(), 2);

        let detail = s.note_detail(n1).unwrap().unwrap();
        assert_eq!(detail.notetype_name, "DstThreeField");
        assert_eq!(
            detail
                .fields
                .iter()
                .map(|f| f.value.as_str())
                .collect::<Vec<_>>(),
            vec!["Answer 1", "Question 1", "Question 1"]
        );

        let new_cards: Vec<(i64, i64, i64, i64)> = {
            let conn = s.lock();
            let mut stmt = conn
                .prepare(
                    "SELECT id, ord, queue, interval FROM cards WHERE note_id = ?1 ORDER BY ord",
                )
                .unwrap();
            stmt.query_map([n1], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert_eq!(new_cards.len(), 2);
        assert_eq!(new_cards[0], (card0_id, 0, 2, 12)); // preserved scheduling
        assert_eq!(new_cards[1].1, 1); // newly created card for ord 1
        assert_eq!(new_cards[1].2, 0); // queue = 0 (new)

        // Checksum must match new first field ("Answer 1")
        let dup_old = s.find_duplicate_note(dst_nt, "Question 1").unwrap();
        assert!(dup_old.is_none());
        let dup_new = s.find_duplicate_note(dst_nt, "Answer 1").unwrap();
        assert_eq!(dup_new, Some(n1));

        // Undo restores original notetype, fields, checksum, and exact 2 cards.
        s.restore_note_type_changes(&snaps, 3_000).unwrap();
        let restored = s.note_detail(n1).unwrap().unwrap();
        assert_eq!(restored.notetype_name, "SrcTwoCard");
        assert_eq!(
            restored
                .fields
                .iter()
                .map(|f| f.value.as_str())
                .collect::<Vec<_>>(),
            vec!["Question 1", "Answer 1"]
        );
        let restored_card_count: i64 = s
            .lock()
            .query_row("SELECT COUNT(*) FROM cards WHERE note_id = ?1", [n1], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(restored_card_count, 2);
        assert_eq!(
            s.find_duplicate_note(src_nt, "Question 1").unwrap(),
            Some(n1)
        );
    }
}
