//! Versioned AI prompt registry, language-rule selection, and pure action execution.

use crate::error::{CoreError, CoreResult};

use super::parse::parse_action_reply;
use super::plain_text::html_to_plain_text;
use super::split::{MAX_GENERATE_CARDS, MAX_GENERATE_SOURCE_CHARS};
use super::types::{AIActionRequest, AIActionResult, AIProvider, AITextRequest, GeneratedNoteKind};

/// Metadata and template parameters for one prompt version.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PromptSpec {
    pub id: &'static str,
    pub version: u32,
    pub versioned_id: &'static str,
    pub system: &'static str,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

/// Built request paired with the versioned prompt identifier (`id@version`) that generated it.
#[derive(Debug, Clone, PartialEq)]
pub struct PromptBuild {
    pub prompt_id: &'static str,
    pub request: AITextRequest,
}

pub const TEST_CONNECTION: PromptSpec = PromptSpec {
    id: "test_connection",
    version: 1,
    versioned_id: "test_connection@1",
    system: "Respond briefly with OK.",
    max_tokens: None,
    temperature: Some(0.0),
};

pub const EXPLAIN_CARD: PromptSpec = PromptSpec {
    id: "explain_card",
    version: 1,
    versioned_id: "explain_card@1",
    system: "You are a concise study tutor. Explain why the answer follows from the prompt, highlight subtle traps, and keep it brief in plain text.",
    max_tokens: Some(1500),
    temperature: Some(0.3),
};

pub const SUGGEST_BACK: PromptSpec = PromptSpec {
    id: "suggest_back",
    version: 1,
    versioned_id: "suggest_back@1",
    system: "Draft a concise, accurate flashcard answer in plain text without wrapper commentary.",
    max_tokens: Some(1200),
    temperature: Some(0.4),
};

pub const REWRITE_LEECH: PromptSpec = PromptSpec {
    id: "rewrite_leech",
    version: 1,
    versioned_id: "rewrite_leech@1",
    system: "This flashcard is a leech (repeatedly forgotten). Rewrite it so it is atomic, clear, and easy to recall. Return STRICT JSON only in the form {\"fields\": [\"...\"]} matching the original field order.",
    max_tokens: Some(1500),
    temperature: Some(0.4),
};

pub const GENERATE_CARDS: PromptSpec = PromptSpec {
    id: "generate_cards",
    version: 1,
    versioned_id: "generate_cards@1",
    system: "You turn study notes into concise, atomic flashcards in plain text without wrapper commentary.",
    max_tokens: Some(3000),
    temperature: Some(0.3),
};

pub const TUTOR_EXAMPLE: PromptSpec = PromptSpec {
    id: "tutor_example",
    version: 1,
    versioned_id: "tutor_example@1",
    system: "You are a concise study tutor. Give one concrete, memorable example that illustrates this flashcard concept clearly in plain text.",
    max_tokens: Some(1200),
    temperature: Some(0.4),
};

pub const TUTOR_MNEMONIC: PromptSpec = PromptSpec {
    id: "tutor_mnemonic",
    version: 1,
    versioned_id: "tutor_mnemonic@1",
    system: "You are a concise study tutor. Create a short, vivid mnemonic or memory hook for this flashcard in plain text.",
    max_tokens: Some(1000),
    temperature: Some(0.5),
};

pub const TUTOR_TRANSLATE: PromptSpec = PromptSpec {
    id: "tutor_translate",
    version: 1,
    versioned_id: "tutor_translate@1",
    system: "You are a precise bilingual translator. Translate this flashcard clearly in plain text without wrapper commentary.",
    max_tokens: Some(1500),
    temperature: Some(0.2),
};

pub const TUTOR_WHY_WRONG: PromptSpec = PromptSpec {
    id: "tutor_why_wrong",
    version: 1,
    versioned_id: "tutor_why_wrong@1",
    system: "You are a concise study tutor. Explain why the learner may have missed this card, compare their attempt if provided, and highlight the key distinction in plain text.",
    max_tokens: Some(1500),
    temperature: Some(0.3),
};

