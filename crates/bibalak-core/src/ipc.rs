//! DTOs that cross the IPC boundary to the frontend. Every type here derives
//! [`ts_rs::TS`] with `#[ts(export)]`, so `cargo test` regenerates the matching
//! TypeScript in `packages/ipc-types/src/generated/`. The Rust definitions are
//! the single source of truth; a mismatch breaks the TS build (intended).
//!
//! 64-bit ids are annotated `#[ts(type = "number")]`: serde serialises them as
//! JSON numbers, and Anki-style ids (epoch-ms, < 2^53) are exact in JS.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{CoreError, CoreResult};
pub use crate::events::CoreEventName;
use crate::model::{Algorithm, Deck};
pub use crate::undo::UndoAction;

/// Basic identity of the running application, surfaced on the home screen and
/// the About page.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
    /// Absolute path to the `collection.media` directory on disk.
    pub media_dir: String,
}

/// Live progress for a running import, emitted periodically on the
/// `bibalak://import-progress` event while notes/cards are merged.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ImportProgress {
    pub done: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum TextImportFormat {
    #[default]
    Auto,
    Csv,
    Markdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum TextImportDelimiter {
    #[default]
    Auto,
    Comma,
    Tab,
    Semicolon,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum DuplicatePolicy {
    #[default]
    Skip,
    Update,
    KeepBoth,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export)]
pub enum TextColumnTarget {
    Ignore,
    Field { ord: usize },
    Tags,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TextImportOptions {
    pub format: TextImportFormat,
    pub delimiter: TextImportDelimiter,
    pub has_header: bool,
    pub allow_html: bool,
}

impl Default for TextImportOptions {
    fn default() -> Self {
        Self {
            format: TextImportFormat::Auto,
            delimiter: TextImportDelimiter::Auto,
            has_header: true,
            allow_html: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TextImportError {
    pub line: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TextImportPreview {
    pub detected_format: TextImportFormat,
    pub detected_delimiter: Option<String>,
    pub has_header: bool,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_rows: u32,
    pub errors: Vec<TextImportError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TextImportMapping {
    #[ts(type = "number")]
    pub deck_id: i64,
    #[ts(type = "number")]
    pub notetype_id: i64,
    pub duplicate_policy: DuplicatePolicy,
    pub columns: Vec<TextColumnTarget>,
    pub default_tags: Vec<String>,
    pub options: TextImportOptions,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TextImportSummary {
    pub notes_added: u32,
    pub notes_updated: u32,
    pub notes_skipped: u32,
    pub cards_added: u32,
    pub errors: Vec<TextImportError>,
}

/// Collection-wide preferences (not per-deck). Currently just the day-rollover
/// hour, mirroring Anki's day cutoff setting.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CollectionPrefs {
    /// Local hour (0-23) at which "today" rolls over. Anki's default is 4am.
    pub rollover_hour: u8,
}

/// Full per-deck scheduling configuration for the options dialog (M14).
/// Replaces the narrow `DeckOptions` (new/rev limits only).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeckConfig {
    #[ts(type = "number")]
    pub deck_id: i64,
    #[ts(type = "number")]
    pub config_id: i64,
    pub algorithm: Algorithm,
    // General limits
    pub new_per_day: u32,
    pub review_per_day: u32,
    // New cards
    pub learning_steps_min: Vec<u32>,
    pub graduating_interval_days: u32,
    pub easy_interval_days: u32,
    pub starting_ease_milli: u32,
    // Reviews
    pub easy_bonus: f64,
    pub hard_interval_factor: f64,
    pub interval_modifier: f64,
    pub maximum_interval_days: u32,
    // Lapses
    pub relearning_steps_min: Vec<u32>,
    pub lapse_interval_factor: f64,
    pub minimum_interval_days: u32,
    pub leech_threshold: u32,
    // FSRS
    pub fsrs_weights: Vec<f64>,
    pub desired_retention: f64,
}

/// Kept for backward-compatibility with study-preview code that only needs limits.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeckOptions {
    #[ts(type = "number")]
    pub deck_id: i64,
    pub new_per_day: u32,
    pub review_per_day: u32,
}

/// A deck as shown in the deck browser / sidebar tree, with due-card counts.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeckSummary {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    #[ts(type = "number | null")]
    pub parent_id: Option<i64>,
    pub new_count: u32,
    pub learning_count: u32,
    pub review_count: u32,
    pub is_filtered: bool,
    #[serde(default)]
    pub collapsed: bool,
}

impl DeckSummary {
    pub fn with_counts(deck: Deck, counts: (u32, u32, u32)) -> Self {
        Self {
            id: deck.id,
            is_filtered: deck.is_filtered,
            name: deck.name,
            parent_id: deck.parent_id,
            new_count: counts.0,
            learning_count: counts.1,
            review_count: counts.2,
            collapsed: deck.collapsed,
        }
    }
}

impl From<Deck> for DeckSummary {
    fn from(deck: Deck) -> Self {
        Self {
            is_filtered: deck.is_filtered,
            id: deck.id,
            name: deck.name,
            parent_id: deck.parent_id,
            new_count: 0,
            learning_count: 0,
            review_count: 0,
            collapsed: deck.collapsed,
        }
    }
}

/// Config for a filtered (custom study) deck — returned for the rebuild dialog.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FilteredDeckConfig {
    #[ts(type = "number")]
    pub deck_id: i64,
    pub name: String,
    pub search: String,
    pub order: u8,
    pub limit: u32,
}

/// A card presented for study: rendered HTML for both sides plus the
/// human-readable next-interval label for each of the four answer buttons.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StudyCardDto {
    #[ts(type = "number")]
    pub card_id: i64,
    #[serde(default)]
    #[ts(type = "number")]
    pub note_id: i64,
    #[ts(type = "number")]
    pub deck_id: i64,
    pub question: String,
    pub answer: String,
    pub again: String,
    pub hard: String,
    pub good: String,
    pub easy: String,
    /// Remaining new cards due today (including this one if new).
    pub new_count: u32,
    /// Remaining learning/relearning cards due now.
    pub learning_count: u32,
    /// Remaining review cards due today.
    pub review_count: u32,
    /// "new" | "learning" | "review" | "relearning"
    pub card_phase: String,
    /// Deck's active scheduling algorithm.
    pub algorithm: Algorithm,
    /// The notetype's custom card CSS, applied scoped to the card face.
    pub css: String,
}

/// Editor text-direction option for a field, stored via Anki's `"rtl"` key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum FieldDirection {
    #[default]
    Auto,
    Rtl,
    Ltr,
}

/// Anki-compatible field editor options (`"rtl"`, `"font"`, `"size"`, `"description"`).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FieldOptions {
    #[serde(default)]
    pub direction: FieldDirection,
    #[serde(default)]
    pub font: String,
    #[serde(default)]
    pub size: u32,
    #[serde(default)]
    pub description: String,
}

