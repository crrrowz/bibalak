/**
 * Dev-only fake backend for `preview.html`: runs the real UI in a plain browser
 * (no Tauri, no real collection) so screens can be reviewed and screenshotted
 * during design work. Never imported by the app entry (`main.tsx`), so it is
 * not part of the production bundle.
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { DeckSummary, StatsDto, StudyCardDto } from "@bibalak/ipc-types";
import { notetypeMocks } from "./mocks/notetypes";
import { noteMocks } from "./mocks/notes";
import { mockCards } from "./mocks/cards";
import { mediaMocks } from "./mocks/media";
import { aiMocks } from "./mocks/ai";
import { progressMocks } from "./mocks/progress";
import { productivityMocks } from "./mocks/productivity";
import { gameMocks } from "./mocks/game";
import { gameDepthMocks } from "./mocks/gameDepth";
import { motivationMocks } from "./mocks/motivation";
import { mockDecks } from "./mocks/decks";
import { exportMocks } from "./mocks/export";
import { pluginMocks } from "./mocks/plugins";
import { pluginHost } from "@/lib/pluginHost";

const DAY = 86_400_000;
// Stats days are offsets from `day0_ms` (collection creation day).
const day0 = Math.floor(Date.now() / DAY) - 365;
const today = 365;

const decks: DeckSummary[] = mockDecks;

/** Deterministic pseudo-random so screenshots are stable between runs. */
function wave(i: number, base: number, amp: number) {
  return Math.max(0, Math.round(base + amp * Math.sin(i * 0.7) + (i % 5) * 3));
}

const stats: StatsDto = {
  today,
  today_date: new Date().toISOString().slice(0, 10),
  dates: Object.fromEntries(
    Array.from({ length: 400 }, (_, i) => {
      const d = today - 365 + i;
      const dateStr = new Date((day0 + d) * DAY).toISOString().slice(0, 10);
      return [d, dateStr];
    }),
  ),
  total_reviews: 18_420,
  studied_days: 212,
  retention_pct: 89.4,
  retention_goal_pct: 90,
  total_time_ms: 312 * 3_600_000,
  new_count: 1_240,
  learning_count: 38,
  young_count: 2_105,
  mature_count: 5_870,
  suspended_count: 64,
  reviews: Array.from({ length: 365 }, (_, i) => {
    const d = today - 364 + i;
    return {
      day: d,
      count: i % 9 === 0 ? 0 : wave(i, 70, 40),
      date: new Date((day0 + d) * DAY).toISOString().slice(0, 10),
    };
  }),
  forecast: Array.from({ length: 30 }, (_, i) => ({
    day: i,
    count: wave(i, 90, 35),
    date: new Date((day0 + today + i) * DAY).toISOString().slice(0, 10),
  })),
  backlog_count: 0,
  day0_ms: day0 * DAY,
  retention_weekly: Array.from({ length: 12 }, (_, i) => ({
    week_index: i,
    young_total: 300,
    young_passed: 255 + (i % 4) * 6,
    mature_total: 500,
    mature_passed: 455 + (i % 3) * 8,
  })),
  answer_buttons: {
    learning: [40, 12, 210, 30],
    young: [120, 80, 1500, 220],
    mature: [260, 190, 4800, 610],
  },
  hourly: Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    total: h > 7 && h < 23 ? wave(h, 300, 150) : 0,
    passed: h > 7 && h < 23 ? wave(h, 270, 130) : 0,
  })),
  fsrs: {
    card_count: 7_975,
    stability_buckets: [420, 860, 1300, 1700, 1500, 1100, 700, 395],
    difficulty_buckets: [300, 900, 1600, 2100, 1700, 900, 475],
    avg_retrievability: 0.91,
  },
  deck_stats: decks
    .filter((d) => !d.is_filtered)
    .map((d, i) => ({
      deck_id: d.id,
      name: d.name,
      parent_id: d.parent_id,
      total_cards: 900 + i * 450,
      due_today: d.review_count + d.learning_count,
      new_count: d.new_count * 30,
      learning_count: d.learning_count,
      young_count: 300 + i * 120,
      mature_count: 500 + i * 260,
      suspended_count: i * 4,
      retention_pct: 86 + i,
      reviews_7d: 300 + i * 70,
    })),
  coach: {
    leech_count: 3,
    leech_card_ids: [102, 105, 109],
    leech_weekly_minutes: 14,
    overdue_count: 24,
    suggested_daily_reviews: 45,
  },
};

/** `preview.html?probe` adds a card script that reports whether it can reach the app window. */
const SANDBOX_PROBE =
  '<div id="probe" style="margin-top:1rem;font-size:.8rem;color:gray">template script did not run</div>' +
  "<script>var p=document.getElementById('probe');try{p.textContent='script ran; app window reachable: '+String(!!window.parent.document)}catch(e){p.textContent='script ran; app window blocked'}</script>";

