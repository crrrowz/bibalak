//! Study-queue queries and answer persistence. Free functions over a
//! `Connection`/`Transaction`, called by `SqliteStorage`.

use std::collections::HashMap;

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::model::{Algorithm, CardRender, Revlog, StudyCard};
use bibalak_core::scheduling::{CardPhase, CardState, SchedConfig, FSRS6_DEFAULT_WEIGHTS};
use rusqlite::{params, Connection, OptionalExtension, Transaction};

fn parse_limits(config_json: &str) -> (u32, u32) {
    let v: serde_json::Value = serde_json::from_str(config_json).unwrap_or_default();
    let new_per_day = v["new"]["perDay"].as_u64().unwrap_or(20) as u32;
    let rev_per_day = v["rev"]["perDay"].as_u64().unwrap_or(200) as u32;
    (new_per_day, rev_per_day)
}

pub fn deck_limits(conn: &Connection, config_id: i64) -> CoreResult<(u32, u32)> {
    let json: String = conn
        .query_row(
            "SELECT config FROM deck_config WHERE id = ?1",
            [config_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .unwrap_or_else(|| "{}".to_string());
    Ok(parse_limits(&json))
}

pub fn all_deck_limits(conn: &Connection) -> CoreResult<HashMap<i64, (u32, u32)>> {
    let mut stmt = conn
        .prepare("SELECT id, config FROM deck_config")
        .map_err(err)?;
    let mut map = HashMap::new();
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?;
    for row in rows {
        let (id, json) = row.map_err(err)?;
        map.insert(id, parse_limits(&json));
    }
    Ok(map)
}

/// Cards studied today in one deck, `(new, review)`. `CROSS JOIN` keeps the
/// review log as the outer loop: it starts from today's reviews (revlog's
/// primary key is the timestamp) instead of every card in the deck (ADR-005).
/// Carryover learning cards first answered before `today_start_ms` (without an
/// intervening `review_kind = 4` forget boundary) are excluded from `new` so
/// finishing yesterday's learning steps does not consume today's new-card quota,
/// while cards reset via `forget_cards` (`review_kind = 4`) count per reset epoch.
/// Matches Anki (`rslib/src/scheduler/answering/mod.rs` `update_deck_stats_from_answer`):
/// answers in a filtered deck record against the filtered deck (`c.deck_id`),
/// not the card's home deck (`original_deck_id`), so studying in a filtered deck
/// does not consume the home deck's daily new/review limits.
pub(crate) const TODAY_STUDIED_SQL: &str = "SELECT
       COUNT(DISTINCT CASE
           WHEN r.review_kind = 0
            AND NOT EXISTS (
                SELECT 1 FROM revlog prev
                WHERE prev.card_id = r.card_id
                  AND prev.review_kind != 4
                  AND prev.id < ?2
                  AND prev.id > COALESCE(
                      (SELECT MAX(f.id) FROM revlog f
                       WHERE f.card_id = r.card_id AND f.review_kind = 4 AND f.id <= r.id),
                      -1
                  )
            )
           THEN r.card_id || ':' || COALESCE(
               (SELECT MAX(f.id) FROM revlog f
                WHERE f.card_id = r.card_id AND f.review_kind = 4 AND f.id <= r.id),
               -1
           )
       END),
       COUNT(DISTINCT CASE WHEN r.review_kind = 1 THEN r.card_id END)
     FROM revlog r CROSS JOIN cards c ON c.id = r.card_id
     WHERE c.deck_id = ?1
       AND r.id >= ?2";

pub fn today_studied(
    conn: &Connection,
    deck_id: i64,
    today_start_ms: i64,
) -> CoreResult<(u32, u32)> {
    conn.query_row(TODAY_STUDIED_SQL, params![deck_id, today_start_ms], |r| {
        Ok((r.get::<_, u32>(0)?, r.get::<_, u32>(1)?))
    })
    .map_err(err)
}

pub fn all_today_studied(
    conn: &Connection,
    today_start_ms: i64,
) -> CoreResult<HashMap<i64, (u32, u32)>> {
    let mut stmt = conn
        .prepare(
            "SELECT c.deck_id,
               COUNT(DISTINCT CASE
                   WHEN r.review_kind = 0
                    AND NOT EXISTS (
                        SELECT 1 FROM revlog prev
                        WHERE prev.card_id = r.card_id
                          AND prev.review_kind != 4
                          AND prev.id < ?1
                          AND prev.id > COALESCE(
                              (SELECT MAX(f.id) FROM revlog f
                               WHERE f.card_id = r.card_id AND f.review_kind = 4 AND f.id <= r.id),
                              -1
                          )
                    )
                   THEN r.card_id || ':' || COALESCE(
                       (SELECT MAX(f.id) FROM revlog f
                        WHERE f.card_id = r.card_id AND f.review_kind = 4 AND f.id <= r.id),
                       -1
                   )
               END),
               COUNT(DISTINCT CASE WHEN r.review_kind = 1 THEN r.card_id END)
             FROM revlog r JOIN cards c ON c.id = r.card_id
             WHERE r.id >= ?1
             GROUP BY c.deck_id",
        )
        .map_err(err)?;
    let mut map = HashMap::new();
    let rows = stmt
        .query_map([today_start_ms], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, u32>(1)?,
                r.get::<_, u32>(2)?,
            ))
        })
        .map_err(err)?;
    for row in rows {
        let (deck_id, new_studied, rev_studied) = row.map_err(err)?;
        map.insert(deck_id, (new_studied, rev_studied));
    }
    Ok(map)
}

pub fn set_deck_limits(
    conn: &Connection,
    config_id: i64,
    new_per_day: u32,
    rev_per_day: u32,
    now_ms: i64,
) -> CoreResult<()> {
    let json: String = conn
        .query_row(
            "SELECT config FROM deck_config WHERE id = ?1",
            [config_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .unwrap_or_else(|| "{}".to_string());
    let mut v: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
    v["new"]["perDay"] = serde_json::Value::Number(new_per_day.into());
    v["rev"]["perDay"] = serde_json::Value::Number(rev_per_day.into());
    let new_json = serde_json::to_string(&v).map_err(err)?;
    conn.execute(
        r#"UPDATE deck_config SET config = ?1, "mod" = ?2, usn = -1 WHERE id = ?3"#,
        params![new_json, now_ms, config_id],
    )
    .map_err(err)?;
    Ok(())
}

/// Extra new-card allowance for `deck_id` on collection-day `day` (0 if none set).
pub fn day_extra_new(conn: &Connection, deck_id: i64, day: i32) -> CoreResult<u32> {
    conn.query_row(
        "SELECT extra_new FROM day_limit_overrides WHERE deck_id = ?1 AND day = ?2",
        params![deck_id, day],
        |r| r.get(0),
    )
    .optional()
    .map_err(err)
    .map(|v| v.unwrap_or(0))
}

/// Extra new-card allowances for every deck on collection-day `day`, keyed by deck_id.
pub fn all_day_extra_new(conn: &Connection, day: i32) -> CoreResult<HashMap<i64, u32>> {
    let mut stmt = conn
        .prepare("SELECT deck_id, extra_new FROM day_limit_overrides WHERE day = ?1")
        .map_err(err)?;
    let mut map = HashMap::new();
    let rows = stmt
        .query_map([day], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, u32>(1)?)))
        .map_err(err)?;
    for row in rows {
        let (deck_id, extra_new) = row.map_err(err)?;
        map.insert(deck_id, extra_new);
    }
    Ok(map)
}

/// Upsert the extra new-card allowance for `deck_id` on `day`.
pub fn set_day_extra_new(
    conn: &Connection,
    deck_id: i64,
    day: i32,
    extra_new: u32,
) -> CoreResult<()> {
    conn.execute(
        "INSERT INTO day_limit_overrides (deck_id, day, extra_new) VALUES (?1, ?2, ?3)
         ON CONFLICT(deck_id, day) DO UPDATE SET extra_new = excluded.extra_new",
        params![deck_id, day, extra_new],
    )
    .map_err(err)?;
    Ok(())
}

pub fn get_deck_config(conn: &Connection, config_id: i64) -> CoreResult<SchedConfig> {
    let json: String = conn
        .query_row(
            "SELECT config FROM deck_config WHERE id = ?1",
            [config_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .unwrap_or_else(|| "{}".to_string());
    Ok(parse_sched_config(&json))
}

pub fn set_deck_config(
    conn: &Connection,
    config_id: i64,
    cfg: &SchedConfig,
    now_ms: i64,
) -> CoreResult<()> {
    let algo_str = match cfg.algorithm {
        Algorithm::Sm2 => "sm2",
        Algorithm::Fsrs => "fsrs",
    };
    let v = serde_json::json!({
        "algo": algo_str,
        "new": {
            "perDay": cfg.new_per_day,
            "delays": cfg.learning_steps_min,
            "graduating": cfg.graduating_interval_days,
            "easy": cfg.easy_interval_days,
            "initialFactor": cfg.starting_ease_milli
        },
        "rev": {
            "perDay": cfg.review_per_day,
            "ease4": cfg.easy_bonus,
            "hardFactor": cfg.hard_interval_factor,
            "ivlFct": cfg.interval_modifier,
            "maxIvl": cfg.maximum_interval_days
        },
        "lapse": {
            "delays": cfg.relearning_steps_min,
            "minInt": cfg.minimum_interval_days,
            "mult": cfg.lapse_interval_factor,
            "leechThreshold": cfg.leech_threshold
        },
        "fsrs": {
            "weights": cfg.fsrs_weights.to_vec(),
            "desiredRetention": cfg.desired_retention
        }
    });
    conn.execute(
        r#"UPDATE deck_config SET config = ?1, "mod" = ?2, usn = -1 WHERE id = ?3"#,
        params![v.to_string(), now_ms, config_id],
    )
    .map_err(err)?;
    Ok(())
}

fn parse_sched_config(json: &str) -> SchedConfig {
    let v: serde_json::Value = serde_json::from_str(json).unwrap_or_default();
    let algorithm = match v["algo"].as_str().unwrap_or("sm2") {
        "fsrs" => Algorithm::Fsrs,
        _ => Algorithm::Sm2,
    };
    let fsrs_weights = {
        // Start from FSRS-6 defaults so old 19-weight configs are automatically
        // padded with correct values for the two new FSRS-6 parameters.
        let mut arr = FSRS6_DEFAULT_WEIGHTS;
        if let Some(weights) = v["fsrs"]["weights"].as_array() {
            for (i, w) in weights.iter().enumerate().take(21) {
                if let Some(f) = w.as_f64() {
                    arr[i] = f;
                }
            }
        }
        arr
    };
    SchedConfig {
        algorithm,
        new_per_day: v["new"]["perDay"].as_u64().unwrap_or(20) as u32,
        review_per_day: v["rev"]["perDay"].as_u64().unwrap_or(200) as u32,
        learning_steps_min: v["new"]["delays"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_u64().map(|n| n as u32))
                    .collect()
            })
            .unwrap_or_else(|| vec![1, 10]),
        graduating_interval_days: v["new"]["graduating"].as_u64().unwrap_or(1) as u32,
        easy_interval_days: v["new"]["easy"].as_u64().unwrap_or(4) as u32,
        starting_ease_milli: v["new"]["initialFactor"].as_u64().unwrap_or(2500) as u32,
        easy_bonus: v["rev"]["ease4"].as_f64().unwrap_or(1.3),
        hard_interval_factor: v["rev"]["hardFactor"].as_f64().unwrap_or(1.2),
        interval_modifier: v["rev"]["ivlFct"].as_f64().unwrap_or(1.0),
        maximum_interval_days: v["rev"]["maxIvl"].as_u64().unwrap_or(36_500) as u32,
        relearning_steps_min: v["lapse"]["delays"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_u64().map(|n| n as u32))
                    .collect()
            })
            .unwrap_or_else(|| vec![10]),
        lapse_interval_factor: v["lapse"]["mult"].as_f64().unwrap_or(0.0),
        minimum_interval_days: v["lapse"]["minInt"].as_u64().unwrap_or(1) as u32,
        leech_threshold: v["lapse"]["leechThreshold"].as_u64().unwrap_or(8) as u32,
        fsrs_weights,
        desired_retention: v["fsrs"]["desiredRetention"].as_f64().unwrap_or(0.9),
    }
}

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

pub(crate) fn type_to_phase(card_type: i64) -> CardPhase {
    match card_type {
        1 => CardPhase::Learning,
        2 => CardPhase::Review,
        3 => CardPhase::Relearning,
        _ => CardPhase::New,
    }
}

/// (card.type, card.queue) for a phase.
pub fn phase_to_type_queue(phase: CardPhase) -> (i64, i64) {
    match phase {
        CardPhase::New => (0, 0),
        CardPhase::Learning => (1, 1),
        CardPhase::Review => (2, 2),
        CardPhase::Relearning => (3, 1),
    }
}