/// Parse Anki-compatible field options from `fields.config` JSON.
pub fn parse_field_options(config_json: &str) -> FieldOptions {
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(config_json)
    else {
        return FieldOptions::default();
    };
    let direction = match map.get("rtl") {
        Some(serde_json::Value::Bool(true)) => FieldDirection::Rtl,
        Some(serde_json::Value::Bool(false)) => FieldDirection::Ltr,
        _ => FieldDirection::Auto,
    };
    let font = map
        .get("font")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
    let size = map
        .get("size")
        .and_then(|v| v.as_u64())
        .and_then(|n| u32::try_from(n).ok())
        .unwrap_or(0);
    let description = map
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    FieldOptions {
        direction,
        font,
        size,
        description,
    }
}

/// Update `fields.config` JSON with Anki's `"rtl"`, `"font"`, `"size"`, `"description"` keys,
/// preserving any unrelated keys already present.
pub fn apply_field_options_to_config(config_json: &str, opts: &FieldOptions) -> String {
    let mut map = match serde_json::from_str::<serde_json::Value>(config_json) {
        Ok(serde_json::Value::Object(m)) => m,
        _ => serde_json::Map::new(),
    };
    match opts.direction {
        FieldDirection::Auto => {
            map.remove("rtl");
        }
        FieldDirection::Rtl => {
            map.insert("rtl".into(), serde_json::Value::Bool(true));
        }
        FieldDirection::Ltr => {
            map.insert("rtl".into(), serde_json::Value::Bool(false));
        }
    }
    let font = opts.font.trim();
    if font.is_empty() {
        map.remove("font");
    } else {
        map.insert("font".into(), serde_json::Value::String(font.to_string()));
    }
    if opts.size == 0 {
        map.remove("size");
    } else {
        map.insert("size".into(), serde_json::Value::Number(opts.size.into()));
    }
    if opts.description.trim().is_empty() {
        map.remove("description");
    } else {
        map.insert(
            "description".into(),
            serde_json::Value::String(opts.description.clone()),
        );
    }
    serde_json::Value::Object(map).to_string()
}

