//! `SqliteStorage` — the SQLite-backed implementation of
//! [`bibalak_core::ports::Storage`].
//!
//! Wraps the connection in a `Mutex` so the adapter is `Send + Sync` (rusqlite's
//! `Connection` is `Send` but not `Sync`) and the application layer can hold it
//! behind a `&self` trait object.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use bibalak_core::deck_name::{deck_ancestors, is_same_or_below, DECK_SEPARATOR};
use bibalak_core::error::{CoreError, CoreResult};
use bibalak_core::ipc::{
    FieldOptions, FieldRemoveWarning, FilteredDeckConfig, NoteDetail, NoteOverview, NotetypeDetail,
    StatsDto,
};
use bibalak_core::model::{
    CanonicalModel, Card, Deck, Field, ImportSummary, Note, NoteIndexRow, Notetype, Revlog,
    StudyCard, Template,
};
use bibalak_core::ports::{
    BrowseStore, DeckStore, GameStore, MaintenanceStore, NoteStore, NotetypeStore,
    ProductivityStore, ProgressStore, RemovedDeck, StudyStore, SyncStore,
};
use bibalak_core::scheduling::{CardState, SchedConfig};
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::schema::grave_kind;
use crate::{
    backup, browse, cards, export, filtered, import, migrations, notetype, productivity, search,
    stats, study, tags,
};

const DECK_COLUMNS: &str = r#"id, name, parent_id, config_id, "mod", usn, collapsed, is_filtered"#;
const CARD_COLUMNS: &str = r#"id, note_id, deck_id, ord, "mod", usn, type, queue, due, interval,
    ease_factor, reps, lapses, remaining, original_due, original_deck_id, flags,
    fsrs_stability, fsrs_difficulty, fsrs_last_review, data"#;
const NOTE_COLUMNS: &str =
    r#"id, guid, notetype_id, "mod", usn, tags, fields, sort_field, checksum"#;
/// Field separator inside the `notes.fields` blob (matches import/export).
const FIELD_SEP: char = '\u{1f}';

fn storage_err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

fn map_deck(row: &Row<'_>) -> rusqlite::Result<Deck> {
    Ok(Deck {
        id: row.get(0)?,
        name: row.get(1)?,
        parent_id: row.get(2)?,
        config_id: row.get(3)?,
        mod_ms: row.get(4)?,
        usn: row.get(5)?,
        collapsed: row.get::<_, i64>(6)? != 0,
        is_filtered: row.get::<_, i64>(7)? != 0,
    })
}

fn map_card(row: &Row<'_>) -> rusqlite::Result<Card> {
    Ok(Card {
        id: row.get(0)?,
        note_id: row.get(1)?,
        deck_id: row.get(2)?,
        ord: row.get(3)?,
        mod_ms: row.get(4)?,
        usn: row.get(5)?,
        ctype: row.get(6)?,
        queue: row.get(7)?,
        due: row.get(8)?,
        interval: row.get(9)?,
        ease_factor: row.get(10)?,
        reps: row.get(11)?,
        lapses: row.get(12)?,
        remaining: row.get(13)?,
        original_due: row.get(14)?,
        original_deck_id: row.get(15)?,
        flags: row.get(16)?,
        fsrs_stability: row.get(17)?,
        fsrs_difficulty: row.get(18)?,
        fsrs_last_review: row.get(19)?,
        data: row.get(20)?,
    })
}

fn map_note(row: &Row<'_>) -> rusqlite::Result<Note> {
    let tags: String = row.get(5)?;
    let fields: String = row.get(6)?;
    Ok(Note {
        id: row.get(0)?,
        guid: row.get(1)?,
        notetype_id: row.get(2)?,
        mod_ms: row.get(3)?,
        usn: row.get(4)?,
        tags: tags.split_whitespace().map(str::to_string).collect(),
        fields: fields.split(FIELD_SEP).map(str::to_string).collect(),
        sort_field: row.get(7)?,
        checksum: row.get(8)?,
    })
}

pub struct SqliteStorage {
    conn: Mutex<Connection>,
}

impl SqliteStorage {
    /// Open (creating if needed) a collection database at `path`.
    pub fn open(path: impl AsRef<Path>) -> CoreResult<Self> {
        let path = path.as_ref();
        let conn = Connection::open(path).map_err(storage_err)?;
        Self::init(conn, Some(path))
    }

    /// In-memory database, for tests.
    pub fn open_in_memory() -> CoreResult<Self> {
        let conn = Connection::open_in_memory().map_err(storage_err)?;
        Self::init(conn, None)
    }

    fn init(mut conn: Connection, db_path: Option<&Path>) -> CoreResult<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(storage_err)?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(storage_err)?;
        conn.pragma_update(None, "foreign_keys", true)
            .map_err(storage_err)?;
        // Large collections (100k+ cards, tens of MB) outgrow SQLite's 2 MiB
        // default page cache; counts and the study queue then thrash it. A
        // 64 MiB cache plus memory-mapped reads keep the hot pages resident
        // (see docs/architecture/performance/README.md for the measurements).
        conn.pragma_update(None, "cache_size", -65_536)
            .map_err(storage_err)?;
        conn.pragma_update(None, "mmap_size", 268_435_456_i64)
            .map_err(storage_err)?;
        conn.pragma_update(None, "temp_store", "MEMORY")
            .map_err(storage_err)?;
        migrations::run_with_backup(&mut conn, db_path)?;
        // Repair cards stuck in queue 3 (from pre-T4 unsuspend/unbury bug or Anki import),
        // moving them to queue 1 and converting day-number due to start-of-day ms.
        cards::repair_queue_3(&conn).map_err(storage_err)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub(crate) fn lock(&self) -> MutexGuard<'_, Connection> {
        match self.conn.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                static LOGGED_POISON: std::sync::Once = std::sync::Once::new();
                LOGGED_POISON.call_once(|| {
                    eprintln!("keepsake: storage mutex poisoned; recovering inner connection");
                });
                poisoned.into_inner()
            }
        }
    }
}

/// Insert one deck row. Each deck gets its own options group (cloned from
/// Default) so that per-deck limits like "new cards/day" don't silently apply
/// to every other deck sharing config_id=1.
fn insert_deck_row(
    conn: &Connection,
    name: &str,
    parent_id: Option<i64>,
    now_ms: i64,
) -> CoreResult<i64> {
    conn.execute(
        r#"INSERT INTO deck_config (name, "mod", usn, config)
           SELECT ?1, ?2, -1, config FROM deck_config WHERE id = 1"#,
        params![name, now_ms],
    )
    .map_err(storage_err)?;
    let config_id = conn.last_insert_rowid();
    conn.execute(
        r#"INSERT INTO decks (name, parent_id, config_id, "mod", usn) VALUES (?1, ?2, ?3, ?4, -1)"#,
        params![name, parent_id, config_id, now_ms],
    )
    .map_err(storage_err)?;
    Ok(conn.last_insert_rowid())
}

fn deck_id_by_name(conn: &Connection, name: &str) -> CoreResult<Option<i64>> {
    conn.query_row("SELECT id FROM decks WHERE name = ?1", [name], |r| r.get(0))
        .optional()
        .map_err(storage_err)
}

/// Make sure every ancestor of an `A::B::C` name exists — missing levels are
/// created top-first, each linked to its own parent (Anki rule, SUB1 F1) —
/// and return the id of the direct parent (`None` for a top-level name).
pub(crate) fn ensure_deck_parents(
    conn: &Connection,
    name: &str,
    now_ms: i64,
) -> CoreResult<Option<i64>> {
    let mut parent = None;
    for ancestor in deck_ancestors(name) {
        parent = Some(match deck_id_by_name(conn, ancestor)? {
            Some(id) => id,
            None => insert_deck_row(conn, ancestor, parent, now_ms)?,
        });
    }
    Ok(parent)
}

