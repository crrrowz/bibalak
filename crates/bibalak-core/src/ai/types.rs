//! Pure domain types and provider trait for AI assistance (zero IO/network crates).

use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::CoreResult;

/// A text completion request to an AI provider.
#[derive(Debug, Clone, PartialEq)]
pub struct AITextRequest {
    /// System-level instructions (provider-agnostic).
    pub system: Option<String>,
    /// User prompt / content.
    pub prompt: String,
    /// Maximum tokens to generate. `None` = provider default.
    pub max_tokens: Option<u32>,
    /// Temperature 0.0–2.0. `None` = provider default.
    pub temperature: Option<f32>,
}

/// A text completion response from an AI provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AITextResponse {
    /// Generated text.
    pub text: String,
    /// Token counts, if the provider reports them.
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
}

/// Trait for AI text generation. Implement this to wire in any LLM backend.
///
/// Kept out of `ports.rs` intentionally — AI is an optional capability, not a
/// required port.
pub trait AIProvider: Send + Sync {
    /// Generate a text completion.
    fn complete(&self, request: &AITextRequest) -> CoreResult<AITextResponse>;

    /// A human-readable name for this provider (e.g. `"OpenAI-compatible"`, `"Ollama"`).
    fn name(&self) -> &str;
}

/// Predefined extension-point ids. Plugins declare which they implement;
/// the registry dispatches to the first registered provider for each.
pub mod extension_point {
    /// Generate a hint for a card's front side. Input: front HTML. Output: hint text.
    pub const CARD_HINT: &str = "ai.card_hint";
    /// Suggest content for a note's Back field given its Front. Output: HTML.
    pub const NOTE_FILL_BACK: &str = "ai.note_fill_back";
    /// Summarise a deck's topic from its note content. Output: plain text.
    pub const DECK_SUMMARY: &str = "ai.deck_summary";
}

/// Supported AI backend protocols.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum AIProviderKind {
    #[default]
    OpenAiCompatible,
    Ollama,
}

/// AI provider settings persisted without secrets (`api_key` stays in the OS keyring).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AIConfig {
    pub enabled: bool,
    pub provider: AIProviderKind,
    pub base_url: String,
    pub model: String,
    /// Whether an API key is currently stored in the OS credential store.
    pub has_api_key: bool,
}

impl Default for AIConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: AIProviderKind::OpenAiCompatible,
            base_url: "https://api.openai.com/v1".into(),
            model: "gpt-4o-mini".into(),
            has_api_key: false,
        }
    }
}

/// Input from setup forms to update AI configuration and optionally update/clear the keyring secret.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AISaveConfigInput {
    pub enabled: bool,
    pub provider: AIProviderKind,
    pub base_url: String,
    pub model: String,
    /// `None` leaves any stored key unchanged, `Some("")` deletes it, `Some(val)` stores it.
    pub api_key: Option<String>,
}

impl fmt::Debug for AISaveConfigInput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let key_preview = match self.api_key.as_deref() {
            None => None,
            Some("") => Some(""),
            Some(_) => Some("[REDACTED]"),
        };
        f.debug_struct("AISaveConfigInput")
            .field("enabled", &self.enabled)
            .field("provider", &self.provider)
            .field("base_url", &self.base_url)
            .field("model", &self.model)
            .field("api_key", &key_preview)
            .finish()
    }
}

/// Field name + raw HTML value passed from Browse/Add to build a plain-text AI prompt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AIFieldInput {
    pub name: String,
    pub value_html: String,
}

/// Target note kind when generating flashcard drafts from pasted study text.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum GeneratedNoteKind {
    #[default]
    Basic,
    Cloze,
}

/// One validated draft flashcard returned by `GenerateCards`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export)]
pub enum GeneratedCardDraft {
    Basic { front: String, back: String },
    Cloze { text: String },
}

/// User-triggered AI action. Every action is previewed before an explicit click sends it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export)]
pub enum AIActionRequest {
    TestConnection,
    ExplainCard {
        front_html: String,
        back_html: String,
        deck_name: Option<String>,
    },
    SuggestBack {
        front_html: String,
        notetype_name: Option<String>,
        back_field_name: Option<String>,
    },
    RewriteLeech {
        fields: Vec<AIFieldInput>,
        lapses: Option<u32>,
    },
    GenerateCards {
        text: String,
        note_kind: GeneratedNoteKind,
        count: u32,
        deck_name: Option<String>,
    },
    TutorExample {
        front_html: String,
        back_html: String,
        deck_name: Option<String>,
    },
    TutorMnemonic {
        front_html: String,
        back_html: String,
        deck_name: Option<String>,
    },
    TutorTranslate {
        front_html: String,
        back_html: String,
        deck_name: Option<String>,
    },
    TutorWhyWrong {
        front_html: String,
        back_html: String,
        typed_answer: Option<String>,
        deck_name: Option<String>,
    },
    ReviewQuality {
        notes: Vec<QualityNoteInput>,
        deck_name: Option<String>,
    },
    StudyCoach {
        input: CoachInput,
    },
}