/// Parse Anki's `"sortf"` ordinal from `notetypes.config` JSON (defaults to `0`).
pub fn parse_notetype_sort_field(config_json: &str) -> i64 {
    serde_json::from_str::<serde_json::Value>(config_json)
        .ok()
        .and_then(|v| v.get("sortf").and_then(|s| s.as_i64()))
        .unwrap_or(0)
        .max(0)
}

/// Update Anki's `"sortf"` key inside `notetypes.config` JSON, preserving other keys.
pub fn set_notetype_sort_field_in_config(config_json: &str, sort_field: i64) -> String {
    let mut map = match serde_json::from_str::<serde_json::Value>(config_json) {
        Ok(serde_json::Value::Object(m)) => m,
        _ => serde_json::Map::new(),
    };
    map.insert(
        "sortf".into(),
        serde_json::Value::Number(sort_field.max(0).into()),
    );
    serde_json::Value::Object(map).to_string()
}

/// A single note field (name + HTML value + editor options), in note order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NoteField {
    pub name: String,
    pub value: String,
    #[serde(default)]
    pub options: FieldOptions,
}

/// A row in the card/note browser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NoteOverview {
    #[ts(type = "number")]
    pub note_id: i64,
    /// Display value (the note's sort field), may contain HTML.
    pub sort_field: String,
    pub tags: Vec<String>,
}

/// A rich card-level browser row returned by `search_cards`.
/// Carries card scheduling state + note display data so the browser table can
/// show deck, type, due date, flags and tags without a second query.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CardRow {
    #[ts(type = "number")]
    pub card_id: i64,
    #[ts(type = "number")]
    pub note_id: i64,
    /// Plaintext of the note's sort field (HTML stripped).
    pub sort_field: String,
    pub deck: String,
    pub notetype: String,
    pub tags: Vec<String>,
    /// Raw queue value: -3 sibling-buried, -2 buried, -1 suspended, 0 new, 1 learn, 2 review.
    pub queue: i32,
    /// Card type: 0 new, 1 learning, 2 review, 3 relearning.
    pub card_type: i32,
    /// Due value: day number for reviews, epoch-ms for learning, position for new.
    #[ts(type = "number")]
    pub due: i64,
    pub interval: i32,
    pub lapses: i32,
    pub reps: i32,
    pub flags: i32,
}

/// One row per note in the browser's Notes mode, returned by `search_note_rows`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NoteRow {
    #[ts(type = "number")]
    pub note_id: i64,
    #[ts(type = "number[]")]
    pub card_ids: Vec<i64>,
    /// Plaintext of the note's sort field (HTML stripped).
    pub sort_field: String,
    pub notetype: String,
    pub deck: String,
    pub card_count: u32,
    pub tags: Vec<String>,
    #[ts(type = "number")]
    pub mod_ms: i64,
}

/// Preview counts returned before applying Find & Replace to selected notes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FindReplacePreview {
    pub notes_matched: u32,
    pub occurrences: u32,
}

/// A group of notes whose chosen field normalizes to the same key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DuplicateGroup {
    pub normalized: String,
    pub sample_value: String,
    #[ts(type = "number[]")]
    pub note_ids: Vec<i64>,
}

/// A tag name paired with the number of notes carrying it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TagCount {
    pub name: String,
    pub count: u32,
}

