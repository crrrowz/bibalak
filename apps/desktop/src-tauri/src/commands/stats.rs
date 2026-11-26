//! Statistics command.

use bibalak_core::ipc::{IpcError, IpcErrorKind, StatsDto};
use bibalak_core::Collection;
use tauri::AppHandle;

use super::with_collection;

fn load_stats(
    collection: &Collection,
    deck_id: Option<i64>,
    days: Option<u32>,
    tz_offset_minutes: i32,
) -> Result<StatsDto, IpcError> {
    if !(-1440..=1440).contains(&tz_offset_minutes) {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: format!("tz_offset_minutes {tz_offset_minutes} out of range -1440..=1440"),
        });
    }
    collection
        .stats(deck_id, days, tz_offset_minutes)
        .map_err(|e| {
            tracing::error!(?deck_id, ?days, tz_offset_minutes, error = %e, "get_stats failed");
            IpcError::from(e)
        })
}

#[tauri::command]
pub async fn get_stats(
    app: AppHandle,
    deck_id: Option<i64>,
    days: Option<u32>,
    tz_offset_minutes: i32,
) -> Result<StatsDto, IpcError> {
    with_collection(app, move |collection| {
        load_stats(collection, deck_id, days, tz_offset_minutes)
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use bibalak_core::model::Algorithm;
    use bibalak_core::ports::TestClock;
    use bibalak_core::scheduling::{CardPhase, SchedContext, Scheduler};
    use bibalak_core::{Collection, Rating};
    use bibalak_db::SqliteStorage;
    use bibalak_scheduler::{FsrsScheduler, Sm2Scheduler};

    #[test]
    fn stats_survives_algorithm_switch_on_real_fixtures_and_fsrs_reviews() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
        for name in ["sample-v11.apkg", "sample-v18.apkg"] {
            let path = root.join("fixtures").join(name);
            let (model, _) = bibalak_ankifmt::read_package(&path, None).unwrap();
            let storage = SqliteStorage::open_in_memory().unwrap();
            let clock = Arc::new(TestClock::new(1_794_830_400_000));
            let col = Collection::new(Box::new(storage), clock.clone()).unwrap();
            col.import(&model).unwrap();

            let mut ts = 1_794_830_400_001_i64;
            for deck in col.list_decks().unwrap() {
                let mut cfg = col.get_deck_config(deck.id).unwrap();
                cfg.algorithm = Algorithm::Fsrs;
                col.set_deck_config(&cfg).unwrap();
                let s = col.stats(Some(deck.id), Some(30), 180).unwrap();
                serde_json::to_string(&s).unwrap();
                let s_all = col.stats(Some(deck.id), None, 180).unwrap();
                serde_json::to_string(&s_all).unwrap();

                // Also answer a card under FSRS if one is available, then switch back to SM-2.
                if let Some(card) = col.next_card(deck.id).unwrap() {
                    let sched = col.get_sched_config(deck.id).unwrap();
                    let ctx = SchedContext {
                        today: 0,
                        config: sched.clone(),
                    };
                    let out = FsrsScheduler.answer(&card.state, Rating::Good, &ctx);
                    let due = match out.interval {
                        bibalak_core::scheduling::Interval::Minutes(m) => {
                            ts + i64::from(m) * 60_000
                        }
                        bibalak_core::scheduling::Interval::Days(d) => i64::from(d),
                    };
                    ts += 1;
                    let log = bibalak_core::model::Revlog {
                        id: ts,
                        card_id: card.id,
                        usn: -1,
                        ease: 3,
                        interval: 1,
                        last_interval: 0,
                        ease_factor: 2500,
                        taken_ms: 1000,
                        review_kind: if card.state.phase == CardPhase::Review {
                            1
                        } else {
                            0
                        },
                    };
                    col.apply_answer(
                        card.id,
                        card.note_id,
                        &card.state,
                        card.due,
                        &out.next,
                        due,
                        &log,
                        sched.leech_threshold,
                    )
                    .unwrap();
                }

                let mut cfg_back = col.get_deck_config(deck.id).unwrap();
                cfg_back.algorithm = Algorithm::Sm2;
                col.set_deck_config(&cfg_back).unwrap();
                let s2 = col.stats(Some(deck.id), Some(30), 180).unwrap();
                serde_json::to_string(&s2).unwrap();

                // Also check SM-2 answer after FSRS switch.
                if let Some(card) = col.next_card(deck.id).unwrap() {
                    let sched = col.get_sched_config(deck.id).unwrap();
                    let ctx = SchedContext {
                        today: 0,
                        config: sched.clone(),
                    };
                    let out = Sm2Scheduler.answer(&card.state, Rating::Easy, &ctx);
                    ts += 1;
                    let log = bibalak_core::model::Revlog {
                        id: ts,
                        card_id: card.id,
                        usn: -1,
                        ease: 4,
                        interval: 4,
                        last_interval: 0,
                        ease_factor: 2500,
                        taken_ms: 1000,
                        review_kind: 0,
                    };
                    col.apply_answer(
                        card.id,
                        card.note_id,
                        &card.state,
                        card.due,
                        &out.next,
                        4,
                        &log,
                        sched.leech_threshold,
                    )
                    .unwrap();
                }
                let s3 = col.stats(None, None, 180).unwrap();
                serde_json::to_string(&s3).unwrap();
            }
        }
    }

    #[test]
    fn stats_after_ui_payload_anki_dconf_and_fsrs_edge_cases() {
        use bibalak_core::model::{DeckConfig as CoreDeckConfig, Revlog};
        use bibalak_core::scheduling::{CardPhase, CardState, FSRS6_DEFAULT_WEIGHTS};

        // (a) Anki-style minimal / null deck_config JSON -> get_deck_config -> set_deck_config -> stats
        for (idx, raw_json) in [
            "{}",
            r#"{"id":1,"name":"Default","new":{"delays":[1,10],"perDay":20},"fsrs":{"weights":null,"desiredRetention":null}}"#,
            r#"{"algo":"fsrs","fsrs":{"weights":[0.4,0.6,2.4,5.8,4.93,0.94,0.86,0.01,1.49,0.14,0.94,2.18,0.05,0.34,1.26,0.29,2.61,0.5,0.6],"desiredRetention":0.9}}"#,
        ]
        .into_iter()
        .enumerate()
        {
            let storage = SqliteStorage::open_in_memory().unwrap();
            let clock = Arc::new(TestClock::new(1_700_000_000_000));
            let col = Collection::new(Box::new(storage), clock).unwrap();
            let deck = col.create_deck("AnkiDeck").unwrap();
            let mut model = bibalak_core::model::CanonicalModel::default();
            model.decks.push(bibalak_core::model::Deck {
                id: 99,
                name: "ImportedWithCustomConf".into(),
                parent_id: None,
                config_id: 99,
                mod_ms: 0,
                usn: -1,
                collapsed: false,
                is_filtered: false,
            });
            model.deck_configs.push(CoreDeckConfig {
                id: 99,
                name: "Custom".into(),
                mod_ms: 0,
                usn: -1,
                config_json: raw_json.into(),
            });
            model.notetypes.push(bibalak_core::model::Notetype {
                id: 50,
                name: format!("CustomBasic_{idx}"),
                kind: 0,
                mod_ms: 0,
                usn: -1,
                config_json: "{}".into(),
            });
            model.fields.push(bibalak_core::model::Field {
                notetype_id: 50,
                ord: 0,
                name: "Front".into(),
                config_json: "{}".into(),
            });
            model.templates.push(bibalak_core::model::Template {
                notetype_id: 50,
                ord: 0,
                name: "Card 1".into(),
                qfmt: "{{Front}}".into(),
                afmt: "{{Front}}".into(),
                config_json: "{}".into(),
            });
            model.notes.push(bibalak_core::model::Note {
                id: 70,
                guid: format!("guid-{idx}"),
                notetype_id: 50,
                mod_ms: 0,
                usn: -1,
                tags: vec![],
                fields: vec!["Q".into()],
                sort_field: Some("Q".into()),
                checksum: None,
            });
            model.cards.push(bibalak_core::model::Card {
                id: 80,
                note_id: 70,
                deck_id: 99,
                ord: 0,
                mod_ms: 0,
                usn: -1,
                ctype: 2,
                queue: 2,
                due: 5,
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
            });
            col.import(&model).unwrap();
            let imported_deck = col
                .list_decks()
                .unwrap()
                .into_iter()
                .find(|d| d.name == "ImportedWithCustomConf")
                .unwrap();
            let mut cfg = col.get_deck_config(imported_deck.id).unwrap();
            cfg.algorithm = Algorithm::Fsrs;
            col.set_deck_config(&cfg).unwrap();
            let _ = col.stats(Some(imported_deck.id), Some(30), -300).unwrap();
            let _ = col.stats(Some(deck.id), None, 0).unwrap();
        }

        // (b) Exact TS DeckOptionsDialog JSON payload deserialization + SM-2 <-> FSRS switch
        let storage = SqliteStorage::open_in_memory().unwrap();
        let clock = Arc::new(TestClock::new(1_700_000_000_000));
        let col = Collection::new(Box::new(storage), clock).unwrap();
        let deck = col.create_deck("UiPayload").unwrap();
        let nt = col.add_stock_notetype(0).unwrap();
        col.add_note(nt.id, deck.id, &["Q".into(), "A".into()], &[])
            .unwrap();
        let card = col.next_card(deck.id).unwrap().unwrap();

        // Populate FSRS card state edge values (last_review_day == today, > today, stability edge)
        let today = col.today();
        let mut next = CardState {
            phase: CardPhase::Review,
            steps_remaining: 0,
            interval_days: 10,
            ease_milli: 2500,
            reps: 2,
            lapses: 0,
            stability: Some(0.01),
            difficulty: Some(5.0),
            last_review_day: Some(today + 2),
        };
        let log = Revlog {
            id: 1_700_000_000_001,
            card_id: card.id,
            usn: -1,
            ease: 3,
            interval: 10,
            last_interval: 1,
            ease_factor: 2500,
            taken_ms: 1500,
            review_kind: 1,
        };
        col.apply_answer(
            card.id,
            card.note_id,
            &card.state,
            card.due,
            &next,
            i64::from(today + 10),
            &log,
            8,
        )
        .unwrap();

        // Also test deserializing the exact TS DeckConfig JSON payload
        let weights_json = serde_json::to_string(&FSRS6_DEFAULT_WEIGHTS).unwrap();
        let ui_json = format!(
            r#"{{
                "deck_id": {},
                "config_id": {},
                "algorithm": "fsrs",
                "new_per_day": 20,
                "review_per_day": 200,
                "learning_steps_min": [1, 10],
                "graduating_interval_days": 1,
                "easy_interval_days": 4,
                "starting_ease_milli": 2500,
                "easy_bonus": 1.3,
                "hard_interval_factor": 1.2,
                "interval_modifier": 1.0,
                "maximum_interval_days": 36500,
                "relearning_steps_min": [10],
                "lapse_interval_factor": 0.0,
                "minimum_interval_days": 1,
                "leech_threshold": 8,
                "fsrs_weights": {},
                "desired_retention": 0.9
            }}"#,
            deck.id,
            col.get_deck_config(deck.id).unwrap().config_id,
            weights_json
        );
        let parsed: bibalak_core::ipc::DeckConfig = serde_json::from_str(&ui_json).unwrap();
        col.set_deck_config(&parsed).unwrap();

        for tz in [-480, 0, 180] {
            for days in [Some(7), Some(30), Some(90), Some(365), None] {
                let s = col.stats(Some(deck.id), days, tz).unwrap();
                serde_json::to_string(&s).unwrap();
                let s_all = col.stats(None, days, tz).unwrap();
                serde_json::to_string(&s_all).unwrap();
            }
        }

        // Also check zero stability FSRS state via direct revlog/card edge case if possible
        next.stability = Some(0.0);
        next.last_review_day = Some(today);
        let log2 = Revlog {
            id: 1_700_000_000_002,
            card_id: card.id,
            usn: -1,
            ease: 3,
            interval: 1,
            last_interval: 10,
            ease_factor: 2500,
            taken_ms: 1200,
            review_kind: 1,
        };
        col.apply_answer(
            card.id,
            card.note_id,
            &next,
            i64::from(today + 10),
            &next,
            i64::from(today + 1),
            &log2,
            8,
        )
        .unwrap();
        let s_zero_stab = col.stats(Some(deck.id), Some(30), 0).unwrap();
        let serialized = serde_json::to_string(&s_zero_stab).unwrap();
        assert!(!serialized.contains("NaN"));
    }

    #[test]
    fn load_stats_maps_and_logs_collection_error() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let clock = Arc::new(TestClock::new(1_700_000_000_000));
        let col = Collection::new(Box::new(storage), clock).unwrap();
        let err = super::load_stats(&col, Some(999_999), Some(30), 0).unwrap_err();
        assert_eq!(err.kind, bibalak_core::ipc::IpcErrorKind::NotFound);
        assert!(err.message.contains("999999"), "unexpected error: {err:?}");
    }
}