/// Sanitized note metadata + HTML fields submitted to the AI deck quality review.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QualityNoteInput {
    #[ts(type = "number")]
    pub note_id: i64,
    pub notetype_kind: u8,
    pub fields: Vec<AIFieldInput>,
    pub tags: Vec<String>,
    pub lapses: u32,
}

/// One typed quality finding emitted by `review_quality@1`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export)]
pub enum QualityFinding {
    Unclear {
        #[ts(type = "number")]
        note_id: i64,
        reason: String,
    },
    Overloaded {
        #[ts(type = "number")]
        note_id: i64,
        reason: String,
    },
    DuplicateMeaning {
        #[ts(type = "number")]
        note_id: i64,
        #[ts(type = "number")]
        other_note_id: i64,
        reason: String,
    },
    SuggestedTags {
        #[ts(type = "number")]
        note_id: i64,
        tags: Vec<String>,
        reason: String,
    },
    Rewrite {
        #[ts(type = "number")]
        note_id: i64,
        fields: Vec<String>,
        reason: String,
    },
    ClozeSplit {
        #[ts(type = "number")]
        note_id: i64,
        clozes: Vec<String>,
        reason: String,
    },
}

/// Rollup summary of one deck for the AI study coach input.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CoachDeckSummary {
    #[ts(type = "number")]
    pub deck_id: i64,
    pub name: String,
    pub due_today: u32,
    pub retention_pct: f64,
}

/// Statistics payload submitted to the AI study coach (numbers and deck names only, zero card text).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CoachInput {
    pub selected_deck: Option<String>,
    #[ts(type = "number | null")]
    pub selected_deck_id: Option<i64>,
    pub reviews_30d: u32,
    pub retention_pct: f64,
    pub retention_goal_pct: f64,
    pub backlog_count: u32,
    pub forecast_7d: u32,
    pub forecast_30d: u32,
    pub studied_days: u32,
    pub avg_minutes_per_day: f64,
    pub leech_count: u32,
    pub peak_hours: Vec<u8>,
    pub top_decks: Vec<CoachDeckSummary>,
}

/// One actionable piece of study advice returned by `study_coach@1`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CoachAdviceItem {
    pub title: String,
    pub detail: String,
    #[serde(default)]
    #[ts(type = "number | null")]
    pub deck_id: Option<i64>,
}

/// One day of the 7-day study plan returned by `study_coach@1`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CoachPlanDay {
    pub day: u8,
    pub reviews: u32,
    pub new_cards: u32,
    pub focus: String,
}

/// Structured coach report returned by `study_coach@1`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CoachReport {
    pub summary: String,
    pub advice: Vec<CoachAdviceItem>,
    pub plan: Vec<CoachPlanDay>,
}

/// Exact plain-text payload displayed to the user before sending anything over the network.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AIPreviewPayload {
    pub provider: AIProviderKind,
    pub endpoint_origin: String,
    pub model: String,
    pub system: String,
    pub prompt: String,
}

/// Result returned by an explicit AI request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AIActionResult {
    pub prompt_id: String,
    pub text: String,
    pub suggested_fields: Option<Vec<String>>,
    #[serde(default)]
    pub generated_cards: Option<Vec<GeneratedCardDraft>>,
    #[serde(default)]
    pub quality_findings: Option<Vec<QualityFinding>>,
    #[serde(default)]
    #[ts(optional)]
    pub coach_report: Option<CoachReport>,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_save_config_input_debug_redacts_api_key() {
        let input = AISaveConfigInput {
            enabled: true,
            provider: AIProviderKind::OpenAiCompatible,
            base_url: "https://api.openai.com/v1".into(),
            model: "gpt-4o-mini".into(),
            api_key: Some("sk-super-secret-token".into()),
        };
        let formatted = format!("{input:?}");
        assert!(!formatted.contains("sk-super-secret-token"));
        assert!(formatted.contains("[REDACTED]"));
    }
}