/// A note type as shown in the Add Note form — id, name, kind, ordered field names, and note count.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NotetypeSummary {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    /// 0 = standard, 1 = cloze.
    pub kind: i64,
    pub field_names: Vec<String>,
    pub note_count: u32,
}

/// A single field definition as shown in the note-type editor.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FieldSummary {
    pub ord: i64,
    pub name: String,
    #[serde(default)]
    pub options: FieldOptions,
}

/// A card template as shown in the note-type editor (includes format strings).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TemplateSummary {
    pub ord: i64,
    pub name: String,
    pub qfmt: String,
    pub afmt: String,
}

/// Full note-type detail for the note-type editor: fields + templates.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NotetypeDetail {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    /// 0 = standard, 1 = cloze.
    pub kind: i64,
    pub fields: Vec<FieldSummary>,
    pub templates: Vec<TemplateSummary>,
    /// Custom card CSS (`Notetype.config_json.css`), user-editable.
    pub css: String,
    /// 0-based field ordinal displayed in Browse and used for sorting (`"sortf"`).
    #[serde(default)]
    pub sort_field: i64,
}

/// Rendered question + answer HTML for the template preview pane.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RenderedPreview {
    pub question: String,
    pub answer: String,
}

/// Rendered card preview (front/back HTML + scoped note-type CSS) for the browser preview dialog.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CardPreviewDto {
    #[ts(type = "number")]
    pub card_id: i64,
    pub question: String,
    pub answer: String,
    pub css: String,
}

/// Returned by `check_field_remove`: how many existing notes have non-empty
/// content in the field about to be removed and which templates reference it.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FieldRemoveWarning {
    pub notes_with_content: u32,
    pub using_templates: Vec<String>,
}

/// Returned after successfully adding a note.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AddNoteResult {
    #[ts(type = "number")]
    pub note_id: i64,
    pub cards_added: u32,
}

/// One note item passed to `add_notes_batch`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BatchNoteInput {
    pub fields: Vec<String>,
    pub tags: Vec<String>,
}

/// Summary returned after adding multiple notes in a single transaction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AddNotesBatchResult {
    #[ts(type = "number[]")]
    pub note_ids: Vec<i64>,
    pub cards_added: u32,
}

/// Note payload loaded for an AI deck-quality scan (capped at 200 notes).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QualityScanNote {
    #[ts(type = "number")]
    pub note_id: i64,
    #[ts(type = "number")]
    pub deck_id: i64,
    #[ts(type = "number")]
    pub notetype_id: i64,
    pub notetype_kind: u8,
    pub notetype_css: String,
    pub fields: Vec<crate::ai::AIFieldInput>,
    pub tags: Vec<String>,
    pub lapses: u32,
    #[ts(type = "number[]")]
    pub card_ids: Vec<i64>,
}

/// One accepted rewrite/tag edit applied atomically via `apply_quality_fixes`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QualityNoteEdit {
    #[ts(type = "number")]
    pub note_id: i64,
    pub fields: Option<Vec<String>>,
    pub add_tags: Vec<String>,
}

/// Summary returned after applying quality fixes inside one transaction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ApplyQualityFixesResult {
    pub notes_updated: u32,
    #[ts(type = "number[]")]
    pub note_ids: Vec<i64>,
}

/// Full note for the editor: ordered fields + tags + its note type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NoteDetail {
    #[ts(type = "number")]
    pub note_id: i64,
    pub notetype_name: String,
    pub fields: Vec<NoteField>,
    pub tags: Vec<String>,
}

/// A count for one day. For review history `day` is an epoch-day number
/// (ms / 86_400_000); for the forecast it is a day offset from today.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DayCount {
    #[ts(type = "number")]
    pub day: i64,
    pub count: u32,
    #[serde(default)]
    pub date: String,
}

/// One week of true-retention pass rates, split by card phase at review time.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RetentionWeek {
    /// Collection-relative day of the week's first day, divided by 7.
    #[ts(type = "number")]
    pub week_index: i64,
    pub young_total: u32,
    pub young_passed: u32,
    pub mature_total: u32,
    pub mature_passed: u32,
}