const card: StudyCardDto = {
  card_id: 101,
  note_id: 1,
  deck_id: 2,
  question:
    "<div>Which drug class is first-line for <b>stable angina</b> symptom relief?</div>" +
    '<div style="margin-top:1rem;font-size:.85rem">Dose rule: \\(t_{1/2} = \\frac{0.693}{k}\\)</div>' +
    (new URLSearchParams(location.search).has("probe") ? SANDBOX_PROBE : ""),
  answer:
    "<div>Which drug class is first-line for <b>stable angina</b> symptom relief?</div><hr id=answer><div><b>Beta-blockers</b> (plus sublingual nitroglycerin as needed).</div>",
  again: "1m",
  hard: "6m",
  good: "10m",
  easy: "4d",
  new_count: 9,
  learning_count: 4,
  review_count: 41,
  card_phase: "review",
  algorithm: "fsrs",
  css: "",
};

let previewQuickAdd = {
  enabled: false,
  shortcut: "Ctrl+Shift+K",
  last_deck_id: 2 as number | null,
  last_notetype_id: 1 as number | null,
};

const responses: Record<string, unknown> = {
  app_info: {
    name: "Bibalak",
    version: "1.0.0-preview",
    tauri_version: "2",
    media_dir: "/preview/collection.media",
  },
  list_decks: decks,
  get_collection_prefs: { rollover_hour: 4 },
  get_today_extra_new: 0,
  deck_card_ids: (args: { deckId?: number; includeSubdecks?: boolean }) => {
    const id = args?.deckId ?? 1;
    const includeSubdecks = args?.includeSubdecks !== false;
    const targetDeck = decks.find((d) => d.id === id);
    if (!targetDeck) return [];
    const matchingNames = new Set(
      decks
        .filter(
          (d) =>
            !d.is_filtered &&
            (d.id === id || (includeSubdecks && d.name.startsWith(`${targetDeck.name}::`))),
        )
        .map((d) => d.name),
    );
    return mockCards.filter((c) => matchingNames.has(c.deck)).map((c) => c.card_id);
  },
  undo_status: null,
  get_stats: stats,
  simulate_workload: (args: {
    desiredRetention?: number;
    newPerDay?: number;
    horizonDays?: number;
  }) => {
    const horizon = args?.horizonDays ?? 30;
    const retDelta = ((args?.desiredRetention ?? 0.9) - 0.9) * 100;
    const newDelta = (args?.newPerDay ?? 20) - 20;
    const scale = Math.max(0.4, 1 + retDelta * 0.04 + newDelta * 0.02);
    const days = Array.from({ length: horizon }, (_, day) => {
      const current_reviews = Math.round(62 + 12 * Math.sin(day * 0.25));
      const proposed_reviews = Math.max(0, Math.round(current_reviews * scale));
      return {
        day,
        current_reviews,
        proposed_reviews,
        current_minutes: Math.round(current_reviews * 0.18 * 10) / 10,
        proposed_minutes: Math.round(proposed_reviews * 0.18 * 10) / 10,
      };
    });
    const total_current_reviews = days.reduce((s, d) => s + d.current_reviews, 0);
    const total_proposed_reviews = days.reduce((s, d) => s + d.proposed_reviews, 0);
    return {
      days,
      total_current_reviews,
      total_proposed_reviews,
      avg_daily_minutes_current:
        Math.round((days.reduce((s, d) => s + d.current_minutes, 0) / horizon) * 10) / 10,
      avg_daily_minutes_proposed:
        Math.round((days.reduce((s, d) => s + d.proposed_minutes, 0) / horizon) * 10) / 10,
    };
  },
  get_next_card: card,
  answer_card: () => {
    pluginHost.broadcastEvent({ type: "card-answered" });
    return card;
  },
  preview_card: (args: { cardId: number }) => ({
    card_id: args?.cardId ?? card.card_id,
    question: card.question,
    answer: card.answer,
    css: card.css,
  }),
  search_cards: mockCards,
  count_cards: () => mockCards.length,
  search_note_rows: () =>
    mockCards.map((c) => ({
      note_id: c.note_id,
      card_ids: [c.card_id],
      sort_field: c.sort_field,
      notetype: c.notetype,
      deck: c.deck,
      card_count: 1,
      tags: c.tags,
      mod_ms: Date.now() - 86_400_000,
    })),
  count_note_rows: () => mockCards.length,
  preview_find_replace: () => ({ notes_matched: 0, occurrences: 0 }),
  find_replace_notes: () => 0,
  find_duplicates: () => [],
  change_note_type: () => 0,
  preview_text_import: () => ({
    detected_format: "csv",
    detected_delimiter: ",",
    has_header: true,
    columns: ["Front", "Back", "Tags"],
    rows: [
      ["What is stroke volume?", "Volume pumped per beat (~70 mL)", "cardiology::phys"],
      ["المضادات الحيوية", "Antibiotics", "أدوية"],
    ],
    total_rows: 2,
    errors: [],
  }),
  import_text: () => ({
    notes_added: 2,
    notes_updated: 0,
    notes_skipped: 0,
    cards_added: 2,
    errors: [],
  }),
  list_tags: [
    "cardiology::ecg",
    "cardiology::pharm",
    "verbs",
    "kanji-n3",
    "arabic::grammar",
    "تشريح",
    "أدوية",
  ],
  list_tag_counts: [
    { name: "cardiology::ecg", count: 14 },
    { name: "cardiology::pharm", count: 9 },
    { name: "verbs", count: 24 },
    { name: "kanji-n3", count: 18 },
    { name: "arabic::grammar", count: 11 },
    { name: "تشريح", count: 7 },
    { name: "أدوية", count: 15 },
  ],
  get_quick_add_config: () => previewQuickAdd,
  set_quick_add_config: (args: { enabled: boolean; shortcut: string }) => {
    previewQuickAdd = {
      ...previewQuickAdd,
      enabled: Boolean(args?.enabled),
      shortcut: args?.shortcut?.trim() || previewQuickAdd.shortcut,
    };
    return previewQuickAdd;
  },
  remember_quick_add_target: (args: { deckId: number | null; notetypeId: number | null }) => {
    previewQuickAdd = {
      ...previewQuickAdd,
      last_deck_id: args?.deckId ?? previewQuickAdd.last_deck_id,
      last_notetype_id: args?.notetypeId ?? previewQuickAdd.last_notetype_id,
    };
    return previewQuickAdd;
  },
  toggle_quick_add: () => previewQuickAdd.enabled,
  hide_quick_add: () => null,
  legacy_media_pending: () =>
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("legacy") === "pending",
  plan_reminders: () => ({ items: [], next_rollover_ms: Date.now() + DAY }),
  ...notetypeMocks,
  ...noteMocks,
  ...mediaMocks,
  ...aiMocks,
  ...progressMocks,
  ...productivityMocks,
  ...gameMocks,
  ...gameDepthMocks,
  ...motivationMocks,
  ...pluginMocks,
  ...exportMocks,
};