pub fn ensure_collection(conn: &Connection, now_ms: i64) -> CoreResult<i64> {
    conn.execute(
        "INSERT OR IGNORE INTO collection
         (id, created, modified, schema_mod, anki_ver, usn, last_sync, config)
         VALUES (1, ?1, ?1, ?1, 18, 0, 0, '{}')",
        [now_ms],
    )
    .map_err(err)?;
    conn.query_row("SELECT created FROM collection WHERE id = 1", [], |r| {
        r.get(0)
    })
    .map_err(err)
}

const DEFAULT_ROLLOVER_HOUR: u8 = 4;

pub fn get_rollover_hour(conn: &Connection) -> CoreResult<u8> {
    let json: String = conn
        .query_row("SELECT config FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(err)?
        .unwrap_or_else(|| "{}".to_string());
    let v: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
    Ok(v["rolloverHour"]
        .as_u64()
        .map(|h| h.min(23) as u8)
        .unwrap_or(DEFAULT_ROLLOVER_HOUR))
}

pub fn set_rollover_hour(conn: &Connection, hour: u8, now_ms: i64) -> CoreResult<()> {
    let json: String = conn
        .query_row("SELECT config FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(err)?
        .unwrap_or_else(|| "{}".to_string());
    let mut v: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
    v["rolloverHour"] = serde_json::Value::Number(hour.min(23).into());
    conn.execute(
        "UPDATE collection SET config = ?1, modified = ?2 WHERE id = 1",
        params![v.to_string(), now_ms],
    )
    .map_err(err)?;
    Ok(())
}

pub fn get_last_unbury_day(conn: &Connection) -> CoreResult<Option<i32>> {
    let json: String = conn
        .query_row("SELECT config FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(err)?
        .unwrap_or_else(|| "{}".to_string());
    let v: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
    Ok(v["lastUnburyDay"].as_i64().map(|d| d as i32))
}

pub fn set_last_unbury_day(conn: &Connection, day: i32, now_ms: i64) -> CoreResult<()> {
    let json: String = conn
        .query_row("SELECT config FROM collection WHERE id = 1", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(err)?
        .unwrap_or_else(|| "{}".to_string());
    let mut v: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
    v["lastUnburyDay"] = serde_json::Value::Number(day.into());
    conn.execute(
        "UPDATE collection SET config = ?1, modified = ?2 WHERE id = 1",
        params![v.to_string(), now_ms],
    )
    .map_err(err)?;
    Ok(())
}

/// New-card order jitter. New cards carry their import position in `due` — for a
/// frequency-ranked deck that means most-frequent first. We sort by that rank
/// plus a small random offset in `0..NEW_ORDER_JITTER`, so the run stays roughly
/// ranked (frequent words early) without being perfectly predictable: a card can
/// drift at most `NEW_ORDER_JITTER` positions, which also breaks up sibling runs.
const NEW_ORDER_JITTER: i64 = 5;

/// The studyable cards in a deck, split into their three streams plus a single
/// learn-ahead fallback. The application layer ([`Collection::next_card`])
/// decides the order; this just gates each stream correctly.
///
/// `cards.due` is dual-unit (Anki convention): epoch-**milliseconds** for
/// learning/relearning cards, day-**number** for review cards. So learning is
/// gated by `now_ms` and review by `today`.
pub fn study_queue(
    conn: &Connection,
    deck_id: i64,
    today: i32,
    now_ms: i64,
    today_end_ms: i64,
    new_limit: u32,
    review_limit: u32,
) -> CoreResult<bibalak_core::ports::StudyQueue> {
    let is_filtered: bool = conn
        .query_row(
            "SELECT is_filtered != 0 FROM decks WHERE id = ?1",
            [deck_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .unwrap_or(false);

    // 1. Learning/relearning that is due now — time-critical, no cap, by due.
    //    Day-learning cards (`queue = 3`) store a day number in `due` rather
    //    than epoch milliseconds, so they compare against `today`. Filtered
    //    decks surface all active gathered learning cards regardless of due.
    let mut stmt = conn
        .prepare(
            "SELECT id FROM cards WHERE deck_id = ?1 AND queue NOT IN (-1,-2,-3)
             AND type IN (1, 3)
             AND (?4 != 0 OR (queue = 3 AND due <= ?3) OR (queue != 3 AND due <= ?2))
             ORDER BY CASE WHEN queue = 3 THEN 0 ELSE due END, due",
        )
        .map_err(err)?;
    let learning: Vec<i64> = stmt
        .query_map(
            params![deck_id, now_ms, today, i64::from(is_filtered)],
            |r| r.get(0),
        )
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;

    // 2. New — frequency rank (`due`) with a small random jitter, so the deck's
    //    ordering shows through without being fully predictable. `RANDOM() &
    //    0x7FFF_FFFF` keeps a non-negative key (avoids ABS(i64::MIN) overflow).
    //    `due` on new cards is the *import-time* counter, which can be a global
    //    (cross-deck) sequence rather than starting near 0 for this deck — so we
    //    rank within the deck's own `due` ordering instead of using the raw value.
    let mut new: Vec<i64> = Vec::new();
    if new_limit > 0 {
        // Any row past rank `new_limit + NEW_ORDER_JITTER - 1` cannot overtake
        // the top `new_limit` rows (whose jitter is in `0..NEW_ORDER_JITTER`),
        // so capping the inner scan avoids ranking the entire deck.
        let inner_cap = i64::from(new_limit) + NEW_ORDER_JITTER;
        let mut stmt = conn
            .prepare(
                "SELECT id FROM (
                     SELECT id, ROW_NUMBER() OVER (ORDER BY due) AS rank
                     FROM cards WHERE deck_id = ?1 AND queue NOT IN (-1,-2,-3) AND type = 0
                     ORDER BY due LIMIT ?4
                 ) ORDER BY rank + ((RANDOM() & 2147483647) % ?3), id LIMIT ?2",
            )
            .map_err(err)?;
        new = stmt
            .query_map(
                params![deck_id, new_limit, NEW_ORDER_JITTER, inner_cap],
                |r| r.get(0),
            )
            .map_err(err)?
            .collect::<rusqlite::Result<_>>()
            .map_err(err)?;
    }

    // 3. Reviews — random order within today's due set (or all reviews in a filtered deck).
    let mut review: Vec<i64> = Vec::new();
    if review_limit > 0 {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM cards WHERE deck_id = ?1 AND queue NOT IN (-1,-2,-3)
                 AND type = 2 AND (?4 != 0 OR due <= ?2) ORDER BY RANDOM() LIMIT ?3",
            )
            .map_err(err)?;
        review = stmt
            .query_map(
                params![deck_id, today, review_limit, i64::from(is_filtered)],
                |r| r.get(0),
            )
            .map_err(err)?
            .collect::<rusqlite::Result<_>>()
            .map_err(err)?;
    }

    // 4. Learn-ahead fallback — learning cards due before midnight, soonest
    //    first. Shown immediately when nothing else is due so the user can
    //    finish the day. Kept as a list (not just the soonest) so the caller
    //    can skip a just-answered card still inside its grace period in favor
    //    of the next-soonest one.
    let mut stmt = conn
        .prepare(
            "SELECT id FROM cards WHERE deck_id = ?1 AND queue NOT IN (-1,-2,-3)
             AND type IN (1, 3) AND queue != 3 AND due > ?2 AND due < ?3 ORDER BY due",
        )
        .map_err(err)?;
    let learning_ahead: Vec<i64> = stmt
        .query_map(params![deck_id, now_ms, today_end_ms], |r| r.get(0))
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;

    Ok(bibalak_core::ports::StudyQueue {
        learning,
        new,
        review,
        learning_ahead,
    })
}

pub fn count_due_by_type(
    conn: &Connection,
    deck_id: i64,
    today: i32,
    _now_ms: i64,
    today_end_ms: i64,
    new_limit: u32,
    review_limit: u32,
) -> CoreResult<(u32, u32, u32)> {
    let is_filtered: bool = conn
        .query_row(
            "SELECT is_filtered != 0 FROM decks WHERE id = ?1",
            [deck_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .unwrap_or(false);
    let filt = i64::from(is_filtered);
    let learning: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ?1 AND queue NOT IN (-1,-2,-3)
             AND type IN (1, 3)
             AND (?4 != 0 OR (queue = 3 AND due <= ?2) OR (queue != 3 AND due < ?3))",
            params![deck_id, today, today_end_ms, filt],
            |r| r.get(0),
        )
        .map_err(err)?;
    let new_total: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ?1 AND queue NOT IN (-1,-2,-3)
             AND type = 0",
            [deck_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    let review_total: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ?1 AND queue NOT IN (-1,-2,-3)
             AND type = 2 AND (?3 != 0 OR due <= ?2)",
            params![deck_id, today, filt],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok((
        new_total.min(new_limit),
        learning,
        review_total.min(review_limit),
    ))
}

pub fn count_due(
    conn: &Connection,
    deck_id: i64,
    today: i32,
    now_ms: i64,
    today_end_ms: i64,
    new_limit: u32,
    review_limit: u32,
) -> CoreResult<u32> {
    let (n, l, r) = count_due_by_type(
        conn,
        deck_id,
        today,
        now_ms,
        today_end_ms,
        new_limit,
        review_limit,
    )?;
    Ok(n + l + r)
}

pub fn deck_due_counts(
    conn: &Connection,
    today: i32,
    now_ms: i64,
    today_end_ms: i64,
) -> CoreResult<HashMap<i64, (u32, u32, u32)>> {
    let _ = now_ms; // kept for API symmetry; learning gate now uses today_end_ms
    let mut stmt = conn
        .prepare(
            "SELECT c.deck_id,
                    SUM(CASE WHEN c.type = 0 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN c.type IN (1, 3) AND (d.is_filtered != 0 OR (c.queue = 3 AND c.due <= ?1) OR (c.queue != 3 AND c.due < ?2)) THEN 1 ELSE 0 END),
                    SUM(CASE WHEN c.type = 2 AND (d.is_filtered != 0 OR c.due <= ?1) THEN 1 ELSE 0 END)
             FROM cards c
             JOIN decks d ON d.id = c.deck_id
             WHERE c.queue NOT IN (-1, -2, -3)
             GROUP BY c.deck_id",
        )
        .map_err(err)?;
    let mut map = HashMap::new();
    let rows = stmt
        .query_map(params![today, today_end_ms], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, u32>(1)?,
                r.get::<_, u32>(2)?,
                r.get::<_, u32>(3)?,
            ))
        })
        .map_err(err)?;
    for row in rows {
        let (deck_id, new, learning, review) = row.map_err(err)?;
        map.insert(deck_id, (new, learning, review));
    }
    Ok(map)
}

/// `due` for a set of card ids, keyed by id. Used to merge multiple decks'
/// learning streams into one soonest-first order (see subdeck rollup in
/// `Collection::next_card_id`).
pub fn cards_due_ms(conn: &Connection, card_ids: &[i64]) -> CoreResult<HashMap<i64, i64>> {
    if card_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let json = serde_json::to_string(card_ids).map_err(err)?;
    let mut stmt = conn
        .prepare("SELECT id, due FROM cards WHERE id IN (SELECT value FROM json_each(?1))")
        .map_err(err)?;
    let mut map = HashMap::new();
    let rows = stmt
        .query_map([json], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))
        .map_err(err)?;
    for row in rows {
        let (id, due) = row.map_err(err)?;
        map.insert(id, due);
    }
    Ok(map)
}

/// Most recent revlog time (ms) per card id, keyed by id. `revlog.id` is the
/// epoch-ms answer time (see `apply_answer`), so `MAX(id)` is the last-answered
/// time. Cards with no revlog row are omitted from the map.
pub fn cards_last_answered(conn: &Connection, card_ids: &[i64]) -> CoreResult<HashMap<i64, i64>> {
    if card_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let json = serde_json::to_string(card_ids).map_err(err)?;
    let mut stmt = conn
        .prepare(
            "SELECT card_id, MAX(id) FROM revlog
             WHERE card_id IN (SELECT value FROM json_each(?1)) GROUP BY card_id",
        )
        .map_err(err)?;
    let mut map = HashMap::new();
    let rows = stmt
        .query_map([json], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))
        .map_err(err)?;
    for row in rows {
        let (id, last_ms) = row.map_err(err)?;
        map.insert(id, last_ms);
    }
    Ok(map)
}

/// Card id of the most recent revlog entry (`revlog.id` is the primary key
/// answer timestamp, so `ORDER BY id DESC LIMIT 1` is an O(1) lookup).
pub fn latest_answered_card_id(conn: &Connection) -> CoreResult<Option<i64>> {
    conn.query_row(
        "SELECT card_id FROM revlog ORDER BY id DESC LIMIT 1",
        [],
        |r| r.get(0),
    )
    .optional()
    .map_err(err)
}

pub fn study_card(conn: &Connection, card_id: i64) -> CoreResult<Option<StudyCard>> {
    let row = conn
        .query_row(
            "SELECT c.note_id, c.deck_id, c.ord, c.type, c.interval, c.ease_factor, c.reps,
                    c.lapses, c.remaining, c.fsrs_stability, c.fsrs_difficulty,
                    c.fsrs_last_review, n.fields, n.notetype_id, n.tags, c.flags,
                    d.name, c.due
             FROM cards c
             JOIN notes n ON n.id = c.note_id
             JOIN decks d ON d.id = c.deck_id
             WHERE c.id = ?1",
            [card_id],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    CardRow {
                        deck_id: r.get(1)?,
                        ord: r.get(2)?,
                        card_type: r.get(3)?,
                        interval: r.get(4)?,
                        ease_factor: r.get(5)?,
                        reps: r.get(6)?,
                        lapses: r.get(7)?,
                        remaining: r.get(8)?,
                        stability: r.get(9)?,
                        difficulty: r.get(10)?,
                        last_review: r.get(11)?,
                        fields: r.get(12)?,
                        notetype_id: r.get(13)?,
                        tags: r.get(14)?,
                        flags: r.get(15)?,
                        deck_name: r.get(16)?,
                        due: r.get(17)?,
                    },
                ))
            },
        )
        .optional()
        .map_err(err)?;
    let Some((note_id, row)) = row else {
        return Ok(None);
    };

    // Field names (ordered) zipped with the note's field values.
    let mut stmt = conn
        .prepare("SELECT name FROM fields WHERE notetype_id = ?1 ORDER BY ord")
        .map_err(err)?;
    let names: Vec<String> = stmt
        .query_map([row.notetype_id], |r| r.get(0))
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;
    let fields = names
        .into_iter()
        .zip(row.fields.split('\u{1f}').map(str::to_string))
        .collect::<Vec<(String, String)>>();

    // Template for this card's ord, falling back to ord 0 (cloze note types
    // have a single template shared by every cloze card).
    let template = conn
        .query_row(
            "SELECT qfmt, afmt, name FROM templates WHERE notetype_id = ?1 AND ord = ?2",
            params![row.notetype_id, row.ord],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(err)?;
    let (qfmt, afmt, template_name) = match template {
        Some(t) => t,
        None => conn
            .query_row(
                "SELECT qfmt, afmt, name FROM templates WHERE notetype_id = ?1 AND ord = 0",
                [row.notetype_id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(err)?
            .unwrap_or_default(),
    };

    let (is_cloze, notetype_name, css, occlusion_mode): (i64, String, String, String) = conn
        .query_row(
            "SELECT kind, name, coalesce(json_extract(config, '$.css'), ''),
                    coalesce(json_extract(config, '$.occlusionMode'), '')
             FROM notetypes WHERE id = ?1",
            [row.notetype_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(err)?
        .unwrap_or((0, String::new(), String::new(), String::new()));

    let tags = row.tags.split_whitespace().collect::<Vec<_>>().join(" ");
    let (deck, subdeck) = match row.deck_name.rsplit_once("::") {
        Some((_, leaf)) => (row.deck_name.clone(), leaf.to_string()),
        None => (row.deck_name.clone(), row.deck_name.clone()),
    };

    Ok(Some(StudyCard {
        id: card_id,
        note_id,
        deck_id: row.deck_id,
        due: row.due,
        render: CardRender {
            fields,
            qfmt,
            afmt,
            is_cloze: is_cloze == 1,
            card_ord: row.ord.max(0) as u16,
            tags,
            deck,
            subdeck,
            notetype: notetype_name,
            card_name: template_name,
            flag: row.flags.clamp(0, 7) as u8,
            css,
            occlusion_mode,
        },
        state: CardState {
            phase: type_to_phase(row.card_type),
            steps_remaining: row.remaining.max(0) as u32,
            interval_days: row.interval.max(0) as u32,
            ease_milli: if row.ease_factor > 0 {
                row.ease_factor as u32
            } else {
                2500
            },
            reps: row.reps.max(0) as u32,
            lapses: row.lapses.max(0) as u32,
            stability: row.stability,
            difficulty: row.difficulty,
            last_review_day: row.last_review.map(|d| d as i32),
        },
    }))
}

pub fn apply_answer(
    tx: &Transaction<'_>,
    card_id: i64,
    next: &CardState,
    due: i64,
    log: &Revlog,
    reward: Option<&bibalak_core::progress::RewardGrant>,
) -> CoreResult<bool> {
    apply_answer_returning_id(tx, card_id, next, due, log, reward).map(|(granted, _)| granted)
}

pub fn apply_answer_returning_id(
    tx: &Transaction<'_>,
    card_id: i64,
    next: &CardState,
    due: i64,
    log: &Revlog,
    reward: Option<&bibalak_core::progress::RewardGrant>,
) -> CoreResult<(bool, i64)> {
    let mut revlog_id = log.id;
    loop {
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM revlog WHERE id = ?1)",
                params![revlog_id],
                |row| row.get(0),
            )
            .map_err(err)?;
        if !exists {
            break;
        }
        revlog_id = revlog_id
            .checked_add(1)
            .ok_or_else(|| CoreError::Storage("revlog id overflow".into()))?;
    }

    let (card_type, queue) = phase_to_type_queue(next.phase);
    tx.execute(
        r#"UPDATE cards SET
             type = ?2, queue = ?3, due = ?4, interval = ?5, ease_factor = ?6,
             reps = ?7, lapses = ?8, remaining = ?9,
             fsrs_stability = ?10, fsrs_difficulty = ?11, fsrs_last_review = ?12,
             "mod" = ?13, usn = -1
           WHERE id = ?1"#,
        params![
            card_id,
            card_type,
            queue,
            due,
            next.interval_days as i64,
            next.ease_milli as i64,
            next.reps as i64,
            next.lapses as i64,
            next.steps_remaining as i64,
            next.stability,
            next.difficulty,
            next.last_review_day.map(i64::from),
            revlog_id,
        ],
    )
    .map_err(err)?;
    tx.execute(
        "INSERT INTO revlog
         (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
         VALUES (?1, ?2, -1, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            revlog_id,
            card_id,
            log.ease,
            log.interval,
            log.last_interval,
            log.ease_factor,
            log.taken_ms,
            log.review_kind,
        ],
    )
    .map_err(err)?;

    let granted = if let Some(r) = reward {
        let existing: Option<Option<i64>> = tx
            .query_row(
                "SELECT deleted_at FROM progress_ledger WHERE user_id = ?1 AND source_key = ?2",
                params![r.user_id, r.source_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(err)?;
        match existing {
            None => {
                tx.execute(
                    "INSERT INTO progress_ledger
                     (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, NULL, -1)",
                    params![
                        r.id,
                        r.user_id,
                        r.source_key,
                        r.xp,
                        r.gold_cents,
                        r.now_ms,
                    ],
                )
                .map_err(err)?;
                true
            }
            Some(Some(_deleted_at)) => {
                tx.execute(
                    "UPDATE progress_ledger
                     SET xp = ?1, gold_cents = ?2, created_at = ?3, updated_at = ?3, deleted_at = NULL, usn = -1
                     WHERE user_id = ?4 AND source_key = ?5",
                    params![r.xp, r.gold_cents, r.now_ms, r.user_id, r.source_key],
                )
                .map_err(err)?;
                true
            }
            Some(None) => false,
        }
    } else {
        false
    };
    Ok((granted, revlog_id))
}

#[allow(clippy::too_many_arguments)]
pub fn undo_answer(
    conn: &mut Connection,
    card_id: i64,
    prev: &CardState,
    prev_due: i64,
    revlog_id: i64,
    buried_siblings: &[i64],
    leech_note: Option<i64>,
    reward_source_key: Option<&str>,
    now_ms: i64,
) -> CoreResult<()> {
    let tx = conn.transaction().map_err(err)?;
    let (card_type, queue) = phase_to_type_queue(prev.phase);
    tx.execute(
        r#"UPDATE cards SET
             type = ?2, queue = ?3, due = ?4, interval = ?5, ease_factor = ?6,
             reps = ?7, lapses = ?8, remaining = ?9,
             fsrs_stability = ?10, fsrs_difficulty = ?11, fsrs_last_review = ?12,
             "mod" = ?13, usn = -1
           WHERE id = ?1"#,
        params![
            card_id,
            card_type,
            queue,
            prev_due,
            prev.interval_days as i64,
            prev.ease_milli as i64,
            prev.reps as i64,
            prev.lapses as i64,
            prev.steps_remaining as i64,
            prev.stability,
            prev.difficulty,
            prev.last_review_day.map(i64::from),
            now_ms,
        ],
    )
    .map_err(err)?;

    tx.execute("DELETE FROM revlog WHERE id = ?1", [revlog_id])
        .map_err(err)?;

    crate::game_depth::invalidate_studied_top_decks_tx(&tx)?;

    if !buried_siblings.is_empty() {
        let json = serde_json::to_string(buried_siblings).map_err(err)?;
        tx.execute(
            r#"UPDATE cards
               SET queue = CASE WHEN type = 3 THEN 1 ELSE type END, "mod" = ?2, usn = -1
               WHERE id IN (SELECT value FROM json_each(?1)) AND queue = -3"#,
            params![json, now_ms],
        )
        .map_err(err)?;
    }

    if let Some(note_id) = leech_note {
        let tags: String = tx
            .query_row("SELECT tags FROM notes WHERE id = ?1", [note_id], |r| {
                r.get(0)
            })
            .map_err(err)?;
        // Same " a b " format as everywhere else: `tag:` search matches "% a %".
        let kept: Vec<&str> = tags.split_whitespace().filter(|&t| t != "leech").collect();
        let filtered = if kept.is_empty() {
            String::new()
        } else {
            format!(" {} ", kept.join(" "))
        };
        tx.execute(
            r#"UPDATE notes SET tags = ?1, "mod" = ?2, usn = -1 WHERE id = ?3"#,
            params![filtered, now_ms, note_id],
        )
        .map_err(err)?;
    }

    if let Some(source_key) = reward_source_key {
        tx.execute(
            "UPDATE progress_ledger
             SET deleted_at = ?1, updated_at = ?1, usn = -1
             WHERE user_id = ?2 AND source_key = ?3 AND deleted_at IS NULL",
            params![now_ms, bibalak_core::progress::NIL_USER_ID, source_key],
        )
        .map_err(err)?;
        crate::game_depth::invalidate_earned_xp_cache_tx(&tx, bibalak_core::progress::NIL_USER_ID)?;
        let lid =
            bibalak_core::progress::ledger_id(bibalak_core::progress::NIL_USER_ID, source_key);
        crate::game_depth::revoke_pet_credit_tx(
            &tx,
            bibalak_core::progress::NIL_USER_ID,
            &lid,
            now_ms,
        )?;
    }

    tx.commit().map_err(err)?;
    Ok(())
}

pub fn progress_totals(
    conn: &Connection,
    user_id: &str,
    today_start_ms: i64,
    today_end_ms: i64,
) -> CoreResult<bibalak_core::progress::ProgressTotals> {
    let (total_xp, gold_cents): (i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(xp), 0), COALESCE(SUM(gold_cents), 0)
             FROM progress_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL",
            params![user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;
    let (today_xp, today_gold_cents, tasks_rewarded_today): (i64, i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(xp), 0),
                    COALESCE(SUM(gold_cents), 0),
                    COALESCE(SUM(CASE WHEN source_key LIKE 'task_done:%' THEN 1 ELSE 0 END), 0)
             FROM progress_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL AND created_at >= ?2 AND created_at < ?3",
            params![user_id, today_start_ms, today_end_ms],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(err)?;
    Ok(bibalak_core::progress::ProgressTotals {
        total_xp: total_xp.max(0) as u64,
        gold_cents: gold_cents.max(0) as u64,
        today_xp: today_xp.max(0) as u64,
        today_gold_cents: today_gold_cents.max(0) as u64,
        tasks_rewarded_today: tasks_rewarded_today.max(0) as u32,
    })
}

pub fn get_active_ledger_reward(
    conn: &Connection,
    user_id: &str,
    source_key: &str,
) -> CoreResult<Option<bibalak_core::progress::RewardGrant>> {
    conn.query_row(
        "SELECT id, user_id, source_key, xp, gold_cents, created_at
         FROM progress_ledger
         WHERE user_id = ?1 AND source_key = ?2 AND deleted_at IS NULL",
        params![user_id, source_key],
        |r| {
            Ok(bibalak_core::progress::RewardGrant {
                id: r.get(0)?,
                user_id: r.get(1)?,
                source_key: r.get(2)?,
                xp: r.get(3)?,
                gold_cents: r.get(4)?,
                now_ms: r.get(5)?,
            })
        },
    )
    .optional()
    .map_err(err)
}

pub fn deck_review_count_in_window(
    conn: &Connection,
    deck_id: i64,
    start_ms: i64,
    end_ms: i64,
) -> CoreResult<u32> {
    let decks = load_decks_meta(conn)?;
    let deck_pairs: Vec<(i64, Option<i64>)> = decks
        .into_iter()
        .map(|(id, _, parent)| (id, parent))
        .collect();
    let subtree = bibalak_core::progress::deck_subtree_ids(&deck_pairs, deck_id);
    if subtree.is_empty() {
        return Ok(0);
    }
    let subtree_json =
        serde_json::to_string(&subtree.into_iter().collect::<Vec<i64>>()).map_err(err)?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM revlog r
             JOIN cards c ON c.id = r.card_id
             WHERE r.id >= ?1 AND r.id < ?2
               AND r.review_kind IN (0, 1, 2, 3)
               AND c.deck_id IN (SELECT value FROM json_each(?3))",
            params![start_ms, end_ms, subtree_json],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok(count.max(0) as u32)
}

pub fn yesterday_activity(
    conn: &Connection,
    user_id: &str,
    yesterday_day: i32,
    yesterday_start_ms: i64,
    yesterday_end_ms: i64,
) -> CoreResult<bibalak_core::progress::YesterdayActivity> {
    let reviews: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM revlog
             WHERE id >= ?1 AND id < ?2 AND review_kind IN (0, 1, 2, 3)",
            params![yesterday_start_ms, yesterday_end_ms],
            |r| r.get(0),
        )
        .map_err(err)?;
    let tasks_completed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks
             WHERE user_id = ?1 AND deleted_at IS NULL AND completed_day = ?2",
            params![user_id, yesterday_day],
            |r| r.get(0),
        )
        .map_err(err)?;
    let habits_completed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM habit_logs
             WHERE user_id = ?1 AND deleted_at IS NULL AND day_index = ?2 AND completed = 1",
            params![user_id, yesterday_day],
            |r| r.get(0),
        )
        .map_err(err)?;
    let (xp, gold_cents): (i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(xp), 0), COALESCE(SUM(gold_cents), 0)
             FROM progress_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL AND created_at >= ?2 AND created_at < ?3",
            params![user_id, yesterday_start_ms, yesterday_end_ms],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;
    Ok(bibalak_core::progress::YesterdayActivity {
        reviews: reviews.max(0) as u32,
        tasks_completed: tasks_completed.max(0) as u32,
        habits_completed: habits_completed.max(0) as u32,
        xp: xp.max(0) as u64,
        gold_cents: gold_cents.max(0) as u64,
    })
}

fn load_active_rewards(
    conn: &Connection,
    user_id: &str,
) -> CoreResult<Vec<bibalak_core::progress::LedgerRewardInput>> {
    let mut stmt = conn
        .prepare(
            "SELECT source_key, xp, gold_cents, created_at
             FROM progress_ledger
             WHERE user_id = ?1 AND deleted_at IS NULL",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![user_id], |r| {
            Ok(bibalak_core::progress::LedgerRewardInput {
                source_key: r.get(0)?,
                xp: r.get(1)?,
                gold_cents: r.get(2)?,
                created_at: r.get(3)?,
            })
        })
        .map_err(err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(err)?);
    }
    Ok(out)
}

fn load_decks_meta(conn: &Connection) -> CoreResult<Vec<(i64, String, Option<i64>)>> {
    let mut stmt = conn
        .prepare("SELECT id, name, parent_id FROM decks")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(err)?);
    }
    Ok(out)
}

