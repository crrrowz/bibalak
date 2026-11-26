//! Stock note types (Basic, Cloze, Image Occlusion, …), seeded into a fresh
//! collection and offered via "Add stock note type" for existing ones. All
//! ship with [`DEFAULT_CARD_CSS`], the app's "modern editorial" default look
//! — deliberately nicer than Anki's plain stock styling, and fully
//! user-editable afterward from the notetype's Styling tab.

use bibalak_core::error::{CoreError, CoreResult};
pub use bibalak_core::notetype_preset::DEFAULT_CARD_CSS;
use rusqlite::{params, Connection, Transaction};

fn err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Storage(e.to_string())
}

/// One card template definition for seeding.
pub(crate) struct StockTemplate {
    name: &'static str,
    qfmt: &'static str,
    afmt: &'static str,
}

/// One stock note type definition.
pub(crate) struct StockNotetype {
    name: &'static str,
    kind: i64,
    fields: &'static [&'static str],
    templates: &'static [StockTemplate],
    /// Extra keys merged into `config` beyond `css` (e.g. image-occlusion mode).
    extra_config: Option<&'static str>,
}

const BASIC: StockNotetype = StockNotetype {
    name: "Basic",
    kind: 0,
    fields: &["Front", "Back"],
    templates: &[StockTemplate {
        name: "Card 1",
        qfmt: "{{Front}}",
        afmt: "{{FrontSide}}<hr id=\"answer\">{{Back}}",
    }],
    extra_config: None,
};

const BASIC_REVERSED: StockNotetype = StockNotetype {
    name: "Basic (and reversed card)",
    kind: 0,
    fields: &["Front", "Back"],
    templates: &[
        StockTemplate {
            name: "Card 1",
            qfmt: "{{Front}}",
            afmt: "{{FrontSide}}<hr id=\"answer\">{{Back}}",
        },
        StockTemplate {
            name: "Card 2",
            qfmt: "{{Back}}",
            afmt: "{{FrontSide}}<hr id=\"answer\">{{Front}}",
        },
    ],
    extra_config: None,
};

const BASIC_OPTIONAL_REVERSED: StockNotetype = StockNotetype {
    name: "Basic (optional reversed card)",
    kind: 0,
    fields: &["Front", "Back", "Add Reverse"],
    templates: &[
        StockTemplate {
            name: "Card 1",
            qfmt: "{{Front}}",
            afmt: "{{FrontSide}}<hr id=\"answer\">{{Back}}",
        },
        StockTemplate {
            name: "Card 2",
            qfmt: "{{#Add Reverse}}{{Back}}{{/Add Reverse}}",
            afmt: "{{FrontSide}}<hr id=\"answer\">{{Front}}",
        },
    ],
    extra_config: None,
};

const BASIC_TYPE_IN: StockNotetype = StockNotetype {
    name: "Basic (type in the answer)",
    kind: 0,
    fields: &["Front", "Back"],
    templates: &[StockTemplate {
        name: "Card 1",
        qfmt: "{{Front}}\n\n{{type:Back}}",
        afmt: "{{FrontSide}}<hr id=\"answer\">{{type:Back}}",
    }],
    extra_config: None,
};

const CLOZE: StockNotetype = StockNotetype {
    name: "Cloze",
    kind: 1,
    fields: &["Text", "Extra"],
    templates: &[StockTemplate {
        name: "Cloze",
        qfmt: "{{cloze:Text}}",
        afmt: "{{cloze:Text}}<br><span class=\"keepsake-extra\">{{Extra}}</span>",
    }],
    extra_config: None,
};

