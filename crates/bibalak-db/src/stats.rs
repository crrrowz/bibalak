//! Aggregate statistics over `revlog` and `cards`, for the dashboards.
//!
//! Day bucketing shifts each timestamp by `tz_offset_minutes` and
//! `rollover_hour` before dividing by `MS_PER_DAY`, matching the scheduler's
//! notion of "today" (`Collection::local_day_index` /  `Collection::today()`),
//! so the heatmap/streaks/weekly buckets line up with due-date math elsewhere.
//! Deck ids passed in are always resolved by `Collection` from our own
//! `list_decks()` (never raw user text), so they're interpolated directly into
//! the SQL rather than bound as params — simpler than a dynamic `IN (?,?,..)`
//! list for no injection risk.

use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::{
    epoch_days_to_date_string, AnswerButtons, DayCount, DeckStat, FsrsStats, HourlyStat,
    RetentionWeek, StatsCoachDto, StatsDto,
};
use bibalak_core::model::Revlog;
use bibalak_core::ports::{SimCardSnapshot, WorkloadSnapshot};
use bibalak_core::progress::{self, is_mature_card};
use bibalak_core::scheduling::CardState;
use bibalak_scheduler::retrievability;
use rusqlite::Connection;

const MS_PER_DAY: i64 = 86_400_000;
const FORECAST_DAYS: i64 = 30;
const REVIEWS_7D_MS: i64 = 7 * MS_PER_DAY;
const REVIEWS_28D_MS: i64 = 28 * MS_PER_DAY;
/// Upper edges (days) of the FSRS stability histogram buckets: <1, 1-7, 7-21,
/// 21-90, 90-180, 180-365, 365+ (7 buckets).
const STABILITY_EDGES: [f64; 6] = [1.0, 7.0, 21.0, 90.0, 180.0, 365.0];

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

#[inline]
fn day_bucket(id_ms: i64, tz_offset_minutes: i32, rollover_hour: u8, created_day: i64) -> i64 {
    progress::day_index_for_ms(id_ms, tz_offset_minutes, rollover_hour, created_day)
}

