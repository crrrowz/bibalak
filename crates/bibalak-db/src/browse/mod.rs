//! Note browser queries + note editing. Free functions over a `Connection`,
//! called by `SqliteStorage`.

mod change_type;
mod duplicates;
mod find_replace;
mod notes;
mod read;
mod text;
mod text_import;

pub use change_type::{change_note_type, restore_note_type_changes};
pub use duplicates::find_duplicates;
pub use find_replace::{find_replace_notes, preview_find_replace};
pub use notes::{
    add_note_with_cards, add_notes_batch, apply_quality_fixes, delete_empty_cards,
    find_duplicate_note, find_empty_cards, generate_guid, restore_notes, update_note,
};
pub use read::{
    fields_for_notetype, index_rows, index_rows_for_notes, list_notes, list_notetypes,
    load_quality_notes, note_detail, notes_by_ids, templates_for_notetype,
};
pub use text::field_checksum;
pub(crate) use text::{clean_sort_value, compute_sort_and_checksum};
pub use text_import::import_text_notes;

use bibalak_core::error::CoreError;

pub(super) const FIELD_SEP: char = '\u{1f}';

pub(super) fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

pub(super) fn split_tags(tags: &str) -> Vec<String> {
    tags.split_whitespace().map(str::to_string).collect()
}

/// Anki stores tags space-delimited with surrounding spaces; we mirror that.
pub(super) fn join_tags(tags: &[String]) -> String {
    if tags.is_empty() {
        String::new()
    } else {
        format!(" {} ", tags.join(" "))
    }
}

#[cfg(test)]
pub(super) fn model() -> bibalak_core::model::CanonicalModel {
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
            afmt: "{{Back}}".into(),
            config_json: "{}".into(),
        }],
        notes: vec![Note {
            id: 100,
            guid: "g1".into(),
            notetype_id: 10,
            mod_ms: 0,
            usn: -1,
            tags: vec!["spanish".into()],
            fields: vec!["<b>hola</b>".into(), "hello".into()],
            sort_field: Some("hola".into()),
            checksum: None,
        }],
        ..Default::default()
    }
}
