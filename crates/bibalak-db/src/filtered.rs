use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::FilteredDeckConfig;
use bibalak_core::model::Deck;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::search;

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

/// JSON stored in `decks.filtered`.
#[derive(Serialize, Deserialize, Default, Clone)]
struct FilteredJson {
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub order: u8,
    #[serde(default = "default_limit")]
    pub limit: u32,
}

fn default_limit() -> u32 {
    100
}

fn read_config(conn: &Connection, deck_id: i64) -> CoreResult<Option<(String, FilteredJson)>> {
    let row: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT name, filtered FROM decks WHERE id = ?1 AND is_filtered = 1",
            [deck_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    match row {
        None => Ok(None),
        Some((name, json)) => {
            let cfg: FilteredJson = json
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_default();
            Ok(Some((name, cfg)))
        }
    }
}

/// Return `FilteredDeckConfig` IPC DTO for the frontend.
pub fn get_config(conn: &Connection, deck_id: i64) -> CoreResult<Option<FilteredDeckConfig>> {
    match read_config(conn, deck_id)? {
        None => Ok(None),
        Some((name, cfg)) => Ok(Some(FilteredDeckConfig {
            deck_id,
            name,
            search: cfg.search,
            order: cfg.order,
            limit: cfg.limit,
        })),
    }
}

/// Create a new filtered deck, immediately gather matching cards, return the
/// inserted `Deck`.
pub fn create_filtered_deck(
    conn: &Connection,
    name: &str,
    search_query: &str,
    order: u8,
    limit: u32,
    today: i32,
    now_ms: i64,
) -> CoreResult<Deck> {
    let cfg = FilteredJson {
        search: search_query.to_string(),
        order,
        limit,
    };
    let cfg_json = serde_json::to_string(&cfg).map_err(err)?;
    let id = now_ms;
    // `Parent::Cram` sits under Parent (created if missing), like a normal deck.
    let parent_id = crate::storage::ensure_deck_parents(conn, name, now_ms)?;
    conn.execute(
        r#"INSERT INTO decks (id, name, parent_id, config_id, "mod", usn, is_filtered, common, filtered)
           VALUES (?1, ?2, ?3, 1, ?4, -1, 1, '{}', ?5)"#,
        params![id, name, parent_id, now_ms, cfg_json],
    )
    .map_err(err)?;
    gather_cards(conn, id, search_query, order, limit, today, now_ms)?;
    Ok(Deck {
        id,
        name: name.to_string(),
        parent_id,
        config_id: 1,
        mod_ms: now_ms,
        usn: -1,
        collapsed: false,
        is_filtered: true,
    })
}

/// Empty then re-gather cards for an existing filtered deck. Returns card count.
pub fn rebuild_filtered(
    conn: &Connection,
    deck_id: i64,
    today: i32,
    now_ms: i64,
) -> CoreResult<u32> {
    let (_, cfg) = read_config(conn, deck_id)?
        .ok_or_else(|| CoreError::NotFound(format!("filtered deck {deck_id}")))?;
    empty_filtered(conn, deck_id, now_ms)?;
    gather_cards(
        conn,
        deck_id,
        &cfg.search,
        cfg.order,
        cfg.limit,
        today,
        now_ms,
    )
}

/// Return all cards in a filtered deck to their original decks.
/// New cards (type=0) get their original position restored; reviewed cards keep
/// current scheduling (already updated by `apply_answer`).
pub fn empty_filtered(conn: &Connection, deck_id: i64, now_ms: i64) -> CoreResult<()> {
    conn.execute(
        r#"UPDATE cards
           SET deck_id        = original_deck_id,
               due            = CASE WHEN type = 0 THEN original_due ELSE due END,
               original_deck_id = 0,
               original_due   = 0,
               "mod"          = ?2,
               usn            = -1
           WHERE deck_id = ?1 AND original_deck_id != 0"#,
        params![deck_id, now_ms],
    )
    .map_err(err)?;
    Ok(())
}

/// Move matching cards (from `search_query`) into `filtered_deck_id`, saving
/// their original deck + due for later restoration. Returns number gathered.
fn gather_cards(
    conn: &Connection,
    filtered_deck_id: i64,
    search_query: &str,
    order: u8,
    limit: u32,
    today: i32,
    now_ms: i64,
) -> CoreResult<u32> {
    let (sort_key, sort_asc) = match order {
        1 => (Some("due"), true),
        2 => (None, true),
        3 => (Some("interval"), true),
        4 => (Some("lapses"), false),
        _ => (None, true),
    };
    let rows = search::search_cards(
        conn,
        search_query,
        today,
        now_ms,
        i64::MAX,
        0,
        sort_key,
        sort_asc,
    )?;
    let mut card_ids: Vec<i64> = rows
        .iter()
        .filter(|r| r.queue >= 0) // exclude suspended / buried before applying limit
        .map(|r| r.card_id)
        .collect();
    if order == 0 {
        fastrand::shuffle(&mut card_ids);
    }
    card_ids.truncate(limit as usize);
    if card_ids.is_empty() {
        return Ok(0);
    }
    let json = serde_json::to_string(&card_ids).map_err(err)?;
    let n = conn
        .execute(
            r#"UPDATE cards
               SET original_deck_id = deck_id,
                   original_due     = due,
                   deck_id          = ?1,
                   "mod"            = ?2,
                   usn              = -1
               WHERE id IN (SELECT value FROM json_each(?3))
                 AND original_deck_id = 0"#,
            params![filtered_deck_id, now_ms, json],
        )
        .map_err(err)?;
    Ok(n as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::SqliteStorage;
    use bibalak_core::ports::*;

    fn setup() -> SqliteStorage {
        let s = SqliteStorage::open_in_memory().unwrap();
        s.ensure_collection(1_700_000_000_000).unwrap();
        s
    }

    fn add_review_card(s: &SqliteStorage, deck_id: i64) -> i64 {
        let conn = s.lock();
        conn.execute(
            r#"INSERT INTO notetypes (id, name, kind, "mod", usn) VALUES (1, 'Basic', 0, 0, -1)
               ON CONFLICT DO NOTHING"#,
            [],
        )
        .unwrap();
        let note_id = 1_700_000_000_002i64;
        conn.execute(
            r#"INSERT OR IGNORE INTO notes (id, guid, notetype_id, "mod", usn, tags, fields)
               VALUES (?1, 'g1', 1, 0, -1, ' ', 'Front\x1fBack')"#,
            [note_id],
        )
        .unwrap();
        let card_id = 1_700_000_000_003i64;
        conn.execute(
            r#"INSERT OR IGNORE INTO cards
               (id, note_id, deck_id, ord, "mod", usn, type, queue, due, interval,
                ease_factor, reps, lapses, remaining, original_due, original_deck_id, flags)
               VALUES (?1, ?2, ?3, 0, 0, -1, 2, 2, 5, 10, 2500, 3, 0, 0, 0, 0, 0)"#,
            params![card_id, note_id, deck_id],
        )
        .unwrap();
        card_id
    }

    #[test]
    fn create_gathers_and_empty_returns() {
        let s = setup();
        let deck = s.create_deck("Spanish", 1_000).unwrap();
        let card_id = add_review_card(&s, deck.id);

        let now_ms = 1_700_000_000_000i64;
        let today = 0i32;

        let fdeck = {
            let conn = s.lock();
            create_filtered_deck(&conn, "Custom", "is:review", 0, 100, today, now_ms).unwrap()
        };
        assert!(fdeck.is_filtered);

        // Card should now be in filtered deck.
        let (new_deck_id, orig_deck_id): (i64, i64) = s
            .lock()
            .query_row(
                "SELECT deck_id, original_deck_id FROM cards WHERE id = ?1",
                [card_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(new_deck_id, fdeck.id);
        assert_eq!(orig_deck_id, deck.id);

        // Empty should restore.
        {
            let conn = s.lock();
            empty_filtered(&conn, fdeck.id, now_ms + 1).unwrap();
        }
        let (restored_deck_id, restored_orig): (i64, i64) = s
            .lock()
            .query_row(
                "SELECT deck_id, original_deck_id FROM cards WHERE id = ?1",
                [card_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(restored_deck_id, deck.id);
        assert_eq!(restored_orig, 0);
    }

    #[test]
    fn rebuild_is_idempotent() {
        let s = setup();
        let deck = s.create_deck("Spanish", 1_000).unwrap();
        add_review_card(&s, deck.id);

        let now_ms = 1_700_000_000_000i64;
        let today = 0i32;

        let fdeck = {
            let conn = s.lock();
            create_filtered_deck(&conn, "Custom", "is:review", 0, 100, today, now_ms).unwrap()
        };

        let n1 = {
            let conn = s.lock();
            rebuild_filtered(&conn, fdeck.id, today, now_ms + 1).unwrap()
        };
        let n2 = {
            let conn = s.lock();
            rebuild_filtered(&conn, fdeck.id, today, now_ms + 2).unwrap()
        };
        assert_eq!(n1, n2, "rebuild should gather same number of cards");
    }

    #[test]
    fn suspended_cards_not_gathered() {
        let s = setup();
        let deck = s.create_deck("Spanish", 1_000).unwrap();
        let card_id = add_review_card(&s, deck.id);

        // Suspend the card.
        s.lock()
            .execute("UPDATE cards SET queue = -1 WHERE id = ?1", [card_id])
            .unwrap();

        let now_ms = 1_700_000_000_000i64;
        let fdeck = {
            let conn = s.lock();
            create_filtered_deck(&conn, "Custom", "is:review", 0, 100, 0, now_ms).unwrap()
        };

        let deck_id: i64 = s
            .lock()
            .query_row("SELECT deck_id FROM cards WHERE id = ?1", [card_id], |r| {
                r.get(0)
            })
            .unwrap();
        // Card should NOT have been gathered (suspended).
        // Note: search may filter it via queue check in gather_cards.
        // The card's deck_id should still be the original deck.
        assert_ne!(deck_id, fdeck.id, "suspended card should not be gathered");
    }

    #[test]
    fn gather_applies_limit_after_excluding_suspended_and_respects_order() {
        let s = setup();
        let deck = s.create_deck("Spanish", 1_000).unwrap();
        {
            let conn = s.lock();
            conn.execute(
                r#"INSERT INTO notetypes (id, name, kind, "mod", usn) VALUES (1, 'Basic', 0, 0, -1)
                   ON CONFLICT DO NOTHING"#,
                [],
            )
            .unwrap();
            for i in 1..=3_i64 {
                let nid = 100 + i;
                let cid = 200 + i;
                conn.execute(
                    r#"INSERT INTO notes (id, guid, notetype_id, "mod", usn, tags, fields)
                       VALUES (?1, ?2, 1, 0, -1, ' ', 'F\x1fB')"#,
                    params![nid, format!("g{i}")],
                )
                .unwrap();
                // Card 201 suspended; 202 has interval=20; 203 has interval=5.
                let queue = if i == 1 { -1 } else { 2 };
                let ivl = match i {
                    2 => 20,
                    3 => 5,
                    _ => 1,
                };
                conn.execute(
                    r#"INSERT INTO cards
                       (id, note_id, deck_id, ord, "mod", usn, type, queue, due, interval,
                        ease_factor, reps, lapses, remaining, original_due, original_deck_id, flags)
                       VALUES (?1, ?2, ?3, 0, 0, -1, 2, ?4, 10, ?5, 2500, 1, 0, 0, 0, 0, 0)"#,
                    params![cid, nid, deck.id, queue, ivl],
                )
                .unwrap();
            }
        }
        let now_ms = 1_700_000_000_000i64;
        // Order 3 = Interval ascending, limit 1 -> skips suspended 201 and picks 203 (ivl=5).
        let fdeck = {
            let conn = s.lock();
            create_filtered_deck(&conn, "Cram", "deck:Spanish", 3, 1, 0, now_ms).unwrap()
        };
        let gathered: Vec<i64> = s
            .lock()
            .prepare("SELECT id FROM cards WHERE deck_id = ?1")
            .unwrap()
            .query_map([fdeck.id], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(gathered, vec![203]);
    }
}
