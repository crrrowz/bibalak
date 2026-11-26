//! Large-collection performance benchmark.
//!
//! ```sh
//! cargo run --release -p bibalak-db --example perf               # 100k notes
//! cargo run --release -p bibalak-db --example perf -- --notes 20000
//! cargo run --release -p bibalak-db --example perf -- --check    # compare to baseline
//! ```
//!
//! Builds a synthetic but realistic collection (20 decks in a two-level tree,
//! 40% new / 10% learning / 50% review cards, ~3 reviews per reviewed card,
//! a pool of 200 tags) through the real bulk-import path into an on-disk
//! SQLite file, then times what users feel: opening the collection, the deck
//! list with counts, getting the next card, browse searches, the statistics
//! dashboard and the search-index rebuild. Each step runs several times; the
//! median is reported.
//!
//! Results are written to `target/perf/results.json`. With `--check`, each
//! median is compared with `docs/architecture/performance/baseline.json` and the run fails if any
//! step is more than `--tolerance` (default 1.5x) slower — a coarse guard
//! meant for the same machine, not for comparing different computers.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use bibalak_core::model::{
    CanonicalModel, Card, Deck, DeckConfig, Field, Note, Notetype, Revlog, Template,
};
use bibalak_core::ports::SystemClock;
use bibalak_core::Collection;
use bibalak_db::SqliteStorage;
use bibalak_search::NoteIndex;

const DAY_MS: i64 = 86_400_000;

struct Args {
    notes: usize,
    runs: usize,
    check: bool,
    tolerance: f64,
}

fn parse_args() -> Args {
    let mut args = Args {
        notes: 100_000,
        runs: 5,
        check: false,
        tolerance: 1.5,
    };
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--notes" => args.notes = it.next().and_then(|v| v.parse().ok()).unwrap_or(args.notes),
            "--runs" => args.runs = it.next().and_then(|v| v.parse().ok()).unwrap_or(args.runs),
            "--check" => args.check = true,
            "--tolerance" => {
                args.tolerance = it
                    .next()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(args.tolerance)
            }
            other => eprintln!("ignoring unknown argument {other}"),
        }
    }
    args
}

/// Small deterministic PRNG (xorshift) so every run builds the same data.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

const WORDS: &[&str] = &[
    "heart",
    "artery",
    "renal",
    "kinase",
    "receptor",
    "dose",
    "angina",
    "nitrate",
    "beta",
    "blocker",
    "verb",
    "noun",
    "past",
    "tense",
    "kanji",
    "reading",
    "تذكر",
    "مراجعة",
    "قلب",
    "دواء",
    "lung",
    "enzyme",
    "cell",
    "membrane",
    "pressure",
    "volume",
    "flow",
    "acid",
    "base",
];