/// Subtree below `root` by `parent_id` (not by name), parent-first, as
/// `(id, parent_id, name)`. `root` itself is included first when `with_root`.
/// The depth cap stops a corrupt `parent_id` cycle from looping forever.
fn deck_subtree(
    conn: &Connection,
    root: i64,
    with_root: bool,
) -> CoreResult<Vec<(i64, Option<i64>, String)>> {
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE sub(sub_id, depth) AS (
                 SELECT ?1, 0
                 UNION ALL
                 SELECT d.id, sub.depth + 1 FROM decks d
                 JOIN sub ON d.parent_id = sub.sub_id
                 WHERE sub.depth < 64
             )
             SELECT id, parent_id, name FROM decks JOIN sub ON id = sub_id
             WHERE depth > 0 OR ?2
             ORDER BY depth, id",
        )
        .map_err(storage_err)?;
    let rows = stmt
        .query_map(params![root, with_root], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .map_err(storage_err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(storage_err)
}

impl DeckStore for SqliteStorage {
    fn create_deck(&self, name: &str, now_ms: i64) -> CoreResult<Deck> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        let parent_id = ensure_deck_parents(&tx, name, now_ms)?;
        let id = insert_deck_row(&tx, name, parent_id, now_ms)?;
        tx.commit().map_err(storage_err)?;
        conn.query_row(
            &format!("SELECT {DECK_COLUMNS} FROM decks WHERE id = ?1"),
            [id],
            map_deck,
        )
        .map_err(storage_err)
    }

    fn deck_by_id(&self, id: i64) -> CoreResult<Option<Deck>> {
        self.lock()
            .query_row(
                &format!("SELECT {DECK_COLUMNS} FROM decks WHERE id = ?1"),
                [id],
                map_deck,
            )
            .optional()
            .map_err(storage_err)
    }

    fn deck_by_name(&self, name: &str) -> CoreResult<Option<Deck>> {
        self.lock()
            .query_row(
                &format!("SELECT {DECK_COLUMNS} FROM decks WHERE name = ?1"),
                [name],
                map_deck,
            )
            .optional()
            .map_err(storage_err)
    }

    fn list_decks(&self) -> CoreResult<Vec<Deck>> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare(&format!("SELECT {DECK_COLUMNS} FROM decks ORDER BY name"))
            .map_err(storage_err)?;
        let rows = stmt.query_map([], map_deck).map_err(storage_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_err)
    }

    fn rename_deck(&self, id: i64, name: &str, now_ms: i64) -> CoreResult<()> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        let old: String = tx
            .query_row("SELECT name FROM decks WHERE id = ?1", [id], |r| r.get(0))
            .optional()
            .map_err(storage_err)?
            .ok_or_else(|| CoreError::NotFound(format!("deck {id}")))?;
        if old == name {
            return Ok(());
        }
        if is_same_or_below(name, &old) {
            return Err(CoreError::Invalid(
                "a deck cannot be moved into its own subdeck".into(),
            ));
        }

        // New name for every deck in the subtree (found by parent_id),
        // parent-first: parent's new name + the child's own last part.
        let mut renamed: HashMap<i64, (String, String)> = HashMap::new();
        renamed.insert(id, (old, name.to_string()));
        let mut updates = vec![(id, name.to_string())];
        for (child, parent, child_name) in deck_subtree(&tx, id, false)? {
            let Some((parent_old, parent_new)) = parent.and_then(|p| renamed.get(&p)).cloned()
            else {
                continue;
            };
            let leaf = child_name
                .strip_prefix(parent_old.as_str())
                .and_then(|rest| rest.strip_prefix(DECK_SEPARATOR))
                .filter(|rest| !rest.is_empty())
                .or_else(|| child_name.rsplit(DECK_SEPARATOR).next())
                .unwrap_or(child_name.as_str())
                .to_string();
            let new_name = format!("{parent_new}{DECK_SEPARATOR}{leaf}");
            renamed.insert(child, (child_name, new_name.clone()));
            updates.push((child, new_name));
        }
        for (_, new_name) in &updates {
            if let Some(other) = deck_id_by_name(&tx, new_name)? {
                if !renamed.contains_key(&other) {
                    return Err(CoreError::Invalid(format!(
                        "a deck named \"{new_name}\" already exists"
                    )));
                }
            }
        }

        let parent_id = ensure_deck_parents(&tx, name, now_ms)?;
        tx.execute(
            r#"UPDATE decks SET name = ?1, parent_id = ?2, "mod" = ?3, usn = -1 WHERE id = ?4"#,
            params![name, parent_id, now_ms, id],
        )
        .map_err(storage_err)?;
        for (child, new_name) in updates.iter().skip(1) {
            tx.execute(
                r#"UPDATE decks SET name = ?1, "mod" = ?2, usn = -1 WHERE id = ?3"#,
                params![new_name, now_ms, child],
            )
            .map_err(storage_err)?;
        }
        tx.commit().map_err(storage_err)
    }

    fn remove_deck(&self, id: i64, now_ms: i64) -> CoreResult<RemovedDeck> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;

        // Resolve the subtree by parent_id (never by name pattern: LIKE is
        // case-insensitive and treats `_`/`%` in names as wildcards).
        let ids: Vec<i64> = deck_subtree(&tx, id, true)?
            .into_iter()
            .map(|(deck_id, _, _)| deck_id)
            .collect();
        if ids.is_empty() {
            return Err(CoreError::NotFound(format!("deck {id}")));
        }
        let ids_json = format!(
            "[{}]",
            ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",")
        );

        // Parent-first order so the subtree can be restored (and re-linked) safely.
        let decks: Vec<Deck> = {
            let mut by_id: HashMap<i64, Deck> = {
                let mut stmt = tx
                    .prepare(&format!(
                        "SELECT {DECK_COLUMNS} FROM decks WHERE id IN (SELECT value FROM json_each(?1))"
                    ))
                    .map_err(storage_err)?;
                let rows = stmt.query_map([&ids_json], map_deck).map_err(storage_err)?;
                rows.map(|r| r.map(|d| (d.id, d)))
                    .collect::<rusqlite::Result<_>>()
                    .map_err(storage_err)?
            };
            ids.iter().filter_map(|i| by_id.remove(i)).collect()
        };

        // All cards held by those decks, captured for undo.
        let cards: Vec<Card> = {
            let mut stmt = tx
                .prepare(&format!(
                    "SELECT {CARD_COLUMNS} FROM cards c
                     WHERE c.deck_id IN (SELECT value FROM json_each(?1))"
                ))
                .map_err(storage_err)?;
            let rows = stmt.query_map([&ids_json], map_card).map_err(storage_err)?;
            rows.collect::<rusqlite::Result<_>>().map_err(storage_err)?
        };

        // Tombstone cards + decks (sync change-log), then delete bottom-up:
        // revlog → cards → decks (children before parents to honour parent_id).
        for card in &cards {
            tx.execute(
                "INSERT OR REPLACE INTO graves (oid, type, usn) VALUES (?1, ?2, -1)",
                params![card.id, grave_kind::CARD],
            )
            .map_err(storage_err)?;
            tx.execute(
                "INSERT OR REPLACE INTO grave_times (oid, type, deleted_ms) VALUES (?1, ?2, ?3)",
                params![card.id, grave_kind::CARD, now_ms],
            )
            .map_err(storage_err)?;
            tx.execute("DELETE FROM revlog WHERE card_id = ?1", [card.id])
                .map_err(storage_err)?;
        }
        for deck in decks.iter().rev() {
            tx.execute("DELETE FROM cards WHERE deck_id = ?1", [deck.id])
                .map_err(storage_err)?;
            tx.execute(
                "INSERT OR REPLACE INTO graves (oid, type, usn) VALUES (?1, ?2, -1)",
                params![deck.id, grave_kind::DECK],
            )
            .map_err(storage_err)?;
            tx.execute(
                "INSERT OR REPLACE INTO grave_times (oid, type, deleted_ms) VALUES (?1, ?2, ?3)",
                params![deck.id, grave_kind::DECK, now_ms],
            )
            .map_err(storage_err)?;
            tx.execute("DELETE FROM decks WHERE id = ?1", [deck.id])
                .map_err(storage_err)?;
        }

        // Cards are gone; delete notes they left orphaned (no card anywhere).
        let mut orphan_note_ids: Vec<i64> = cards.iter().map(|c| c.note_id).collect();
        orphan_note_ids.sort_unstable();
        orphan_note_ids.dedup();
        let mut notes: Vec<Note> = Vec::new();
        for note_id in orphan_note_ids {
            let remaining: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM cards WHERE note_id = ?1",
                    [note_id],
                    |r| r.get(0),
                )
                .map_err(storage_err)?;
            if remaining > 0 {
                continue; // still has cards in another deck — keep it.
            }
            let note = tx
                .query_row(
                    &format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?1"),
                    [note_id],
                    map_note,
                )
                .optional()
                .map_err(storage_err)?;
            if let Some(note) = note {
                tx.execute(
                    "INSERT OR REPLACE INTO graves (oid, type, usn) VALUES (?1, ?2, -1)",
                    params![note_id, grave_kind::NOTE],
                )
                .map_err(storage_err)?;
                tx.execute(
                    "INSERT OR REPLACE INTO grave_times (oid, type, deleted_ms) VALUES (?1, ?2, ?3)",
                    params![note_id, grave_kind::NOTE, now_ms],
                )
                .map_err(storage_err)?;
                tx.execute("DELETE FROM notes WHERE id = ?1", [note_id])
                    .map_err(storage_err)?;
                notes.push(note);
            }
        }

        tx.commit().map_err(storage_err)?;
        Ok(RemovedDeck {
            decks,
            cards,
            notes,
        })
    }

    fn restore_deck(&self, removed: &RemovedDeck, now_ms: i64) -> CoreResult<()> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        // Decks first (parent-first, as captured), then their cards.
        for deck in &removed.decks {
            tx.execute(
                r#"INSERT INTO decks (id, name, parent_id, config_id, "mod", usn, collapsed, is_filtered)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
                params![
                    deck.id,
                    deck.name,
                    deck.parent_id,
                    deck.config_id,
                    now_ms,
                    -1,
                    deck.collapsed as i64,
                    deck.is_filtered as i64,
                ],
            )
            .map_err(storage_err)?;
            tx.execute(
                "DELETE FROM graves WHERE oid = ?1 AND type = ?2",
                params![deck.id, grave_kind::DECK],
            )
            .map_err(storage_err)?;
            tx.execute(
                "DELETE FROM grave_times WHERE oid = ?1 AND type = ?2",
                params![deck.id, grave_kind::DECK],
            )
            .map_err(storage_err)?;
        }
        // Notes before cards (cards reference notes).
        for note in &removed.notes {
            let tags = if note.tags.is_empty() {
                String::new()
            } else {
                format!(" {} ", note.tags.join(" "))
            };
            let fields = note.fields.join(&FIELD_SEP.to_string());
            let fields_norm = crate::search::fields_norm_value(&fields, note.sort_field.as_deref());
            tx.execute(
                r#"INSERT INTO notes (id, guid, notetype_id, "mod", usn, tags, fields, sort_field, checksum, fields_norm)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"#,
                params![
                    note.id,
                    note.guid,
                    note.notetype_id,
                    now_ms,
                    -1,
                    tags,
                    fields,
                    note.sort_field,
                    note.checksum,
                    fields_norm,
                ],
            )
            .map_err(storage_err)?;
            tx.execute(
                "DELETE FROM graves WHERE oid = ?1 AND type = ?2",
                params![note.id, grave_kind::NOTE],
            )
            .map_err(storage_err)?;
            tx.execute(
                "DELETE FROM grave_times WHERE oid = ?1 AND type = ?2",
                params![note.id, grave_kind::NOTE],
            )
            .map_err(storage_err)?;
        }
        for card in &removed.cards {
            tx.execute(
                r#"INSERT INTO cards
                   (id, note_id, deck_id, ord, "mod", usn, type, queue, due, interval, ease_factor,
                    reps, lapses, remaining, original_due, original_deck_id, flags,
                    fsrs_stability, fsrs_difficulty, fsrs_last_review, data)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                    ?17, ?18, ?19, ?20, ?21)"#,
                params![
                    card.id,
                    card.note_id,
                    card.deck_id,
                    card.ord,
                    now_ms,
                    -1,
                    card.ctype,
                    card.queue,
                    card.due,
                    card.interval,
                    card.ease_factor,
                    card.reps,
                    card.lapses,
                    card.remaining,
                    card.original_due,
                    card.original_deck_id,
                    card.flags,
                    card.fsrs_stability,
                    card.fsrs_difficulty,
                    card.fsrs_last_review,
                    card.data,
                ],
            )
            .map_err(storage_err)?;
            tx.execute(
                "DELETE FROM graves WHERE oid = ?1 AND type = ?2",
                params![card.id, grave_kind::CARD],
            )
            .map_err(storage_err)?;
            tx.execute(
                "DELETE FROM grave_times WHERE oid = ?1 AND type = ?2",
                params![card.id, grave_kind::CARD],
            )
            .map_err(storage_err)?;
        }
        tx.commit().map_err(storage_err)?;
        Ok(())
    }

    fn insert_deck(&self, deck: &Deck, now_ms: i64) -> CoreResult<()> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        tx.execute(
            r#"INSERT INTO decks (id, name, parent_id, config_id, "mod", usn, collapsed, is_filtered)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
            params![
                deck.id,
                deck.name,
                deck.parent_id,
                deck.config_id,
                now_ms,
                -1,
                deck.collapsed as i64,
                deck.is_filtered as i64,
            ],
        )
        .map_err(storage_err)?;
        // Resurrect: drop the tombstone left by the deletion we're undoing.
        tx.execute(
            "DELETE FROM graves WHERE oid = ?1 AND type = ?2",
            params![deck.id, grave_kind::DECK],
        )
        .map_err(storage_err)?;
        tx.execute(
            "DELETE FROM grave_times WHERE oid = ?1 AND type = ?2",
            params![deck.id, grave_kind::DECK],
        )
        .map_err(storage_err)?;
        tx.commit().map_err(storage_err)?;
        Ok(())
    }

    fn set_deck_collapsed(&self, deck_id: i64, collapsed: bool) -> CoreResult<()> {
        let conn = self.lock();
        let changed = conn
            .execute(
                "UPDATE decks SET collapsed = ?1 WHERE id = ?2",
                rusqlite::params![collapsed as i64, deck_id],
            )
            .map_err(storage_err)?;
        if changed == 0 {
            return Err(CoreError::NotFound(format!("deck {deck_id}")));
        }
        Ok(())
    }

    fn create_filtered_deck(
        &self,
        name: &str,
        search: &str,
        order: u8,
        limit: u32,
        today: i32,
        now_ms: i64,
    ) -> CoreResult<Deck> {
        filtered::create_filtered_deck(&self.lock(), name, search, order, limit, today, now_ms)
    }

    fn rebuild_filtered(&self, deck_id: i64, today: i32, now_ms: i64) -> CoreResult<u32> {
        filtered::rebuild_filtered(&self.lock(), deck_id, today, now_ms)
    }

    fn empty_filtered(&self, deck_id: i64, now_ms: i64) -> CoreResult<()> {
        filtered::empty_filtered(&self.lock(), deck_id, now_ms)
    }

    fn get_filtered_config(&self, deck_id: i64) -> CoreResult<Option<FilteredDeckConfig>> {
        filtered::get_config(&self.lock(), deck_id)
    }
}

