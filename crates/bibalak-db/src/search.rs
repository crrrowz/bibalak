//! Anki-flavoured browser query parser → SQL.
//!
//! Converts a query string like `deck:Spanish is:due tag:verb -flag:1 hello`
//! into a parameterised SQL WHERE clause over the cards+notes+decks join.
//! Supported tokens:
//!   is:due|new|review|learn|suspended|buried
//!   flag:N          (0–7)
//!   deck:name       (prefix match with `*`, exact otherwise)
//!   tag:name        (exact tag match)
//!   note:name       (notetype exact match)
//!   added:N         (cards added in the last N days)
//!   prop:ivl/lapses/reps/ease/due/stability/difficulty OP value  (OP = > < = >= <=)
//!   answered:<phase>:<ease>[:sinceDays]  (phase = learning|young|mature; mirrors the
//!     stats-dashboard answer-buttons aggregate — distinct cards with a revlog row of
//!     that grade/phase, optionally within the last N days)
//!   -token          (negate any token)
//!   "multi word"    (quoted phrase, text LIKE)
//!   or              (infix OR between surrounding conditions)
//!   bare text       (LIKE match on fields + sort_field)

use crate::cards;
use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::{CardRow, NoteRow};
use bibalak_core::normalize_search_text;
use rusqlite::{params, Connection};

const FIELD_SEP: char = '\u{1f}';

/// Compute the normalized `notes.fields_norm` text stored for SQL search.
/// Includes `sort_field` (HTML-stripped first field) when it differs from the
/// raw normalized fields blob (e.g. HTML inside the first field).
pub(crate) fn fields_norm_value(fields_blob: &str, sort_field: Option<&str>) -> String {
    let mut norm = normalize_search_text(fields_blob);
    if let Some(sf) = sort_field {
        let norm_sf = normalize_search_text(sf);
        if !norm_sf.is_empty() && !norm.contains(&norm_sf) {
            if !norm.is_empty() {
                norm.push(FIELD_SEP);
            }
            norm.push_str(&norm_sf);
        }
    }
    norm
}

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

/// Typed SQL bind parameter.
#[derive(Debug, Clone)]
enum Param {
    Int(i64),
    Real(f64),
    Text(String),
}

impl rusqlite::ToSql for Param {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        match self {
            Param::Int(n) => n.to_sql(),
            Param::Real(f) => f.to_sql(),
            Param::Text(s) => s.to_sql(),
        }
    }
}

/// One parsed condition: SQL fragment + associated bindings.
/// `negated` wraps the fragment in `NOT (...)`.
struct Cond {
    negated: bool,
    sql: String,
    params: Vec<Param>,
}

impl Cond {
    fn pos(sql: impl Into<String>, params: Vec<Param>) -> Self {
        Cond {
            negated: false,
            sql: sql.into(),
            params,
        }
    }
}

/// Tokenise respecting double-quoted strings and escaped `\"`.
fn tokenize(query: &str) -> Vec<String> {
    let mut tokens = vec![];
    let mut cur = String::new();
    let mut in_quote = false;
    let mut escaped = false;
    for ch in query.chars() {
        if escaped {
            cur.push(ch);
            escaped = false;
            continue;
        }
        match ch {
            '\\' if in_quote => {
                cur.push(ch);
                escaped = true;
            }
            '"' => {
                in_quote = !in_quote;
                cur.push(ch);
            }
            ' ' | '\t' if !in_quote => {
                let tok = cur.trim().to_string();
                if !tok.is_empty() {
                    tokens.push(tok);
                }
                cur.clear();
            }
            _ => cur.push(ch),
        }
    }
    let tok = cur.trim().to_string();
    if !tok.is_empty() {
        tokens.push(tok);
    }
    tokens
}