fn sentence(rng: &mut Rng, words: usize) -> String {
    (0..words)
        .map(|_| WORDS[rng.below(WORDS.len() as u64) as usize])
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_model(notes: usize, now_ms: i64) -> CanonicalModel {
    let mut rng = Rng(0x5eed_cafe_f00d_1234);
    let mut decks = vec![Deck {
        id: 1,
        name: "Default".into(),
        parent_id: None,
        config_id: 1,
        mod_ms: 0,
        usn: -1,
        collapsed: false,
        is_filtered: false,
    }];
    // 4 top-level decks x 4 sub-decks = 20 decks.
    let mut leaf_ids = Vec::new();
    for top in 0..4 {
        let top_id = 100 + top * 10;
        decks.push(Deck {
            id: top_id,
            name: format!("Subject {top}"),
            parent_id: None,
            config_id: 1,
            mod_ms: 0,
            usn: -1,
            collapsed: false,
            is_filtered: false,
        });
        for sub in 1..=4 {
            let id = top_id + sub;
            decks.push(Deck {
                id,
                name: format!("Subject {top}::Topic {sub}"),
                parent_id: Some(top_id),
                config_id: 1,
                mod_ms: 0,
                usn: -1,
                collapsed: false,
                is_filtered: false,
            });
            leaf_ids.push(id);
        }
    }

    let mut model = CanonicalModel {
        created_ms: None,
        deck_configs: vec![DeckConfig {
            id: 1,
            name: "Default".into(),
            mod_ms: 0,
            usn: 0,
            config_json: "{}".into(),
        }],
        decks,
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
            afmt: "{{FrontSide}}<hr id=answer>{{Back}}".into(),
            config_json: "{}".into(),
        }],
        notes: Vec::with_capacity(notes),
        cards: Vec::with_capacity(notes),
        revlog: Vec::with_capacity(notes * 3 / 2),
    };

    let mut revlog_id = now_ms - 400 * DAY_MS;
    for i in 0..notes as i64 {
        let note_id = 1_000_000 + i;
        let front_words = 4 + rng.below(8) as usize;
        let front = sentence(&mut rng, front_words);
        let back_words = 8 + rng.below(24) as usize;
        let back = sentence(&mut rng, back_words);
        let tags = (0..1 + rng.below(5))
            .map(|_| format!("t{}", rng.below(200)))
            .collect();
        model.notes.push(Note {
            id: note_id,
            guid: format!("perf-{i}"),
            notetype_id: 10,
            mod_ms: now_ms - (rng.below(365) as i64) * DAY_MS,
            usn: -1,
            tags,
            fields: vec![front.clone(), back],
            sort_field: Some(front),
            checksum: Some(i),
        });

        let card_id = 5_000_000 + i;
        let roll = rng.below(100);
        let (ctype, queue, due, interval, reps) = if roll < 40 {
            (0, 0, i, 0, 0) // new: due = position
        } else if roll < 50 {
            let due_s = now_ms / 1000 + rng.below(6 * 3600) as i64 - 3 * 3600;
            (1, 1, due_s, 0, 1 + rng.below(3) as i64) // learning: due = epoch seconds
        } else {
            let interval = 1 + rng.below(300) as i64;
            let due_day = rng.below(90) as i64 - 30; // overdue .. due in 2 months
            (2, 2, due_day, interval, 2 + rng.below(20) as i64)
        };
        model.cards.push(Card {
            id: card_id,
            note_id,
            deck_id: leaf_ids[rng.below(leaf_ids.len() as u64) as usize],
            ord: 0,
            mod_ms: now_ms,
            usn: -1,
            ctype,
            queue,
            due,
            interval,
            ease_factor: 2500,
            reps,
            lapses: rng.below(3) as i64,
            remaining: 0,
            original_due: 0,
            original_deck_id: 0,
            flags: 0,
            fsrs_stability: None,
            fsrs_difficulty: None,
            fsrs_last_review: None,
            data: None,
        });
        if queue == 2 {
            for _ in 0..3 {
                revlog_id += 1 + rng.below(250_000) as i64;
                model.revlog.push(Revlog {
                    id: revlog_id.min(now_ms),
                    card_id,
                    usn: -1,
                    ease: 1 + rng.below(4) as i64,
                    interval,
                    last_interval: interval / 2,
                    ease_factor: 2500,
                    taken_ms: 2_000 + rng.below(20_000) as i64,
                    review_kind: 1,
                });
            }
        }
    }
    model
}

fn median(mut samples: Vec<Duration>) -> f64 {
    samples.sort();
    samples[samples.len() / 2].as_secs_f64() * 1000.0
}

fn time<T>(runs: usize, mut f: impl FnMut() -> T) -> f64 {
    let mut samples = Vec::with_capacity(runs);
    for _ in 0..runs {
        let start = Instant::now();
        std::hint::black_box(f());
        samples.push(start.elapsed());
    }
    median(samples)
}

