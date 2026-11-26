//! Card lifecycle operations: suspend/bury/flag, sibling bury, leech tagging.

use std::collections::{HashMap, HashSet};

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::model::Card;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

pub const MS_PER_DAY: i64 = 86_400_000;
pub const DEFAULT_ROLLOVER_HOUR: u8 = 4;

/// Convert a day number (days since collection creation) to the start instant of that day in ms (UTC),
/// aligned to the configured local rollover hour.
pub fn day_to_start_ms(
    due_day: i64,
    created_ms: i64,
    rollover_hour: u8,
    tz_offset_minutes: i32,
) -> i64 {
    let tz_off_ms = i64::from(tz_offset_minutes) * 60_000;
    let rollover_ms = i64::from(rollover_hour) * 3_600_000;
    let created_epoch_day = (created_ms + tz_off_ms - rollover_ms).div_euclid(MS_PER_DAY);
    let target_epoch_day = created_epoch_day + due_day;
    target_epoch_day * MS_PER_DAY + rollover_ms - tz_off_ms
}

/// Collection-config flag set once the legacy queue-3 repair has run.
const QUEUE3_REPAIRED_KEY: &str = "queue3Repaired";

/// Repair cards stuck in Anki queue 3 (day-learn).
/// Moves them to queue 1 (learning), and converts their day-number due to start-of-day ms.
/// Runs once per collection: it scans every card, and nothing creates queue 3
/// cards any more (import converts them, unbury/unsuspend restore queue 1).
pub fn repair_queue_3(conn: &Connection) -> CoreResult<()> {
    let collection_info: Option<(i64, String)> = conn
        .query_row(
            "SELECT created, config FROM collection WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;

    let Some((created_ms, config_json)) = collection_info else {
        return Ok(());
    };
    let mut config: serde_json::Value = serde_json::from_str(&config_json).unwrap_or_default();
    if config[QUEUE3_REPAIRED_KEY].as_bool() == Some(true) {
        return Ok(());
    }
    let (created_ms, rollover_hour) = {
        let v = &config;
        let created = created_ms;
        let hour = v["rolloverHour"]
            .as_u64()
            .map(|h| h.min(23) as u8)
            .unwrap_or(DEFAULT_ROLLOVER_HOUR);
        (created, hour)
    };

    let mut stmt = conn
        .prepare("SELECT id, due FROM cards WHERE queue = 3")
        .map_err(err)?;
    let rows: Vec<(i64, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;

    let mut update_stmt = conn
        .prepare("UPDATE cards SET queue = 1, due = ?1 WHERE id = ?2")
        .map_err(err)?;
    for (card_id, due) in rows {
        let due_ms = if due < 1_000_000 {
            day_to_start_ms(due, created_ms, rollover_hour, 0)
        } else {
            due
        };
        update_stmt.execute(params![due_ms, card_id]).map_err(err)?;
    }
    config[QUEUE3_REPAIRED_KEY] = serde_json::Value::Bool(true);
    conn.execute(
        "UPDATE collection SET config = ?1 WHERE id = 1",
        params![config.to_string()],
    )
    .map_err(err)?;
    Ok(())
}

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

/// Execute a `queue` update on a JSON list of card ids.
pub fn suspend_cards(conn: &Connection, card_ids: &[i64], now_ms: i64) -> CoreResult<()> {
    if card_ids.is_empty() {
        return Ok(());
    }
    let json = serde_json::to_string(card_ids).map_err(err)?;
    conn.execute(
        r#"UPDATE cards SET queue = -1, "mod" = ?1, usn = -1 WHERE id IN (SELECT value FROM json_each(?2))"#,
        params![now_ms, json],
    )
    .map_err(err)?;
    Ok(())
}

pub fn unsuspend_cards(conn: &Connection, card_ids: &[i64], now_ms: i64) -> CoreResult<()> {
    if card_ids.is_empty() {
        return Ok(());
    }
    let json = serde_json::to_string(card_ids).map_err(err)?;
    // Restore each card to its natural queue (type column mirrors queue for non-buried states,
    // except relearning cards where type=3 maps to queue=1).
    conn.execute(
        r#"UPDATE cards SET queue = CASE WHEN type = 3 THEN 1 ELSE type END, "mod" = ?1, usn = -1 WHERE id IN (SELECT value FROM json_each(?2)) AND queue = -1"#,
        params![now_ms, json],
    )
    .map_err(err)?;
    Ok(())
}

/// Manually bury cards (queue = -2).
pub fn bury_cards(conn: &Connection, card_ids: &[i64], now_ms: i64) -> CoreResult<()> {
    if card_ids.is_empty() {
        return Ok(());
    }
    let json = serde_json::to_string(card_ids).map_err(err)?;
    conn.execute(
        r#"UPDATE cards SET queue = -2, "mod" = ?1, usn = -1 WHERE id IN (SELECT value FROM json_each(?2))"#,
        params![now_ms, json],
    )
    .map_err(err)?;
    Ok(())
}

/// Unbury specific buried cards (manual -2 and sibling -3).
pub fn unbury_cards(conn: &Connection, card_ids: &[i64], now_ms: i64) -> CoreResult<()> {
    if card_ids.is_empty() {
        return Ok(());
    }
    let json = serde_json::to_string(card_ids).map_err(err)?;
    conn.execute(
        r#"UPDATE cards SET queue = CASE WHEN type = 3 THEN 1 ELSE type END, "mod" = ?1, usn = -1 WHERE id IN (SELECT value FROM json_each(?2)) AND queue IN (-2, -3)"#,
        params![now_ms, json],
    )
    .map_err(err)?;
    Ok(())
}

/// Sibling bury: when a note's card is answered, bury all other new/review
/// cards of that note so they won't appear in the same session (queue = -3).
/// Returns the IDs of siblings that were newly buried.
pub fn bury_siblings(
    conn: &Connection,
    note_id: i64,
    answered_card_id: i64,
    now_ms: i64,
) -> CoreResult<Vec<i64>> {
    let mut stmt = conn
        .prepare("SELECT id FROM cards WHERE note_id = ?1 AND id != ?2 AND queue IN (0, 2)")
        .map_err(err)?;
    let ids: Vec<i64> = stmt
        .query_map(params![note_id, answered_card_id], |r| r.get(0))
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;

    if !ids.is_empty() {
        let json = serde_json::to_string(&ids).map_err(err)?;
        conn.execute(
            r#"UPDATE cards SET queue = -3, "mod" = ?1, usn = -1 WHERE id IN (SELECT value FROM json_each(?2))"#,
            params![now_ms, json],
        )
        .map_err(err)?;
    }
    Ok(ids)
}

/// Unbury all buried cards in `deck_id` (both manual -2 and sibling -3).
/// Called at the start of each study session so the day cutoff is respected.
pub fn unbury_deck(conn: &Connection, deck_id: i64, now_ms: i64) -> CoreResult<()> {
    conn.execute(
        r#"UPDATE cards SET queue = CASE WHEN type = 3 THEN 1 ELSE type END, "mod" = ?1, usn = -1 WHERE deck_id = ?2 AND queue IN (-2, -3)"#,
        params![now_ms, deck_id],
    )
    .map_err(err)?;
    Ok(())
}

/// Unbury all buried cards in the entire collection (manual -2 and sibling -3).
pub fn unbury_all(conn: &Connection, now_ms: i64) -> CoreResult<()> {
    conn.execute(
        r#"UPDATE cards SET queue = CASE WHEN type = 3 THEN 1 ELSE type END, "mod" = ?1, usn = -1 WHERE queue IN (-2, -3)"#,
        [now_ms],
    )
    .map_err(err)?;
    Ok(())
}

/// Set the flag (0–7) on a list of cards.
pub fn set_card_flag(conn: &Connection, card_ids: &[i64], flag: u8, now_ms: i64) -> CoreResult<()> {
    if card_ids.is_empty() {
        return Ok(());
    }
    let json = serde_json::to_string(card_ids).map_err(err)?;
    conn.execute(
        r#"UPDATE cards SET flags = ?1, "mod" = ?2, usn = -1 WHERE id IN (SELECT value FROM json_each(?3))"#,
        params![flag as i64, now_ms, json],
    )
    .map_err(err)?;
    Ok(())
}

/// Ensure the `leech` tag is present on a note (idempotent).
pub fn add_note_tag(conn: &Connection, note_id: i64, tag: &str, now_ms: i64) -> CoreResult<()> {
    let current: String = conn
        .query_row("SELECT tags FROM notes WHERE id = ?1", [note_id], |r| {
            r.get(0)
        })
        .map_err(err)?;
    // Tags blob: ` tag1 tag2 ` (space-padded). Check inclusion before writing.
    let needle = format!(" {tag} ");
    if current.contains(&needle) {
        return Ok(());
    }
    let new_tags = if current.trim().is_empty() {
        format!(" {tag} ")
    } else {
        format!("{} ", current.trim_end()) + &format!("{tag} ")
    };
    conn.execute(
        r#"UPDATE notes SET tags = ?2, "mod" = ?3, usn = -1 WHERE id = ?1"#,
        params![note_id, new_tags, now_ms],
    )
    .map_err(err)?;
    Ok(())
}

pub(crate) const CARD_SNAPSHOT_COLS: &str = r#"id, note_id, deck_id, ord, "mod", usn, type, queue, due,
    interval, ease_factor, reps, lapses, remaining, original_due, original_deck_id,
    flags, fsrs_stability, fsrs_difficulty, fsrs_last_review, data"#;

pub(crate) fn row_to_card(r: &Row<'_>) -> rusqlite::Result<Card> {
    Ok(Card {
        id: r.get(0)?,
        note_id: r.get(1)?,
        deck_id: r.get(2)?,
        ord: r.get(3)?,
        mod_ms: r.get(4)?,
        usn: r.get(5)?,
        ctype: r.get(6)?,
        queue: r.get(7)?,
        due: r.get(8)?,
        interval: r.get(9)?,
        ease_factor: r.get(10)?,
        reps: r.get(11)?,
        lapses: r.get(12)?,
        remaining: r.get(13)?,
        original_due: r.get(14)?,
        original_deck_id: r.get(15)?,
        flags: r.get(16)?,
        fsrs_stability: r.get(17)?,
        fsrs_difficulty: r.get(18)?,
        fsrs_last_review: r.get(19)?,
        data: r.get(20)?,
    })
}

fn dedup_preserve_order(ids: &[i64]) -> Vec<i64> {
    let mut seen = HashSet::with_capacity(ids.len());
    ids.iter().copied().filter(|id| seen.insert(*id)).collect()
}

fn fetch_cards_by_ids(tx: &Transaction<'_>, card_ids: &[i64]) -> CoreResult<Vec<Card>> {
    let unique = dedup_preserve_order(card_ids);
    if unique.is_empty() {
        return Ok(vec![]);
    }
    let json = serde_json::to_string(&unique).map_err(err)?;
    let sql = format!(
        "SELECT {CARD_SNAPSHOT_COLS} FROM cards WHERE id IN (SELECT value FROM json_each(?1))"
    );
    let mut stmt = tx.prepare(&sql).map_err(err)?;
    let mut by_id: HashMap<i64, Card> = stmt
        .query_map([json], row_to_card)
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?
        .into_iter()
        .map(|c| (c.id, c))
        .collect();
    Ok(unique
        .into_iter()
        .filter_map(|id| by_id.remove(&id))
        .collect())
}

/// Return all card IDs belonging to `deck_ids`, ordered by `id`.
pub fn deck_card_ids(conn: &Connection, deck_ids: &[i64]) -> CoreResult<Vec<i64>> {
    if deck_ids.is_empty() {
        return Ok(vec![]);
    }
    let json = serde_json::to_string(deck_ids).map_err(err)?;
    let mut stmt = conn
        .prepare(
            "SELECT id FROM cards
             WHERE deck_id IN (SELECT value FROM json_each(?1))
             ORDER BY id",
        )
        .map_err(err)?;
    let ids = stmt
        .query_map([json], |r| r.get::<_, i64>(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(ids)
}

/// Reset selected cards back to `type = 0, queue = 0` after existing new cards.
pub fn forget_cards(
    conn: &mut Connection,
    card_ids: &[i64],
    reset_counts: bool,
    now_ms: i64,
) -> CoreResult<Vec<Card>> {
    if card_ids.is_empty() {
        return Ok(vec![]);
    }
    let tx = conn.transaction().map_err(err)?;
    let snapshots = fetch_cards_by_ids(&tx, card_ids)?;
    if snapshots.is_empty() {
        return Ok(vec![]);
    }
    let next_pos: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(due), 0) + 1 FROM cards WHERE queue = 0",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;

    let mut stmt = tx
        .prepare(
            r#"UPDATE cards SET
                 type = 0, queue = 0, due = ?2, interval = 0, ease_factor = 0,
                 remaining = 0, original_due = 0,
                 reps = ?3, lapses = ?4,
                 fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_last_review = NULL,
                 "mod" = ?5, usn = -1
               WHERE id = ?1"#,
        )
        .map_err(err)?;
    for (idx, card) in snapshots.iter().enumerate() {
        let (reps, lapses) = if reset_counts {
            (0, 0)
        } else {
            (card.reps, card.lapses)
        };
        stmt.execute(params![
            card.id,
            next_pos + idx as i64,
            reps,
            lapses,
            now_ms
        ])
        .map_err(err)?;
    }
    drop(stmt);
    tx.commit().map_err(err)?;
    Ok(snapshots)
}

/// Reschedule cards to `today + offset` where each card picks an offset in `min_days..=max_days`.
/// Existing review cards keep their interval; new and learning cards become reviews.
pub fn set_due_date(
    conn: &mut Connection,
    card_ids: &[i64],
    min_days: u32,
    max_days: u32,
    today: i32,
    now_ms: i64,
) -> CoreResult<Vec<Card>> {
    if min_days > max_days {
        return Err(CoreError::Invalid("min_days exceeds max_days".into()));
    }
    if card_ids.is_empty() {
        return Ok(vec![]);
    }
    let tx = conn.transaction().map_err(err)?;
    let snapshots = fetch_cards_by_ids(&tx, card_ids)?;
    if snapshots.is_empty() {
        return Ok(vec![]);
    }
    let mut rng = fastrand::Rng::new();
    let mut stmt = tx
        .prepare(
            r#"UPDATE cards SET
                 type = 2, queue = ?2, due = ?3, remaining = 0, ease_factor = ?4,
                 interval = ?6, "mod" = ?5, usn = -1
               WHERE id = ?1"#,
        )
        .map_err(err)?;
    for card in &snapshots {
        let offset = if min_days == max_days {
            min_days
        } else {
            rng.u32(min_days..=max_days)
        };
        let target_due = i64::from(today) + i64::from(offset);
        let new_queue = if card.queue == -1 { -1 } else { 2 };
        let new_ease = if card.ctype == 2 || card.ease_factor > 0 {
            card.ease_factor
        } else {
            2500
        };
        // A card that becomes a review needs an interval: Anki uses the days
        // until it is due (at least 1). Existing reviews keep theirs.
        let new_interval = if card.interval > 0 {
            card.interval
        } else {
            i64::from(offset).max(1)
        };
        stmt.execute(params![
            card.id,
            new_queue,
            target_due,
            new_ease,
            now_ms,
            new_interval
        ])
        .map_err(err)?;
    }
    drop(stmt);
    tx.commit().map_err(err)?;
    Ok(snapshots)
}

/// Reposition new cards (`type = 0`) starting at `start` by `step`, optionally shuffled and
/// shifting unselected new cards whose `due >= start`.
pub fn reposition_new_cards(
    conn: &mut Connection,
    card_ids: &[i64],
    start: i64,
    step: i64,
    shuffle: bool,
    shift_existing: bool,
    now_ms: i64,
) -> CoreResult<Vec<Card>> {
    if start < 0 {
        return Err(CoreError::Invalid("start must be non-negative".into()));
    }
    if step < 1 {
        return Err(CoreError::Invalid("step must be at least 1".into()));
    }
    if card_ids.is_empty() {
        return Ok(vec![]);
    }
    let tx = conn.transaction().map_err(err)?;
    let new_cards: Vec<Card> = fetch_cards_by_ids(&tx, card_ids)?
        .into_iter()
        .filter(|c| c.ctype == 0)
        .collect();
    if new_cards.is_empty() {
        return Err(CoreError::Invalid("no new cards selected".into()));
    }

    let mut ordered_ids: Vec<i64> = new_cards.iter().map(|c| c.id).collect();
    let mut snapshots = new_cards;

    if shift_existing {
        let selected_json = serde_json::to_string(&ordered_ids).map_err(err)?;
        let sql = format!(
            "SELECT {CARD_SNAPSHOT_COLS} FROM cards WHERE type = 0 AND due >= ?1 AND id NOT IN (SELECT value FROM json_each(?2))"
        );
        let mut stmt = tx.prepare(&sql).map_err(err)?;
        let shifted: Vec<Card> = stmt
            .query_map(params![start, &selected_json], row_to_card)
            .map_err(err)?
            .collect::<rusqlite::Result<_>>()
            .map_err(err)?;
        drop(stmt);
        snapshots.extend(shifted);

        let shift_by = (ordered_ids.len() as i64) * step;
        tx.execute(
            r#"UPDATE cards SET due = due + ?1, "mod" = ?2, usn = -1
               WHERE type = 0 AND due >= ?3 AND id NOT IN (SELECT value FROM json_each(?4))"#,
            params![shift_by, now_ms, start, &selected_json],
        )
        .map_err(err)?;
    }

    if shuffle {
        fastrand::Rng::new().shuffle(&mut ordered_ids);
    }

    let mut update_stmt = tx
        .prepare(r#"UPDATE cards SET due = ?2, "mod" = ?3, usn = -1 WHERE id = ?1"#)
        .map_err(err)?;
    for (idx, card_id) in ordered_ids.iter().enumerate() {
        update_stmt
            .execute(params![card_id, start + (idx as i64) * step, now_ms])
            .map_err(err)?;
    }
    drop(update_stmt);
    tx.commit().map_err(err)?;
    Ok(snapshots)
}

/// Restore full scheduling columns on snapshotted cards in one transaction (undo).
pub fn restore_cards(conn: &mut Connection, cards: &[Card], now_ms: i64) -> CoreResult<()> {
    if cards.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction().map_err(err)?;
    let mut stmt = tx
        .prepare(
            r#"UPDATE cards SET
                 deck_id = ?2, type = ?3, queue = ?4, due = ?5,
                 interval = ?6, ease_factor = ?7, reps = ?8, lapses = ?9,
                 remaining = ?10, original_due = ?11, original_deck_id = ?12, flags = ?13,
                 fsrs_stability = ?14, fsrs_difficulty = ?15, fsrs_last_review = ?16,
                 "mod" = ?17, usn = -1
               WHERE id = ?1"#,
        )
        .map_err(err)?;
    for c in cards {
        stmt.execute(params![
            c.id,
            c.deck_id,
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
            now_ms,
        ])
        .map_err(err)?;
    }
    drop(stmt);
    tx.commit().map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::storage::SqliteStorage;
    use bibalak_core::ports::*;

    /// The legacy queue-3 repair scans every card, so it runs once per
    /// collection (perf: it cost ~4 ms on every open at 100k cards). Import and
    /// unbury/unsuspend no longer create queue 3 cards.
    #[test]
    fn queue_3_repair_runs_once_per_collection() {
        let (s, _, card_id) = setup();
        let conn = s.lock();
        conn.execute(
            "UPDATE cards SET queue = 3, due = 5 WHERE id = ?1",
            [card_id],
        )
        .unwrap();
        super::repair_queue_3(&conn).unwrap();
        let q: i64 = conn
            .query_row("SELECT queue FROM cards WHERE id = ?1", [card_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(q, 1, "first run repairs");

        conn.execute(
            "UPDATE cards SET queue = 3, due = 5 WHERE id = ?1",
            [card_id],
        )
        .unwrap();
        super::repair_queue_3(&conn).unwrap();
        let q: i64 = conn
            .query_row("SELECT queue FROM cards WHERE id = ?1", [card_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(q, 3, "later runs skip the scan");
    }

    fn setup() -> (SqliteStorage, i64, i64) {
        use bibalak_core::model::*;
        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_700_000_000_000).unwrap();
        s.import(
            &CanonicalModel {
                notetypes: vec![Notetype {
                    id: 1,
                    name: "Basic".into(),
                    kind: 0,
                    mod_ms: 0,
                    usn: -1,
                    config_json: "{}".into(),
                }],
                fields: vec![
                    Field {
                        notetype_id: 1,
                        ord: 0,
                        name: "Front".into(),
                        config_json: "{}".into(),
                    },
                    Field {
                        notetype_id: 1,
                        ord: 1,
                        name: "Back".into(),
                        config_json: "{}".into(),
                    },
                ],
                templates: vec![Template {
                    notetype_id: 1,
                    ord: 0,
                    name: "Card 1".into(),
                    qfmt: "{{Front}}".into(),
                    afmt: "{{Back}}".into(),
                    config_json: "{}".into(),
                }],
                notes: vec![Note {
                    id: 1,
                    guid: "g1".into(),
                    notetype_id: 1,
                    mod_ms: 0,
                    usn: -1,
                    tags: vec![],
                    fields: vec!["A".into(), "B".into()],
                    sort_field: None,
                    checksum: None,
                }],
                cards: vec![Card {
                    id: 1,
                    note_id: 1,
                    deck_id: 1,
                    ord: 0,
                    mod_ms: 0,
                    usn: -1,
                    ctype: 0,
                    queue: 0,
                    due: 1,
                    interval: 0,
                    ease_factor: 0,
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
                ..Default::default()
            },
            1_700_000_000_000,
        )
        .unwrap();
        let nt_id: i64 = s
            .lock()
            .query_row("SELECT id FROM notetypes WHERE name = 'Basic'", [], |r| {
                r.get(0)
            })
            .unwrap();
        let note_id: i64 = s
            .lock()
            .query_row(
                "SELECT id FROM notes WHERE notetype_id = ?1",
                [nt_id],
                |r| r.get(0),
            )
            .unwrap();
        let card_id: i64 = s
            .lock()
            .query_row("SELECT id FROM cards WHERE note_id = ?1", [note_id], |r| {
                r.get(0)
            })
            .unwrap();
        (s, note_id, card_id)
    }

    #[test]
    fn suspend_and_unsuspend() {
        let (s, _, card_id) = setup();
        let q_before: i64 = s
            .lock()
            .query_row("SELECT queue FROM cards WHERE id = ?1", [card_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(q_before, 0);

        s.suspend_cards(&[card_id], 1_000).unwrap();
        let q: i64 = s
            .lock()
            .query_row("SELECT queue FROM cards WHERE id = ?1", [card_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(q, -1);

        // Suspended card is excluded from study queue
        let queue = s
            .study_queue(1, 0, 1_700_000_000_000, 1_700_086_400_000, 20, 200)
            .unwrap();
        assert!(queue.new.is_empty());

        s.unsuspend_cards(&[card_id], 1_000).unwrap();
        let q: i64 = s
            .lock()
            .query_row("SELECT queue FROM cards WHERE id = ?1", [card_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(q, 0); // restored to type

        let queue = s
            .study_queue(1, 0, 1_700_000_000_000, 1_700_086_400_000, 20, 200)
            .unwrap();
        assert_eq!(queue.new.len(), 1);
    }

    #[test]
    fn bury_and_unbury() {
        let (s, _, card_id) = setup();
        s.bury_cards(&[card_id], 1_000).unwrap();
        let queue = s
            .study_queue(1, 0, 1_700_000_000_000, 1_700_086_400_000, 20, 200)
            .unwrap();
        assert!(queue.new.is_empty());

        s.unbury_deck(1, 1_000).unwrap();
        let queue = s
            .study_queue(1, 0, 1_700_000_000_000, 1_700_086_400_000, 20, 200)
            .unwrap();
        assert_eq!(queue.new.len(), 1);
    }

    #[test]
    fn bury_and_unbury_specific_cards() {
        let (s, _, card_id) = setup();
        s.bury_cards(&[card_id], 1_000).unwrap();
        let q: i64 = s
            .lock()
            .query_row("SELECT queue FROM cards WHERE id = ?1", [card_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(q, -2);

        s.unbury_cards(&[card_id], 1_000).unwrap();
        let q_after: i64 = s
            .lock()
            .query_row("SELECT queue FROM cards WHERE id = ?1", [card_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(q_after, 0);
    }

    #[test]
    fn relearning_card_queue_restored_to_1_not_3() {
        let (s, _, card_id) = setup();
        // Set card to relearning (type 3, queue 1)
        s.lock()
            .execute(
                "UPDATE cards SET type = 3, queue = 1 WHERE id = ?1",
                [card_id],
            )
            .unwrap();

        // 1. Suspend then unsuspend -> queue should be 1, NOT 3
        s.suspend_cards(&[card_id], 1_000).unwrap();
        s.unsuspend_cards(&[card_id], 1_000).unwrap();
        let q: i64 = s
            .lock()
            .query_row("SELECT queue FROM cards WHERE id = ?1", [card_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(q, 1);

        // 2. Bury then unbury specific -> queue should be 1, NOT 3
        s.bury_cards(&[card_id], 1_000).unwrap();
        s.unbury_cards(&[card_id], 1_000).unwrap();
        let q: i64 = s
            .lock()
            .query_row("SELECT queue FROM cards WHERE id = ?1", [card_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(q, 1);

        // 3. Bury then unbury deck -> queue should be 1, NOT 3
        s.bury_cards(&[card_id], 1_000).unwrap();
        s.unbury_deck(1, 1_000).unwrap();
        let q: i64 = s
            .lock()
            .query_row("SELECT queue FROM cards WHERE id = ?1", [card_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(q, 1);

        // 4. Bury then unbury all -> queue should be 1, NOT 3
        s.bury_cards(&[card_id], 1_000).unwrap();
        s.unbury_all(1_000).unwrap();
        let q: i64 = s
            .lock()
            .query_row("SELECT queue FROM cards WHERE id = ?1", [card_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(q, 1);
    }

    #[test]
    fn bury_and_unbury_all() {
        let (s, _, card_id) = setup();
        s.bury_cards(&[card_id], 1_000).unwrap();
        assert!(s
            .study_queue(1, 0, 1_700_000_000_000, 1_700_086_400_000, 20, 200)
            .unwrap()
            .new
            .is_empty());

        s.unbury_all(1_000).unwrap();
        assert_eq!(
            s.study_queue(1, 0, 1_700_000_000_000, 1_700_086_400_000, 20, 200)
                .unwrap()
                .new
                .len(),
            1
        );
    }

    #[test]
    fn last_unbury_day_persists() {
        let (s, _, _) = setup();
        assert_eq!(s.get_last_unbury_day().unwrap(), None);
        s.set_last_unbury_day(42, 1_700_000_000_000).unwrap();
        assert_eq!(s.get_last_unbury_day().unwrap(), Some(42));
    }

    #[test]
    fn set_flag_persists() {
        let (s, _, card_id) = setup();
        s.set_card_flag(&[card_id], 3, 1_000).unwrap();
        let flag: i64 = s
            .lock()
            .query_row("SELECT flags FROM cards WHERE id = ?1", [card_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(flag, 3);
    }

    #[test]
    fn add_note_tag_idempotent() {
        let (s, note_id, _) = setup();
        s.add_note_tag(note_id, "leech", 1_000).unwrap();
        s.add_note_tag(note_id, "leech", 2_000).unwrap(); // idempotent
        let tags: String = s
            .lock()
            .query_row("SELECT tags FROM notes WHERE id = ?1", [note_id], |r| {
                r.get(0)
            })
            .unwrap();
        // Should appear exactly once
        assert_eq!(tags.matches("leech").count(), 1);
    }

    #[test]
    fn forget_cards_resets_to_new_respects_reset_counts_emits_once_and_undoes() {
        use bibalak_core::ports::FixedClock;
        use bibalak_core::{Collection, DomainEvent};
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let (s, note_id, card1) = setup();
        let conn = s.lock();
        conn.execute(
            r#"INSERT INTO cards
               (id, note_id, deck_id, ord, "mod", usn, type, queue, due,
                interval, ease_factor, reps, lapses, remaining,
                original_due, original_deck_id, flags, fsrs_stability, fsrs_difficulty, fsrs_last_review)
               VALUES (901, ?1, 1, 0, 100, -1, 2, 2, 42, 14, 2400, 9, 2, 0, 0, 0, 3, 12.5, 4.2, 28),
                      (902, ?1, 1, 0, 100, -1, 2, 2, 45, 20, 2600, 11, 3, 0, 0, 0, 0, 18.0, 3.8, 25)"#,
            [note_id],
        )
        .unwrap();
        // Set card1 as new due=5 to ensure forgotten cards are queued after max(due)=5.
        conn.execute("UPDATE cards SET due = 5 WHERE id = ?1", [card1])
            .unwrap();
        drop(conn);

        let clock = Arc::new(FixedClock(1_700_000_000_000));
        let col = Collection::new(Box::new(s), clock).unwrap();
        let events = Arc::new(AtomicUsize::new(0));
        let events_c = events.clone();
        col.events().subscribe(move |ev| {
            if matches!(ev, DomainEvent::CardAnswered { .. }) {
                events_c.fetch_add(1, Ordering::SeqCst);
            }
        });

        // Keep counts first
        col.forget_cards(&[901], false).unwrap();
        assert_eq!(events.load(Ordering::SeqCst), 1);
        let (ctype, queue, due, ivl, reps, lapses, flags) = col
            .storage()
            .search_cards("", 30, 1_700_000_000_000, 50, 0, None, true)
            .unwrap()
            .into_iter()
            .find(|r| r.card_id == 901)
            .map(|r| {
                (
                    r.card_type,
                    r.queue,
                    r.due,
                    r.interval,
                    r.reps,
                    r.lapses,
                    r.flags,
                )
            })
            .unwrap();
        let sc = col.study_card(901).unwrap().unwrap();
        assert_eq!((ctype, queue, ivl, reps, lapses, flags), (0, 0, 0, 9, 2, 3));
        assert!(due > 5, "assigned new queue position after existing max");
        assert_eq!(sc.state.stability, None);
        assert_eq!(sc.state.difficulty, None);
        assert_eq!(sc.state.last_review_day, None);

        // Reset counts on 902
        col.forget_cards(&[902], true).unwrap();
        let r902 = col
            .storage()
            .search_cards("", 30, 1_700_000_000_000, 50, 0, None, true)
            .unwrap()
            .into_iter()
            .find(|r| r.card_id == 902)
            .unwrap();
        assert_eq!(
            (r902.card_type, r902.queue, r902.reps, r902.lapses),
            (0, 0, 0, 0)
        );

        // Undo restores 902 completely
        assert!(matches!(
            col.undo_status(),
            Some(bibalak_core::undo::UndoAction::ForgetCards { count: 1 })
        ));
        col.undo().unwrap();
        let sc902 = col.study_card(902).unwrap().unwrap();
        assert_eq!(sc902.due, 45);
        assert_eq!(sc902.state.interval_days, 20);
        assert_eq!(sc902.state.reps, 11);
        assert_eq!(sc902.state.lapses, 3);
        assert_eq!(sc902.state.stability, Some(18.0));
    }

    #[test]
    fn set_due_date_handles_new_review_range_fixed_clock_and_undo() {
        use bibalak_core::ports::FixedClock;
        use bibalak_core::{Collection, DomainEvent};
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let (s, note_id, new_card_id) = setup();
        // Fixed collection creation is 1_700_000_000_000 (day 0).
        // Let clock = day 10 after rollover (+10 days).
        let now_ms = 1_700_000_000_000 + 10 * super::MS_PER_DAY;
        {
            let conn = s.lock();
            conn.execute(
                r#"INSERT INTO cards
                   (id, note_id, deck_id, ord, "mod", usn, type, queue, due,
                    interval, ease_factor, reps, lapses, remaining,
                    original_due, original_deck_id, flags)
                   VALUES (910, ?1, 1, 0, 100, -1, 2, 2, 5, 21, 2550, 7, 1, 0, 0, 0, 0),
                          (911, ?1, 1, 0, 100, -1, 2, -1, 8, 30, 2500, 10, 0, 0, 0, 0, 0)"#,
                [note_id],
            )
            .unwrap();
        }
        let col = Collection::new(Box::new(s), Arc::new(FixedClock(now_ms))).unwrap();
        let today = col.today();
        assert_eq!(today, 10);

        let events = Arc::new(AtomicUsize::new(0));
        let events_c = events.clone();
        col.events().subscribe(move |ev| {
            if matches!(ev, DomainEvent::CardAnswered { .. }) {
                events_c.fetch_add(1, Ordering::SeqCst);
            }
        });

        // "0" -> today; new card becomes review keeping interval rules, review keeps its 21d interval.
        col.set_due_date(&[new_card_id, 910], "0").unwrap();
        assert_eq!(events.load(Ordering::SeqCst), 1);

        let rows = col
            .storage()
            .search_cards("", today, now_ms, 50, 0, None, true)
            .unwrap();
        let new_became_rev = rows.iter().find(|r| r.card_id == new_card_id).unwrap();
        assert_eq!(
            (
                new_became_rev.card_type,
                new_became_rev.queue,
                new_became_rev.due,
                new_became_rev.interval
            ),
            (2, 2, i64::from(today), 1),
            "a new card made a review gets an interval of the days until due, at least 1 (Anki)"
        );

        let rev = rows.iter().find(|r| r.card_id == 910).unwrap();
        assert_eq!(
            (rev.card_type, rev.queue, rev.due, rev.interval),
            (2, 2, i64::from(today), 21)
        );

        // Suspended review stays suspended while due shifts to today + 3.
        col.set_due_date(&[911], "3").unwrap();
        let susp = col
            .storage()
            .search_cards("", today, now_ms, 50, 0, None, true)
            .unwrap()
            .into_iter()
            .find(|r| r.card_id == 911)
            .unwrap();
        assert_eq!(
            (susp.card_type, susp.queue, susp.due, susp.interval),
            (2, -1, i64::from(today) + 3, 30)
        );

        // Range "1-7" lands strictly inside [today + 1, today + 7].
        col.set_due_date(&[new_card_id, 910], "1-7").unwrap();
        let rows = col
            .storage()
            .search_cards("", today, now_ms, 50, 0, None, true)
            .unwrap();
        for id in [new_card_id, 910] {
            let r = rows.iter().find(|r| r.card_id == id).unwrap();
            assert!(
                (i64::from(today) + 1..=i64::from(today) + 7).contains(&r.due),
                "card {id} due {} outside [{}, {}]",
                r.due,
                today + 1,
                today + 7
            );
        }

        // Invalid spec rejected
        assert!(col.set_due_date(&[910], "7-1").is_err());

        // Undo restores range change back to today
        assert!(matches!(
            col.undo_status(),
            Some(bibalak_core::undo::UndoAction::SetDueDate { count: 2 })
        ));
        col.undo().unwrap();
        let rows = col
            .storage()
            .search_cards("", today, now_ms, 50, 0, None, true)
            .unwrap();
        assert_eq!(
            rows.iter().find(|r| r.card_id == 910).unwrap().due,
            i64::from(today)
        );
    }

    #[test]
    fn reposition_new_cards_start_step_shift_shuffle_and_undo() {
        use bibalak_core::ports::FixedClock;
        use bibalak_core::{Collection, DomainEvent};
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let (s, note_id, c1) = setup();
        {
            let conn = s.lock();
            conn.execute(
                r#"INSERT INTO cards
                   (id, note_id, deck_id, ord, "mod", usn, type, queue, due,
                    interval, ease_factor, reps, lapses, remaining,
                    original_due, original_deck_id, flags)
                   VALUES (921, ?1, 1, 0, 100, -1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0),
                          (922, ?1, 1, 0, 100, -1, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0),
                          (923, ?1, 1, 0, 100, -1, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0),
                          (924, ?1, 1, 0, 100, -1, 2, 2, 10, 5, 2500, 1, 0, 0, 0, 0, 0)"#,
                [note_id],
            )
            .unwrap();
        }
        let col = Collection::new(Box::new(s), Arc::new(FixedClock(1_700_000_000_000))).unwrap();
        let events = Arc::new(AtomicUsize::new(0));
        let events_c = events.clone();
        col.events().subscribe(move |ev| {
            if matches!(ev, DomainEvent::CardAnswered { .. }) {
                events_c.fetch_add(1, Ordering::SeqCst);
            }
        });

        // Reposition c1 and 923 to start=2, step=3, no shuffle, shift existing >= 2.
        col.reposition_new_cards(&[c1, 923], 2, 3, false, true)
            .unwrap();
        assert_eq!(events.load(Ordering::SeqCst), 1);

        let due_of = |id: i64| col.study_card(id).unwrap().unwrap().due;
        assert_eq!(due_of(c1), 2);
        assert_eq!(due_of(923), 5);
        // Existing new cards >= 2 (921 at 2, 922 at 3) shifted by 2 * 3 = 6; review 924 untouched.
        assert_eq!(due_of(921), 8);
        assert_eq!(due_of(922), 9);
        assert_eq!(due_of(924), 10);

        // Undo restores BOTH selected AND shifted cards!
        assert!(matches!(
            col.undo_status(),
            Some(bibalak_core::undo::UndoAction::RepositionCards { count: 2 })
        ));
        col.undo().unwrap();
        assert_eq!(due_of(c1), 1);
        assert_eq!(due_of(921), 2);
        assert_eq!(due_of(922), 3);
        assert_eq!(due_of(923), 4);

        // Shuffle over [c1, 921, 922, 923] with start=10, step=2 assigns exact set {10, 12, 14, 16}.
        col.reposition_new_cards(&[c1, 921, 922, 923], 10, 2, true, false)
            .unwrap();
        let mut dues = vec![due_of(c1), due_of(921), due_of(922), due_of(923)];
        dues.sort();
        assert_eq!(dues, vec![10, 12, 14, 16]);

        // Only review selected -> error
        assert!(col
            .reposition_new_cards(&[924], 1, 1, false, false)
            .is_err());
    }

    #[test]
    fn deck_card_ids_respects_subdecks_and_resets_via_forget_cards() {
        use bibalak_core::ports::FixedClock;
        use bibalak_core::Collection;
        use std::sync::Arc;

        let (s, note_id, card1) = setup();
        let child = s.create_deck("Default::Sub", 100).unwrap();
        let filtered = s
            .create_filtered_deck("Cram", "is:due", 0, 10, 0, 100)
            .unwrap();
        {
            let conn = s.lock();
            conn.execute(
                r#"INSERT INTO cards
                   (id, note_id, deck_id, ord, "mod", usn, type, queue, due,
                    interval, ease_factor, reps, lapses, remaining,
                    original_due, original_deck_id, flags, fsrs_stability, fsrs_difficulty, fsrs_last_review)
                   VALUES (951, ?1, ?2, 0, 100, -1, 2, 2, 42, 14, 2400, 9, 2, 0, 0, 0, 0, 12.5, 4.2, 28),
                          (952, ?1, ?3, 0, 100, -1, 2, 2, 42, 14, 2400, 5, 1, 0, 0, 0, 0, 10.0, 4.0, 28)"#,
                rusqlite::params![note_id, child.id, filtered.id],
            )
            .unwrap();
        }
        let clock = Arc::new(FixedClock(1_700_000_000_000));
        let col = Collection::new(Box::new(s), clock).unwrap();

        // Without subdecks: only parent's own card
        assert_eq!(col.deck_card_ids(1, false).unwrap(), vec![card1]);
        // With subdecks: includes non-filtered child, excludes filtered deck
        let with_sub = col.deck_card_ids(1, true).unwrap();
        assert_eq!(with_sub, vec![card1, 951]);
        assert!(!with_sub.contains(&952));

        // Reset via forget_cards + verify Anki-valid new state & undo
        col.forget_cards(&with_sub, true).unwrap();
        let sc = col.study_card(951).unwrap().unwrap();
        assert_eq!(sc.state.phase, bibalak_core::scheduling::CardPhase::New);
        assert_eq!(
            (sc.state.reps, sc.state.lapses, sc.state.interval_days),
            (0, 0, 0)
        );
        assert_eq!(sc.state.stability, None);
        col.undo().unwrap();
        let restored = col.study_card(951).unwrap().unwrap();
        assert_eq!(
            restored.state.phase,
            bibalak_core::scheduling::CardPhase::Review
        );
        assert_eq!((restored.state.reps, restored.state.lapses), (9, 2));
    }
}
