import { platform } from "@/lib/platform";
import type {
  AddNoteResult,
  AddNotesBatchResult,
  AIActionRequest,
  AIActionResult,
  AIConfig,
  AIPreviewPayload,
  AISaveConfigInput,
  AppInfo,
  ApplyQualityFixesResult,
  AvatarProfileDto,
  AvatarProfileInput,
  BackfillOutcomeDto,
  BackupInfo,
  BatchNoteInput,
  CalendarEventInput,
  CalendarOccurrenceDto,
  CardPreviewDto,
  CardRow,
  CoachInput,
  CollectionPrefs,
  CustomRewardDto,
  CustomRewardInput,
  FsrsOptimizeResult,
  DeckConfig,
  DeckProgress,
  DeckSummary,
  DuplicateGroup,
  EquipmentSlot,
  ExportEstimate,
  ExportPackageRequest,
  ExportScope,
  ExportSummary,
  FieldOptions,
  FieldRemoveWarning,
  FilteredDeckConfig,
  FindReplacePreview,
  GameDepthStateDto,
  GamePathId,
  GameStateDto,
  HabitBoardDto,
  HabitDto,
  HabitHistoryDto,
  HabitInput,
  HabitLogDto,
  HabitLogInput,
  ImportSummary,
  IpcError,
  MatrixBoardDto,
  MatrixQuadrantDto,
  MediaLibraryFilter,
  MediaLibraryPage,
  MediaReport,
  MotivationStateDto,
  NoteDetail,
  NoteOverview,
  NoteRow,
  NotetypeDetail,
  NotetypePreset,
  NotetypeSummary,
  PluginDeckDto,
  PluginInfo,
  PluginNoteDto,
  ProgressDay,
  ProgressSummaryDto,
  PurchaseResultDto,
  QuadrantKey,
  QualityNoteEdit,
  QualityScanNote,
  QuickAddConfig,
  ReminderPlanDto,
  ReminderSettingsInput,
  RenderedPreview,
  SpendHistoryEntryDto,
  StatsDto,
  StreakCalendarDto,
  StudyCardDto,
  StudyDay,
  TagCount,
  TaskDto,
  TaskInput,
  TaskListDto,
  TaskListInput,
  TaskOrderItem,
  TemplateLintHint,
  TextImportMapping,
  TextImportOptions,
  TextImportPreview,
  TextImportSummary,
  UndoAction,
  WeekStart,
  WorkloadComparisonDto,
  YesterdaySummaryDto,
} from "@bibalak/ipc-types";
import { getLocale, t } from "@/lib/i18n";

/** Answer-button rating values (match Rust `Rating`). */
export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;
export type RatingValue = (typeof Rating)[keyof typeof Rating];

/**
 * Typed wrapper over Tauri's `invoke`. The UI imports from here and never calls
 * `invoke` directly, so the command surface is discoverable and type-checked
 * against the Rust-generated `@bibalak/ipc-types`. Rejections are `IpcError`.
 */
