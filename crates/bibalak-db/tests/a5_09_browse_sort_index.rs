use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use bibalak_db::SqliteStorage;
use rusqlite::Connection;

fn temp_dir(label: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("bibalak_a509_{label}_{}_{n}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn a5_09_search_cards_default_sort_uses_index_without_temp_btree() {
    let dir = temp_dir("eqp");
    let db_path = dir.join("collection.sqlite");
    let storage = SqliteStorage::open(&db_path).unwrap();
    drop(storage);

    let conn = Connection::open(&db_path).unwrap();
    for dir_sql in ["ASC", "DESC"] {
        let sql = format!(
            "EXPLAIN QUERY PLAN
             SELECT c.id, c.note_id, COALESCE(n.sort_field, ''), d.name, nt.name, n.tags,
                    c.queue, c.type, c.due, c.interval, c.lapses, c.reps, c.ease_factor, c.flags
             FROM notes n
             CROSS JOIN cards c ON c.note_id = n.id
             JOIN decks d ON d.id = c.deck_id
             JOIN notetypes nt ON nt.id = n.notetype_id
             WHERE 1=1
             ORDER BY n.sort_field COLLATE NOCASE {dir_sql}, n.id {dir_sql}, c.id {dir_sql}
             LIMIT 100 OFFSET 0"
        );
        let mut stmt = conn.prepare(&sql).unwrap();
        let plan: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(3))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        let joined = plan.join(" | ");
        assert!(
            !joined.contains("USE TEMP B-TREE FOR ORDER BY"),
            "Default Browse sort ({dir_sql}) triggers temp B-tree sort: {joined}"
        );
    }
    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}