pub const REVIEW_QUALITY: PromptSpec = PromptSpec {
    id: "review_quality",
    version: 1,
    versioned_id: "review_quality@1",
    system: "You audit spaced-repetition flashcards for clarity, atomicity, duplicate meaning, and helpful tags. Only flag genuine issues and suggest clean fixes in plain text. Return STRICT JSON only matching {\"findings\": [...]} with no markdown commentary outside the JSON.",
    max_tokens: Some(4000),
    temperature: Some(0.2),
};

pub const STUDY_COACH: PromptSpec = PromptSpec {
    id: "study_coach",
    version: 1,
    versioned_id: "study_coach@1",
    system: "You are an expert study coach for spaced repetition. Analyze the student's study statistics and produce concise, realistic advice and a balanced 7-day study plan. Output: Return STRICT JSON only in the form {\"summary\": \"...\", \"advice\": [{\"title\": \"...\", \"detail\": \"...\", \"deck_id\": null}], \"plan\": [{\"day\": 1, \"reviews\": 0, \"new_cards\": 0, \"focus\": \"...\"}]} with 1 to 5 advice items, exactly 7 plan days, reviews/new_cards between 0 and 2000, and no markdown commentary outside the JSON.",
    max_tokens: Some(2500),
    temperature: Some(0.3),
};

const MAX_TYPED_ANSWER_CHARS: usize = 500;
/// Maximum notes submitted in one quality review scan.
pub const MAX_QUALITY_SCAN_NOTES: usize = 200;
/// Default batch size per AI quality review request.
pub const DEFAULT_QUALITY_CHUNK_NOTES: usize = 20;

/// Registry of every current AI prompt specification.
pub const ALL: &[&PromptSpec] = &[
    &TEST_CONNECTION,
    &EXPLAIN_CARD,
    &SUGGEST_BACK,
    &REWRITE_LEECH,
    &GENERATE_CARDS,
    &TUTOR_EXAMPLE,
    &TUTOR_MNEMONIC,
    &TUTOR_TRANSLATE,
    &TUTOR_WHY_WRONG,
    &REVIEW_QUALITY,
    &STUDY_COACH,
];

/// Look up the current prompt specification for an [`AIActionRequest`].
pub fn for_action(action: &AIActionRequest) -> &'static PromptSpec {
    match action {
        AIActionRequest::TestConnection => &TEST_CONNECTION,
        AIActionRequest::ExplainCard { .. } => &EXPLAIN_CARD,
        AIActionRequest::SuggestBack { .. } => &SUGGEST_BACK,
        AIActionRequest::RewriteLeech { .. } => &REWRITE_LEECH,
        AIActionRequest::GenerateCards { .. } => &GENERATE_CARDS,
        AIActionRequest::TutorExample { .. } => &TUTOR_EXAMPLE,
        AIActionRequest::TutorMnemonic { .. } => &TUTOR_MNEMONIC,
        AIActionRequest::TutorTranslate { .. } => &TUTOR_TRANSLATE,
        AIActionRequest::TutorWhyWrong { .. } => &TUTOR_WHY_WRONG,
        AIActionRequest::ReviewQuality { .. } => &REVIEW_QUALITY,
        AIActionRequest::StudyCoach { .. } => &STUDY_COACH,
    }
}

fn count_scripts(text: &str) -> (usize, usize) {
    let mut arabic_count = 0usize;
    let mut latin_count = 0usize;
    for ch in text.chars() {
        if is_arabic_char(ch) {
            arabic_count += 1;
        } else if ch.is_ascii_alphabetic() {
            latin_count += 1;
        }
    }
    (arabic_count, latin_count)
}

/// Returns `true` when the card text is predominantly Arabic, meaning `TutorTranslate`
/// should translate Arabic -> English (otherwise translate into Arabic).
pub fn translate_targets_english(plain_text: &str) -> bool {
    let (arabic_count, latin_count) = count_scripts(plain_text);
    arabic_count > 0 && arabic_count >= latin_count
}