#[allow(clippy::too_many_arguments)]
pub fn stats(
    conn: &Connection,
    deck_ids: Option<&[i64]>,
    days: Option<u32>,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    fsrs_weights: &[f64; 21],
    retention_goal_pct: f64,
    _today: i32,
    now_ms: i64,
    created_ms: i64,
) -> CoreResult<StatsDto> {
    use std::collections::{BTreeMap, HashMap, HashSet};

    let tz_off_ms = i64::from(tz_offset_minutes) * 60_000;
    let created_epoch_day =
        progress::created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
    let now_epoch_day = progress::created_epoch_day(now_ms, tz_offset_minutes, rollover_hour);
    let today = (now_epoch_day - created_epoch_day) as i32;
    let today_i64 = i64::from(today);
    let today_date = epoch_days_to_date_string(now_epoch_day);

    let mut stats = StatsDto {
        today,
        today_date,
        day0_ms: created_ms,
        retention_goal_pct,
        ..Default::default()
    };

    // 1. Load decks metadata once (small table) + prepare per-deck accumulators.
    struct DeckAccum {
        stat: DeckStat,
        retention: progress::RetentionTally,
    }
    let mut by_deck: HashMap<i64, DeckAccum> = HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, name, parent_id FROM decks")
            .map_err(err)?;
        let mut rows = stmt.query([]).map_err(err)?;
        while let Some(r) = rows.next().map_err(err)? {
            let id: i64 = r.get(0).map_err(err)?;
            by_deck.insert(
                id,
                DeckAccum {
                    stat: DeckStat {
                        deck_id: id,
                        name: r.get(1).map_err(err)?,
                        parent_id: r.get(2).map_err(err)?,
                        total_cards: 0,
                        due_today: 0,
                        new_count: 0,
                        learning_count: 0,
                        young_count: 0,
                        mature_count: 0,
                        suspended_count: 0,
                        retention_pct: None,
                        reviews_7d: 0,
                    },
                    retention: progress::RetentionTally::default(),
                },
            );
        }
    }

    // Active leech notes (notes.tags wraps each tag in spaces: " a b ").
    let mut leech_notes: HashSet<i64> = HashSet::new();
    {
        let mut stmt = conn
            .prepare("SELECT id FROM notes WHERE tags LIKE '% leech %'")
            .map_err(err)?;
        let mut rows = stmt.query([]).map_err(err)?;
        while let Some(r) = rows.next().map_err(err)? {
            leech_notes.insert(r.get(0).map_err(err)?);
        }
    }

    // 2. Single linear scan of `cards` in `id` order computes card maturity,
    //    forecast, FSRS distributions, deck card rollups, active leeches, and
    //    the sorted `(card_id, deck_id)` lookup table.
    let mut card_decks: Vec<(i64, i64)> = Vec::new();
    let mut leech_card_ids: Vec<i64> = Vec::new();
    let mut leech_card_set: HashSet<i64> = HashSet::new();
    let mut forecast_buckets = [0_u32; (FORECAST_DAYS as usize) + 1];
    let mut fsrs = FsrsStats {
        stability_buckets: vec![0; STABILITY_EDGES.len() + 1],
        difficulty_buckets: vec![0; 10],
        ..Default::default()
    };
    let mut sum_r = 0.0;
    let mut n_r = 0_u32;
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, note_id, deck_id, type, queue, due, interval,
                        fsrs_stability, fsrs_difficulty, fsrs_last_review
                 FROM cards ORDER BY id",
            )
            .map_err(err)?;
        let mut rows = stmt.query([]).map_err(err)?;
        while let Some(r) = rows.next().map_err(err)? {
            let id: i64 = r.get(0).map_err(err)?;
            let note_id: i64 = r.get(1).map_err(err)?;
            let deck_id: i64 = r.get(2).map_err(err)?;
            let ctype: i64 = r.get(3).map_err(err)?;
            let queue: i64 = r.get(4).map_err(err)?;
            let due: i64 = r.get(5).map_err(err)?;
            let interval: i64 = r.get(6).map_err(err)?;
            card_decks.push((id, deck_id));

            if let Some(d) = by_deck.get_mut(&deck_id) {
                d.stat.total_cards += 1;
                if queue == -1 {
                    d.stat.suspended_count += 1;
                } else if queue >= 0 {
                    match ctype {
                        0 => d.stat.new_count += 1,
                        1 | 3 => d.stat.learning_count += 1,
                        2 => {
                            if queue == 2 && due <= today_i64 {
                                d.stat.due_today += 1;
                            }
                            if is_mature_card(ctype, queue, interval) {
                                d.stat.mature_count += 1;
                            } else {
                                d.stat.young_count += 1;
                            }
                        }
                        _ => {}
                    }
                }
            }

            let matches_deck = match deck_ids {
                None => true,
                Some(ids) => ids.contains(&deck_id),
            };
            if !matches_deck {
                continue;
            }

            if queue != -1 && leech_notes.contains(&note_id) {
                leech_card_ids.push(id);
                leech_card_set.insert(id);
            }

            if ctype == 2 && queue == 2 {
                if due < today_i64 {
                    stats.backlog_count += 1;
                } else if due <= today_i64 + FORECAST_DAYS {
                    forecast_buckets[(due - today_i64) as usize] += 1;
                }
            }
            if queue == -1 {
                stats.suspended_count += 1;
            } else if queue >= 0 {
                match ctype {
                    0 => stats.new_count += 1,
                    1 | 3 => stats.learning_count += 1,
                    2 if interval < 21 => stats.young_count += 1,
                    2 => stats.mature_count += 1,
                    _ => {}
                }
                let stability: Option<f64> = r.get(7).map_err(err)?;
                let difficulty: Option<f64> = r.get(8).map_err(err)?;
                if let (Some(stab), Some(diff)) = (stability, difficulty) {
                    fsrs.card_count += 1;
                    let s_idx = STABILITY_EDGES
                        .iter()
                        .position(|&edge| stab < edge)
                        .unwrap_or(STABILITY_EDGES.len());
                    fsrs.stability_buckets[s_idx] += 1;
                    let d_idx = ((diff - 1.0).clamp(0.0, 8.999)) as usize;
                    fsrs.difficulty_buckets[d_idx.min(9)] += 1;
                    if let Some(last_day) = r.get::<_, Option<i64>>(9).map_err(err)? {
                        let elapsed = (today_i64 - last_day).max(0) as f64;
                        sum_r += retrievability(elapsed, stab, fsrs_weights) * 100.0;
                        n_r += 1;
                    }
                }
            }
        }
    }
    for (off, &cnt) in forecast_buckets.iter().enumerate() {
        if cnt > 0 {
            let off_i = off as i64;
            stats.forecast.push(DayCount {
                day: off_i,
                count: cnt,
                date: epoch_days_to_date_string(now_epoch_day + off_i),
            });
        }
    }
    fsrs.avg_retrievability = if n_r > 0 {
        Some(sum_r / f64::from(n_r))
    } else {
        None
    };
    stats.fsrs = fsrs;

    // 3. Single linear scan of `revlog` in `id` order computes heatmap, totals,
    //    studied days, true retention + weekly chart, buttons, hourly, and
    //    per-deck 7d/30d rollups. Because `id` increases strictly, `day_bucket`
    //    never decreases and `seen_today.insert(card_id)` identifies exact
    //    `MIN(id)` per `(card_id, day)` without temp sorts.
    let cutoff_ms = days.map(|d| now_ms - i64::from(d) * MS_PER_DAY);
    let reviews_cutoff = now_ms - REVIEWS_7D_MS;
    let leech_28d_cutoff = now_ms - REVIEWS_28D_MS;
    let mut leech_7d_ms = 0_i64;
    let mut leech_28d_ms = 0_i64;
    let mut scope_reviews_7d = 0_u32;

    let mut retention_30d = progress::RetentionCounter::new_30d(now_ms);
    let mut reviews_by_day: Vec<(i64, u32)> = Vec::new();
    let mut last_studied_day: Option<i64> = None;
    let mut ret_total = 0_u64;
    let mut ret_passed = 0_u64;
    let mut weekly: BTreeMap<i64, RetentionWeek> = BTreeMap::new();
    let mut buttons = AnswerButtons {
        learning: vec![0; 4],
        young: vec![0; 4],
        mature: vec![0; 4],
    };
    let mut hourly: BTreeMap<u8, (u32, u32)> = BTreeMap::new();

    {
        let mut stmt = conn
            .prepare(
                "SELECT id, card_id, ease, last_interval, taken_ms, review_kind
                 FROM revlog ORDER BY id",
            )
            .map_err(err)?;
        let mut rows = stmt.query([]).map_err(err)?;
        while let Some(r) = rows.next().map_err(err)? {
            let id: i64 = r.get(0).map_err(err)?;
            let card_id: i64 = r.get(1).map_err(err)?;
            let ease: i64 = r.get(2).map_err(err)?;
            let last_interval: i64 = r.get(3).map_err(err)?;
            let taken_ms: i64 = r.get(4).map_err(err)?;
            let review_kind: i64 = r.get(5).map_err(err)?;

            let day_idx = day_bucket(id, tz_offset_minutes, rollover_hour, created_epoch_day);
            let (is_first, retention_30d_pass) =
                retention_30d.observe(card_id, id, review_kind, ease, day_idx);

            let Ok(card_pos) = card_decks.binary_search_by_key(&card_id, |&(cid, _)| cid) else {
                continue;
            };
            let deck_id = card_decks[card_pos].1;

            if id >= reviews_cutoff || retention_30d_pass.is_some() {
                if let Some(d) = by_deck.get_mut(&deck_id) {
                    if id >= reviews_cutoff {
                        d.stat.reviews_7d += 1;
                    }
                    if let Some(passed) = retention_30d_pass {
                        d.retention.record(passed);
                    }
                }
            }

            let matches_deck = match deck_ids {
                None => true,
                Some(ids) => ids.contains(&deck_id),
            };
            if !matches_deck {
                continue;
            }

            if let Some(last) = reviews_by_day.last_mut().filter(|(d, _)| *d == day_idx) {
                last.1 += 1;
            } else {
                reviews_by_day.push((day_idx, 1));
            }

            if id >= reviews_cutoff {
                scope_reviews_7d += 1;
            }
            if id >= leech_28d_cutoff && leech_card_set.contains(&card_id) {
                leech_28d_ms += taken_ms;
                if id >= reviews_cutoff {
                    leech_7d_ms += taken_ms;
                }
            }

            if cutoff_ms.is_some_and(|c| id < c) {
                continue;
            }

            stats.total_reviews += 1;
            stats.total_time_ms += taken_ms;
            if last_studied_day != Some(day_idx) {
                stats.studied_days += 1;
                last_studied_day = Some(day_idx);
            }

            if review_kind == 1 && is_first {
                ret_total += 1;
                if ease > 1 {
                    ret_passed += 1;
                }
                let wk = day_idx / 7;
                let entry = weekly.entry(wk).or_insert(RetentionWeek {
                    week_index: wk,
                    young_total: 0,
                    young_passed: 0,
                    mature_total: 0,
                    mature_passed: 0,
                });
                if (1..=20).contains(&last_interval) {
                    entry.young_total += 1;
                    if ease > 1 {
                        entry.young_passed += 1;
                    }
                } else if last_interval >= 21 {
                    entry.mature_total += 1;
                    if ease > 1 {
                        entry.mature_passed += 1;
                    }
                }
            }

            if review_kind <= 2 {
                if (1..=4).contains(&ease) {
                    let idx = (ease - 1) as usize;
                    if review_kind == 0 || review_kind == 2 {
                        buttons.learning[idx] += 1;
                    } else if last_interval < 21 {
                        buttons.young[idx] += 1;
                    } else {
                        buttons.mature[idx] += 1;
                    }
                }
                let hour = (((id + tz_off_ms) % MS_PER_DAY) / 3_600_000) as u8;
                let h = hourly.entry(hour).or_insert((0, 0));
                h.0 += 1;
                if ease > 1 {
                    h.1 += 1;
                }
            }
        }
    }

    stats.reviews = reviews_by_day
        .into_iter()
        .map(|(day, count)| DayCount {
            day,
            count,
            date: epoch_days_to_date_string(created_epoch_day + day),
        })
        .collect();
    stats.retention_pct = if ret_total > 0 {
        Some(ret_passed as f64 / ret_total as f64 * 100.0)
    } else {
        None
    };
    stats.retention_weekly = weekly.into_values().collect();
    stats.answer_buttons = buttons;
    stats.hourly = hourly
        .into_iter()
        .map(|(hour, (total, passed))| HourlyStat {
            hour,
            total,
            passed,
        })
        .collect();

    // Populate `dates` mapping for calendar rendering (heatmap window + forecast window + all review days).
    {
        let min_heatmap_day = (today_i64 - 370).max(0);
        let max_forecast_day = today_i64 + FORECAST_DAYS + 14;
        for d in min_heatmap_day..=max_forecast_day {
            stats
                .dates
                .insert(d, epoch_days_to_date_string(created_epoch_day + d));
        }
        for r in &stats.reviews {
            stats
                .dates
                .entry(r.day)
                .or_insert_with(|| epoch_days_to_date_string(created_epoch_day + r.day));
        }
    }

    let mut deck_out: Vec<DeckStat> = by_deck
        .into_values()
        .map(|mut acc| {
            acc.stat.retention_pct = acc.retention.pct_opt();
            acc.stat
        })
        .collect();
    deck_out.sort_by(|a, b| a.name.cmp(&b.name));
    stats.deck_stats = deck_out;

    let leech_weekly_minutes = if leech_7d_ms > 0 {
        ((leech_7d_ms as f64 / 60_000.0).round() as u32).max(1)
    } else if leech_28d_ms > 0 {
        ((leech_28d_ms as f64 / 4.0 / 60_000.0).round() as u32).max(1)
    } else {
        0
    };
    let overdue_count = stats.backlog_count;
    let suggested_daily_reviews = if overdue_count == 0 {
        0
    } else {
        (scope_reviews_7d / 7) + overdue_count.div_ceil(7)
    };
    stats.coach = StatsCoachDto {
        leech_count: leech_card_ids.len() as u32,
        leech_card_ids,
        leech_weekly_minutes,
        overdue_count,
        suggested_daily_reviews,
    };

    Ok(stats)
}

