//! Pure-core note-type preset engine, strict stock detector, and template linter.
//!
//! Zero OS, SQLite, Tauri, or UI dependencies (`ADR-030`).

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{CoreError, CoreResult};
use crate::ipc::{FieldDirection, FieldSummary, TemplateSummary};

/// Stable key inside `notetypes.config` JSON (`D47` #1, `AGENTS.md` stable ids).
pub const KEEPSAKE_PRESET_CONFIG_KEY: &str = "keepsakePreset";

/// Current `NotetypePreset` schema version.
pub const PRESET_VERSION: u32 = 1;

/// Modern-editorial default card CSS shared with stock seeding (`stock.rs`).
pub const DEFAULT_CARD_CSS: &str = r#".card {
  font-family: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
  font-size: 1.25rem;
  line-height: 1.65;
  letter-spacing: -0.01em;
  padding: 2.5rem 2rem;
}

.card b,
.card strong {
  font-weight: 650;
}

.card hr#answer {
  width: 4rem;
  height: 1px;
  margin: 1.75rem auto;
  border: none;
  background: linear-gradient(to right, transparent, hsl(var(--border)), transparent);
}

.card .cloze {
  font-family: "Figtree Variable", ui-sans-serif, system-ui, sans-serif;
  font-weight: 600;
  letter-spacing: 0;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.08);
  padding: 0.05em 0.35em;
  border-radius: 0.375rem;
}

.card.night_mode .cloze,
.card.nightMode .cloze {
  background: hsl(var(--primary) / 0.16);
}

.card img {
  border-radius: 0.5rem;
  box-shadow:
    0 1px 3px hsl(var(--foreground) / 0.12),
    0 1px 2px hsl(var(--foreground) / 0.08);
}

.card .keepsake-extra {
  font-family: "Figtree Variable", ui-sans-serif, system-ui, sans-serif;
  font-size: 0.95rem;
  color: hsl(var(--muted-foreground));
  margin-top: 1.25rem;
}

.card .keepsake-io-wrap {
  position: relative;
  display: inline-block;
}
"#;

