//! Transactional merge of a [`CanonicalModel`] into the open collection.
//!
//! Matching rules (idempotent on re-import):
//! - **deck configs** by id (`INSERT OR IGNORE`)
//! - **decks** by full name (get-or-create); parent links fixed in a second pass
//! - **notetypes** by name; fields/templates inserted only for new notetypes
//! - **notes** by `guid` (update if present, else insert)
//! - **cards** by `(note_id, ord)`
//! - **revlog** by id (`INSERT OR IGNORE`)
//!
//! Source ids are remapped through `*_map` tables so foreign keys stay valid in
//! our id space (deck/notetype/note/card ids are regenerated; revlog ids are
//! preserved because they are unique review timestamps).

use std::collections::{HashMap, HashSet};

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::model::{CanonicalModel, ImportSummary};
use rusqlite::{params, OptionalExtension, Transaction};
use sha1::{Digest, Sha1};

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

fn notetype_schema_hash(kind: i64, field_names: &[&str]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(kind.to_le_bytes());
    hasher.update(b"\0");
    for name in field_names {
        hasher.update(name.as_bytes());
        hasher.update(b"\x1f");
    }
    let digest = hasher.finalize();
    format!("{:02x}{:02x}{:02x}", digest[0], digest[1], digest[2])[..5].to_string()
}