export const ipc = {
  appInfo: () => invoke<AppInfo>("app_info"),

  // Decks
  listDecks: () => invoke<DeckSummary[]>("list_decks"),
  createDeck: (name: string) => invoke<DeckSummary>("create_deck", { name }),
  renameDeck: (id: number, name: string) => invoke<void>("rename_deck", { id, name }),
  deleteDeck: (id: number) => invoke<void>("delete_deck", { id }),
  setDeckCollapsed: (deckId: number, collapsed: boolean) =>
    invoke<void>("set_deck_collapsed", { deckId, collapsed }),

  // Full deck config (M14)
  getDeckConfig: (deckId: number) => invoke<DeckConfig>("get_deck_config", { deckId }),
  setDeckConfig: (config: DeckConfig) => invoke<void>("set_deck_config", { config }),
  getCollectionPrefs: () => invoke<CollectionPrefs>("get_collection_prefs"),
  setCollectionPrefs: (prefs: CollectionPrefs) => invoke<void>("set_collection_prefs", { prefs }),
  setLocalOffset: (minutes: number) => invoke<void>("set_local_offset", { minutes }),

  // Today's new-card limit override (Anki-style "increase today's limit")
  getTodayExtraNew: (deckId: number) => invoke<number>("get_today_extra_new", { deckId }),
  increaseTodayLimit: (deckId: number, extraNew: number) =>
    invoke<void>("increase_today_limit", { deckId, extraNew }),
  deckCardIds: (deckId: number, includeSubdecks: boolean) =>
    invoke<number[]>("deck_card_ids", { deckId, includeSubdecks }),

  // Import
  importPackage: (path: string, importId?: string) =>
    invoke<ImportSummary>("import_package", importId ? { path, importId } : { path }),
  cancelImport: (importId: string) => invoke<boolean>("cancel_import", { importId }),
  previewTextImport: (path: string, options: TextImportOptions) =>
    invoke<TextImportPreview>("preview_text_import", { path, options }),
  importText: (path: string, mapping: TextImportMapping) =>
    invoke<TextImportSummary>("import_text", { path, mapping }),

  // Media (editor image/audio insert)
  saveMedia: (bytes: Uint8Array, filename: string) =>
    invoke<string>("save_media", { bytes: Array.from(bytes), filename }),
  saveMediaFromPath: (sourcePath: string) => invoke<string>("save_media_from_path", { sourcePath }),

  // Study
  getNextCard: (deckId: number) => invoke<StudyCardDto | null>("get_next_card", { deckId }),
  answerCard: (cardId: number, rating: RatingValue, deckId: number, timeMs: number) =>
    invoke<StudyCardDto | null>("answer_card", { cardId, rating, deckId, timeMs }),

  // Note types (summary list — used by Add Note picker)
  listNotetypes: () => invoke<NotetypeSummary[]>("list_notetypes"),

  // Add note
  addNote: (notetypeId: number, deckId: number, fields: string[], tags: string[]) =>
    invoke<AddNoteResult>("add_note", { notetypeId, deckId, fields, tags }),
  addNotesBatch: (notetypeId: number, deckId: number, notes: BatchNoteInput[]) =>
    invoke<AddNotesBatchResult>("add_notes_batch", { notetypeId, deckId, notes }),
  checkDuplicate: (notetypeId: number, firstField: string) =>
    invoke<number | null>("check_duplicate", { notetypeId, firstField }),

  // Note-type editor
  getNotetype: (notetypeId: number) =>
    invoke<NotetypeDetail | null>("get_notetype", { notetypeId }),
  createNotetype: (name: string, kind: number) =>
    invoke<NotetypeDetail>("create_notetype", { name, kind }),
  listStockNotetypes: () => invoke<string[]>("list_stock_notetypes"),
  addStockNotetype: (index: number) => invoke<NotetypeDetail>("add_stock_notetype", { index }),
  deleteNotetype: (notetypeId: number) => invoke<void>("delete_notetype", { notetypeId }),
  renameNotetype: (notetypeId: number, name: string) =>
    invoke<void>("rename_notetype", { notetypeId, name }),
  addField: (notetypeId: number, name: string) => invoke<void>("add_field", { notetypeId, name }),
  checkFieldRemove: (notetypeId: number, ord: number) =>
    invoke<FieldRemoveWarning>("check_field_remove", { notetypeId, ord }),
  removeField: (notetypeId: number, ord: number) =>
    invoke<void>("remove_field", { notetypeId, ord }),
  renameField: (notetypeId: number, ord: number, name: string) =>
    invoke<void>("rename_field", { notetypeId, ord, name }),
  reorderFields: (notetypeId: number, newOrder: number[]) =>
    invoke<void>("reorder_fields", { notetypeId, newOrder }),
  saveFieldOptions: (notetypeId: number, ord: number, options: FieldOptions) =>
    invoke<void>("save_field_options", { notetypeId, ord, options }),
  setSortField: (notetypeId: number, ord: number) =>
    invoke<void>("set_sort_field", { notetypeId, ord }),
  duplicateNotetype: (notetypeId: number, copyNameBase: string) =>
    invoke<NotetypeDetail>("duplicate_notetype", { notetypeId, copyNameBase }),
  addTemplate: (notetypeId: number, name: string, qfmt: string, afmt: string) =>
    invoke<void>("add_template", { notetypeId, name, qfmt, afmt }),
  checkTemplateRemove: (notetypeId: number, ord: number) =>
    invoke<number>("check_template_remove", { notetypeId, ord }),
  removeTemplate: (notetypeId: number, ord: number) =>
    invoke<void>("remove_template", { notetypeId, ord }),
  saveTemplate: (notetypeId: number, ord: number, name: string, qfmt: string, afmt: string) =>
    invoke<void>("save_template", { notetypeId, ord, name, qfmt, afmt }),
  saveNotetypeCss: (notetypeId: number, css: string) =>
    invoke<void>("save_notetype_css", { notetypeId, css }),
  previewTemplate: (
    notetypeId: number,
    templateOrd: number,
    sampleFields: string[],
    qfmt?: string,
    afmt?: string,
  ) =>
    invoke<RenderedPreview>("preview_template", {
      notetypeId,
      templateOrd,
      sampleFields,
      qfmt: qfmt ?? null,
      afmt: afmt ?? null,
    }),
  saveNotetypePreset: (notetypeId: number, preset: NotetypePreset) =>
    invoke<NotetypeDetail>("save_notetype_preset", { notetypeId, preset }),
  lintNotetype: (notetypeId: number, qfmt?: string, afmt?: string, css?: string) =>
    invoke<TemplateLintHint[]>("lint_notetype", {
      notetypeId,
      qfmt: qfmt ?? null,
      afmt: afmt ?? null,
      css: css ?? null,
    }),

  // Browser / editor
  listNotes: (query?: string) => invoke<NoteOverview[]>("list_notes", { query: query ?? null }),
  searchNotes: (query: string) => invoke<NoteOverview[]>("search_notes", { query }),
  searchCards: (
    query: string,
    offset: number,
    sortKey?: string,
    sortAsc?: boolean,
    limit?: number,
  ) => invoke<CardRow[]>("search_cards", { query, offset, limit, sortKey, sortAsc }),
  countCards: (query: string) => invoke<number>("count_cards", { query }),
  searchNoteRows: (
    query: string,
    offset: number,
    sortKey?: string,
    sortAsc?: boolean,
    limit?: number,
  ) => invoke<NoteRow[]>("search_note_rows", { query, offset, limit, sortKey, sortAsc }),
  countNoteRows: (query: string) => invoke<number>("count_note_rows", { query }),
  previewFindReplace: (
    noteIds: number[],
    fieldName: string | null,
    find: string,
    useRegex: boolean,
    caseSensitive: boolean,
  ) =>
    invoke<FindReplacePreview>("preview_find_replace", {
      noteIds,
      fieldName,
      find,
      useRegex,
      caseSensitive,
    }),
  findReplaceNotes: (
    noteIds: number[],
    fieldName: string | null,
    find: string,
    replace: string,
    useRegex: boolean,
    caseSensitive: boolean,
  ) =>
    invoke<number>("find_replace_notes", {
      noteIds,
      fieldName,
      find,
      replace,
      useRegex,
      caseSensitive,
    }),
  findDuplicates: (notetypeId: number, fieldOrd: number) =>
    invoke<DuplicateGroup[]>("find_duplicates", { notetypeId, fieldOrd }),
  changeNoteType: (
    noteIds: number[],
    targetNotetypeId: number,
    fieldMap: Array<number | null>,
    templateMap: Array<[number, number | null]>,
  ) =>
    invoke<number>("change_note_type", {
      noteIds,
      targetNotetypeId,
      fieldMap,
      templateMap,
    }),
  getNote: (noteId: number) => invoke<NoteDetail | null>("get_note", { noteId }),
  saveNote: (noteId: number, fields: string[], tags: string[]) =>
    invoke<void>("save_note", { noteId, fields, tags }),

  // Browser bulk ops (M16)
  deleteNotes: (noteIds: number[]) => invoke<void>("delete_notes", { noteIds }),
  moveCardsToDeck: (cardIds: number[], deckId: number) =>
    invoke<void>("move_cards_to_deck", { cardIds, deckId }),
  bulkAddTag: (noteIds: number[], tag: string) => invoke<void>("bulk_add_tag", { noteIds, tag }),
  bulkRemoveTag: (noteIds: number[], tag: string) =>
    invoke<void>("bulk_remove_tag", { noteIds, tag }),

  // Tag manager (M17)
  listTags: () => invoke<string[]>("list_tags"),
  listTagCounts: () => invoke<TagCount[]>("list_tag_counts"),
  renameTag: (oldTag: string, newTag: string) => invoke<number>("rename_tag", { oldTag, newTag }),
  deleteTag: (tag: string) => invoke<number>("delete_tag", { tag }),
  mergeTags: (sources: string[], target: string) => invoke<void>("merge_tags", { sources, target }),

  // Filtered decks (M17)
  createFilteredDeck: (name: string, search: string, order: number, limit: number) =>
    invoke<DeckSummary>("create_filtered_deck", { name, search, order, limit }),
  rebuildFiltered: (deckId: number) => invoke<number>("rebuild_filtered", { deckId }),
  emptyFiltered: (deckId: number) => invoke<void>("empty_filtered", { deckId }),
  getFilteredConfig: (deckId: number) =>
    invoke<FilteredDeckConfig | null>("get_filtered_config", { deckId }),

  // Card lifecycle (M15)
  suspendCards: (cardIds: number[]) => invoke<void>("suspend_cards", { cardIds }),
  unsuspendCards: (cardIds: number[]) => invoke<void>("unsuspend_cards", { cardIds }),
  buryCards: (cardIds: number[]) => invoke<void>("bury_cards", { cardIds }),
  unburyCards: (cardIds: number[]) => invoke<void>("unbury_cards", { cardIds }),
  setCardFlag: (cardIds: number[], flag: number) =>
    invoke<void>("set_card_flag", { cardIds, flag }),
  forgetCards: (cardIds: number[], resetCounts: boolean) =>
    invoke<void>("forget_cards", { cardIds, resetCounts }),
  setDueDate: (cardIds: number[], spec: string) => invoke<void>("set_due_date", { cardIds, spec }),
  repositionNewCards: (
    cardIds: number[],
    start: number,
    step: number,
    shuffle: boolean,
    shiftExisting: boolean,
  ) => invoke<void>("reposition_new_cards", { cardIds, start, step, shuffle, shiftExisting }),
  previewCard: (cardId: number) => invoke<CardPreviewDto>("preview_card", { cardId }),

  // Undo
  undo: () => invoke<UndoAction | null>("undo"),
  undoStatus: () => invoke<UndoAction | null>("undo_status"),

  // Export
  getExportEstimate: (scope: ExportScope, includeMedia: boolean) =>
    invoke<ExportEstimate>("get_export_estimate", { scope, includeMedia }),
  exportPackage: (request: ExportPackageRequest) =>
    invoke<ExportSummary>("export_package", { request }),
  cancelExport: (exportId: string) => invoke<boolean>("cancel_export", { exportId }),

  // Statistics
  getStats: (deckId: number | null, days: number | null) =>
    invoke<StatsDto>("get_stats", {
      deckId,
      days,
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
    }),

  // FSRS optimizer (M20) & workload simulator (E9)
  optimizeFsrs: (deckId: number | null) => invoke<FsrsOptimizeResult>("optimize_fsrs", { deckId }),
  applyFsrsWeights: (deckId: number, weights: number[]) =>
    invoke<void>("apply_fsrs_weights", { deckId, weights }),
  simulateWorkload: (
    deckId: number,
    desiredRetention: number,
    newPerDay: number,
    horizonDays: number,
    weights?: number[] | null,
  ) =>
    invoke<WorkloadComparisonDto>("simulate_workload", {
      deckId,
      desiredRetention,
      newPerDay,
      horizonDays,
      weights: weights ?? null,
    }),

  // Plugins (M21 / PLG1)
  listPlugins: () => invoke<PluginInfo[]>("list_plugins"),
  enablePlugin: (id: string) => invoke<void>("enable_plugin", { id }),
  disablePlugin: (id: string) => invoke<void>("disable_plugin", { id }),
  removePlugin: (id: string) => invoke<void>("remove_plugin", { id }),
  installPlugin: (path: string) => invoke<PluginInfo>("install_plugin", { path }),
  installPluginZip: (path: string) => invoke<PluginInfo>("install_plugin_zip", { path }),
  installSamplePlugins: () => invoke<PluginInfo[]>("install_sample_plugins"),
  getPluginEntry: (id: string) => invoke<string>("get_plugin_entry", { id }),
  pluginReadDecks: (pluginId: string) => invoke<PluginDeckDto[]>("plugin_read_decks", { pluginId }),
  pluginReadNotes: (pluginId: string, query: string, limit?: number) =>
    invoke<PluginNoteDto[]>("plugin_read_notes", {
      pluginId,
      query,
      limit: limit ?? null,
    }),
  pluginCheckMediaMissing: (pluginId: string) =>
    invoke<string[]>("plugin_check_media_missing", { pluginId }),

  // Maintenance (M19)
  createBackup: () => invoke<BackupInfo>("create_backup"),
  listBackups: () => invoke<BackupInfo[]>("list_backups"),
  restoreBackup: (name: string) => invoke<void>("restore_backup", { name }),
  deleteBackup: (name: string) => invoke<void>("delete_backup", { name }),
  checkIntegrity: () => invoke<string[]>("check_integrity"),
  optimizeDb: () => invoke<void>("optimize_db"),
  checkMedia: () => invoke<MediaReport>("check_media"),
  deleteOrphanMedia: (files: string[]) => invoke<number>("delete_orphan_media", { files }),

  // Media library (E5 / M0)
  listMediaLibrary: (search: string, limit: number, offset: number, filter?: MediaLibraryFilter) =>
    invoke<MediaLibraryPage>("list_media_library", {
      search,
      filter: filter ?? null,
      limit,
      offset,
    }),
  deleteUnusedMedia: () => invoke<number>("delete_unused_media"),
  legacyMediaPending: () => invoke<boolean>("legacy_media_pending"),

  // Quick-add global shortcut & floating window (E10)
  getQuickAddConfig: () => invoke<QuickAddConfig>("get_quick_add_config"),
  setQuickAddConfig: (enabled: boolean, shortcut: string) =>
    invoke<QuickAddConfig>("set_quick_add_config", { enabled, shortcut }),
  rememberQuickAddTarget: (deckId: number | null, notetypeId: number | null) =>
    invoke<QuickAddConfig>("remember_quick_add_target", { deckId, notetypeId }),
  toggleQuickAdd: () => invoke<boolean>("toggle_quick_add"),
  hideQuickAdd: () => invoke<void>("hide_quick_add"),

  // AI assistant (E11 / AI0 / AI1)
  aiGetConfig: () => invoke<AIConfig>("ai_get_config"),
  aiSetConfig: (config: AISaveConfigInput) => invoke<AIConfig>("ai_set_config", { config }),
  aiPreviewAction: (action: AIActionRequest, appLocale: string = getLocale()) =>
    invoke<AIPreviewPayload>("ai_preview_action", { action, appLocale }),
  aiRunAction: (action: AIActionRequest, appLocale: string = getLocale()) =>
    invoke<AIActionResult>("ai_run_action", { action, appLocale }),
  aiSplitText: (text: string) => invoke<string[]>("ai_split_text", { text }),
  loadQualityNotes: (deckId: number | null, noteIds: number[] | null, leechesOnly: boolean) =>
    invoke<QualityScanNote[]>("load_quality_notes", {
      deckId,
      noteIds,
      leechesOnly,
    }),
  applyQualityFixes: (edits: QualityNoteEdit[]) =>
    invoke<ApplyQualityFixesResult>("apply_quality_fixes", { edits }),
  getCoachInput: (deckId?: number | null) =>
    invoke<CoachInput>("get_coach_input", {
      deckId: deckId ?? null,
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
    }),

  // Progress (R1 / P2 / R3)
  progressSummary: () => invoke<ProgressSummaryDto>("progress_summary"),
  progressHistory: () => invoke<ProgressDay[]>("progress_history"),
  studyDays: (limit?: number) => invoke<StudyDay[]>("study_days", { limit: limit ?? null }),
  progressByDeck: () => invoke<DeckProgress[]>("progress_by_deck"),
  yesterdaySummary: async () =>
    (await invoke<YesterdaySummaryDto | null>("yesterday_summary")) ?? null,
  dismissYesterdaySummary: (day: number) => invoke<void>("dismiss_yesterday_summary", { day }),

  // Productivity (M1)
  listTaskLists: () => invoke<TaskListDto[]>("list_task_lists"),
  createTaskList: (input: TaskListInput) => invoke<TaskListDto>("create_task_list", { input }),
  updateTaskList: (id: string, input: TaskListInput) =>
    invoke<TaskListDto>("update_task_list", { id, input }),
  deleteTaskList: (id: string) => invoke<void>("delete_task_list", { id }),
  getMatrixBoard: (includeCompleted: boolean) =>
    invoke<MatrixBoardDto>("get_matrix_board", { includeCompleted }),
  createTask: (input: TaskInput) => invoke<TaskDto>("create_task", { input }),
  updateTask: (id: string, input: TaskInput) => invoke<TaskDto>("update_task", { id, input }),
  completeTask: (id: string) => invoke<void>("complete_task", { id }),
  reopenTask: (id: string) => invoke<void>("reopen_task", { id }),
  deleteTask: (id: string) => invoke<void>("delete_task", { id }),
  reorderTasks: (items: TaskOrderItem[]) => invoke<void>("reorder_tasks", { items }),
  rescheduleOverdueTasks: (targetDate: string) =>
    invoke<number>("reschedule_overdue_tasks", { targetDate }),
  moveTaskToQuadrant: (id: string, quadrant: QuadrantKey) =>
    invoke<TaskDto>("move_task_to_quadrant", { id, quadrant }),
  saveMatrixQuadrant: (quadrant: MatrixQuadrantDto) =>
    invoke<MatrixQuadrantDto>("save_matrix_quadrant", { quadrant }),
  restoreMatrixDefaults: (quadrant?: QuadrantKey | null) =>
    invoke<MatrixQuadrantDto[]>("restore_matrix_defaults", { quadrant: quadrant ?? null }),
  getHabitBoard: (weekStartDay?: number | null, weekStart?: WeekStart | null) =>
    invoke<HabitBoardDto>("get_habit_board", {
      weekStartDay: weekStartDay ?? null,
      weekStart: weekStart ?? null,
    }),
  getHabitHistory: (habitId: string, months?: number, weekStart?: WeekStart | null) =>
    invoke<HabitHistoryDto>("get_habit_history", {
      habitId,
      months: months ?? null,
      weekStart: weekStart ?? null,
    }),
  listArchivedHabits: () => invoke<HabitDto[]>("list_archived_habits"),
  createHabit: (input: HabitInput) => invoke<HabitDto>("create_habit", { input }),
  updateHabit: (id: string, input: HabitInput) => invoke<HabitDto>("update_habit", { id, input }),
  archiveHabit: (id: string, archived: boolean) => invoke<void>("archive_habit", { id, archived }),
  deleteHabit: (id: string) => invoke<void>("delete_habit", { id }),
  logHabit: (input: HabitLogInput) => invoke<HabitLogDto>("log_habit", { input }),
  listCalendarOccurrences: (windowStartMs: number, windowEndMs: number) =>
    invoke<CalendarOccurrenceDto[]>("list_calendar_occurrences", {
      windowStartMs,
      windowEndMs,
    }),
  createCalendarEvent: (input: CalendarEventInput) =>
    invoke<CalendarOccurrenceDto>("create_calendar_event", { input }),
  updateCalendarEvent: (id: string, input: CalendarEventInput) =>
    invoke<CalendarOccurrenceDto>("update_calendar_event", { id, input }),
  deleteCalendarEvent: (id: string) => invoke<void>("delete_calendar_event", { id }),
  deleteCalendarOccurrence: (id: string, occurrenceDate: string) =>
    invoke<void>("delete_calendar_occurrence", { id, occurrenceDate }),

  // Game (R2 & R4)
  getGameState: () => invoke<GameStateDto>("get_game_state"),
  updateAvatarProfile: (input: AvatarProfileInput) =>
    invoke<AvatarProfileDto>("update_avatar_profile", { input }),
  equipGameItem: (slot: EquipmentSlot, itemKey: string) =>
    invoke<GameStateDto>("equip_game_item", { slot, itemKey }),
  unequipGameSlot: (slot: EquipmentSlot) => invoke<GameStateDto>("unequip_game_slot", { slot }),
  buyShopItem: (itemKey: string, clientTxId: string) =>
    invoke<PurchaseResultDto>("buy_shop_item", { itemKey, clientTxId }),
  refundShopPurchase: (spendId: string) =>
    invoke<GameStateDto>("refund_shop_purchase", { spendId }),
  listCustomRewards: () => invoke<CustomRewardDto[]>("list_custom_rewards"),
  createCustomReward: (input: CustomRewardInput) =>
    invoke<CustomRewardDto>("create_custom_reward", { input }),
  updateCustomReward: (id: string, input: CustomRewardInput) =>
    invoke<CustomRewardDto>("update_custom_reward", { id, input }),
  deleteCustomReward: (id: string) => invoke<void>("delete_custom_reward", { id }),
  claimCustomReward: (id: string, clientTxId: string) =>
    invoke<PurchaseResultDto>("claim_custom_reward", { id, clientTxId }),
  listSpendHistory: (limit?: number) =>
    invoke<SpendHistoryEntryDto[]>("list_spend_history", { limit: limit ?? null }),
  getGameDepthState: () => invoke<GameDepthStateDto>("get_game_depth_state"),
  chooseGamePath: (pathId: GamePathId) => invoke<GameDepthStateDto>("choose_game_path", { pathId }),
  setActivePet: (petId: string | null, mounted: boolean) =>
    invoke<GameDepthStateDto>("set_active_pet", { petId, mounted }),
  acknowledgeUnlocks: (unlockIds: string[]) => invoke<void>("acknowledge_unlocks", { unlockIds }),
  runUnlockBackfill: () => invoke<BackfillOutcomeDto>("run_unlock_backfill"),

  // Motivation (16d)
  getMotivationState: (style?: string) =>
    invoke<MotivationStateDto>("get_motivation_state", { style: style ?? null }),
  setDailyGoal: (goalXp: number) => invoke<MotivationStateDto>("set_daily_goal", { goalXp }),
  getStreakCalendar: (year: number, month: number) =>
    invoke<StreakCalendarDto>("get_streak_calendar", { year, month }),
  freezeStudyDay: (dayIndex: number) => invoke<StreakCalendarDto>("freeze_study_day", { dayIndex }),
  dismissComebackOffer: () => invoke<void>("dismiss_comeback_offer"),
  completeOnboarding: (skipped: boolean, createStarter: boolean, locale: string) =>
    invoke<void>("complete_onboarding", { skipped, createStarter, locale }),
  markMonthlyBadgeSeen: (monthKey: string) => invoke<void>("mark_monthly_badge_seen", { monthKey }),

  // Reminders (16c)
  planReminders: (settings: ReminderSettingsInput, style?: string) =>
    invoke<ReminderPlanDto>("plan_reminders", { settings, style: style ?? null }),
};

