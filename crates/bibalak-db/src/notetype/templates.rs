use bibalak_core::error::{CoreError, CoreResult};
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use super::{bump_schema_mod, err};

pub fn template_uses_field(template_str: &str, field_name: &str) -> bool {
    let re = regex::Regex::new(r"\{\{([^{}]+)\}\}").unwrap();
    for caps in re.captures_iter(template_str) {
        let inner = caps[1].trim();
        let target = if let Some(stripped) = inner.strip_prefix('#') {
            stripped
        } else if let Some(stripped) = inner.strip_prefix('^') {
            stripped
        } else if let Some(stripped) = inner.strip_prefix('/') {
            stripped
        } else {
            inner
        };

        let field = if let Some(colon) = target.rfind(':') {
            target[colon + 1..].trim()
        } else {
            target.trim()
        };

        if field.to_lowercase() == field_name.to_lowercase() {
            return true;
        }
    }
    false
}

pub fn rewrite_template_field(template_str: &str, old_name: &str, new_name: &str) -> String {
    let re = regex::Regex::new(r"\{\{([^{}]+)\}\}").unwrap();
    let old_lower = old_name.to_lowercase();
    re.replace_all(template_str, |caps: &regex::Captures<'_>| {
        let full = &caps[0];
        let inner = &caps[1];
        let trimmed = inner.trim();
        let (prefix_char, rest) = if let Some(stripped) = trimmed.strip_prefix('#') {
            ("#", stripped)
        } else if let Some(stripped) = trimmed.strip_prefix('^') {
            ("^", stripped)
        } else if let Some(stripped) = trimmed.strip_prefix('/') {
            ("/", stripped)
        } else {
            ("", trimmed)
        };

        if let Some(colon_idx) = rest.rfind(':') {
            let filters = &rest[..=colon_idx];
            let target_field = rest[colon_idx + 1..].trim();
            if target_field.to_lowercase() == old_lower {
                let leading_ws = &inner[..inner.len() - inner.trim_start().len()];
                let trailing_ws = &inner[inner.trim_end().len()..];
                return format!(
                    "{{{{{leading_ws}{prefix_char}{filters}{new_name}{trailing_ws}}}}}"
                );
            }
        } else if rest.trim().to_lowercase() == old_lower {
            let leading_ws = &inner[..inner.len() - inner.trim_start().len()];
            let trailing_ws = &inner[inner.trim_end().len()..];
            return format!("{{{{{leading_ws}{prefix_char}{new_name}{trailing_ws}}}}}");
        }

        full.to_string()
    })
    .into_owned()
}

pub fn check_template_remove(conn: &Connection, notetype_id: i64, ord: i64) -> CoreResult<u32> {
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM cards WHERE note_id IN (SELECT id FROM notes WHERE notetype_id = ?1) AND ord = ?2",
            params![notetype_id, ord],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok(count as u32)
}

pub fn add_template(
    tx: &Transaction<'_>,
    notetype_id: i64,
    name: &str,
    qfmt: &str,
    afmt: &str,
    now_ms: i64,
) -> CoreResult<()> {
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err(CoreError::Invalid("template name cannot be empty".into()));
    }
    let dup: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM templates WHERE notetype_id = ?1 AND lower(name) = lower(?2))",
            params![notetype_id, clean_name],
            |r| r.get(0),
        )
        .map_err(err)?;
    if dup {
        return Err(CoreError::Invalid(format!(
            "a template named {clean_name:?} already exists"
        )));
    }
    let next_ord: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(ord) + 1, 0) FROM templates WHERE notetype_id = ?1",
            [notetype_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    tx.execute(
        "INSERT INTO templates (notetype_id, ord, name, qfmt, afmt, config) \
         VALUES (?1, ?2, ?3, ?4, ?5, '{}')",
        params![notetype_id, next_ord, clean_name, qfmt, afmt],
    )
    .map_err(err)?;

    // Generate a new card at `next_ord` for every existing note of this notetype,
    // placing it in the same deck as the note's first existing card.
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
        let deck_id: Option<i64> = tx
            .query_row(
                "SELECT deck_id FROM cards WHERE note_id = ?1 LIMIT 1",
                [note_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let Some(deck_id) = deck_id else { continue };

        let next_pos: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(due), 0) + 1 FROM cards WHERE queue = 0",
                [],
                |r| r.get(0),
            )
            .map_err(err)?;
        tx.execute(
            r#"INSERT INTO cards
               (note_id, deck_id, ord, "mod", usn, type, queue, due,
                interval, ease_factor, reps, lapses, remaining,
                original_due, original_deck_id, flags)
               VALUES (?1, ?2, ?3, ?4, -1, 0, 0, ?5, 0, 0, 0, 0, 0, 0, 0, 0)"#,
            params![note_id, deck_id, next_ord, now_ms, next_pos],
        )
        .map_err(err)?;
    }

    bump_schema_mod(tx, now_ms)?;
    Ok(())
}