fn notetype_matches_schema(
    tx: &Transaction<'_>,
    notetype_id: i64,
    expected_kind: i64,
    expected_fields: &[&str],
) -> CoreResult<bool> {
    let local_kind: i64 = tx
        .query_row(
            "SELECT kind FROM notetypes WHERE id = ?1",
            [notetype_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if local_kind != expected_kind {
        return Ok(false);
    }
    let mut stmt = tx
        .prepare("SELECT name FROM fields WHERE notetype_id = ?1 ORDER BY ord")
        .map_err(err)?;
    let local_fields: Vec<String> = stmt
        .query_map([notetype_id], |r| r.get(0))
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;
    Ok(local_fields.len() == expected_fields.len()
        && local_fields
            .iter()
            .zip(expected_fields.iter())
            .all(|(a, b)| a == b))
}

fn note_count_for_notetype(tx: &Transaction<'_>, notetype_id: i64) -> CoreResult<i64> {
    tx.query_row(
        "SELECT COUNT(*) FROM notes WHERE notetype_id = ?1",
        [notetype_id],
        |r| r.get(0),
    )
    .map_err(err)
}

/// Insert every field/template belonging to `source_nt_id` in `model` under
/// `target_id` in the database.
fn insert_fields_and_templates(
    tx: &Transaction<'_>,
    model: &CanonicalModel,
    source_nt_id: i64,
    target_id: i64,
) -> CoreResult<()> {
    for f in model
        .fields
        .iter()
        .filter(|f| f.notetype_id == source_nt_id)
    {
        tx.execute(
            "INSERT INTO fields (notetype_id, ord, name, config) VALUES (?1, ?2, ?3, ?4)",
            params![target_id, f.ord, f.name, f.config_json],
        )
        .map_err(err)?;
    }
    for t in model
        .templates
        .iter()
        .filter(|t| t.notetype_id == source_nt_id)
    {
        tx.execute(
            "INSERT INTO templates (notetype_id, ord, name, qfmt, afmt, config) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![target_id, t.ord, t.name, t.qfmt, t.afmt, t.config_json],
        )
        .map_err(err)?;
    }
    Ok(())
}

/// Epoch timestamps in seconds (until year 5138) are below this threshold;
/// timestamps at or above it are already in milliseconds.
const SECONDS_TO_MS_THRESHOLD: i64 = 100_000_000_000;

/// Normalize a learning timestamp to epoch milliseconds (Anki stores seconds,
/// Bibalak stores milliseconds).
fn ensure_ms(ts: i64) -> i64 {
    if ts > 0 && ts < SECONDS_TO_MS_THRESHOLD {
        ts * 1000
    } else {
        ts
    }
}

/// Convert a learning/relearning `due` or `odue` value that may be a day number
/// (`0..1_000_000`, Anki day-learn), epoch seconds, or epoch milliseconds.
fn convert_learn_due(
    val: i64,
    allow_day_zero: bool,
    source_created_ms: i64,
    rollover_hour: u8,
    tz_offset_minutes: i32,
) -> i64 {
    if val == 0 && !allow_day_zero {
        0
    } else if (0..1_000_000).contains(&val) {
        crate::cards::day_to_start_ms(val, source_created_ms, rollover_hour, tz_offset_minutes)
    } else {
        ensure_ms(val)
    }
}

/// Convert `due` or `odue` according to the card's phase (`ctype`):
/// reviews (`2`) shift day indices from source creation to Bibalak creation;
/// learning/relearning (`1 | 3`) normalize to epoch milliseconds; new (`0`) stays
/// as a position integer.
fn convert_due_for_phase(
    val: i64,
    ctype: i64,
    day_shift: i64,
    source_created_ms: i64,
    rollover_hour: u8,
    tz_offset_minutes: i32,
) -> i64 {
    match ctype {
        2 => val + day_shift,
        1 => convert_learn_due(
            val,
            false,
            source_created_ms,
            rollover_hour,
            tz_offset_minutes,
        ),
        3 => convert_learn_due(
            val,
            true,
            source_created_ms,
            rollover_hour,
            tz_offset_minutes,
        ),
        _ => val,
    }
}

pub(crate) fn import(
    tx: &Transaction<'_>,
    model: &CanonicalModel,
    tz_offset_minutes: i32,
    now_ms: i64,
    on_progress: &mut dyn FnMut(u32, u32),
) -> CoreResult<ImportSummary> {
    let mut summary = ImportSummary::default();
    let total_rows = (model.notes.len() + model.cards.len()) as u32;
    let mut done_rows: u32 = 0;
    const PROGRESS_STRIDE: u32 = 500;
    on_progress(0, total_rows);

    // 1. Deck options groups — preserve id when unused, reuse identical configs
    // on re-import, and remap colliding ids instead of silently dropping them.
    let mut dconf_map: HashMap<i64, i64> = HashMap::new();
    for cfg in &model.deck_configs {
        let existing_at_id: Option<(String, String)> = tx
            .query_row(
                "SELECT name, config FROM deck_config WHERE id = ?1",
                [cfg.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;

        let target_id = match existing_at_id {
            None => {
                tx.execute(
                    r#"INSERT INTO deck_config (id, name, "mod", usn, config) VALUES (?1, ?2, ?3, -1, ?4)"#,
                    params![cfg.id, cfg.name, now_ms, cfg.config_json],
                )
                .map_err(err)?;
                cfg.id
            }
            Some(_) if cfg.id == 1 && cfg.name == "Default" && cfg.config_json.trim() == "{}" => 1,
            Some((ref ex_name, ref ex_cfg))
                if ex_name == &cfg.name && ex_cfg == &cfg.config_json =>
            {
                cfg.id
            }
            Some(_) => {
                let matching: Option<i64> = tx
                    .query_row(
                        "SELECT id FROM deck_config WHERE name = ?1 AND config = ?2 LIMIT 1",
                        params![cfg.name, cfg.config_json],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(err)?;
                match matching {
                    Some(id) => id,
                    None => {
                        tx.execute(
                            r#"INSERT INTO deck_config (name, "mod", usn, config) VALUES (?1, ?2, -1, ?3)"#,
                            params![cfg.name, now_ms, cfg.config_json],
                        )
                        .map_err(err)?;
                        tx.last_insert_rowid()
                    }
                }
            }
        };
        dconf_map.insert(cfg.id, target_id);
    }

    // 2. Decks — get-or-create by name, ensuring every ancestor level exists.
    // Only import decks that cards actually reference (or are ancestors of such decks).
    // Anki always includes a "Default" deck even when no cards live there, so without
    // this filter every import would silently create a spurious Default deck.
    let direct_deck_ids: std::collections::HashSet<i64> = model
        .cards
        .iter()
        .flat_map(|c| {
            [
                Some(c.deck_id),
                (c.original_deck_id != 0).then_some(c.original_deck_id),
            ]
        })
        .flatten()
        .collect();
    // Deck names are normalised per `::` segment (SUB1 F6), so `A:: B` in a
    // package lands in `A::B`; a name with no segment left goes to Default.
    let norm = |name: &str| {
        bibalak_core::normalise_deck_name(name).unwrap_or_else(|_| "Default".to_string())
    };
    let model_deck_names: HashMap<i64, String> =
        model.decks.iter().map(|d| (d.id, norm(&d.name))).collect();
    let needed_deck_names: HashSet<&str> = model
        .decks
        .iter()
        .filter(|d| direct_deck_ids.contains(&d.id))
        .map(|d| model_deck_names[&d.id].as_str())
        .collect();
    let decks_to_import: Vec<&bibalak_core::model::Deck> = model
        .decks
        .iter()
        .filter(|d| {
            let own = &model_deck_names[&d.id];
            direct_deck_ids.contains(&d.id)
                || needed_deck_names
                    .iter()
                    .any(|&name| name.starts_with(&format!("{own}::")))
        })
        .collect();

    let model_decks_by_name: HashMap<&str, &bibalak_core::model::Deck> = model
        .decks
        .iter()
        .map(|d| (model_deck_names[&d.id].as_str(), d))
        .collect();

    let mut all_required_deck_names: HashSet<String> = HashSet::new();
    for d in &decks_to_import {
        let name = &model_deck_names[&d.id];
        all_required_deck_names.insert(name.clone());
        let mut curr = name.as_str();
        while let Some((parent, _)) = curr.rsplit_once("::") {
            all_required_deck_names.insert(parent.to_string());
            curr = parent;
        }
    }

    let mut sorted_deck_names: Vec<String> = all_required_deck_names.into_iter().collect();
    sorted_deck_names.sort_by(|a, b| {
        let depth_a = a.matches("::").count();
        let depth_b = b.matches("::").count();
        depth_a.cmp(&depth_b).then_with(|| a.cmp(b))
    });

    let mut deck_map: HashMap<i64, i64> = HashMap::new();
    for name in &sorted_deck_names {
        let existing: Option<(i64, Option<i64>)> = tx
            .query_row(
                "SELECT id, parent_id FROM decks WHERE name = ?1",
                [name],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;

        let target = match existing {
            Some((id, existing_parent_id)) => {
                if existing_parent_id.is_none() {
                    if let Some((parent, _)) = name.rsplit_once("::") {
                        tx.execute(
                            r#"UPDATE decks SET parent_id = (SELECT id FROM decks WHERE name = ?1), "mod" = ?2, usn = -1 WHERE id = ?3"#,
                            params![parent, now_ms, id],
                        )
                        .map_err(err)?;
                    }
                }
                id
            }
            None => {
                let model_deck = model_decks_by_name.get(name.as_str()).copied();
                let config_id = match model_deck {
                    Some(d) => match dconf_map.get(&d.config_id) {
                        Some(&mapped) => mapped,
                        None => resolve_config(tx, d.config_id)?,
                    },
                    None => 1,
                };
                let collapsed = model_deck.map(|d| d.collapsed).unwrap_or(false);
                let is_filtered = model_deck.map(|d| d.is_filtered).unwrap_or(false);
                let parent_id: Option<i64> = match name.rsplit_once("::") {
                    Some((parent, _)) => tx
                        .query_row("SELECT id FROM decks WHERE name = ?1", [parent], |r| {
                            r.get(0)
                        })
                        .optional()
                        .map_err(err)?,
                    None => None,
                };

                tx.execute(
                    r#"INSERT INTO decks (name, parent_id, config_id, "mod", usn, collapsed, is_filtered)
                       VALUES (?1, ?2, ?3, ?4, -1, ?5, ?6)"#,
                    params![
                        name,
                        parent_id,
                        config_id,
                        now_ms,
                        collapsed as i64,
                        is_filtered as i64
                    ],
                )
                .map_err(err)?;
                summary.decks_added += 1;
                tx.last_insert_rowid()
            }
        };

        // Every package deck whose normalised name is this one maps here.
        for (model_id, model_name) in &model_deck_names {
            if model_name == name {
                deck_map.insert(*model_id, target);
            }
        }
    }

    // 3. Note types — match by name only when schema (kind + fields in ord order)
    // matches, or when the existing local notetype has 0 notes (unused stock
    // placeholder). When an in-use local notetype shares the name but differs in
    // kind or field layout, clone as "<Name>-<short hash>" (cf. Anki merge.rs
    // disambiguation) instead of packing notes into the wrong schema.
    let mut nt_map: HashMap<i64, i64> = HashMap::new();
    let mut nt_sortf: HashMap<i64, usize> = HashMap::new();
    for nt in &model.notetypes {
        let mut incoming_fields: Vec<(i64, &str)> = model
            .fields
            .iter()
            .filter(|f| f.notetype_id == nt.id)
            .map(|f| (f.ord, f.name.as_str()))
            .collect();
        incoming_fields.sort_by_key(|(ord, _)| *ord);
        let incoming_field_names: Vec<&str> =
            incoming_fields.into_iter().map(|(_, name)| name).collect();

        let existing: Option<i64> = tx
            .query_row(
                "SELECT id FROM notetypes WHERE name = ?1",
                [&nt.name],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;

        let replace_existing = |id: i64| -> CoreResult<i64> {
            tx.execute(
                r#"UPDATE notetypes SET kind = ?2, "mod" = ?3, usn = -1, config = ?4 WHERE id = ?1"#,
                params![id, nt.kind, now_ms, nt.config_json],
            )
            .map_err(err)?;
            tx.execute("DELETE FROM fields WHERE notetype_id = ?1", [id])
                .map_err(err)?;
            tx.execute("DELETE FROM templates WHERE notetype_id = ?1", [id])
                .map_err(err)?;
            insert_fields_and_templates(tx, model, nt.id, id)?;
            Ok(id)
        };

        let target = match existing {
            Some(id) if note_count_for_notetype(tx, id)? == 0 => replace_existing(id)?,
            Some(id) if notetype_matches_schema(tx, id, nt.kind, &incoming_field_names)? => id,
            Some(_) => {
                let short_hash = notetype_schema_hash(nt.kind, &incoming_field_names);
                let mut suffix_idx = 0usize;
                loop {
                    let candidate = if suffix_idx == 0 {
                        format!("{}-{short_hash}", nt.name)
                    } else {
                        format!("{}-{short_hash}-{suffix_idx}", nt.name)
                    };
                    let cand_existing: Option<i64> = tx
                        .query_row(
                            "SELECT id FROM notetypes WHERE name = ?1",
                            [&candidate],
                            |r| r.get(0),
                        )
                        .optional()
                        .map_err(err)?;
                    match cand_existing {
                        Some(cid) if note_count_for_notetype(tx, cid)? == 0 => {
                            break replace_existing(cid)?;
                        }
                        Some(cid)
                            if notetype_matches_schema(
                                tx,
                                cid,
                                nt.kind,
                                &incoming_field_names,
                            )? =>
                        {
                            break cid;
                        }
                        Some(_) => {
                            suffix_idx += 1;
                        }
                        None => {
                            tx.execute(
                                r#"INSERT INTO notetypes (name, kind, "mod", usn, config) VALUES (?1, ?2, ?3, -1, ?4)"#,
                                params![candidate, nt.kind, now_ms, nt.config_json],
                            )
                            .map_err(err)?;
                            summary.notetypes_added += 1;
                            let id = tx.last_insert_rowid();
                            insert_fields_and_templates(tx, model, nt.id, id)?;
                            break id;
                        }
                    }
                }
            }
            None => {
                tx.execute(
                    r#"INSERT INTO notetypes (name, kind, "mod", usn, config) VALUES (?1, ?2, ?3, -1, ?4)"#,
                    params![nt.name, nt.kind, now_ms, nt.config_json],
                )
                .map_err(err)?;
                summary.notetypes_added += 1;
                let id = tx.last_insert_rowid();
                insert_fields_and_templates(tx, model, nt.id, id)?;
                id
            }
        };
        nt_map.insert(nt.id, target);
        nt_sortf.insert(
            target,
            bibalak_core::ipc::parse_notetype_sort_field(&nt.config_json) as usize,
        );
    }

    // 4. Notes — dedup by guid. Pre-load existing (guid -> (id, mod)) so the
    // per-row existence check is an in-memory lookup instead of a SELECT.
    let mut existing_notes: HashMap<String, (i64, i64)> = {
        let mut stmt = tx
            .prepare(r#"SELECT id, guid, "mod" FROM notes"#)
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(1)?,
                    (r.get::<_, i64>(0)?, r.get::<_, i64>(2)?),
                ))
            })
            .map_err(err)?;
        rows.collect::<rusqlite::Result<_>>().map_err(err)?
    };
    let mut note_map: HashMap<i64, i64> = HashMap::new();
    let mut tags_to_register: HashSet<&str> = HashSet::new();
    for note in &model.notes {
        let Some(&notetype_id) = nt_map.get(&note.notetype_id) else {
            continue;
        };
        let fields = note.fields.join("\u{1f}");
        let tags = if note.tags.is_empty() {
            String::new()
        } else {
            format!(" {} ", note.tags.join(" "))
        };
        let sort_ord = nt_sortf.get(&notetype_id).copied().unwrap_or(0);
        let sort = note
            .sort_field
            .clone()
            .or_else(|| note.fields.get(sort_ord).cloned())
            .or_else(|| note.fields.first().cloned());
        let fields_norm = crate::search::fields_norm_value(&fields, sort.as_deref());
        let checksum = crate::browse::field_checksum(
            note.fields.first().map(String::as_str).unwrap_or_default(),
        );

        match existing_notes.get(&note.guid).copied() {
            Some((id, existing_mod)) => {
                if note.mod_ms > existing_mod {
                    tx.prepare_cached(
                        r#"UPDATE notes SET "mod" = ?1, tags = ?2, fields = ?3, sort_field = ?4, checksum = ?5, fields_norm = ?6, usn = -1
                           WHERE id = ?7"#,
                    )
                    .map_err(err)?
                    .execute(params![now_ms, tags, fields, sort, checksum, fields_norm, id])
                    .map_err(err)?;
                    summary.notes_updated += 1;
                    existing_notes.insert(note.guid.clone(), (id, note.mod_ms));
                    tags_to_register.extend(note.tags.iter().flat_map(|t| t.split_whitespace()));
                }
                note_map.insert(note.id, id);
            }
            None => {
                tx.prepare_cached(
                    r#"INSERT INTO notes (guid, notetype_id, "mod", usn, tags, fields, sort_field, checksum, fields_norm)
                       VALUES (?1, ?2, ?3, -1, ?4, ?5, ?6, ?7, ?8)"#,
                )
                .map_err(err)?
                .execute(params![note.guid, notetype_id, now_ms, tags, fields, sort, checksum, fields_norm])
                .map_err(err)?;
                summary.notes_added += 1;
                let id = tx.last_insert_rowid();
                existing_notes.insert(note.guid.clone(), (id, note.mod_ms));
                note_map.insert(note.id, id);
                tags_to_register.extend(note.tags.iter().flat_map(|t| t.split_whitespace()));
            }
        }
        done_rows += 1;
        if done_rows.is_multiple_of(PROGRESS_STRIDE) {
            on_progress(done_rows, total_rows);
        }
    }
    crate::tags::register_tags(tx, tags_to_register)?;

    // 5. Cards — dedup by (note_id, ord). Pre-load existing ((note_id, ord) -> id).
    let mut existing_cards: HashMap<(i64, i64), i64> = {
        let mut stmt = tx
            .prepare("SELECT id, note_id, ord FROM cards")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?),
                    r.get::<_, i64>(0)?,
                ))
            })
            .map_err(err)?;
        rows.collect::<rusqlite::Result<_>>().map_err(err)?
    };
    let (created_ms, rollover_hour) = {
        let info: Option<(i64, String)> = tx
            .query_row(
                "SELECT created, config FROM collection WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        if let Some((created, config_json)) = info {
            let v: serde_json::Value = serde_json::from_str(&config_json).unwrap_or_default();
            let hour = v["rolloverHour"]
                .as_u64()
                .map(|h| h.min(23) as u8)
                .unwrap_or(crate::cards::DEFAULT_ROLLOVER_HOUR);
            (created, hour)
        } else {
            (0, crate::cards::DEFAULT_ROLLOVER_HOUR)
        }
    };

    let source_created_ms = model.created_ms.unwrap_or(created_ms);
    let tz_off_ms = i64::from(tz_offset_minutes) * 60_000;
    let rollover_ms = i64::from(rollover_hour) * 3_600_000;
    let source_epoch_day =
        (source_created_ms + tz_off_ms - rollover_ms).div_euclid(crate::cards::MS_PER_DAY);
    let target_epoch_day =
        (created_ms + tz_off_ms - rollover_ms).div_euclid(crate::cards::MS_PER_DAY);
    let day_shift = source_epoch_day - target_epoch_day;

    let mut card_map: HashMap<i64, i64> = HashMap::new();
    for card in &model.cards {
        let Some(&note_id) = note_map.get(&card.note_id) else {
            continue;
        };
        let deck_id = deck_map.get(&card.deck_id).copied().unwrap_or(1);
        let key = (note_id, card.ord);
        let target = match existing_cards.get(&key).copied() {
            Some(id) => id,
            None => {
                let (card_queue, card_due) = match card.queue {
                    3 => (
                        1,
                        convert_learn_due(
                            card.due,
                            true,
                            source_created_ms,
                            rollover_hour,
                            tz_offset_minutes,
                        ),
                    ),
                    1 => (1, ensure_ms(card.due)),
                    2 => (2, card.due + day_shift),
                    0 => (0, card.due),
                    q if q < 0 => (
                        q,
                        convert_due_for_phase(
                            card.due,
                            card.ctype,
                            day_shift,
                            source_created_ms,
                            rollover_hour,
                            tz_offset_minutes,
                        ),
                    ),
                    other => (other, card.due),
                };
                let original_deck_id = if card.original_deck_id != 0 {
                    deck_map.get(&card.original_deck_id).copied().unwrap_or(0)
                } else {
                    0
                };
                let original_due = if card.original_deck_id != 0 {
                    convert_due_for_phase(
                        card.original_due,
                        card.ctype,
                        day_shift,
                        source_created_ms,
                        rollover_hour,
                        tz_offset_minutes,
                    )
                } else {
                    card.original_due
                };
                let fsrs_last_review = card.fsrs_last_review.map(|d| {
                    if d >= 1_000_000 {
                        let lrt_ms = ensure_ms(d);
                        (lrt_ms + tz_off_ms - rollover_ms).div_euclid(crate::cards::MS_PER_DAY)
                            - target_epoch_day
                    } else {
                        d + day_shift
                    }
                });

                tx.prepare_cached(
                    r#"INSERT INTO cards
                       (note_id, deck_id, ord, "mod", usn, type, queue, due, interval, ease_factor,
                        reps, lapses, remaining, original_due, original_deck_id, flags,
                        fsrs_stability, fsrs_difficulty, fsrs_last_review, data)
                       VALUES (?1, ?2, ?3, ?4, -1, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)"#,
                )
                .map_err(err)?
                .execute(params![
                    note_id,
                    deck_id,
                    card.ord,
                    now_ms,
                    card.ctype,
                    card_queue,
                    card_due,
                    card.interval,
                    card.ease_factor,
                    card.reps,
                    card.lapses,
                    card.remaining,
                    original_due,
                    original_deck_id,
                    card.flags,
                    card.fsrs_stability,
                    card.fsrs_difficulty,
                    fsrs_last_review,
                    card.data,
                ])
                .map_err(err)?;
                summary.cards_added += 1;
                let id = tx.last_insert_rowid();
                existing_cards.insert(key, id);
                id
            }
        };
        card_map.insert(card.id, target);
        done_rows += 1;
        if done_rows.is_multiple_of(PROGRESS_STRIDE) {
            on_progress(done_rows, total_rows);
        }
    }

    // 6. Review history — preserve ids (unique timestamps); dedup via PK.
    for rev in &model.revlog {
        let Some(&card_id) = card_map.get(&rev.card_id) else {
            continue;
        };
        let changed = tx
            .prepare_cached(
                r#"INSERT OR IGNORE INTO revlog
                   (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
                   VALUES (?1, ?2, -1, ?3, ?4, ?5, ?6, ?7, ?8)"#,
            )
            .map_err(err)?
            .execute(params![
                rev.id,
                card_id,
                rev.ease,
                rev.interval,
                rev.last_interval,
                rev.ease_factor,
                rev.taken_ms,
                rev.review_kind
            ])
            .map_err(err)?;
        summary.revlog_added += changed as u32;
    }

    on_progress(total_rows, total_rows);
    Ok(summary)
}