/** Backend call through the host platform (Tauri IPC on desktop). */
function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return platform.invoke<T>(command, args);
}

/**
 * Prompt for a save location for an `.apkg` export. Returns `null` if cancelled.
 */
export async function pickExportDestination(
  defaultFileName = "collection.apkg",
): Promise<string | null> {
  return platform.pickSavePath({
    defaultPath: defaultFileName,
    filters: [{ name: t("dialog.ankiPackage"), extensions: ["apkg"] }],
  });
}

/**
 * Prompt for an .apkg/.colpkg and import it. Returns the summary, or `null` if
 * the user cancelled the file picker.
 */
export async function pickAndImportPackage(importId?: string): Promise<ImportSummary | null> {
  const selected = await platform.pickPath({
    filters: [{ name: t("dialog.ankiPackage"), extensions: ["apkg", "colpkg"] }],
  });
  if (selected === null) return null;
  return ipc.importPackage(selected, importId);
}

/** True when an IPC rejection represents cooperative user cancellation. */
export function isCancelledError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "kind" in error &&
    (error as IpcError).kind === "cancelled"
  );
}

/** True when a backend is reachable (the Tauri webview; false in a plain browser via `dev:web`). */
export function isTauri(): boolean {
  return platform.isAvailable();
}

/** Narrow an unknown rejection to its human-readable message. */
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as IpcError).message);
  }
  return String(error);
}