/// Counts per answer button (index 0..=3 = Again/Hard/Good/Easy), split by phase.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AnswerButtons {
    pub learning: Vec<u32>,
    pub young: Vec<u32>,
    pub mature: Vec<u32>,
}

/// Reviews grouped by local hour-of-day (0..=23).
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HourlyStat {
    pub hour: u8,
    pub total: u32,
    pub passed: u32,
}

/// FSRS memory-model distributions for cards that have been scheduled by FSRS.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FsrsStats {
    pub card_count: u32,
    /// Stability buckets: <1d, 1-7d, 7-21d, 21-90d, 90-180d, 180-365d, 365d+.
    pub stability_buckets: Vec<u32>,
    /// Difficulty buckets 1..=10.
    pub difficulty_buckets: Vec<u32>,
    /// Mean predicted retrievability across all FSRS cards now, 0-100.
    pub avg_retrievability: Option<f64>,
}

/// Per-deck rollup row for the stats deck breakdown table.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeckStat {
    #[ts(type = "number")]
    pub deck_id: i64,
    pub name: String,
    #[ts(type = "number | null")]
    pub parent_id: Option<i64>,
    pub total_cards: u32,
    pub due_today: u32,
    pub new_count: u32,
    pub learning_count: u32,
    pub young_count: u32,
    pub mature_count: u32,
    pub suspended_count: u32,
    /// True retention over the last 30 days, as a percentage (0-100), or `None`
    /// when no qualifying review answers occurred in range.
    pub retention_pct: Option<f64>,
    pub reviews_7d: u32,
}

/// Aggregate collection statistics for the dashboards.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StatsDto {
    pub today: i32,
    pub today_date: String,
    #[ts(type = "Record<number, string>")]
    pub dates: HashMap<i64, String>,
    pub total_reviews: u32,
    pub studied_days: u32,
    /// True-retention pass rate over the selected range, as a percentage (0–100),
    /// or `None` when no qualifying review answers occurred in range.
    pub retention_pct: Option<f64>,
    /// Target retention for the reference line: the filtered deck's FSRS
    /// `desired_retention` when set, else the default (90%). 0–100.
    pub retention_goal_pct: f64,
    #[ts(type = "number")]
    pub total_time_ms: i64,
    pub new_count: u32,
    pub learning_count: u32,
    pub young_count: u32,
    pub mature_count: u32,
    pub suspended_count: u32,
    /// Reviews per collection-relative day (all time), ascending.
    pub reviews: Vec<DayCount>,
    /// Due review cards per day-offset (0..=30 from today).
    pub forecast: Vec<DayCount>,
    /// Cards already overdue (due < today).
    pub backlog_count: u32,
    /// Anchor for mapping day indices in `reviews`/`forecast` to calendar dates:
    /// collection-day `d` started at `day0_ms + d * 86_400_000`.
    #[ts(type = "number")]
    pub day0_ms: i64,
    pub retention_weekly: Vec<RetentionWeek>,
    pub answer_buttons: AnswerButtons,
    /// Reviews by hour-of-day, shifted to the caller's local timezone.
    pub hourly: Vec<HourlyStat>,
    pub fsrs: FsrsStats,
    /// Always all-decks, regardless of the `deck_id` filter; powers the deck table.
    pub deck_stats: Vec<DeckStat>,
    /// Actionable study-coach summaries computed in Rust (leeches & overdue backlog).
    pub coach: StatsCoachDto,
}

/// Actionable coaching metrics computed in Rust for the Stats screen (no UI math).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StatsCoachDto {
    pub leech_count: u32,
    #[ts(type = "number[]")]
    pub leech_card_ids: Vec<i64>,
    pub leech_weekly_minutes: u32,
    pub overdue_count: u32,
    pub suggested_daily_reviews: u32,
}

/// One simulated day comparing the saved deck options with proposed changes.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorkloadPointDto {
    pub day: u32,
    pub current_reviews: u32,
    pub proposed_reviews: u32,
    pub current_minutes: f64,
    pub proposed_minutes: f64,
}