fn resolve_config(tx: &Transaction<'_>, source_config_id: i64) -> CoreResult<i64> {
    let exists: Option<i64> = tx
        .query_row(
            "SELECT id FROM deck_config WHERE id = ?1",
            [source_config_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    Ok(exists.unwrap_or(1))
}

#[cfg(test)]
mod tests {
    use crate::storage::SqliteStorage;
    use bibalak_core::model::{
        CanonicalModel, Card, Deck, DeckConfig, Field, Note, Notetype, Revlog, Template,
    };
    use bibalak_core::ports::*;

    fn deck(id: i64, name: &str) -> Deck {
        Deck {
            id,
            name: name.into(),
            parent_id: None,
            config_id: 1,
            mod_ms: 0,
            usn: -1,
            collapsed: false,
            is_filtered: false,
        }
    }

    fn sample_model() -> CanonicalModel {
        CanonicalModel {
            created_ms: None,
            deck_configs: vec![DeckConfig {
                id: 1,
                name: "Default".into(),
                mod_ms: 0,
                usn: 0,
                config_json: "{}".into(),
            }],
            decks: vec![
                deck(1, "Default"),
                deck(2, "Spanish"),
                deck(3, "Spanish::Verbs"),
            ],
            notetypes: vec![Notetype {
                id: 10,
                name: "Basic".into(),
                kind: 0,
                mod_ms: 0,
                usn: -1,
                config_json: "{}".into(),
            }],
            fields: vec![
                Field {
                    notetype_id: 10,
                    ord: 0,
                    name: "Front".into(),
                    config_json: "{}".into(),
                },
                Field {
                    notetype_id: 10,
                    ord: 1,
                    name: "Back".into(),
                    config_json: "{}".into(),
                },
            ],
            templates: vec![Template {
                notetype_id: 10,
                ord: 0,
                name: "Card 1".into(),
                qfmt: "{{Front}}".into(),
                afmt: "{{FrontSide}}<hr>{{Back}}".into(),
                config_json: "{}".into(),
            }],
            notes: vec![Note {
                id: 100,
                guid: "g1".into(),
                notetype_id: 10,
                mod_ms: 0,
                usn: -1,
                tags: vec!["spanish".into()],
                fields: vec!["hola".into(), "hello".into()],
                sort_field: Some("hola".into()),
                checksum: Some(123),
            }],
            cards: vec![Card {
                id: 1000,
                note_id: 100,
                deck_id: 3,
                ord: 0,
                mod_ms: 0,
                usn: -1,
                ctype: 0,
                queue: 0,
                due: 0,
                interval: 0,
                ease_factor: 2500,
                reps: 0,
                lapses: 0,
                remaining: 0,
                original_due: 0,
                original_deck_id: 0,
                flags: 0,
                fsrs_stability: None,
                fsrs_difficulty: None,
                fsrs_last_review: None,
                data: None,
            }],
            revlog: vec![Revlog {
                id: 5000,
                card_id: 1000,
                usn: -1,
                ease: 3,
                interval: 1,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 1200,
                review_kind: 0,
            }],
        }
    }

    #[test]
    fn import_normalises_deck_names_and_creates_missing_parents() {
        // SUB1 F6: `Spanish:: Verbs ` lands in `Spanish::Verbs`; the package
        // has no `Spanish` deck row, so the parent is created and linked.
        let storage = SqliteStorage::open_in_memory().unwrap();
        let mut model = sample_model();
        model.decks = vec![deck(1, "Default"), deck(3, "Spanish:: Verbs ")];
        storage.import(&model, 1_000).unwrap();
        let verbs = storage
            .deck_by_name("Spanish::Verbs")
            .unwrap()
            .expect("normalised name");
        let spanish = storage.deck_by_name("Spanish").unwrap().unwrap();
        assert_eq!(verbs.parent_id, Some(spanish.id));
        assert!(storage.deck_by_name("Spanish:: Verbs ").unwrap().is_none());
    }

    #[test]
    fn imports_links_parents_and_is_idempotent() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let model = sample_model();

        let first = storage.import(&model, 1_000).unwrap();
        assert_eq!(
            first.decks_added, 2,
            "Default is seeded; Spanish + Spanish::Verbs are new"
        );
        assert_eq!(first.notetypes_added, 1);
        assert_eq!(first.notes_added, 1);
        assert_eq!(first.cards_added, 1);
        assert_eq!(first.revlog_added, 1);

        let verbs = storage.deck_by_name("Spanish::Verbs").unwrap().unwrap();
        let spanish = storage.deck_by_name("Spanish").unwrap().unwrap();
        assert_eq!(
            verbs.parent_id,
            Some(spanish.id),
            "sub-deck links to its parent"
        );

        // Re-importing the same package adds or updates nothing (A1-02: equal mod skips).
        let second = storage.import(&model, 1_000).unwrap();
        assert_eq!(second.notes_added, 0);
        assert_eq!(second.cards_added, 0);
        assert_eq!(second.revlog_added, 0);
        assert_eq!(second.decks_added, 0);
        assert_eq!(second.notes_updated, 0);
    }

    /// A freshly created collection auto-seeds stock note types (including a
    /// "Basic" placeholder with no notes yet). Importing a package that also
    /// defines "Basic" must replace that unused placeholder's fields,
    /// templates and CSS with the imported ones — not silently keep the
    /// stock shape, which would make imported decks render with the wrong
    /// templates.
    #[test]
    fn import_overwrites_unused_stock_notetype_of_same_name() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(1_000).unwrap();

        let stock_id: i64 = storage
            .lock()
            .query_row("SELECT id FROM notetypes WHERE name = 'Basic'", [], |r| {
                r.get(0)
            })
            .unwrap();
        let stock_afmt: String = storage
            .lock()
            .query_row(
                "SELECT afmt FROM templates WHERE notetype_id = ?1",
                [stock_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(stock_afmt.contains("hr id"), "stock Basic seeded first");

        let model = sample_model();
        let summary = storage.import(&model, 1_000).unwrap();
        assert_eq!(summary.notes_added, 1);

        let (afmt, css): (String, String) = storage
            .lock()
            .query_row(
                "SELECT t.afmt, coalesce(json_extract(n.config, '$.css'), '')
                 FROM templates t JOIN notetypes n ON n.id = t.notetype_id
                 WHERE n.name = 'Basic'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            afmt, "{{FrontSide}}<hr>{{Back}}",
            "uses the imported template"
        );
        assert!(
            css.is_empty(),
            "uses the imported (empty) CSS, not the stock default"
        );
    }

    /// Two notes sharing a guid within the *same* import batch: the later one
    /// (by `mod_ms`) should update the row created by the earlier one, not be
    /// treated as a separate insert. This pins down the semantics of the
    /// bulk-preload existence check, which (unlike a per-row `SELECT`) must be
    /// kept up to date as rows are inserted within the loop.
    #[test]
    fn duplicate_guid_within_one_batch_updates_in_place() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let mut model = sample_model();
        model.notes = vec![
            Note {
                id: 100,
                guid: "dup".into(),
                notetype_id: 10,
                mod_ms: 1,
                usn: -1,
                tags: vec![],
                fields: vec!["first".into(), "one".into()],
                sort_field: Some("first".into()),
                checksum: Some(1),
            },
            Note {
                id: 101,
                guid: "dup".into(),
                notetype_id: 10,
                mod_ms: 2,
                usn: -1,
                tags: vec![],
                fields: vec!["second".into(), "two".into()],
                sort_field: Some("second".into()),
                checksum: Some(2),
            },
        ];
        model.cards = vec![];
        model.revlog = vec![];

        let summary = storage.import(&model, 1_000).unwrap();
        assert_eq!(
            summary.notes_added, 1,
            "second note updates the first's row"
        );
        assert_eq!(summary.notes_updated, 1);

        let note = storage.note_detail(1).unwrap().unwrap();
        assert_eq!(note.fields[0].value, "second", "later mod_ms wins");
    }

    #[test]
    fn import_replaces_queue_3_with_queue_1_and_converts_due_days_to_ms() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(1_700_000_000_000).unwrap();
        let mut model = sample_model();
        model.cards = vec![Card {
            id: 201,
            note_id: 100,
            deck_id: 1,
            ord: 0,
            mod_ms: 1000,
            usn: -1,
            ctype: 1,
            queue: 3, // Anki day-learn
            due: 50,  // day number 50
            interval: 1,
            ease_factor: 2500,
            reps: 1,
            lapses: 0,
            remaining: 0,
            original_due: 0,
            original_deck_id: 0,
            flags: 0,
            fsrs_stability: None,
            fsrs_difficulty: None,
            fsrs_last_review: None,
            data: None,
        }];

        storage.import(&model, 1_000).unwrap();

        let (queue, due): (i64, i64) = storage
            .lock()
            .query_row("SELECT queue, due FROM cards WHERE ord = 0", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();

        assert_eq!(queue, 1, "queue 3 must be converted to learning queue 1");
        let created: i64 = storage
            .lock()
            .query_row("SELECT created FROM collection WHERE id = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        let expected_due = crate::cards::day_to_start_ms(50, created, 4, 0);
        assert_eq!(due, expected_due);
        assert!(due > 1_000_000_000);
    }

    #[test]
    fn import_shifts_review_suspended_odue_and_fsrs_last_review_in_tz() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        // Created 2026-11-14 04:30 +03:00 (01:30 UTC) — day 20771 in UTC+3 rollover 4
        let target_created = 1_794_619_800_000i64;
        storage.ensure_collection(target_created).unwrap();

        // Source collection created 2020-01-01 04:00 +03:00 (01:00 UTC) — day 18262 in UTC+3 rollover 4
        let source_created = 1_577_840_400_000i64;
        let mut model = sample_model();
        model.created_ms = Some(source_created);
        model.decks.push(deck(20, "Filtered"));
        model.cards = vec![
            // Suspended review card due on 2026-11-14 (Anki day 2509), FSRS last reviewed 2026-11-10 (day 2505)
            Card {
                id: 301,
                note_id: 100,
                deck_id: 3,
                ord: 0,
                mod_ms: 1000,
                usn: -1,
                ctype: 2,
                queue: -1,
                due: 2509,
                interval: 4,
                ease_factor: 2500,
                reps: 3,
                lapses: 0,
                remaining: 0,
                original_due: 2509,
                original_deck_id: 2, // Spanish
                flags: 0,
                fsrs_stability: Some(5.0),
                fsrs_difficulty: Some(4.0),
                fsrs_last_review: Some(2505),
                data: None,
            },
            // Suspended learning card with epoch seconds due
            Card {
                id: 302,
                note_id: 100,
                deck_id: 3,
                ord: 1,
                mod_ms: 1000,
                usn: -1,
                ctype: 1,
                queue: -1,
                due: 1_794_726_000, // seconds
                interval: 0,
                ease_factor: 0,
                reps: 1,
                lapses: 0,
                remaining: 1,
                original_due: 0,
                original_deck_id: 0,
                flags: 0,
                fsrs_stability: None,
                fsrs_difficulty: None,
                fsrs_last_review: None,
                data: None,
            },
        ];

        storage
            .import_with_tz(&model, 180, 1_000, &mut |_, _| {})
            .unwrap();

        let (due0, odue0, odid0, last_rev0): (i64, i64, i64, Option<i64>) = storage
            .lock()
            .query_row(
                "SELECT due, original_due, original_deck_id, fsrs_last_review FROM cards WHERE ord = 0",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(due0, 0);
        assert_eq!(odue0, 0);
        assert_ne!(odid0, 0);
        assert_eq!(last_rev0, Some(-4));

        let due1: i64 = storage
            .lock()
            .query_row("SELECT due FROM cards WHERE ord = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(due1, 1_794_726_000_000);
    }

    #[test]
    fn import_registers_tags_on_insert_and_update() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(1_700_000_000_000).unwrap();

        let mut model = sample_model();
        // Second note with multiple / hierarchical tags and a non-zero source id.
        let mut second = model.notes[0].clone();
        second.id = 200;
        second.guid = "g2".into();
        second.tags = vec!["verb".into(), "grammar::tense".into()];
        second.fields = vec!["comer".into(), "to eat".into()];
        second.sort_field = Some("comer".into());
        second.checksum = Some(456);
        model.notes.push(second);

        storage.import(&model, 1_000).unwrap();

        // Confirm note ids were remapped on import and tags exist in the registry.
        let g2_id: i64 = storage
            .lock()
            .query_row("SELECT id FROM notes WHERE guid = 'g2'", [], |r| r.get(0))
            .unwrap();
        assert_ne!(g2_id, 200, "import remaps source note ids");

        assert_eq!(
            storage.list_tags().unwrap(),
            vec![
                "grammar::tense".to_string(),
                "spanish".to_string(),
                "verb".to_string()
            ],
            "imported tags must be registered in tags table"
        );

        // Update path (higher mod_ms than stored local mod 1_000) with a new tag must also register it.
        model.notes[0].mod_ms = 2_000;
        model.notes[0].tags.push("updated-tag".into());
        storage.import(&model, 2_000).unwrap();

        assert_eq!(
            storage.list_tags().unwrap(),
            vec![
                "grammar::tense".to_string(),
                "spanish".to_string(),
                "updated-tag".to_string(),
                "verb".to_string()
            ]
        );
    }

    #[test]
    fn import_creates_missing_parent_decks_recursively_and_links_them() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let mut model = sample_model();
        model.decks = vec![deck(10, "Book::Part I"), deck(20, "A::B::C")];
        model.cards[0].deck_id = 10;
        let mut card2 = model.cards[0].clone();
        card2.id = 1001;
        card2.deck_id = 20;
        card2.ord = 1;
        model.cards.push(card2);

        let _summary = storage.import(&model, 1_000).unwrap();

        // 1. "Book" parent deck must be created
        let book = storage
            .deck_by_name("Book")
            .unwrap()
            .expect("Book deck should be created");
        let part_1 = storage
            .deck_by_name("Book::Part I")
            .unwrap()
            .expect("Book::Part I should exist");
        assert_eq!(
            part_1.parent_id,
            Some(book.id),
            "Book::Part I must link to Book"
        );

        // 2. Deeper paths: A and A::B must be created for A::B::C
        let a = storage
            .deck_by_name("A")
            .unwrap()
            .expect("A deck should be created");
        let ab = storage
            .deck_by_name("A::B")
            .unwrap()
            .expect("A::B deck should be created");
        let abc = storage
            .deck_by_name("A::B::C")
            .unwrap()
            .expect("A::B::C should exist");
        assert_eq!(a.parent_id, None, "A is top-level");
        assert_eq!(ab.parent_id, Some(a.id), "A::B links to A");
        assert_eq!(abc.parent_id, Some(ab.id), "A::B::C links to A::B");

        // 3. New rows must have usn = -1 and a valid mod
        let (book_mod, book_usn): (i64, i64) = storage
            .lock()
            .query_row(
                r#"SELECT "mod", usn FROM decks WHERE id = ?1"#,
                [book.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(book_usn, -1, "new deck must have usn = -1");
        assert!(book_mod > 0, "new deck must have mod > 0");

        // 4. Idempotent re-import: existing parents are reused, decks_added = 0
        let second = storage.import(&model, 1_000).unwrap();
        assert_eq!(second.decks_added, 0, "re-importing should add 0 decks");
    }

    #[test]
    fn a2_02_import_disambiguates_colliding_notetype_and_recomputes_checksum() {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_000).unwrap();
        let existing_nt = s.create_notetype("CustomColliding", 0, 1_000).unwrap();
        s.add_note_with_cards(
            existing_nt,
            1,
            &["LocalQ".into(), "LocalA".into()],
            &[],
            1_000,
        )
        .unwrap();

        let mut pkg = sample_model();
        pkg.notetypes[0].id = 9999;
        pkg.notetypes[0].name = "CustomColliding".into();
        pkg.fields.push(Field {
            notetype_id: 9999,
            ord: 2,
            name: "Extra".into(),
            config_json: "{}".into(),
        });
        pkg.notes[0].id = 8888;
        pkg.notes[0].guid = "pkg_3field_guid".into();
        pkg.notes[0].notetype_id = 9999;
        pkg.notes[0].fields = vec!["PkgQ".into(), "PkgA".into(), "PkgExtra".into()];
        pkg.notes[0].checksum = Some(999_999_999); // stale checksum
        pkg.cards[0].note_id = 8888;

        s.import(&pkg, 2_000).unwrap();
        let (assigned_nt, assigned_name, stored_csum): (i64, String, i64) = s
            .lock()
            .query_row(
                "SELECT n.notetype_id, nt.name, n.checksum
                 FROM notes n JOIN notetypes nt ON nt.id = n.notetype_id
                 WHERE n.guid = 'pkg_3field_guid'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_ne!(
            assigned_nt, existing_nt,
            "3-field imported 'CustomColliding' note must not be forced into existing 2-field notetype"
        );
        assert!(
            assigned_name.starts_with("CustomColliding-"),
            "colliding notetype must be disambiguated with hash suffix, got {assigned_name:?}"
        );
        assert_eq!(
            stored_csum,
            crate::browse::field_checksum("PkgQ"),
            "import must recompute note checksum from field 0"
        );

        // Re-importing the same colliding package must reuse the disambiguated notetype.
        let second = s.import(&pkg, 3_000).unwrap();
        assert_eq!(second.notetypes_added, 0);
    }

    #[test]
    fn a1_02_reimport_preserves_newer_local_note_and_remaps_deck_config() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(1_000).unwrap();

        let mut model = sample_model();
        model.deck_configs = vec![DeckConfig {
            id: 1,
            name: "ImportedConfig".into(),
            mod_ms: 1_000,
            usn: -1,
            config_json: r#"{"new":{"perDay":99}}"#.into(),
        }];
        storage.import(&model, 1_000).unwrap();

        // Imported config with id=1 collides with default deck_config id=1 -> remapped, not dropped.
        let spanish_id: i64 = storage
            .lock()
            .query_row("SELECT id FROM decks WHERE name = 'Spanish'", [], |r| {
                r.get(0)
            })
            .unwrap();
        let (new_limit, _) = storage
            .deck_limits(storage.deck_by_id(spanish_id).unwrap().unwrap().config_id)
            .unwrap();
        assert_eq!(
            new_limit, 99,
            "imported deck config new.perDay=99 must be remapped instead of dropped"
        );
        // Local Default deck config id=1 must remain untouched at 20.
        assert_eq!(storage.deck_limits(1).unwrap().0, 20);

        // Simulate a newer local edit on the imported note (`mod` = 9_999_999 > model's mod_ms=0).
        storage
            .lock()
            .execute(
                r#"UPDATE notes SET fields = ?, "mod" = 9999999 WHERE guid = ?"#,
                rusqlite::params!["Edited Locally\u{1f}back", &model.notes[0].guid],
            )
            .unwrap();

        // Re-importing the older package must preserve the newer local edit.
        let reimport = storage.import(&model, 2_000).unwrap();
        assert_eq!(reimport.notes_updated, 0);
        let fields_after: String = storage
            .lock()
            .query_row(
                "SELECT fields FROM notes WHERE guid = ?1",
                [&model.notes[0].guid],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            fields_after.starts_with("Edited Locally"),
            "older re-import overwrote newer local edit: got {fields_after:?}"
        );
    }

    #[test]
    fn a3_06_import_apkg_revlog_invalidates_xp_cache_and_runs_backfill() {
        use bibalak_core::ports::TestClock;
        use bibalak_core::Collection;
        use std::sync::Arc;

        let base_ms = 1_794_830_400_000_i64;
        let storage = SqliteStorage::open_in_memory().unwrap();
        let clock = Arc::new(TestClock::new(base_ms));
        let c = Collection::new(Box::new(storage), clock).unwrap();

        // Populate initial Game & GameDepth caches on an empty collection.
        assert_eq!(c.get_game_state().unwrap().total_xp, 0);
        assert!(!c
            .get_game_depth_state()
            .unwrap()
            .achievements
            .iter()
            .any(|a| a.unlocked));

        let mut model = sample_model();
        model.created_ms = Some(base_ms - 10 * 86_400_000);
        model.decks = vec![deck(2, "Imported")];
        model.cards[0].deck_id = 2;
        model.revlog = (0..60)
            .map(|i| Revlog {
                id: base_ms - (60 - i) * 60_000,
                card_id: 1000,
                usn: -1,
                ease: 3,
                interval: i + 1,
                last_interval: i,
                ease_factor: 2500,
                taken_ms: 4_000,
                review_kind: 1,
            })
            .collect();

        c.import(&model).unwrap();

        let depth = c.get_game_depth_state().unwrap();
        let reviews_50 = depth
            .achievements
            .iter()
            .find(|a| a.achievement_key == "ach:reviews_50")
            .unwrap();
        assert!(
            reviews_50.unlocked,
            "importing 60 revlogs must unlock ach:reviews_50 via backfill"
        );
    }
}