fn load_study_revlogs(
    conn: &Connection,
) -> CoreResult<Vec<bibalak_core::progress::StudyRevlogInput>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, card_id, ease, taken_ms, review_kind
             FROM revlog
             ORDER BY id",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(bibalak_core::progress::StudyRevlogInput {
                id: r.get(0)?,
                card_id: r.get(1)?,
                ease: r.get(2)?,
                taken_ms: r.get(3)?,
                review_kind: r.get(4)?,
            })
        })
        .map_err(err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(err)?);
    }
    Ok(out)
}

pub fn progress_history(
    conn: &Connection,
    user_id: &str,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
) -> CoreResult<(Vec<bibalak_core::progress::ProgressDay>, usize)> {
    let rewards = load_active_rewards(conn, user_id)?;
    Ok(bibalak_core::progress::aggregate_progress_history(
        rewards,
        tz_offset_minutes,
        rollover_hour,
        created_ms,
    ))
}

pub fn study_days(
    conn: &Connection,
    user_id: &str,
    limit: u32,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
) -> CoreResult<(Vec<bibalak_core::progress::StudyDay>, usize)> {
    let decks = load_decks_meta(conn)?;
    let top_lookup = bibalak_core::progress::build_top_deck_lookup(decks);
    let mut card_top_decks = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT id, deck_id FROM cards").map_err(err)?;
        let mut rows = stmt.query([]).map_err(err)?;
        while let Some(r) = rows.next().map_err(err)? {
            let card_id: i64 = r.get(0).map_err(err)?;
            let deck_id: i64 = r.get(1).map_err(err)?;
            if let Some(&(top_id, _)) = top_lookup.get(&deck_id) {
                card_top_decks.insert(card_id, top_id);
            }
        }
    }
    let revlogs = load_study_revlogs(conn)?;
    let mut completed_task_days = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT completed_day FROM tasks
                 WHERE user_id = ?1 AND deleted_at IS NULL AND completed_day IS NOT NULL",
            )
            .map_err(err)?;
        let mut rows = stmt.query(params![user_id]).map_err(err)?;
        while let Some(r) = rows.next().map_err(err)? {
            completed_task_days.push(r.get(0).map_err(err)?);
        }
    }
    let mut completed_habit_days = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT day_index FROM habit_logs
                 WHERE user_id = ?1 AND deleted_at IS NULL AND completed = 1",
            )
            .map_err(err)?;
        let mut rows = stmt.query(params![user_id]).map_err(err)?;
        while let Some(r) = rows.next().map_err(err)? {
            completed_habit_days.push(r.get(0).map_err(err)?);
        }
    }
    let rewards = load_active_rewards(conn, user_id)?;
    Ok(bibalak_core::progress::aggregate_study_days(
        revlogs,
        &card_top_decks,
        completed_task_days,
        completed_habit_days,
        rewards,
        limit,
        tz_offset_minutes,
        rollover_hour,
        created_ms,
    ))
}