/// Active card scheduling snapshot + recent review duration for workload simulation.
pub fn workload_snapshot(conn: &Connection, deck_ids: &[i64]) -> CoreResult<WorkloadSnapshot> {
    if deck_ids.is_empty() {
        return Ok(WorkloadSnapshot {
            cards: Vec::new(),
            avg_review_secs: 8.0,
        });
    }
    let list = deck_ids
        .iter()
        .map(i64::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT type, due, interval, ease_factor, reps, lapses, remaining,
                fsrs_stability, fsrs_difficulty, fsrs_last_review
         FROM cards
         WHERE deck_id IN ({list}) AND queue >= 0"
    );
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let mut rows = stmt.query([]).map_err(err)?;
    let mut cards = Vec::new();
    while let Some(r) = rows.next().map_err(err)? {
        let ctype: i64 = r.get(0).map_err(err)?;
        let due: i64 = r.get(1).map_err(err)?;
        let interval: i64 = r.get(2).map_err(err)?;
        let ease_factor: i64 = r.get(3).map_err(err)?;
        let reps: i64 = r.get(4).map_err(err)?;
        let lapses: i64 = r.get(5).map_err(err)?;
        let remaining: i64 = r.get(6).map_err(err)?;
        let stability: Option<f64> = r.get(7).map_err(err)?;
        let difficulty: Option<f64> = r.get(8).map_err(err)?;
        let last_review: Option<i64> = r.get(9).map_err(err)?;
        cards.push(SimCardSnapshot {
            due: due as i32,
            state: CardState {
                phase: crate::study::type_to_phase(ctype),
                steps_remaining: (remaining / 1000).max(0) as u32,
                interval_days: interval.max(0) as u32,
                ease_milli: ease_factor.max(1300) as u32,
                reps: reps.max(0) as u32,
                lapses: lapses.max(0) as u32,
                stability,
                difficulty,
                last_review_day: last_review.map(|d| d as i32),
            },
        });
    }

    let avg_sql = format!(
        "SELECT AVG(r.taken_ms)
         FROM revlog r
         JOIN cards c ON c.id = r.card_id
         WHERE c.deck_id IN ({list}) AND r.taken_ms > 0 AND r.taken_ms <= 120000"
    );
    let avg_ms: Option<f64> = conn.query_row(&avg_sql, [], |r| r.get(0)).map_err(err)?;
    let avg_review_secs = avg_ms
        .map(|ms| (ms / 1000.0).clamp(2.0, 60.0))
        .unwrap_or(8.0);

    Ok(WorkloadSnapshot {
        cards,
        avg_review_secs,
    })
}