/// Live comparison curve returned to the FSRS deck options dialog.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorkloadComparisonDto {
    pub days: Vec<WorkloadPointDto>,
    pub total_current_reviews: u32,
    pub total_proposed_reviews: u32,
    pub avg_daily_minutes_current: f64,
    pub avg_daily_minutes_proposed: f64,
}

/// Result of an FSRS weight-optimization run (M20).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FsrsOptimizeResult {
    pub weights: Vec<f64>,
    pub log_loss_before: f64,
    pub log_loss_after: f64,
    pub review_count: usize,
    pub card_count: usize,
}

/// A single backup entry as shown in the maintenance UI.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BackupInfo {
    pub name: String,
    #[ts(type = "number")]
    pub created_ms: i64,
    #[ts(type = "number")]
    pub size_bytes: i64,
}

/// A plugin as shown in the plugin manager UI.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub api_version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    /// Declared capability strings, e.g. `["ui:command", "events:listen"]`.
    pub permissions: Vec<String>,
    pub enabled: bool,
}

/// Sanitized deck summary exposed to plugins holding `read:decks`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginDeckDto {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    #[ts(type = "number | null")]
    pub parent_id: Option<i64>,
    pub new_count: u32,
    pub learning_count: u32,
    pub review_count: u32,
    pub due_today: u32,
    pub is_filtered: bool,
}

/// Plain-text note field exposed to plugins holding `read:notes` (HTML stripped).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginNoteFieldDto {
    pub name: String,
    pub text: String,
}

/// Sanitized note payload exposed to plugins holding `read:notes`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginNoteDto {
    #[ts(type = "number")]
    pub note_id: i64,
    pub deck: String,
    pub notetype: String,
    pub sort_field: String,
    pub tags: Vec<String>,
    pub fields: Vec<PluginNoteFieldDto>,
    pub media_refs: Vec<String>,
}

/// Results of a media consistency scan.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MediaReport {
    /// Files on disk not referenced by any note.
    pub orphan_files: Vec<String>,
    /// Filenames referenced in notes but absent from disk.
    pub missing_files: Vec<String>,
}

/// Broad media category used by the media library UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum MediaKind {
    Image,
    Audio,
    Video,
    Other,
}

/// Single stored file in `collection.media` with byte size, kind, and distinct-note usage count.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MediaLibraryItem {
    pub filename: String,
    #[ts(type = "number")]
    pub size_bytes: u64,
    pub kind: MediaKind,
    pub usage_count: u32,
}

/// Usage filter for `list_media_library`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum MediaUsageFilter {
    #[default]
    All,
    Used,
    Unused,
}

/// Sort order for `list_media_library`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum MediaSort {
    #[default]
    Name,
    SizeDesc,
    UsageDesc,
}

/// Server-side filter & sort options for `list_media_library`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct MediaLibraryFilter {
    /// Browse-syntax query (`deck:"Spanish" tag:verbs`). Empty means all files.
    pub query: String,
    pub kind: Option<MediaKind>,
    pub usage: MediaUsageFilter,
    pub sort: MediaSort,
}

/// Paged slice of stored media files returned to the Media Library screen.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MediaLibraryPage {
    pub items: Vec<MediaLibraryItem>,
    /// Total stored files matching the current search query.
    pub total_count: u32,
    /// Total stored files in the library regardless of search filter.
    pub library_count: u32,
    /// Total stored files with zero references across all notes.
    pub unused_count: u32,
    /// Combined size in bytes of all stored files in the library.
    #[ts(type = "number")]
    pub total_bytes: u64,
}

/// Persisted quick-add window and global shortcut preferences.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QuickAddConfig {
    pub enabled: bool,
    pub shortcut: String,
    #[ts(type = "number | null")]
    pub last_deck_id: Option<i64>,
    #[ts(type = "number | null")]
    pub last_notetype_id: Option<i64>,
}

impl Default for QuickAddConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            shortcut: "Ctrl+Shift+K".into(),
            last_deck_id: None,
            last_notetype_id: None,
        }
    }
}

