//! Study commands. The shell is where the scheduling decision (bibalak-scheduler)
//! and HTML rendering (bibalak-render) meet the core's queue + persistence.

use bibalak_core::error::CoreError;
use bibalak_core::ipc::{CardPreviewDto, IpcError, IpcErrorKind, StudyCardDto};
use bibalak_core::model::CardRender;
use bibalak_core::scheduling::{CardPhase, Interval, SchedContext};
use bibalak_core::{Collection, Rating, StudyCard};
use bibalak_render::{render, RenderRequest, Rendered, Template};
use bibalak_scheduler::scheduler_for;
use tauri::AppHandle;

use super::with_collection;

type IpcResult<T> = Result<T, IpcError>;

#[tauri::command]
pub async fn get_next_card(app: AppHandle, deck_id: i64) -> IpcResult<Option<StudyCardDto>> {
    with_collection(app, move |collection| {
        collection.start_study_session(deck_id)?;
        match collection.next_card(deck_id)? {
            Some(card) => Ok(Some(present(collection, card, deck_id))),
            None => Ok(None),
        }
    })
    .await
}

#[tauri::command]
pub async fn answer_card(
    app: AppHandle,
    card_id: i64,
    rating: u8,
    deck_id: i64,
    time_ms: i64,
) -> IpcResult<Option<StudyCardDto>> {
    let rating = rating_from(rating)?;
    with_collection(app, move |collection| {
        collection.answer_card(card_id, rating, time_ms)?;
        match collection.next_card(deck_id)? {
            Some(next) => Ok(Some(present(collection, next, deck_id))),
            None => Ok(None),
        }
    })
    .await
}

fn rating_from(value: u8) -> IpcResult<Rating> {
    match value {
        1 => Ok(Rating::Again),
        2 => Ok(Rating::Hard),
        3 => Ok(Rating::Good),
        4 => Ok(Rating::Easy),
        _ => Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: format!("bad rating {value}"),
        }),
    }
}

fn render_card_faces(card: &CardRender) -> Rendered {
    render(&RenderRequest {
        template: Template {
            qfmt: &card.qfmt,
            afmt: &card.afmt,
        },
        fields: &card.fields,
        card_ord: card.card_ord,
        is_cloze: card.is_cloze,
        tags: &card.tags,
        deck: &card.deck,
        subdeck: &card.subdeck,
        notetype: &card.notetype,
        card_name: &card.card_name,
        flag: card.flag,
        occlusion_mode: &card.occlusion_mode,
    })
}

/// Pure card-preview helper shared with tests cleanly outside Tauri `State`.
pub fn build_card_preview(collection: &Collection, card_id: i64) -> IpcResult<CardPreviewDto> {
    let card = collection
        .study_card(card_id)?
        .ok_or_else(|| IpcError::from(CoreError::NotFound(format!("card {card_id}"))))?;
    let rendered = render_card_faces(&card.render);
    Ok(CardPreviewDto {
        card_id,
        question: rendered.question,
        answer: rendered.answer,
        css: card.render.css,
    })
}

#[tauri::command]
pub async fn preview_card(app: AppHandle, card_id: i64) -> IpcResult<CardPreviewDto> {
    with_collection(app, move |collection| {
        build_card_preview(collection, card_id)
    })
    .await
}

/// `session_deck_id` is the deck the session was started on (may be a parent
/// with subdecks); remaining counts are rolled up over its whole subtree, not
/// just `card`'s own (possibly child) deck.
fn present(collection: &Collection, card: StudyCard, session_deck_id: i64) -> StudyCardDto {
    let rendered = render_card_faces(&card.render);

    let config = collection
        .get_sched_config(card.deck_id)
        .unwrap_or_default();
    let algorithm = config.algorithm;
    let scheduler = scheduler_for(algorithm);
    let ctx = SchedContext {
        today: collection.today(),
        config,
    };
    let previews = scheduler.preview(&card.state, &ctx);
    let (new_count, learning_count, review_count) = collection
        .count_due_by_type(session_deck_id)
        .unwrap_or((0, 0, 0));

    let card_phase = match card.state.phase {
        CardPhase::New => "new",
        CardPhase::Learning => "learning",
        CardPhase::Review => "review",
        CardPhase::Relearning => "relearning",
    }
    .to_string();

    StudyCardDto {
        card_id: card.id,
        note_id: card.note_id,
        deck_id: card.deck_id,
        question: rendered.question,
        answer: rendered.answer,
        css: card.render.css.clone(),
        again: label(previews.again),
        hard: label(previews.hard),
        good: label(previews.good),
        easy: label(previews.easy),
        new_count,
        learning_count,
        review_count,
        card_phase,
        algorithm,
    }
}

fn label(interval: Interval) -> String {
    match interval {
        Interval::Minutes(0) => "< 1m".into(),
        Interval::Minutes(m) if m < 60 => format!("{m}m"),
        Interval::Minutes(m) if m % 60 == 0 => format!("{}h", m / 60),
        Interval::Minutes(m) => format!("{:.1}h", m as f64 / 60.0),
        Interval::Days(d) if d < 7 => format!("{d}d"),
        Interval::Days(d) if d < 30 => format!("{}w", d / 7),
        Interval::Days(d) if d < 365 => format!("{}mo", (d as f64 / 30.0).round() as u32),
        Interval::Days(d) => {
            let y = (d as f64 / 365.0 * 10.0).round() / 10.0;
            if y.fract() == 0.0 {
                format!("{}y", y as u32)
            } else {
                format!("{y:.1}y")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::build_card_preview;
    use bibalak_core::model::*;
    use bibalak_core::ports::FixedClock;
    use bibalak_core::Collection;
    use bibalak_db::SqliteStorage;
    use std::sync::Arc;

    #[test]
    fn build_card_preview_renders_front_back_and_css() {
        let storage = SqliteStorage::open_in_memory().unwrap();
        let clock = Arc::new(FixedClock(1_700_000_000_000));
        let col = Collection::new(Box::new(storage), clock).unwrap();
        let deck = col.create_deck("PreviewDeck").unwrap();
        col.storage()
            .import(
                &CanonicalModel {
                    notetypes: vec![Notetype {
                        id: 1,
                        name: "Basic".into(),
                        kind: 0,
                        mod_ms: 0,
                        usn: -1,
                        config_json: r#"{"css":".card{color:navy;}"}"#.into(),
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
                        afmt: "{{FrontSide}}<hr id=answer>{{Back}}".into(),
                        config_json: "{}".into(),
                    }],
                    ..Default::default()
                },
                1_700_000_000_000,
            )
            .unwrap();
        let nt_id = col
            .list_notetypes()
            .unwrap()
            .into_iter()
            .find(|n| n.name == "Basic")
            .unwrap()
            .id;
        col.add_note(nt_id, deck.id, &["Hello".into(), "World".into()], &[])
            .unwrap();
        let card_id = col
            .storage()
            .search_cards("", 0, 1_700_000_000_000, 10, 0, None, true)
            .unwrap()[0]
            .card_id;

        let dto = build_card_preview(&col, card_id).unwrap();
        assert_eq!(dto.card_id, card_id);
        assert!(dto.question.contains("Hello"));
        assert!(!dto.question.contains("World"));
        assert!(dto.answer.contains("World"));
        assert!(dto.css.contains("color:navy"));
        assert!(build_card_preview(&col, card_id + 9999).is_err());
    }
}