impl NoteStore for SqliteStorage {
    fn import_with_tz(
        &self,
        model: &CanonicalModel,
        tz_offset_minutes: i32,
        now_ms: i64,
        on_progress: &mut dyn FnMut(u32, u32),
    ) -> CoreResult<ImportSummary> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        let summary = import::import(&tx, model, tz_offset_minutes, now_ms, on_progress)?;
        crate::game_depth::invalidate_studied_top_decks_tx(&tx)?;
        tx.commit().map_err(storage_err)?;
        Ok(summary)
    }

    fn list_notes(&self, query: Option<&str>, limit: i64) -> CoreResult<Vec<NoteOverview>> {
        browse::list_notes(&self.lock(), query, limit)
    }

    fn note_detail(&self, note_id: i64) -> CoreResult<Option<NoteDetail>> {
        browse::note_detail(&self.lock(), note_id)
    }

    fn update_note(
        &self,
        note_id: i64,
        fields: &[String],
        tags: &[String],
        now_ms: i64,
    ) -> CoreResult<()> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        browse::update_note(&tx, note_id, fields, tags, now_ms)?;
        tx.commit().map_err(storage_err)?;
        Ok(())
    }

    fn notes_by_ids(&self, ids: &[i64]) -> CoreResult<Vec<NoteOverview>> {
        browse::notes_by_ids(&self.lock(), ids)
    }

    fn dump_collection(&self) -> CoreResult<CanonicalModel> {
        export::dump_collection(&self.lock())
    }

    fn dump_collection_scoped(
        &self,
        deck_ids: Option<&[i64]>,
        include_revlog: bool,
    ) -> CoreResult<CanonicalModel> {
        export::dump_collection_scoped(&self.lock(), deck_ids, include_revlog)
    }

    fn add_note_with_cards(
        &self,
        notetype_id: i64,
        deck_id: i64,
        fields: &[String],
        tags: &[String],
        now_ms: i64,
    ) -> CoreResult<(i64, u32)> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        let result = browse::add_note_with_cards(&tx, notetype_id, deck_id, fields, tags, now_ms)?;
        tx.commit().map_err(storage_err)?;
        Ok(result)
    }

    fn add_notes_batch(
        &self,
        notetype_id: i64,
        deck_id: i64,
        notes: &[bibalak_core::ipc::BatchNoteInput],
        now_ms: i64,
    ) -> CoreResult<(Vec<i64>, u32)> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        let result = browse::add_notes_batch(&tx, notetype_id, deck_id, notes, now_ms)?;
        tx.commit().map_err(storage_err)?;
        Ok(result)
    }

    fn find_duplicate_note(&self, notetype_id: i64, first_field: &str) -> CoreResult<Option<i64>> {
        browse::find_duplicate_note(&self.lock(), notetype_id, first_field)
    }

    fn add_note_tag(&self, note_id: i64, tag: &str, now_ms: i64) -> CoreResult<()> {
        cards::add_note_tag(&self.lock(), note_id, tag, now_ms)
    }

    fn bulk_add_tag(&self, note_ids: &[i64], tag: &str, now_ms: i64) -> CoreResult<()> {
        search::bulk_add_note_tags(&mut self.lock(), note_ids, tag, now_ms)
    }

    fn bulk_remove_tag(&self, note_ids: &[i64], tag: &str, now_ms: i64) -> CoreResult<()> {
        search::bulk_remove_note_tags(&mut self.lock(), note_ids, tag, now_ms)
    }

    fn restore_notes(
        &self,
        snapshots: &[bibalak_core::model::NoteSnapshot],
        now_ms: i64,
    ) -> CoreResult<()> {
        browse::restore_notes(&mut self.lock(), snapshots, now_ms)
    }

    fn delete_notes(&self, note_ids: &[i64], now_ms: i64) -> CoreResult<()> {
        search::delete_notes(&self.lock(), note_ids, now_ms)
    }

    fn move_cards_to_deck(&self, card_ids: &[i64], deck_id: i64, now_ms: i64) -> CoreResult<()> {
        search::move_cards_to_deck(&self.lock(), card_ids, deck_id, now_ms)
    }

    fn remove_note_tag(&self, note_id: i64, tag: &str, now_ms: i64) -> CoreResult<()> {
        search::remove_note_tag(&self.lock(), note_id, tag, now_ms)
    }

    fn import_text_notes(
        &self,
        deck_id: i64,
        notetype_id: i64,
        duplicate_policy: bibalak_core::ipc::DuplicatePolicy,
        rows: &[bibalak_core::ParsedTextNote],
        now_ms: i64,
    ) -> CoreResult<bibalak_core::TextImportOutcome> {
        browse::import_text_notes(
            &mut self.lock(),
            deck_id,
            notetype_id,
            duplicate_policy,
            rows,
            now_ms,
        )
    }
}

impl NotetypeStore for SqliteStorage {
    fn list_notetypes(&self) -> CoreResult<Vec<Notetype>> {
        browse::list_notetypes(&self.lock())
    }

    fn fields_for_notetype(&self, notetype_id: i64) -> CoreResult<Vec<Field>> {
        browse::fields_for_notetype(&self.lock(), notetype_id)
    }

    fn templates_for_notetype(&self, notetype_id: i64) -> CoreResult<Vec<Template>> {
        browse::templates_for_notetype(&self.lock(), notetype_id)
    }

    fn get_notetype_detail(&self, notetype_id: i64) -> CoreResult<Option<NotetypeDetail>> {
        notetype::get_notetype_detail(&self.lock(), notetype_id)
    }