/// The serialisable error union returned across the IPC boundary. The frontend
/// receives `{ kind, message }` and can branch on `kind`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct IpcError {
    pub kind: IpcErrorKind,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum IpcErrorKind {
    NotOpen,
    Storage,
    Format,
    Scheduler,
    NotFound,
    Invalid,
    Internal,
}

impl From<CoreError> for IpcError {
    fn from(error: CoreError) -> Self {
        let kind = match &error {
            CoreError::NotOpen => IpcErrorKind::NotOpen,
            CoreError::Storage(_) => IpcErrorKind::Storage,
            CoreError::Format(_) => IpcErrorKind::Format,
            CoreError::Scheduler(_) => IpcErrorKind::Scheduler,
            CoreError::NotFound(_) => IpcErrorKind::NotFound,
            CoreError::Invalid(_) => IpcErrorKind::Invalid,
            CoreError::FullSyncRequired { .. } | CoreError::ClockSkewDetected { .. } => {
                IpcErrorKind::Storage
            }
            CoreError::SchemaTooNew { .. } => IpcErrorKind::Format,
            CoreError::Other(_) => IpcErrorKind::Internal,
        };
        Self {
            kind,
            message: error.to_string(),
        }
    }
}

/// Convert an epoch-day number (days since 1970-01-01) to a "YYYY-MM-DD" calendar date string.
pub fn epoch_days_to_date_string(epoch_days: i64) -> String {
    let z = epoch_days + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

/// Maximum relative day offset accepted by `set_due_date` (~100 years).
const MAX_DUE_OFFSET_DAYS: u32 = 36_500;

/// Parse an Anki-style relative due-date specification (`"0"`, `"3"`, `"1-7"`)
/// into inclusive `(min_days, max_days)` offsets from today.
pub fn parse_due_date_spec(spec: &str) -> CoreResult<(u32, u32)> {
    let trimmed = spec.trim();
    if trimmed.is_empty() {
        return Err(CoreError::Invalid("due date specification is empty".into()));
    }
    let (min, max) =
        match trimmed.split_once('-') {
            Some((left, right)) => {
                let min: u32 = left.trim().parse().map_err(|_| {
                    CoreError::Invalid(format!("invalid due date range: {trimmed}"))
                })?;
                let max: u32 = right.trim().parse().map_err(|_| {
                    CoreError::Invalid(format!("invalid due date range: {trimmed}"))
                })?;
                if min > max {
                    return Err(CoreError::Invalid(format!(
                        "due date range start ({min}) exceeds end ({max})"
                    )));
                }
                (min, max)
            }
            None => {
                let days: u32 = trimmed
                    .parse()
                    .map_err(|_| CoreError::Invalid(format!("invalid due date: {trimmed}")))?;
                (days, days)
            }
        };
    if max > MAX_DUE_OFFSET_DAYS {
        return Err(CoreError::Invalid(format!(
            "due date offset exceeds {MAX_DUE_OFFSET_DAYS} days"
        )));
    }
    Ok((min, max))
}

#[cfg(test)]
mod tests {
    use super::parse_due_date_spec;

    #[test]
    fn parse_due_date_spec_accepts_single_days_and_ranges() {
        assert_eq!(parse_due_date_spec("0").unwrap(), (0, 0));
        assert_eq!(parse_due_date_spec(" 3 ").unwrap(), (3, 3));
        assert_eq!(parse_due_date_spec("1-7").unwrap(), (1, 7));
        assert_eq!(parse_due_date_spec(" 2 - 14 ").unwrap(), (2, 14));
        assert_eq!(parse_due_date_spec("36500").unwrap(), (36_500, 36_500));
    }

    #[test]
    fn parse_due_date_spec_rejects_invalid_inputs() {
        assert!(parse_due_date_spec("").is_err());
        assert!(parse_due_date_spec("   ").is_err());
        assert!(parse_due_date_spec("-1").is_err());
        assert!(parse_due_date_spec("7-1").is_err());
        assert!(parse_due_date_spec("abc").is_err());
        assert!(parse_due_date_spec("1-2-3").is_err());
        assert!(parse_due_date_spec("36501").is_err());
    }
}
