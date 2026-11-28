//! Full deck-level progress reset (F1) and exact undo restoration.
//!
//! Unlike card-level Browse "Forget" (`cards::forget_cards_with_revlog`, which keeps
//! history and writes a `review_kind = 4` marker), resetting a deck wipes the deck's
//! review history and soft-deletes its ledger XP/gold/pet credits in one transaction
//! so today's new quota, daily XP, quest progress, and header counters start fresh.

use std::collections::HashSet;

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::model::{Card, Revlog};
use bibalak_core::ports::DeckResetSnapshot;
use bibalak_core::progress::parse_review_source_key;
use rusqlite::{params, Connection};

use crate::cards::{row_to_card, CARD_SNAPSHOT_COLS};
use crate::game_depth::{
    invalidate_all_earned_xp_caches_tx, invalidate_studied_top_decks_tx, revoke_pet_credit_tx,
};

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

/// Reset every card across `deck_ids` (plus any borrowed into filtered decks) back to new,
/// deleting their `revlog` rows, soft-deleting their card-review `progress_ledger` grants,
/// revoking linked `game_pet_credits`, clearing today's `day_limit_overrides`, and
/// invalidating derived XP/depth caches — all in a single transaction.
pub fn reset_deck_progress(
    conn: &mut Connection,
    deck_ids: &[i64],
    today: i32,
    now_ms: i64,
) -> CoreResult<DeckResetSnapshot> {
    if deck_ids.is_empty() {
        return Ok(DeckResetSnapshot::default());
    }
    let tx = conn.transaction().map_err(err)?;
    let deck_ids_json = serde_json::to_string(deck_ids).map_err(err)?;

    let cards: Vec<Card> = {
        let mut stmt = tx
            .prepare(&format!(
                "SELECT {CARD_SNAPSHOT_COLS} FROM cards
                 WHERE deck_id IN (SELECT value FROM json_each(?1))
                    OR (original_deck_id != 0 AND original_deck_id IN (SELECT value FROM json_each(?1)))
                 ORDER BY id"
            ))
            .map_err(err)?;
        let rows = stmt.query_map([&deck_ids_json], row_to_card).map_err(err)?;
        rows.collect::<rusqlite::Result<_>>().map_err(err)?
    };

    let day_limit_overrides: Vec<(i64, i32, u32)> = {
        let mut stmt = tx
            .prepare(
                "SELECT deck_id, day, extra_new FROM day_limit_overrides
                 WHERE day = ?1 AND deck_id IN (SELECT value FROM json_each(?2))",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map(params![today, &deck_ids_json], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .map_err(err)?;
        rows.collect::<rusqlite::Result<_>>().map_err(err)?
    };
    if !day_limit_overrides.is_empty() {
        tx.execute(
            "DELETE FROM day_limit_overrides
             WHERE day = ?1 AND deck_id IN (SELECT value FROM json_each(?2))",
            params![today, &deck_ids_json],
        )
        .map_err(err)?;
    }

    if cards.is_empty() {
        tx.commit().map_err(err)?;
        return Ok(DeckResetSnapshot {
            day_limit_overrides,
            ..Default::default()
        });
    }

    let card_ids: Vec<i64> = cards.iter().map(|c| c.id).collect();
    let card_id_set: HashSet<i64> = card_ids.iter().copied().collect();
    let card_ids_json = serde_json::to_string(&card_ids).map_err(err)?;

    // Return any card temporarily inside a filtered deck back to its home deck first.
    tx.execute(
        r#"UPDATE cards
           SET deck_id          = original_deck_id,
               original_deck_id = 0,
               original_due     = 0,
               "mod"            = ?1,
               usn              = -1
           WHERE id IN (SELECT value FROM json_each(?2))
             AND original_deck_id != 0"#,
        params![now_ms, &card_ids_json],
    )
    .map_err(err)?;

    let next_pos: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(due), 0) + 1 FROM cards WHERE queue = 0",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;

    let mut reset_stmt = tx
        .prepare(
            r#"UPDATE cards SET
                 type = 0, queue = 0, due = ?2, interval = 0, ease_factor = 0,
                 reps = 0, lapses = 0, remaining = 0, original_due = 0,
                 fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_last_review = NULL,
                 "mod" = ?3, usn = -1
               WHERE id = ?1"#,
        )
        .map_err(err)?;
    for (idx, card) in cards.iter().enumerate() {
        reset_stmt
            .execute(params![card.id, next_pos + idx as i64, now_ms])
            .map_err(err)?;
    }
    drop(reset_stmt);

    let revlogs: Vec<Revlog> = {
        let mut stmt = tx
            .prepare(
                "SELECT id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind
                 FROM revlog
                 WHERE card_id IN (SELECT value FROM json_each(?1))
                 ORDER BY id",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([&card_ids_json], |r| {
                Ok(Revlog {
                    id: r.get(0)?,
                    card_id: r.get(1)?,
                    usn: r.get(2)?,
                    ease: r.get(3)?,
                    interval: r.get(4)?,
                    last_interval: r.get(5)?,
                    ease_factor: r.get(6)?,
                    taken_ms: r.get(7)?,
                    review_kind: r.get(8)?,
                })
            })
            .map_err(err)?;
        rows.collect::<rusqlite::Result<_>>().map_err(err)?
    };
    if !revlogs.is_empty() {
        tx.execute(
            "DELETE FROM revlog WHERE card_id IN (SELECT value FROM json_each(?1))",
            [&card_ids_json],
        )
        .map_err(err)?;
    }

    let matching_ledgers: Vec<(String, String)> = {
        let mut stmt = tx
            .prepare(
                "SELECT id, user_id, source_key
                 FROM progress_ledger
                 WHERE deleted_at IS NULL AND source_key LIKE 'card_review:%'",
            )
            .map_err(err)?;
        let mut out = Vec::new();
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(err)?;
        for row in rows {
            let (id, user_id, sk) = row.map_err(err)?;
            if parse_review_source_key(&sk).is_some_and(|p| card_id_set.contains(&p.card_id)) {
                out.push((id, user_id));
            }
        }
        out
    };

    let mut soft_deleted_ledger_ids = Vec::with_capacity(matching_ledgers.len());
    let mut revoked_pet_credit_ids = Vec::new();
    for (ledger_id, user_id) in matching_ledgers {
        {
            let mut pet_stmt = tx
                .prepare(
                    "SELECT id FROM game_pet_credits
                     WHERE user_id = ?1 AND ledger_id = ?2 AND deleted_at IS NULL",
                )
                .map_err(err)?;
            let ids = pet_stmt
                .query_map(params![user_id, ledger_id], |r| r.get::<_, String>(0))
                .map_err(err)?;
            for pid in ids {
                revoked_pet_credit_ids.push(pid.map_err(err)?);
            }
        }
        revoke_pet_credit_tx(&tx, &user_id, &ledger_id, now_ms)?;
        tx.execute(
            "UPDATE progress_ledger
             SET deleted_at = ?1, updated_at = ?1, usn = -1
             WHERE id = ?2 AND deleted_at IS NULL",
            params![now_ms, ledger_id],
        )
        .map_err(err)?;
        soft_deleted_ledger_ids.push(ledger_id);
    }

    invalidate_all_earned_xp_caches_tx(&tx)?;
    invalidate_studied_top_decks_tx(&tx)?;

    tx.commit().map_err(err)?;
    Ok(DeckResetSnapshot {
        cards,
        revlogs,
        soft_deleted_ledger_ids,
        revoked_pet_credit_ids,
        day_limit_overrides,
    })
}