/// Parse a single token (without leading `-`) into a condition SQL fragment.
fn parse_token(token: &str, today: i32, now_ms: i64) -> Option<Cond> {
    // is:
    if let Some(rest) = token.strip_prefix("is:") {
        let sql = match rest {
            "new" => "c.queue = 0".into(),
            "review" => "c.queue = 2".into(),
            "learn" => "c.queue = 1".into(),
            "due" => {
                format!("(c.queue = 2 AND c.due <= {today}) OR (c.queue = 1 AND c.due <= {now_ms})")
            }
            "suspended" => "c.queue = -1".into(),
            "buried" => "c.queue IN (-2, -3)".into(),
            _ => return None,
        };
        return Some(Cond::pos(sql, vec![]));
    }

    // flag:N
    if let Some(rest) = token.strip_prefix("flag:") {
        if let Ok(n) = rest.parse::<i64>() {
            return Some(Cond::pos("c.flags = ?", vec![Param::Int(n)]));
        }
        return None;
    }

    // deck:name or deck:name*
    if let Some(rest) = token.strip_prefix("deck:") {
        let name = dequote(rest);
        if name.ends_with('*') {
            let prefix = name.trim_end_matches('*');
            let pattern = format!("{prefix}%");
            return Some(Cond::pos("d.name LIKE ?", vec![Param::Text(pattern)]));
        }
        return Some(Cond::pos("d.name = ?", vec![Param::Text(name)]));
    }

    // tag:name (supports Anki hierarchical tags: `tag:lang` matches `lang` and `lang::*`)
    if let Some(rest) = token.strip_prefix("tag:") {
        let name = dequote(rest);
        if name.is_empty() {
            return None;
        }
        if let Some(prefix) = name.strip_suffix("::*") {
            let sub = format!("% {prefix}::%");
            return Some(Cond::pos("n.tags LIKE ?", vec![Param::Text(sub)]));
        }
        if let Some(prefix) = name.strip_suffix('*') {
            let wild = format!("% {prefix}%");
            return Some(Cond::pos("n.tags LIKE ?", vec![Param::Text(wild)]));
        }
        let exact = format!("% {name} %");
        let child = format!("% {name}::%");
        return Some(Cond::pos(
            "(n.tags LIKE ? OR n.tags LIKE ?)",
            vec![Param::Text(exact), Param::Text(child)],
        ));
    }

    // note:name (notetype)
    if let Some(rest) = token.strip_prefix("note:") {
        let name = dequote(rest);
        return Some(Cond::pos("nt.name = ?", vec![Param::Text(name)]));
    }

    // nid:123 or nid:123,456
    if let Some(rest) = token.strip_prefix("nid:") {
        let ids: Vec<i64> = rest
            .split(',')
            .filter_map(|s| s.trim().parse::<i64>().ok())
            .collect();
        if !ids.is_empty() {
            let placeholders = vec!["?"; ids.len()].join(", ");
            let params = ids.into_iter().map(Param::Int).collect();
            return Some(Cond::pos(format!("n.id IN ({placeholders})"), params));
        }
        return None;
    }

    // added:N — cards created in the last N days
    if let Some(rest) = token.strip_prefix("added:") {
        if let Ok(days) = rest.parse::<i64>() {
            // card.id encodes creation ms as the rowid assigned at insert time;
            // approximate: id > (now_ms - days * 86400 * 1000)
            let threshold = now_ms - days * 86_400_000;
            return Some(Cond::pos("c.id > ?", vec![Param::Int(threshold)]));
        }
        return None;
    }

    // prop:field OP value
    if let Some(rest) = token.strip_prefix("prop:") {
        return parse_prop(rest);
    }

    // answered:<phase>:<ease>[:sinceDays] — distinct cards with a revlog row
    // of that grade/phase, mirroring the stats answer-buttons aggregate.
    if let Some(rest) = token.strip_prefix("answered:") {
        return parse_answered(rest, now_ms);
    }

    // Quoted phrase or bare text → LIKE on normalized fields and raw fields,
    // supporting Anki `*`/`_` wildcards and `\*`/`\_`/`\"`/`\\` escapes.
    let text = strip_outer_quotes(token);
    if !text.is_empty() {
        let raw_pat = anki_text_to_like_pattern(text, false);
        let norm_pat = anki_text_to_like_pattern(text, true);
        if !raw_pat.is_empty() && !norm_pat.is_empty() {
            let raw_like = format!("%{raw_pat}%");
            let norm_like = format!("%{norm_pat}%");
            return Some(Cond::pos(
                "(n.fields_norm LIKE ? ESCAPE '\\' OR n.fields LIKE ? ESCAPE '\\')",
                vec![Param::Text(norm_like), Param::Text(raw_like)],
            ));
        }
    }

    None
}

/// Parse `prop:field OP value` where OP ∈ {>, <, =, >=, <=}.
fn parse_prop(rest: &str) -> Option<Cond> {
    // Determine field and OP: greedily match field name up to operator.
    let ops = [">=", "<=", ">", "<", "="];
    for &op in &ops {
        if let Some(pos) = rest.find(op) {
            let field = &rest[..pos];
            let val_str = &rest[pos + op.len()..];
            let col = match field {
                "ivl" => "c.interval",
                "lapses" => "c.lapses",
                "reps" => "c.reps",
                "due" => "c.due",
                "ease" => "c.ease_factor",
                "stability" => "c.fsrs_stability",
                "difficulty" => "c.fsrs_difficulty",
                _ => return None,
            };
            // ease is stored in milli-percent (2500 = 250%); user writes 250.
            if field == "ease" {
                if let Ok(v) = val_str.parse::<f64>() {
                    let v_milli = (v * 10.0).round() as i64;
                    return Some(Cond::pos(
                        format!("{col} {op} ?"),
                        vec![Param::Int(v_milli)],
                    ));
                }
            } else if field == "stability" || field == "difficulty" {
                if let Ok(v) = val_str.parse::<f64>() {
                    return Some(Cond::pos(format!("{col} {op} ?"), vec![Param::Real(v)]));
                }
            } else if let Ok(v) = val_str.parse::<i64>() {
                return Some(Cond::pos(format!("{col} {op} ?"), vec![Param::Int(v)]));
            }
            return None;
        }
    }
    None
}

/// Parse `answered:<phase>:<ease>[:sinceDays]` into a distinct-card subquery
/// over `revlog`, mirroring the phase/ease bucketing in `bibalak-db::stats`
/// (answer-buttons aggregate): phase 0 = learning (review_kind IN (0,2)),
/// young = review_kind 1 with last_interval < 21, mature = >= 21.
fn parse_answered(rest: &str, now_ms: i64) -> Option<Cond> {
    let parts: Vec<&str> = rest.split(':').collect();
    let phase = *parts.first()?;
    let ease: i64 = parts.get(1)?.parse().ok()?;
    if !(1..=4).contains(&ease) {
        return None;
    }
    let phase_sql = match phase {
        "learning" => "r.review_kind IN (0, 2)",
        "young" => "r.review_kind = 1 AND r.last_interval < 21",
        "mature" => "r.review_kind = 1 AND r.last_interval >= 21",
        _ => return None,
    };

    let mut sql = format!(
        "c.id IN (SELECT r.card_id FROM revlog r WHERE r.ease = ? AND r.review_kind <= 2 AND {phase_sql}"
    );
    let mut params = vec![Param::Int(ease)];
    if let Some(days_str) = parts.get(2) {
        let days: i64 = days_str.parse().ok()?;
        sql.push_str(" AND r.id >= ?");
        params.push(Param::Int(now_ms - days * 86_400_000));
    }
    sql.push(')');
    Some(Cond::pos(sql, params))
}

fn strip_outer_quotes(s: &str) -> &str {
    s.strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .unwrap_or(s)
}

fn dequote(s: &str) -> String {
    strip_outer_quotes(s).replace("\\\"", "\"")
}