/// Look up a prompt specification by versioned identifier (e.g. `"explain_card@1"`).
pub fn find(versioned_id: &str) -> Option<&'static PromptSpec> {
    ALL.iter().copied().find(|p| p.versioned_id == versioned_id)
}

fn is_arabic_char(c: char) -> bool {
    matches!(
        c,
        '\u{0600}'..='\u{06FF}'
            | '\u{0750}'..='\u{077F}'
            | '\u{08A0}'..='\u{08FF}'
            | '\u{FB50}'..='\u{FDFF}'
            | '\u{FE70}'..='\u{FEFF}'
    )
}

/// Return the bilingual language instruction for a sanitized card payload.
///
/// Answers match Arabic when the card contains predominantly Arabic text (so Arabic learners get
/// Arabic output without extra toggles), otherwise instruct the model to match the card's
/// language or fall back to the user's app language when unclear.
pub fn language_instruction(plain_text: &str, app_locale: Option<&str>) -> &'static str {
    let (arabic_count, latin_count) = count_scripts(plain_text);

    if arabic_count > 0 && arabic_count >= latin_count {
        "Language rule: Answer in Arabic matching the card's language."
    } else if arabic_count > 0 || latin_count > 0 {
        match app_locale {
            Some("ar") => {
                "Language rule: Answer in the card's language, or in Arabic when unclear."
            }
            _ => "Language rule: Answer in the card's language, or the app language when unclear.",
        }
    } else {
        match app_locale {
            Some("ar") => "Language rule: The card's language is unclear; answer in Arabic.",
            _ => "Language rule: If the card's language is unclear, answer in the app language.",
        }
    }
}

fn sanitize_card_context(
    front_html: &str,
    back_html: &str,
    deck_name: Option<&str>,
) -> CoreResult<(String, String, String)> {
    let front = html_to_plain_text(front_html);
    let back = html_to_plain_text(back_html);
    if front.is_empty() && back.is_empty() {
        return Err(CoreError::Invalid("card content is empty".into()));
    }
    let deck_line = deck_name
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(|d| format!("Deck: {d}\n"))
        .unwrap_or_default();
    Ok((front, back, deck_line))
}

