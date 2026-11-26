//! Note-type CRUD: fields, templates, and note-type lifecycle.

mod crud;
mod field_config;
mod fields;
mod templates;

pub use crud::{
    create_notetype, delete_notetype, duplicate_notetype, get_notetype_detail,
    note_count_for_notetype, rename_notetype, save_notetype_css, save_notetype_preset,
};
pub use field_config::{reorder_fields, save_field_options, set_sort_field};
pub use fields::{add_field, check_field_remove, remove_field, rename_field};
pub use templates::{
    add_template, check_template_remove, remove_template, rewrite_template_field, save_template,
    template_uses_field,
};

use bibalak_core::error::{CoreError, CoreResult};
use rusqlite::Connection;

pub(super) const FIELD_SEP: char = '\u{1f}';

pub(super) fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

pub(crate) fn bump_schema_mod(conn: &Connection, now_ms: i64) -> CoreResult<()> {
    conn.execute(
        "UPDATE collection SET schema_mod = ?1, modified = ?1 WHERE id = 1",
        [now_ms],
    )
    .map_err(err)?;
    Ok(())
}

#[cfg(test)]
use crate::storage::SqliteStorage;
#[cfg(test)]
use bibalak_core::ports::*;

/// Import creates a "Basic" notetype + 1 note + 1 card; IDs are
/// auto-assigned by the DB (import remaps source IDs), so we look them up.
#[cfg(test)]
pub(super) struct Setup {
    pub(super) s: SqliteStorage,
    pub(super) nt_id: i64,
    pub(super) note_id: i64,
}

#[cfg(test)]
pub(super) fn setup() -> Setup {
    let s = SqliteStorage::open_in_memory().unwrap();
    s.ensure_collection(1_700_000_000_000).unwrap();
    s.import(&basic_model(), 1_700_000_000_000).unwrap();
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
    Setup { s, nt_id, note_id }
}

#[cfg(test)]
fn basic_model() -> bibalak_core::model::CanonicalModel {
    use bibalak_core::model::*;
    CanonicalModel {
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
            tags: vec![],
            fields: vec!["hello".into(), "world".into()],
            sort_field: Some("hello".into()),
            checksum: None,
        }],
        cards: vec![Card {
            id: 1001,
            note_id: 100,
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
    }
}