fn open(path: &Path) -> Collection {
    let storage = SqliteStorage::open(path).expect("open collection");
    Collection::new(Box::new(storage), Arc::new(SystemClock)).unwrap()
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn main() {
    let args = parse_args();
    let dir = std::env::temp_dir().join(format!("keepsake-perf-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let db = dir.join("collection.sqlite");
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    println!("Building a {}-note collection…", args.notes);
    let model = build_model(args.notes, now_ms);
    let revlogs = model.revlog.len();
    let mut results: Vec<(&str, f64)> = Vec::new();

    let start = Instant::now();
    {
        let col = open(&db);
        col.import(&model).expect("import");
    }
    results.push(("import_ms", start.elapsed().as_secs_f64() * 1000.0));
    drop(model);

    results.push(("open_ms", time(args.runs, || open(&db))));
    let col = open(&db);
    // Import merges decks by name and assigns its own ids.
    let top_deck = col
        .list_decks()
        .expect("decks")
        .into_iter()
        .find(|d| d.name == "Subject 0")
        .map(|d| d.id)
        .expect("Subject 0 deck");
    results.push((
        "deck_list_with_counts_ms",
        time(args.runs, || col.list_decks_with_counts().expect("decks")),
    ));
    results.push((
        "next_card_top_deck_ms",
        time(args.runs, || col.next_card(top_deck).expect("next")),
    ));
    results.push((
        "search_tag_due_ms",
        time(args.runs, || {
            col.search_cards("tag:t7 is:due", 500, 0, None, true)
                .expect("search")
        }),
    ));
    results.push((
        "search_text_ms",
        time(args.runs, || {
            col.search_cards("receptor dose", 500, 0, None, true)
                .expect("search")
        }),
    ));
    results.push((
        "stats_all_365d_ms",
        time(args.runs, || col.stats(None, Some(365), 0).expect("stats")),
    ));
    results.push((
        "stats_deck_30d_ms",
        time(args.runs, || {
            col.stats(Some(top_deck), Some(30), 0).expect("stats")
        }),
    ));
    results.push((
        "search_index_rebuild_ms",
        time(args.runs.min(3), || {
            let rows = col.index_rows().expect("rows");
            let index = NoteIndex::new().expect("index");
            index.rebuild(&rows).expect("rebuild");
            index
        }),
    ));
    let db_mb = std::fs::metadata(&db)
        .map(|m| m.len() as f64 / 1_048_576.0)
        .unwrap_or(0.0);
    drop(col);
    let _ = std::fs::remove_dir_all(&dir);

    println!(
        "\n{} notes/cards, {} review-log rows, database {:.1} MB",
        args.notes, revlogs, db_mb
    );
    println!("{:<28} {:>12}", "step", "median ms");
    for (name, ms) in &results {
        println!("{name:<28} {ms:>12.1}");
    }

    let json = serde_json::json!({
        "notes": args.notes,
        "revlog_rows": revlogs,
        "db_mb": (db_mb * 10.0).round() / 10.0,
        "runs": args.runs,
        "results_ms": results
            .iter()
            .map(|(k, v)| (k.to_string(), serde_json::json!((v * 10.0).round() / 10.0)))
            .collect::<serde_json::Map<String, serde_json::Value>>(),
    });
    let out_dir = repo_root().join("target/perf");
    let _ = std::fs::create_dir_all(&out_dir);
    let out = out_dir.join("results.json");
    std::fs::write(
        &out,
        serde_json::to_string_pretty(&json).unwrap_or_default(),
    )
    .ok();
    println!("\nWrote {}", out.display());

    if args.check {
        let baseline_path = repo_root().join("docs/architecture/performance/baseline.json");
        let Ok(text) = std::fs::read_to_string(&baseline_path) else {
            eprintln!("no baseline at {}", baseline_path.display());
            std::process::exit(2);
        };
        let baseline: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        let mut regressions = Vec::new();
        for (name, ms) in &results {
            if let Some(base) = baseline["results_ms"][*name].as_f64() {
                // Ignore sub-millisecond noise.
                if *ms > base * args.tolerance && *ms - base > 1.0 {
                    regressions.push(format!("{name}: {ms:.1} ms vs baseline {base:.1} ms"));
                }
            }
        }
        if regressions.is_empty() {
            println!(
                "No regressions beyond {:.1}x of the baseline.",
                args.tolerance
            );
        } else {
            eprintln!("Performance regressions:\n  {}", regressions.join("\n  "));
            std::process::exit(1);
        }
    }
}