    fn create_notetype(&self, name: &str, kind: i64, now_ms: i64) -> CoreResult<i64> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        let id = notetype::create_notetype(&tx, name, kind, now_ms)?;
        tx.commit().map_err(storage_err)?;
        Ok(id)
    }

    fn delete_notetype(&self, notetype_id: i64, now_ms: i64) -> CoreResult<()> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        notetype::delete_notetype(&tx, notetype_id, now_ms)?;
        tx.commit().map_err(storage_err)?;
        Ok(())
    }

    fn note_count_for_notetype(&self, notetype_id: i64) -> CoreResult<u32> {
        notetype::note_count_for_notetype(&self.lock(), notetype_id)
    }

    fn rename_notetype(&self, notetype_id: i64, name: &str, now_ms: i64) -> CoreResult<()> {
        notetype::rename_notetype(&self.lock(), notetype_id, name, now_ms)
    }

    fn stock_notetype_names(&self) -> Vec<&'static str> {
        crate::stock::stock_names()
    }

    fn add_stock_notetype(&self, index: usize, now_ms: i64) -> CoreResult<i64> {
        let id = crate::stock::add_stock(&self.lock(), index, now_ms)?;
        Ok(id)
    }

    fn save_notetype_css(&self, notetype_id: i64, css: &str, now_ms: i64) -> CoreResult<()> {
        notetype::save_notetype_css(&self.lock(), notetype_id, css, now_ms)
    }

    fn save_notetype_preset(
        &self,
        notetype_id: i64,
        preset: &bibalak_core::notetype_preset::NotetypePreset,
        compiled: Option<&bibalak_core::notetype_preset::CompiledNotetype>,
        now_ms: i64,
    ) -> CoreResult<()> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        notetype::save_notetype_preset(&tx, notetype_id, preset, compiled, now_ms)?;
        tx.commit().map_err(storage_err)?;
        Ok(())
    }

    fn add_field(&self, notetype_id: i64, name: &str, now_ms: i64) -> CoreResult<()> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        notetype::add_field(&tx, notetype_id, name, now_ms)?;
        tx.commit().map_err(storage_err)?;
        Ok(())
    }

    fn check_field_remove(&self, notetype_id: i64, ord: i64) -> CoreResult<FieldRemoveWarning> {
        notetype::check_field_remove(&self.lock(), notetype_id, ord)
    }

    fn remove_field(&self, notetype_id: i64, ord: i64, now_ms: i64) -> CoreResult<()> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        notetype::remove_field(&tx, notetype_id, ord, now_ms)?;
        tx.commit().map_err(storage_err)?;
        Ok(())
    }

    fn rename_field(&self, notetype_id: i64, ord: i64, name: &str, now_ms: i64) -> CoreResult<()> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        notetype::rename_field(&tx, notetype_id, ord, name, now_ms)?;
        tx.commit().map_err(storage_err)?;
        Ok(())
    }

    fn reorder_fields(&self, notetype_id: i64, new_order: &[i64], now_ms: i64) -> CoreResult<()> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        notetype::reorder_fields(&tx, notetype_id, new_order, now_ms)?;
        tx.commit().map_err(storage_err)?;
        Ok(())
    }

    fn save_field_options(
        &self,
        notetype_id: i64,
        ord: i64,
        options: &FieldOptions,
        now_ms: i64,
    ) -> CoreResult<()> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        notetype::save_field_options(&tx, notetype_id, ord, options, now_ms)?;
        tx.commit().map_err(storage_err)?;
        Ok(())
    }

    fn set_sort_field(&self, notetype_id: i64, ord: i64, now_ms: i64) -> CoreResult<()> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        notetype::set_sort_field(&tx, notetype_id, ord, now_ms)?;
        tx.commit().map_err(storage_err)?;
        Ok(())
    }

    fn duplicate_notetype(&self, notetype_id: i64, new_name: &str, now_ms: i64) -> CoreResult<i64> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        let id = notetype::duplicate_notetype(&tx, notetype_id, new_name, now_ms)?;
        tx.commit().map_err(storage_err)?;
        Ok(id)
    }

    fn add_template(
        &self,
        notetype_id: i64,
        name: &str,
        qfmt: &str,
        afmt: &str,
        now_ms: i64,
    ) -> CoreResult<()> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        notetype::add_template(&tx, notetype_id, name, qfmt, afmt, now_ms)?;
        tx.commit().map_err(storage_err)?;
        Ok(())
    }

    fn check_template_remove(&self, notetype_id: i64, ord: i64) -> CoreResult<u32> {
        notetype::check_template_remove(&self.lock(), notetype_id, ord)
    }

    fn remove_template(&self, notetype_id: i64, ord: i64, now_ms: i64) -> CoreResult<()> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        notetype::remove_template(&tx, notetype_id, ord, now_ms)?;
        tx.commit().map_err(storage_err)?;
        Ok(())
    }

    fn save_template(
        &self,
        notetype_id: i64,
        ord: i64,
        name: &str,
        qfmt: &str,
        afmt: &str,
        now_ms: i64,
    ) -> CoreResult<()> {
        notetype::save_template(&self.lock(), notetype_id, ord, name, qfmt, afmt, now_ms)
    }

    fn change_note_type(
        &self,
        note_ids: &[i64],
        target_notetype_id: i64,
        field_map: &[Option<usize>],
        template_map: &[(i64, Option<i64>)],
        now_ms: i64,
    ) -> CoreResult<Vec<bibalak_core::model::NoteTypeChangeSnapshot>> {
        browse::change_note_type(
            &mut self.lock(),
            note_ids,
            target_notetype_id,
            field_map,
            template_map,
            now_ms,
        )
    }

    fn restore_note_type_changes(
        &self,
        snapshots: &[bibalak_core::model::NoteTypeChangeSnapshot],
        now_ms: i64,
    ) -> CoreResult<()> {
        browse::restore_note_type_changes(&mut self.lock(), snapshots, now_ms)
    }
}

impl StudyStore for SqliteStorage {
    fn study_queue(
        &self,
        deck_id: i64,
        today: i32,
        now_ms: i64,
        today_end_ms: i64,
        new_limit: u32,
        review_limit: u32,
    ) -> CoreResult<bibalak_core::ports::StudyQueue> {
        study::study_queue(
            &self.lock(),
            deck_id,
            today,
            now_ms,
            today_end_ms,
            new_limit,
            review_limit,
        )
    }

    fn count_due_by_type(
        &self,
        deck_id: i64,
        today: i32,
        now_ms: i64,
        today_end_ms: i64,
        new_limit: u32,
        review_limit: u32,
    ) -> CoreResult<(u32, u32, u32)> {
        study::count_due_by_type(
            &self.lock(),
            deck_id,
            today,
            now_ms,
            today_end_ms,
            new_limit,
            review_limit,
        )
    }

    fn count_due(
        &self,
        deck_id: i64,
        today: i32,
        now_ms: i64,
        today_end_ms: i64,
        new_limit: u32,
        review_limit: u32,
    ) -> CoreResult<u32> {
        study::count_due(
            &self.lock(),
            deck_id,
            today,
            now_ms,
            today_end_ms,
            new_limit,
            review_limit,
        )
    }

    fn deck_due_counts(
        &self,
        today: i32,
        now_ms: i64,
        today_end_ms: i64,
    ) -> CoreResult<std::collections::HashMap<i64, (u32, u32, u32)>> {
        study::deck_due_counts(&self.lock(), today, now_ms, today_end_ms)
    }

    fn cards_due_ms(&self, card_ids: &[i64]) -> CoreResult<std::collections::HashMap<i64, i64>> {
        study::cards_due_ms(&self.lock(), card_ids)
    }

    fn cards_last_answered(
        &self,
        card_ids: &[i64],
    ) -> CoreResult<std::collections::HashMap<i64, i64>> {
        study::cards_last_answered(&self.lock(), card_ids)
    }

    fn latest_answered_card_id(&self) -> CoreResult<Option<i64>> {
        study::latest_answered_card_id(&self.lock())
    }

    fn deck_limits(&self, config_id: i64) -> CoreResult<(u32, u32)> {
        study::deck_limits(&self.lock(), config_id)
    }

    fn all_deck_limits(&self) -> CoreResult<std::collections::HashMap<i64, (u32, u32)>> {
        study::all_deck_limits(&self.lock())
    }

    fn today_studied(&self, deck_id: i64, today_start_ms: i64) -> CoreResult<(u32, u32)> {
        study::today_studied(&self.lock(), deck_id, today_start_ms)
    }

    fn all_today_studied(
        &self,
        today_start_ms: i64,
    ) -> CoreResult<std::collections::HashMap<i64, (u32, u32)>> {
        study::all_today_studied(&self.lock(), today_start_ms)
    }

    fn set_deck_limits(
        &self,
        config_id: i64,
        new_per_day: u32,
        rev_per_day: u32,
        now_ms: i64,
    ) -> CoreResult<()> {
        study::set_deck_limits(&self.lock(), config_id, new_per_day, rev_per_day, now_ms)
    }

    fn get_deck_config(&self, config_id: i64) -> CoreResult<SchedConfig> {
        study::get_deck_config(&self.lock(), config_id)
    }

    fn day_extra_new(&self, deck_id: i64, day: i32) -> CoreResult<u32> {
        study::day_extra_new(&self.lock(), deck_id, day)
    }

    fn all_day_extra_new(&self, day: i32) -> CoreResult<std::collections::HashMap<i64, u32>> {
        study::all_day_extra_new(&self.lock(), day)
    }

    fn set_day_extra_new(&self, deck_id: i64, day: i32, extra_new: u32) -> CoreResult<()> {
        study::set_day_extra_new(&self.lock(), deck_id, day, extra_new)
    }

    fn set_deck_config(&self, config_id: i64, config: &SchedConfig, now_ms: i64) -> CoreResult<()> {
        study::set_deck_config(&self.lock(), config_id, config, now_ms)
    }

    fn get_rollover_hour(&self) -> CoreResult<u8> {
        study::get_rollover_hour(&self.lock())
    }

    fn set_rollover_hour(&self, hour: u8, now_ms: i64) -> CoreResult<()> {
        study::set_rollover_hour(&self.lock(), hour, now_ms)
    }

    fn study_card(&self, card_id: i64) -> CoreResult<Option<StudyCard>> {
        study::study_card(&self.lock(), card_id)
    }