pub fn remove_template(
    tx: &Transaction<'_>,
    notetype_id: i64,
    ord: i64,
    now_ms: i64,
) -> CoreResult<()> {
    let tmpl_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM templates WHERE notetype_id = ?1",
            [notetype_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if tmpl_count <= 1 {
        return Err(CoreError::Invalid("cannot remove the last template".into()));
    }

    // Delete cards for this template ord across all notes of the notetype.
    tx.execute(
        "DELETE FROM cards WHERE ord = ?1 \
         AND note_id IN (SELECT id FROM notes WHERE notetype_id = ?2)",
        params![ord, notetype_id],
    )
    .map_err(err)?;
    // Shift card ords above the removed ord down by 1.
    tx.execute(
        "UPDATE cards SET ord = ord - 1 WHERE ord > ?1 \
         AND note_id IN (SELECT id FROM notes WHERE notetype_id = ?2)",
        params![ord, notetype_id],
    )
    .map_err(err)?;

    tx.execute(
        "DELETE FROM templates WHERE notetype_id = ?1 AND ord = ?2",
        params![notetype_id, ord],
    )
    .map_err(err)?;
    tx.execute(
        "UPDATE templates SET ord = ord - 1 WHERE notetype_id = ?1 AND ord > ?2",
        params![notetype_id, ord],
    )
    .map_err(err)?;

    bump_schema_mod(tx, now_ms)?;
    Ok(())
}

pub fn save_template(
    conn: &Connection,
    notetype_id: i64,
    ord: i64,
    name: &str,
    qfmt: &str,
    afmt: &str,
    now_ms: i64,
) -> CoreResult<()> {
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err(CoreError::Invalid("template name cannot be empty".into()));
    }
    conn.execute_batch("SAVEPOINT save_template_tx")
        .map_err(err)?;
    let res = (|| -> CoreResult<()> {
        let existing: Option<(String, String)> = conn
            .query_row(
                "SELECT qfmt, afmt FROM templates WHERE notetype_id = ?1 AND ord = ?2",
                params![notetype_id, ord],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        let Some((old_qfmt, old_afmt)) = existing else {
            return Err(CoreError::NotFound(format!(
                "template {ord} in notetype {notetype_id}"
            )));
        };
        let dup: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM templates WHERE notetype_id = ?1 AND lower(name) = lower(?2) AND ord != ?3)",
                params![notetype_id, clean_name, ord],
                |r| r.get(0),
            )
            .map_err(err)?;
        if dup {
            return Err(CoreError::Invalid(format!(
                "a template named {clean_name:?} already exists"
            )));
        }

        conn.execute(
            "UPDATE templates SET name = ?1, qfmt = ?2, afmt = ?3 \
             WHERE notetype_id = ?4 AND ord = ?5",
            params![clean_name, qfmt, afmt, notetype_id, ord],
        )
        .map_err(err)?;

        if qfmt != old_qfmt || afmt != old_afmt {
            let cfg: String = conn
                .query_row(
                    "SELECT config FROM notetypes WHERE id = ?1",
                    [notetype_id],
                    |r| r.get(0),
                )
                .map_err(err)?;
            let updated_cfg =
                bibalak_core::notetype_preset::set_keepsake_preset_in_config(&cfg, None)?;
            conn.execute(
                r#"UPDATE notetypes SET config = ?1, "mod" = ?2, usn = -1 WHERE id = ?3"#,
                params![updated_cfg, now_ms, notetype_id],
            )
            .map_err(err)?;
        } else {
            conn.execute(
                r#"UPDATE notetypes SET "mod" = ?1, usn = -1 WHERE id = ?2"#,
                params![now_ms, notetype_id],
            )
            .map_err(err)?;
        }
        Ok(())
    })();
    match res {
        Ok(()) => conn
            .execute_batch("RELEASE SAVEPOINT save_template_tx")
            .map_err(err),
        Err(e) => {
            let _ = conn.execute_batch(
                "ROLLBACK TO SAVEPOINT save_template_tx; RELEASE SAVEPOINT save_template_tx;",
            );
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::{setup, Setup};
    use crate::storage::SqliteStorage;
    use bibalak_core::ports::*;

    fn card_count(s: &SqliteStorage) -> i64 {
        s.lock()
            .query_row("SELECT COUNT(*) FROM cards", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn add_template_generates_new_cards() {
        let Setup { s, nt_id, .. } = setup();
        let before = card_count(&s);
        s.add_template(nt_id, "Card 2", "{{Back}}", "{{Front}}", 1_000)
            .unwrap();
        assert_eq!(card_count(&s), before + 1);

        let detail = s.get_notetype_detail(nt_id).unwrap().unwrap();
        assert_eq!(detail.templates.len(), 2);
    }

    #[test]
    fn remove_template_deletes_cards_and_shifts_ords() {
        let Setup { s, nt_id, .. } = setup();
        s.add_template(nt_id, "Card 2", "{{Back}}", "{{Front}}", 1_000)
            .unwrap();
        assert_eq!(card_count(&s), 2);

        s.remove_template(nt_id, 0, 2_000).unwrap(); // remove Card 1
        let detail = s.get_notetype_detail(nt_id).unwrap().unwrap();
        assert_eq!(detail.templates.len(), 1);
        assert_eq!(detail.templates[0].ord, 0); // shifted from 1 to 0

        assert_eq!(card_count(&s), 1);
    }

    #[test]
    fn remove_last_template_is_rejected() {
        let Setup { s, nt_id, .. } = setup();
        assert!(s.remove_template(nt_id, 0, 1_000).is_err());
    }

    #[test]
    fn save_template_updates_formats() {
        let Setup { s, nt_id, .. } = setup();
        s.save_template(nt_id, 0, "Updated", "{{Back}}", "{{Front}}", 1_000)
            .unwrap();
        let detail = s.get_notetype_detail(nt_id).unwrap().unwrap();
        assert_eq!(detail.templates[0].name, "Updated");
        assert_eq!(detail.templates[0].qfmt, "{{Back}}");
        assert_eq!(detail.templates[0].afmt, "{{Front}}");
    }

    #[test]
    fn save_template_rejects_empty_and_duplicate_names_and_clears_preset() {
        let Setup { s, nt_id, .. } = setup();
        assert!(s
            .save_template(nt_id, 0, "   ", "{{Front}}", "{{Back}}", 1_000)
            .is_err());
        s.add_template(nt_id, "Card 2", "{{Back}}", "{{Front}}", 1_000)
            .unwrap();
        assert!(s
            .save_template(nt_id, 0, "card 2", "{{Front}}", "{{Back}}", 1_500)
            .is_err());
        assert!(s
            .add_template(nt_id, "Card 1", "{{Front}}", "{{Back}}", 1_500)
            .is_err());
        assert!(s
            .add_template(nt_id, "  ", "{{Front}}", "{{Back}}", 1_500)
            .is_err());
    }
}