export function installPreviewMocks() {
  (globalThis as Record<string, unknown>).__BIBALAK_PREVIEW__ = true;
  mockWindows("main");
  mockIPC(
    (cmd, args) => {
      if (cmd === "search_cards" || cmd === "search_note_rows") {
        const {
          query = "",
          offset = 0,
          limit = 500,
          sortKey,
          sortAsc,
        } = (args ?? {}) as {
          query?: string;
          offset?: number;
          limit?: number;
          sortKey?: string;
          sortAsc?: boolean;
        };
        const q = query.trim().toLowerCase();
        const filtered = q
          ? mockCards.filter((c) => {
              if (q.startsWith("tag:")) {
                const tagNeedle = q.slice(4);
                return c.tags.some((t) => t === tagNeedle || t.startsWith(`${tagNeedle}::`));
              }
              return (
                c.sort_field.toLowerCase().includes(q) ||
                c.deck.toLowerCase().includes(q) ||
                c.tags.some((t) => t.toLowerCase().includes(q))
              );
            })
          : [...mockCards];
        if (sortKey) {
          filtered.sort((a, b) => {
            let va = a[sortKey as keyof typeof a];
            let vb = b[sortKey as keyof typeof b];
            if (typeof va === "string") va = va.toLowerCase();
            if (typeof vb === "string") vb = vb.toLowerCase();
            const asc = sortAsc !== false;
            return asc ? (va < vb ? -1 : va > vb ? 1 : 0) : va > vb ? -1 : va < vb ? 1 : 0;
          });
        }
        const slice = filtered.slice(offset, offset + (limit ?? 500));
        if (cmd === "search_note_rows") {
          return slice.map((c) => ({
            note_id: c.note_id,
            card_ids: [c.card_id],
            sort_field: c.sort_field,
            notetype: c.notetype,
            deck: c.deck,
            card_count: 1,
            tags: c.tags,
            mod_ms: Date.now() - 86_400_000,
          }));
        }
        return slice;
      }
      if (cmd === "count_cards" || cmd === "count_note_rows") {
        const { query = "" } = (args ?? {}) as { query?: string };
        const q = query.trim().toLowerCase();
        if (!q) return mockCards.length;
        return mockCards.filter((c) => {
          if (q.startsWith("tag:")) {
            const tagNeedle = q.slice(4);
            return c.tags.some((t) => t === tagNeedle || t.startsWith(`${tagNeedle}::`));
          }
          return (
            c.sort_field.toLowerCase().includes(q) ||
            c.deck.toLowerCase().includes(q) ||
            c.tags.some((t) => t.toLowerCase().includes(q))
          );
        }).length;
      }
      const handler = responses[cmd];
      if (typeof handler === "function") return (handler as (a: unknown) => unknown)(args);
      if (cmd in responses) return responses[cmd];
      if (cmd === "add_note") return { note_id: 999, cards_added: 1 };
      if (cmd === "add_notes_batch") {
        const notes = ((args as { notes?: unknown[] } | undefined)?.notes ?? []) as unknown[];
        return {
          note_ids: notes.map((_, i) => 1000 + i),
          cards_added: notes.length,
        };
      }
      if (cmd.startsWith("list_") || cmd.startsWith("search_")) return [];
      return null;
    },
    { shouldMockEvents: true },
  );
}