/// Convert an Anki search text token (already stripped of outer quotes) to a
/// SQLite `LIKE ... ESCAPE '\'` pattern body: `*` -> `%`, `_` -> `_`,
/// `\*` -> `*`, `\_` -> `\_`, `\"` -> `"`, `\\` -> `\\`, literal `%` -> `\%`.
fn anki_text_to_like_pattern(input: &str, normalize_literals: bool) -> String {
    let mut out = String::with_capacity(input.len() + 8);
    let mut lit = String::new();
    let flush_lit = |lit: &mut String, out: &mut String| {
        if lit.is_empty() {
            return;
        }
        let s = if normalize_literals {
            std::borrow::Cow::Owned(normalize_search_text(lit))
        } else {
            std::borrow::Cow::Borrowed(lit.as_str())
        };
        for ch in s.chars() {
            match ch {
                '\\' | '%' | '_' => {
                    out.push('\\');
                    out.push(ch);
                }
                _ => out.push(ch),
            }
        }
        lit.clear();
    };

    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\\' => {
                if let Some(&next) = chars.peek() {
                    if matches!(next, '*' | '_' | '"' | '\\') {
                        chars.next();
                        lit.push(next);
                        continue;
                    }
                }
                lit.push('\\');
            }
            '*' => {
                flush_lit(&mut lit, &mut out);
                out.push('%');
            }
            '_' => {
                flush_lit(&mut lit, &mut out);
                out.push('_');
            }
            _ => lit.push(ch),
        }
    }
    flush_lit(&mut lit, &mut out);
    out
}

/// Build the SQL WHERE clause and bind-param list from a query string.
/// Returns `("1=1", [])` for an empty query (all cards).
fn build_where(query: &str, today: i32, now_ms: i64) -> (String, Vec<Param>) {
    if query.trim().is_empty() {
        return ("1=1".into(), vec![]);
    }

    let tokens = tokenize(query);
    let mut parts: Vec<String> = vec![];
    let mut params: Vec<Param> = vec![];
    let mut pending_or = false;
    for tok in &tokens {
        // `or` token: flag next condition to be ORed with the previous.
        if tok.eq_ignore_ascii_case("or") {
            pending_or = true;
            continue;
        }

        let (negated, raw) = if tok.starts_with('-') && tok.len() > 1 {
            (true, &tok[1..])
        } else {
            (false, tok.as_str())
        };

        let Some(mut cond) = parse_token(raw, today, now_ms) else {
            pending_or = false;
            continue;
        };
        if negated {
            cond.negated = !cond.negated;
        }

        let frag = renumber_placeholders(&cond.sql, params.len() + 1);

        let full = if cond.negated {
            format!("NOT ({frag})")
        } else {
            frag
        };

        if pending_or && !parts.is_empty() {
            let prev = parts.pop().unwrap();
            parts.push(format!("({prev} OR {full})"));
            pending_or = false;
        } else {
            parts.push(full);
            pending_or = false;
        }
        params.extend(cond.params);
    }

    if parts.is_empty() {
        return ("1=1".into(), vec![]);
    }
    (parts.join(" AND "), params)
}

/// Replace each bare `?` in `sql` with numbered `?1`, `?2` starting at `start`.
fn renumber_placeholders(sql: &str, start: usize) -> String {
    let mut out = String::with_capacity(sql.len() + 8);
    let mut n = start;
    for ch in sql.chars() {
        if ch == '?' {
            out.push('?');
            out.push_str(&n.to_string());
            n += 1;
        } else {
            out.push(ch);
        }
    }
    out
}

const BASE_SQL: &str = "
SELECT c.id, c.note_id, COALESCE(n.sort_field, ''), d.name, nt.name, n.tags,
       c.queue, c.type, c.due, c.interval, c.lapses, c.reps, c.ease_factor, c.flags
FROM cards c
JOIN notes n ON n.id = c.note_id
JOIN decks d ON d.id = c.deck_id
JOIN notetypes nt ON nt.id = n.notetype_id
WHERE ";

