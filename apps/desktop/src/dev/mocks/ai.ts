import type {
  AIActionRequest,
  AIActionResult,
  AIConfig,
  AIPreviewPayload,
  AISaveConfigInput,
  ApplyQualityFixesResult,
  CoachInput,
  CoachReport,
  QualityNoteEdit,
  QualityScanNote,
} from "@bibalak/ipc-types";

let previewAiConfig: AIConfig = {
  enabled: true,
  provider: "open-ai-compatible",
  base_url: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  has_api_key: true,
};

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/v1$/, "");
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitPreviewText(text: string, maxChars = 6000): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];
  const parts: string[] = [];
  let rest = trimmed;
  while (rest.length > maxChars) {
    let idx = rest.lastIndexOf("\n\n", maxChars);
    if (idx < maxChars * 0.4) idx = rest.lastIndexOf(" ", maxChars);
    if (idx <= 0) idx = maxChars;
    parts.push(rest.slice(0, idx).trim());
    rest = rest.slice(idx).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export const aiMocks = {
  ai_get_config: () => previewAiConfig,
  ai_set_config: (args: { config: AISaveConfigInput }) => {
    const cfg = args?.config;
    previewAiConfig = {
      enabled: Boolean(cfg?.enabled),
      provider: cfg?.provider ?? previewAiConfig.provider,
      base_url: cfg?.base_url ?? previewAiConfig.base_url,
      model: cfg?.model ?? previewAiConfig.model,
      has_api_key:
        cfg?.api_key === undefined || cfg.api_key === null
          ? previewAiConfig.has_api_key
          : cfg.api_key.trim().length > 0,
    };
    return previewAiConfig;
  },
  ai_split_text: (args: { text: string }) => splitPreviewText(args?.text ?? ""),
  ai_preview_action: (args: { action: AIActionRequest; appLocale?: string }): AIPreviewPayload => {
    const action = args.action;
    const origin = originOf(previewAiConfig.base_url);
    const arFallback = args.appLocale === "ar" ? " (Arabic fallback enabled)" : "";
    if (action.kind === "explain-card") {
      return {
        provider: previewAiConfig.provider,
        endpoint_origin: origin,
        model: previewAiConfig.model,
        system: `You are a concise study tutor. Explain why the answer follows from the prompt, highlight subtle traps, and keep it brief in plain text. Language rule: Answer in the card's language, or the app language when unclear.${arFallback}`,
        prompt: `Front:\n${stripTags(action.front_html)}\n\nBack:\n${stripTags(action.back_html)}`,
      };
    }
    if (action.kind === "suggest-back") {
      return {
        provider: previewAiConfig.provider,
        endpoint_origin: origin,
        model: previewAiConfig.model,
        system:
          "Draft a concise, accurate flashcard answer in plain text without wrapper commentary.",
        prompt: `Draft Back for:\n${stripTags(action.front_html)}`,
      };
    }
    if (action.kind === "rewrite-leech") {
      return {
        provider: previewAiConfig.provider,
        endpoint_origin: origin,
        model: previewAiConfig.model,
        system: "Rewrite this leech so it is atomic and clear.",
        prompt: action.fields.map((f) => `[${f.name}]\n${stripTags(f.value_html)}`).join("\n\n"),
      };
    }
    if (action.kind === "generate-cards") {
      const schemaHint =
        action.note_kind === "cloze"
          ? 'Return STRICT JSON only: {"cards":[{"text":"... {{c1::...}} ..."}]}'
          : 'Return STRICT JSON only: {"cards":[{"front":"...","back":"..."}]}';
      return {
        provider: previewAiConfig.provider,
        endpoint_origin: origin,
        model: previewAiConfig.model,
        system: `You turn study notes into concise, atomic flashcards in plain text without wrapper commentary. ${schemaHint}${arFallback}`,
        prompt: `Target cards: at most ${action.count}\n\nStudy notes:\n${stripTags(action.text)}`,
      };
    }
    if (action.kind === "tutor-example") {
      return {
        provider: previewAiConfig.provider,
        endpoint_origin: origin,
        model: previewAiConfig.model,
        system: `You are a concise study tutor. Give one concrete, memorable example.${arFallback}`,
        prompt: `Front:\n${stripTags(action.front_html)}\n\nBack:\n${stripTags(action.back_html)}`,
      };
    }
    if (action.kind === "tutor-mnemonic") {
      return {
        provider: previewAiConfig.provider,
        endpoint_origin: origin,
        model: previewAiConfig.model,
        system: `You are a concise study tutor. Create a short mnemonic or memory hook.${arFallback}`,
        prompt: `Front:\n${stripTags(action.front_html)}\n\nBack:\n${stripTags(action.back_html)}`,
      };
    }
    if (action.kind === "tutor-translate") {
      return {
        provider: previewAiConfig.provider,
        endpoint_origin: origin,
        model: previewAiConfig.model,
        system:
          "You are a precise bilingual translator. Translation direction: Translate between Arabic and English.",
        prompt: `Front:\n${stripTags(action.front_html)}\n\nBack:\n${stripTags(action.back_html)}`,
      };
    }
    if (action.kind === "tutor-why-wrong") {
      const typed = action.typed_answer?.trim()
        ? `\n\nLearner's typed answer:\n${action.typed_answer.trim()}`
        : "";
      return {
        provider: previewAiConfig.provider,
        endpoint_origin: origin,
        model: previewAiConfig.model,
        system: `You are a concise study tutor. Explain why the learner missed this card.${arFallback}`,
        prompt: `Front:\n${stripTags(action.front_html)}\n\nBack:\n${stripTags(action.back_html)}${typed}`,
      };
    }
    if (action.kind === "review-quality") {
      const notesPreview = action.notes
        .slice(0, 3)
        .map(
          (n) =>
            `--- Note ${n.note_id} (lapses: ${n.lapses}, tags: ${n.tags.join(" ") || "(none)"}) ---\n` +
            n.fields
              .map((f, i) => `[Field ${i + 1}: ${f.name}]\n${stripTags(f.value_html)}`)
              .join("\n"),
        )
        .join("\n\n");
      return {
        provider: previewAiConfig.provider,
        endpoint_origin: origin,
        model: previewAiConfig.model,
        system: `You audit spaced-repetition flashcards for clarity, atomicity, duplicate meaning, and helpful tags.${arFallback}`,
        prompt: `${action.deck_name ? `Deck: ${action.deck_name}\n\n` : ""}${notesPreview}`,
      };
    }
    if (action.kind === "study-coach") {
      const input = action.input;
      let prompt = `Study stats for ${input.selected_deck ? `deck "${input.selected_deck}"` : "whole collection"}:\n`;
      prompt += `Reviews in last 30 days: ${input.reviews_30d}\n`;
      prompt += `Retention vs goal: ${input.retention_pct}% vs ${input.retention_goal_pct}%\n`;
      prompt += `Overdue backlog: ${input.backlog_count} cards\n`;
      prompt += `Due in next 7 days: ${input.forecast_7d} cards\n`;
      prompt += `Due in next 30 days: ${input.forecast_30d} cards\n`;
      prompt += `Studied days: ${input.studied_days}\n`;
      prompt += `Average time per studied day: ${input.avg_minutes_per_day} minutes\n`;
      prompt += `Leeches count: ${input.leech_count}\n`;
      prompt += `Peak study hours: ${input.peak_hours.join(", ")}\n`;
      if (input.top_decks.length > 0) {
        prompt += "Top decks by due count:\n";
        for (const d of input.top_decks) {
          prompt += `- [${d.deck_id}] ${d.name}: ${d.due_today} due today, ${d.retention_pct}% retention\n`;
        }
      }
      return {
        provider: previewAiConfig.provider,
        endpoint_origin: origin,
        model: previewAiConfig.model,
        system: `You are an expert spaced repetition coach. Analyze metrics and provide targeted advice and a 7-day study plan.${arFallback}`,
        prompt,
      };
    }
    return {
      provider: previewAiConfig.provider,
      endpoint_origin: origin,
      model: previewAiConfig.model,
      system: "Respond briefly with OK.",
      prompt: "Connection check from Bibalak.",
    };
  },
  ai_run_action: (args: { action: AIActionRequest }): AIActionResult => {
    const action = args.action;
    if (action.kind === "test-connection") {
      return {
        prompt_id: "test_connection@1",
        text: "OK",
        suggested_fields: null,
        generated_cards: null,
        quality_findings: null,
        input_tokens: 8,
        output_tokens: 1,
      };
    }
    if (action.kind === "explain-card") {
      return {
        prompt_id: "explain_card@1",
        text: "This card links the core concept directly to its clinical cue so you can distinguish it quickly during review.",
        suggested_fields: null,
        generated_cards: null,
        quality_findings: null,
        input_tokens: 42,
        output_tokens: 18,
      };
    }
    if (action.kind === "suggest-back") {
      return {
        prompt_id: "suggest_back@1",
        text: "Suggested concise answer based on the prompt.",
        suggested_fields: null,
        generated_cards: null,
        quality_findings: null,
        input_tokens: 28,
        output_tokens: 9,
      };
    }
    if (action.kind === "generate-cards") {
      if (action.note_kind === "cloze") {
        const drafts = [
          {
            kind: "cloze" as const,
            text: "The {{c1::mitral}} valve separates the left atrium from left ventricle.",
          },
          {
            kind: "cloze" as const,
            text: "The {{c1::sinoatrial (SA) node}} initiates normal cardiac depolarization.",
          },
          {
            kind: "cloze" as const,
            text: "Digoxin inhibits the {{c1::Na+/K+-ATPase}} pump in cardiac myocytes.",
          },
        ].slice(0, action.count);
        return {
          prompt_id: "generate_cards@1",
          text: JSON.stringify({ cards: drafts }),
          suggested_fields: null,
          generated_cards: drafts,
          quality_findings: null,
          input_tokens: 120,
          output_tokens: 68,
        };
      }
      const drafts = [
        {
          kind: "basic" as const,
          front: "What is the primary pacemaker of the heart?",
          back: "Sinoatrial (SA) node",
        },
        {
          kind: "basic" as const,
          front: "Which receptor mediates beta-blocker negative chronotropy?",
          back: "Cardiac beta-1 adrenergic receptors",
        },
        {
          kind: "basic" as const,
          front: "What is the classic ECG finding in atrial fibrillation?",
          back: "Irregularly irregular rhythm with absent discrete P waves",
        },
      ].slice(0, action.count);
      return {
        prompt_id: "generate_cards@1",
        text: JSON.stringify({ cards: drafts }),
        suggested_fields: null,
        generated_cards: drafts,
        quality_findings: null,
        input_tokens: 118,
        output_tokens: 74,
      };
    }
    if (action.kind === "rewrite-leech") {
      const rewritten = action.fields.map((f, i) =>
        i === 0 ? `${stripTags(f.value_html)} (one clear cue)` : `${stripTags(f.value_html)}`,
      );
      return {
        prompt_id: "rewrite_leech@1",
        text: JSON.stringify({ fields: rewritten }),
        suggested_fields: rewritten,
        generated_cards: null,
        quality_findings: null,
        input_tokens: 55,
        output_tokens: 22,
      };
    }
    if (action.kind === "tutor-example") {
      return {
        prompt_id: "tutor_example@1",
        text: "For example, prescribing metoprolol before physical exertion lowers heart rate and myocardial oxygen demand.",
        suggested_fields: null,
        generated_cards: null,
        quality_findings: null,
        input_tokens: 46,
        output_tokens: 19,
      };
    }
    if (action.kind === "tutor-mnemonic") {
      return {
        prompt_id: "tutor_mnemonic@1",
        text: "Think 'B for Brakes': Beta-blockers put the brakes on heart rate in stable angina.",
        suggested_fields: null,
        generated_cards: null,
        quality_findings: null,
        input_tokens: 44,
        output_tokens: 17,
      };
    }
    if (action.kind === "tutor-translate") {
      return {
        prompt_id: "tutor_translate@1",
        text: "ما هي الفئة الدوائية الخط الأول لتخفيف أعراض الذبحة الصدرية المستقرة؟\nالجواب: حاصرات بيتا (Beta-blockers).",
        suggested_fields: null,
        generated_cards: null,
        quality_findings: null,
        input_tokens: 48,
        output_tokens: 26,
      };
    }
    if (action.kind === "tutor-why-wrong") {
      return {
        prompt_id: "tutor_why_wrong@1",
        text: action.typed_answer?.trim()
          ? `Your answer ("${action.typed_answer.trim()}") focused on another drug class; Beta-blockers remain first-line for chronic demand reduction in stable angina.`
          : "Look closely at the trigger word 'stable angina': long-term baseline control relies on beta-blockers rather than rescue vasodilators alone.",
        suggested_fields: null,
        generated_cards: null,
        quality_findings: null,
        input_tokens: 52,
        output_tokens: 28,
      };
    }
    if (action.kind === "review-quality") {
      const notes = action.notes;
      const firstId = notes[0]?.note_id ?? 1;
      const secondId = notes[1]?.note_id ?? firstId;
      const thirdId = notes[2]?.note_id ?? firstId;
      const findings =
        firstId === 101
          ? [
              {
                kind: "unclear" as const,
                note_id: firstId,
                reason:
                  "Prompt asks 'Why?' without specifying the clinical scenario or target organ.",
              },
              {
                kind: "overloaded" as const,
                note_id: secondId,
                reason:
                  "Covers four separate hemodynamic parameters (preload, afterload, CO, EF) in one card.",
              },
              {
                kind: "duplicate-meaning" as const,
                note_id: thirdId,
                other_note_id: firstId,
                reason:
                  "Tests essentially the same beta-blocker stable angina indication as Note #101.",
              },
              {
                kind: "suggested-tags" as const,
                note_id: thirdId,
                tags: ["cardiology", "pharmacology", "high-yield"],
                reason: "Adding discipline and yield tags helps filter before exams.",
              },
              {
                kind: "rewrite" as const,
                note_id: firstId,
                fields: [
                  "Why are beta-blockers first-line for stable angina?",
                  "They lower heart rate and contractility, reducing myocardial oxygen demand.",
                ],
                reason: "Focuses on a single mechanistic cue instead of a vague question.",
              },
              {
                kind: "cloze-split" as const,
                note_id: secondId,
                clozes: [
                  "Preload is determined primarily by {{c1::venous return (EDV)}}.",
                  "Afterload reflects {{c1::systemic vascular resistance}}.",
                ],
                reason:
                  "Splitting overloaded parameters into separate atomic cloze cards boosts recall.",
              },
            ]
          : [];
      return {
        prompt_id: "review_quality@1",
        text: JSON.stringify({ findings }),
        suggested_fields: null,
        generated_cards: null,
        quality_findings: findings,
        input_tokens: notes.length * 42,
        output_tokens: findings.length * 36,
      };
    }
    if (action.kind === "study-coach") {
      const topDeck = action.input.top_decks[0];
      const targetDeckId = action.input.selected_deck_id ?? (topDeck ? topDeck.deck_id : null);
      const report: CoachReport = {
        summary:
          "Your overall retention is solid, but overdue reviews are concentrating in your high-priority decks. Pacing your backlog over the next 5 days while capping new cards will restore optimal retention without review fatigue.",
        advice: [
          {
            title: "Clear overdue backlog gradually",
            detail:
              "Clear 30–40 overdue reviews per day before opening new cards to maintain long-term memory stability.",
            deck_id: targetDeckId,
          },
          {
            title: "Study during peak retention hours",
            detail:
              "Your performance is strongest in morning hours. Schedule your most challenging cards then.",
            deck_id: null,
          },
          {
            title: "Review troublesome leeches",
            detail:
              "Several cards have lapsed repeatedly. Consider suspending or rewriting them to protect your daily pace.",
            deck_id: null,
          },
        ],
        plan: [
          { day: 1, reviews: 45, new_cards: 5, focus: "Tackle overdue cards in morning session" },
          {
            day: 2,
            reviews: 40,
            new_cards: 5,
            focus: "Maintain steady review pace on high-due deck",
          },
          {
            day: 3,
            reviews: 35,
            new_cards: 10,
            focus: "Consolidate learning cards before adding new material",
          },
          { day: 4, reviews: 30, new_cards: 10, focus: "Quick review session during peak hour" },
          {
            day: 5,
            reviews: 25,
            new_cards: 15,
            focus: "Catch-up buffer day and rewrite troublesome leeches",
          },
          {
            day: 6,
            reviews: 25,
            new_cards: 15,
            focus: "Light weekend review to keep streak alive",
          },
          {
            day: 7,
            reviews: 20,
            new_cards: 10,
            focus: "Weekly review audit and deck balance check",
          },
        ],
      };
      return {
        prompt_id: "study_coach@1",
        text: JSON.stringify(report),
        suggested_fields: null,
        generated_cards: null,
        quality_findings: null,
        coach_report: report,
        input_tokens: 175,
        output_tokens: 220,
      };
    }
    return {
      prompt_id: "explain_card@1",
      text: "",
      suggested_fields: null,
      generated_cards: null,
      quality_findings: null,
      input_tokens: 0,
      output_tokens: 0,
    };
  },
  load_quality_notes: (args: {
    deckId?: number | null;
    noteIds?: number[] | null;
    leechesOnly?: boolean;
  }): QualityScanNote[] => {
    const sampleNotes: QualityScanNote[] = [
      {
        note_id: 101,
        deck_id: args?.deckId ?? 1,
        notetype_id: 1,
        notetype_kind: 0,
        notetype_css: "",
        fields: [
          { name: "Front", value_html: "Why beta blockers?" },
          { name: "Back", value_html: "Decrease HR and contractility in angina and HF." },
        ],
        tags: ["leech", "cardio"],
        lapses: 6,
        card_ids: [1001],
      },
      {
        note_id: 102,
        deck_id: args?.deckId ?? 1,
        notetype_id: 1,
        notetype_kind: 0,
        notetype_css: "",
        fields: [
          {
            name: "Front",
            value_html: "Explain preload, afterload, stroke volume, and ejection fraction.",
          },
          {
            name: "Back",
            value_html: "EDV stretch, arterial resistance, volume per beat, SV/EDV.",
          },
        ],
        tags: ["cardio"],
        lapses: 3,
        card_ids: [1002],
      },
      {
        note_id: 103,
        deck_id: args?.deckId ?? 1,
        notetype_id: 1,
        notetype_kind: 0,
        notetype_css: "",
        fields: [
          {
            name: "Front",
            value_html: "What drug class reduces myocardial O2 demand in chronic stable angina?",
          },
          { name: "Back", value_html: "Beta-blockers" },
        ],
        tags: [],
        lapses: 1,
        card_ids: [1003],
      },
      ...Array.from({ length: 19 }, (_, idx) => ({
        note_id: 104 + idx,
        deck_id: args?.deckId ?? 1,
        notetype_id: 1,
        notetype_kind: 0,
        notetype_css: "",
        fields: [
          { name: "Front", value_html: `Cardiology concept ${idx + 4}` },
          { name: "Back", value_html: `Key physiological takeaway ${idx + 4}` },
        ],
        tags: ["cardio"],
        lapses: 0,
        card_ids: [1004 + idx],
      })),
    ];

    let filtered = sampleNotes;
    if (args?.noteIds && args.noteIds.length > 0) {
      const wanted = new Set(args.noteIds);
      filtered = sampleNotes.slice(0, args.noteIds.length).map((n, i) => ({
        ...n,
        note_id: args.noteIds![i] ?? n.note_id,
      }));
      if (sampleNotes.some((n) => wanted.has(n.note_id))) {
        filtered = sampleNotes.filter((n) => wanted.has(n.note_id));
      }
    }
    if (args?.leechesOnly) {
      filtered = filtered.filter((n) => n.tags.includes("leech"));
    }
    return filtered;
  },
  apply_quality_fixes: (args: { edits: QualityNoteEdit[] }): ApplyQualityFixesResult => ({
    notes_updated: args?.edits?.length ?? 0,
    note_ids: (args?.edits ?? []).map((e) => e.note_id),
  }),
  get_coach_input: (args?: { deckId?: number | null }): CoachInput => ({
    selected_deck: args?.deckId ? "Default" : null,
    selected_deck_id: args?.deckId ?? null,
    reviews_30d: 340,
    retention_pct: 88.5,
    retention_goal_pct: 90.0,
    backlog_count: 42,
    forecast_7d: 185,
    forecast_30d: 520,
    studied_days: 26,
    avg_minutes_per_day: 18.4,
    leech_count: 6,
    peak_hours: [9, 14, 20],
    top_decks: [
      { deck_id: 1, name: "Default", due_today: 28, retention_pct: 89.2 },
      { deck_id: 2, name: "Medical::Pharmacology", due_today: 14, retention_pct: 86.4 },
    ],
  }),
};