/// Build the pure system+prompt text request and registry id for any [`AIActionRequest`],
/// converting all card HTML to plain text.
pub fn build_action_prompt_with_locale(
    action: &AIActionRequest,
    app_locale: Option<&str>,
) -> CoreResult<PromptBuild> {
    let spec = for_action(action);
    match action {
        AIActionRequest::TestConnection => Ok(PromptBuild {
            prompt_id: spec.versioned_id,
            request: AITextRequest {
                system: Some(spec.system.into()),
                prompt: "Connection check from Bibalak.".into(),
                max_tokens: spec.max_tokens,
                temperature: spec.temperature,
            },
        }),
        AIActionRequest::ExplainCard {
            front_html,
            back_html,
            deck_name,
        }
        | AIActionRequest::TutorExample {
            front_html,
            back_html,
            deck_name,
        }
        | AIActionRequest::TutorMnemonic {
            front_html,
            back_html,
            deck_name,
        } => {
            let (front, back, deck_line) =
                sanitize_card_context(front_html, back_html, deck_name.as_deref())?;
            let lang_rule = language_instruction(&format!("{front}\n{back}"), app_locale);
            Ok(PromptBuild {
                prompt_id: spec.versioned_id,
                request: AITextRequest {
                    system: Some(format!("{} {lang_rule}", spec.system)),
                    prompt: format!("{deck_line}Front:\n{front}\n\nBack:\n{back}"),
                    max_tokens: spec.max_tokens,
                    temperature: spec.temperature,
                },
            })
        }
        AIActionRequest::SuggestBack {
            front_html,
            notetype_name,
            back_field_name,
        } => {
            let front = html_to_plain_text(front_html);
            if front.is_empty() {
                return Err(CoreError::Invalid(
                    "enter the Front field first before asking AI to suggest a Back".into(),
                ));
            }
            let note_line = notetype_name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| format!("Note type: {s}\n"))
                .unwrap_or_default();
            let target = back_field_name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("Back");
            let lang_rule = language_instruction(&front, app_locale);
            Ok(PromptBuild {
                prompt_id: spec.versioned_id,
                request: AITextRequest {
                    system: Some(format!("{} {lang_rule}", spec.system)),
                    prompt: format!("{note_line}Draft the \"{target}\" field for:\n{front}"),
                    max_tokens: spec.max_tokens,
                    temperature: spec.temperature,
                },
            })
        }
        AIActionRequest::RewriteLeech { fields, lapses } => {
            if fields.is_empty() {
                return Err(CoreError::Invalid("note has no fields to rewrite".into()));
            }
            let plain_fields: Vec<(String, String)> = fields
                .iter()
                .map(|f| (f.name.clone(), html_to_plain_text(&f.value_html)))
                .collect();
            if plain_fields.iter().all(|(_, v)| v.is_empty()) {
                return Err(CoreError::Invalid("note fields are empty".into()));
            }
            let lapse_line = lapses
                .map(|n| format!("Lapses so far: {n}\n"))
                .unwrap_or_default();
            let mut body = String::new();
            let mut joined_text = String::new();
            for (i, (name, text)) in plain_fields.iter().enumerate() {
                body.push_str(&format!("[Field {}: {}]\n{}\n\n", i + 1, name, text));
                joined_text.push_str(text);
                joined_text.push('\n');
            }
            let lang_rule = language_instruction(&joined_text, app_locale);
            Ok(PromptBuild {
                prompt_id: spec.versioned_id,
                request: AITextRequest {
                    system: Some(format!(
                        "{} Return exactly {} string(s) inside \"fields\". {lang_rule}",
                        spec.system,
                        plain_fields.len()
                    )),
                    prompt: format!("{lapse_line}{}", body.trim_end()),
                    max_tokens: spec.max_tokens,
                    temperature: spec.temperature,
                },
            })
        }
        AIActionRequest::GenerateCards {
            text,
            note_kind,
            count,
            deck_name,
        } => {
            let clean = html_to_plain_text(text);
            let trimmed = clean.trim();
            if trimmed.is_empty() {
                return Err(CoreError::Invalid(
                    "enter or paste study text first before generating cards".into(),
                ));
            }
            if trimmed.chars().count() > MAX_GENERATE_SOURCE_CHARS {
                return Err(CoreError::Invalid(format!(
                    "source text exceeds the {MAX_GENERATE_SOURCE_CHARS}-character limit"
                )));
            }
            if *count == 0 || *count > MAX_GENERATE_CARDS {
                return Err(CoreError::Invalid(format!(
                    "requested card count must be between 1 and {MAX_GENERATE_CARDS}"
                )));
            }
            let deck_line = deck_name
                .as_deref()
                .map(str::trim)
                .filter(|d| !d.is_empty())
                .map(|d| format!("Deck: {d}\n"))
                .unwrap_or_default();
            let schema_rule = match note_kind {
                GeneratedNoteKind::Basic => {
                    "Return STRICT JSON only in the form {\"cards\":[{\"front\":\"...\",\"back\":\"...\"}]} with up to the requested card count."
                }
                GeneratedNoteKind::Cloze => {
                    "Use Anki cloze deletions with {{c1::...}} syntax. Return STRICT JSON only in the form {\"cards\":[{\"text\":\"... {{c1::...}} ...\"}]} with up to the requested card count."
                }
            };
            let lang_rule = language_instruction(trimmed, app_locale);
            Ok(PromptBuild {
                prompt_id: spec.versioned_id,
                request: AITextRequest {
                    system: Some(format!("{} {schema_rule} {lang_rule}", spec.system)),
                    prompt: format!(
                        "{deck_line}Target cards: at most {count}\n\nStudy notes:\n{trimmed}"
                    ),
                    max_tokens: spec.max_tokens,
                    temperature: spec.temperature,
                },
            })
        }
        AIActionRequest::TutorTranslate {
            front_html,
            back_html,
            deck_name,
        } => {
            let (front, back, deck_line) =
                sanitize_card_context(front_html, back_html, deck_name.as_deref())?;
            let combined = format!("{front}\n{back}");
            let direction_rule = if translate_targets_english(&combined) {
                "Translation direction: Translate from Arabic into English."
            } else {
                "Translation direction: Translate into Arabic."
            };
            Ok(PromptBuild {
                prompt_id: spec.versioned_id,
                request: AITextRequest {
                    system: Some(format!("{} {direction_rule}", spec.system)),
                    prompt: format!("{deck_line}Front:\n{front}\n\nBack:\n{back}"),
                    max_tokens: spec.max_tokens,
                    temperature: spec.temperature,
                },
            })
        }
        AIActionRequest::TutorWhyWrong {
            front_html,
            back_html,
            typed_answer,
            deck_name,
        } => {
            let (front, back, deck_line) =
                sanitize_card_context(front_html, back_html, deck_name.as_deref())?;
            // Learner attempt is plain text (not HTML) — trim only and cap length without stripping `<`/`>`.
            let typed_section = typed_answer
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| {
                    let capped: String = s.chars().take(MAX_TYPED_ANSWER_CHARS).collect();
                    format!("\n\nLearner's typed answer:\n{capped}")
                })
                .unwrap_or_default();
            let lang_input = if typed_section.is_empty() {
                format!("{front}\n{back}")
            } else {
                format!("{front}\n{back}\n{typed_section}")
            };
            let lang_rule = language_instruction(&lang_input, app_locale);
            Ok(PromptBuild {
                prompt_id: spec.versioned_id,
                request: AITextRequest {
                    system: Some(format!("{} {lang_rule}", spec.system)),
                    prompt: format!("{deck_line}Front:\n{front}\n\nBack:\n{back}{typed_section}"),
                    max_tokens: spec.max_tokens,
                    temperature: spec.temperature,
                },
            })
        }
        AIActionRequest::ReviewQuality { notes, deck_name } => {
            if notes.is_empty() {
                return Err(CoreError::Invalid(
                    "select at least one note before reviewing deck quality".into(),
                ));
            }
            if notes.len() > MAX_QUALITY_SCAN_NOTES {
                return Err(CoreError::Invalid(format!(
                    "quality review is limited to at most {MAX_QUALITY_SCAN_NOTES} notes per scan"
                )));
            }
            let deck_line = deck_name
                .as_deref()
                .map(str::trim)
                .filter(|d| !d.is_empty())
                .map(|d| format!("Deck: {d}\n\n"))
                .unwrap_or_default();
            let mut body = String::new();
            let mut joined_text = String::new();
            for note in notes {
                let kind_label = if note.notetype_kind == 1 {
                    "cloze"
                } else {
                    "standard"
                };
                let tags_label = if note.tags.is_empty() {
                    "(none)".to_string()
                } else {
                    note.tags.join(" ")
                };
                body.push_str(&format!(
                    "--- Note {} (type: {kind_label}, lapses: {}, tags: {tags_label}) ---\n",
                    note.note_id, note.lapses
                ));
                for (idx, field) in note.fields.iter().enumerate() {
                    let clean = html_to_plain_text(&field.value_html);
                    joined_text.push_str(&clean);
                    joined_text.push('\n');
                    body.push_str(&format!("[Field {}: {}]\n{}\n", idx + 1, field.name, clean));
                }
                body.push('\n');
            }
            let lang_rule = language_instruction(&joined_text, app_locale);
            let schema_guide = concat!(
                "Allowed finding objects inside \"findings\" (use exact note_id values from above):\n",
                "- {\"note_id\":N,\"kind\":\"unclear\",\"reason\":\"...\"}\n",
                "- {\"note_id\":N,\"kind\":\"overloaded\",\"reason\":\"...\"}\n",
                "- {\"note_id\":N,\"kind\":\"duplicate-meaning\",\"other_note_id\":M,\"reason\":\"...\"}\n",
                "- {\"note_id\":N,\"kind\":\"suggested-tags\",\"tags\":[\"tag1\"],\"reason\":\"...\"} (tags must have no spaces)\n",
                "- {\"note_id\":N,\"kind\":\"rewrite\",\"fields\":[...],\"reason\":\"...\"} (exact field count & order of note N)\n",
                "- {\"note_id\":N,\"kind\":\"cloze-split\",\"clozes\":[\"... {{c1::...}}\",\"... {{c1::...}}\"],\"reason\":\"...\"} (2 to 6 atomic cloze cards)\n",
                "Return {\"findings\":[]} if all notes look clear."
            );
            Ok(PromptBuild {
                prompt_id: spec.versioned_id,
                request: AITextRequest {
                    system: Some(format!("{} {lang_rule}", spec.system)),
                    prompt: format!("{deck_line}{schema_guide}\n\nNotes:\n{}", body.trim_end()),
                    max_tokens: spec.max_tokens,
                    temperature: spec.temperature,
                },
            })
        }
        AIActionRequest::StudyCoach { input } => {
            let prompt = super::coach::format_coach_prompt(input);
            let lang_rule = match app_locale {
                Some("ar") => {
                    "Language rule: Provide summary, advice details, and day focus descriptions in Arabic."
                }
                _ => {
                    "Language rule: Provide summary, advice details, and day focus descriptions in the app language (English)."
                }
            };
            Ok(PromptBuild {
                prompt_id: spec.versioned_id,
                request: AITextRequest {
                    system: Some(format!("{} {lang_rule}", spec.system)),
                    prompt,
                    max_tokens: spec.max_tokens,
                    temperature: spec.temperature,
                },
            })
        }
    }
}