#[allow(clippy::too_many_arguments)]
pub fn search_cards(
    conn: &Connection,
    query: &str,
    today: i32,
    now_ms: i64,
    limit: i64,
    offset: i64,
    sort_key: Option<&str>,
    sort_asc: bool,
) -> CoreResult<Vec<CardRow>> {
    let (where_clause, mut params) = build_where(query, today, now_ms);
    let limit_idx = params.len() + 1;
    params.push(Param::Int(limit));
    let offset_idx = params.len() + 1;
    params.push(Param::Int(offset));

    let dir = if sort_asc { "ASC" } else { "DESC" };
    let order_clause = match sort_key {
        Some("sort_field") => format!("n.sort_field COLLATE NOCASE {dir}, c.id {dir}"),
        Some("deck") => format!("d.name COLLATE NOCASE {dir}, c.id {dir}"),
        Some("notetype") => format!("nt.name COLLATE NOCASE {dir}, c.id {dir}"),
        Some("queue") => format!("c.queue {dir}, c.id {dir}"),
        Some("due") => format!(
            "CASE \
               WHEN (c.type IN (1, 3) OR c.queue IN (1, 3)) AND c.due > 10000000000 THEN \
                 (c.due - (SELECT created FROM collection WHERE id = 1)) / 86400000 \
               WHEN c.type = 0 OR c.queue = 0 THEN \
                 1000000 + c.due \
               ELSE c.due \
             END {dir}, c.id {dir}"
        ),
        Some("interval") => format!("c.interval {dir}, c.id {dir}"),
        Some("lapses") => format!("c.lapses {dir}, c.id {dir}"),
        Some("reps") => format!("c.reps {dir}, c.id {dir}"),
        _ => format!("c.id {dir}"),
    };

    let sql = format!(
        "{BASE_SQL}{where_clause} ORDER BY {order_clause} LIMIT ?{limit_idx} OFFSET ?{offset_idx}"
    );

    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |r| {
            let tags: String = r.get(5)?;
            Ok(CardRow {
                card_id: r.get(0)?,
                note_id: r.get(1)?,
                sort_field: r.get(2)?,
                deck: r.get(3)?,
                notetype: r.get(4)?,
                tags: tags
                    .split_whitespace()
                    .map(str::to_string)
                    .collect::<Vec<_>>(),
                queue: r.get(6)?,
                card_type: r.get(7)?,
                due: r.get(8)?,
                interval: r.get(9)?,
                lapses: r.get(10)?,
                reps: r.get(11)?,
                flags: r.get(13)?,
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

#[allow(clippy::too_many_arguments)]
pub fn search_note_rows(
    conn: &Connection,
    query: &str,
    today: i32,
    now_ms: i64,
    limit: i64,
    offset: i64,
    sort_key: Option<&str>,
    sort_asc: bool,
) -> CoreResult<Vec<NoteRow>> {
    let (where_clause, mut params) = build_where(query, today, now_ms);
    let limit_idx = params.len() + 1;
    params.push(Param::Int(limit));
    let offset_idx = params.len() + 1;
    params.push(Param::Int(offset));

    let dir = if sort_asc { "ASC" } else { "DESC" };
    let order_clause = match sort_key {
        Some("sort_field") => format!("n.sort_field COLLATE NOCASE {dir}, n.id {dir}"),
        Some("notetype") => format!("nt.name COLLATE NOCASE {dir}, n.id {dir}"),
        Some("deck") => format!("MIN(d.name) COLLATE NOCASE {dir}, n.id {dir}"),
        Some("cards") => format!("COUNT(DISTINCT c.id) {dir}, n.id {dir}"),
        Some("modified") => format!("n.\"mod\" {dir}, n.id {dir}"),
        _ => format!("n.id {dir}"),
    };

    let sql = format!(
        "SELECT n.id, \
                COALESCE(GROUP_CONCAT(c.id), ''), \
                COALESCE(n.sort_field, ''), \
                nt.name, \
                COALESCE(MIN(d.name), ''), \
                COUNT(DISTINCT c.id), \
                n.tags, \
                n.\"mod\" \
         FROM notes n \
         JOIN notetypes nt ON nt.id = n.notetype_id \
         LEFT JOIN cards c ON c.note_id = n.id \
         LEFT JOIN decks d ON d.id = c.deck_id \
         WHERE {where_clause} \
         GROUP BY n.id \
         ORDER BY {order_clause} \
         LIMIT ?{limit_idx} OFFSET ?{offset_idx}"
    );

    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |r| {
            let cids_str: String = r.get(1)?;
            let mut card_ids: Vec<i64> = cids_str
                .split(',')
                .filter_map(|s| s.trim().parse::<i64>().ok())
                .collect();
            card_ids.sort_unstable();
            let tags: String = r.get(6)?;
            Ok(NoteRow {
                note_id: r.get(0)?,
                card_ids,
                sort_field: r.get(2)?,
                notetype: r.get(3)?,
                deck: r.get(4)?,
                card_count: r.get::<_, i64>(5)? as u32,
                tags: tags
                    .split_whitespace()
                    .map(str::to_string)
                    .collect::<Vec<_>>(),
                mod_ms: r.get(7)?,
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

/// Total cards matching `query` (uses the same `build_where` filter as `search_cards`).
pub fn count_cards(conn: &Connection, query: &str, today: i32, now_ms: i64) -> CoreResult<u32> {
    let (where_clause, params) = build_where(query, today, now_ms);
    let sql = format!(
        "SELECT COUNT(*) \
         FROM cards c \
         JOIN notes n ON n.id = c.note_id \
         JOIN decks d ON d.id = c.deck_id \
         JOIN notetypes nt ON nt.id = n.notetype_id \
         WHERE {where_clause}"
    );
    let count: i64 = conn
        .query_row(&sql, rusqlite::params_from_iter(params.iter()), |r| {
            r.get(0)
        })
        .map_err(err)?;
    Ok(u32::try_from(count.max(0)).unwrap_or(u32::MAX))
}

/// Total distinct notes matching `query` (uses the same `build_where` filter as `search_note_rows`).
pub fn count_note_rows(conn: &Connection, query: &str, today: i32, now_ms: i64) -> CoreResult<u32> {
    let (where_clause, params) = build_where(query, today, now_ms);
    let sql = format!(
        "SELECT COUNT(DISTINCT n.id) \
         FROM notes n \
         JOIN notetypes nt ON nt.id = n.notetype_id \
         LEFT JOIN cards c ON c.note_id = n.id \
         LEFT JOIN decks d ON d.id = c.deck_id \
         WHERE {where_clause}"
    );
    let count: i64 = conn
        .query_row(&sql, rusqlite::params_from_iter(params.iter()), |r| {
            r.get(0)
        })
        .map_err(err)?;
    Ok(u32::try_from(count.max(0)).unwrap_or(u32::MAX))
}

/// Extract distinct-note media ref counts across notes matching `query`.
pub fn note_media_ref_counts_matching(
    conn: &Connection,
    query: &str,
    today: i32,
    now_ms: i64,
) -> CoreResult<Vec<(String, u32)>> {
    if query.trim().is_empty() {
        return crate::backup::note_media_ref_counts(conn);
    }
    let (where_clause, params) = build_where(query, today, now_ms);
    let sql = format!(
        "SELECT n.fields
         FROM notes n
         WHERE n.id IN (
             SELECT n.id
             FROM notes n
             JOIN notetypes nt ON nt.id = n.notetype_id
             LEFT JOIN cards c ON c.note_id = n.id
             LEFT JOIN decks d ON d.id = c.deck_id
             WHERE {where_clause}
         )"
    );
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    crate::backup::collect_media_ref_counts(&mut stmt, rusqlite::params_from_iter(params.iter()))
}

// ── Bulk helpers ───────────────────────────────────────────────────────────────

/// Delete notes (and their cards + revlogs) by note id list, writing graves.
pub fn delete_notes(conn: &Connection, note_ids: &[i64], now_ms: i64) -> CoreResult<()> {
    if note_ids.is_empty() {
        return Ok(());
    }
    let json = serde_json::to_string(note_ids).map_err(err)?;
    // Revlog rows for all cards of these notes.
    conn.execute(
        "DELETE FROM revlog WHERE card_id IN (SELECT id FROM cards WHERE note_id IN (SELECT value FROM json_each(?1)))",
        [&json],
    )
    .map_err(err)?;
    // Card graves (type 0 = card). Must be captured before cards are deleted.
    conn.execute(
        "INSERT OR IGNORE INTO graves (usn, oid, type) SELECT -1, id, 0 FROM cards WHERE note_id IN (SELECT value FROM json_each(?1))",
        [&json],
    )
    .map_err(err)?;
    conn.execute(
        "INSERT OR REPLACE INTO grave_times (oid, type, deleted_ms) SELECT id, 0, ?2 FROM cards WHERE note_id IN (SELECT value FROM json_each(?1))",
        params![json, now_ms],
    )
    .map_err(err)?;
    // Cards.
    conn.execute(
        "DELETE FROM cards WHERE note_id IN (SELECT value FROM json_each(?1))",
        [&json],
    )
    .map_err(err)?;
    // Graves (type 1 = note).
    conn.execute(
        "INSERT OR IGNORE INTO graves (usn, oid, type) SELECT -1, value, 1 FROM json_each(?1)",
        [&json],
    )
    .map_err(err)?;
    conn.execute(
        "INSERT OR REPLACE INTO grave_times (oid, type, deleted_ms) SELECT value, 1, ?2 FROM json_each(?1)",
        params![json, now_ms],
    )
    .map_err(err)?;
    // Notes.
    conn.execute(
        "DELETE FROM notes WHERE id IN (SELECT value FROM json_each(?1))",
        [&json],
    )
    .map_err(err)?;
    // Bump collection modified (without bumping schema_mod).
    conn.execute("UPDATE collection SET modified = ?1 WHERE id = 1", [now_ms])
        .map_err(err)?;
    Ok(())
}

/// Reassign a list of cards to a different deck.
pub fn move_cards_to_deck(
    conn: &Connection,
    card_ids: &[i64],
    deck_id: i64,
    now_ms: i64,
) -> CoreResult<()> {
    if card_ids.is_empty() {
        return Ok(());
    }
    use rusqlite::OptionalExtension;
    let is_filtered: Option<bool> = conn
        .query_row(
            "SELECT is_filtered != 0 FROM decks WHERE id = ?1",
            [deck_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;

    match is_filtered {
        None => return Err(CoreError::NotFound(format!("deck {deck_id} not found"))),
        Some(true) => {
            return Err(CoreError::Invalid(
                "cannot move cards to a filtered deck".into(),
            ))
        }
        Some(false) => {}
    }

    let json = serde_json::to_string(card_ids).map_err(err)?;
    conn.execute(
        r#"UPDATE cards SET deck_id = ?1, "mod" = ?2, usn = -1 WHERE id IN (SELECT value FROM json_each(?3))"#,
        rusqlite::params![deck_id, now_ms, json],
    )
    .map_err(err)?;
    Ok(())
}

/// Remove `tag` from a note's tag blob (idempotent).
pub fn remove_note_tag(conn: &Connection, note_id: i64, tag: &str, now_ms: i64) -> CoreResult<()> {
    let current: String = conn
        .query_row("SELECT tags FROM notes WHERE id = ?1", [note_id], |r| {
            r.get(0)
        })
        .map_err(err)?;
    let needle = format!(" {tag} ");
    if !current.contains(&needle) {
        return Ok(());
    }
    let new_tags = current.replace(&needle, " ").trim().to_string();
    let new_tags = if new_tags.is_empty() {
        String::new()
    } else {
        format!(" {new_tags} ")
    };
    conn.execute(
        r#"UPDATE notes SET tags = ?2, "mod" = ?3, usn = -1 WHERE id = ?1"#,
        rusqlite::params![note_id, new_tags, now_ms],
    )
    .map_err(err)?;
    Ok(())
}

/// Bulk: add a tag to many notes in one transaction.
pub fn bulk_add_note_tags(
    conn: &mut Connection,
    note_ids: &[i64],
    tag: &str,
    now_ms: i64,
) -> CoreResult<()> {
    if note_ids.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction().map_err(err)?;
    for &id in note_ids {
        cards::add_note_tag(&tx, id, tag, now_ms)?;
    }
    tx.commit().map_err(err)?;
    Ok(())
}

/// Bulk: remove a tag from many notes in one transaction.
pub fn bulk_remove_note_tags(
    conn: &mut Connection,
    note_ids: &[i64],
    tag: &str,
    now_ms: i64,
) -> CoreResult<()> {
    if note_ids.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction().map_err(err)?;
    for &id in note_ids {
        remove_note_tag(&tx, id, tag, now_ms)?;
    }
    tx.commit().map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::storage::SqliteStorage;
    use bibalak_core::ports::*;

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
                notes: vec![
                    Note {
                        id: 1,
                        guid: "g1".into(),
                        notetype_id: 1,
                        mod_ms: 0,
                        usn: -1,
                        tags: vec!["verb".into()],
                        fields: vec!["hello".into(), "hola".into()],
                        sort_field: Some("hello".into()),
                        checksum: None,
                    },
                    Note {
                        id: 2,
                        guid: "g2".into(),
                        notetype_id: 1,
                        mod_ms: 0,
                        usn: -1,
                        tags: vec!["noun".into()],
                        fields: vec!["cat".into(), "gato".into()],
                        sort_field: Some("cat".into()),
                        checksum: None,
                    },
                ],
                cards: vec![
                    Card {
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
                        flags: 1,
                        fsrs_stability: None,
                        fsrs_difficulty: None,
                        fsrs_last_review: None,
                        data: None,
                    },
                    Card {
                        id: 2,
                        note_id: 2,
                        deck_id: 1,
                        ord: 0,
                        mod_ms: 0,
                        usn: -1,
                        ctype: 2,
                        queue: 2,
                        due: 0,
                        interval: 30,
                        ease_factor: 2500,
                        reps: 5,
                        lapses: 1,
                        remaining: 0,
                        original_due: 0,
                        original_deck_id: 0,
                        flags: 0,
                        fsrs_stability: None,
                        fsrs_difficulty: None,
                        fsrs_last_review: None,
                        data: None,
                    },
                ],
                ..Default::default()
            },
            1_700_000_000_000,
        )
        .unwrap();
        let card1: i64 = s.lock().query_row("SELECT id FROM cards WHERE note_id = (SELECT id FROM notes WHERE sort_field = 'hello')", [], |r| r.get(0)).unwrap();
        let card2: i64 = s.lock().query_row("SELECT id FROM cards WHERE note_id = (SELECT id FROM notes WHERE sort_field = 'cat')", [], |r| r.get(0)).unwrap();
        (s, card1, card2)
    }

    #[test]
    fn empty_query_returns_all() {
        let (s, _, _) = setup();
        let rows = s
            .search_cards("", 0, 1_700_000_000_000, 100, 0, None, true)
            .unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn is_new_filter() {
        let (s, _, _) = setup();
        let rows = s
            .search_cards("is:new", 0, 1_700_000_000_000, 100, 0, None, true)
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].sort_field, "hello");
    }

    #[test]
    fn is_review_filter() {
        let (s, _, _) = setup();
        let rows = s
            .search_cards("is:review", 0, 1_700_000_000_000, 100, 0, None, true)
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].sort_field, "cat");
    }

    #[test]
    fn tag_filter() {
        let (s, _, _) = setup();
        let rows = s
            .search_cards("tag:verb", 0, 1_700_000_000_000, 100, 0, None, true)
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].tags.contains(&"verb".to_string()));
    }

    #[test]
    fn flag_filter() {
        let (s, _, _) = setup();
        let rows = s
            .search_cards("flag:1", 0, 1_700_000_000_000, 100, 0, None, true)
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].flags, 1);
    }

    #[test]
    fn negation() {
        let (s, _, _) = setup();
        let rows = s
            .search_cards("-is:new", 0, 1_700_000_000_000, 100, 0, None, true)
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_ne!(rows[0].queue, 0);
    }

    #[test]
    fn text_search() {
        let (s, _, _) = setup();
        let rows = s
            .search_cards("hello", 0, 1_700_000_000_000, 100, 0, None, true)
            .unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn prop_lapses() {
        let (s, _, _) = setup();
        let rows = s
            .search_cards("prop:lapses>0", 0, 1_700_000_000_000, 100, 0, None, true)
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].lapses, 1);
    }

    #[test]
    fn prop_stability_and_difficulty() {
        let (s, card1, _) = setup();
        s.lock()
            .execute(
                "UPDATE cards SET fsrs_stability = 12.5, fsrs_difficulty = 4.2 WHERE id = ?1",
                [card1],
            )
            .unwrap();
        let rows = s
            .search_cards(
                "prop:stability>10",
                0,
                1_700_000_000_000,
                100,
                0,
                None,
                true,
            )
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].sort_field, "hello");

        let rows = s
            .search_cards(
                "prop:difficulty>=4 prop:difficulty<5",
                0,
                1_700_000_000_000,
                100,
                0,
                None,
                true,
            )
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].sort_field, "hello");
    }

    #[test]
    fn answered_filter() {
        let (s, _, card2) = setup();
        let now_ms = 1_700_000_000_000i64;
        s.lock()
            .execute(
                "INSERT INTO revlog (id, card_id, usn, ease, interval, last_interval, ease_factor, taken_ms, review_kind)
                 VALUES (?1, ?2, -1, 3, 30, 30, 2500, 0, 1)",
                rusqlite::params![now_ms - 1000, card2],
            )
            .unwrap();
        let rows = s
            .search_cards("answered:mature:3", 0, now_ms, 100, 0, None, true)
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].sort_field, "cat");

        // Wrong ease matches nothing.
        let rows = s
            .search_cards("answered:mature:1", 0, now_ms, 100, 0, None, true)
            .unwrap();
        assert_eq!(rows.len(), 0);

        // sinceDays window excludes it when too narrow.
        let rows = s
            .search_cards(
                "answered:mature:3:0",
                0,
                now_ms + 2 * 86_400_000,
                100,
                0,
                None,
                true,
            )
            .unwrap();
        assert_eq!(rows.len(), 0);
    }

    #[test]
    fn delete_notes_removes_cards_and_notes() {
        let (s, _, _) = setup();
        let note_ids: Vec<i64> = s
            .lock()
            .query_row("SELECT id FROM notes WHERE sort_field = 'hello'", [], |r| {
                r.get(0)
            })
            .map(|id| vec![id])
            .unwrap();
        s.delete_notes(&note_ids, 1_000).unwrap();
        let rows = s
            .search_cards("", 0, 1_700_000_000_000, 100, 0, None, true)
            .unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn move_cards_to_deck() {
        let (s, card1, _) = setup();
        // Create a second deck first.
        let new_deck = s
            .lock()
            .query_row(
                "SELECT id FROM decks WHERE id = 1",
                [],
                |r: &rusqlite::Row| r.get::<_, i64>(0),
            )
            .unwrap();
        // Move card1 to same deck (no-op but exercises the path).
        s.move_cards_to_deck(&[card1], new_deck, 1_700_000_000_000)
            .unwrap();
        let rows = s
            .search_cards("is:new", 0, 1_700_000_000_000, 100, 0, None, true)
            .unwrap();
        assert_eq!(rows[0].deck, "Default");
    }

    #[test]
    fn arabic_variants_and_latin_accents_match_text_while_facets_stay_exact() {
        let s = SqliteStorage::open_in_memory().unwrap();
        let now_ms = 1_700_000_000_000;
        s.ensure_collection(now_ms).unwrap();
        let nt_id = s.add_stock_notetype(0, now_ms).unwrap();
        let deck_id = s.create_deck("مَدْرَسَة", now_ms).unwrap().id;

        s.add_note_with_cards(
            nt_id,
            deck_id,
            &["الإسلام".into(), "معنى".into()],
            &["الإسلام".into()],
            now_ms,
        )
        .unwrap();
        s.add_note_with_cards(
            nt_id,
            1,
            &["<b>مَدْرَسَة</b>".into(), "school".into()],
            &[],
            now_ms,
        )
        .unwrap();
        s.add_note_with_cards(nt_id, 1, &["café".into(), "coffee".into()], &[], now_ms)
            .unwrap();

        let islam = s
            .search_cards("الاسلام", 0, now_ms, 100, 0, None, true)
            .unwrap();
        assert_eq!(islam.len(), 1);
        assert_eq!(islam[0].sort_field, "الإسلام");

        let school = s
            .search_cards("مدرسه", 0, now_ms, 100, 0, None, true)
            .unwrap();
        assert_eq!(school.len(), 1);
        assert_eq!(school[0].sort_field, "مَدْرَسَة");

        let cafe = s
            .search_cards("cafe", 0, now_ms, 100, 0, None, true)
            .unwrap();
        assert_eq!(cafe.len(), 1);
        assert_eq!(cafe[0].sort_field, "café");

        // Exact matching for tag: and deck: facets.
        assert_eq!(
            s.search_cards("tag:الإسلام", 0, now_ms, 100, 0, None, true)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            s.search_cards("tag:الاسلام", 0, now_ms, 100, 0, None, true)
                .unwrap()
                .len(),
            0
        );
        assert_eq!(
            s.search_cards("deck:مَدْرَسَة", 0, now_ms, 100, 0, None, true)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            s.search_cards("deck:مدرسه", 0, now_ms, 100, 0, None, true)
                .unwrap()
                .len(),
            0
        );
    }

    #[test]
    fn move_cards_to_filtered_deck_is_rejected() {
        let (s, card1, _) = setup();
        let fdeck = s
            .create_filtered_deck("Filtered", "is:due", 0, 20, 0, 1_700_000_000_000)
            .unwrap();
        let err = s
            .move_cards_to_deck(&[card1], fdeck.id, 1_700_000_000_000)
            .unwrap_err();
        match err {
            bibalak_core::error::CoreError::Invalid(msg) => {
                assert!(msg.contains("filtered"))
            }
            other => panic!("expected Invalid, got {:?}", other),
        }
    }

    #[test]
    fn server_side_sorting() {
        let (s, _, _) = setup();
        // setup creates 2 notes: "hello" (id 1, lapses 0) and "cat" (id 2, lapses 1).
        // Sort by sort_field asc: "cat" < "hello"
        let rows_asc = s
            .search_cards("", 0, 1_700_000_000_000, 100, 0, Some("sort_field"), true)
            .unwrap();
        assert_eq!(rows_asc[0].sort_field, "cat");
        assert_eq!(rows_asc[1].sort_field, "hello");

        // Sort by sort_field desc: "hello" > "cat"
        let rows_desc = s
            .search_cards("", 0, 1_700_000_000_000, 100, 0, Some("sort_field"), false)
            .unwrap();
        assert_eq!(rows_desc[0].sort_field, "hello");
        assert_eq!(rows_desc[1].sort_field, "cat");

        // Sort by lapses asc: 0 < 1
        let rows_lapses_asc = s
            .search_cards("", 0, 1_700_000_000_000, 100, 0, Some("lapses"), true)
            .unwrap();
        assert_eq!(rows_lapses_asc[0].lapses, 0);
        assert_eq!(rows_lapses_asc[1].lapses, 1);
    }

    #[test]
    fn search_note_rows_returns_one_row_per_note_supports_nid_filter_and_sorts() {
        let s = SqliteStorage::open_in_memory().unwrap();
        let nt_id = s.create_notetype("TwoCard", 0, 1_000).unwrap();
        s.add_template(nt_id, "Card 2", "{{Back}}", "{{Front}}", 1_000)
            .unwrap();
        let r1 = s
            .add_note_with_cards(
                nt_id,
                1,
                &["Zeta".into(), "BackZ".into()],
                &["t1".into()],
                1_000,
            )
            .unwrap();
        let r2 = s
            .add_note_with_cards(nt_id, 1, &["Alpha".into(), "BackA".into()], &[], 2_000)
            .unwrap();

        // Card mode returns 4 cards across 2 notes; Notes mode returns 2 rows (1 per note).
        let cards = s.search_cards("", 0, 3_000, 100, 0, None, true).unwrap();
        assert_eq!(cards.len(), 4);

        let notes = s
            .search_note_rows("", 0, 3_000, 100, 0, Some("sort_field"), true)
            .unwrap();
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].note_id, r2.0);
        assert_eq!(notes[0].card_count, 2);
        assert_eq!(notes[0].card_ids.len(), 2);
        assert_eq!(notes[1].note_id, r1.0);
        assert_eq!(notes[1].tags, vec!["t1".to_string()]);

        // nid: filter works across cards and notes mode
        let nid_query = format!("nid:{}", r1.0);
        let filtered_notes = s
            .search_note_rows(&nid_query, 0, 3_000, 100, 0, None, true)
            .unwrap();
        assert_eq!(filtered_notes.len(), 1);
        assert_eq!(filtered_notes[0].note_id, r1.0);
        assert_eq!(
            s.search_cards(&nid_query, 0, 3_000, 100, 0, None, true)
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn tag_search_supports_hierarchical_parents_and_wildcards() {
        let s = SqliteStorage::open_in_memory().unwrap();
        let nt_id = s.create_notetype("Basic", 0, 1_000).unwrap();
        s.add_note_with_cards(
            nt_id,
            1,
            &["Child".into(), "".into()],
            &["lang::arabic::verbs".into()],
            1_000,
        )
        .unwrap();
        s.add_note_with_cards(
            nt_id,
            1,
            &["SiblingPrefix".into(), "".into()],
            &["language".into()],
            2_000,
        )
        .unwrap();

        let exact_sub = s
            .search_cards("tag:lang::arabic", 0, 3_000, 100, 0, None, true)
            .unwrap();
        assert_eq!(exact_sub.len(), 1);
        assert_eq!(exact_sub[0].sort_field, "Child");

        let parent = s
            .search_cards("tag:lang", 0, 3_000, 100, 0, None, true)
            .unwrap();
        assert_eq!(parent.len(), 1);
        assert_eq!(parent[0].sort_field, "Child");

        let wild = s
            .search_cards("tag:lang::*", 0, 3_000, 100, 0, None, true)
            .unwrap();
        assert_eq!(wild.len(), 1);
        assert_eq!(wild[0].sort_field, "Child");
    }

    #[test]
    fn note_media_ref_counts_matching_filters_by_deck_tag_and_combined_queries() {
        let s = SqliteStorage::open_in_memory().unwrap();
        let spanish = s.create_deck("Spanish", 1_000).unwrap();
        let cardio = s.create_deck("Medicine::Cardiology", 1_000).unwrap();
        let nt = s.create_notetype("TwoCard", 0, 1_000).unwrap();
        s.add_template(nt, "Card 2", "{{Back}}", "{{Front}}", 1_000)
            .unwrap();

        s.add_note_with_cards(
            nt,
            spanish.id,
            &[
                r#"hola <img src="shared.png"> [sound:hola.mp3]"#.into(),
                "back".into(),
            ],
            &["verbs".into()],
            1_000,
        )
        .unwrap();
        s.add_note_with_cards(
            nt,
            spanish.id,
            &[r#"gato <img src="spanish-only.png">"#.into(), "back".into()],
            &["nouns".into()],
            2_000,
        )
        .unwrap();
        s.add_note_with_cards(
            nt,
            cardio.id,
            &[
                r#"corazon <img src="shared.png"> <img src="heart.png">"#.into(),
                "back".into(),
            ],
            &["cardiology".into()],
            3_000,
        )
        .unwrap();

        let map = |q: &str| -> std::collections::BTreeMap<String, u32> {
            s.note_media_ref_counts_matching(q, 0, 5_000)
                .unwrap()
                .into_iter()
                .collect()
        };

        let all = map("");
        assert_eq!(all.get("shared.png"), Some(&2));
        assert_eq!(all.get("hola.mp3"), Some(&1));
        assert_eq!(all.get("heart.png"), Some(&1));

        let by_spanish = map(r#"deck:"Spanish""#);
        assert_eq!(by_spanish.get("shared.png"), Some(&1));
        assert_eq!(by_spanish.get("hola.mp3"), Some(&1));
        assert_eq!(by_spanish.get("spanish-only.png"), Some(&1));
        assert_eq!(by_spanish.get("heart.png"), None);

        let by_cardio = map(r#"deck:"Medicine::Cardiology""#);
        assert_eq!(by_cardio.get("shared.png"), Some(&1));
        assert_eq!(by_cardio.get("heart.png"), Some(&1));
        assert_eq!(by_cardio.get("hola.mp3"), None);

        let by_tag = map("tag:verbs");
        assert_eq!(by_tag.len(), 2);
        assert_eq!(by_tag.get("shared.png"), Some(&1));
        assert_eq!(by_tag.get("hola.mp3"), Some(&1));

        let combined = map(r#"deck:"Spanish" tag:nouns"#);
        assert_eq!(combined.len(), 1);
        assert_eq!(combined.get("spanish-only.png"), Some(&1));

        // Unknown token falls back identically to Browse (`build_where` -> `1=1`).
        assert_eq!(map("prop:unknown>5"), all);
    }

    #[test]
    fn media_query_finds_note_with_underscore_and_space_name() {
        let s = SqliteStorage::open_in_memory().unwrap();
        let nt = s.create_notetype("Basic", 0, 1_000).unwrap();
        s.add_note_with_cards(
            nt,
            1,
            &[r#"question <img src="a_b 1.jpg">"#.into(), "back".into()],
            &[],
            1_000,
        )
        .unwrap();
        // Decoy where `_` would match `X` if `_` were not escaped.
        s.add_note_with_cards(
            nt,
            1,
            &[r#"decoy <img src="aXb 1.jpg">"#.into(), "back".into()],
            &[],
            1_000,
        )
        .unwrap();

        let rows = s
            .search_cards(r#""a\_b 1.jpg""#, 0, 2_000, 100, 0, None, true)
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].sort_field.contains("question"));
    }

    #[test]
    fn media_query_finds_sound_tag() {
        let s = SqliteStorage::open_in_memory().unwrap();
        let nt = s.create_notetype("Basic", 0, 1_000).unwrap();
        s.add_note_with_cards(nt, 1, &["word".into(), "[sound:c.mp3]".into()], &[], 1_000)
            .unwrap();

        let rows = s
            .search_cards(r#""c.mp3""#, 0, 2_000, 100, 0, None, true)
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].sort_field, "word");
    }

    #[test]
    fn count_cards_and_count_note_rows_match_filtered_totals() {
        let s = SqliteStorage::open_in_memory().unwrap();
        let nt = s.create_notetype("Reversed", 0, 1_000).unwrap();
        s.add_template(nt, "Card 2", "{{Back}}", "{{Front}}", 1_000)
            .unwrap();
        s.add_note_with_cards(nt, 1, &["alpha".into(), "a".into()], &["bio".into()], 1_000)
            .unwrap();
        s.add_note_with_cards(nt, 1, &["beta".into(), "b".into()], &["chem".into()], 1_000)
            .unwrap();

        assert_eq!(s.count_cards("", 0, 2_000).unwrap(), 4);
        assert_eq!(s.count_note_rows("", 0, 2_000).unwrap(), 2);
        assert_eq!(s.count_cards("tag:bio", 0, 2_000).unwrap(), 2);
        assert_eq!(s.count_note_rows("tag:bio", 0, 2_000).unwrap(), 1);
        assert_eq!(s.count_cards("tag:missing", 0, 2_000).unwrap(), 0);
        assert_eq!(s.count_note_rows("tag:missing", 0, 2_000).unwrap(), 0);
    }
}