const IMAGE_OCCLUSION: StockNotetype = StockNotetype {
    name: "Image Occlusion",
    kind: 1,
    fields: &["Occlusion", "Image", "Header", "Back Extra", "Comments"],
    templates: &[StockTemplate {
        name: "Card 1",
        qfmt: "{{Header}}<div class=\"keepsake-io-wrap\">{{Image}}{{cloze:Occlusion}}</div>",
        afmt: "{{Header}}<div class=\"keepsake-io-wrap\">{{Image}}{{cloze:Occlusion}}</div><br><span class=\"keepsake-extra\">{{Back Extra}}</span>",
    }],
    extra_config: Some(r#""kind":"image-occlusion","occlusionMode":"hideAllGuessOne""#),
};

/// All stock note types, in the order offered to the user.
pub(crate) const ALL: &[&StockNotetype] = &[
    &BASIC,
    &BASIC_REVERSED,
    &BASIC_OPTIONAL_REVERSED,
    &BASIC_TYPE_IN,
    &CLOZE,
    &IMAGE_OCCLUSION,
];

/// Names for the `add_stock_notetype` picker, in `ALL` order.
pub fn stock_names() -> Vec<&'static str> {
    ALL.iter().map(|s| s.name).collect()
}

/// If the collection has no note types at all (fresh install), seed all
/// stock note types. Never touches a collection that already has one.
pub fn seed_if_empty(tx: &Transaction<'_>, now_ms: i64) -> CoreResult<()> {
    let count: i64 = tx
        .query_row("SELECT COUNT(*) FROM notetypes", [], |r| r.get(0))
        .map_err(err)?;
    if count > 0 {
        return Ok(());
    }
    for stock in ALL {
        create_stock(tx, stock, now_ms)?;
    }
    Ok(())
}

/// Add one stock note type (by its index in [`ALL`]) to an existing
/// collection, e.g. via the note-type editor's "Add stock note type" picker.
pub fn add_stock(conn: &Connection, index: usize, now_ms: i64) -> CoreResult<i64> {
    let stock = *ALL
        .get(index)
        .ok_or_else(|| CoreError::Invalid(format!("no stock note type at index {index}")))?;
    let id = create_stock(conn, stock, now_ms)?;
    Ok(id)
}

fn create_stock(conn: &Connection, stock: &StockNotetype, now_ms: i64) -> CoreResult<i64> {
    let css_escaped = serde_json::to_string(DEFAULT_CARD_CSS).map_err(err)?;
    let config = match stock.extra_config {
        Some(extra) => format!("{{\"css\":{css_escaped},{extra}}}"),
        None => format!("{{\"css\":{css_escaped}}}"),
    };

    conn.execute(
        r#"INSERT INTO notetypes (name, kind, "mod", usn, config) VALUES (?1, ?2, ?3, -1, ?4)"#,
        params![stock.name, stock.kind, now_ms, config],
    )
    .map_err(err)?;
    let id = conn.last_insert_rowid();

    for (ord, name) in stock.fields.iter().enumerate() {
        conn.execute(
            "INSERT INTO fields (notetype_id, ord, name, config) VALUES (?1, ?2, ?3, '{}')",
            params![id, ord as i64, name],
        )
        .map_err(err)?;
    }

    for (ord, tmpl) in stock.templates.iter().enumerate() {
        conn.execute(
            "INSERT INTO templates (notetype_id, ord, name, qfmt, afmt, config)
             VALUES (?1, ?2, ?3, ?4, ?5, '{}')",
            params![id, ord as i64, tmpl.name, tmpl.qfmt, tmpl.afmt],
        )
        .map_err(err)?;
    }

    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::SqliteStorage;

    #[test]
    fn seed_if_empty_creates_all_stock_types() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let mut conn = storage.lock();
        let tx = conn.transaction().unwrap();
        seed_if_empty(&tx, 1000).unwrap();
        tx.commit().unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notetypes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count as usize, ALL.len());

        let cloze_kind: i64 = conn
            .query_row("SELECT kind FROM notetypes WHERE name = 'Cloze'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(cloze_kind, 1);
    }

    #[test]
    fn seed_if_empty_is_a_noop_when_notetypes_exist() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let mut conn = storage.lock();
        let tx = conn.transaction().unwrap();
        create_stock(&tx, &BASIC, 1000).unwrap();
        tx.commit().unwrap();

        let tx = conn.transaction().unwrap();
        seed_if_empty(&tx, 2000).unwrap();
        tx.commit().unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notetypes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn add_stock_inserts_css_into_config() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let conn = storage.lock();
        let id = add_stock(&conn, 0, 1000).unwrap();
        let css: String = conn
            .query_row(
                "SELECT json_extract(config, '$.css') FROM notetypes WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(css, DEFAULT_CARD_CSS);
    }
}