/// Build the pure system+prompt text request for any [`AIActionRequest`], converting all HTML to plain text.
pub fn build_action_prompt(action: &AIActionRequest) -> CoreResult<AITextRequest> {
    Ok(build_action_prompt_with_locale(action, None)?.request)
}

/// Complete an already-built [`PromptBuild`] against `provider` without re-building the prompt.
pub fn execute_built_ai_action(
    provider: &dyn AIProvider,
    action: &AIActionRequest,
    built: &PromptBuild,
) -> CoreResult<AIActionResult> {
    let resp = provider.complete(&built.request)?;
    let (text, suggested_fields, generated_cards, quality_findings, coach_report) =
        parse_action_reply(action, &resp.text)?;
    Ok(AIActionResult {
        prompt_id: built.prompt_id.to_string(),
        text,
        suggested_fields,
        generated_cards,
        quality_findings,
        coach_report,
        input_tokens: resp.input_tokens,
        output_tokens: resp.output_tokens,
    })
}

/// Execute an [`AIActionRequest`] with an explicit `app_locale` hint (`"en"` / `"ar"`).
pub fn execute_ai_action_with_locale(
    provider: &dyn AIProvider,
    action: &AIActionRequest,
    app_locale: Option<&str>,
) -> CoreResult<AIActionResult> {
    let built = build_action_prompt_with_locale(action, app_locale)?;
    execute_built_ai_action(provider, action, &built)
}

/// Execute an [`AIActionRequest`] against a pure [`AIProvider`], attaching `prompt_id` and
/// enforcing structured output validation (`RewriteLeech` JSON).
pub fn execute_ai_action(
    provider: &dyn AIProvider,
    action: &AIActionRequest,
) -> CoreResult<AIActionResult> {
    execute_ai_action_with_locale(provider, action, None)
}