pub fn progress_by_deck(
    conn: &Connection,
    user_id: &str,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    now_ms: i64,
    created_ms: i64,
) -> CoreResult<(Vec<bibalak_core::progress::DeckProgress>, usize)> {
    let decks = load_decks_meta(conn)?;
    let top_lookup = bibalak_core::progress::build_top_deck_lookup(decks.clone());
    let mut habit_top_decks = HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, deck_id FROM habits
                 WHERE user_id = ?1 AND deleted_at IS NULL AND deck_id IS NOT NULL",
            )
            .map_err(err)?;
        let mut rows = stmt.query(params![user_id]).map_err(err)?;
        while let Some(r) = rows.next().map_err(err)? {
            let habit_id: String = r.get(0).map_err(err)?;
            let deck_id: i64 = r.get(1).map_err(err)?;
            if let Some(&(top_id, _)) = top_lookup.get(&deck_id) {
                habit_top_decks.insert(habit_id, top_id);
            }
        }
    }
    let mut cards = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, deck_id, type, queue, interval FROM cards ORDER BY id")
            .map_err(err)?;
        let mut rows = stmt.query([]).map_err(err)?;
        while let Some(r) = rows.next().map_err(err)? {
            cards.push(bibalak_core::progress::DeckCardInput {
                card_id: r.get(0).map_err(err)?,
                deck_id: r.get(1).map_err(err)?,
                ctype: r.get(2).map_err(err)?,
                queue: r.get(3).map_err(err)?,
                interval: r.get(4).map_err(err)?,
            });
        }
    }
    let revlogs = load_study_revlogs(conn)?;
    let rewards = load_active_rewards(conn, user_id)?;
    Ok(bibalak_core::progress::aggregate_progress_by_deck(
        decks,
        cards,
        revlogs,
        &habit_top_decks,
        rewards,
        tz_offset_minutes,
        rollover_hour,
        now_ms,
        created_ms,
    ))
}

struct CardRow {
    deck_id: i64,
    ord: i64,
    card_type: i64,
    interval: i64,
    ease_factor: i64,
    reps: i64,
    lapses: i64,
    remaining: i64,
    stability: Option<f64>,
    difficulty: Option<f64>,
    last_review: Option<i64>,
    fields: String,
    notetype_id: i64,
    tags: String,
    flags: i64,
    deck_name: String,
    due: i64,
}

#[cfg(test)]
mod tests {
    use crate::storage::SqliteStorage;
    use bibalak_core::model::{
        CanonicalModel, Card, CardRender, Deck, Field, Note, Notetype, Revlog, Template,
    };
    use bibalak_core::ports::*;
    use bibalak_core::scheduling::{CardPhase, CardState};
    use rusqlite::params;

    fn model() -> CanonicalModel {
        CanonicalModel {
            decks: vec![Deck {
                id: 1,
                name: "Default".into(),
                parent_id: None,
                config_id: 1,
                mod_ms: 0,
                usn: -1,
                collapsed: false,
                is_filtered: false,
            }],
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
                afmt: "{{Back}}".into(),
                config_json: "{}".into(),
            }],
            notes: vec![Note {
                id: 100,
                guid: "g1".into(),
                notetype_id: 10,
                mod_ms: 0,
                usn: -1,
                tags: vec![],
                fields: vec!["hola".into(), "hello".into()],
                sort_field: Some("hola".into()),
                checksum: None,
            }],
            cards: vec![Card {
                id: 1000,
                note_id: 100,
                deck_id: 1,
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
            ..Default::default()
        }
    }

    #[test]
    fn queue_render_and_answer_roundtrip() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(1_700_000_000_000).unwrap();
        storage.import(&model(), 1_700_000_000_000).unwrap();

        // The new card is queued for the Default deck (id 1).
        let queue = storage
            .study_queue(1, 0, 1_700_000_000_000, 1_700_086_400_000, 20, 200)
            .unwrap();
        assert_eq!(queue.new.len(), 1);
        assert!(queue.learning.is_empty() && queue.review.is_empty());
        let card_id = queue.new[0];

        let study = storage.study_card(card_id).unwrap().unwrap();
        assert_eq!(study.state.phase, CardPhase::New);
        assert_eq!(
            study.render,
            CardRender {
                fields: vec![
                    ("Front".into(), "hola".into()),
                    ("Back".into(), "hello".into())
                ],
                qfmt: "{{Front}}".into(),
                afmt: "{{Back}}".into(),
                is_cloze: false,
                card_ord: 0,
                tags: "".into(),
                deck: "Default".into(),
                subdeck: "Default".into(),
                notetype: "Basic".into(),
                card_name: "Card 1".into(),
                flag: 0,
                css: "".into(),
                occlusion_mode: "".into(),
            }
        );

        // Answer Good → becomes a Review card due tomorrow; no longer due today.
        let next = CardState {
            phase: CardPhase::Review,
            interval_days: 1,
            reps: 1,
            last_review_day: Some(0),
            ..study.state
        };
        let log = Revlog {
            id: 1_700_000_001_000,
            card_id,
            usn: -1,
            ease: 3,
            interval: 1,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 1500,
            review_kind: 0,
        };
        storage.apply_answer(card_id, &next, 1, &log, None).unwrap();