fn row_to_revlog(r: &rusqlite::Row<'_>) -> rusqlite::Result<Revlog> {
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
}

/// Revlog entries for FSRS weight optimization (review_kind ∈ {0,1,2}).
/// Pass `Some(deck_id)` to restrict to one deck; `None` for the full collection.
pub fn revlogs_for_optimize(conn: &Connection, deck_id: Option<i64>) -> CoreResult<Vec<Revlog>> {
    match deck_id {
        None => {
            let mut stmt = conn
                .prepare(
                    "SELECT r.id, r.card_id, r.usn, r.ease, r.interval, r.last_interval,
                            r.ease_factor, r.taken_ms, r.review_kind
                     FROM revlog r WHERE r.review_kind <= 2 ORDER BY r.card_id, r.id",
                )
                .map_err(err)?;
            let rows: Vec<Revlog> = stmt
                .query_map([], row_to_revlog)
                .map_err(err)?
                .filter_map(|r| r.ok())
                .collect();
            Ok(rows)
        }
        Some(did) => {
            let mut stmt = conn
                .prepare(
                    "SELECT r.id, r.card_id, r.usn, r.ease, r.interval, r.last_interval,
                            r.ease_factor, r.taken_ms, r.review_kind
                     FROM revlog r
                     JOIN cards c ON c.id = r.card_id
                     WHERE r.review_kind <= 2 AND c.deck_id = ?1
                     ORDER BY r.card_id, r.id",
                )
                .map_err(err)?;
            let rows: Vec<Revlog> = stmt
                .query_map([did], row_to_revlog)
                .map_err(err)?
                .filter_map(|r| r.ok())
                .collect();
            Ok(rows)
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::storage::SqliteStorage;
    use bibalak_core::model::{Card, Revlog};
    use bibalak_core::ports::*;
    use bibalak_core::scheduling::FSRS6_DEFAULT_WEIGHTS;

    const NOW: i64 = 1_700_000_000_000;

    fn make_test_card(id: i64) -> Card {
        Card {
            id,
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
        }
    }

    fn model() -> bibalak_core::model::CanonicalModel {
        use bibalak_core::model::*;
        let card = make_test_card;
        CanonicalModel {
            notetypes: vec![Notetype {
                id: 10,
                name: "Basic".into(),
                kind: 0,
                mod_ms: 0,
                usn: -1,
                config_json: "{}".into(),
            }],
            fields: vec![Field {
                notetype_id: 10,
                ord: 0,
                name: "Front".into(),
                config_json: "{}".into(),
            }],
            templates: vec![Template {
                notetype_id: 10,
                ord: 0,
                name: "Card 1".into(),
                qfmt: "{{Front}}".into(),
                afmt: "{{Front}}".into(),
                config_json: "{}".into(),
            }],
            notes: vec![Note {
                id: 100,
                guid: "g1".into(),
                notetype_id: 10,
                mod_ms: 0,
                usn: -1,
                tags: vec![],
                fields: vec!["hola".into()],
                sort_field: Some("hola".into()),
                checksum: None,
            }],
            cards: vec![card(1000), {
                let mut c = card(1001);
                c.ord = 1;
                c
            }],
            revlog: vec![Revlog {
                id: NOW - 1000,
                card_id: 1000,
                usn: -1,
                ease: 3,
                interval: 1,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 4200,
                review_kind: 1,
            }],
            ..Default::default()
        }
    }

    #[test]
    fn aggregates_reviews_and_card_counts() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.import(&model(), 1_700_000_000_000).unwrap();

        let s = storage
            .stats(
                None,
                Some(30),
                0,
                4,
                &FSRS6_DEFAULT_WEIGHTS,
                90.0,
                0,
                NOW,
                0,
            )
            .unwrap();
        assert_eq!(s.total_reviews, 1);
        assert_eq!(s.studied_days, 1);
        assert_eq!(s.reviews.len(), 1);
        assert_eq!(s.total_time_ms, 4200);
        assert_eq!(s.retention_pct, Some(100.0), "one passing review in window");
        assert_eq!(s.new_count, 2, "two new cards imported");
    }

    #[test]
    fn deck_filter_excludes_other_decks() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.import(&model(), 1_700_000_000_000).unwrap();

        let s = storage
            .stats(
                Some(&[999]),
                None,
                0,
                4,
                &FSRS6_DEFAULT_WEIGHTS,
                90.0,
                0,
                NOW,
                0,
            )
            .unwrap();
        assert_eq!(s.total_reviews, 0);
        assert_eq!(s.new_count, 0);
    }

    /// Two reviews that straddle a naive collection-relative UTC day boundary
    /// but fall on the same local/rollover-aligned day must land in one
    /// `DayCount` bucket, not two — reproduces the gapped-streak bug where a
    /// single studied day got split by ignoring `tz_offset_minutes`/
    /// `rollover_hour`.
    #[test]
    fn day_bucketing_respects_tz_and_rollover() {
        let created_ms = 8_000_000_000;
        let tz_offset_minutes = 120; // UTC+2
        let rollover_hour = 4;

        let mut m = model();
        m.revlog = vec![
            Revlog {
                id: 8_604_700_000, // just before the naive UTC-relative day boundary
                card_id: 1000,
                usn: -1,
                ease: 3,
                interval: 1,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 1000,
                review_kind: 1,
            },
            Revlog {
                id: 8_604_900_000, // just after it, but same local/rollover day
                card_id: 1001,
                usn: -1,
                ease: 3,
                interval: 1,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 1000,
                review_kind: 1,
            },
        ];

        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.import(&m, 1_700_000_000_000).unwrap();

        let s = storage
            .stats(
                None,
                None,
                tz_offset_minutes,
                rollover_hour,
                &FSRS6_DEFAULT_WEIGHTS,
                90.0,
                0,
                8_605_000_000,
                created_ms,
            )
            .unwrap();

        assert_eq!(
            s.reviews.len(),
            1,
            "both reviews should share one day bucket"
        );
        assert_eq!(s.reviews[0].count, 2);
        assert_eq!(s.studied_days, 1);
    }

    /// S1: Backend returns `today` (collection day index, matching day_expr)
    /// and each day's local calendar date in StatsDto.
    /// Tested with creation time late in the day, UTC+3 and rollover 4,
    /// at times just before midnight, just after midnight, and just after rollover.
    #[test]
    fn stats_today_and_dates_respect_creation_tz_and_rollover() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let mut m = model();
        // Clear default revlog/cards so we control the exact timestamps
        m.revlog.clear();
        m.cards.clear();

        // Created 2026-11-13 23:30 local (UTC+3) -> 20:30 UTC
        let created_ms = 1_794_601_800_000;
        let tz_offset_minutes = 180; // UTC+3
        let rollover_hour = 4;

        // Add a review just before midnight local on Nov 14 (Nov 14 23:30 local -> 20:30 UTC)
        let before_midnight = 1_794_688_200_000;
        m.revlog.push(Revlog {
            id: before_midnight,
            card_id: 1000,
            usn: -1,
            ease: 3,
            interval: 1,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 1000,
            review_kind: 1,
        });

        // Add a card due on Day 1
        let mut c = make_test_card(1000);
        c.ctype = 2;
        c.queue = 2;
        c.due = 1; // due on Day 1
        m.cards.push(c);

        storage.import(&m, 1_700_000_000_000).unwrap();

        // 1. Just before midnight local: 2026-11-14 23:30 local -> Day 1, date 2026-11-14
        let s_before = storage
            .stats(
                None,
                None,
                tz_offset_minutes,
                rollover_hour,
                &FSRS6_DEFAULT_WEIGHTS,
                90.0,
                0, // caller's old today placeholder
                before_midnight,
                created_ms,
            )
            .unwrap();
        assert_eq!(s_before.today, 1, "before midnight local should be Day 1");
        assert_eq!(s_before.today_date, "2026-11-14");
        assert_eq!(
            s_before.dates.get(&1).map(String::as_str),
            Some("2026-11-14")
        );
        assert_eq!(s_before.reviews[0].day, 1);
        assert_eq!(s_before.reviews[0].date, "2026-11-14");
        assert_eq!(s_before.forecast[0].date, "2026-11-14");

        // 2. Just after midnight local: 2026-11-15 00:30 local (21:30 UTC Nov 14).
        // Since rollover is 4, 00:30 is BEFORE rollover, so it must still be Day 1!
        let after_midnight = 1_794_691_800_000;
        let s_after_midnight = storage
            .stats(
                None,
                None,
                tz_offset_minutes,
                rollover_hour,
                &FSRS6_DEFAULT_WEIGHTS,
                90.0,
                0,
                after_midnight,
                created_ms,
            )
            .unwrap();
        assert_eq!(
            s_after_midnight.today, 1,
            "after midnight before rollover 4 must still be Day 1"
        );
        assert_eq!(s_after_midnight.today_date, "2026-11-14");
        assert_eq!(
            s_after_midnight.dates.get(&1).map(String::as_str),
            Some("2026-11-14")
        );

        // 3. Just after rollover: 2026-11-15 04:30 local (01:30 UTC Nov 15).
        // Rollover 4 has passed -> Day 2, date 2026-11-15.
        let after_rollover = 1_794_706_200_000;
        let s_after_rollover = storage
            .stats(
                None,
                None,
                tz_offset_minutes,
                rollover_hour,
                &FSRS6_DEFAULT_WEIGHTS,
                90.0,
                0,
                after_rollover,
                created_ms,
            )
            .unwrap();
        assert_eq!(s_after_rollover.today, 2, "after rollover 4 must be Day 2");
        assert_eq!(s_after_rollover.today_date, "2026-11-15");
        assert_eq!(
            s_after_rollover.dates.get(&2).map(String::as_str),
            Some("2026-11-15")
        );
    }

    #[test]
    fn stats_respects_same_day_pre_cutoff_first_answer_and_phase_totals() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(0).unwrap();
        let created_ms = 19_676 * super::MS_PER_DAY;
        let now_ms = created_ms + 30 * super::MS_PER_DAY + 12 * 3_600_000;
        let day30_start = created_ms + 30 * super::MS_PER_DAY;
        let cutoff_30d = now_ms - 30 * super::MS_PER_DAY;

        let mut m = model();
        m.revlog.clear();
        m.cards[0].deck_id = 1;
        m.cards[0].ctype = 2;
        m.cards[0].queue = 2;
        m.cards[0].due = 25;
        m.cards[0].interval = 25;

        m.cards[1].deck_id = 1;
        m.cards[1].ctype = 2;
        m.cards[1].queue = 2;
        m.cards[1].due = 35;
        m.cards[1].interval = 10;

        m.revlog.push(Revlog {
            id: created_ms + 6 * 3_600_000,
            card_id: 1000,
            usn: -1,
            ease: 1,
            interval: 0,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 1500,
            review_kind: 0,
        });
        m.revlog.push(Revlog {
            id: created_ms + 14 * 3_600_000,
            card_id: 1000,
            usn: -1,
            ease: 3,
            interval: 5,
            last_interval: 2,
            ease_factor: 2500,
            taken_ms: 2500,
            review_kind: 1,
        });
        m.revlog.push(Revlog {
            id: day30_start + 3_600_000,
            card_id: 1001,
            usn: -1,
            ease: 3,
            interval: 4,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 3000,
            review_kind: 1,
        });
        m.revlog.push(Revlog {
            id: day30_start + 7_200_000,
            card_id: 1001,
            usn: -1,
            ease: 1,
            interval: 1,
            last_interval: 4,
            ease_factor: 2300,
            taken_ms: 1000,
            review_kind: 1,
        });

        storage.import(&m, 1_700_000_000_000).unwrap();
        let all = storage
            .stats(
                None,
                Some(30),
                0,
                0,
                &FSRS6_DEFAULT_WEIGHTS,
                90.0,
                30,
                now_ms,
                created_ms,
            )
            .unwrap();
        let filtered = storage
            .stats(
                Some(&[1]),
                Some(30),
                0,
                0,
                &FSRS6_DEFAULT_WEIGHTS,
                90.0,
                30,
                now_ms,
                created_ms,
            )
            .unwrap();

        assert!(cutoff_30d > created_ms + 6 * 3_600_000);
        assert_eq!(all.total_reviews, 3);
        assert_eq!(all.total_time_ms, 6500);
        assert_eq!(all.retention_pct, Some(100.0));
        assert_eq!(all.backlog_count, 1);
        assert_eq!(all.mature_count, 1);
        assert_eq!(all.young_count, 1);
        assert_eq!(filtered.total_reviews, all.total_reviews);
        assert_eq!(filtered.retention_pct, all.retention_pct);
        assert_eq!(filtered.deck_stats[0].reviews_7d, 2);
        assert_eq!(filtered.deck_stats[0].retention_pct, Some(100.0));
    }

    #[test]
    fn coach_computes_leech_weekly_cost_and_backlog_target() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(0).unwrap();
        let created_ms = 19_676 * super::MS_PER_DAY;
        let now_ms = created_ms + 30 * super::MS_PER_DAY + 12 * 3_600_000;

        let mut m = model();
        m.notes[0].tags = vec!["leech".into()];
        m.revlog.clear();
        // Active leech card (card 0) and suspended leech card (card 1)
        m.cards[0].deck_id = 1;
        m.cards[0].ctype = 2;
        m.cards[0].queue = 2;
        m.cards[0].due = 10; // overdue
        m.cards[0].interval = 14;
        m.cards[1].deck_id = 1;
        m.cards[1].ctype = 2;
        m.cards[1].queue = -1; // suspended leech must not be counted in active leeches

        // 13 extra notes + overdue cards so overdue backlog = 14 total.
        for i in 0..13_i64 {
            let nid = 101 + i;
            let mut n = m.notes[0].clone();
            n.id = nid;
            n.guid = format!("g{nid}");
            n.tags = vec![];
            let front = format!("normal {i}");
            n.fields = vec![front.clone()];
            n.sort_field = Some(front);
            m.notes.push(n);

            let mut c = make_test_card(1010 + i);
            c.note_id = nid;
            c.deck_id = 1;
            c.ctype = 2;
            c.queue = 2;
            c.due = 15 + i;
            c.interval = 20;
            m.cards.push(c);
        }

        // Leech took 180_000 ms (3 minutes) over last 7 days; plus 7 non-leech reviews (~1/day).
        m.revlog.push(Revlog {
            id: now_ms - 2 * super::MS_PER_DAY,
            card_id: 1000,
            usn: -1,
            ease: 1,
            interval: 1,
            last_interval: 10,
            ease_factor: 2300,
            taken_ms: 180_000,
            review_kind: 1,
        });
        for d in 0..7_i64 {
            m.revlog.push(Revlog {
                id: now_ms - d * 12 * 3_600_000 - 10_000,
                card_id: 1010,
                usn: -1,
                ease: 3,
                interval: 25,
                last_interval: 15,
                ease_factor: 2500,
                taken_ms: 5_000,
                review_kind: 1,
            });
        }

        storage.import(&m, now_ms).unwrap();
        let res = storage
            .stats(
                None,
                Some(30),
                0,
                0,
                &FSRS6_DEFAULT_WEIGHTS,
                90.0,
                30,
                now_ms,
                created_ms,
            )
            .unwrap();

        assert_eq!(res.coach.leech_count, 1);
        assert_eq!(res.coach.leech_card_ids.len(), 1);
        assert_eq!(res.coach.leech_weekly_minutes, 3);
        assert_eq!(res.coach.overdue_count, 14);
        // 14 overdue -> 2/day over 7d + (8 recent reviews / 7 = 1/day) = 3/day.
        assert_eq!(res.coach.suggested_daily_reviews, 3);

        let snap = storage.workload_snapshot(&[1]).unwrap();
        // 15 non-suspended cards (1 active leech + 13 normal overdue; card 1 is queue=-1)
        assert_eq!(snap.cards.len(), 14);
        assert!(snap.avg_review_secs >= 2.0 && snap.avg_review_secs <= 60.0);
    }

    #[test]
    fn stats_survive_algorithm_switch_sm2_to_fsrs_and_back() {
        use bibalak_core::model::Algorithm;
        use bibalak_core::ports::TestClock;
        use bibalak_core::Collection;
        use std::sync::Arc;

        let storage = SqliteStorage::open_in_memory().unwrap();
        let clock = Arc::new(TestClock::new(NOW));
        let col = Collection::new(Box::new(storage), clock).unwrap();

        // Seed a deck with SM-2 reviews (no fsrs_stability/difficulty/last_review).
        let deck = col.create_deck("Spanish").unwrap();
        let nt = col.add_stock_notetype(0).unwrap();
        let _added = col
            .add_note(nt.id, deck.id, &["hola".into(), "hello".into()], &[])
            .unwrap();
        let card = col.next_card(deck.id).unwrap().unwrap();
        let cfg_sm2 = col.get_deck_config(deck.id).unwrap();
        assert_eq!(cfg_sm2.algorithm, Algorithm::Sm2);

        // Record an SM-2 answer (no FSRS state on the card).
        let next_state = bibalak_core::scheduling::CardState {
            phase: bibalak_core::scheduling::CardPhase::Review,
            steps_remaining: 0,
            interval_days: 1,
            ease_milli: 2500,
            reps: 1,
            lapses: 0,
            stability: None,
            difficulty: None,
            last_review_day: None,
        };
        let log = bibalak_core::model::Revlog {
            id: NOW,
            card_id: card.id,
            usn: -1,
            ease: 3,
            interval: 1,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 2500,
            review_kind: 0,
        };
        col.apply_answer(
            card.id,
            card.note_id,
            &card.state,
            card.due,
            &next_state,
            1,
            &log,
            8,
        )
        .unwrap();

        // Switch SM-2 -> FSRS exactly as DeckOptionsDialog saves the payload.
        let mut cfg_fsrs = col.get_deck_config(deck.id).unwrap();
        cfg_fsrs.algorithm = Algorithm::Fsrs;
        col.set_deck_config(&cfg_fsrs).unwrap();

        let after_fsrs = col.stats(Some(deck.id), Some(30), 0).unwrap();
        assert_eq!(after_fsrs.total_reviews, 1);
        assert_eq!(after_fsrs.fsrs.card_count, 0);
        let all_after_fsrs = col.stats(None, None, 0).unwrap();
        assert_eq!(all_after_fsrs.total_reviews, 1);

        // Reverse switch: FSRS -> SM-2.
        let mut cfg_back = col.get_deck_config(deck.id).unwrap();
        cfg_back.algorithm = Algorithm::Sm2;
        col.set_deck_config(&cfg_back).unwrap();

        let after_sm2 = col.stats(Some(deck.id), Some(30), 0).unwrap();
        assert_eq!(after_sm2.total_reviews, 1);
    }

    #[test]
    fn stats_day_bucket_uses_div_euclid_for_negative_timestamps() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let mut m = model();
        m.revlog.clear();
        storage.import(&m, 1_700_000_000_000).unwrap();

        let card_id: i64 = storage
            .lock()
            .query_row("SELECT id FROM cards LIMIT 1", [], |r| r.get(0))
            .unwrap();
        storage
            .lock()
            .execute(
                "INSERT INTO revlog (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
                 VALUES (?1, ?2, -1, 3, 1, 0, 2500, 1000, 1)",
                [-3_600_000_i64, card_id],
            )
            .unwrap();

        let s = storage
            .stats(
                None,
                None,
                0,
                0,
                &FSRS6_DEFAULT_WEIGHTS,
                90.0,
                1,
                super::MS_PER_DAY,
                0,
            )
            .unwrap();

        assert_eq!(s.reviews.len(), 1);
        assert_eq!(
            s.reviews[0].day, -1,
            "1 hour before epoch at UTC+0 rollover 0 must bucket to day -1 via div_euclid"
        );
    }

    #[test]
    fn retention_without_qualifying_reviews_is_none() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(0).unwrap();
        let created_ms = 19_676 * super::MS_PER_DAY;
        let now_ms = created_ms + 5 * super::MS_PER_DAY;

        let mut m = model();
        m.revlog.clear();
        m.cards[0].deck_id = 1;
        m.cards[0].ctype = 2;
        m.cards[0].queue = 2;
        m.cards[0].interval = 5; // young card, graduated from learning
                                 // Only learning-step reviews (review_kind == 0), zero review_kind == 1 reviews.
        for i in 0..5_i64 {
            m.revlog.push(Revlog {
                id: now_ms - (i + 1) * 60_000,
                card_id: 1000,
                usn: -1,
                ease: 3,
                interval: 1,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 1200,
                review_kind: 0,
            });
        }
        storage.import(&m, now_ms).unwrap();

        let s = storage
            .stats(
                None,
                None,
                0,
                0,
                &FSRS6_DEFAULT_WEIGHTS,
                90.0,
                5,
                now_ms,
                created_ms,
            )
            .unwrap();
        assert_eq!(s.total_reviews, 5);
        assert_eq!(s.young_count, 1);
        assert_eq!(s.mature_count, 0);
        assert_eq!(s.retention_pct, None);
        assert!(s.deck_stats.iter().all(|d| d.retention_pct.is_none()));
    }

    #[test]
    fn retention_matches_anki_formula_on_fixture() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        storage.ensure_collection(0).unwrap();
        let created_ms = 19_676 * super::MS_PER_DAY;
        let now_ms = created_ms + 10 * super::MS_PER_DAY + 3_600_000;

        let mut m = model();
        m.revlog.clear();
        m.cards[0].deck_id = 1;
        m.cards[1].deck_id = 1;
        // Learning (kind 0) and relearn (kind 2) must be excluded.
        m.revlog.push(Revlog {
            id: now_ms - 5 * super::MS_PER_DAY,
            card_id: 1000,
            usn: -1,
            ease: 1,
            interval: 0,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 1000,
            review_kind: 0,
        });
        m.revlog.push(Revlog {
            id: now_ms - 4 * super::MS_PER_DAY,
            card_id: 1000,
            usn: -1,
            ease: 1,
            interval: 0,
            last_interval: 5,
            ease_factor: 2500,
            taken_ms: 1000,
            review_kind: 2,
        });
        // Young review pass (kind 1, ease 3, last_interval 5)
        m.revlog.push(Revlog {
            id: now_ms - 3 * super::MS_PER_DAY,
            card_id: 1000,
            usn: -1,
            ease: 3,
            interval: 12,
            last_interval: 5,
            ease_factor: 2500,
            taken_ms: 1000,
            review_kind: 1,
        });
        // Mature review pass (kind 1, ease 2 Hard, last_interval 25)
        m.revlog.push(Revlog {
            id: now_ms - 2 * super::MS_PER_DAY,
            card_id: 1000,
            usn: -1,
            ease: 2,
            interval: 30,
            last_interval: 25,
            ease_factor: 2500,
            taken_ms: 1000,
            review_kind: 1,
        });
        // Mature review fail (kind 1, ease 1 Again, last_interval 30)
        m.revlog.push(Revlog {
            id: now_ms - super::MS_PER_DAY,
            card_id: 1001,
            usn: -1,
            ease: 1,
            interval: 1,
            last_interval: 30,
            ease_factor: 2300,
            taken_ms: 1000,
            review_kind: 1,
        });

        storage.import(&m, now_ms).unwrap();
        let s = storage
            .stats(
                None,
                None,
                0,
                0,
                &FSRS6_DEFAULT_WEIGHTS,
                90.0,
                10,
                now_ms,
                created_ms,
            )
            .unwrap();
        // 2 passed out of 3 qualifying (young + mature review answers) = 66.666...%
        let pct = s.retention_pct.expect("qualifying reviews present");
        assert!((pct - (200.0 / 3.0)).abs() < 1e-9, "got {pct}");
    }
}
