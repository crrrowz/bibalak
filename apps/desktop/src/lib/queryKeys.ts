import type { ExportScope, MediaLibraryFilter, TextImportOptions } from "@bibalak/ipc-types";

/**
 * Centralized TanStack Query keys. Domain events (re-emitted from the Rust core)
 * map to invalidations of these keys, keeping the UI live without polling.
 */
export const queryKeys = {
  appInfo: ["app-info"] as const,
  isPortable: ["is-portable"] as const,
  decks: ["decks"] as const,
  deck: (deckId: string) => ["decks", deckId] as const,
  queueAll: ["queue"] as const,
  queue: (deckId: string) => ["queue", deckId] as const,

  notetypes: ["notetypes"] as const,
  notetypesAll: ["notetypes"] as const,
  notetype: (id: number | null) => ["notetypes", id] as const,
  notetypesDetail: (id: number | null) => ["notetypes", id] as const,
  notetypesStock: ["notetypes", "stock"] as const,
  notetypesPreview: (id: number | null, ord: number, qfmt: string, afmt: string, css: string) =>
    ["notetypes", "preview", id, ord, qfmt, afmt, css] as const,

  notesAll: ["notes"] as const,
  notes: (query: string) => ["notes", query] as const,
  notesList: (query: string, offset: number, limit: number, sortKey: string, sortAsc: boolean) =>
    ["notes", query, offset, limit, sortKey, sortAsc] as const,
  notesCount: (query: string) => ["notes", "count", query] as const,
  notesDetail: (id: number) => ["notes", id] as const,

  cardsAll: ["cards"] as const,
  cardsList: (query: string, offset: number, limit: number, sortKey: string, sortAsc: boolean) =>
    ["cards", query, offset, limit, sortKey, sortAsc] as const,
  cardsCount: (query: string) => ["cards", "count", query] as const,
  cardsPreview: (id: number | null) => ["cards", "preview", id] as const,

  tags: ["tags"] as const,
  tagCounts: ["tags", "counts"] as const,

  statsAll: ["stats"] as const,
  stats: (deckId: number | null, days: number | null) => ["stats", deckId, days] as const,
  statsSimulateWorkload: (
    deckId: number,
    desiredRetention: number,
    newPerDay: number,
    horizonDays: number,
    weights: number[],
  ) =>
    [
      "stats",
      "simulate-workload",
      deckId,
      desiredRetention,
      newPerDay,
      horizonDays,
      weights,
    ] as const,

  mediaLibraryAll: ["media-library"] as const,
  mediaLibrary: (search: string, filter: MediaLibraryFilter, offset: number) =>
    ["media-library", search, filter, offset] as const,
  legacyMediaPending: ["legacy-media-pending"] as const,
  undoStatus: ["undo-status"] as const,

  aiConfig: ["ai-config"] as const,
  quickAddConfig: ["quick-add-config"] as const,
  backups: ["backups"] as const,
  plugins: ["plugins"] as const,
  collectionPrefs: ["collection-prefs"] as const,
  startupError: ["startup-error"] as const,
  textImportPreview: (filePath: string | null, options: TextImportOptions) =>
    ["text-import-preview", filePath, options] as const,

  progressSummary: ["progress-summary"] as const,
  progressHistory: ["progress-history"] as const,
  studyDaysAll: ["study-days"] as const,
  studyDays: (limit = 30) => ["study-days", limit] as const,
  progressByDeck: ["progress-by-deck"] as const,
  yesterdaySummary: ["yesterday-summary"] as const,
  // Productivity (M1 / PLN0)
  taskListsAll: ["task-lists"] as const,
  matrixAll: ["matrix"] as const,
  habitsAll: ["habits"] as const,
  habitHistoryAll: ["habits", "history"] as const,
  habitHistory: (habitId: string, months = 12) => ["habits", "history", habitId, months] as const,
  archivedHabits: ["habits", "archived"] as const,
  calendarAll: ["calendar"] as const,
  // Game & Styles (R2 / R4)
  gameState: ["game-state"] as const,
  customRewards: ["custom-rewards"] as const,
  spendHistory: ["spend-history"] as const,
  gameDepthState: ["game-depth-state"] as const,
  // Motivation (16d)
  motivationState: ["motivation-state"] as const,
  streakCalendarAll: ["streak-calendar"] as const,
  streakCalendar: (year: number, month: number) => ["streak-calendar", year, month] as const,
  // STUDY1
  deckPresetSharing: (configId: number | null, deckIds: number[]) =>
    ["deck-preset-sharing", configId, deckIds] as const,
  deckCardIdsAll: ["deck-card-ids"] as const,
  deckCardIds: (deckId: number | null, includeSubdecks: boolean) =>
    ["deck-card-ids", deckId, includeSubdecks] as const,
  statsFsrsDecks: (deckId: number | null, deckIds: number[]) =>
    ["stats", "fsrs-decks", deckId, deckIds] as const,
  // EXP1
  exportEstimate: (scope: ExportScope | null, includeMedia: boolean) =>
    ["export-estimate", scope, includeMedia] as const,
};
