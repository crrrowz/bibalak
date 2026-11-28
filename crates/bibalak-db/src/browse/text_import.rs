use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::parse_notetype_sort_field;
use rusqlite::{params, Connection, OptionalExtension};

use super::notes::{expected_card_ords_with, generate_guid};
use super::text::{clean_sort_value, compute_sort_and_checksum};
use super::{err, join_tags, FIELD_SEP};

/// Transactional text import (`E4`, `ADR-011`).
///
/// Preloads note-type metadata, field names, templates, and existing checksums
/// once per transaction so 10,000+ rows commit rapidly in one transaction.
pub fn import_text_notes(
    conn: &mut Connection,
    deck_id: i64,
    notetype_id: i64,
    duplicate_policy: bibalak_core::ipc::DuplicatePolicy,
    rows: &[bibalak_core::ParsedTextNote],
    now_ms: i64,
) -> CoreResult<bibalak_core::TextImportOutcome> {
    use bibalak_core::ipc::{DuplicatePolicy, TextImportError, TextImportSummary};
    use bibalak_core::TextImportOutcome;
    use std::collections::{BTreeSet, HashMap};

    let tx = conn.transaction().map_err(err)?;

    let (kind, nt_config): (i64, String) = tx
        .query_row(
            "SELECT kind, config FROM notetypes WHERE id = ?1",
            [notetype_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?
        .ok_or_else(|| CoreError::NotFound(format!("notetype {notetype_id}")))?;
    let sort_ord = parse_notetype_sort_field(&nt_config) as usize;

    let field_names: Vec<String> = {
        let mut stmt = tx
            .prepare("SELECT name FROM fields WHERE notetype_id = ?1 ORDER BY ord")
            .map_err(err)?;
        let res = stmt
            .query_map([notetype_id], |r| r.get(0))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        res
    };
    let field_count = field_names.len();

    let templates: Vec<(i64, String, String)> = {
        let mut stmt = tx
            .prepare("SELECT ord, qfmt, afmt FROM templates WHERE notetype_id = ?1 ORDER BY ord")
            .map_err(err)?;
        let res = stmt
            .query_map([notetype_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        res
    };

    let mut existing_by_csum: HashMap<i64, i64> = {
        let mut stmt = tx
            .prepare(
                "SELECT n.id, n.checksum
                 FROM notes n
                 WHERE n.notetype_id = ?1
                   AND EXISTS (SELECT 1 FROM cards c WHERE c.note_id = n.id AND c.deck_id = ?2)",
            )
            .map_err(err)?;
        let mut map = HashMap::new();
        let mut q = stmt.query(params![notetype_id, deck_id]).map_err(err)?;
        while let Some(r) = q.next().map_err(err)? {
            let id: i64 = r.get(0).map_err(err)?;
            let csum: i64 = r.get(1).map_err(err)?;
            map.entry(csum).or_insert(id);
        }
        map
    };

    let mut next_new_due: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(due), 0) + 1 FROM cards WHERE queue = 0",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;

    let mut summary = TextImportSummary::default();
    let mut affected_note_ids = Vec::new();
    let mut touched_tags: BTreeSet<String> = BTreeSet::new();

    {
        let mut insert_note_stmt = tx
            .prepare(
                r#"INSERT INTO notes (guid, notetype_id, "mod", usn, tags, fields, sort_field, checksum, fields_norm)
                   VALUES (?1, ?2, ?3, -1, ?4, ?5, ?6, ?7, ?8)"#,
            )
            .map_err(err)?;
        let mut update_note_stmt = tx
            .prepare(
                r#"UPDATE notes SET tags = ?2, fields = ?3, sort_field = ?4, checksum = ?5, fields_norm = ?6, "mod" = ?7, usn = -1
                   WHERE id = ?1"#,
            )
            .map_err(err)?;
        let mut existing_ords_stmt = tx
            .prepare("SELECT ord FROM cards WHERE note_id = ?1")
            .map_err(err)?;
        let mut insert_card_stmt = tx
            .prepare(
                r#"INSERT INTO cards
                   (note_id, deck_id, ord, "mod", usn, type, queue, due,
                    interval, ease_factor, reps, lapses, remaining,
                    original_due, original_deck_id, flags)
                   VALUES (?1, ?2, ?3, ?4, -1, 0, 0, ?5, 0, 0, 0, 0, 0, 0, 0, 0)"#,
            )
            .map_err(err)?;

        for row in rows {
            let mut normalized_fields = Vec::with_capacity(field_count);
            for idx in 0..field_count {
                normalized_fields.push(row.fields.get(idx).cloned().unwrap_or_default());
            }
            let first_raw = normalized_fields
                .first()
                .map(String::as_str)
                .unwrap_or_default();
            if clean_sort_value(first_raw).is_empty() {
                summary.errors.push(TextImportError {
                    line: row.line,
                    message: "first field cannot be empty".into(),
                });
                continue;
            }

            let ords = expected_card_ords_with(kind, &field_names, &templates, &normalized_fields)?;
            if ords.is_empty() {
                summary.errors.push(TextImportError {
                    line: row.line,
                    message: if kind == 1 {
                        "cloze note must contain at least one {{cN::...}} marker".into()
                    } else {
                        "note creates no cards".into()
                    },
                });
                continue;
            }

            let (sort_field, checksum) = compute_sort_and_checksum(&normalized_fields, sort_ord);
            let fields_blob = normalized_fields.join(&FIELD_SEP.to_string());
            let fields_norm = crate::search::fields_norm_value(&fields_blob, Some(&sort_field));
            let tags_str = join_tags(&row.tags);
            for t in &row.tags {
                let tr = t.trim();
                if !tr.is_empty() {
                    touched_tags.insert(tr.to_string());
                }
            }

            if let Some(&existing_id) = existing_by_csum.get(&checksum) {
                match duplicate_policy {
                    DuplicatePolicy::Skip => {
                        summary.notes_skipped += 1;
                        continue;
                    }
                    DuplicatePolicy::Update => {
                        update_note_stmt
                            .execute(params![
                                existing_id,
                                tags_str,
                                fields_blob,
                                sort_field,
                                checksum,
                                fields_norm,
                                now_ms
                            ])
                            .map_err(err)?;
                        let cur_ords: BTreeSet<i64> = existing_ords_stmt
                            .query_map([existing_id], |r| r.get(0))
                            .map_err(err)?
                            .collect::<rusqlite::Result<_>>()
                            .map_err(err)?;
                        for ord in ords {
                            if !cur_ords.contains(&ord) {
                                insert_card_stmt
                                    .execute(params![
                                        existing_id,
                                        deck_id,
                                        ord,
                                        now_ms,
                                        next_new_due
                                    ])
                                    .map_err(err)?;
                                next_new_due += 1;
                                summary.cards_added += 1;
                            }
                        }
                        summary.notes_updated += 1;
                        affected_note_ids.push(existing_id);
                        continue;
                    }
                    DuplicatePolicy::KeepBoth => {}
                }
            }

            let guid = generate_guid();
            insert_note_stmt
                .execute(params![
                    guid,
                    notetype_id,
                    now_ms,
                    tags_str,
                    fields_blob,
                    sort_field,
                    checksum,
                    fields_norm
                ])
                .map_err(err)?;
            let note_id = tx.last_insert_rowid();
            for ord in ords {
                insert_card_stmt
                    .execute(params![note_id, deck_id, ord, now_ms, next_new_due])
                    .map_err(err)?;
                next_new_due += 1;
                summary.cards_added += 1;
            }
            existing_by_csum.entry(checksum).or_insert(note_id);
            summary.notes_added += 1;
            affected_note_ids.push(note_id);
        }
    }

    crate::tags::register_tags(&tx, touched_tags.iter().map(String::as_str))?;

    tx.commit().map_err(err)?;
    Ok(TextImportOutcome {
        summary,
        affected_note_ids,
    })
}

#[cfg(test)]
mod tests {
    use crate::storage::SqliteStorage;
    use bibalak_core::ports::*;

    #[test]
    fn import_text_notes_applies_duplicate_policies_and_reports_errors() {
        use bibalak_core::ipc::DuplicatePolicy;
        use bibalak_core::ParsedTextNote;

        let s = SqliteStorage::open_in_memory().unwrap();
        let nt_id = s.add_stock_notetype(0, 1_000).unwrap();
        let deck_id: i64 = s.create_deck("Imports", 1_000).unwrap().id;

        // Initial seed note ("Alpha" -> "First")
        {
            let mut conn = s.lock();
            let tx = conn.transaction().unwrap();
            super::super::add_note_with_cards(
                &tx,
                nt_id,
                deck_id,
                &["Alpha".into(), "First".into()],
                &[],
                1_000,
            )
            .unwrap();
            tx.commit().unwrap();
        }

        let batch = vec![
            ParsedTextNote {
                line: 2,
                fields: vec!["Alpha".into(), "Updated".into()],
                tags: vec!["tagA".into()],
            },
            ParsedTextNote {
                line: 3,
                fields: vec!["".into(), "Missing front".into()],
                tags: vec![],
            },
            ParsedTextNote {
                line: 4,
                fields: vec!["Beta".into(), "Second".into()],
                tags: vec!["tagB".into()],
            },
        ];

        // Skip policy skips Alpha, errors on line 3, adds Beta
        let res_skip = s
            .import_text_notes(deck_id, nt_id, DuplicatePolicy::Skip, &batch, 2_000)
            .unwrap();
        assert_eq!(res_skip.summary.notes_skipped, 1);
        assert_eq!(res_skip.summary.notes_added, 1);
        assert_eq!(res_skip.summary.notes_updated, 0);
        assert_eq!(res_skip.summary.errors.len(), 1);
        assert_eq!(res_skip.summary.errors[0].line, 3);

        // Update policy updates Alpha (with HTML/checksum normalization) & skips bad line 3
        let res_update = s
            .import_text_notes(deck_id, nt_id, DuplicatePolicy::Update, &batch[..2], 3_000)
            .unwrap();
        assert_eq!(res_update.summary.notes_updated, 1);
        assert_eq!(res_update.summary.errors.len(), 1);
        let alpha_id = s.find_duplicate_note(nt_id, "Alpha").unwrap().unwrap();
        let detail = s.note_detail(alpha_id).unwrap().unwrap();
        assert_eq!(detail.fields[1].value, "Updated");
        assert_eq!(detail.tags, vec!["tagA"]);

        // KeepBoth inserts another Alpha note
        let res_keep = s
            .import_text_notes(
                deck_id,
                nt_id,
                DuplicatePolicy::KeepBoth,
                &batch[..1],
                4_000,
            )
            .unwrap();
        assert_eq!(res_keep.summary.notes_added, 1);
        let count: i64 = s
            .lock()
            .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn import_text_notes_ten_thousand_rows_benchmark() {
        use bibalak_core::ipc::DuplicatePolicy;
        use bibalak_core::ParsedTextNote;

        let s = SqliteStorage::open_in_memory().unwrap();
        let nt_id = s.add_stock_notetype(0, 1_000).unwrap();
        let deck_id: i64 = s.create_deck("BigImport", 1_000).unwrap().id;
        let rows: Vec<ParsedTextNote> = (0..10_000)
            .map(|i| ParsedTextNote {
                line: (i + 2) as u32,
                fields: vec![format!("Front {i}"), format!("Back {i}")],
                tags: vec!["perf".into()],
            })
            .collect();

        let start = std::time::Instant::now();
        let out = s
            .import_text_notes(deck_id, nt_id, DuplicatePolicy::Skip, &rows, 5_000)
            .unwrap();
        let elapsed = start.elapsed();
        assert_eq!(out.summary.notes_added, 10_000);
        assert_eq!(out.summary.cards_added, 10_000);
        eprintln!("E4 10,000-row DB import time: {elapsed:?}");
    }

    #[test]
    fn a2_23_update_policy_scopes_to_target_deck() {
        use bibalak_core::ipc::DuplicatePolicy;
        use bibalak_core::ParsedTextNote;

        let s = SqliteStorage::open_in_memory().unwrap();
        let nt_id = s.add_stock_notetype(0, 1_000).unwrap();
        let deck_a = s.create_deck("DeckA", 1_000).unwrap().id;
        let deck_b = s.create_deck("DeckB", 1_000).unwrap().id;

        let note_in_a = s
            .add_note_with_cards(
                nt_id,
                deck_a,
                &["Shared".into(), "OriginalInA".into()],
                &[],
                1_000,
            )
            .unwrap()
            .0;

        let rows = vec![ParsedTextNote {
            line: 2,
            fields: vec!["Shared".into(), "IntoB".into()],
            tags: vec![],
        }];
        let out = s
            .import_text_notes(deck_b, nt_id, DuplicatePolicy::Update, &rows, 2_000)
            .unwrap();
        assert_eq!(out.summary.notes_updated, 0);
        assert_eq!(out.summary.notes_added, 1);

        let a_detail = s.note_detail(note_in_a).unwrap().unwrap();
        assert_eq!(a_detail.fields[1].value, "OriginalInA");
    }
}
