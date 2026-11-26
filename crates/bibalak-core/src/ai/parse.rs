//! Validation and parsing for structured AI responses.

use std::collections::HashMap;

use serde::Deserialize;

use crate::error::{CoreError, CoreResult};

use super::types::{
    AIActionRequest, CoachInput, CoachReport, GeneratedCardDraft, GeneratedNoteKind,
    QualityFinding, QualityNoteInput,
};

fn strip_markdown_fence(raw: &str) -> &str {
    let trimmed = raw.trim();
    trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .map(str::trim_start)
        .and_then(|s| s.strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(trimmed)
}

/// Returns `true` when `text` contains at least one valid `{{cN::answer}}` cloze deletion
/// (`N >= 1`, non-empty answer before `}}` or `::hint}}`).
fn has_valid_cloze_marker(text: &str) -> bool {
    let mut rest = text;
    while let Some(pos) = rest.find("{{c") {
        rest = &rest[pos + 3..];
        let Some(colon_pos) = rest.find("::") else {
            continue;
        };
        let digits = &rest[..colon_pos];
        if !digits.is_empty() && digits.parse::<u32>().is_ok_and(|n| n >= 1) {
            let after_colons = &rest[colon_pos + 2..];
            if let Some(close_pos) = after_colons.find("}}") {
                let inner = &after_colons[..close_pos];
                let answer = inner.split("::").next().unwrap_or("").trim();
                if !answer.is_empty() {
                    return true;
                }
            }
        }
    }
    false
}

/// Extract rewritten field strings from a `RewriteLeech` AI response if it matches JSON
/// `{"fields": [...]}` (with optional markdown code fence stripping) and matches `expected_count`.
pub fn parse_rewritten_fields(raw: &str, expected_count: usize) -> Option<Vec<String>> {
    if expected_count == 0 {
        return None;
    }
    let unfenced = strip_markdown_fence(raw);

    #[derive(Deserialize)]
    struct RewriteJson {
        fields: Vec<String>,
    }

    let parsed: RewriteJson = serde_json::from_str(unfenced).ok()?;
    if parsed.fields.len() == expected_count {
        Some(parsed.fields)
    } else {
        None
    }
}

/// Validate and parse generated card drafts from strict JSON, enforcing non-empty text,
/// valid `{{cN::...}}` cloze markers when `note_kind == GeneratedNoteKind::Cloze`, and at most
/// `max_count` drafts. Invalid replies yield [`CoreError::Format`] without partial data.
pub fn parse_generated_cards(
    raw: &str,
    note_kind: GeneratedNoteKind,
    max_count: u32,
) -> CoreResult<Vec<GeneratedCardDraft>> {
    let unfenced = strip_markdown_fence(raw);

    #[derive(Deserialize)]
    struct RawBasicCard {
        front: String,
        back: String,
    }

    #[derive(Deserialize)]
    struct RawClozeCard {
        text: String,
    }

    #[derive(Deserialize)]
    struct CardsEnvelope<T> {
        cards: Vec<T>,
    }

    let drafts: Vec<GeneratedCardDraft> = match note_kind {
        GeneratedNoteKind::Basic => {
            let parsed: CardsEnvelope<RawBasicCard> =
                serde_json::from_str(unfenced).map_err(|_| {
                    CoreError::Format(
                        "AI returned an invalid card-generation reply; expected JSON {\"cards\":[{\"front\":\"...\",\"back\":\"...\"}]}"
                            .into(),
                    )
                })?;
            let mut out = Vec::with_capacity(parsed.cards.len());
            for card in parsed.cards {
                let front = card.front.trim().to_string();
                let back = card.back.trim().to_string();
                if front.is_empty() || back.is_empty() {
                    return Err(CoreError::Format(
                        "AI generated an empty Basic card front or back".into(),
                    ));
                }
                out.push(GeneratedCardDraft::Basic { front, back });
            }
            out
        }
        GeneratedNoteKind::Cloze => {
            let parsed: CardsEnvelope<RawClozeCard> =
                serde_json::from_str(unfenced).map_err(|_| {
                    CoreError::Format(
                        "AI returned an invalid card-generation reply; expected JSON {\"cards\":[{\"text\":\"... {{c1::...}} ...\"}]}"
                            .into(),
                    )
                })?;
            let mut out = Vec::with_capacity(parsed.cards.len());
            for card in parsed.cards {
                let text = card.text.trim().to_string();
                if text.is_empty() || !has_valid_cloze_marker(&text) {
                    return Err(CoreError::Format(
                        "AI generated a Cloze card missing a valid {{cN::...}} deletion".into(),
                    ));
                }
                out.push(GeneratedCardDraft::Cloze { text });
            }
            out
        }
    };

    if drafts.is_empty() {
        return Err(CoreError::Format(
            "AI returned zero card drafts for this section".into(),
        ));
    }
    if drafts.len() > max_count as usize {
        return Err(CoreError::Format(format!(
            "AI returned {} card drafts, exceeding the requested maximum of {max_count}",
            drafts.len()
        )));
    }
    Ok(drafts)
}

/// Validate JSON quality findings returned by `review_quality@1`.
pub fn parse_quality_findings(
    raw: &str,
    notes: &[QualityNoteInput],
) -> CoreResult<Vec<QualityFinding>> {
    #[derive(Deserialize)]
    struct FindingsEnvelope {
        findings: Vec<QualityFinding>,
    }

    let unfenced = strip_markdown_fence(raw);
    let parsed: FindingsEnvelope = serde_json::from_str(unfenced).map_err(|_| {
        CoreError::Format(
            "AI returned an invalid quality review reply; expected JSON {\"findings\":[...]}"
                .into(),
        )
    })?;

    let by_id: HashMap<i64, &QualityNoteInput> = notes.iter().map(|n| (n.note_id, n)).collect();
    let mut out = Vec::with_capacity(parsed.findings.len());

    for finding in parsed.findings {
        let validated = match finding {
            QualityFinding::Unclear { note_id, reason } => {
                if !by_id.contains_key(&note_id) {
                    return Err(CoreError::Format(format!(
                        "quality finding references unknown note_id {note_id}"
                    )));
                }
                let reason = reason.trim().to_string();
                if reason.is_empty() {
                    return Err(CoreError::Format(
                        "quality finding is missing a non-empty reason".into(),
                    ));
                }
                QualityFinding::Unclear { note_id, reason }
            }
            QualityFinding::Overloaded { note_id, reason } => {
                if !by_id.contains_key(&note_id) {
                    return Err(CoreError::Format(format!(
                        "quality finding references unknown note_id {note_id}"
                    )));
                }
                let reason = reason.trim().to_string();
                if reason.is_empty() {
                    return Err(CoreError::Format(
                        "quality finding is missing a non-empty reason".into(),
                    ));
                }
                QualityFinding::Overloaded { note_id, reason }
            }
            QualityFinding::DuplicateMeaning {
                note_id,
                other_note_id,
                reason,
            } => {
                if !by_id.contains_key(&note_id) || !by_id.contains_key(&other_note_id) {
                    return Err(CoreError::Format(format!(
                        "duplicate-meaning finding references unknown note id ({note_id}, {other_note_id})"
                    )));
                }
                if note_id == other_note_id {
                    return Err(CoreError::Format(
                        "duplicate-meaning finding cannot point a note at itself".into(),
                    ));
                }
                let reason = reason.trim().to_string();
                if reason.is_empty() {
                    return Err(CoreError::Format(
                        "quality finding is missing a non-empty reason".into(),
                    ));
                }
                QualityFinding::DuplicateMeaning {
                    note_id,
                    other_note_id,
                    reason,
                }
            }
            QualityFinding::SuggestedTags {
                note_id,
                tags,
                reason,
            } => {
                if !by_id.contains_key(&note_id) {
                    return Err(CoreError::Format(format!(
                        "quality finding references unknown note_id {note_id}"
                    )));
                }
                if tags.is_empty() {
                    return Err(CoreError::Format(
                        "suggested-tags finding must include at least one tag".into(),
                    ));
                }
                let mut clean_tags = Vec::with_capacity(tags.len());
                for tag in tags {
                    let trimmed = tag.trim().to_string();
                    if trimmed.is_empty() || trimmed.chars().any(char::is_whitespace) {
                        return Err(CoreError::Format(format!(
                            "suggested-tags entry '{trimmed}' cannot be empty or contain spaces"
                        )));
                    }
                    clean_tags.push(trimmed);
                }
                let reason = reason.trim().to_string();
                if reason.is_empty() {
                    return Err(CoreError::Format(
                        "quality finding is missing a non-empty reason".into(),
                    ));
                }
                QualityFinding::SuggestedTags {
                    note_id,
                    tags: clean_tags,
                    reason,
                }
            }
            QualityFinding::Rewrite {
                note_id,
                fields,
                reason,
            } => {
                let note = by_id.get(&note_id).ok_or_else(|| {
                    CoreError::Format(format!(
                        "quality finding references unknown note_id {note_id}"
                    ))
                })?;
                if fields.len() != note.fields.len() {
                    return Err(CoreError::Format(format!(
                        "rewrite finding for note {note_id} returned {} fields, expected {}",
                        fields.len(),
                        note.fields.len()
                    )));
                }
                if fields.iter().all(|f| f.trim().is_empty()) {
                    return Err(CoreError::Format(
                        "rewrite finding must include at least one non-empty field".into(),
                    ));
                }
                let reason = reason.trim().to_string();
                if reason.is_empty() {
                    return Err(CoreError::Format(
                        "quality finding is missing a non-empty reason".into(),
                    ));
                }
                QualityFinding::Rewrite {
                    note_id,
                    fields,
                    reason,
                }
            }
            QualityFinding::ClozeSplit {
                note_id,
                clozes,
                reason,
            } => {
                if !by_id.contains_key(&note_id) {
                    return Err(CoreError::Format(format!(
                        "quality finding references unknown note_id {note_id}"
                    )));
                }
                if !(2..=6).contains(&clozes.len()) {
                    return Err(CoreError::Format(format!(
                        "cloze-split finding must produce 2 to 6 clozes, got {}",
                        clozes.len()
                    )));
                }
                let mut clean_clozes = Vec::with_capacity(clozes.len());
                for text in clozes {
                    let trimmed = text.trim().to_string();
                    if trimmed.is_empty() || !has_valid_cloze_marker(&trimmed) {
                        return Err(CoreError::Format(
                            "cloze-split item is missing a valid {{cN::...}} deletion".into(),
                        ));
                    }
                    clean_clozes.push(trimmed);
                }
                let reason = reason.trim().to_string();
                if reason.is_empty() {
                    return Err(CoreError::Format(
                        "quality finding is missing a non-empty reason".into(),
                    ));
                }
                QualityFinding::ClozeSplit {
                    note_id,
                    clozes: clean_clozes,
                    reason,
                }
            }
        };
        out.push(validated);
    }

    Ok(out)
}

#[derive(Deserialize)]
struct RawAdviceItem {
    title: String,
    detail: String,
    #[serde(default)]
    deck_id: Option<i64>,
}

#[derive(Deserialize)]
struct RawPlanDay {
    day: u8,
    reviews: u32,
    new_cards: u32,
    focus: String,
}

#[derive(Deserialize)]
struct RawCoachReport {
    summary: String,
    advice: Vec<RawAdviceItem>,
    plan: Vec<RawPlanDay>,
}

/// Validate and parse a study coach response matching strict JSON schema.
/// Returns [`CoreError::Format`] on rule violations without returning partial data.
pub fn parse_coach_report(raw: &str, input: &CoachInput) -> CoreResult<CoachReport> {
    let unfenced = strip_markdown_fence(raw);
    let parsed: RawCoachReport = serde_json::from_str(unfenced).map_err(|e| {
        CoreError::Format(format!(
            "AI returned an invalid study coach reply; expected JSON matching coach schema: {e}"
        ))
    })?;

    let summary = parsed.summary.trim().to_string();
    if summary.is_empty() {
        return Err(CoreError::Format("coach summary must not be empty".into()));
    }

    if parsed.advice.is_empty() || parsed.advice.len() > 5 {
        return Err(CoreError::Format(format!(
            "coach advice must contain between 1 and 5 items, found {}",
            parsed.advice.len()
        )));
    }

    let mut allowed_deck_ids: std::collections::HashSet<i64> =
        input.top_decks.iter().map(|d| d.deck_id).collect();
    if let Some(id) = input.selected_deck_id {
        allowed_deck_ids.insert(id);
    }

    let mut validated_advice: Vec<super::types::CoachAdviceItem> =
        Vec::with_capacity(parsed.advice.len());
    for item in parsed.advice {
        let title = item.title.trim().to_string();
        if title.is_empty() {
            return Err(CoreError::Format(
                "coach advice title must not be empty".into(),
            ));
        }
        let detail = item.detail.trim().to_string();
        if detail.is_empty() {
            return Err(CoreError::Format(
                "coach advice detail must not be empty".into(),
            ));
        }
        if let Some(deck_id) = item.deck_id {
            if !allowed_deck_ids.contains(&deck_id) {
                return Err(CoreError::Format(format!(
                    "coach advice deck_id {deck_id} must be one of the input decks"
                )));
            }
        }
        validated_advice.push(super::types::CoachAdviceItem {
            title,
            detail,
            deck_id: item.deck_id,
        });
    }

    if parsed.plan.len() != 7 {
        return Err(CoreError::Format(format!(
            "coach plan must contain exactly 7 days, found {}",
            parsed.plan.len()
        )));
    }

    let mut validated_plan: Vec<super::types::CoachPlanDay> = Vec::with_capacity(7);
    for (i, day_item) in parsed.plan.into_iter().enumerate() {
        let expected_day = (i + 1) as u8;
        if day_item.day != expected_day && (day_item.day == 0 || day_item.day > 7) {
            return Err(CoreError::Format(format!(
                "coach plan day number {} is invalid (must be 1..=7)",
                day_item.day
            )));
        }
        if day_item.reviews > 2000 {
            return Err(CoreError::Format(format!(
                "coach plan day {} reviews ({}) exceeds maximum 2000",
                day_item.day, day_item.reviews
            )));
        }
        if day_item.new_cards > 2000 {
            return Err(CoreError::Format(format!(
                "coach plan day {} new_cards ({}) exceeds maximum 2000",
                day_item.day, day_item.new_cards
            )));
        }
        let focus = day_item.focus.trim().to_string();
        if focus.is_empty() {
            return Err(CoreError::Format(format!(
                "coach plan day {} focus must not be empty",
                day_item.day
            )));
        }
        validated_plan.push(super::types::CoachPlanDay {
            day: day_item.day,
            reviews: day_item.reviews,
            new_cards: day_item.new_cards,
            focus,
        });
    }

    Ok(CoachReport {
        summary,
        advice: validated_advice,
        plan: validated_plan,
    })
}

/// Outcome of validating a raw AI response for an action.
pub type ParsedReply = (
    String,
    Option<Vec<String>>,
    Option<Vec<GeneratedCardDraft>>,
    Option<Vec<QualityFinding>>,
    Option<CoachReport>,
);

/// Validate a raw provider reply for `action`, returning structured results or a clear
/// [`CoreError::Format`] when JSON validation fails.
pub fn parse_action_reply(action: &AIActionRequest, raw: &str) -> CoreResult<ParsedReply> {
    match action {
        AIActionRequest::RewriteLeech { fields, .. } => {
            let parsed = parse_rewritten_fields(raw, fields.len()).ok_or_else(|| {
                CoreError::Format(format!(
                    "AI returned an invalid rewrite reply; expected JSON {{\"fields\": [...]}} with {} string(s)",
                    fields.len()
                ))
            })?;
            Ok((raw.to_string(), Some(parsed), None, None, None))
        }
        AIActionRequest::GenerateCards {
            note_kind, count, ..
        } => {
            let drafts = parse_generated_cards(raw, *note_kind, *count)?;
            Ok((raw.to_string(), None, Some(drafts), None, None))
        }
        AIActionRequest::ReviewQuality { notes, .. } => {
            let findings = parse_quality_findings(raw, notes)?;
            Ok((raw.to_string(), None, None, Some(findings), None))
        }
        AIActionRequest::StudyCoach { input } => {
            let report = parse_coach_report(raw, input)?;
            Ok((raw.to_string(), None, None, None, Some(report)))
        }
        AIActionRequest::TestConnection
        | AIActionRequest::ExplainCard { .. }
        | AIActionRequest::SuggestBack { .. }
        | AIActionRequest::TutorExample { .. }
        | AIActionRequest::TutorMnemonic { .. }
        | AIActionRequest::TutorTranslate { .. }
        | AIActionRequest::TutorWhyWrong { .. } => Ok((raw.to_string(), None, None, None, None)),
    }
}
