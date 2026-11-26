//! Synthetic 400 MB export benchmark (EXP1 Step 0 / Gate T5).
//! Run manually with:
//! `cargo test -p bibalak-ankifmt --test bench_export -- --ignored --nocapture`

use std::time::Instant;

use bibalak_ankifmt::write_apkg_with_media;
use bibalak_core::model::{
    CanonicalModel, Card, Deck, DeckConfig, Field, Note, Notetype, Template,
};
use bibalak_media::FsMediaStore;

#[test]
#[ignore = "synthetic 400 MB disk benchmark; run manually with --ignored"]
fn bench_export_400mb_baseline() {
    let dir = tempfile::tempdir().unwrap();
    let media_dir = dir.path().join("collection.media");
    std::fs::create_dir_all(&media_dir).unwrap();

    // 40 files x 10 MB = 400 MB of distinct pseudo-random/patterned media blobs
    let mut notes = Vec::with_capacity(40);
    let mut cards = Vec::with_capacity(40);
    for i in 0..40usize {
        let filename = format!("clip_{i:02}.bin");
        let mut blob = vec![(i as u8).wrapping_mul(31).wrapping_add(7); 10 * 1024 * 1024];
        blob[0..4].copy_from_slice(&(i as u32).to_le_bytes());
        std::fs::write(media_dir.join(&filename), &blob).unwrap();

        let nid = 1_700_000_000_000 + i as i64;
        notes.push(Note {
            id: nid,
            guid: format!("guid-{i:02}"),
            notetype_id: 1,
            mod_ms: 1_000,
            usn: 0,
            tags: vec![],
            fields: vec![format!(r#"<img src="{filename}">"#), format!("Back {i}")],
            sort_field: Some(format!("Note {i}")),
            checksum: Some(i as i64),
        });
        cards.push(Card {
            id: 2_000_000_000_000 + i as i64,
            note_id: nid,
            deck_id: 1,
            ord: 0,
            mod_ms: 1_000,
            usn: 0,
            ctype: 0,
            queue: 0,
            due: i as i64 + 1,
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
        });
    }

    let model = CanonicalModel {
        created_ms: Some(1_700_000_000_000),
        deck_configs: vec![DeckConfig {
            id: 1,
            name: "Default".into(),
            mod_ms: 0,
            usn: 0,
            config_json: "{}".into(),
        }],
        decks: vec![Deck {
            id: 1,
            name: "Default".into(),
            parent_id: None,
            config_id: 1,
            mod_ms: 0,
            usn: 0,
            collapsed: false,
            is_filtered: false,
        }],
        notetypes: vec![Notetype {
            id: 1,
            name: "Basic".into(),
            kind: 0,
            mod_ms: 0,
            usn: 0,
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
        notes,
        cards,
        revlog: vec![],
    };

    let store = FsMediaStore::new(media_dir);
    let out = dir.path().join("bench-400mb.apkg");
    let t0 = Instant::now();
    let count = write_apkg_with_media(&model, &out, Some(&store)).unwrap();
    let elapsed = t0.elapsed();
    let size = std::fs::metadata(&out).unwrap().len();
    eprintln!(
        "EXP1 streaming 400MB export: count={count} bytes={size} elapsed_ms={}",
        elapsed.as_millis()
    );
    assert_eq!(count, 40);
}
