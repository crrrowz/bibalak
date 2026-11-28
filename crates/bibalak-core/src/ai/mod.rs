//! AI extension points, versioned prompt registry, and pure domain helpers.
//!
//! `bibalak-core` defines the [`AIProvider`] trait, value types, HTML-to-plain-text
//! conversion, versioned prompt registry, and origin validation with zero IO or network crates.
//! Concrete HTTP (`ureq`) and credential-store (`keyring`) adapters live in `bibalak-ai`.

pub mod coach;
#[cfg(any(test, feature = "testkit"))]
pub mod fake;
pub mod parse;
pub mod plain_text;
pub mod prompts;
pub mod split;
pub mod types;

pub use coach::{build_coach_input, format_coach_prompt};
#[cfg(any(test, feature = "testkit"))]
pub use fake::FakeAIProvider;
pub use parse::{
    parse_action_reply, parse_coach_report, parse_generated_cards, parse_quality_findings,
    parse_rewritten_fields, ParsedReply,
};
pub use plain_text::{csp_with_ai_origin, html_to_plain_text, normalize_provider_origin};
pub use prompts::{
    build_action_prompt, build_action_prompt_with_locale, execute_ai_action,
    execute_ai_action_with_locale, execute_built_ai_action, translate_targets_english, PromptBuild,
    PromptSpec, DEFAULT_QUALITY_CHUNK_NOTES, MAX_QUALITY_SCAN_NOTES, STUDY_COACH,
};
pub use split::{
    split_text_for_generation, DEFAULT_CHUNK_MAX_CHARS, MAX_GENERATE_CARDS,
    MAX_GENERATE_SOURCE_CHARS, MIN_GENERATE_CARDS,
};
pub use types::{
    extension_point, AIActionRequest, AIActionResult, AIConfig, AIFieldInput, AIPreviewPayload,
    AIProvider, AIProviderKind, AISaveConfigInput, AITextRequest, AITextResponse, CoachAdviceItem,
    CoachDeckSummary, CoachInput, CoachPlanDay, CoachReport, GeneratedCardDraft, GeneratedNoteKind,
    QualityFinding, QualityNoteInput,
};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CoreError;

    #[test]
    fn html_to_plain_text_strips_tags_scripts_and_decodes_entities() {
        let html = "<script>alert(1)</script><style>.x{color:red}</style><p>Tom &amp; Jerry</p><br><div>Line &#39;2&#39;&nbsp;ok&#x21;</div>";
        assert_eq!(html_to_plain_text(html), "Tom & Jerry\nLine '2' ok!");
    }

    #[test]
    fn normalize_provider_origin_validates_schemes_and_strips_paths() {
        assert_eq!(
            normalize_provider_origin("https://api.openai.com/v1").unwrap(),
            "https://api.openai.com"
        );
        assert_eq!(
            normalize_provider_origin("http://localhost:11434/api").unwrap(),
            "http://localhost:11434"
        );
        assert!(normalize_provider_origin("").is_err());
        assert!(normalize_provider_origin("ftp://example.com").is_err());
        assert!(normalize_provider_origin("https://user:pass@api.openai.com").is_err());
        assert!(normalize_provider_origin("https://api.openai.com/v1 extra").is_err());
    }

    #[test]
    fn csp_with_ai_origin_updates_only_configured_host() {
        let base =
            "default-src 'self'; connect-src 'self' ipc: https://github.com; frame-src 'none'";
        let updated = csp_with_ai_origin(base, Some("http://localhost:11434/v1")).unwrap();
        assert_eq!(
            updated,
            "default-src 'self'; connect-src 'self' ipc: https://github.com http://localhost:11434; frame-src 'none'"
        );

        let unchanged = csp_with_ai_origin(base, None).unwrap();
        assert_eq!(unchanged, base);
    }

    #[test]
    fn build_action_prompt_converts_card_html_to_plain_text() {
        let req = build_action_prompt(&AIActionRequest::ExplainCard {
            front_html: "<b>Capital</b> of France?".into(),
            back_html: "<p>Paris &amp; Lyon?</p><script>evil()</script>".into(),
            deck_name: Some("Geography".into()),
        })
        .unwrap();
        assert!(!req.prompt.contains("<b>"));
        assert!(!req.prompt.contains("<script>"));
        assert!(req.prompt.contains("Capital of France?"));
        assert!(req.prompt.contains("Paris & Lyon?"));
    }

    #[test]
    fn parse_rewritten_fields_accepts_fenced_or_raw_json_of_exact_length() {
        let fenced =
            "```json\n{\"fields\": [\"What is the atomic symbol for gold?\", \"Au\"]}\n```";
        assert_eq!(
            parse_rewritten_fields(fenced, 2).unwrap(),
            vec![
                "What is the atomic symbol for gold?".to_string(),
                "Au".to_string()
            ]
        );
        assert!(parse_rewritten_fields(fenced, 3).is_none());
        assert!(parse_rewritten_fields("not json", 2).is_none());
    }

    #[test]
    fn build_action_prompt_adds_arabic_language_rule_for_arabic_cards() {
        let explain = build_action_prompt(&AIActionRequest::ExplainCard {
            front_html: "<b>ما هي عاصمة مصر؟</b>".into(),
            back_html: "القاهرة".into(),
            deck_name: Some("جغرافيا".into()),
        })
        .unwrap();
        let sys = explain.system.unwrap_or_default();
        assert!(
            sys.contains("Arabic"),
            "expected Arabic language instruction in system prompt, got: {sys}"
        );

        let suggest = build_action_prompt(&AIActionRequest::SuggestBack {
            front_html: "ما هو الرمز الكيميائي للذهب؟".into(),
            notetype_name: None,
            back_field_name: None,
        })
        .unwrap();
        let suggest_sys = suggest.system.unwrap_or_default();
        assert!(
            suggest_sys.contains("Arabic"),
            "expected Arabic language instruction in suggest prompt, got: {suggest_sys}"
        );
    }

    #[test]
    fn build_action_prompt_strips_html_and_media_tags_to_plain_text() {
        let req = build_action_prompt(&AIActionRequest::ExplainCard {
            front_html: "See <img src=\"hidden-tag.png\">diagram.png <b>now</b>".into(),
            back_html: "<script>steal()</script>Answer".into(),
            deck_name: None,
        })
        .unwrap();
        assert!(!req.prompt.contains("<img"));
        assert!(!req.prompt.contains("hidden-tag.png"));
        assert!(!req.prompt.contains("<script>"));
        assert!(req.prompt.contains("diagram.png"));
    }

    #[test]
    fn execute_ai_action_covers_all_actions_via_fake_provider_and_sets_prompt_ids() {
        let fake = FakeAIProvider::scripted([
            Ok(AITextResponse {
                text: "OK".into(),
                input_tokens: Some(4),
                output_tokens: Some(1),
            }),
            Ok(AITextResponse {
                text: "لأن القاهرة هي عاصمة جمهورية مصر العربية.".into(),
                input_tokens: Some(20),
                output_tokens: Some(12),
            }),
            Ok(AITextResponse {
                text: "Au".into(),
                input_tokens: Some(15),
                output_tokens: Some(2),
            }),
            Ok(AITextResponse {
                text: r#"{"fields":["Symbol for gold?","Au"]}"#.into(),
                input_tokens: Some(30),
                output_tokens: Some(10),
            }),
        ]);

        let test_res = execute_ai_action(&fake, &AIActionRequest::TestConnection).unwrap();
        assert_eq!(test_res.prompt_id, "test_connection@1");
        assert_eq!(test_res.text, "OK");

        let explain_res = execute_ai_action(
            &fake,
            &AIActionRequest::ExplainCard {
                front_html: "<p>ما هي عاصمة مصر؟</p><img src=\"map.png\">".into(),
                back_html: "<b>القاهرة</b>".into(),
                deck_name: Some("جغرافيا".into()),
            },
        )
        .unwrap();
        assert_eq!(explain_res.prompt_id, "explain_card@1");

        let suggest_res = execute_ai_action(
            &fake,
            &AIActionRequest::SuggestBack {
                front_html: "<i>Atomic symbol for gold?</i>".into(),
                notetype_name: Some("Basic".into()),
                back_field_name: Some("Back".into()),
            },
        )
        .unwrap();
        assert_eq!(suggest_res.prompt_id, "suggest_back@1");
        assert_eq!(suggest_res.text, "Au");

        let rewrite_res = execute_ai_action(
            &fake,
            &AIActionRequest::RewriteLeech {
                fields: vec![
                    AIFieldInput {
                        name: "Front".into(),
                        value_html: "<b>What is the symbol for gold?</b>".into(),
                    },
                    AIFieldInput {
                        name: "Back".into(),
                        value_html: "<div>Au</div>".into(),
                    },
                ],
                lapses: Some(6),
            },
        )
        .unwrap();
        assert_eq!(rewrite_res.prompt_id, "rewrite_leech@1");
        assert_eq!(
            rewrite_res.suggested_fields,
            Some(vec!["Symbol for gold?".into(), "Au".into()])
        );

        let recorded = fake.recorded_requests();
        assert_eq!(recorded.len(), 4);
        assert!(!recorded[1].prompt.contains("<p>"));
        assert!(!recorded[1].prompt.contains("<img"));
        assert!(recorded[1]
            .system
            .as_deref()
            .is_some_and(|s| s.contains("Arabic")));
        assert!(!recorded[2].prompt.contains("<i>"));
        assert!(!recorded[3].prompt.contains("<b>"));
    }

    #[test]
    fn execute_ai_action_rejects_invalid_rewrite_json_without_suggested_fields() {
        let fake = FakeAIProvider::with_text("Here is a rewritten version without JSON");
        let err = execute_ai_action(
            &fake,
            &AIActionRequest::RewriteLeech {
                fields: vec![
                    AIFieldInput {
                        name: "Front".into(),
                        value_html: "Q".into(),
                    },
                    AIFieldInput {
                        name: "Back".into(),
                        value_html: "A".into(),
                    },
                ],
                lapses: Some(4),
            },
        )
        .unwrap_err();
        assert!(matches!(err, CoreError::Format(_)));
    }

    #[test]
    fn execute_ai_action_with_locale_applies_arabic_rule_for_unclear_card_in_arabic_app() {
        let unclear = AIActionRequest::ExplainCard {
            front_html: "<b>H2O</b> 123".into(),
            back_html: "456".into(),
            deck_name: None,
        };
        let preview = build_action_prompt_with_locale(&unclear, Some("ar")).unwrap();
        let fake = FakeAIProvider::with_text("الماء يتكون من هيدروجين وأكسجين.");
        let result = execute_ai_action_with_locale(&fake, &unclear, Some("ar")).unwrap();

        assert_eq!(result.prompt_id, "explain_card@1");
        let recorded = fake.recorded_requests();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0], preview.request);
        assert!(recorded[0]
            .system
            .as_deref()
            .is_some_and(|s| s.contains("Arabic")));
    }

    #[test]
    fn split_text_for_generation_prefers_paragraphs_sentences_never_mid_word_and_rejects_over_limit(
    ) {
        assert!(split_text_for_generation("   \n\t ", 6000).is_err());

        let too_long = "a".repeat(MAX_GENERATE_SOURCE_CHARS + 1);
        assert!(split_text_for_generation(&too_long, 6000).is_err());

        // Paragraphs packed neatly
        let para_a = "First paragraph about mitosis and cell cycle phases.";
        let para_b = "Second paragraph about glycolysis and ATP yield.";
        let combined = format!("{para_a}\n\n{para_b}");
        let parts = split_text_for_generation(&combined, 60).unwrap();
        assert_eq!(parts, vec![para_a.to_string(), para_b.to_string()]);

        // Word boundary invariant on Arabic + English text without paragraph breaks
        let words = "القلب يضخ الدم المؤكسج عبر الشريان الأبهر إلى كافة أنحاء الجسم. ".repeat(15);
        let arabic_parts = split_text_for_generation(&words, 120).unwrap();
        assert!(arabic_parts.len() > 1);
        for part in &arabic_parts {
            assert!(part.chars().count() <= 120);
            assert!(!part.is_empty());
        }
        let rejoined: String = arabic_parts.join(" ");
        assert!(rejoined.contains("الشريان الأبهر"));
    }

    #[test]
    fn generate_cards_basic_and_cloze_through_fake_provider_and_error_paths() {
        let fake = FakeAIProvider::scripted([
            Ok(AITextResponse {
                text: r#"{"cards":[{"front":"  Primary pacemaker?  ","back":" SA node "}]}"#.into(),
                input_tokens: Some(40),
                output_tokens: Some(15),
            }),
            Ok(AITextResponse {
                text: "```json\n{\"cards\":[{\"text\":\"The {{c1::liver}} metabolizes most drugs.\"}]}\n```"
                    .into(),
                input_tokens: Some(35),
                output_tokens: Some(14),
            }),
        ]);

        let basic_res = execute_ai_action_with_locale(
            &fake,
            &AIActionRequest::GenerateCards {
                text: "The SA node sets sinus rhythm.".into(),
                note_kind: GeneratedNoteKind::Basic,
                count: 5,
                deck_name: Some("Cardiology".into()),
            },
            Some("en"),
        )
        .unwrap();
        assert_eq!(basic_res.prompt_id, "generate_cards@1");
        assert_eq!(
            basic_res.generated_cards,
            Some(vec![GeneratedCardDraft::Basic {
                front: "Primary pacemaker?".into(),
                back: "SA node".into(),
            }])
        );

        let cloze_res = execute_ai_action_with_locale(
            &fake,
            &AIActionRequest::GenerateCards {
                text: "Drug metabolism happens largely in the liver.".into(),
                note_kind: GeneratedNoteKind::Cloze,
                count: 5,
                deck_name: None,
            },
            Some("ar"),
        )
        .unwrap();
        assert_eq!(cloze_res.prompt_id, "generate_cards@1");
        assert_eq!(
            cloze_res.generated_cards,
            Some(vec![GeneratedCardDraft::Cloze {
                text: "The {{c1::liver}} metabolizes most drugs.".into(),
            }])
        );

        // Bad JSON -> CoreError::Format
        let bad_json = FakeAIProvider::with_text("not json");
        let err = execute_ai_action(
            &bad_json,
            &AIActionRequest::GenerateCards {
                text: "Study text".into(),
                note_kind: GeneratedNoteKind::Basic,
                count: 5,
                deck_name: None,
            },
        )
        .unwrap_err();
        assert!(matches!(err, CoreError::Format(_)));

        // Cloze without markers -> CoreError::Format
        let no_cloze_marker =
            FakeAIProvider::with_text(r#"{"cards":[{"text":"No cloze markers here"}]}"#);
        let err = execute_ai_action(
            &no_cloze_marker,
            &AIActionRequest::GenerateCards {
                text: "Study text".into(),
                note_kind: GeneratedNoteKind::Cloze,
                count: 5,
                deck_name: None,
            },
        )
        .unwrap_err();
        assert!(matches!(err, CoreError::Format(_)));

        // Too many cards (> count) -> CoreError::Format
        let too_many = FakeAIProvider::with_text(
            r#"{"cards":[{"front":"Q1","back":"A1"},{"front":"Q2","back":"A2"}]}"#,
        );
        let err = execute_ai_action(
            &too_many,
            &AIActionRequest::GenerateCards {
                text: "Study text".into(),
                note_kind: GeneratedNoteKind::Basic,
                count: 1,
                deck_name: None,
            },
        )
        .unwrap_err();
        assert!(matches!(err, CoreError::Format(_)));
    }

    #[test]
    fn tutor_actions_prompt_ids_and_empty_card_validation() {
        let fake = FakeAIProvider::with_text("Helpful tutor reply");
        assert_eq!(
            prompts::for_action(&AIActionRequest::ExplainCard {
                front_html: "Q".into(),
                back_html: "A".into(),
                deck_name: None,
            })
            .versioned_id,
            "explain_card@1"
        );

        let ex = execute_ai_action(
            &fake,
            &AIActionRequest::TutorExample {
                front_html: "<b>Osmosis</b>".into(),
                back_html: "Water movement across a membrane".into(),
                deck_name: Some("Biology".into()),
            },
        )
        .unwrap();
        assert_eq!(ex.prompt_id, "tutor_example@1");
        assert_eq!(ex.text, "Helpful tutor reply");

        let mn = execute_ai_action(
            &fake,
            &AIActionRequest::TutorMnemonic {
                front_html: "Cranial nerves".into(),
                back_html: "Olfactory, Optic, ...".into(),
                deck_name: None,
            },
        )
        .unwrap();
        assert_eq!(mn.prompt_id, "tutor_mnemonic@1");

        let tr = execute_ai_action(
            &fake,
            &AIActionRequest::TutorTranslate {
                front_html: "Heart failure".into(),
                back_html: "Inability to pump sufficiently".into(),
                deck_name: None,
            },
        )
        .unwrap();
        assert_eq!(tr.prompt_id, "tutor_translate@1");

        let why = execute_ai_action(
            &fake,
            &AIActionRequest::TutorWhyWrong {
                front_html: "First-line for anaphylaxis?".into(),
                back_html: "Epinephrine".into(),
                typed_answer: None,
                deck_name: None,
            },
        )
        .unwrap();
        assert_eq!(why.prompt_id, "tutor_why_wrong@1");

        for empty_req in [
            AIActionRequest::TutorExample {
                front_html: "  <br> ".into(),
                back_html: "<script>x()</script>".into(),
                deck_name: None,
            },
            AIActionRequest::TutorMnemonic {
                front_html: "".into(),
                back_html: "   ".into(),
                deck_name: None,
            },
            AIActionRequest::TutorTranslate {
                front_html: "".into(),
                back_html: "".into(),
                deck_name: None,
            },
            AIActionRequest::TutorWhyWrong {
                front_html: "".into(),
                back_html: "".into(),
                typed_answer: Some("guess".into()),
                deck_name: None,
            },
        ] {
            let err = build_action_prompt(&empty_req).unwrap_err();
            assert!(matches!(err, CoreError::Invalid(_)));
        }
    }

    #[test]
    fn tutor_translate_direction_for_arabic_english_and_mixed_cards() {
        assert!(translate_targets_english("ما هو العضو المسؤول عن ضخ الدم؟"));
        assert!(!translate_targets_english("What organ pumps blood?"));
        assert!(translate_targets_english("ما هو علاج ضغط الدم (BP) المزمن؟"));
        assert!(!translate_targets_english("Blood pressure ضغط is elevated"));

        let ar_req = build_action_prompt(&AIActionRequest::TutorTranslate {
            front_html: "القلب".into(),
            back_html: "عضلة تضخ الدم".into(),
            deck_name: None,
        })
        .unwrap();
        assert!(ar_req.system.unwrap_or_default().contains("into English"));

        let en_req = build_action_prompt(&AIActionRequest::TutorTranslate {
            front_html: "Stroke volume".into(),
            back_html: "Volume per beat".into(),
            deck_name: None,
        })
        .unwrap();
        assert!(en_req.system.unwrap_or_default().contains("into Arabic"));
    }

    #[test]
    fn tutor_why_wrong_trims_preserves_angle_brackets_and_caps_500_chars() {
        let with_attempt = build_action_prompt(&AIActionRequest::TutorWhyWrong {
            front_html: "Compare <b>values</b>".into(),
            back_html: "a &gt; b".into(),
            typed_answer: Some("   a < b   ".into()),
            deck_name: None,
        })
        .unwrap();
        assert!(with_attempt.prompt.contains("a < b"));

        let empty_attempt = build_action_prompt(&AIActionRequest::TutorWhyWrong {
            front_html: "Question".into(),
            back_html: "Answer".into(),
            typed_answer: Some("   \n\t ".into()),
            deck_name: None,
        })
        .unwrap();
        assert!(!empty_attempt.prompt.contains("typed answer"));

        let long_attempt = "x".repeat(650);
        let capped = build_action_prompt(&AIActionRequest::TutorWhyWrong {
            front_html: "Question".into(),
            back_html: "Answer".into(),
            typed_answer: Some(long_attempt),
            deck_name: None,
        })
        .unwrap();
        assert!(!capped.prompt.contains(&"x".repeat(501)));
        assert!(capped.prompt.contains(&"x".repeat(500)));
    }

    #[test]
    fn review_quality_all_six_finding_kinds_through_fake_provider() {
        let notes = vec![
            QualityNoteInput {
                note_id: 10,
                notetype_kind: 0,
                fields: vec![
                    AIFieldInput {
                        name: "Front".into(),
                        value_html: "<b>Define</b> preload &amp; afterload".into(),
                    },
                    AIFieldInput {
                        name: "Back".into(),
                        value_html: "EDV and SVR<script>evil()</script>".into(),
                    },
                ],
                tags: vec!["cardiology".into()],
                lapses: 4,
            },
            QualityNoteInput {
                note_id: 20,
                notetype_kind: 0,
                fields: vec![
                    AIFieldInput {
                        name: "Front".into(),
                        value_html: "What is afterload?".into(),
                    },
                    AIFieldInput {
                        name: "Back".into(),
                        value_html: "Resistance the left ventricle pumps against".into(),
                    },
                ],
                tags: vec![],
                lapses: 0,
            },
        ];

        let action = AIActionRequest::ReviewQuality {
            notes: notes.clone(),
            deck_name: Some("Cardiology".into()),
        };

        let built = build_action_prompt(&action).unwrap();
        assert!(!built.prompt.contains("<script>"));
        assert!(built.prompt.contains("Define preload & afterload"));

        let reply_json = r#"```json
        {"findings":[
          {"note_id":10,"kind":"unclear","reason":"Mixed two terms"},
          {"note_id":10,"kind":"overloaded","reason":"Tests multiple concepts"},
          {"note_id":20,"kind":"duplicate-meaning","other_note_id":10,"reason":"Same afterload concept"},
          {"note_id":20,"kind":"suggested-tags","tags":["hemodynamics","cardiology"],"reason":"Missing topic tag"},
          {"note_id":10,"kind":"rewrite","fields":["What is preload?","End-diastolic volume"],"reason":"Split into atomic cue"},
          {"note_id":10,"kind":"cloze-split","clozes":["Preload reflects {{c1::end-diastolic volume}}.","Afterload reflects {{c1::systemic vascular resistance}}."],"reason":"Clean atomic clozes"}
        ]}
        ```"#;
        let fake = FakeAIProvider::with_text(reply_json);
        let res = execute_ai_action(&fake, &action).unwrap();
        assert_eq!(res.prompt_id, "review_quality@1");
        let findings = res.quality_findings.expect("findings present");
        assert_eq!(findings.len(), 6);
        assert!(matches!(
            findings[0],
            QualityFinding::Unclear { note_id: 10, .. }
        ));
        assert!(matches!(
            findings[2],
            QualityFinding::DuplicateMeaning {
                note_id: 20,
                other_note_id: 10,
                ..
            }
        ));
        assert!(matches!(
            findings[4],
            QualityFinding::Rewrite { note_id: 10, .. }
        ));
        assert!(matches!(
            findings[5],
            QualityFinding::ClozeSplit { note_id: 10, .. }
        ));
    }

    #[test]
    fn review_quality_rejects_invalid_findings_and_empty_or_over_limit_inputs() {
        let one_note = vec![QualityNoteInput {
            note_id: 10,
            notetype_kind: 0,
            fields: vec![
                AIFieldInput {
                    name: "Front".into(),
                    value_html: "Q".into(),
                },
                AIFieldInput {
                    name: "Back".into(),
                    value_html: "A".into(),
                },
            ],
            tags: vec![],
            lapses: 0,
        }];

        // Empty notes or >200 notes -> CoreError::Invalid
        assert!(matches!(
            build_action_prompt(&AIActionRequest::ReviewQuality {
                notes: vec![],
                deck_name: None,
            })
            .unwrap_err(),
            CoreError::Invalid(_)
        ));
        let too_many: Vec<QualityNoteInput> = (1..=201)
            .map(|id| QualityNoteInput {
                note_id: id,
                notetype_kind: 0,
                fields: vec![AIFieldInput {
                    name: "Front".into(),
                    value_html: "Q".into(),
                }],
                tags: vec![],
                lapses: 0,
            })
            .collect();
        assert!(matches!(
            build_action_prompt(&AIActionRequest::ReviewQuality {
                notes: too_many,
                deck_name: None,
            })
            .unwrap_err(),
            CoreError::Invalid(_)
        ));

        let bad_replies = [
            "not json",
            r#"{"findings":[{"note_id":999,"kind":"unclear","reason":"unknown id"}]}"#,
            r#"{"findings":[{"note_id":10,"kind":"duplicate-meaning","other_note_id":999,"reason":"bad peer"}]}"#,
            r#"{"findings":[{"note_id":10,"kind":"duplicate-meaning","other_note_id":10,"reason":"self"}]}"#,
            r#"{"findings":[{"note_id":10,"kind":"suggested-tags","tags":["bad tag"],"reason":"has space"}]}"#,
            r#"{"findings":[{"note_id":10,"kind":"suggested-tags","tags":[],"reason":"empty"}]}"#,
            r#"{"findings":[{"note_id":10,"kind":"rewrite","fields":["Only one"],"reason":"wrong field len"}]}"#,
            r#"{"findings":[{"note_id":10,"kind":"cloze-split","clozes":["Only {{c1::one}}"],"reason":"too few"}]}"#,
            r#"{"findings":[{"note_id":10,"kind":"cloze-split","clozes":["No marker","Two {{c1::ok}}"],"reason":"missing marker"}]}"#,
            r#"{"findings":[{"note_id":10,"kind":"cloze-split","clozes":["{{c1::a}}","{{c1::b}}","{{c1::c}}","{{c1::d}}","{{c1::e}}","{{c1::f}}","{{c1::g}}"],"reason":"7 exceeds 6"}]}"#,
        ];

        for raw in bad_replies {
            let fake = FakeAIProvider::with_text(raw);
            let err = execute_ai_action(
                &fake,
                &AIActionRequest::ReviewQuality {
                    notes: one_note.clone(),
                    deck_name: None,
                },
            )
            .unwrap_err();
            assert!(
                matches!(err, CoreError::Format(_)),
                "expected Format for {raw}, got {err:?}"
            );
        }
    }

    #[test]
    fn build_coach_input_computes_metrics_and_top_decks() {
        use crate::ipc::{DayCount, DeckStat, HourlyStat, StatsCoachDto, StatsDto};
        let mut stats = StatsDto {
            today: 30,
            retention_pct: Some(88.4),
            retention_goal_pct: 90.0,
            backlog_count: 14,
            studied_days: 20,
            total_time_ms: 1_200_000, // 20 minutes total -> 1.0 min/studied day
            coach: StatsCoachDto {
                leech_count: 5,
                ..Default::default()
            },
            ..Default::default()
        };
        // 35 days of reviews: days 0..35. Day 30 is today.
        // Days 1..=30 are in the last 30 days window (day >= 30 - 29 = 1).
        // Each has count 10 -> 300 reviews in 30d window.
        stats.reviews = (0..=35)
            .map(|d| DayCount {
                day: d,
                count: 10,
                date: String::new(),
            })
            .collect();
        // Forecast: day 0..=30 offset from today.
        // Days 0..7 -> 7 days * 20 = 140.
        // Days 0..30 -> 30 days * 20 = 600.
        stats.forecast = (0..=30)
            .map(|d| DayCount {
                day: d,
                count: 20,
                date: String::new(),
            })
            .collect();
        // Hourly: 24 hours. Hour 14 has 50, hour 20 has 80, hour 9 has 30.
        stats.hourly = (0..24)
            .map(|h| HourlyStat {
                hour: h as u8,
                total: match h {
                    20 => 80,
                    14 => 50,
                    9 => 30,
                    _ => 0,
                },
                passed: 0,
            })
            .collect();
        // Deck stats: 12 decks. Top decks should be top 10 by due_today desc.
        stats.deck_stats = (1..=12)
            .map(|id| DeckStat {
                deck_id: id,
                name: format!("Deck {id}"),
                parent_id: None,
                total_cards: 100,
                due_today: id as u32 * 5,
                new_count: 10,
                learning_count: 5,
                young_count: 40,
                mature_count: 45,
                suspended_count: 0,
                retention_pct: Some(85.0 + id as f64),
                reviews_7d: 50,
            })
            .collect();

        let input = build_coach_input(&stats, Some("Biology".into()), Some(1));
        assert_eq!(input.selected_deck, Some("Biology".into()));
        assert_eq!(input.selected_deck_id, Some(1));
        assert_eq!(input.reviews_30d, 300);
        assert_eq!(input.forecast_7d, 140);
        assert_eq!(input.forecast_30d, 600);
        assert_eq!(input.studied_days, 20);
        assert_eq!(input.avg_minutes_per_day, 1.0);
        assert_eq!(input.leech_count, 5);
        assert_eq!(input.peak_hours, vec![20, 14, 9]);
        assert_eq!(input.top_decks.len(), 10);
        assert_eq!(input.top_decks[0].deck_id, 12);
        assert_eq!(input.top_decks[0].due_today, 60);
    }

    fn sample_coach_input() -> CoachInput {
        CoachInput {
            selected_deck: Some("Biology".into()),
            selected_deck_id: Some(1),
            reviews_30d: 350,
            retention_pct: 86.5,
            retention_goal_pct: 90.0,
            backlog_count: 12,
            forecast_7d: 140,
            forecast_30d: 580,
            studied_days: 22,
            avg_minutes_per_day: 15.0,
            leech_count: 3,
            peak_hours: vec![19, 20],
            top_decks: vec![
                CoachDeckSummary {
                    deck_id: 1,
                    name: "Biology".into(),
                    due_today: 45,
                    retention_pct: 82.0,
                },
                CoachDeckSummary {
                    deck_id: 2,
                    name: "Japanese".into(),
                    due_today: 20,
                    retention_pct: 91.5,
                },
            ],
        }
    }

    #[test]
    fn study_coach_happy_path_through_fake_provider() {
        let input = sample_coach_input();
        let valid_json = r#"{
            "summary": "Overall solid consistency, but Biology needs targeted leech remediation.",
            "advice": [
                {
                    "title": "Tackle Biology backlog",
                    "detail": "Spread the 45 overdue cards over 3 days.",
                    "deck_id": 1
                },
                {
                    "title": "Maintain Japanese momentum",
                    "detail": "High retention at 91.5%; keep daily reviews steady.",
                    "deck_id": 2
                }
            ],
            "plan": [
                {"day": 1, "reviews": 50, "new_cards": 10, "focus": "Biology leeches"},
                {"day": 2, "reviews": 45, "new_cards": 10, "focus": "Biology review"},
                {"day": 3, "reviews": 40, "new_cards": 10, "focus": "Japanese grammar"},
                {"day": 4, "reviews": 35, "new_cards": 5, "focus": "Mixed review"},
                {"day": 5, "reviews": 30, "new_cards": 5, "focus": "Catch-up"},
                {"day": 6, "reviews": 25, "new_cards": 0, "focus": "Light review"},
                {"day": 7, "reviews": 20, "new_cards": 0, "focus": "Rest and consolidate"}
            ]
        }"#;
        let fake = FakeAIProvider::with_text(valid_json);
        let res = execute_ai_action(&fake, &AIActionRequest::StudyCoach { input }).unwrap();
        assert_eq!(res.prompt_id, "study_coach@1");
        let report = res.coach_report.expect("coach_report must be populated");
        assert_eq!(report.advice.len(), 2);
        assert_eq!(report.plan.len(), 7);
        assert_eq!(report.plan[0].day, 1);
        assert_eq!(report.plan[0].reviews, 50);
        assert_eq!(report.plan[0].new_cards, 10);
    }

    fn assert_coach_format_err(raw: &str, expected: &str) {
        let input = sample_coach_input();
        let fake = FakeAIProvider::with_text(raw);
        let err = execute_ai_action(&fake, &AIActionRequest::StudyCoach { input }).unwrap_err();
        match err {
            CoreError::Format(msg) => assert!(
                msg.contains(expected),
                "expected CoreError::Format containing {expected:?}, got {msg:?}"
            ),
            other => panic!("expected CoreError::Format, got {other:?}"),
        }
    }

    #[test]
    fn study_coach_rejects_bad_json() {
        assert_coach_format_err("not json at all", "invalid study coach reply");
    }

    #[test]
    fn study_coach_rejects_empty_summary() {
        let empty_summary_json = r#"{
            "summary": "   ",
            "advice": [{"title": "Tip", "detail": "Details", "deck_id": null}],
            "plan": [
                {"day": 1, "reviews": 30, "new_cards": 5, "focus": "Day 1"},
                {"day": 2, "reviews": 30, "new_cards": 5, "focus": "Day 2"},
                {"day": 3, "reviews": 30, "new_cards": 5, "focus": "Day 3"},
                {"day": 4, "reviews": 30, "new_cards": 5, "focus": "Day 4"},
                {"day": 5, "reviews": 30, "new_cards": 5, "focus": "Day 5"},
                {"day": 6, "reviews": 30, "new_cards": 5, "focus": "Day 6"},
                {"day": 7, "reviews": 30, "new_cards": 5, "focus": "Day 7"}
            ]
        }"#;
        assert_coach_format_err(empty_summary_json, "coach summary must not be empty");
    }

    #[test]
    fn study_coach_rejects_zero_advice_items() {
        let zero_advice_json = r#"{
            "summary": "No advice items",
            "advice": [],
            "plan": [
                {"day": 1, "reviews": 30, "new_cards": 5, "focus": "Day 1"},
                {"day": 2, "reviews": 30, "new_cards": 5, "focus": "Day 2"},
                {"day": 3, "reviews": 30, "new_cards": 5, "focus": "Day 3"},
                {"day": 4, "reviews": 30, "new_cards": 5, "focus": "Day 4"},
                {"day": 5, "reviews": 30, "new_cards": 5, "focus": "Day 5"},
                {"day": 6, "reviews": 30, "new_cards": 5, "focus": "Day 6"},
                {"day": 7, "reviews": 30, "new_cards": 5, "focus": "Day 7"}
            ]
        }"#;
        assert_coach_format_err(zero_advice_json, "between 1 and 5 items");
    }

    #[test]
    fn study_coach_rejects_six_advice_items() {
        let six_advice_json = r#"{
            "summary": "Too many advice items",
            "advice": [
                {"title": "T1", "detail": "D1", "deck_id": null},
                {"title": "T2", "detail": "D2", "deck_id": null},
                {"title": "T3", "detail": "D3", "deck_id": null},
                {"title": "T4", "detail": "D4", "deck_id": null},
                {"title": "T5", "detail": "D5", "deck_id": null},
                {"title": "T6", "detail": "D6", "deck_id": null}
            ],
            "plan": [
                {"day": 1, "reviews": 30, "new_cards": 5, "focus": "Day 1"},
                {"day": 2, "reviews": 30, "new_cards": 5, "focus": "Day 2"},
                {"day": 3, "reviews": 30, "new_cards": 5, "focus": "Day 3"},
                {"day": 4, "reviews": 30, "new_cards": 5, "focus": "Day 4"},
                {"day": 5, "reviews": 30, "new_cards": 5, "focus": "Day 5"},
                {"day": 6, "reviews": 30, "new_cards": 5, "focus": "Day 6"},
                {"day": 7, "reviews": 30, "new_cards": 5, "focus": "Day 7"}
            ]
        }"#;
        assert_coach_format_err(six_advice_json, "between 1 and 5 items");
    }

    #[test]
    fn study_coach_rejects_empty_advice_title() {
        let empty_title_json = r#"{
            "summary": "Valid summary",
            "advice": [{"title": "  ", "detail": "Details", "deck_id": null}],
            "plan": [
                {"day": 1, "reviews": 30, "new_cards": 5, "focus": "Day 1"},
                {"day": 2, "reviews": 30, "new_cards": 5, "focus": "Day 2"},
                {"day": 3, "reviews": 30, "new_cards": 5, "focus": "Day 3"},
                {"day": 4, "reviews": 30, "new_cards": 5, "focus": "Day 4"},
                {"day": 5, "reviews": 30, "new_cards": 5, "focus": "Day 5"},
                {"day": 6, "reviews": 30, "new_cards": 5, "focus": "Day 6"},
                {"day": 7, "reviews": 30, "new_cards": 5, "focus": "Day 7"}
            ]
        }"#;
        assert_coach_format_err(empty_title_json, "coach advice title must not be empty");
    }

    #[test]
    fn study_coach_rejects_six_days() {
        let six_days_json = r#"{
            "summary": "Plan with only 6 days",
            "advice": [{"title": "Tip", "detail": "Details", "deck_id": null}],
            "plan": [
                {"day": 1, "reviews": 30, "new_cards": 5, "focus": "Day 1"},
                {"day": 2, "reviews": 30, "new_cards": 5, "focus": "Day 2"},
                {"day": 3, "reviews": 30, "new_cards": 5, "focus": "Day 3"},
                {"day": 4, "reviews": 30, "new_cards": 5, "focus": "Day 4"},
                {"day": 5, "reviews": 30, "new_cards": 5, "focus": "Day 5"},
                {"day": 6, "reviews": 30, "new_cards": 5, "focus": "Day 6"}
            ]
        }"#;
        assert_coach_format_err(six_days_json, "exactly 7 days");
    }

    #[test]
    fn study_coach_rejects_invalid_day_number() {
        let bad_day_json = r#"{
            "summary": "Plan with out-of-range day number",
            "advice": [{"title": "Tip", "detail": "Details", "deck_id": null}],
            "plan": [
                {"day": 8, "reviews": 30, "new_cards": 5, "focus": "Day 8"},
                {"day": 2, "reviews": 30, "new_cards": 5, "focus": "Day 2"},
                {"day": 3, "reviews": 30, "new_cards": 5, "focus": "Day 3"},
                {"day": 4, "reviews": 30, "new_cards": 5, "focus": "Day 4"},
                {"day": 5, "reviews": 30, "new_cards": 5, "focus": "Day 5"},
                {"day": 6, "reviews": 30, "new_cards": 5, "focus": "Day 6"},
                {"day": 7, "reviews": 30, "new_cards": 5, "focus": "Day 7"}
            ]
        }"#;
        assert_coach_format_err(bad_day_json, "must be 1..=7");
    }

    #[test]
    fn study_coach_rejects_number_out_of_range() {
        let out_of_range_json = r#"{
            "summary": "Reviews exceed 2000",
            "advice": [{"title": "Tip", "detail": "Details", "deck_id": null}],
            "plan": [
                {"day": 1, "reviews": 2500, "new_cards": 5, "focus": "Overload"},
                {"day": 2, "reviews": 30, "new_cards": 5, "focus": "Day 2"},
                {"day": 3, "reviews": 30, "new_cards": 5, "focus": "Day 3"},
                {"day": 4, "reviews": 30, "new_cards": 5, "focus": "Day 4"},
                {"day": 5, "reviews": 30, "new_cards": 5, "focus": "Day 5"},
                {"day": 6, "reviews": 30, "new_cards": 5, "focus": "Day 6"},
                {"day": 7, "reviews": 30, "new_cards": 5, "focus": "Day 7"}
            ]
        }"#;
        assert_coach_format_err(out_of_range_json, "reviews (2500) exceeds maximum 2000");
    }

    #[test]
    fn study_coach_rejects_unknown_deck_id() {
        let unknown_deck_json = r#"{
            "summary": "Advice references non-existent deck 999",
            "advice": [
                {"title": "Ghost deck advice", "detail": "Fix deck 999", "deck_id": 999}
            ],
            "plan": [
                {"day": 1, "reviews": 30, "new_cards": 5, "focus": "Day 1"},
                {"day": 2, "reviews": 30, "new_cards": 5, "focus": "Day 2"},
                {"day": 3, "reviews": 30, "new_cards": 5, "focus": "Day 3"},
                {"day": 4, "reviews": 30, "new_cards": 5, "focus": "Day 4"},
                {"day": 5, "reviews": 30, "new_cards": 5, "focus": "Day 5"},
                {"day": 6, "reviews": 30, "new_cards": 5, "focus": "Day 6"},
                {"day": 7, "reviews": 30, "new_cards": 5, "focus": "Day 7"}
            ]
        }"#;
        assert_coach_format_err(unknown_deck_json, "must be one of the input decks");
    }

    #[test]
    fn study_coach_prompt_contains_no_card_text() {
        let input = sample_coach_input();
        let prompt_build =
            build_action_prompt_with_locale(&AIActionRequest::StudyCoach { input }, None).unwrap();
        assert_eq!(prompt_build.prompt_id, "study_coach@1");
        let prompt_text = prompt_build.request.prompt;
        // Check numbers and deck names are present
        assert!(prompt_text.contains("Biology"));
        assert!(prompt_text.contains("350"));
        assert!(prompt_text.contains("86.5%"));
        // Invariant: no card text or html tags
        assert!(!prompt_text.contains("<div>"));
        assert!(!prompt_text.contains("<p>"));
        assert!(!prompt_text.contains("Front:"));
        assert!(!prompt_text.contains("Back:"));
    }

    #[test]
    fn a4_10_ai_requires_https_for_remote_origins_and_strips_script_after_scriptx() {
        assert!(crate::ai::normalize_provider_origin("http://api.example.com/v1").is_err());
        assert_eq!(
            crate::ai::normalize_provider_origin("https://api.example.com/v1").unwrap(),
            "https://api.example.com"
        );
        assert_eq!(
            crate::ai::normalize_provider_origin("http://localhost:11434/v1").unwrap(),
            "http://localhost:11434"
        );
        assert_eq!(
            crate::ai::normalize_provider_origin("http://127.0.0.1:11434/v1").unwrap(),
            "http://127.0.0.1:11434"
        );
        assert_eq!(
            crate::ai::normalize_provider_origin("http://[::1]:11434/v1").unwrap(),
            "http://[::1]:11434"
        );

        let plain = crate::ai::html_to_plain_text(
            "<scripty>tag</scripty><script>alert(1)</script><p>safe</p>",
        );
        assert!(!plain.contains("alert(1)"), "got: {plain}");
        assert!(plain.contains("safe"), "got: {plain}");
    }
}