        let queue = storage
            .study_queue(1, 0, 1_700_000_000_000, 1_700_086_400_000, 20, 200)
            .unwrap();
        assert!(queue.new.is_empty() && queue.learning.is_empty() && queue.review.is_empty());
        assert_eq!(
            storage.study_card(card_id).unwrap().unwrap().state.phase,
            CardPhase::Review
        );
    }

    /// A learning card builder: `due` is epoch-ms, `ctype`/`queue` mark it as
    /// (re)learning. Reuses the `model()` deck/notetype/template.
    fn model_with_cards(cards: Vec<Card>) -> CanonicalModel {
        let mut m = model();
        // Give each card its own note so the notes table stays consistent.
        m.notes = cards
            .iter()
            .enumerate()
            .map(|(i, c)| Note {
                id: c.note_id,
                guid: format!("g{i}"),
                notetype_id: 10,
                mod_ms: 0,
                usn: -1,
                tags: vec![],
                fields: vec!["q".into(), "a".into()],
                sort_field: Some("q".into()),
                checksum: None,
            })
            .collect();
        m.cards = cards;
        m
    }

    fn card(id: i64, ctype: i64, queue: i64, due: i64) -> Card {
        Card {
            id,
            note_id: id + 1_000,
            deck_id: 1,
            ord: 0,
            mod_ms: 0,
            usn: -1,
            ctype,
            queue,
            due,
            interval: 0,
            ease_factor: 2500,
            reps: 0,
            lapses: 0,
            remaining: 1,
            original_due: 0,
            original_deck_id: 0,
            flags: 0,
            fsrs_stability: None,
            fsrs_difficulty: None,
            fsrs_last_review: None,
            data: None,
        }
    }

    const NOW: i64 = 1_700_000_000_000;
    const MIN_MS: i64 = 60_000;
    // today_end_ms: since ensure_collection(NOW) sets created_ms=NOW and today=0,
    // tomorrow starts at NOW + 1 day.
    const TODAY_END: i64 = NOW + 86_400_000;

    #[test]
    fn learning_card_due_later_today_counted_in_badge() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(NOW).unwrap();
        // A learning card due in 10 min and a brand-new card.
        storage
            .import(
                &model_with_cards(vec![
                    card(1, 1, 1, NOW + 10 * MIN_MS), // learning, due later today
                    card(2, 0, 0, 0),                 // new
                ]),
                NOW,
            )
            .unwrap();

        let q = storage.study_queue(1, 0, NOW, TODAY_END, 20, 200).unwrap();
        // Future learning card is gated out of the immediate queue.
        assert!(q.learning.is_empty());
        assert_eq!(q.new, vec![2]);
        // Due today → eligible as learn-ahead fallback.
        assert_eq!(q.learning_ahead, vec![1]);

        // Badge count includes the learning card (due today, even though not due yet).
        let (new, learning, review) = storage
            .count_due_by_type(1, 0, NOW, TODAY_END, 20, 200)
            .unwrap();
        assert_eq!((new, learning, review), (1, 1, 0));
    }

    #[test]
    fn learn_ahead_returns_all_candidates_ordered_by_due() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(NOW).unwrap();
        storage
            .import(
                &model_with_cards(vec![
                    card(1, 1, 1, NOW + 20 * MIN_MS), // learning, due later
                    card(2, 1, 1, NOW + 5 * MIN_MS),  // learning, due sooner
                ]),
                NOW,
            )
            .unwrap();

        let q = storage.study_queue(1, 0, NOW, TODAY_END, 20, 200).unwrap();
        assert_eq!(q.learning_ahead, vec![2, 1]);
    }

    #[test]
    fn cards_last_answered_reports_max_revlog_time_and_omits_unanswered() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(NOW).unwrap();
        storage
            .import(
                &model_with_cards(vec![
                    card(1, 0, 0, 0), // never answered
                    card(2, 0, 0, 0),
                ]),
                NOW,
            )
            .unwrap();

        let next = CardState {
            phase: CardPhase::Learning,
            steps_remaining: 1,
            ..CardState::new(2500)
        };
        for (log_id, ease) in [(NOW, 1), (NOW + MIN_MS, 1)] {
            let log = Revlog {
                id: log_id,
                card_id: 2,
                usn: -1,
                ease,
                interval: 0,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 0,
                review_kind: 0,
            };
            storage
                .apply_answer(2, &next, NOW + MIN_MS, &log, None)
                .unwrap();
        }

        let last = storage.cards_last_answered(&[1, 2]).unwrap();
        assert_eq!(last.get(&2), Some(&(NOW + MIN_MS)));
        assert!(!last.contains_key(&1));
    }

    #[test]
    fn learning_card_due_now_is_served_first() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(NOW).unwrap();
        storage
            .import(
                &model_with_cards(vec![
                    card(1, 1, 1, NOW - MIN_MS), // learning, overdue
                    card(2, 0, 0, 0),            // new
                ]),
                NOW,
            )
            .unwrap();

        let q = storage.study_queue(1, 0, NOW, TODAY_END, 20, 200).unwrap();
        assert_eq!(q.learning, vec![1]);
        let (_, learning, _) = storage
            .count_due_by_type(1, 0, NOW, TODAY_END, 20, 200)
            .unwrap();
        assert_eq!(learning, 1);
    }

    #[test]
    fn new_cards_keep_rough_frequency_order() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(NOW).unwrap();
        // 50 new cards, `due` = frequency rank 1..=50 (most frequent first).
        let cards: Vec<Card> = (1..=50).map(|p| card(p, 0, 0, p)).collect();
        storage.import(&model_with_cards(cards), NOW).unwrap();

        let q = storage.study_queue(1, 0, NOW, TODAY_END, 100, 200).unwrap();
        assert_eq!(q.new.len(), 50);

        // Jitter is bounded: a card at rank `p` gets a key in `[p, p+JITTER)`, so
        // at most JITTER-1 lower-ranked cards can overtake it. Rank-1 card (id 1)
        // therefore cannot drift past index JITTER-1.
        let jitter = 5usize; // mirrors NEW_ORDER_JITTER
        let pos_of_1 = q.new.iter().position(|&id| id == 1).unwrap();
        assert!(pos_of_1 < jitter, "rank-1 card drifted to {pos_of_1}");

        // But it is jittered, not a strict sort — over the first chunk the order
        // should differ from perfectly ascending at least once across a few runs.
        let strictly_sorted = (0..20).all(|i| q.new[i] == (i as i64) + 1);
        let mut any_jitter = !strictly_sorted;
        for _ in 0..8 {
            let q2 = storage.study_queue(1, 0, NOW, TODAY_END, 100, 200).unwrap();
            if (0..20).any(|i| q2.new[i] != (i as i64) + 1) {
                any_jitter = true;
            }
        }
        assert!(any_jitter, "order never jittered across runs");
    }

    #[test]
    fn learning_card_due_tomorrow_not_in_learn_ahead() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(NOW).unwrap();
        // One learning card due tomorrow — beyond today_end_ms.
        storage
            .import(
                &model_with_cards(vec![card(1, 1, 1, NOW + 2 * 86_400_000)]),
                NOW,
            )
            .unwrap();

        let q = storage.study_queue(1, 0, NOW, TODAY_END, 20, 200).unwrap();
        assert!(q.learning.is_empty() && q.new.is_empty() && q.review.is_empty());
        assert!(q.learning_ahead.is_empty());
    }

    // ── Performance regression guards ─────────────────────────────────────────

    /// Build a storage with `n` review cards (all due today) in the Default deck.
    /// Migrations seed deck_config(1) and deck(1). Insert notetype with explicit
    /// id=10 so bulk note inserts satisfy the FK on notes.notetype_id.
    fn storage_with_reviews(n: usize) -> SqliteStorage {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let conn = storage.lock();
        conn.execute(
            r#"INSERT INTO notetypes (id, name, kind, "mod", usn, config)
               VALUES (10, 'Basic', 0, 0, -1, '{}')"#,
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO fields (notetype_id, ord, name, config) VALUES (10, 0, 'Front', '{}')",
            [],
        )
        .unwrap();
        conn.execute_batch("BEGIN").unwrap();
        for i in 1..=(n as i64) {
            let note_id = i + 1_000_000;
            conn.execute(
                r#"INSERT INTO notes (id, guid, notetype_id, "mod", usn, tags, fields, sort_field, checksum)
                   VALUES (?1, ?2, 10, 0, -1, '', 'q', 'q', 0)"#,
                rusqlite::params![note_id, format!("pg{i}")],
            ).unwrap();
            conn.execute(
                r#"INSERT INTO cards (id, note_id, deck_id, ord, "mod", usn, type, queue, due,
                    interval, ease_factor, reps, lapses, remaining, original_due,
                    original_deck_id, flags, fsrs_stability, fsrs_difficulty,
                    fsrs_last_review, data)
                   VALUES (?1, ?2, 1, 0, 0, -1, 2, 2, 0, 10, 2500, 3, 0, 0, 0, 0, 0,
                           4.0, 5.0, 0, '')"#,
                rusqlite::params![i, note_id],
            )
            .unwrap();
        }
        conn.execute_batch("COMMIT").unwrap();
        drop(conn);
        storage
    }

    #[test]
    fn study_queue_builds_under_500ms_for_10k_reviews() {
        let storage = storage_with_reviews(10_000);
        let start = std::time::Instant::now();
        let q = storage.study_queue(1, 0, NOW, TODAY_END, 20, 9999).unwrap();
        let elapsed = start.elapsed();
        // Queue is capped at rev_per_day=9999 but all 10k are eligible.
        assert!(!q.review.is_empty(), "expected non-empty review queue");
        assert!(
            elapsed.as_millis() < 500,
            "study_queue took {}ms for 10k cards (budget 500ms)",
            elapsed.as_millis()
        );
    }

    #[test]
    fn due_count_under_200ms_for_10k_cards() {
        let storage = storage_with_reviews(10_000);
        let start = std::time::Instant::now();
        let (new, learning, review) = storage
            .count_due_by_type(1, 0, NOW, TODAY_END, 20, 9999)
            .unwrap();
        let elapsed = start.elapsed();
        assert_eq!(new, 0);
        assert_eq!(learning, 0);
        assert_eq!(review, 9999); // capped at rev_per_day
        assert!(
            elapsed.as_millis() < 200,
            "count_due_by_type took {}ms for 10k cards (budget 200ms)",
            elapsed.as_millis()
        );
    }

    #[test]
    fn apply_answer_and_undo_restores_state_and_siblings() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(NOW).unwrap();
        // Create 2 cards for note 100
        let mut c1 = card(1, 0, 0, 10);
        c1.note_id = 100;
        c1.ord = 0;
        let mut c2 = card(2, 0, 0, 20);
        c2.note_id = 100;
        c2.ord = 1;
        let mut m = model();
        m.templates.push(Template {
            notetype_id: 10,
            ord: 1,
            name: "Card 2".into(),
            qfmt: "{{Back}}".into(),
            afmt: "{{Front}}".into(),
            config_json: "{}".into(),
        });
        m.notes = vec![Note {
            id: 100,
            guid: "g100".into(),
            notetype_id: 10,
            mod_ms: 0,
            usn: -1,
            tags: vec![],
            fields: vec!["q".into(), "a".into()],
            sort_field: Some("q".into()),
            checksum: None,
        }];
        m.cards = vec![c1, c2];
        storage.import(&m, NOW).unwrap();

        let initial_card1 = storage.study_card(1).unwrap().unwrap();
        assert_eq!(initial_card1.due, 10);

        let next = CardState {
            phase: CardPhase::Review,
            steps_remaining: 0,
            interval_days: 1,
            ease_milli: 2500,
            reps: 1,
            lapses: 0,
            stability: Some(2.0),
            difficulty: Some(5.0),
            last_review_day: Some(0),
        };
        let log = Revlog {
            id: NOW,
            card_id: 1,
            usn: -1,
            ease: 3,
            interval: 1,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 3000,
            review_kind: 0,
        };

        // Apply answer and bury siblings
        {
            let mut conn = storage.lock();
            let tx = conn.transaction().unwrap();
            super::apply_answer(&tx, 1, &next, 1, &log, None).unwrap();
            tx.commit().unwrap();
        }
        let buried = storage
            .bury_siblings(initial_card1.note_id, 1, NOW)
            .unwrap();
        assert_eq!(buried, vec![2]);

        // Sibling card 2 is buried (queue = -3)
        let q2: i64 = storage
            .lock()
            .query_row("SELECT queue FROM cards WHERE id = 2", [], |r| r.get(0))
            .unwrap();
        assert_eq!(q2, -3);

        // Revlog exists
        let revlog_count: i64 = storage
            .lock()
            .query_row("SELECT count(*) FROM revlog WHERE id = ?1", [NOW], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(revlog_count, 1);

        // Now undo the answer
        storage
            .undo_answer(
                1,
                &initial_card1.state,
                initial_card1.due,
                NOW,
                &buried,
                None,
                None,
                NOW + 1_000,
            )
            .unwrap();

        // Check card 1 state is restored
        let restored_card1 = storage.study_card(1).unwrap().unwrap();
        assert_eq!(restored_card1.due, 10);
        assert_eq!(restored_card1.state.phase, CardPhase::New);
        assert_eq!(restored_card1.state.reps, 0);

        // Check revlog row is deleted
        let revlog_count_after: i64 = storage
            .lock()
            .query_row("SELECT count(*) FROM revlog WHERE id = ?1", [NOW], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(revlog_count_after, 0);

        // Check sibling card 2 is restored to its natural queue (0)
        let q2_after: i64 = storage
            .lock()
            .query_row("SELECT queue FROM cards WHERE id = 2", [], |r| r.get(0))
            .unwrap();
        assert_eq!(q2_after, 0);
    }

    /// Undoing a leech answer removes only the "leech" tag and keeps the
    /// space-delimited format that `tag:` search relies on.
    #[test]
    fn undo_answer_removing_leech_keeps_tags_searchable() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(NOW).unwrap();
        let mut m = model();
        m.notes[0].tags = vec!["verb".into(), "spanish".into()];
        storage.import(&m, NOW).unwrap();
        let card_id: i64 = storage
            .lock()
            .query_row("SELECT id FROM cards LIMIT 1", [], |r| r.get(0))
            .unwrap();
        let before = storage.study_card(card_id).unwrap().unwrap();
        let note_id = before.note_id;
        storage.add_note_tag(note_id, "leech", NOW).unwrap();

        storage
            .undo_answer(
                card_id,
                &before.state,
                before.due,
                NOW,
                &[],
                Some(note_id),
                None,
                NOW + 1_000,
            )
            .unwrap();

        let tags: String = storage
            .lock()
            .query_row("SELECT tags FROM notes WHERE id = ?1", [note_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(tags, " verb spanish ");
        let hits = storage
            .search_cards("tag:spanish", 0, NOW, 100, 0, None, true)
            .unwrap();
        assert_eq!(hits.len(), 1, "note must still match tag search after undo");
    }

    #[test]
    fn new_card_queue_never_returns_cards_past_limit_plus_jitter() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(NOW).unwrap();
        let mut m = model();
        let template_note = m.notes[0].clone();
        m.notes.clear();
        m.cards.clear();
        for i in 0..50_i64 {
            let mut note = template_note.clone();
            note.id = 100 + i;
            note.guid = format!("g-{i}");
            note.fields = vec![format!("card {i}")];
            note.sort_field = Some(format!("card {i}"));
            m.notes.push(note);
            m.cards.push(Card {
                id: 1000 + i,
                note_id: 100 + i,
                deck_id: 1,
                ord: 0,
                mod_ms: 0,
                usn: -1,
                ctype: 0,
                queue: 0,
                due: i,
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
            });
        }
        storage.import(&m, NOW).unwrap();
        for _ in 0..20 {
            let q = storage
                .study_queue(1, 0, NOW, NOW + 86_400_000, 5, 0)
                .unwrap();
            assert_eq!(q.new.len(), 5);
            let conn = storage.lock();
            for cid in q.new {
                let due: i64 = conn
                    .query_row("SELECT due FROM cards WHERE id = ?1", [cid], |r| r.get(0))
                    .unwrap();
                assert!(
                    due < 5 + super::NEW_ORDER_JITTER - 1,
                    "due {due} exceeded max reachable rank"
                );
            }
        }
    }

    // ── Progress engine & undo-safe reward ledger (ADR-019, R1) ───────────────

    fn sample_answer_state_and_log(
        card_id: i64,
        now_ms: i64,
        ease: i64,
        review_kind: i64,
    ) -> (CardState, Revlog) {
        let next = CardState {
            phase: CardPhase::Review,
            steps_remaining: 0,
            interval_days: 1,
            ease_milli: 2500,
            reps: 1,
            lapses: 0,
            stability: Some(2.0),
            difficulty: Some(5.0),
            last_review_day: Some(0),
        };
        let log = Revlog {
            id: now_ms,
            card_id,
            usn: -1,
            ease,
            interval: 1,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 1500,
            review_kind,
        };
        (next, log)
    }

    #[test]
    fn answer_card_grants_reward_and_undo_revokes_it() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(NOW).unwrap();
        storage
            .import(&model_with_cards(vec![card(1, 0, 0, 0)]), NOW)
            .unwrap();

        let clock = std::sync::Arc::new(bibalak_core::ports::TestClock::new(NOW));
        let c = bibalak_core::Collection::new(Box::new(storage), clock.clone()).unwrap();

        let before = c.study_card(1).unwrap().unwrap();
        let (next, log) = sample_answer_state_and_log(1, NOW, 3, 0);

        // Answer Good -> +3 XP, +25 gold_cents
        c.apply_answer(
            1,
            before.note_id,
            &before.state,
            before.due,
            &next,
            1,
            &log,
            8,
        )
        .unwrap();
        let summary = c.progress_summary().unwrap();
        assert_eq!(summary.level, 1);
        assert_eq!(summary.xp_into_level, 3);
        assert_eq!(summary.xp_to_next_level, 100);
        assert_eq!(summary.total_xp, 3);
        assert_eq!(summary.gold_cents, 25);
        assert_eq!(summary.today_xp, 3);
        assert_eq!(summary.today_gold_cents, 25);

        // Undo -> soft-deletes reward row; totals drop to 0
        clock.set(NOW + 1_000);
        c.undo().unwrap();
        let after_undo = c.progress_summary().unwrap();
        assert_eq!(after_undo.total_xp, 0);
        assert_eq!(after_undo.gold_cents, 0);
        assert_eq!(after_undo.today_xp, 0);
        assert_eq!(after_undo.today_gold_cents, 0);

        // Answer again on the same day -> re-activates row; totals return to +3/+25 once
        clock.set(NOW + 2_000);
        let (_, log2) = sample_answer_state_and_log(1, NOW + 2_000, 3, 0);
        c.apply_answer(
            1,
            before.note_id,
            &before.state,
            before.due,
            &next,
            1,
            &log2,
            8,
        )
        .unwrap();
        let after_reanswer = c.progress_summary().unwrap();
        assert_eq!(after_reanswer.total_xp, 3);
        assert_eq!(after_reanswer.gold_cents, 25);
        assert_eq!(after_reanswer.today_xp, 3);
        assert_eq!(after_reanswer.today_gold_cents, 25);
    }

    #[test]
    fn same_day_second_answer_is_noop_and_its_undo_keeps_first_reward_active() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(NOW).unwrap();
        storage
            .import(&model_with_cards(vec![card(1, 0, 0, 0)]), NOW)
            .unwrap();

        let clock = std::sync::Arc::new(bibalak_core::ports::TestClock::new(NOW));
        let c = bibalak_core::Collection::new(Box::new(storage), clock.clone()).unwrap();
        let before = c.study_card(1).unwrap().unwrap();
        let (next, log1) = sample_answer_state_and_log(1, NOW, 3, 0);

        // 1. First answer grants +3 XP, +25 gold_cents
        c.apply_answer(
            1,
            before.note_id,
            &before.state,
            before.due,
            &next,
            1,
            &log1,
            8,
        )
        .unwrap();
        assert_eq!(c.progress_summary().unwrap().total_xp, 3);

        // 2. Second same-day answer on the same card is a reward no-op (still 1 active reward)
        clock.set(NOW + 1_000);
        let (_, log2) = sample_answer_state_and_log(1, NOW + 1_000, 4, 1);
        c.apply_answer(1, before.note_id, &next, 1, &next, 2, &log2, 8)
            .unwrap();
        let after_second = c.progress_summary().unwrap();
        assert_eq!(after_second.total_xp, 3);
        assert_eq!(after_second.gold_cents, 25);

        // 3. Undo of the second (no-op) answer must NOT revoke the first answer's reward!
        clock.set(NOW + 2_000);
        c.undo().unwrap();
        let after_second_undo = c.progress_summary().unwrap();
        assert_eq!(
            after_second_undo.total_xp, 3,
            "undoing a non-granting same-day answer must leave the original reward active"
        );
        assert_eq!(after_second_undo.gold_cents, 25);

        // 4. Undo of the first answer revokes its reward, and 20 answer->undo->answer loops
        // end with exactly one active reward.
        clock.set(NOW + 3_000);
        c.undo().unwrap();
        assert_eq!(c.progress_summary().unwrap().total_xp, 0);

        let mut t = NOW + 4_000;
        for _ in 0..20 {
            clock.set(t);
            let (_, l) = sample_answer_state_and_log(1, t, 3, 0);
            c.apply_answer(
                1,
                before.note_id,
                &before.state,
                before.due,
                &next,
                1,
                &l,
                8,
            )
            .unwrap();
            t += 1_000;
            clock.set(t);
            c.undo().unwrap();
            t += 1_000;
        }
        clock.set(t);
        let (_, final_log) = sample_answer_state_and_log(1, t, 3, 0);
        c.apply_answer(
            1,
            before.note_id,
            &before.state,
            before.due,
            &next,
            1,
            &final_log,
            8,
        )
        .unwrap();
        let final_summary = c.progress_summary().unwrap();
        assert_eq!(final_summary.total_xp, 3);
        assert_eq!(final_summary.gold_cents, 25);
    }

    #[test]
    fn second_card_same_day_and_same_card_next_day_and_cross_rollover_undo_and_today_like_filter() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(NOW).unwrap();
        storage
            .import(
                &model_with_cards(vec![card(1, 0, 0, 0), card(2, 0, 0, 0)]),
                NOW,
            )
            .unwrap();

        let clock = std::sync::Arc::new(bibalak_core::ports::TestClock::new(NOW));
        let c = bibalak_core::Collection::new(Box::new(storage), clock.clone()).unwrap();

        let c1 = c.study_card(1).unwrap().unwrap();
        let c2 = c.study_card(2).unwrap().unwrap();

        // Day 0: answer card 1 (Good -> 3 XP) and card 2 (Hard -> 2 XP)
        let (next1, log1) = sample_answer_state_and_log(1, NOW, 3, 0);
        c.apply_answer(1, c1.note_id, &c1.state, c1.due, &next1, 1, &log1, 8)
            .unwrap();
        clock.set(NOW + 1_000);
        let (next2, log2) = sample_answer_state_and_log(2, NOW + 1_000, 2, 0);
        c.apply_answer(2, c2.note_id, &c2.state, c2.due, &next2, 1, &log2, 8)
            .unwrap();

        let day0 = c.progress_summary().unwrap();
        assert_eq!(day0.total_xp, 5);
        assert_eq!(day0.gold_cents, 50);
        assert_eq!(day0.today_xp, 5);
        assert_eq!(day0.today_gold_cents, 50);

        // Advance past rollover to Day 1 (NOW + 86_400_000): today totals reset to 0, all-time stays 5
        let day1_ms = NOW + 86_400_000;
        clock.set(day1_ms);
        let day1_before = c.progress_summary().unwrap();
        assert_eq!(day1_before.total_xp, 5);
        assert_eq!(day1_before.today_xp, 0);
        assert_eq!(day1_before.today_gold_cents, 0);

        // Answer card 1 on Day 1 -> grants a new reward for day 1 (+3 XP, +25 gold_cents)
        let (_, log_d1_c1) = sample_answer_state_and_log(1, day1_ms, 3, 1);
        c.apply_answer(1, c1.note_id, &next1, 1, &next1, 2, &log_d1_c1, 8)
            .unwrap();
        // Answer card 2 on Day 1 -> grants a new reward for day 1 (+3 XP, +25 gold_cents)
        clock.set(day1_ms + 1_000);
        let (_, log_d1_c2) = sample_answer_state_and_log(2, day1_ms + 1_000, 3, 1);
        c.apply_answer(2, c2.note_id, &next2, 1, &next2, 2, &log_d1_c2, 8)
            .unwrap();
        let day1_after = c.progress_summary().unwrap();
        assert_eq!(day1_after.total_xp, 11);
        assert_eq!(day1_after.gold_cents, 100);
        assert_eq!(day1_after.today_xp, 6);
        assert_eq!(day1_after.today_gold_cents, 50);

        // Cross-rollover undo: advance clock to Day 2, then undo card 2's Day-1 answer.
        // Undo must use the answer-time source_key ("card_review:2:1"), NOT today() at undo time!
        let day2_ms = NOW + 2 * 86_400_000;
        clock.set(day2_ms);
        c.undo().unwrap();
        let after_cross_day_undo = c.progress_summary().unwrap();
        assert_eq!(
            after_cross_day_undo.total_xp, 8,
            "cross-rollover undo must revoke the answer-day reward row"
        );
        assert_eq!(after_cross_day_undo.gold_cents, 75);

        // Verify today LIKE filter with day 1 vs day 11 and day 21:
        // Answer card 1 on Day 11 and Day 21, then return clock to Day 1 and check today_xp.
        let day11_ms = NOW + 11 * 86_400_000;
        clock.set(day11_ms);
        let (_, log_d11) = sample_answer_state_and_log(1, day11_ms, 3, 1);
        c.apply_answer(1, c1.note_id, &next1, 2, &next1, 12, &log_d11, 8)
            .unwrap();

        let day21_ms = NOW + 21 * 86_400_000;
        clock.set(day21_ms);
        let (_, log_d21) = sample_answer_state_and_log(1, day21_ms, 3, 1);
        c.apply_answer(1, c1.note_id, &next1, 12, &next1, 22, &log_d21, 8)
            .unwrap();

        // Set clock back to Day 1: today_xp must match ONLY `:1` (3 XP), not `:11` or `:21`!
        clock.set(day1_ms + 5_000);
        let day1_check = c.progress_summary().unwrap();
        assert_eq!(day1_check.total_xp, 14); // 5 (day 0) + 3 (day 1) + 3 (day 11) + 3 (day 21)
        assert_eq!(
            day1_check.today_xp, 3,
            "today filter for day 1 must not match day 11 or day 21"
        );
        assert_eq!(day1_check.today_gold_cents, 25);
    }

    #[test]
    fn progress_history_two_days_levels_undone_bad_key_and_s1_rollover_dates() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        // S1 stats test baseline: 2026-11-13 23:30 local (UTC+3) -> Day 0 = 2026-11-13
        let created_ms = 1_794_601_800_000;
        let tz_offset_minutes = 180;
        let rollover_hour = 4;
        storage.ensure_collection(created_ms).unwrap();

        {
            let conn = storage.lock();
            conn.execute(
                "INSERT INTO progress_ledger
                 (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
                 VALUES
                 ('id-1', ?1, 'card_review:10:1', 100, 25, 1000, 1000, NULL, -1),
                 ('id-2', ?1, 'card_review:11:2', 150, 50, 2000, 2000, NULL, -1),
                 ('id-3', ?1, 'card_review:12:2', 450, 25, 2100, 2100, NULL, -1),
                 ('id-4', ?1, 'card_review:13:1', 999, 999, 1500, 1600, 1600, -1),
                 ('id-5', ?1, 'not_a_card_review', 50, 25, 1700, 1700, NULL, -1)",
                params![bibalak_core::progress::NIL_USER_ID],
            )
            .unwrap();
        }

        let (days, skipped) = storage
            .progress_history(
                bibalak_core::progress::NIL_USER_ID,
                tz_offset_minutes,
                rollover_hour,
                created_ms,
            )
            .unwrap();

        assert_eq!(skipped, 1);
        assert_eq!(days.len(), 2);
        assert_eq!(days[0].day, 1);
        assert_eq!(days[0].date, "2026-11-14");
        assert_eq!(days[0].xp, 100);
        assert_eq!(days[0].gold_cents, 25);
        assert_eq!(days[0].cumulative_xp, 100);
        assert_eq!(
            days[0].level_after,
            bibalak_core::progress::level_from_xp(100).level
        );

        assert_eq!(days[1].day, 2);
        assert_eq!(days[1].date, "2026-11-15");
        assert_eq!(days[1].xp, 600);
        assert_eq!(days[1].gold_cents, 75);
        assert_eq!(days[1].cumulative_xp, 700);
        assert_eq!(
            days[1].level_after,
            bibalak_core::progress::level_from_xp(700).level
        );
    }

    #[test]
    fn study_days_across_rollover_sums_minutes_respects_limit_excludes_manual_and_undone_xp() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let created_ms = 1_794_601_800_000; // 2026-11-13 23:30 UTC+3 (Day 0)
        let tz_offset_minutes = 180;
        let rollover_hour = 4;
        storage.ensure_collection(created_ms).unwrap();

        let parent = storage.create_deck("Science", created_ms).unwrap();
        let child = storage.create_deck("Science::Biology", created_ms).unwrap();
        let other = storage.create_deck("History", created_ms).unwrap();

        let m = model_with_cards(vec![card(1, 0, 0, 0), card(2, 0, 0, 0)]);
        storage.import(&m, created_ms).unwrap();

        let imported_cards: Vec<i64> = {
            let conn = storage.lock();
            let mut stmt = conn.prepare("SELECT id FROM cards ORDER BY id").unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        let bio_card = imported_cards[0];
        let hist_card = imported_cards[1];
        storage
            .move_cards_to_deck(&[bio_card], child.id, created_ms)
            .unwrap();
        storage
            .move_cards_to_deck(&[hist_card], other.id, created_ms)
            .unwrap();

        // S1 timestamps:
        let before_midnight_d1: i64 = 1_794_688_200_000; // Nov 14 23:30 local -> Day 1
        let after_midnight_d1: i64 = 1_794_691_800_000; // Nov 15 00:30 local (before rollover 4) -> Day 1
        let after_rollover_d2: i64 = 1_794_706_200_000; // Nov 15 04:30 local -> Day 2
        let day3: i64 = after_rollover_d2 + 86_400_000; // Nov 16 04:30 local -> Day 3

        {
            let conn = storage.lock();
            // Day 1: two study reviews (45_000ms + 45_000ms = 90_000ms = 1.5 min) + one manual reschedule (kind 4, excluded)
            conn.execute(
                "INSERT INTO revlog (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
                 VALUES
                 (?1, ?2, -1, 3, 1, 0, 2500, 45000, 1),
                 (?3, ?4, -1, 3, 1, 0, 2500, 45000, 0),
                 (?5, ?2, -1, 0, 5, 1, 2500, 99000, 4),
                 (?6, ?2, -1, 3, 2, 1, 2500, 30000, 1),
                 (?7, ?4, -1, 2, 1, 0, 2500, 60000, 1)",
                params![
                    before_midnight_d1,
                    bio_card,
                    after_midnight_d1,
                    hist_card,
                    after_midnight_d1 + 100,
                    after_rollover_d2,
                    day3
                ],
            )
            .unwrap();

            // Day 1 active reward (+3 XP); Day 2 undone reward (0 XP); Day 3 active reward (+2 XP)
            conn.execute(
                "INSERT INTO progress_ledger
                 (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
                 VALUES
                 ('sd-1', ?1, ?2, 3, 25, 1000, 1000, NULL, -1),
                 ('sd-2', ?1, ?3, 9, 25, 2000, 2100, 2100, -1),
                 ('sd-3', ?1, ?4, 2, 25, 3000, 3000, NULL, -1)",
                params![
                    bibalak_core::progress::NIL_USER_ID,
                    bibalak_core::progress::review_source_key(bio_card, 1),
                    bibalak_core::progress::review_source_key(bio_card, 2),
                    bibalak_core::progress::review_source_key(hist_card, 3),
                ],
            )
            .unwrap();
        }

        // All 3 days newest first
        let (all_days, _) = storage
            .study_days(
                bibalak_core::progress::NIL_USER_ID,
                30,
                tz_offset_minutes,
                rollover_hour,
                created_ms,
            )
            .unwrap();
        assert_eq!(all_days.len(), 3);
        assert_eq!(all_days[0].day, 3);
        assert_eq!(all_days[0].date, "2026-11-16");
        assert_eq!(all_days[0].minutes, 1.0);
        assert_eq!(all_days[0].xp, 2);

        assert_eq!(all_days[1].day, 2);
        assert_eq!(all_days[1].date, "2026-11-15");
        assert_eq!(all_days[1].reviews, 1);
        assert_eq!(all_days[1].minutes, 0.5);
        assert_eq!(all_days[1].deck_ids, vec![parent.id]);
        assert_eq!(all_days[1].xp, 0, "undone reward must show 0 XP");
        assert_eq!(all_days[1].gold_cents, 0);

        assert_eq!(all_days[2].day, 1);
        assert_eq!(all_days[2].date, "2026-11-14");
        assert_eq!(all_days[2].reviews, 2);
        assert_eq!(all_days[2].minutes, 1.5);
        let mut expected_decks = vec![parent.id, other.id];
        expected_decks.sort_unstable();
        let mut got_decks = all_days[2].deck_ids.clone();
        got_decks.sort_unstable();
        assert_eq!(got_decks, expected_decks);
        assert_eq!(all_days[2].xp, 3);

        // Limit holds
        let (limited, _) = storage
            .study_days(
                bibalak_core::progress::NIL_USER_ID,
                2,
                tz_offset_minutes,
                rollover_hour,
                created_ms,
            )
            .unwrap();
        assert_eq!(limited.len(), 2);
        assert_eq!(limited[0].day, 3);
        assert_eq!(limited[1].day, 2);
    }

    #[test]
    fn progress_by_deck_rolls_up_subdecks_follows_card_move_omits_deleted_card_and_tracks_last_studied(
    ) {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let created_ms = 1_794_601_800_000;
        storage.ensure_collection(created_ms).unwrap();

        let math = storage.create_deck("Math", created_ms).unwrap();
        let algebra = storage.create_deck("Math::Algebra", created_ms).unwrap();
        let bio = storage.create_deck("Biology", created_ms).unwrap();
        let empty_deck = storage.create_deck("EmptyDeck", created_ms).unwrap();
        let _ = empty_deck;

        let mut c1 = card(1, 2, 2, 0);
        c1.interval = 30; // mature
        let c2 = card(2, 0, 0, 0); // new
        let mut c3 = card(3, 2, 2, 0);
        c3.interval = 25; // mature, will be deleted
        let m = model_with_cards(vec![c1, c2, c3]);
        storage.import(&m, created_ms).unwrap();

        let imported: Vec<(i64, i64)> = {
            let conn = storage.lock();
            let mut stmt = conn
                .prepare("SELECT id, note_id FROM cards ORDER BY id")
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        let algebra_card = imported[0].0;
        let bio_card = imported[1].0;
        let deleted_card_id = imported[2].0;
        let deleted_note_id = imported[2].1;
        storage
            .move_cards_to_deck(&[algebra_card], algebra.id, created_ms)
            .unwrap();
        storage
            .move_cards_to_deck(&[bio_card], bio.id, created_ms)
            .unwrap();
        storage
            .move_cards_to_deck(&[deleted_card_id], math.id, created_ms)
            .unwrap();

        let day1_ms: i64 = 1_794_688_200_000; // 2026-11-14 (Day 1)
        {
            let conn = storage.lock();
            conn.execute(
                "INSERT INTO revlog (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
                 VALUES (?1, ?2, -1, 3, 30, 10, 2500, 1000, 1)",
                params![day1_ms, algebra_card],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO progress_ledger
                 (id, user_id, source_key, xp, gold_cents, created_at, updated_at, deleted_at, usn)
                 VALUES
                 ('pbd-1', ?1, ?2, 3, 25, 1000, 1000, NULL, -1),
                 ('pbd-2', ?1, ?3, 2, 25, 1100, 1100, NULL, -1),
                 ('pbd-3', ?1, ?4, 10, 25, 1200, 1200, NULL, -1)",
                params![
                    bibalak_core::progress::NIL_USER_ID,
                    bibalak_core::progress::review_source_key(algebra_card, 1),
                    bibalak_core::progress::review_source_key(bio_card, 1),
                    bibalak_core::progress::review_source_key(deleted_card_id, 1),
                ],
            )
            .unwrap();
        }

        // Delete card 3's note -> deleted_card's 10 XP is excluded from deck rows.
        storage
            .delete_notes(&[deleted_note_id], day1_ms + 1_000)
            .unwrap();

        let (rows, _) = storage
            .progress_by_deck(
                bibalak_core::progress::NIL_USER_ID,
                180,
                4,
                day1_ms + 2_000,
                created_ms,
            )
            .unwrap();
        // Only Biology and Math (EmptyDeck has 0 cards).
        assert_eq!(rows.len(), 2);
        let bio_row = rows.iter().find(|r| r.deck_id == bio.id).unwrap();
        assert_eq!(bio_row.xp, 2);
        assert_eq!(bio_row.total_cards, 1);
        assert_eq!(bio_row.last_studied_date, None);

        let math_row = rows.iter().find(|r| r.deck_id == math.id).unwrap();
        assert_eq!(
            math_row.xp, 3,
            "subdeck XP rolls up and deleted card XP is omitted"
        );
        assert_eq!(math_row.total_cards, 1);
        assert_eq!(math_row.mature_pct, 100.0);
        assert_eq!(math_row.retention_pct, 100.0);
        assert_eq!(math_row.last_studied_date.as_deref(), Some("2026-11-14"));

        // Move algebra_card to Biology -> its 3 XP and last_studied_date move to Biology; Math now has 0 cards.
        storage
            .move_cards_to_deck(&[algebra_card], bio.id, day1_ms + 3_000)
            .unwrap();
        let (after_move, _) = storage
            .progress_by_deck(
                bibalak_core::progress::NIL_USER_ID,
                180,
                4,
                day1_ms + 4_000,
                created_ms,
            )
            .unwrap();
        assert_eq!(after_move.len(), 1);
        assert_eq!(after_move[0].deck_id, bio.id);
        assert_eq!(after_move[0].total_cards, 2);
        assert_eq!(after_move[0].xp, 5);
        assert_eq!(after_move[0].gold_cents, 50);
        assert_eq!(
            after_move[0].last_studied_date.as_deref(),
            Some("2026-11-14")
        );
    }

    #[test]
    fn apply_answer_rolls_back_card_and_revlog_when_ledger_insert_fails() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(NOW).unwrap();
        storage
            .import(&model_with_cards(vec![card(1, 0, 0, 10)]), NOW)
            .unwrap();

        let card_id: i64 = storage
            .lock()
            .query_row("SELECT id FROM cards LIMIT 1", [], |r| r.get(0))
            .unwrap();
        let before = storage.study_card(card_id).unwrap().unwrap();
        let (next, log) = sample_answer_state_and_log(card_id, NOW, 3, 0);
        let source_key = bibalak_core::progress::review_source_key(card_id, 0);
        let grant = bibalak_core::progress::RewardGrant {
            id: bibalak_core::progress::ledger_id(bibalak_core::progress::NIL_USER_ID, &source_key),
            user_id: bibalak_core::progress::NIL_USER_ID.to_string(),
            source_key,
            xp: 3,
            gold_cents: 25,
            now_ms: NOW,
        };

        storage
            .lock()
            .execute_batch(
                "CREATE TRIGGER fail_ledger BEFORE INSERT ON progress_ledger
                 BEGIN
                     SELECT RAISE(ABORT, 'forced');
                 END;",
            )
            .unwrap();

        let err = storage
            .apply_answer(card_id, &next, 1, &log, Some(&grant))
            .unwrap_err();
        assert!(
            err.to_string().contains("forced"),
            "unexpected error: {err}"
        );

        let after = storage.study_card(card_id).unwrap().unwrap();
        assert_eq!(after.due, before.due);
        assert_eq!(after.state, before.state);

        let revlog_count: i64 = storage
            .lock()
            .query_row("SELECT COUNT(*) FROM revlog", [], |r| r.get(0))
            .unwrap();
        assert_eq!(revlog_count, 0);

        let ledger_count: i64 = storage
            .lock()
            .query_row("SELECT COUNT(*) FROM progress_ledger", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ledger_count, 0);
    }

    #[test]
    fn progress_totals_window_counts_cards_tasks_and_habits_and_respects_rollover() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let created_ms = 1_794_601_800_000_i64; // 2026-11-13 23:30 UTC+3 (Day 0)
        storage.ensure_collection(created_ms).unwrap();
        storage
            .import(&model_with_cards(vec![card(1, 0, 0, 0)]), created_ms)
            .unwrap();

        let clock = std::sync::Arc::new(bibalak_core::ports::TestClock::new(created_ms));
        let c = bibalak_core::Collection::new(Box::new(storage), clock.clone()).unwrap();
        c.set_local_offset_minutes(180);

        // Day 0: card answer (3 XP / 25 gold) + task (10 XP / 100 gold) + habit (10 XP / 100 gold).
        let before = c.study_card(1).unwrap().unwrap();
        let (next, log) = sample_answer_state_and_log(1, created_ms, 3, 0);
        c.apply_answer(
            1,
            before.note_id,
            &before.state,
            before.due,
            &next,
            1,
            &log,
            8,
        )
        .unwrap();
        let task = c
            .create_task(bibalak_core::productivity::TaskInput {
                list_id: None,
                title: "Window task".into(),
                notes: String::new(),
                priority: bibalak_core::productivity::TaskPriority::Medium,
                manual_quadrant: None,
                due_date: None,
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                sort_order: 0,
            })
            .unwrap();
        c.complete_task(&task.id).unwrap();

        let habit = c
            .create_habit(bibalak_core::productivity::HabitInput {
                title: "Window habit".into(),
                notes: String::new(),
                icon_key: "check".into(),
                color_token: "accent".into(),
                frequency_kind: bibalak_core::productivity::HabitFrequencyKind::Daily,
                weekdays: vec![],
                weekly_target: None,
                interval_days: None,
                goal_mode: bibalak_core::productivity::HabitGoalMode::AchieveAll,
                goal_target: 1.0,
                goal_unit: String::new(),
                start_date: None,
                target_days: None,
                section: bibalak_core::productivity::HabitSection::Morning,
                reminders: vec![],
                auto_popup_log: false,
                deck_id: None,
                sort_order: 0,
            })
            .unwrap();
        c.log_habit(bibalak_core::productivity::HabitLogInput {
            habit_id: habit.id,
            day_index: None,
            logged_value: 1.0,
            status: bibalak_core::productivity::HabitLogStatus::Logged,
            mood: None,
            note: String::new(),
        })
        .unwrap();

        let day0 = c.progress_summary().unwrap();
        assert_eq!(day0.today_xp, 23);
        assert_eq!(day0.today_gold_cents, 225);
        assert_eq!(day0.tasks_rewarded_today, 1);

        // Soft-deleting the completed task preserves XP and still counts toward today's cap.
        c.delete_task(&task.id).unwrap();
        let after_del = c.progress_summary().unwrap();
        assert_eq!(after_del.today_xp, 23);
        assert_eq!(after_del.tasks_rewarded_today, 1);

        // Advance past Day 1 rollover -> today totals & task cap counter reset to 0 while total stays 23.
        clock.set(created_ms + 86_400_000);
        let day1 = c.progress_summary().unwrap();
        assert_eq!(day1.total_xp, 23);
        assert_eq!(day1.today_xp, 0);
        assert_eq!(day1.today_gold_cents, 0);
        assert_eq!(day1.tasks_rewarded_today, 0);
    }

    #[test]
    fn deck_linked_habit_counts_subdecks_and_excludes_manual_reschedules() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let created_ms = 1_794_601_800_000_i64;
        storage.ensure_collection(created_ms).unwrap();

        let parent = storage.create_deck("Languages", created_ms).unwrap();
        let child = storage
            .create_deck("Languages::Arabic", created_ms)
            .unwrap();
        storage
            .import(&model_with_cards(vec![card(1, 0, 0, 0)]), created_ms)
            .unwrap();
        let cid: i64 = storage
            .lock()
            .query_row("SELECT id FROM cards LIMIT 1", [], |r| r.get(0))
            .unwrap();
        storage
            .move_cards_to_deck(&[cid], child.id, created_ms)
            .unwrap();

        // One study review (kind 1) + one manual reschedule (kind 4, excluded) inside Day 0 window.
        {
            let conn = storage.lock();
            conn.execute(
                "INSERT INTO revlog (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
                 VALUES (?1, ?2, -1, 3, 1, 0, 2500, 1000, 1), (?3, ?2, -1, 0, 5, 1, 2500, 0, 4)",
                params![created_ms + 1_000, cid, created_ms + 2_000],
            )
            .unwrap();
        }
        assert_eq!(
            storage
                .deck_review_count_in_window(parent.id, created_ms, created_ms + 86_400_000)
                .unwrap(),
            1
        );

        let clock = std::sync::Arc::new(bibalak_core::ports::TestClock::new(created_ms + 3_000));
        let c = bibalak_core::Collection::new(Box::new(storage), clock).unwrap();
        c.set_local_offset_minutes(180);

        let habit = c
            .create_habit(bibalak_core::productivity::HabitInput {
                title: "Arabic daily".into(),
                notes: String::new(),
                icon_key: "layers".into(),
                color_token: "accent".into(),
                frequency_kind: bibalak_core::productivity::HabitFrequencyKind::Daily,
                weekdays: vec![],
                weekly_target: None,
                interval_days: None,
                goal_mode: bibalak_core::productivity::HabitGoalMode::ReachAmount,
                goal_target: 1.0,
                goal_unit: "cards".into(),
                start_date: None,
                target_days: None,
                section: bibalak_core::productivity::HabitSection::Morning,
                reminders: vec![],
                auto_popup_log: false,
                deck_id: Some(child.id),
                sort_order: 0,
            })
            .unwrap();

        let board = c.get_habit_board(None, None).unwrap();
        let h_log = board.logs.iter().find(|l| l.habit_id == habit.id).unwrap();
        assert_eq!(h_log.logged_value, 1.0);
        assert!(h_log.completed);

        // Top deck "Languages" rolls up the child-deck-linked habit reward (+10 XP / +100 gold_cents).
        let by_deck = c.progress_by_deck().unwrap();
        let top_row = by_deck.iter().find(|r| r.deck_id == parent.id).unwrap();
        assert_eq!(top_row.xp, 10);
        assert_eq!(top_row.gold_cents, 100);
    }

    #[test]
    fn same_ms_answers_do_not_collide_on_revlog_id() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let now_ms = 1_794_601_800_000_i64;
        storage.ensure_collection(now_ms).unwrap();
        storage
            .import(
                &model_with_cards(vec![card(1, 0, 0, 0), card(2, 0, 0, 0)]),
                now_ms,
            )
            .unwrap();

        let clock = std::sync::Arc::new(bibalak_core::ports::FixedClock(now_ms));
        let c = bibalak_core::Collection::new(Box::new(storage), clock).unwrap();

        let c1 = c.study_card(1).unwrap().unwrap();
        let (next1, log1) = sample_answer_state_and_log(1, now_ms, 3, 0);
        c.apply_answer(1, c1.note_id, &c1.state, c1.due, &next1, 1, &log1, 8)
            .unwrap();

        // Second answer at the exact same millisecond (log2.id == now_ms).
        let c2 = c.study_card(2).unwrap().unwrap();
        let (next2, log2) = sample_answer_state_and_log(2, now_ms, 3, 0);
        c.apply_answer(2, c2.note_id, &c2.state, c2.due, &next2, 1, &log2, 8)
            .unwrap();

        let revlogs = c.storage().revlogs_for_optimize(None).unwrap();
        assert_eq!(revlogs.len(), 2);
        assert_eq!((revlogs[0].card_id, revlogs[0].id), (1, now_ms));
        assert_eq!((revlogs[1].card_id, revlogs[1].id), (2, now_ms + 1));

        // Undo must delete the bumped revlog_id (now_ms + 1), not now_ms.
        c.undo().unwrap();
        let remaining = c.storage().revlogs_for_optimize(None).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!((remaining[0].card_id, remaining[0].id), (1, now_ms));
    }

    #[test]
    fn switching_scheduler_to_fsrs_applies_immediately_to_next_card_and_answer() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let now_ms = 1_794_601_800_000_i64;
        storage.ensure_collection(now_ms).unwrap();
        storage
            .import(
                &model_with_cards(vec![card(1, 0, 0, 0), card(2, 0, 0, 0)]),
                now_ms,
            )
            .unwrap();

        let clock = std::sync::Arc::new(bibalak_core::ports::FixedClock(now_ms));
        let sched = std::sync::Arc::new(bibalak_scheduler::DefaultSchedulerSet);
        let c = bibalak_core::Collection::new(Box::new(storage), clock)
            .unwrap()
            .with_scheduler_set(sched);

        let mut cfg = c.get_deck_config(1).unwrap();
        assert_eq!(cfg.algorithm, bibalak_core::model::Algorithm::Sm2);

        // Switch deck from SM-2 to FSRS and save.
        cfg.algorithm = bibalak_core::model::Algorithm::Fsrs;
        c.set_deck_config(&cfg).unwrap();

        // Next card immediately uses FSRS, and answering it writes FSRS memory state.
        let sc = c.next_card(1).unwrap().unwrap();
        let next_cfg = c.get_sched_config(sc.deck_id).unwrap();
        assert_eq!(next_cfg.algorithm, bibalak_core::model::Algorithm::Fsrs);

        c.answer_card(sc.id, bibalak_core::model::Rating::Easy, 1_200)
            .unwrap();
        let after = c.study_card(sc.id).unwrap().unwrap();
        assert!(
            after.state.stability.is_some() && after.state.difficulty.is_some(),
            "answering after switching to FSRS must immediately populate FSRS stability/difficulty"
        );
    }

    #[test]
    fn day_learning_queue_3_compares_day_index_not_millisecond_cutoff() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let now_ms = 1_794_601_800_000_i64;
        let today_end_ms = now_ms + 86_400_000;
        storage.ensure_collection(now_ms).unwrap();
        storage
            .import(
                &model_with_cards(vec![card(1, 0, 0, 0), card(2, 0, 0, 0)]),
                now_ms,
            )
            .unwrap();

        {
            let conn = storage.lock();
            // Card 1: day-learning due on day 5 (future when today = 0).
            conn.execute(
                "UPDATE cards SET type = 1, queue = 3, due = 5 WHERE id = 1",
                [],
            )
            .unwrap();
            // Card 2: day-learning due today (day 0).
            conn.execute(
                "UPDATE cards SET type = 1, queue = 3, due = 0 WHERE id = 2",
                [],
            )
            .unwrap();

            let q = crate::study::study_queue(&conn, 1, 0, now_ms, today_end_ms, 20, 200).unwrap();
            assert_eq!(q.learning, vec![2]);
            assert!(
                q.learning_ahead.is_empty(),
                "future queue=3 card must not be treated as learn-ahead"
            );
            assert_eq!(
                crate::study::count_due_by_type(&conn, 1, 0, now_ms, today_end_ms, 20, 200)
                    .unwrap(),
                (0, 1, 0)
            );
            let counts = crate::study::deck_due_counts(&conn, 0, now_ms, today_end_ms).unwrap();
            assert_eq!(counts.get(&1).copied(), Some((0, 1, 0)));

            let learn_hits =
                crate::search::search_cards(&conn, "is:learn", 0, now_ms, 50, 0, None, true)
                    .unwrap();
            assert_eq!(learn_hits.len(), 2);
            let due_hits =
                crate::search::search_cards(&conn, "is:due", 0, now_ms, 50, 0, None, true).unwrap();
            assert_eq!(
                due_hits.iter().map(|r| r.card_id).collect::<Vec<_>>(),
                vec![2]
            );
        }
    }

    #[test]
    fn new_decks_default_to_fsrs_while_existing_empty_config_keeps_sm2() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let clock = std::sync::Arc::new(bibalak_core::ports::FixedClock(1_794_601_800_000));
        let col = bibalak_core::Collection::new(Box::new(storage), clock).unwrap();

        // Existing default config seeded as '{}' stays SM-2.
        let legacy_default = col.get_deck_config(1).unwrap();
        assert_eq!(
            legacy_default.algorithm,
            bibalak_core::model::Algorithm::Sm2
        );

        // Brand-new deck gets FSRS by default.
        let created = col.create_deck("Japanese").unwrap();
        let created_cfg = col.get_deck_config(created.id).unwrap();
        assert_eq!(created_cfg.algorithm, bibalak_core::model::Algorithm::Fsrs);
    }
}