/// Undo a full deck reset by restoring cards, deleted `revlog` rows, soft-deleted
/// `progress_ledger` grants, revoked `game_pet_credits`, and `day_limit_overrides`.
pub fn restore_deck_reset(
    conn: &mut Connection,
    snap: &DeckResetSnapshot,
    now_ms: i64,
) -> CoreResult<()> {
    let tx = conn.transaction().map_err(err)?;

    {
        let mut stmt = tx
            .prepare(
                r#"UPDATE cards SET
                     deck_id = ?2, type = ?3, queue = ?4, due = ?5,
                     interval = ?6, ease_factor = ?7, reps = ?8, lapses = ?9,
                     remaining = ?10, original_due = ?11, original_deck_id = ?12, flags = ?13,
                     fsrs_stability = ?14, fsrs_difficulty = ?15, fsrs_last_review = ?16,
                     data = ?17, "mod" = ?18, usn = -1
                   WHERE id = ?1"#,
            )
            .map_err(err)?;
        for c in &snap.cards {
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
                c.data,
                now_ms,
            ])
            .map_err(err)?;
        }
    }

    {
        let mut stmt = tx
            .prepare(
                "INSERT OR REPLACE INTO revlog
                 (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )
            .map_err(err)?;
        for r in &snap.revlogs {
            stmt.execute(params![
                r.id,
                r.card_id,
                r.usn,
                r.ease,
                r.interval,
                r.last_interval,
                r.ease_factor,
                r.taken_ms,
                r.review_kind,
            ])
            .map_err(err)?;
        }
    }

    {
        let mut stmt = tx
            .prepare(
                "UPDATE progress_ledger
                 SET deleted_at = NULL, updated_at = ?1, usn = -1
                 WHERE id = ?2",
            )
            .map_err(err)?;
        for ledger_id in &snap.soft_deleted_ledger_ids {
            stmt.execute(params![now_ms, ledger_id]).map_err(err)?;
        }
    }

    {
        let mut stmt = tx
            .prepare(
                "UPDATE game_pet_credits
                 SET deleted_at = NULL, updated_at = ?1, usn = -1
                 WHERE id = ?2",
            )
            .map_err(err)?;
        for pet_credit_id in &snap.revoked_pet_credit_ids {
            stmt.execute(params![now_ms, pet_credit_id]).map_err(err)?;
        }
    }

    {
        let mut stmt = tx
            .prepare(
                "INSERT OR REPLACE INTO day_limit_overrides (deck_id, day, extra_new)
                 VALUES (?1, ?2, ?3)",
            )
            .map_err(err)?;
        for &(deck_id, day, extra_new) in &snap.day_limit_overrides {
            stmt.execute(params![deck_id, day, extra_new])
                .map_err(err)?;
        }
    }

    invalidate_all_earned_xp_caches_tx(&tx)?;
    invalidate_studied_top_decks_tx(&tx)?;
    tx.commit().map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use bibalak_core::model::Rating;
    use bibalak_core::ports::TestClock;
    use bibalak_core::Collection;

    use crate::storage::SqliteStorage;

    #[test]
    fn f1_reset_deck_progress_wipes_revlog_xp_and_restores_on_undo() {
        let now_ms = 1_794_830_400_000;
        let clock = Arc::new(TestClock::new(now_ms));
        let storage = SqliteStorage::open_in_memory().unwrap();
        let col = Collection::new(Box::new(storage), clock.clone())
            .unwrap()
            .with_scheduler_set(Arc::new(bibalak_scheduler::DefaultSchedulerSet));
        let deck = col.create_deck("ResetTarget").unwrap();
        let nt_id = col.list_notetypes().unwrap()[0].id;
        for i in 0..25 {
            col.add_note(nt_id, deck.id, &[format!("Q{i}"), format!("A{i}")], &[])
                .unwrap();
        }
        for step in 0..5 {
            clock.advance_ms(65_000);
            let card = col.next_card(deck.id).unwrap().unwrap();
            let rating = if step % 2 == 0 {
                Rating::Good
            } else {
                Rating::Easy
            };
            col.answer_card(card.id, rating, 1_000).unwrap();
        }
        col.increase_today_new_limit(deck.id, 3).unwrap();
        let before_xp = col.progress_summary().unwrap().today_xp;
        assert!(before_xp > 0);
        let before_counts = col.count_due_by_type(deck.id).unwrap();
        assert_ne!(before_counts.0, 20);

        let reset_count = col.reset_deck_progress(deck.id).unwrap();
        assert_eq!(reset_count, 25);
        assert_eq!(col.progress_summary().unwrap().today_xp, 0);
        assert_eq!(col.count_due_by_type(deck.id).unwrap(), (20, 0, 0));

        // Undo restores cards, revlog history, today XP, and due counts.
        let undone = col.undo().unwrap();
        assert!(matches!(
            undone,
            Some(bibalak_core::undo::UndoAction::ResetDeckProgress { count: 25, .. })
        ));
        assert_eq!(col.progress_summary().unwrap().today_xp, before_xp);
        assert_eq!(col.count_due_by_type(deck.id).unwrap(), before_counts);
    }
}