    fn apply_answer(
        &self,
        card_id: i64,
        next: &CardState,
        due: i64,
        log: &Revlog,
        reward: Option<&bibalak_core::progress::RewardGrant>,
    ) -> CoreResult<bool> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        let granted = study::apply_answer(&tx, card_id, next, due, log, reward)?;
        if granted {
            if let Some(r) = reward {
                crate::game_depth::invalidate_earned_xp_cache_tx(&tx, &r.user_id)?;
            }
        }
        tx.commit().map_err(storage_err)?;
        Ok(granted)
    }

    #[allow(clippy::too_many_arguments)]
    fn stats(
        &self,
        deck_ids: Option<&[i64]>,
        days: Option<u32>,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        fsrs_weights: &[f64; 21],
        retention_goal_pct: f64,
        today: i32,
        now_ms: i64,
        created_ms: i64,
    ) -> CoreResult<StatsDto> {
        stats::stats(
            &self.lock(),
            deck_ids,
            days,
            tz_offset_minutes,
            rollover_hour,
            fsrs_weights,
            retention_goal_pct,
            today,
            now_ms,
            created_ms,
        )
    }

    fn suspend_cards(&self, card_ids: &[i64], now_ms: i64) -> CoreResult<()> {
        cards::suspend_cards(&self.lock(), card_ids, now_ms)
    }

    fn unsuspend_cards(&self, card_ids: &[i64], now_ms: i64) -> CoreResult<()> {
        cards::unsuspend_cards(&self.lock(), card_ids, now_ms)
    }

    fn bury_cards(&self, card_ids: &[i64], now_ms: i64) -> CoreResult<()> {
        cards::bury_cards(&self.lock(), card_ids, now_ms)
    }

    fn unbury_cards(&self, card_ids: &[i64], now_ms: i64) -> CoreResult<()> {
        cards::unbury_cards(&self.lock(), card_ids, now_ms)
    }

    fn bury_siblings(
        &self,
        note_id: i64,
        answered_card_id: i64,
        now_ms: i64,
    ) -> CoreResult<Vec<i64>> {
        cards::bury_siblings(&self.lock(), note_id, answered_card_id, now_ms)
    }

    fn undo_answer(
        &self,
        card_id: i64,
        prev_state: &bibalak_core::scheduling::CardState,
        prev_due: i64,
        revlog_id: i64,
        buried_siblings: &[i64],
        leech_note: Option<i64>,
        reward_source_key: Option<&str>,
        now_ms: i64,
    ) -> CoreResult<()> {
        study::undo_answer(
            &mut self.lock(),
            card_id,
            prev_state,
            prev_due,
            revlog_id,
            buried_siblings,
            leech_note,
            reward_source_key,
            now_ms,
        )
    }

    fn unbury_deck(&self, deck_id: i64, now_ms: i64) -> CoreResult<()> {
        cards::unbury_deck(&self.lock(), deck_id, now_ms)
    }

    fn unbury_all(&self, now_ms: i64) -> CoreResult<()> {
        cards::unbury_all(&self.lock(), now_ms)
    }

    fn get_last_unbury_day(&self) -> CoreResult<Option<i32>> {
        study::get_last_unbury_day(&self.lock())
    }

    fn set_last_unbury_day(&self, day: i32, now_ms: i64) -> CoreResult<()> {
        study::set_last_unbury_day(&self.lock(), day, now_ms)
    }

    fn set_card_flag(&self, card_ids: &[i64], flag: u8, now_ms: i64) -> CoreResult<()> {
        cards::set_card_flag(&self.lock(), card_ids, flag, now_ms)
    }

    fn deck_card_ids(&self, deck_ids: &[i64]) -> CoreResult<Vec<i64>> {
        cards::deck_card_ids(&self.lock(), deck_ids)
    }

    fn forget_cards(
        &self,
        card_ids: &[i64],
        reset_counts: bool,
        now_ms: i64,
    ) -> CoreResult<Vec<bibalak_core::model::Card>> {
        cards::forget_cards(&mut self.lock(), card_ids, reset_counts, now_ms)
    }

    fn set_due_date(
        &self,
        card_ids: &[i64],
        min_days: u32,
        max_days: u32,
        today: i32,
        now_ms: i64,
    ) -> CoreResult<Vec<bibalak_core::model::Card>> {
        cards::set_due_date(
            &mut self.lock(),
            card_ids,
            min_days,
            max_days,
            today,
            now_ms,
        )
    }

    fn reposition_new_cards(
        &self,
        card_ids: &[i64],
        start: i64,
        step: i64,
        shuffle: bool,
        shift_existing: bool,
        now_ms: i64,
    ) -> CoreResult<Vec<bibalak_core::model::Card>> {
        cards::reposition_new_cards(
            &mut self.lock(),
            card_ids,
            start,
            step,
            shuffle,
            shift_existing,
            now_ms,
        )
    }

    fn restore_cards(
        &self,
        cards_snapshot: &[bibalak_core::model::Card],
        now_ms: i64,
    ) -> CoreResult<()> {
        cards::restore_cards(&mut self.lock(), cards_snapshot, now_ms)
    }

    fn revlogs_for_optimize(
        &self,
        deck_id: Option<i64>,
    ) -> CoreResult<Vec<bibalak_core::model::Revlog>> {
        stats::revlogs_for_optimize(&self.lock(), deck_id)
    }

    fn workload_snapshot(
        &self,
        deck_ids: &[i64],
    ) -> CoreResult<bibalak_core::ports::WorkloadSnapshot> {
        stats::workload_snapshot(&self.lock(), deck_ids)
    }
}

impl BrowseStore for SqliteStorage {
    fn index_rows(&self) -> CoreResult<Vec<NoteIndexRow>> {
        browse::index_rows(&self.lock())
    }

    fn index_rows_for_notes(&self, note_ids: &[i64]) -> CoreResult<Vec<NoteIndexRow>> {
        browse::index_rows_for_notes(&self.lock(), note_ids)
    }