const ANKI_STOCK_CARD_CSS: &str = ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum EditorMode {
    #[default]
    Simple,
    Advanced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum LayoutId {
    #[default]
    Basic,
    BasicReversed,
    Cloze,
    TypeIn,
    AudioText,
    ImageText,
    LanguageCard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum StylePresetId {
    #[default]
    PaperEditorial,
    CleanSans,
    LibraryScholar,
    CompactStudy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum StyleFont {
    #[default]
    Default,
    CleanSans,
    ClassicSerif,
    Monospace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum StyleSize {
    Sm,
    #[default]
    Md,
    Lg,
    Xl,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum StyleAlign {
    #[default]
    Auto,
    Center,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum StyleAccent {
    #[default]
    Theme,
    Terracotta,
    Forest,
    Navy,
    HighContrast,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum StyleSurface {
    #[default]
    Theme,
    SoftPaper,
    Bordered,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum StyleDivider {
    #[default]
    Hairline,
    AccentBar,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PresetOptions {
    #[serde(default)]
    pub include_reverse: bool,
    #[serde(default)]
    pub use_furigana: bool,
    #[serde(default)]
    pub show_transcript_on_front: bool,
    #[serde(default)]
    pub tts_fallback: bool,
    #[serde(default)]
    pub tts_lang: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StyleOptions {
    #[serde(default)]
    pub preset: StylePresetId,
    #[serde(default)]
    pub font: StyleFont,
    #[serde(default)]
    pub size: StyleSize,
    #[serde(default)]
    pub align: StyleAlign,
    #[serde(default)]
    pub accent: StyleAccent,
    #[serde(default)]
    pub surface: StyleSurface,
    #[serde(default)]
    pub divider: StyleDivider,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NotetypePreset {
    #[serde(default = "default_preset_version")]
    pub version: u32,
    #[serde(default)]
    pub mode: EditorMode,
    pub layout: LayoutId,
    #[serde(default)]
    #[ts(type = "Record<string, string>")]
    pub slots: BTreeMap<String, String>,
    #[serde(default)]
    pub options: PresetOptions,
    #[serde(default)]
    pub style: StyleOptions,
    #[serde(default)]
    pub compiled_digest: Option<String>,
}

fn default_preset_version() -> u32 {
    PRESET_VERSION
}

impl NotetypePreset {
    /// Default preset for a newly created note type of `layout`.
    /// New note types default to `StyleAlign::Auto` (`D47` #4).
    pub fn for_layout(layout: LayoutId) -> Self {
        let mut slots = BTreeMap::new();
        for spec in layout_slots(layout) {
            if spec.required {
                slots.insert(spec.id.to_string(), spec.default_field.to_string());
            }
        }
        Self {
            version: PRESET_VERSION,
            mode: EditorMode::Simple,
            layout,
            slots,
            options: PresetOptions::default(),
            style: StyleOptions::default(),
            compiled_digest: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SlotSpec {
    pub id: &'static str,
    pub required: bool,
    pub default_field: &'static str,
}

/// Ordered slot definitions for each built-in layout.
pub fn layout_slots(layout: LayoutId) -> &'static [SlotSpec] {
    match layout {
        LayoutId::Basic => &[
            SlotSpec {
                id: "front",
                required: true,
                default_field: "Front",
            },
            SlotSpec {
                id: "back",
                required: true,
                default_field: "Back",
            },
            SlotSpec {
                id: "hint",
                required: false,
                default_field: "Hint",
            },
            SlotSpec {
                id: "extra",
                required: false,
                default_field: "Extra",
            },
        ],
        LayoutId::BasicReversed => &[
            SlotSpec {
                id: "front",
                required: true,
                default_field: "Front",
            },
            SlotSpec {
                id: "back",
                required: true,
                default_field: "Back",
            },
            SlotSpec {
                id: "reverseGate",
                required: false,
                default_field: "Add Reverse",
            },
            SlotSpec {
                id: "extra",
                required: false,
                default_field: "Extra",
            },
        ],
        LayoutId::Cloze => &[
            SlotSpec {
                id: "text",
                required: true,
                default_field: "Text",
            },
            SlotSpec {
                id: "hint",
                required: false,
                default_field: "Hint",
            },
            SlotSpec {
                id: "extra",
                required: false,
                default_field: "Extra",
            },
        ],
        LayoutId::TypeIn => &[
            SlotSpec {
                id: "prompt",
                required: true,
                default_field: "Front",
            },
            SlotSpec {
                id: "typed",
                required: true,
                default_field: "Back",
            },
            SlotSpec {
                id: "hint",
                required: false,
                default_field: "Hint",
            },
            SlotSpec {
                id: "extra",
                required: false,
                default_field: "Extra",
            },
        ],
        LayoutId::AudioText => &[
            SlotSpec {
                id: "audio",
                required: true,
                default_field: "Audio",
            },
            SlotSpec {
                id: "meaning",
                required: true,
                default_field: "Meaning",
            },
            SlotSpec {
                id: "transcript",
                required: false,
                default_field: "Transcript",
            },
            SlotSpec {
                id: "extra",
                required: false,
                default_field: "Notes",
            },
        ],
        LayoutId::ImageText => &[
            SlotSpec {
                id: "image",
                required: true,
                default_field: "Image",
            },
            SlotSpec {
                id: "answer",
                required: true,
                default_field: "Label",
            },
            SlotSpec {
                id: "prompt",
                required: false,
                default_field: "Prompt",
            },
            SlotSpec {
                id: "extra",
                required: false,
                default_field: "Notes",
            },
        ],
        LayoutId::LanguageCard => &[
            SlotSpec {
                id: "word",
                required: true,
                default_field: "Word",
            },
            SlotSpec {
                id: "meaning",
                required: true,
                default_field: "Meaning",
            },
            SlotSpec {
                id: "reading",
                required: false,
                default_field: "Reading",
            },
            SlotSpec {
                id: "ipa",
                required: false,
                default_field: "IPA",
            },
            SlotSpec {
                id: "audio",
                required: false,
                default_field: "Audio",
            },
            SlotSpec {
                id: "example",
                required: false,
                default_field: "Example",
            },
            SlotSpec {
                id: "notes",
                required: false,
                default_field: "Notes",
            },
        ],
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CompiledTemplate {
    pub name: String,
    pub qfmt: String,
    pub afmt: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CompiledNotetype {
    pub kind: i64,
    pub templates: Vec<CompiledTemplate>,
    pub css: String,
    pub compiled_digest: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum LintSeverity {
    Warning,
    Hint,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TemplateLintHint {
    pub severity: LintSeverity,
    pub code: String,
    pub message: String,
    #[ts(type = "number | null")]
    pub template_ord: Option<i64>,
    pub field_name: Option<String>,
}

fn dir_attr(field_name: &str, fields: &[FieldSummary]) -> &'static str {
    match fields
        .iter()
        .find(|f| f.name == field_name)
        .map(|f| f.options.direction)
    {
        Some(FieldDirection::Ltr) => "ltr",
        Some(FieldDirection::Rtl) => "rtl",
        _ => "auto",
    }
}

fn validate_slot_field_name(name: &str) -> CoreResult<()> {
    if name.contains([':', '{', '}', '"']) || name.starts_with(['#', '^', '/']) {
        return Err(CoreError::Invalid(format!(
            "slot field name {name:?} contains invalid template syntax"
        )));
    }
    Ok(())
}

fn resolve_slots<'a>(
    preset: &'a NotetypePreset,
    fields: &[FieldSummary],
) -> CoreResult<BTreeMap<&'static str, &'a str>> {
    let specs = layout_slots(preset.layout);
    let known_fields: HashSet<&str> = fields.iter().map(|f| f.name.as_str()).collect();
    let valid_slot_ids: HashSet<&str> = specs.iter().map(|s| s.id).collect();

    for slot_id in preset.slots.keys() {
        if !valid_slot_ids.contains(slot_id.as_str()) {
            return Err(CoreError::Invalid(format!(
                "unknown slot {slot_id:?} for layout {:?}",
                preset.layout
            )));
        }
    }

    let mut resolved = BTreeMap::new();
    let mut used_fields = HashSet::new();

    for spec in specs {
        let mapped = preset
            .slots
            .get(spec.id)
            .map(String::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty());

        match mapped {
            Some(field_name) => {
                validate_slot_field_name(field_name)?;
                if !known_fields.contains(field_name) {
                    return Err(CoreError::Invalid(format!(
                        "slot {:?} maps to unknown field {field_name:?}",
                        spec.id
                    )));
                }
                if !used_fields.insert(field_name) {
                    return Err(CoreError::Invalid(format!(
                        "field {field_name:?} cannot be mapped to multiple slots"
                    )));
                }
                resolved.insert(spec.id, field_name);
            }
            None if spec.required => {
                return Err(CoreError::Invalid(format!(
                    "required slot {:?} is not mapped",
                    spec.id
                )));
            }
            None => {}
        }
    }

    Ok(resolved)
}

fn slot_block(class: &str, field: &str, fields: &[FieldSummary]) -> String {
    let dir = dir_attr(field, fields);
    format!(r#"<div dir="{dir}" class="{class}">{{{{{field}}}}}</div>"#)
}

fn conditional_slot_block(class: &str, field: &str, fields: &[FieldSummary]) -> String {
    let inner = slot_block(class, field, fields);
    format!("{{{{#{field}}}}}{inner}{{{{/{field}}}}}")
}

fn sanitize_tts_lang(raw: Option<&str>) -> String {
    let cleaned: String = raw
        .unwrap_or("en_US")
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    if cleaned.is_empty() {
        "en_US".to_string()
    } else {
        cleaned
    }
}

/// Deterministically compile a `NotetypePreset` against `fields` into standard
/// Anki templates, `.card` CSS, and a SHA-256 `compiled_digest`.
pub fn compile_preset(
    preset: &NotetypePreset,
    fields: &[FieldSummary],
) -> CoreResult<CompiledNotetype> {
    if preset.version != PRESET_VERSION {
        return Err(CoreError::Invalid(format!(
            "unsupported preset version {}",
            preset.version
        )));
    }
    let slots = resolve_slots(preset, fields)?;

    let (kind, templates) = match preset.layout {
        LayoutId::Basic => {
            let front = slots["front"];
            let back = slots["back"];
            let mut qfmt = slot_block("keepsake-front", front, fields);
            if let Some(hint) = slots.get("hint") {
                let dir = dir_attr(hint, fields);
                qfmt.push_str(&format!(
                    r#"{{{{#{hint}}}}}<div dir="{dir}" class="keepsake-hint">{{{{hint:{hint}}}}}</div>{{{{/{hint}}}}}"#
                ));
            }
            let mut afmt = format!(
                r#"{{{{FrontSide}}}}<hr id="answer">{}"#,
                slot_block("keepsake-back", back, fields)
            );
            if let Some(extra) = slots.get("extra") {
                afmt.push_str(&conditional_slot_block("keepsake-extra", extra, fields));
            }
            (
                0,
                vec![CompiledTemplate {
                    name: "Card 1".to_string(),
                    qfmt,
                    afmt,
                }],
            )
        }
        LayoutId::BasicReversed => {
            let front = slots["front"];
            let back = slots["back"];
            let extra_html = slots
                .get("extra")
                .map(|e| conditional_slot_block("keepsake-extra", e, fields))
                .unwrap_or_default();
            let c1 = CompiledTemplate {
                name: "Card 1".to_string(),
                qfmt: slot_block("keepsake-front", front, fields),
                afmt: format!(
                    r#"{{{{FrontSide}}}}<hr id="answer">{}{extra_html}"#,
                    slot_block("keepsake-back", back, fields)
                ),
            };
            let back_front = slot_block("keepsake-front", back, fields);
            let c2_qfmt = match slots.get("reverseGate") {
                Some(gate) => format!("{{{{#{gate}}}}}{back_front}{{{{/{gate}}}}}"),
                None => back_front,
            };
            let c2 = CompiledTemplate {
                name: "Card 2".to_string(),
                qfmt: c2_qfmt,
                afmt: format!(
                    r#"{{{{FrontSide}}}}<hr id="answer">{}{extra_html}"#,
                    slot_block("keepsake-back", front, fields)
                ),
            };
            (0, vec![c1, c2])
        }
        LayoutId::Cloze => {
            let text = slots["text"];
            let text_dir = dir_attr(text, fields);
            let cloze_block = format!(
                r#"<div dir="{text_dir}" class="keepsake-cloze-text">{{{{cloze:{text}}}}}</div>"#
            );
            let mut qfmt = cloze_block.clone();
            if let Some(hint) = slots.get("hint") {
                let dir = dir_attr(hint, fields);
                qfmt.push_str(&format!(
                    r#"{{{{#{hint}}}}}<div dir="{dir}" class="keepsake-hint">{{{{hint:{hint}}}}}</div>{{{{/{hint}}}}}"#
                ));
            }
            let mut afmt = format!(r#"{cloze_block}<hr id="answer">"#);
            if let Some(extra) = slots.get("extra") {
                afmt.push_str(&conditional_slot_block("keepsake-extra", extra, fields));
            }
            (
                1,
                vec![CompiledTemplate {
                    name: "Cloze".to_string(),
                    qfmt,
                    afmt,
                }],
            )
        }
        LayoutId::TypeIn => {
            let prompt = slots["prompt"];
            let typed = slots["typed"];
            let typed_dir = dir_attr(typed, fields);
            let mut qfmt = format!(
                r#"{}<div dir="{typed_dir}" class="keepsake-type">{{{{type:{typed}}}}}</div>"#,
                slot_block("keepsake-front", prompt, fields)
            );
            if let Some(hint) = slots.get("hint") {
                let dir = dir_attr(hint, fields);
                qfmt.push_str(&format!(
                    r#"{{{{#{hint}}}}}<div dir="{dir}" class="keepsake-hint">{{{{hint:{hint}}}}}</div>{{{{/{hint}}}}}"#
                ));
            }
            let mut afmt = format!(
                r#"{{{{FrontSide}}}}<hr id="answer"><div dir="{typed_dir}" class="keepsake-type">{{{{type:{typed}}}}}</div>"#
            );
            if let Some(extra) = slots.get("extra") {
                afmt.push_str(&conditional_slot_block("keepsake-extra", extra, fields));
            }
            (
                0,
                vec![CompiledTemplate {
                    name: "Card 1".to_string(),
                    qfmt,
                    afmt,
                }],
            )
        }
        LayoutId::AudioText => {
            let audio = slots["audio"];
            let meaning = slots["meaning"];
            let mut qfmt = format!(r#"<div class="keepsake-audio">{{{{{audio}}}}}</div>"#);
            if let Some(transcript) = slots.get("transcript") {
                if preset.options.tts_fallback {
                    let lang = sanitize_tts_lang(preset.options.tts_lang.as_deref());
                    qfmt.push_str(&format!(
                        r#"{{{{^{audio}}}}}<div class="keepsake-tts">{{{{tts {lang}:{transcript}}}}}</div>{{{{/{audio}}}}}"#
                    ));
                }
                if preset.options.show_transcript_on_front {
                    qfmt.push_str(&conditional_slot_block(
                        "keepsake-transcript",
                        transcript,
                        fields,
                    ));
                }
            }
            let mut afmt = r#"{{FrontSide}}<hr id="answer">"#.to_string();
            if let Some(transcript) = slots.get("transcript") {
                if !preset.options.show_transcript_on_front {
                    afmt.push_str(&conditional_slot_block(
                        "keepsake-transcript",
                        transcript,
                        fields,
                    ));
                }
            }
            afmt.push_str(&slot_block("keepsake-back", meaning, fields));
            if let Some(extra) = slots.get("extra") {
                afmt.push_str(&conditional_slot_block("keepsake-extra", extra, fields));
            }
            (
                0,
                vec![CompiledTemplate {
                    name: "Card 1".to_string(),
                    qfmt,
                    afmt,
                }],
            )
        }
        LayoutId::ImageText => {
            let image = slots["image"];
            let answer = slots["answer"];
            let mut qfmt = format!(r#"<div class="keepsake-image">{{{{{image}}}}}</div>"#);
            if let Some(prompt) = slots.get("prompt") {
                qfmt.push_str(&conditional_slot_block("keepsake-front", prompt, fields));
            }
            let mut afmt = format!(
                r#"{{{{FrontSide}}}}<hr id="answer">{}"#,
                slot_block("keepsake-back", answer, fields)
            );
            if let Some(extra) = slots.get("extra") {
                afmt.push_str(&conditional_slot_block("keepsake-extra", extra, fields));
            }
            (
                0,
                vec![CompiledTemplate {
                    name: "Card 1".to_string(),
                    qfmt,
                    afmt,
                }],
            )
        }
        LayoutId::LanguageCard => {
            let word = slots["word"];
            let meaning = slots["meaning"];

            let mut reading_html = String::new();
            if let Some(reading) = slots.get("reading") {
                let dir = dir_attr(reading, fields);
                let token = if preset.options.use_furigana {
                    format!("{{{{furigana:{reading}}}}}")
                } else {
                    format!("{{{{{reading}}}}}")
                };
                reading_html = format!(
                    r#"{{{{#{reading}}}}}<div dir="{dir}" class="keepsake-reading">{token}</div>{{{{/{reading}}}}}"#
                );
            }
            let ipa_html = slots
                .get("ipa")
                .map(|ipa| conditional_slot_block("keepsake-ipa", ipa, fields))
                .unwrap_or_default();
            let audio_html = slots
                .get("audio")
                .map(|a| {
                    format!(
                        r#"{{{{#{a}}}}}<div class="keepsake-audio">{{{{{a}}}}}</div>{{{{/{a}}}}}"#
                    )
                })
                .unwrap_or_default();
            let example_html = slots
                .get("example")
                .map(|ex| {
                    let dir = dir_attr(ex, fields);
                    format!(
                        r#"{{{{#{ex}}}}}<blockquote dir="{dir}" class="keepsake-example">{{{{{ex}}}}}</blockquote>{{{{/{ex}}}}}"#
                    )
                })
                .unwrap_or_default();
            let notes_html = slots
                .get("notes")
                .map(|n| conditional_slot_block("keepsake-extra", n, fields))
                .unwrap_or_default();

            let c1 = CompiledTemplate {
                name: "Card 1".to_string(),
                qfmt: format!(
                    "{}{reading_html}{ipa_html}{audio_html}",
                    slot_block("keepsake-word", word, fields)
                ),
                afmt: format!(
                    r#"{{{{FrontSide}}}}<hr id="answer">{}{example_html}{notes_html}"#,
                    slot_block("keepsake-back", meaning, fields)
                ),
            };
            let mut templates = vec![c1];
            if preset.options.include_reverse {
                templates.push(CompiledTemplate {
                    name: "Card 2".to_string(),
                    qfmt: slot_block("keepsake-front", meaning, fields),
                    afmt: format!(
                        r#"{{{{FrontSide}}}}<hr id="answer">{}{reading_html}{ipa_html}{audio_html}{example_html}{notes_html}"#,
                        slot_block("keepsake-word", word, fields)
                    ),
                });
            }
            (0, templates)
        }
    };

    let css = compile_style_css(&preset.style);
    let compiled_digest = compute_compiled_digest(&templates, &css);

    Ok(CompiledNotetype {
        kind,
        templates,
        css,
        compiled_digest,
    })
}

fn compile_style_css(style: &StyleOptions) -> String {
    let font_family = match style.font {
        StyleFont::Default => match style.preset {
            StylePresetId::PaperEditorial | StylePresetId::LibraryScholar => {
                r#"ui-serif, Georgia, Cambria, "Times New Roman", Times, serif"#
            }
            StylePresetId::CleanSans | StylePresetId::CompactStudy => {
                r#""Figtree Variable", "IBM Plex Sans Arabic", ui-sans-serif, system-ui, sans-serif"#
            }
        },
        StyleFont::CleanSans => {
            r#""Figtree Variable", "IBM Plex Sans Arabic", ui-sans-serif, system-ui, sans-serif"#
        }
        StyleFont::ClassicSerif => r#"ui-serif, Georgia, Cambria, "Times New Roman", Times, serif"#,
        StyleFont::Monospace => {
            r#"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"#
        }
    };

    let font_size = match style.size {
        StyleSize::Sm => "1rem",
        StyleSize::Md => "1.25rem",
        StyleSize::Lg => "1.5rem",
        StyleSize::Xl => "1.85rem",
    };

    let line_height = match style.preset {
        StylePresetId::CompactStudy => "1.5",
        StylePresetId::LibraryScholar => "1.7",
        StylePresetId::PaperEditorial | StylePresetId::CleanSans => "1.65",
    };

    let padding = match style.preset {
        StylePresetId::CompactStudy => "1.25rem 1.25rem",
        StylePresetId::CleanSans => "2.25rem 1.75rem",
        StylePresetId::LibraryScholar => "2.5rem 2rem",
        StylePresetId::PaperEditorial => "2.5rem 2rem",
    };

    let max_width_rule = match style.preset {
        StylePresetId::LibraryScholar => "\n  max-width: 38rem;\n  margin-inline: auto;",
        _ => "",
    };

    let text_align = match style.align {
        StyleAlign::Auto => "start",
        StyleAlign::Center => "center",
    };

    let (accent_light, accent_dark) = match style.accent {
        StyleAccent::Theme => ("hsl(var(--primary))", "hsl(var(--primary))"),
        StyleAccent::Terracotta => ("#b5492e", "#e07a5f"),
        StyleAccent::Forest => ("#2d6a4f", "#52b788"),
        StyleAccent::Navy => ("#1d3557", "#7ea8be"),
        StyleAccent::HighContrast => ("hsl(var(--foreground))", "hsl(var(--foreground))"),
    };

    let (surface_rules, surface_night_rules) = match style.surface {
        StyleSurface::Theme => (
            "background: hsl(var(--card));\n  color: hsl(var(--card-foreground));",
            "",
        ),
        StyleSurface::SoftPaper => (
            "background: #faf7f2;\n  color: #1f1d1a;",
            "\n.card.night_mode,\n.card.nightMode {\n  background: #1c1a17;\n  color: #f2ede4;\n}\n",
        ),
        StyleSurface::Bordered => (
            "background: hsl(var(--card));\n  color: hsl(var(--card-foreground));\n  border: 1px solid hsl(var(--border));\n  border-radius: 0.75rem;",
            "",
        ),
    };

    let divider_margin = match style.align {
        StyleAlign::Auto => "1.5rem 0",
        StyleAlign::Center => "1.5rem auto",
    };

    let divider_css = match style.divider {
        StyleDivider::Hairline => format!(
            "width: 4rem;\n  height: 1px;\n  margin: {divider_margin};\n  border: none;\n  background: linear-gradient(to right, transparent, hsl(var(--border)), transparent);"
        ),
        StyleDivider::AccentBar => format!(
            "width: 3rem;\n  height: 2px;\n  margin: {divider_margin};\n  border: none;\n  border-radius: 9999px;\n  background: var(--card-accent);"
        ),
        StyleDivider::None => "display: none;".to_string(),
    };

    format!(
        r#".card {{
  --card-accent: {accent_light};
  font-family: {font_family};
  font-size: {font_size};
  line-height: {line_height};
  text-align: {text_align};
  padding: {padding};{max_width_rule}
  {surface_rules}
}}

.card.night_mode,
.card.nightMode {{
  --card-accent: {accent_dark};
}}{surface_night_rules}

.card b,
.card strong {{
  font-weight: 650;
}}

.card hr#answer {{
  {divider_css}
}}

.card .cloze {{
  font-family: "Figtree Variable", ui-sans-serif, system-ui, sans-serif;
  font-weight: 600;
  color: var(--card-accent);
  background: hsl(var(--primary) / 0.08);
  padding: 0.05em 0.35em;
  border-radius: 0.375rem;
}}

.card.night_mode .cloze,
.card.nightMode .cloze {{
  background: hsl(var(--primary) / 0.16);
}}

.card img {{
  max-width: 100%;
  border-radius: 0.5rem;
  box-shadow:
    0 1px 3px hsl(var(--foreground) / 0.12),
    0 1px 2px hsl(var(--foreground) / 0.08);
}}

.card .keepsake-word {{
  font-size: 1.5em;
  font-weight: 650;
}}

.card .keepsake-reading {{
  font-size: 0.9em;
  color: hsl(var(--muted-foreground));
  margin-top: 0.25rem;
}}

.card .keepsake-ipa {{
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.85em;
  color: var(--card-accent);
  margin-top: 0.25rem;
}}

.card .keepsake-example {{
  margin-top: 1rem;
  margin-inline: 0;
  padding-inline-start: 0.85rem;
  border-inline-start: 2px solid var(--card-accent);
  color: hsl(var(--muted-foreground));
}}

.card .keepsake-extra,
.card .keepsake-transcript,
.card .keepsake-hint {{
  font-family: "Figtree Variable", ui-sans-serif, system-ui, sans-serif;
  font-size: 0.85em;
  color: hsl(var(--muted-foreground));
  margin-top: 1rem;
}}
"#
    )
}

/// Deterministic SHA-256 hex digest over compiled templates and CSS.
pub fn compute_compiled_digest(templates: &[CompiledTemplate], css: &str) -> String {
    let mut buf = Vec::new();
    let push_str = |b: &mut Vec<u8>, s: &str| {
        b.extend_from_slice(&(s.len() as u64).to_le_bytes());
        b.extend_from_slice(s.as_bytes());
    };
    buf.extend_from_slice(&(templates.len() as u64).to_le_bytes());
    for t in templates {
        push_str(&mut buf, &t.name);
        push_str(&mut buf, &t.qfmt);
        push_str(&mut buf, &t.afmt);
    }
    push_str(&mut buf, css);
    sha256_hex(&buf)
}

/// Pure-Rust FIPS 180-4 SHA-256 returning lowercase hex.
fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut padded = data.to_vec();
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.as_chunks::<64>().0 {
        let mut w = [0u32; 64];
        for (i, word) in w.iter_mut().take(16).enumerate() {
            *word = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = String::with_capacity(64);
    for word in h {
        use std::fmt::Write;
        let _ = write!(&mut out, "{word:08x}");
    }
    out
}

fn normalize_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_template_ws(s: &str) -> String {
    let collapsed = normalize_ws(s);
    // Treat Anki's unquoted <hr id=answer> and <hr id="answer"> identically, and
    // ignore purely layout whitespace immediately next to tag/mustache delimiters.
    let collapsed = collapsed.replace("<hr id=answer>", "<hr id=\"answer\">");
    collapsed
        .replace("> <", "><")
        .replace("} <", "}<")
        .replace("> {", ">{")
}

pub fn is_image_occlusion_config(config_json: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(config_json)
        .ok()
        .and_then(|v| {
            v.get("kind")
                .or_else(|| v.pointer("/extra_config/kind"))
                .and_then(|k| k.as_str())
                .map(|k| k == "image-occlusion")
        })
        .unwrap_or(false)
}

/// Strict whitespace-normalized stock detector (`D47` #2).
///
/// Returns `Some(NotetypePreset)` in `Simple` mode ONLY when both templates
/// and CSS match a built-in stock pattern exactly after whitespace
/// normalization. Never mutates templates or CSS.
pub fn detect_stock_preset(
    kind: i64,
    fields: &[FieldSummary],
    templates: &[TemplateSummary],
    css: &str,
    config_json: &str,
) -> Option<NotetypePreset> {
    if is_image_occlusion_config(config_json) {
        return None;
    }

    let css_norm = normalize_ws(css);
    let align = if css_norm == normalize_ws(DEFAULT_CARD_CSS) {
        StyleAlign::Auto
    } else if css_norm == normalize_ws(ANKI_STOCK_CARD_CSS) {
        StyleAlign::Center
    } else {
        return None;
    };

    let has_field = |name: &str| fields.iter().any(|f| f.name == name);
    let norm_t: Vec<(String, String)> = templates
        .iter()
        .map(|t| {
            (
                normalize_template_ws(&t.qfmt),
                normalize_template_ws(&t.afmt),
            )
        })
        .collect();

    let (layout, slots): (LayoutId, Vec<(&str, &str)>) = match (kind, norm_t.as_slice()) {
        (0, [(q, a)])
            if q == "{{Front}}"
                && a == r#"{{FrontSide}}<hr id="answer">{{Back}}"#
                && has_field("Front")
                && has_field("Back") =>
        {
            (LayoutId::Basic, vec![("front", "Front"), ("back", "Back")])
        }
        (0, [(q1, a1), (q2, a2)])
            if q1 == "{{Front}}"
                && a1 == r#"{{FrontSide}}<hr id="answer">{{Back}}"#
                && q2 == "{{Back}}"
                && a2 == r#"{{FrontSide}}<hr id="answer">{{Front}}"#
                && has_field("Front")
                && has_field("Back") =>
        {
            (
                LayoutId::BasicReversed,
                vec![("front", "Front"), ("back", "Back")],
            )
        }
        (0, [(q1, a1), (q2, a2)])
            if q1 == "{{Front}}"
                && a1 == r#"{{FrontSide}}<hr id="answer">{{Back}}"#
                && q2 == "{{#Add Reverse}}{{Back}}{{/Add Reverse}}"
                && a2 == r#"{{FrontSide}}<hr id="answer">{{Front}}"#
                && has_field("Front")
                && has_field("Back")
                && has_field("Add Reverse") =>
        {
            (
                LayoutId::BasicReversed,
                vec![
                    ("front", "Front"),
                    ("back", "Back"),
                    ("reverseGate", "Add Reverse"),
                ],
            )
        }
        (0, [(q, a)])
            if (q == "{{Front}} {{type:Back}}" || q == "{{Front}}{{type:Back}}")
                && a == r#"{{FrontSide}}<hr id="answer">{{type:Back}}"#
                && has_field("Front")
                && has_field("Back") =>
        {
            (
                LayoutId::TypeIn,
                vec![("prompt", "Front"), ("typed", "Back")],
            )
        }
        (1, [(q, a)])
            if q == "{{cloze:Text}}"
                && (a == r#"{{cloze:Text}}<br><span class="keepsake-extra">{{Extra}}</span>"#
                    || a == r#"{{cloze:Text}}<br>{{Extra}}"#)
                && has_field("Text")
                && has_field("Extra") =>
        {
            (LayoutId::Cloze, vec![("text", "Text"), ("extra", "Extra")])
        }
        _ => return None,
    };

    let mut preset = NotetypePreset::for_layout(layout);
    preset.slots.clear();
    for (slot_id, field_name) in slots {
        preset
            .slots
            .insert(slot_id.to_string(), field_name.to_string());
    }
    preset.style.align = align;
    Some(preset)
}

/// True when an Advanced note type can switch back to Simple without overwriting
/// user-edited HTML/CSS (`ADR-030` §3).
pub fn can_return_to_simple(
    preset: Option<&NotetypePreset>,
    kind: i64,
    fields: &[FieldSummary],
    templates: &[TemplateSummary],
    css: &str,
    config_json: &str,
) -> bool {
    if let Some(p) = preset {
        if let Some(expected_digest) = p.compiled_digest.as_deref() {
            let current: Vec<CompiledTemplate> = templates
                .iter()
                .map(|t| CompiledTemplate {
                    name: t.name.clone(),
                    qfmt: t.qfmt.clone(),
                    afmt: t.afmt.clone(),
                })
                .collect();
            if compute_compiled_digest(&current, css) == expected_digest {
                return true;
            }
        }
    }
    detect_stock_preset(kind, fields, templates, css, config_json).is_some()
}

fn is_special_anki_field(name: &str) -> bool {
    matches!(
        name,
        "FrontSide" | "Tags" | "Type" | "Deck" | "Subdeck" | "Card" | "CardFlag"
    )
}

fn has_answer_divider(afmt: &str) -> bool {
    let lower = afmt.to_ascii_lowercase();
    lower.contains("{{frontside}}")
        || lower.contains("id=\"answer\"")
        || lower.contains("id='answer'")
        || lower.contains("id=answer")
}

fn lint_template_side(
    source: &str,
    side_label: &str,
    template_ord: i64,
    field_names: &HashSet<&str>,
    hints: &mut Vec<TemplateLintHint>,
    has_cloze_marker: &mut bool,
) {
    let mut stack: Vec<String> = Vec::new();
    let mut i = 0;
    let bytes = source.as_bytes();
    while i < bytes.len() {
        if bytes[i] == b'{' && i + 1 < bytes.len() && bytes[i + 1] == b'{' {
            let Some(rel_end) = source[i..].find("}}") else {
                hints.push(TemplateLintHint {
                    severity: LintSeverity::Warning,
                    code: "unclosed-mustache".to_string(),
                    message: format!("{side_label} template has an unclosed `{{{{` tag."),
                    template_ord: Some(template_ord),
                    field_name: None,
                });
                break;
            };
            let inner = source[i + 2..i + rel_end].trim();
            if let Some(name) = inner.strip_prefix('#').or_else(|| inner.strip_prefix('^')) {
                let name = name.trim();
                stack.push(name.to_string());
                if !name.is_empty() && !is_special_anki_field(name) && !field_names.contains(name) {
                    hints.push(TemplateLintHint {
                        severity: LintSeverity::Warning,
                        code: "unknown-field".to_string(),
                        message: format!("{{{{{inner}}}}} references unknown field {name:?}."),
                        template_ord: Some(template_ord),
                        field_name: Some(name.to_string()),
                    });
                }
            } else if let Some(name) = inner.strip_prefix('/') {
                let name = name.trim();
                match stack.last() {
                    Some(top) if top == name => {
                        stack.pop();
                    }
                    Some(top) => {
                        hints.push(TemplateLintHint {
                            severity: LintSeverity::Warning,
                            code: "mismatched-section".to_string(),
                            message: format!(
                                "Closing tag {{{{/{name}}}}} does not match open section {{{{#{top}}}}}."
                            ),
                            template_ord: Some(template_ord),
                            field_name: None,
                        });
                    }
                    None => {
                        hints.push(TemplateLintHint {
                            severity: LintSeverity::Warning,
                            code: "unmatched-section-close".to_string(),
                            message: format!(
                                "Closing tag {{{{/{name}}}}} has no matching opening section."
                            ),
                            template_ord: Some(template_ord),
                            field_name: None,
                        });
                    }
                }
            } else {
                let mut parts: Vec<&str> = inner.split(':').collect();
                let target = parts.pop().unwrap_or("").trim();
                let is_tts_voices = parts.iter().any(|f| f.trim() == "tts-voices");
                if parts
                    .iter()
                    .any(|f| matches!(f.trim(), "cloze" | "cloze-only"))
                {
                    *has_cloze_marker = true;
                }
                if target.is_empty() {
                    if !is_tts_voices {
                        hints.push(TemplateLintHint {
                            severity: LintSeverity::Warning,
                            code: "empty-tag".to_string(),
                            message: format!(
                                "{side_label} template contains an empty `{{{{}}}}` tag."
                            ),
                            template_ord: Some(template_ord),
                            field_name: None,
                        });
                    }
                } else if !is_special_anki_field(target) && !field_names.contains(target) {
                    hints.push(TemplateLintHint {
                        severity: LintSeverity::Warning,
                        code: "unknown-field".to_string(),
                        message: format!("{{{{{inner}}}}} references unknown field {target:?}."),
                        template_ord: Some(template_ord),
                        field_name: Some(target.to_string()),
                    });
                }
            }
            i += rel_end + 2;
        } else {
            i += 1;
        }
    }

    for unclosed in stack {
        hints.push(TemplateLintHint {
            severity: LintSeverity::Warning,
            code: "unclosed-section".to_string(),
            message: format!(
                "Section {{{{#{unclosed}}}}} is missing a closing {{{{/{unclosed}}}}} tag."
            ),
            template_ord: Some(template_ord),
            field_name: None,
        });
    }
}

fn css_braces_balanced(css: &str) -> bool {
    let bytes = css.as_bytes();
    let mut i = 0;
    let mut depth: i32 = 0;
    let mut in_comment = false;
    let mut quote: Option<u8> = None;

    while i < bytes.len() {
        if in_comment {
            if bytes[i] == b'*' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
                in_comment = false;
                i += 2;
            } else {
                i += 1;
            }
            continue;
        }
        if let Some(q) = quote {
            if bytes[i] == b'\\' && i + 1 < bytes.len() {
                i += 2;
                continue;
            }
            if bytes[i] == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        if bytes[i] == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            in_comment = true;
            i += 2;
            continue;
        }
        match bytes[i] {
            b'"' | b'\'' => quote = Some(bytes[i]),
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            _ => {}
        }
        i += 1;
    }
    depth == 0 && !in_comment && quote.is_none()
}

/// Pure-core non-blocking linter for note-type templates and CSS (`§7.4`).
pub fn lint_templates(
    kind: i64,
    fields: &[FieldSummary],
    templates: &[TemplateSummary],
    css: &str,
) -> Vec<TemplateLintHint> {
    let field_names: HashSet<&str> = fields.iter().map(|f| f.name.as_str()).collect();
    let mut hints = Vec::new();

    for tmpl in templates {
        let mut q_cloze = false;
        lint_template_side(
            &tmpl.qfmt,
            "Front",
            tmpl.ord,
            &field_names,
            &mut hints,
            &mut q_cloze,
        );
        if kind == 1 && !q_cloze {
            hints.push(TemplateLintHint {
                severity: LintSeverity::Warning,
                code: "missing-cloze-marker".to_string(),
                message: "Cloze note type front template has no {{cloze:...}} or {{cloze-only:...}} marker."
                    .to_string(),
                template_ord: Some(tmpl.ord),
                field_name: None,
            });
        }

        let mut a_cloze = false;
        lint_template_side(
            &tmpl.afmt,
            "Back",
            tmpl.ord,
            &field_names,
            &mut hints,
            &mut a_cloze,
        );
        if !has_answer_divider(&tmpl.afmt) {
            hints.push(TemplateLintHint {
                severity: LintSeverity::Hint,
                code: "missing-answer-divider".to_string(),
                message: "Back template omits {{FrontSide}} and <hr id=\"answer\">.".to_string(),
                template_ord: Some(tmpl.ord),
                field_name: None,
            });
        }
    }

    if !css_braces_balanced(css) {
        hints.push(TemplateLintHint {
            severity: LintSeverity::Warning,
            code: "unbalanced-css-braces".to_string(),
            message: "Card CSS has unbalanced `{` / `}` braces or an unclosed string/comment."
                .to_string(),
            template_ord: None,
            field_name: None,
        });
    }

    hints
}

/// Parse `"keepsakePreset"` from `notetypes.config` JSON if present and valid.
pub fn parse_keepsake_preset(config_json: &str) -> Option<NotetypePreset> {
    let val = serde_json::from_str::<serde_json::Value>(config_json).ok()?;
    let raw = val.get(KEEPSAKE_PRESET_CONFIG_KEY)?;
    serde_json::from_value(raw.clone()).ok()
}

/// Set or remove `"keepsakePreset"` inside `notetypes.config` JSON, preserving all sibling keys.
pub fn set_keepsake_preset_in_config(
    config_json: &str,
    preset: Option<&NotetypePreset>,
) -> CoreResult<String> {
    let mut map = match serde_json::from_str::<serde_json::Value>(config_json) {
        Ok(serde_json::Value::Object(m)) => m,
        _ => serde_json::Map::new(),
    };
    match preset {
        Some(p) => {
            let val = serde_json::to_value(p)
                .map_err(|e| CoreError::Invalid(format!("invalid preset JSON: {e}")))?;
            map.insert(KEEPSAKE_PRESET_CONFIG_KEY.to_string(), val);
        }
        None => {
            map.remove(KEEPSAKE_PRESET_CONFIG_KEY);
        }
    }
    Ok(serde_json::Value::Object(map).to_string())
}

/// Update `keepsakePreset.slots` (and refresh `compiledDigest` if it matched `old_templates`)
/// when a field is renamed. Returns `Some(updated_config_json)` only if `config_json` changed.
pub fn rename_field_in_preset_config(
    config_json: &str,
    old_name: &str,
    new_name: &str,
    old_templates: &[CompiledTemplate],
    new_templates: &[CompiledTemplate],
    css: &str,
) -> Option<String> {
    let mut preset = parse_keepsake_preset(config_json)?;
    let mut changed = false;
    for mapped in preset.slots.values_mut() {
        if mapped == old_name {
            *mapped = new_name.to_string();
            changed = true;
        }
    }
    if let Some(ref digest) = preset.compiled_digest {
        if *digest == compute_compiled_digest(old_templates, css) {
            let next_digest = compute_compiled_digest(new_templates, css);
            if *digest != next_digest {
                preset.compiled_digest = Some(next_digest);
                changed = true;
            }
        }
    }
    if !changed {
        return None;
    }
    set_keepsake_preset_in_config(config_json, Some(&preset)).ok()
}

/// Clear any slot in `keepsakePreset.slots` pointing to `removed_name`.
/// Returns `Some(updated_config_json)` only if `config_json` changed.
pub fn remove_field_from_preset_config(config_json: &str, removed_name: &str) -> Option<String> {
    let mut preset = parse_keepsake_preset(config_json)?;
    let before = preset.slots.len();
    preset.slots.retain(|_, v| v != removed_name);
    if preset.slots.len() == before {
        return None;
    }
    set_keepsake_preset_in_config(config_json, Some(&preset)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::{FieldDirection, FieldOptions};

    fn field(ord: i64, name: &str) -> FieldSummary {
        FieldSummary {
            ord,
            name: name.to_string(),
            options: FieldOptions::default(),
        }
    }

    fn field_dir(ord: i64, name: &str, direction: FieldDirection) -> FieldSummary {
        FieldSummary {
            ord,
            name: name.to_string(),
            options: FieldOptions {
                direction,
                ..FieldOptions::default()
            },
        }
    }

    fn tmpl(ord: i64, name: &str, qfmt: &str, afmt: &str) -> TemplateSummary {
        TemplateSummary {
            ord,
            name: name.to_string(),
            qfmt: qfmt.to_string(),
            afmt: afmt.to_string(),
        }
    }

    #[test]
    fn sha256_matches_nist_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn all_seven_layouts_compile_deterministically() {
        let all = [
            (
                LayoutId::Basic,
                vec![field(0, "Front"), field(1, "Back")],
                0,
                1,
            ),
            (
                LayoutId::BasicReversed,
                vec![field(0, "Front"), field(1, "Back"), field(2, "Add Reverse")],
                0,
                2,
            ),
            (
                LayoutId::Cloze,
                vec![field(0, "Text"), field(1, "Extra")],
                1,
                1,
            ),
            (
                LayoutId::TypeIn,
                vec![field(0, "Front"), field(1, "Back")],
                0,
                1,
            ),
            (
                LayoutId::AudioText,
                vec![
                    field(0, "Audio"),
                    field(1, "Meaning"),
                    field(2, "Transcript"),
                ],
                0,
                1,
            ),
            (
                LayoutId::ImageText,
                vec![field(0, "Image"), field(1, "Label"), field(2, "Prompt")],
                0,
                1,
            ),
            (
                LayoutId::LanguageCard,
                vec![
                    field(0, "Word"),
                    field(1, "Meaning"),
                    field(2, "Reading"),
                    field(3, "IPA"),
                    field(4, "Audio"),
                    field(5, "Example"),
                    field(6, "Notes"),
                ],
                0,
                1,
            ),
        ];

        for (layout, fields, expected_kind, expected_tmpl_count) in all {
            let mut preset = NotetypePreset::for_layout(layout);
            assert_eq!(preset.style.align, StyleAlign::Auto);
            if layout == LayoutId::BasicReversed {
                preset
                    .slots
                    .insert("reverseGate".into(), "Add Reverse".into());
            }
            let c1 = compile_preset(&preset, &fields).expect("layout must compile");
            let c2 =
                compile_preset(&preset, &fields).expect("layout must compile deterministically");
            assert_eq!(c1, c2);
            assert_eq!(c1.kind, expected_kind);
            assert_eq!(c1.templates.len(), expected_tmpl_count);
            assert_eq!(c1.compiled_digest.len(), 64);
            assert!(c1.css.contains(".card"));
        }

        // LanguageCard with include_reverse = true generates 2 templates
        let mut lang_rev = NotetypePreset::for_layout(LayoutId::LanguageCard);
        lang_rev.options.include_reverse = true;
        lang_rev.options.use_furigana = true;
        lang_rev.slots.insert("reading".into(), "Reading".into());
        let lang_fields = vec![field(0, "Word"), field(1, "Meaning"), field(2, "Reading")];
        let compiled = compile_preset(&lang_rev, &lang_fields).unwrap();
        assert_eq!(compiled.templates.len(), 2);
        assert!(compiled.templates[0].qfmt.contains("{{furigana:Reading}}"));

        // AudioText with tts_fallback generates {{tts ...}}
        let mut audio = NotetypePreset::for_layout(LayoutId::AudioText);
        audio.options.tts_fallback = true;
        audio.options.tts_lang = Some("ar_SA".into());
        audio.slots.insert("transcript".into(), "Transcript".into());
        let audio_fields = vec![
            field(0, "Audio"),
            field(1, "Meaning"),
            field(2, "Transcript"),
        ];
        let compiled_audio = compile_preset(&audio, &audio_fields).unwrap();
        assert!(compiled_audio.templates[0]
            .qfmt
            .contains("{{tts ar_SA:Transcript}}"));
    }

    #[test]
    fn all_four_style_presets_compile_with_rtl_support() {
        let fields = vec![field(0, "Front"), field_dir(1, "Back", FieldDirection::Rtl)];
        for style_preset in [
            StylePresetId::PaperEditorial,
            StylePresetId::CleanSans,
            StylePresetId::LibraryScholar,
            StylePresetId::CompactStudy,
        ] {
            let mut preset = NotetypePreset::for_layout(LayoutId::Basic);
            preset.style.preset = style_preset;
            let compiled = compile_preset(&preset, &fields).unwrap();
            assert!(compiled.templates[0].qfmt.contains(r#"dir="auto""#));
            assert!(compiled.templates[0].afmt.contains(r#"dir="rtl""#));
            assert!(compiled.css.contains("text-align: start"));
            assert!(compiled.css.contains("night_mode"));
        }
    }

    #[test]
    fn strict_stock_detector_matches_only_exact_whitespace_normalized_stock() {
        let basic_fields = vec![field(0, "Front"), field(1, "Back")];
        let basic_tmpls = vec![tmpl(
            0,
            "Card 1",
            "  {{Front}} \n",
            "{{FrontSide}}\n\n<hr id=\"answer\">\n\n{{Back}}",
        )];
        let detected = detect_stock_preset(0, &basic_fields, &basic_tmpls, DEFAULT_CARD_CSS, "{}")
            .expect("stock Basic with extra whitespace must match");
        assert_eq!(detected.layout, LayoutId::Basic);
        assert_eq!(detected.mode, EditorMode::Simple);

        // Custom CSS must fail strict detection -> None (Advanced mode)
        let custom_css = format!("{DEFAULT_CARD_CSS}\n.card {{ color: red; }}");
        assert!(detect_stock_preset(0, &basic_fields, &basic_tmpls, &custom_css, "{}").is_none());

        // Custom HTML in template must fail strict detection -> None (Advanced mode)
        let custom_tmpls = vec![tmpl(
            0,
            "Card 1",
            "<div class=\"custom\">{{Front}}</div>",
            "{{FrontSide}}<hr id=\"answer\">{{Back}}",
        )];
        assert!(
            detect_stock_preset(0, &basic_fields, &custom_tmpls, DEFAULT_CARD_CSS, "{}").is_none()
        );

        // Image Occlusion always opens in Advanced (returns None)
        let io_tmpls = vec![tmpl(
            0,
            "Card 1",
            "{{Header}}{{Image}}{{cloze:Occlusion}}",
            "{{Header}}",
        )];
        assert!(detect_stock_preset(
            1,
            &[field(0, "Occlusion"), field(1, "Image")],
            &io_tmpls,
            DEFAULT_CARD_CSS,
            r#"{"kind":"image-occlusion"}"#
        )
        .is_none());
    }

    #[test]
    fn lint_templates_reports_unknown_fields_unclosed_sections_cloze_and_css_braces() {
        let fields = vec![field(0, "Front"), field(1, "Back")];
        let tmpls = vec![tmpl(0, "Card 1", "{{#Front}}{{UnknownField}}", "{{Back}}")];
        let hints = lint_templates(1, &fields, &tmpls, ".card { color: red;");
        let codes: Vec<&str> = hints.iter().map(|h| h.code.as_str()).collect();
        assert!(codes.contains(&"unknown-field"), "got {codes:?}");
        assert!(codes.contains(&"unclosed-section"), "got {codes:?}");
        assert!(codes.contains(&"missing-cloze-marker"), "got {codes:?}");
        assert!(codes.contains(&"unbalanced-css-braces"), "got {codes:?}");
        assert!(codes.contains(&"missing-answer-divider"), "got {codes:?}");

        // Built-in special fields must NOT trigger unknown-field
        let special = vec![tmpl(
            0,
            "Card 1",
            "{{Front}} {{Tags}} {{Deck}} {{Card}}",
            "{{FrontSide}}<hr id=\"answer\">{{Back}}",
        )];
        let clean = lint_templates(0, &fields, &special, DEFAULT_CARD_CSS);
        assert!(clean.is_empty(), "expected no lint hints, got {clean:?}");
    }
}