    #[allow(clippy::too_many_arguments)]
    fn search_cards(
        &self,
        query: &str,
        today: i32,
        now_ms: i64,
        limit: i64,
        offset: i64,
        sort_key: Option<&str>,
        sort_asc: bool,
    ) -> CoreResult<Vec<bibalak_core::ipc::CardRow>> {
        search::search_cards(
            &self.lock(),
            query,
            today,
            now_ms,
            limit,
            offset,
            sort_key,
            sort_asc,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn search_note_rows(
        &self,
        query: &str,
        today: i32,
        now_ms: i64,
        limit: i64,
        offset: i64,
        sort_key: Option<&str>,
        sort_asc: bool,
    ) -> CoreResult<Vec<bibalak_core::ipc::NoteRow>> {
        search::search_note_rows(
            &self.lock(),
            query,
            today,
            now_ms,
            limit,
            offset,
            sort_key,
            sort_asc,
        )
    }

    fn count_cards(&self, query: &str, today: i32, now_ms: i64) -> CoreResult<u32> {
        search::count_cards(&self.lock(), query, today, now_ms)
    }

    fn count_note_rows(&self, query: &str, today: i32, now_ms: i64) -> CoreResult<u32> {
        search::count_note_rows(&self.lock(), query, today, now_ms)
    }

    fn preview_find_replace(
        &self,
        note_ids: &[i64],
        field_name: Option<&str>,
        find: &str,
        use_regex: bool,
        case_sensitive: bool,
    ) -> CoreResult<bibalak_core::ipc::FindReplacePreview> {
        browse::preview_find_replace(
            &self.lock(),
            note_ids,
            field_name,
            find,
            use_regex,
            case_sensitive,
        )
    }

    fn find_replace_notes(
        &self,
        note_ids: &[i64],
        field_name: Option<&str>,
        find: &str,
        replace: &str,
        use_regex: bool,
        case_sensitive: bool,
        now_ms: i64,
    ) -> CoreResult<Vec<bibalak_core::model::NoteSnapshot>> {
        browse::find_replace_notes(
            &mut self.lock(),
            note_ids,
            field_name,
            find,
            replace,
            use_regex,
            case_sensitive,
            now_ms,
        )
    }

    fn load_quality_notes(
        &self,
        deck_id: Option<i64>,
        note_ids: Option<&[i64]>,
        leeches_only: bool,
        limit: u32,
    ) -> CoreResult<Vec<bibalak_core::ipc::QualityScanNote>> {
        browse::load_quality_notes(&self.lock(), deck_id, note_ids, leeches_only, limit)
    }

    fn apply_quality_fixes(
        &self,
        edits: &[bibalak_core::ipc::QualityNoteEdit],
        now_ms: i64,
    ) -> CoreResult<Vec<bibalak_core::model::NoteSnapshot>> {
        browse::apply_quality_fixes(&mut self.lock(), edits, now_ms)
    }

    fn find_duplicates(
        &self,
        notetype_id: i64,
        field_ord: i64,
    ) -> CoreResult<Vec<bibalak_core::ipc::DuplicateGroup>> {
        browse::find_duplicates(&self.lock(), notetype_id, field_ord)
    }

    fn list_tags(&self) -> CoreResult<Vec<String>> {
        tags::list_tags(&self.lock())
    }

    fn list_tag_counts(&self) -> CoreResult<Vec<bibalak_core::ipc::TagCount>> {
        tags::list_tag_counts(&self.lock())
    }

    fn rename_tag(&self, old_tag: &str, new_tag: &str, now_ms: i64) -> CoreResult<u32> {
        tags::rename_tag(&self.lock(), old_tag, new_tag, now_ms)
    }

    fn delete_tag(&self, tag: &str, now_ms: i64) -> CoreResult<u32> {
        tags::delete_tag(&self.lock(), tag, now_ms)
    }

    fn merge_tags(&self, sources: &[String], target: &str, now_ms: i64) -> CoreResult<()> {
        tags::merge_tags(&self.lock(), sources, target, now_ms)
    }
}

impl MaintenanceStore for SqliteStorage {
    fn schema_version(&self) -> CoreResult<i64> {
        self.lock()
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(storage_err)
    }

    fn ensure_collection(&self, now_ms: i64) -> CoreResult<i64> {
        let created = study::ensure_collection(&self.lock(), now_ms)?;
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        crate::stock::seed_if_empty(&tx, now_ms)?;
        crate::tags::backfill_tag_registry_once(&tx)?;
        tx.commit().map_err(storage_err)?;
        Ok(created)
    }

    fn integrity_check(&self, now_ms: i64) -> CoreResult<Vec<String>> {
        let mut conn = self.lock();
        let errors = backup::integrity_check(&mut conn, now_ms)?;
        if errors.is_empty() {
            crate::tags::backfill_tag_registry(&conn)?;
        }
        Ok(errors)
    }

    fn optimize(&self) -> CoreResult<()> {
        backup::optimize(&self.lock())
    }

    fn note_media_refs(&self) -> CoreResult<Vec<String>> {
        backup::note_media_refs(&self.lock())
    }

    fn note_media_ref_counts(&self) -> CoreResult<Vec<(String, u32)>> {
        backup::note_media_ref_counts(&self.lock())
    }

    fn note_media_ref_counts_matching(
        &self,
        query: &str,
        today: i32,
        now_ms: i64,
    ) -> CoreResult<Vec<(String, u32)>> {
        search::note_media_ref_counts_matching(&self.lock(), query, today, now_ms)
    }

    fn rewrite_media_ref(&self, old_name: &str, new_name: &str, now_ms: i64) -> CoreResult<u32> {
        backup::rewrite_media_ref(&self.lock(), old_name, new_name, now_ms)
    }

    fn backup_db(&self, dest_path: &std::path::Path) -> CoreResult<()> {
        backup::backup_db(&self.lock(), dest_path)
    }
}

impl SyncStore for SqliteStorage {
    fn export_delta(&self) -> CoreResult<bibalak_core::sync::SyncDelta> {
        crate::sync::export_delta(&self.lock())
    }

    fn apply_sync_delta(
        &self,
        delta: &bibalak_core::sync::SyncDelta,
        new_usn: i64,
        now_ms: i64,
    ) -> CoreResult<bibalak_core::sync::MergeSummary> {
        let mut conn = self.lock();
        crate::sync::apply_sync_delta(&mut conn, delta, new_usn, now_ms)
    }

    fn get_sync_state(&self, key: &str) -> CoreResult<Option<String>> {
        crate::sync::get_sync_state(&self.lock(), key)
    }

    fn set_sync_state(&self, key: &str, value: &str) -> CoreResult<()> {
        crate::sync::set_sync_state(&self.lock(), key, value)
    }
}

impl ProgressStore for SqliteStorage {
    fn progress_totals(
        &self,
        user_id: &str,
        today_start_ms: i64,
        today_end_ms: i64,
    ) -> CoreResult<bibalak_core::progress::ProgressTotals> {
        study::progress_totals(&self.lock(), user_id, today_start_ms, today_end_ms)
    }

    fn get_active_ledger_reward(
        &self,
        user_id: &str,
        source_key: &str,
    ) -> CoreResult<Option<bibalak_core::progress::RewardGrant>> {
        study::get_active_ledger_reward(&self.lock(), user_id, source_key)
    }

    fn deck_review_count_in_window(
        &self,
        deck_id: i64,
        start_ms: i64,
        end_ms: i64,
    ) -> CoreResult<u32> {
        study::deck_review_count_in_window(&self.lock(), deck_id, start_ms, end_ms)
    }

    fn yesterday_activity(
        &self,
        user_id: &str,
        yesterday_day: i32,
        yesterday_start_ms: i64,
        yesterday_end_ms: i64,
    ) -> CoreResult<bibalak_core::progress::YesterdayActivity> {
        study::yesterday_activity(
            &self.lock(),
            user_id,
            yesterday_day,
            yesterday_start_ms,
            yesterday_end_ms,
        )
    }

    fn progress_history(
        &self,
        user_id: &str,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<(Vec<bibalak_core::progress::ProgressDay>, usize)> {
        study::progress_history(
            &self.lock(),
            user_id,
            tz_offset_minutes,
            rollover_hour,
            created_ms,
        )
    }

    fn study_days(
        &self,
        user_id: &str,
        limit: u32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<(Vec<bibalak_core::progress::StudyDay>, usize)> {
        study::study_days(
            &self.lock(),
            user_id,
            limit,
            tz_offset_minutes,
            rollover_hour,
            created_ms,
        )
    }

    fn progress_by_deck(
        &self,
        user_id: &str,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        now_ms: i64,
        created_ms: i64,
    ) -> CoreResult<(Vec<bibalak_core::progress::DeckProgress>, usize)> {
        study::progress_by_deck(
            &self.lock(),
            user_id,
            tz_offset_minutes,
            rollover_hour,
            now_ms,
            created_ms,
        )
    }
}

impl ProductivityStore for SqliteStorage {
    fn new_uuid(&self) -> String {
        productivity::new_uuid()
    }

    fn list_task_lists(
        &self,
        user_id: &str,
    ) -> CoreResult<Vec<bibalak_core::productivity::TaskList>> {
        productivity::list_task_lists(&self.lock(), user_id)
    }

    fn upsert_task_list(&self, list: &bibalak_core::productivity::TaskList) -> CoreResult<()> {
        productivity::upsert_task_list(&self.lock(), list)
    }

    fn soft_delete_task_list(
        &self,
        user_id: &str,
        id: &str,
        now_ms: i64,
    ) -> CoreResult<Vec<String>> {
        productivity::soft_delete_task_list(&mut self.lock(), user_id, id, now_ms)
    }

    fn restore_task_list(
        &self,
        user_id: &str,
        id: &str,
        task_ids: &[String],
        now_ms: i64,
    ) -> CoreResult<()> {
        productivity::restore_task_list(&mut self.lock(), user_id, id, task_ids, now_ms)
    }

    fn list_tasks(
        &self,
        user_id: &str,
        include_completed: bool,
    ) -> CoreResult<Vec<bibalak_core::productivity::TaskItem>> {
        productivity::list_tasks(&self.lock(), user_id, include_completed)
    }

    fn get_task(
        &self,
        user_id: &str,
        id: &str,
    ) -> CoreResult<Option<bibalak_core::productivity::TaskItem>> {
        productivity::get_task(&self.lock(), user_id, id)
    }

    fn upsert_task(&self, task: &bibalak_core::productivity::TaskItem) -> CoreResult<()> {
        productivity::upsert_task(&self.lock(), task)
    }

    fn set_task_completion(
        &self,
        user_id: &str,
        id: &str,
        completed_at: Option<i64>,
        completed_day: Option<i32>,
        reward: Option<&bibalak_core::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
        now_ms: i64,
    ) -> CoreResult<bool> {
        productivity::set_task_completion(
            &mut self.lock(),
            user_id,
            id,
            completed_at,
            completed_day,
            reward,
            revoke_source_key,
            now_ms,
        )
    }

    fn reorder_tasks(
        &self,
        user_id: &str,
        items: &[bibalak_core::productivity::TaskOrderItem],
        now_ms: i64,
    ) -> CoreResult<()> {
        productivity::reorder_tasks(&mut self.lock(), user_id, items, now_ms)
    }

    fn reschedule_overdue_tasks(
        &self,
        user_id: &str,
        today_date: &str,
        target_date: &str,
        now_ms: i64,
    ) -> CoreResult<u32> {
        productivity::reschedule_overdue_tasks(
            &mut self.lock(),
            user_id,
            today_date,
            target_date,
            now_ms,
        )
    }

    fn soft_delete_task(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()> {
        productivity::soft_delete_task(&self.lock(), user_id, id, now_ms)
    }

    fn restore_task(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()> {
        productivity::restore_task(&self.lock(), user_id, id, now_ms)
    }

    fn list_matrix_quadrants(
        &self,
        user_id: &str,
    ) -> CoreResult<Vec<bibalak_core::productivity::MatrixQuadrant>> {
        productivity::list_matrix_quadrants(&self.lock(), user_id)
    }

    fn upsert_matrix_quadrant(
        &self,
        q: &bibalak_core::productivity::MatrixQuadrant,
    ) -> CoreResult<()> {
        productivity::upsert_matrix_quadrant(&self.lock(), q)
    }

    fn list_habits(
        &self,
        user_id: &str,
        include_archived: bool,
    ) -> CoreResult<Vec<bibalak_core::productivity::Habit>> {
        productivity::list_habits(&self.lock(), user_id, include_archived)
    }

    fn get_habit(
        &self,
        user_id: &str,
        id: &str,
    ) -> CoreResult<Option<bibalak_core::productivity::Habit>> {
        productivity::get_habit(&self.lock(), user_id, id)
    }

    fn upsert_habit(&self, habit: &bibalak_core::productivity::Habit) -> CoreResult<()> {
        productivity::upsert_habit(&self.lock(), habit)
    }

    fn soft_delete_habit(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<Vec<String>> {
        productivity::soft_delete_habit(&mut self.lock(), user_id, id, now_ms)
    }

    fn restore_habit(
        &self,
        user_id: &str,
        id: &str,
        log_ids: &[String],
        now_ms: i64,
    ) -> CoreResult<()> {
        productivity::restore_habit(&mut self.lock(), user_id, id, log_ids, now_ms)
    }

    fn list_habit_logs_range(
        &self,
        user_id: &str,
        from_day: i32,
        to_day: i32,
    ) -> CoreResult<Vec<bibalak_core::productivity::HabitLog>> {
        productivity::list_habit_logs_range(&self.lock(), user_id, from_day, to_day)
    }

    fn list_habit_logs_for_habit(
        &self,
        user_id: &str,
        habit_id: &str,
        from_day: i32,
        to_day: i32,
    ) -> CoreResult<Vec<bibalak_core::productivity::HabitLog>> {
        productivity::list_habit_logs_for_habit(&self.lock(), user_id, habit_id, from_day, to_day)
    }

    fn upsert_habit_log(
        &self,
        log: &bibalak_core::productivity::HabitLog,
        reward: Option<&bibalak_core::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
    ) -> CoreResult<bibalak_core::productivity::HabitLogWriteOutcome> {
        productivity::upsert_habit_log(&mut self.lock(), log, reward, revoke_source_key)
    }

    fn restore_habit_log_snapshot(
        &self,
        user_id: &str,
        habit_id: &str,
        day_index: i32,
        previous: Option<&bibalak_core::productivity::HabitLog>,
        restore_reward: Option<&bibalak_core::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
        now_ms: i64,
    ) -> CoreResult<()> {
        productivity::restore_habit_log_snapshot(
            &mut self.lock(),
            user_id,
            habit_id,
            day_index,
            previous,
            restore_reward,
            revoke_source_key,
            now_ms,
        )
    }

    fn list_calendar_events(
        &self,
        user_id: &str,
    ) -> CoreResult<Vec<bibalak_core::productivity::CalendarEvent>> {
        productivity::list_calendar_events(&self.lock(), user_id)
    }

    fn get_calendar_event(
        &self,
        user_id: &str,
        id: &str,
    ) -> CoreResult<Option<bibalak_core::productivity::CalendarEvent>> {
        productivity::get_calendar_event(&self.lock(), user_id, id)
    }

    fn upsert_calendar_event(
        &self,
        event: &bibalak_core::productivity::CalendarEvent,
    ) -> CoreResult<()> {
        productivity::upsert_calendar_event(&self.lock(), event)
    }

    fn soft_delete_calendar_event(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()> {
        productivity::soft_delete_calendar_event(&self.lock(), user_id, id, now_ms)
    }

    fn restore_calendar_event(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()> {
        productivity::restore_calendar_event(&self.lock(), user_id, id, now_ms)
    }
}

impl GameStore for SqliteStorage {
    fn spent_gold_cents(&self, user_id: &str) -> CoreResult<u64> {
        crate::game::spent_gold_cents(&self.lock(), user_id)
    }

    fn freeze_tokens_held(&self, user_id: &str) -> CoreResult<u32> {
        crate::game::freeze_tokens_held(&self.lock(), user_id)
    }

    fn load_game_snapshot(
        &self,
        user_id: &str,
        today: i32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<bibalak_core::game::GameSnapshot> {
        crate::game::load_game_snapshot(
            &self.lock(),
            user_id,
            today,
            tz_offset_minutes,
            rollover_hour,
            created_ms,
        )
    }

    fn update_avatar_profile(
        &self,
        user_id: &str,
        input: &bibalak_core::game::AvatarProfileInput,
        now_ms: i64,
    ) -> CoreResult<bibalak_core::game::AvatarProfileDto> {
        crate::game::update_avatar_profile(&self.lock(), user_id, input, now_ms)
    }

    fn equip_game_item(
        &self,
        user_id: &str,
        slot: bibalak_core::game::EquipmentSlot,
        item_key: &str,
        now_ms: i64,
    ) -> CoreResult<()> {
        crate::game::equip_game_item(&self.lock(), user_id, slot, item_key, now_ms)
    }

    fn unequip_game_slot(
        &self,
        user_id: &str,
        slot: bibalak_core::game::EquipmentSlot,
        now_ms: i64,
    ) -> CoreResult<()> {
        crate::game::unequip_game_slot(&self.lock(), user_id, slot, now_ms)
    }

    fn buy_shop_item(
        &self,
        user_id: &str,
        item_key: &str,
        client_tx_id: &str,
        now_ms: i64,
    ) -> CoreResult<String> {
        crate::game::buy_shop_item(&mut self.lock(), user_id, item_key, client_tx_id, now_ms)
    }

    fn refund_shop_purchase(&self, user_id: &str, spend_id: &str, now_ms: i64) -> CoreResult<()> {
        crate::game::refund_shop_purchase(&mut self.lock(), user_id, spend_id, now_ms)
    }

    fn list_custom_rewards(
        &self,
        user_id: &str,
    ) -> CoreResult<Vec<bibalak_core::game::CustomRewardDto>> {
        crate::game::list_custom_rewards(&self.lock(), user_id)
    }

    fn create_custom_reward(
        &self,
        user_id: &str,
        input: &bibalak_core::game::CustomRewardInput,
        now_ms: i64,
    ) -> CoreResult<bibalak_core::game::CustomRewardDto> {
        crate::game::create_custom_reward(&mut self.lock(), user_id, input, now_ms)
    }

    fn update_custom_reward(
        &self,
        user_id: &str,
        id: &str,
        input: &bibalak_core::game::CustomRewardInput,
        now_ms: i64,
    ) -> CoreResult<bibalak_core::game::CustomRewardDto> {
        crate::game::update_custom_reward(&self.lock(), user_id, id, input, now_ms)
    }

    fn delete_custom_reward(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()> {
        crate::game::delete_custom_reward(&self.lock(), user_id, id, now_ms)
    }

    fn claim_custom_reward(
        &self,
        user_id: &str,
        reward_id: &str,
        client_tx_id: &str,
        now_ms: i64,
    ) -> CoreResult<String> {
        crate::game::claim_custom_reward(&mut self.lock(), user_id, reward_id, client_tx_id, now_ms)
    }

    fn list_spend_history(
        &self,
        user_id: &str,
        limit: u32,
        now_ms: i64,
    ) -> CoreResult<Vec<bibalak_core::game::SpendHistoryEntryDto>> {
        crate::game::list_spend_history(&self.lock(), user_id, limit, now_ms)
    }

    fn grant_unlocked_cosmetic(
        &self,
        user_id: &str,
        item_key: &str,
        now_ms: i64,
    ) -> CoreResult<bool> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        let granted = crate::game::grant_unlocked_cosmetic_tx(&tx, user_id, item_key, now_ms)?;
        tx.commit().map_err(storage_err)?;
        Ok(granted)
    }

    fn spend_gold(
        &self,
        user_id: &str,
        kind: bibalak_core::game::SpendKind,
        ref_key: &str,
        idempotency_key: &str,
        amount_cents: u64,
        now_ms: i64,
    ) -> CoreResult<String> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        let spend_id = crate::game::spend_gold_tx(
            &tx,
            user_id,
            kind,
            ref_key,
            idempotency_key,
            amount_cents,
            now_ms,
        )?;
        tx.commit().map_err(storage_err)?;
        Ok(spend_id)
    }

    fn upsert_habit_log_with_game(
        &self,
        log: &bibalak_core::productivity::HabitLog,
        reward: Option<&bibalak_core::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
        ctx: &bibalak_core::game_depth::GameEvalContext,
    ) -> CoreResult<bibalak_core::game_depth::HabitLogGameOutcome> {
        productivity::upsert_habit_log_with_game(
            &mut self.lock(),
            log,
            reward,
            revoke_source_key,
            ctx,
        )
    }

    fn apply_answer_with_game(
        &self,
        card_id: i64,
        next: &CardState,
        due: i64,
        log: &Revlog,
        reward: Option<&bibalak_core::progress::RewardGrant>,
        ctx: &bibalak_core::game_depth::GameEvalContext,
    ) -> CoreResult<bibalak_core::game_depth::ApplyAnswerOutcome> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(storage_err)?;
        let (reward_granted, revlog_id) =
            study::apply_answer_returning_id(&tx, card_id, next, due, log, reward)?;
        let lid = reward.filter(|_| reward_granted).map(|r| r.id.as_str());
        let granted_xp = reward.filter(|_| reward_granted).map_or(0, |r| r.xp);
        let game_changed = crate::game_depth::on_answer_committed_tx(
            &tx,
            ctx,
            lid,
            granted_xp,
            log.review_kind,
            card_id,
            revlog_id,
        )?;
        tx.commit().map_err(storage_err)?;
        Ok(bibalak_core::game_depth::ApplyAnswerOutcome {
            reward_granted,
            game_changed,
            revlog_id,
        })
    }

    fn set_task_completion_with_game(
        &self,
        user_id: &str,
        id: &str,
        completed_at: Option<i64>,
        completed_day: Option<i32>,
        reward: Option<&bibalak_core::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
        ctx: &bibalak_core::game_depth::GameEvalContext,
    ) -> CoreResult<bibalak_core::game_depth::GameWriteOutcome> {
        productivity::set_task_completion_with_game(
            &mut self.lock(),
            user_id,
            id,
            completed_at,
            completed_day,
            reward,
            revoke_source_key,
            ctx,
        )
    }

    fn load_game_depth_state(
        &self,
        user_id: &str,
        now_ms: i64,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<(bibalak_core::game_depth::GameDepthStateDto, bool)> {
        crate::game_depth::load_game_depth_state(
            &mut self.lock(),
            user_id,
            now_ms,
            tz_offset_minutes,
            rollover_hour,
            created_ms,
        )
    }

    fn choose_game_path(
        &self,
        user_id: &str,
        path_id: bibalak_core::game_depth::GamePathId,
        now_ms: i64,
    ) -> CoreResult<()> {
        crate::game_depth::choose_game_path(&mut self.lock(), user_id, path_id, now_ms)
    }

    fn set_active_pet(
        &self,
        user_id: &str,
        pet_id: Option<&str>,
        mounted: bool,
        now_ms: i64,
    ) -> CoreResult<()> {
        crate::game_depth::set_active_pet(&mut self.lock(), user_id, pet_id, mounted, now_ms)
    }

    fn acknowledge_unlocks(
        &self,
        user_id: &str,
        unlock_ids: &[String],
        now_ms: i64,
    ) -> CoreResult<()> {
        crate::game_depth::acknowledge_unlocks(&mut self.lock(), user_id, unlock_ids, now_ms)
    }

    fn run_unlock_backfill(
        &self,
        user_id: &str,
        now_ms: i64,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<bibalak_core::game_depth::BackfillOutcomeDto> {
        crate::game_depth::run_unlock_backfill(
            &mut self.lock(),
            user_id,
            now_ms,
            tz_offset_minutes,
            rollover_hour,
            created_ms,
        )
    }

    fn get_motivation_state(
        &self,
        user_id: &str,
        today: i32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
        now_ms: i64,
        allow_auto_freeze: bool,
    ) -> CoreResult<bibalak_core::motivation::MotivationStateDto> {
        crate::motivation::get_motivation_state(
            &mut self.lock(),
            user_id,
            today,
            tz_offset_minutes,
            rollover_hour,
            created_ms,
            now_ms,
            allow_auto_freeze,
        )
    }

    fn reconcile_motivation(
        &self,
        user_id: &str,
        today: i32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
        now_ms: i64,
        allow_comeback_revoke: bool,
    ) -> CoreResult<bool> {
        crate::motivation::reconcile_motivation(
            &mut self.lock(),
            user_id,
            today,
            tz_offset_minutes,
            rollover_hour,
            created_ms,
            now_ms,
            allow_comeback_revoke,
        )
    }

    fn set_daily_goal(&self, user_id: &str, goal_xp: u32, now_ms: i64) -> CoreResult<()> {
        crate::motivation::set_daily_goal(&self.lock(), user_id, goal_xp, now_ms)
    }

    fn get_streak_calendar(
        &self,
        user_id: &str,
        year: i32,
        month: u8,
        today: i32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<bibalak_core::motivation::StreakCalendarDto> {
        crate::motivation::get_streak_calendar(
            &self.lock(),
            user_id,
            year,
            month,
            today,
            tz_offset_minutes,
            rollover_hour,
            created_ms,
        )
    }

    fn freeze_study_day(
        &self,
        user_id: &str,
        day_index: i32,
        today: i32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
        now_ms: i64,
    ) -> CoreResult<bool> {
        crate::motivation::freeze_study_day(
            &mut self.lock(),
            user_id,
            day_index,
            today,
            tz_offset_minutes,
            rollover_hour,
            created_ms,
            now_ms,
        )
    }

    fn dismiss_comeback_offer(&self, user_id: &str, now_ms: i64) -> CoreResult<()> {
        crate::motivation::dismiss_comeback_offer(&self.lock(), user_id, now_ms)
    }

    fn complete_onboarding(&self, user_id: &str, now_ms: i64) -> CoreResult<()> {
        crate::motivation::complete_onboarding(&self.lock(), user_id, now_ms)
    }

    fn mark_monthly_badge_seen(
        &self,
        user_id: &str,
        month_key: &str,
        now_ms: i64,
    ) -> CoreResult<()> {
        crate::motivation::mark_monthly_badge_seen(&self.lock(), user_id, month_key, now_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn storage() -> SqliteStorage {
        SqliteStorage::open_in_memory().unwrap()
    }

    #[test]
    fn migrations_apply_and_seed_defaults() {
        let s = storage();
        assert_eq!(
            s.schema_version().unwrap(),
            crate::schema::MIGRATIONS.len() as i64
        );
        // The seeded Default deck is present.
        let decks = s.list_decks().unwrap();
        assert_eq!(decks.len(), 1);
        assert_eq!(decks[0].name, "Default");
        assert_eq!(decks[0].id, 1);
    }

    #[test]
    fn create_links_parent_and_persists() {
        let s = storage();
        let med = s.create_deck("Med", 100).unwrap();
        let head = s.create_deck("Med::Anatomy", 100).unwrap();
        assert_eq!(head.parent_id, Some(med.id));
        assert_eq!(s.deck_by_name("Med::Anatomy").unwrap().unwrap().id, head.id);
        assert_eq!(head.usn, -1);
    }

    #[test]
    fn rename_and_remove_and_reinsert() {
        let s = storage();
        let deck = s.create_deck("Spanish", 100).unwrap();
        s.rename_deck(deck.id, "Español", 200).unwrap();
        assert_eq!(s.deck_by_id(deck.id).unwrap().unwrap().name, "Español");

        s.remove_deck(deck.id, 1_000).unwrap();
        assert!(s.deck_by_id(deck.id).unwrap().is_none());

        // Re-insert (undo path) resurrects the row and clears the grave.
        let restored = Deck {
            name: "Español".into(),
            ..deck
        };
        s.insert_deck(&restored, 1_000).unwrap();
        assert!(s.deck_by_id(deck.id).unwrap().is_some());
        let graves: i64 = s
            .lock()
            .query_row(
                "SELECT COUNT(*) FROM graves WHERE oid = ?1",
                [deck.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(graves, 0);
    }

    #[test]
    fn remove_deck_cascades_to_cards_and_subdecks_then_undoes() {
        use bibalak_core::model::{CanonicalModel, Card, Deck, Field, Note, Notetype, Template};

        let count = |s: &SqliteStorage, sql: &str| -> i64 {
            s.lock().query_row(sql, [], |r| r.get(0)).unwrap()
        };
        let card_count = |s: &SqliteStorage| count(s, "SELECT COUNT(*) FROM cards");
        let note_count = |s: &SqliteStorage| count(s, "SELECT COUNT(*) FROM notes");
        let card = |note_id: i64, deck_id: i64, ord: i64| Card {
            id: note_id * 10 + ord, // overwritten on import; just unique here
            note_id,
            deck_id,
            ord,
            mod_ms: 0,
            usn: -1,
            ctype: 2,
            queue: 2,
            due: 0,
            interval: 5,
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
        };
        let note = |id: i64, guid: &str| Note {
            id,
            guid: guid.into(),
            notetype_id: 10,
            mod_ms: 0,
            usn: -1,
            tags: vec![],
            fields: vec!["q".into(), "a".into()],
            sort_field: Some("q".into()),
            checksum: None,
        };

        let s = storage();
        s.ensure_collection(1_700_000_000_000).unwrap();
        // Deck "Med" + sub-deck "Med::Anatomy". note 100 lives only in Med,
        // note 101 only in the sub-deck, note 102 has a card in Med AND one in
        // the seeded "Default" deck — so it must SURVIVE the delete.
        s.import(
            &CanonicalModel {
                decks: vec![
                    Deck {
                        id: 2,
                        name: "Med".into(),
                        parent_id: None,
                        config_id: 1,
                        mod_ms: 0,
                        usn: -1,
                        collapsed: false,
                        is_filtered: false,
                    },
                    Deck {
                        id: 3,
                        name: "Med::Anatomy".into(),
                        parent_id: Some(2),
                        config_id: 1,
                        mod_ms: 0,
                        usn: -1,
                        collapsed: false,
                        is_filtered: false,
                    },
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
                    afmt: "{{Back}}".into(),
                    config_json: "{}".into(),
                }],
                notes: vec![note(100, "g1"), note(101, "g2"), note(102, "g3")],
                cards: vec![
                    card(100, 2, 0),
                    card(101, 3, 0),
                    card(102, 2, 0),
                    card(102, 1, 1),
                ],
                ..Default::default()
            },
            1_000,
        )
        .unwrap();
        assert_eq!((card_count(&s), note_count(&s)), (4, 3));

        let med = s.deck_by_name("Med").unwrap().unwrap();
        let removed = s.remove_deck(med.id, 1_000).unwrap();

        // Both decks, the 3 cards under them, and the 2 orphaned notes captured.
        assert_eq!(removed.decks.len(), 2);
        assert_eq!(removed.cards.len(), 3);
        assert_eq!(removed.notes.len(), 2);
        assert!(s.deck_by_name("Med").unwrap().is_none());
        assert!(s.deck_by_name("Med::Anatomy").unwrap().is_none());
        // note 102 survives (still has a card in Default); the other two are gone.
        assert_eq!((card_count(&s), note_count(&s)), (1, 1));

        // Undo restores the whole subtree and clears every tombstone.
        s.restore_deck(&removed, 1_000).unwrap();
        assert!(s.deck_by_name("Med").unwrap().is_some());
        assert!(s.deck_by_name("Med::Anatomy").unwrap().is_some());
        assert_eq!((card_count(&s), note_count(&s)), (4, 3));
        let graves: i64 = s
            .lock()
            .query_row("SELECT COUNT(*) FROM graves", [], |r| r.get(0))
            .unwrap();
        assert_eq!(graves, 0);
    }

    #[test]
    fn set_deck_collapsed_persists_in_db() {
        let s = SqliteStorage::open_in_memory().unwrap();
        let d = s.create_deck("Parent", 1_000).unwrap();
        assert!(!d.collapsed);

        s.set_deck_collapsed(d.id, true).unwrap();
        let loaded = s.deck_by_id(d.id).unwrap().unwrap();
        assert!(loaded.collapsed);

        s.set_deck_collapsed(d.id, false).unwrap();
        let loaded2 = s.deck_by_id(d.id).unwrap().unwrap();
        assert!(!loaded2.collapsed);
    }

    #[test]
    fn queue_3_repaired_to_1_on_open() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let db_path = std::env::temp_dir().join(format!("keepsake_queue3_test_{nanos}.anki2"));
        {
            let storage = SqliteStorage::open(&db_path).unwrap();
            storage.ensure_collection(1_700_000_000_000).unwrap();
            let nt_id: i64 = storage
                .lock()
                .query_row("SELECT id FROM notetypes LIMIT 1", [], |r| r.get(0))
                .unwrap();
            storage
                .lock()
                .execute(
                    "INSERT INTO notes (id, guid, notetype_id, mod, usn, tags, fields) VALUES (999, 'g999', ?1, 0, -1, '', 'a\x1fb')",
                    [nt_id],
                )
                .unwrap();
            storage
                .lock()
                .execute(
                    "INSERT INTO cards (id, note_id, deck_id, ord, mod, usn, type, queue, due) VALUES (999, 999, 1, 0, 0, -1, 3, 3, 100)",
                    [],
                )
                .unwrap();
            // Verify corrupt queue 3 directly after insert
            let q: i64 = storage
                .lock()
                .query_row("SELECT queue FROM cards WHERE id = 999", [], |r| r.get(0))
                .unwrap();
            assert_eq!(q, 3);
        }
        // Reopen database - SqliteStorage::init must repair queue 3 to queue 1
        // and convert due from day number to start of day in ms.
        let storage = SqliteStorage::open(&db_path).unwrap();
        let (q, due): (i64, i64) = storage
            .lock()
            .query_row("SELECT queue, due FROM cards WHERE id = 999", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(q, 1);
        let created: i64 = storage
            .lock()
            .query_row("SELECT created FROM collection WHERE id = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        let expected_due = cards::day_to_start_ms(100, created, 4, 0);
        assert_eq!(due, expected_due);
        assert!(due > 1_000_000_000);
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn poisoned_lock_recovers() {
        let storage = std::sync::Arc::new(SqliteStorage::open_in_memory().unwrap());
        let s2 = std::sync::Arc::clone(&storage);
        let handle = std::thread::spawn(move || {
            let _guard = s2.lock();
            panic!("intentional poison");
        });
        assert!(handle.join().is_err());
        assert!(storage.schema_version().is_ok());
    }
}
