import type {
  CalendarEventInput,
  CalendarOccurrenceDto,
  CalendarRecurrence,
  HabitBoardDto,
  HabitDayRingDto,
  HabitDto,
  HabitHistoryDto,
  HabitInput,
  HabitLogDto,
  HabitLogInput,
  HabitLogStatus,
  MatrixBoardDto,
  MatrixDateFilter,
  MatrixDeckDueItemDto,
  MatrixQuadrantDto,
  QuadrantKey,
  QuadrantRule,
  TaskDto,
  TaskInput,
  TaskListDto,
  TaskListInput,
  TaskOrderItem,
  UndoAction,
  WeekStart,
} from "@bibalak/ipc-types";
import { mockDecks } from "./decks";

function isoDateOffset(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localInstantMs(daysOffset: number, hour: number, minute: number): number {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function utcMidnightMs(daysOffset: number): number {
  const iso = isoDateOffset(daysOffset);
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

const todayDate = () => isoDateOffset(0);

interface StoredTask {
  id: string;
  list_id: string | null;
  title: string;
  notes: string;
  priority: TaskDto["priority"];
  manual_quadrant: QuadrantKey | null;
  due_date: string | null;
  scheduled_start_ms: number | null;
  scheduled_end_ms: number | null;
  tags: string[];
  deck_id: number | null;
  completed_at: number | null;
  completed_day: number | null;
  sort_order: number;
  deleted: boolean;
}

const DEFAULT_QUADRANTS: MatrixQuadrantDto[] = [
  {
    quadrant_key: "q1",
    title: "",
    color_token: "danger",
    group_by: "none",
    sort_by: "date",
    rule: {
      lists: { mode: "all" },
      date_filters: ["overdue", "today", "tomorrow"],
      priorities: ["high"],
      types: null,
      pinned_deck_ids: [],
      excluded_deck_ids: [],
    },
  },
  {
    quadrant_key: "q2",
    title: "",
    color_token: "warning",
    group_by: "none",
    sort_by: "date",
    rule: {
      lists: { mode: "all" },
      date_filters: null,
      priorities: ["high", "medium"],
      types: null,
      pinned_deck_ids: [],
      excluded_deck_ids: [],
    },
  },
  {
    quadrant_key: "q3",
    title: "",
    color_token: "info",
    group_by: "none",
    sort_by: "date",
    rule: {
      lists: { mode: "all" },
      date_filters: ["overdue", "today", "tomorrow"],
      priorities: ["low", "none"],
      types: null,
      pinned_deck_ids: [],
      excluded_deck_ids: [],
    },
  },
  {
    quadrant_key: "q4",
    title: "",
    color_token: "success",
    group_by: "none",
    sort_by: "date",
    rule: {
      lists: { mode: "all" },
      date_filters: null,
      priorities: ["low", "none"],
      types: null,
      pinned_deck_ids: [],
      excluded_deck_ids: [],
    },
  },
];

let nextSeq = 100;
function mockUuid(): string {
  nextSeq += 1;
  return `00000000-0000-4000-8000-${String(nextSeq).padStart(12, "0")}`;
}

let taskLists: TaskListDto[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Study Plan",
    color_token: "accent",
    icon_key: null,
    sort_order: 0,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Admin",
    color_token: "accent",
    icon_key: null,
    sort_order: 1,
  },
];

let quadrants: MatrixQuadrantDto[] = DEFAULT_QUADRANTS.map((q) => ({
  ...q,
  rule: { ...q.rule },
}));

let tasks: StoredTask[] = [
  {
    id: "00000000-0000-4000-8000-000000000011",
    list_id: "00000000-0000-4000-8000-000000000001",
    title: "Finish pharmacology weak-cards review",
    notes: "Focus on antiarrhythmics and beta-blockers.",
    priority: "high",
    manual_quadrant: null,
    due_date: isoDateOffset(0),
    scheduled_start_ms: localInstantMs(0, 15, 0),
    scheduled_end_ms: localInstantMs(0, 16, 0),
    tags: ["pharmacology", "exam"],
    deck_id: 2,
    completed_at: null,
    completed_day: null,
    sort_order: 0,
    deleted: false,
  },
  // PLN2 — Overdue task and spaced sort_order values for Matrix preview
  {
    id: "00000000-0000-4000-8000-000000000015",
    list_id: "00000000-0000-4000-8000-000000000001",
    title: "Review renal physiology cases",
    notes: "Check loop diuretics summary before quiz.",
    priority: "high",
    manual_quadrant: null,
    due_date: isoDateOffset(-2),
    scheduled_start_ms: null,
    scheduled_end_ms: null,
    tags: ["physiology", "exam"],
    deck_id: null,
    completed_at: null,
    completed_day: null,
    sort_order: 10,
    deleted: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000012",
    list_id: "00000000-0000-4000-8000-000000000001",
    title: "Outline Spanish subjunctive deck",
    notes: "",
    priority: "medium",
    manual_quadrant: null,
    due_date: isoDateOffset(4),
    scheduled_start_ms: null,
    scheduled_end_ms: null,
    tags: ["spanish"],
    deck_id: 4,
    completed_at: null,
    completed_day: null,
    sort_order: 20,
    deleted: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000013",
    list_id: "00000000-0000-4000-8000-000000000002",
    title: "Submit lab attendance form",
    notes: "",
    priority: "low",
    manual_quadrant: null,
    due_date: isoDateOffset(1),
    scheduled_start_ms: null,
    scheduled_end_ms: null,
    tags: ["admin"],
    deck_id: null,
    completed_at: null,
    completed_day: null,
    sort_order: 30,
    deleted: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000014",
    list_id: null,
    title: "Organize old lecture slides",
    notes: "",
    priority: "none",
    manual_quadrant: null,
    due_date: null,
    scheduled_start_ms: null,
    scheduled_end_ms: null,
    tags: [],
    deck_id: null,
    completed_at: null,
    completed_day: null,
    sort_order: 40,
    deleted: false,
  },
];

interface UndoEntry {
  action: UndoAction;
  restore: () => void;
}
const undoStack: UndoEntry[] = [];

function matchesDateFilters(
  dueDate: string | null,
  filters: MatrixDateFilter[],
  today: string,
): boolean {
  const tomorrow = isoDateOffset(1);
  const plus7 = isoDateOffset(7);
  const ym = today.slice(0, 7);
  return filters.some((f) => {
    switch (f) {
      case "no_date":
        return dueDate === null;
      case "overdue":
        return dueDate !== null && dueDate < today;
      case "today":
        return dueDate === today;
      case "tomorrow":
        return dueDate === tomorrow;
      case "next7_days":
        return dueDate !== null && dueDate >= today && dueDate < plus7;
      case "this_month":
        return dueDate !== null && dueDate.slice(0, 7) === ym;
    }
  });
}

function matchesRule(task: StoredTask, rule: QuadrantRule, today: string): boolean {
  if (rule.types && !rule.types.includes("task")) return false;
  if (rule.lists.mode === "inbox" && task.list_id !== null) return false;
  if (rule.lists.mode === "custom") {
    const inList = task.list_id !== null && rule.lists.list_ids.includes(task.list_id);
    const inDeck = task.deck_id !== null && rule.lists.deck_ids.includes(task.deck_id);
    if (!inList && !inDeck) return false;
  }
  if (rule.priorities && !rule.priorities.includes(task.priority)) return false;
  if (rule.date_filters && !matchesDateFilters(task.due_date, rule.date_filters, today)) {
    return false;
  }
  return true;
}

function evaluateTaskQuadrant(task: StoredTask, today: string): QuadrantKey | null {
  if (task.deleted || task.completed_at !== null) return null;
  if (task.manual_quadrant) return task.manual_quadrant;
  for (const key of ["q1", "q2", "q3", "q4"] as const) {
    const q = quadrants.find((item) => item.quadrant_key === key);
    if (q && matchesRule(task, q.rule, today)) return key;
  }
  return null;
}

function toTaskDto(task: StoredTask, today: string): TaskDto {
  const list = task.list_id ? taskLists.find((l) => l.id === task.list_id) : undefined;
  const deck = task.deck_id ? mockDecks.find((d) => d.id === task.deck_id) : undefined;
  return {
    id: task.id,
    list_id: task.list_id,
    list_name: list?.name ?? null,
    title: task.title,
    notes: task.notes,
    priority: task.priority,
    manual_quadrant: task.manual_quadrant,
    effective_quadrant: evaluateTaskQuadrant(task, today),
    due_date: task.due_date,
    scheduled_start_ms: task.scheduled_start_ms,
    scheduled_end_ms: task.scheduled_end_ms,
    tags: task.tags,
    deck_id: task.deck_id,
    deck_name: deck?.name ?? null,
    completed_at: task.completed_at,
    completed_day: task.completed_day,
    sort_order: task.sort_order,
  };
}

function evaluateDeckDueQuadrant(deckId: number): QuadrantKey | null {
  const order = ["q1", "q2", "q3", "q4"] as const;
  for (const key of order) {
    const q = quadrants.find((item) => item.quadrant_key === key);
    if (!q) continue;
    if (q.rule.types && !q.rule.types.includes("deck_due")) continue;
    if ((q.rule.excluded_deck_ids ?? []).includes(deckId)) continue;
    if ((q.rule.pinned_deck_ids ?? []).includes(deckId)) return key;
  }
  for (const key of order) {
    const q = quadrants.find((item) => item.quadrant_key === key);
    if (!q) continue;
    if (q.rule.types && !q.rule.types.includes("deck_due")) continue;
    if ((q.rule.excluded_deck_ids ?? []).includes(deckId)) continue;
    if (q.rule.lists.mode === "inbox" || q.rule.lists.mode === "tasks") continue;
    if (q.rule.lists.mode === "custom" && !q.rule.lists.deck_ids.includes(deckId)) continue;
    if (q.rule.date_filters && !q.rule.date_filters.includes("today")) continue;
    return key;
  }
  return null;
}

function evaluateDeckDue(): MatrixDeckDueItemDto[] {
  const deckById = new Map(mockDecks.map((d) => [d.id, d]));
  const listedQuadrant = new Map<number, QuadrantKey>();
  const candidates: MatrixDeckDueItemDto[] = [];

  for (const deck of mockDecks) {
    if (deck.is_filtered) continue;
    const dueCount = deck.new_count + deck.learning_count + deck.review_count;
    if (dueCount <= 0) continue;
    const key = evaluateDeckDueQuadrant(deck.id);
    if (key) {
      listedQuadrant.set(deck.id, key);
      candidates.push({
        deck_id: deck.id,
        deck_name: deck.name,
        due_count: dueCount,
        quadrant_key: key,
      });
    }
  }

  // Drop any deck whose ancestor is already listed in the same quadrant (Z2 B1).
  return candidates.filter((item) => {
    let cur = deckById.get(item.deck_id)?.parent_id ?? null;
    let steps = 0;
    while (cur !== null && steps < mockDecks.length) {
      if (listedQuadrant.get(cur) === item.quadrant_key) {
        return false;
      }
      steps += 1;
      cur = deckById.get(cur)?.parent_id ?? null;
    }
    return true;
  });
}

// ── Habits Mock State (M3) ────────────────────────────────────────────────────

const MOCK_TODAY_DAY_INDEX = 365;

interface StoredHabit extends Omit<HabitDto, "deck_name" | "current_streak"> {
  deleted: boolean;
}

let habits: StoredHabit[] = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    title: "Morning meditation",
    notes: "10 minutes of quiet breathing before study.",
    icon_key: "sun",
    color_token: "accent",
    frequency_kind: "daily",
    weekdays: [],
    weekly_target: null,
    interval_days: null,
    goal_mode: "achieve_all",
    goal_target: 1,
    goal_unit: "",
    start_day_index: MOCK_TODAY_DAY_INDEX - 110,
    start_date: isoDateOffset(-110),
    target_days: null,
    section: "morning",
    reminders: ["07:30"],
    auto_popup_log: false,
    deck_id: null,
    archived_at: null,
    sort_order: 0,
    deleted: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000102",
    title: "Review 30 Classical Music cards",
    notes: "Stay on top of daily spaced repetition.",
    icon_key: "book-open",
    color_token: "accent",
    frequency_kind: "daily",
    weekdays: [],
    weekly_target: null,
    interval_days: null,
    goal_mode: "reach_amount",
    goal_target: 30,
    goal_unit: "cards",
    start_day_index: MOCK_TODAY_DAY_INDEX - 110,
    start_date: isoDateOffset(-110),
    target_days: null,
    section: "morning",
    reminders: [],
    auto_popup_log: false,
    deck_id: 2,
    archived_at: null,
    sort_order: 1,
    deleted: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000103",
    title: "Drink water",
    notes: "",
    icon_key: "droplet",
    color_token: "accent",
    frequency_kind: "daily",
    weekdays: [],
    weekly_target: null,
    interval_days: null,
    goal_mode: "reach_amount",
    goal_target: 2000,
    goal_unit: "ml",
    start_day_index: MOCK_TODAY_DAY_INDEX - 110,
    start_date: isoDateOffset(-110),
    target_days: null,
    section: "afternoon",
    reminders: ["13:00", "17:00"],
    auto_popup_log: false,
    deck_id: null,
    archived_at: null,
    sort_order: 2,
    deleted: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000104",
    title: "Evening study reflection",
    notes: "Note one concept to revisit tomorrow.",
    icon_key: "moon",
    color_token: "accent",
    frequency_kind: "daily",
    weekdays: [],
    weekly_target: null,
    interval_days: null,
    goal_mode: "achieve_all",
    goal_target: 1,
    goal_unit: "",
    start_day_index: MOCK_TODAY_DAY_INDEX - 110,
    start_date: isoDateOffset(-110),
    target_days: null,
    section: "night",
    reminders: ["21:30"],
    auto_popup_log: true,
    deck_id: null,
    archived_at: null,
    sort_order: 3,
    deleted: false,
  },
  // PLN3 — 1 archived habit for ArchivedHabitsDrawer preview
  {
    id: "00000000-0000-4000-8000-000000000105",
    title: "Evening flashcards sprint",
    notes: "Quick 15-minute review before dinner.",
    icon_key: "sparkles",
    color_token: "accent",
    frequency_kind: "weekdays",
    weekdays: [1, 3, 5],
    weekly_target: null,
    interval_days: null,
    goal_mode: "achieve_all",
    goal_target: 1,
    goal_unit: "",
    start_day_index: MOCK_TODAY_DAY_INDEX - 90,
    start_date: isoDateOffset(-90),
    target_days: null,
    section: "night",
    reminders: [],
    auto_popup_log: false,
    deck_id: null,
    archived_at: Date.now() - 14 * 86_400_000,
    sort_order: 4,
    deleted: false,
  },
];

// PLN3 — 90+ days of sparse habit logs (incl. 3 skipped days & 4 reflection notes)
const PLN3_SKIPPED_OFFSETS = new Set([-3, -18, -47]);
const PLN3_NOTE_MAP: Record<number, { mood: number; note: string }> = {
  [-1]: { mood: 5, note: "Calm start before anatomy review." },
  [-6]: { mood: 4, note: "Short breathing set kept focus steady." },
  [-21]: { mood: 4, note: "Quiet morning session after late shift." },
  [-54]: { mood: 3, note: "Took a slower pace; still checked in." },
};

const pln3SparseLogs: HabitLogDto[] = [];
for (let offset = -100; offset <= -3; offset += 1) {
  if (offset % 7 === 0 || offset % 11 === 0) continue;
  const skipped = PLN3_SKIPPED_OFFSETS.has(offset);
  const noteMeta = PLN3_NOTE_MAP[offset];
  pln3SparseLogs.push({
    habit_id: "00000000-0000-4000-8000-000000000101",
    day_index: MOCK_TODAY_DAY_INDEX + offset,
    date: isoDateOffset(offset),
    logged_value: skipped ? 0 : 1,
    goal_target: 1,
    completed: !skipped,
    status: skipped ? "skipped" : "logged",
    mood: noteMeta?.mood ?? null,
    note: noteMeta?.note ?? "",
  });
  if (offset % 2 === 0) {
    const partial = offset % 6 === 0;
    pln3SparseLogs.push({
      habit_id: "00000000-0000-4000-8000-000000000103",
      day_index: MOCK_TODAY_DAY_INDEX + offset,
      date: isoDateOffset(offset),
      logged_value: skipped ? 0 : partial ? 1250 : 2000,
      goal_target: 2000,
      completed: !skipped && !partial,
      status: skipped ? "skipped" : "logged",
      mood: offset === -6 ? 5 : null,
      note: offset === -6 ? "Kept water bottle on the study desk." : "",
    });
  }
}

let habitLogs: HabitLogDto[] = [
  ...pln3SparseLogs.filter((l) => l.day_index < MOCK_TODAY_DAY_INDEX - 2),
  {
    habit_id: "00000000-0000-4000-8000-000000000101",
    day_index: MOCK_TODAY_DAY_INDEX - 3,
    date: isoDateOffset(-3),
    logged_value: 0,
    goal_target: 1,
    completed: false,
    status: "skipped",
    mood: null,
    note: "",
  },
  {
    habit_id: "00000000-0000-4000-8000-000000000101",
    day_index: MOCK_TODAY_DAY_INDEX - 2,
    date: isoDateOffset(-2),
    logged_value: 1,
    goal_target: 1,
    completed: true,
    status: "logged",
    mood: 4,
    note: "",
  },
  {
    habit_id: "00000000-0000-4000-8000-000000000102",
    day_index: MOCK_TODAY_DAY_INDEX - 2,
    date: isoDateOffset(-2),
    logged_value: 30,
    goal_target: 30,
    completed: true,
    status: "logged",
    mood: null,
    note: "",
  },
  {
    habit_id: "00000000-0000-4000-8000-000000000103",
    day_index: MOCK_TODAY_DAY_INDEX - 1,
    date: isoDateOffset(-1),
    logged_value: 1500,
    goal_target: 2000,
    completed: false,
    status: "logged",
    mood: null,
    note: "",
  },
  {
    habit_id: "00000000-0000-4000-8000-000000000101",
    day_index: MOCK_TODAY_DAY_INDEX - 1,
    date: isoDateOffset(-1),
    logged_value: 1,
    goal_target: 1,
    completed: true,
    status: "logged",
    mood: 5,
    note: "Calm start before anatomy review.",
  },
  {
    habit_id: "00000000-0000-4000-8000-000000000102",
    day_index: MOCK_TODAY_DAY_INDEX,
    date: isoDateOffset(0),
    logged_value: 18,
    goal_target: 30,
    completed: false,
    status: "logged",
    mood: null,
    note: "",
  },
  {
    habit_id: "00000000-0000-4000-8000-000000000103",
    day_index: MOCK_TODAY_DAY_INDEX,
    date: isoDateOffset(0),
    logged_value: 750,
    goal_target: 2000,
    completed: false,
    status: "logged",
    mood: null,
    note: "",
  },
];

function startOfWeekDayIndex(dayIndex: number, weekStart: WeekStart = "mon"): number {
  const wd = isoWeekdayForDayIndex(dayIndex);
  const firstWd = weekStart === "sat" ? 6 : weekStart === "sun" ? 7 : 1;
  const offset = (((wd - firstWd) % 7) + 7) % 7;
  return dayIndex - offset;
}

function dateForDayIndex(dayIndex: number): string {
  return isoDateOffset(dayIndex - MOCK_TODAY_DAY_INDEX);
}

function isoWeekdayForDayIndex(dayIndex: number): number {
  const [y, m, d] = dateForDayIndex(dayIndex).split("-").map(Number);
  const jsDay = new Date(y, m - 1, d).getDay();
  return jsDay === 0 ? 7 : jsDay;
}

function isHabitActiveOnDay(habit: StoredHabit, dayIndex: number): boolean {
  if (habit.deleted || habit.archived_at !== null || dayIndex < habit.start_day_index) {
    return false;
  }
  if (habit.target_days !== null && dayIndex >= habit.start_day_index + habit.target_days) {
    return false;
  }
  return true;
}

function isHabitScheduledOnDay(habit: StoredHabit, dayIndex: number): boolean {
  if (!isHabitActiveOnDay(habit, dayIndex)) return false;
  switch (habit.frequency_kind) {
    case "daily":
      return true;
    case "weekdays":
      return habit.weekdays.includes(isoWeekdayForDayIndex(dayIndex));
    case "every_n_days": {
      const interval = Math.max(1, habit.interval_days ?? 1);
      return (dayIndex - habit.start_day_index) % interval === 0;
    }
    case "weekly_count": {
      const target = Math.max(1, habit.weekly_target ?? 1);
      const wd = isoWeekdayForDayIndex(dayIndex);
      const mon = dayIndex - (wd - 1);
      let weekDone = 0;
      for (let off = 0; off < 7; off += 1) {
        const l = habitLogs.find(
          (item) => item.habit_id === habit.id && item.day_index === mon + off,
        );
        if (l?.completed) weekDone += 1;
      }
      const curLog = habitLogs.find(
        (item) => item.habit_id === habit.id && item.day_index === dayIndex,
      );
      return (
        weekDone < target || (curLog !== undefined && (curLog.logged_value > 0 || curLog.completed))
      );
    }
  }
}

function computeMockHabitStreak(habit: StoredHabit): number {
  let streak = 0;
  let d = MOCK_TODAY_DAY_INDEX;
  const todayLog = habitLogs.find((l) => l.habit_id === habit.id && l.day_index === d);
  if (!todayLog?.completed && todayLog?.status !== "skipped" && todayLog?.status !== "frozen") {
    d -= 1;
  }
  while (d >= habit.start_day_index) {
    if (habit.frequency_kind === "daily" || isHabitScheduledOnDay(habit, d)) {
      const l = habitLogs.find((item) => item.habit_id === habit.id && item.day_index === d);
      if (l?.status === "skipped" || l?.status === "frozen") {
        d -= 1;
        continue;
      }
      if (l?.completed) streak += 1;
      else break;
    }
    d -= 1;
  }
  return streak;
}

function computeMockHabitLongestStreak(habit: StoredHabit): number {
  let longest = 0;
  let run = 0;
  for (let d = habit.start_day_index; d <= MOCK_TODAY_DAY_INDEX; d += 1) {
    if (habit.frequency_kind === "daily" || isHabitScheduledOnDay(habit, d)) {
      const l = habitLogs.find((item) => item.habit_id === habit.id && item.day_index === d);
      if (l?.status === "skipped" || l?.status === "frozen") continue;
      if (l?.completed) {
        run += 1;
        longest = Math.max(longest, run);
      } else {
        run = 0;
      }
    }
  }
  return longest;
}

function toHabitDto(h: StoredHabit): HabitDto {
  const deck = h.deck_id ? mockDecks.find((d) => d.id === h.deck_id) : undefined;
  return {
    id: h.id,
    title: h.title,
    notes: h.notes,
    icon_key: h.icon_key,
    color_token: h.color_token,
    frequency_kind: h.frequency_kind,
    weekdays: h.weekdays,
    weekly_target: h.weekly_target,
    interval_days: h.interval_days,
    goal_mode: h.goal_mode,
    goal_target: h.goal_target,
    goal_unit: h.goal_unit,
    start_day_index: h.start_day_index,
    start_date: h.start_date,
    target_days: h.target_days,
    section: h.section,
    reminders: h.reminders,
    auto_popup_log: h.auto_popup_log,
    deck_id: h.deck_id,
    deck_name: deck?.name ?? null,
    archived_at: h.archived_at,
    sort_order: h.sort_order,
    current_streak: computeMockHabitStreak(h),
  };
}

interface StoredCalendarEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  color_token: string;
  start_ms: number;
  end_ms: number;
  is_all_day: boolean;
  recurrence: CalendarRecurrence | null;
  linked_task_id: string | null;
  deleted: boolean;
}

let calendarEvents: StoredCalendarEvent[] = [
  {
    id: "00000000-0000-4000-8000-000000000201",
    title: "Morning spaced-repetition block",
    description: "Focused Anki reviews before lectures.",
    location: "Desk",
    color_token: "accent",
    start_ms: localInstantMs(-3, 8, 30),
    end_ms: localInstantMs(-3, 9, 30),
    is_all_day: false,
    recurrence: {
      freq: "daily",
      interval: 1,
      weekdays: [],
      until_date: null,
      count: 14,
      exdates: [],
    },
    linked_task_id: null,
    deleted: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000202",
    title: "Pharmacology seminar",
    description: "Case review with study group",
    location: "Room 304",
    color_token: "accent",
    start_ms: localInstantMs(1, 11, 0),
    end_ms: localInstantMs(1, 12, 30),
    is_all_day: false,
    recurrence: null,
    linked_task_id: null,
    deleted: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000203",
    title: "Cardiology block exam",
    description: "",
    location: "",
    color_token: "accent",
    start_ms: utcMidnightMs(2),
    end_ms: utcMidnightMs(3),
    is_all_day: true,
    recurrence: null,
    linked_task_id: null,
    deleted: false,
  },
  // PLN1 — Today overlapping timed events + all-day event for TimeGrid preview
  {
    id: "00000000-0000-4000-8000-000000000204",
    title: "Biochemistry lecture",
    description: "Enzyme kinetics & metabolic pathways",
    location: "Hall B",
    color_token: "accent",
    start_ms: localInstantMs(0, 10, 0),
    end_ms: localInstantMs(0, 11, 30),
    is_all_day: false,
    recurrence: null,
    linked_task_id: null,
    deleted: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000205",
    title: "Peer study review",
    description: "Practice MCQs with study group",
    location: "Library 2F",
    color_token: "accent",
    start_ms: localInstantMs(0, 10, 30),
    end_ms: localInstantMs(0, 12, 0),
    is_all_day: false,
    recurrence: null,
    linked_task_id: null,
    deleted: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000206",
    title: "Midterm study block",
    description: "",
    location: "",
    color_token: "accent",
    start_ms: utcMidnightMs(0),
    end_ms: utcMidnightMs(1),
    is_all_day: true,
    recurrence: null,
    linked_task_id: null,
    deleted: false,
  },
];

function msToLocalIso(ms: number, isAllDay: boolean): string {
  if (isAllDay) {
    return new Date(ms).toISOString().slice(0, 10);
  }
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function singleOccurrence(ev: StoredCalendarEvent): CalendarOccurrenceDto {
  return {
    event_id: ev.id,
    occurrence_date: msToLocalIso(ev.start_ms, ev.is_all_day),
    is_recurring: Boolean(ev.recurrence),
    title: ev.title,
    description: ev.description,
    location: ev.location,
    color_token: ev.color_token,
    start_ms: ev.start_ms,
    end_ms: ev.end_ms,
    is_all_day: ev.is_all_day,
    linked_task_id: ev.linked_task_id,
    recurrence: ev.recurrence,
  };
}

function expandMockCalendarEvents(
  windowStartMs: number,
  windowEndMs: number,
): CalendarOccurrenceDto[] {
  const out: CalendarOccurrenceDto[] = [];
  const DAY_MS = 86_400_000;
  for (const ev of calendarEvents) {
    if (ev.deleted) continue;
    if (!ev.recurrence) {
      if (ev.end_ms > windowStartMs && ev.start_ms < windowEndMs) {
        out.push(singleOccurrence(ev));
      }
      continue;
    }
    const duration = ev.end_ms - ev.start_ms;
    const rec = ev.recurrence;
    const exdates = new Set(rec.exdates);
    const maxEmitted = rec.count ?? 200;
    let emitted = 0;
    let dayStep = 0;
    while (dayStep < 365 && emitted < maxEmitted) {
      const occStart = ev.start_ms + dayStep * DAY_MS;
      const occEnd = occStart + duration;
      if (occStart >= windowEndMs) break;
      const occDate = msToLocalIso(occStart, ev.is_all_day);
      if (rec.until_date && occDate > rec.until_date) break;
      const d = new Date(occStart);
      const wd = ev.is_all_day ? d.getUTCDay() || 7 : d.getDay() || 7;
      const matchesFreq =
        rec.freq === "daily"
          ? dayStep % Math.max(1, rec.interval) === 0
          : Math.floor(dayStep / 7) % Math.max(1, rec.interval) === 0 && rec.weekdays.includes(wd);
      if (matchesFreq) {
        emitted += 1;
        if (!exdates.has(occDate) && occEnd > windowStartMs && occStart < windowEndMs) {
          out.push({
            event_id: ev.id,
            occurrence_date: occDate,
            is_recurring: true,
            title: ev.title,
            description: ev.description,
            location: ev.location,
            color_token: ev.color_token,
            start_ms: occStart,
            end_ms: occEnd,
            is_all_day: ev.is_all_day,
            linked_task_id: ev.linked_task_id,
            recurrence: rec,
          });
        }
      }
      dayStep += 1;
    }
  }
  out.sort((a, b) => a.start_ms - b.start_ms);
  return out;
}

export const productivityMocks: Record<string, unknown> = {
  undo_status: (): UndoAction | null => undoStack[undoStack.length - 1]?.action ?? null,
  undo: (): UndoAction | null => {
    const entry = undoStack.pop();
    if (!entry) return null;
    entry.restore();
    return entry.action;
  },

  list_task_lists: (): TaskListDto[] => [...taskLists],
  create_task_list: ({ input }: { input: TaskListInput }): TaskListDto => {
    const name = input.name.trim();
    if (!name) throw { kind: "invalid", message: "task list name cannot be empty" };
    const created: TaskListDto = {
      id: mockUuid(),
      name,
      color_token: input.color_token || "accent",
      icon_key: input.icon_key,
      sort_order: input.sort_order,
    };
    taskLists = [...taskLists, created];
    return created;
  },
  update_task_list: ({ id, input }: { id: string; input: TaskListInput }): TaskListDto => {
    const name = input.name.trim();
    if (!name) throw { kind: "invalid", message: "task list name cannot be empty" };
    const idx = taskLists.findIndex((l) => l.id === id);
    if (idx === -1) throw { kind: "not_found", message: `task list '${id}' not found` };
    const updated: TaskListDto = {
      ...taskLists[idx],
      name,
      color_token: input.color_token || "accent",
      icon_key: input.icon_key,
      sort_order: input.sort_order,
    };
    taskLists = taskLists.map((l) => (l.id === id ? updated : l));
    return updated;
  },
  delete_task_list: ({ id }: { id: string }): null => {
    const existing = taskLists.find((l) => l.id === id);
    if (!existing) throw { kind: "not_found", message: `task list '${id}' not found` };
    const movedIds = tasks.filter((t) => !t.deleted && t.list_id === id).map((t) => t.id);
    taskLists = taskLists.filter((l) => l.id !== id);
    tasks = tasks.map((t) => (t.list_id === id ? { ...t, list_id: null } : t));
    undoStack.push({
      action: { kind: "delete-task-list", name: existing.name },
      restore: () => {
        taskLists = [...taskLists, existing];
        tasks = tasks.map((t) => (movedIds.includes(t.id) ? { ...t, list_id: id } : t));
      },
    });
    return null;
  },

  get_matrix_board: ({ includeCompleted }: { includeCompleted: boolean }): MatrixBoardDto => {
    const today = todayDate();
    return {
      today_date: today,
      quadrants: quadrants.map((q) => ({ ...q, rule: { ...q.rule } })),
      tasks: tasks
        .filter((t) => !t.deleted && (includeCompleted || t.completed_at === null))
        .map((t) => toTaskDto(t, today)),
      deck_due_items: evaluateDeckDue(),
    };
  },
  create_task: ({ input }: { input: TaskInput }): TaskDto => {
    const title = input.title.trim();
    if (!title) throw { kind: "invalid", message: "task title cannot be empty" };
    const created: StoredTask = {
      id: mockUuid(),
      list_id: input.list_id,
      title,
      notes: input.notes,
      priority: input.priority,
      manual_quadrant: input.manual_quadrant,
      due_date: input.due_date,
      scheduled_start_ms: input.scheduled_start_ms,
      scheduled_end_ms: input.scheduled_end_ms,
      tags: input.tags,
      deck_id: input.deck_id,
      completed_at: null,
      completed_day: null,
      sort_order: input.sort_order,
      deleted: false,
    };
    tasks = [...tasks, created];
    return toTaskDto(created, todayDate());
  },
  update_task: ({ id, input }: { id: string; input: TaskInput }): TaskDto => {
    const title = input.title.trim();
    if (!title) throw { kind: "invalid", message: "task title cannot be empty" };
    const existing = tasks.find((t) => t.id === id && !t.deleted);
    if (!existing) throw { kind: "not_found", message: `task '${id}' not found` };
    const updated: StoredTask = {
      ...existing,
      list_id: input.list_id,
      title,
      notes: input.notes,
      priority: input.priority,
      manual_quadrant: input.manual_quadrant,
      due_date: input.due_date,
      scheduled_start_ms: input.scheduled_start_ms,
      scheduled_end_ms: input.scheduled_end_ms,
      tags: input.tags,
      deck_id: input.deck_id,
      sort_order: input.sort_order,
    };
    tasks = tasks.map((t) => (t.id === id ? updated : t));
    return toTaskDto(updated, todayDate());
  },
  complete_task: ({ id }: { id: string }): null => {
    const existing = tasks.find((t) => t.id === id && !t.deleted);
    if (!existing) throw { kind: "not_found", message: `task '${id}' not found` };
    const prevAt = existing.completed_at;
    const prevDay = existing.completed_day;
    tasks = tasks.map((t) =>
      t.id === id ? { ...t, completed_at: Date.now(), completed_day: 365 } : t,
    );
    undoStack.push({
      action: { kind: "complete-task", title: existing.title },
      restore: () => {
        tasks = tasks.map((t) =>
          t.id === id ? { ...t, completed_at: prevAt, completed_day: prevDay } : t,
        );
      },
    });
    return null;
  },
  reopen_task: ({ id }: { id: string }): null => {
    const existing = tasks.find((t) => t.id === id && !t.deleted);
    if (!existing) throw { kind: "not_found", message: `task '${id}' not found` };
    const prevAt = existing.completed_at;
    const prevDay = existing.completed_day;
    tasks = tasks.map((t) => (t.id === id ? { ...t, completed_at: null, completed_day: null } : t));
    undoStack.push({
      action: { kind: "reopen-task", title: existing.title },
      restore: () => {
        tasks = tasks.map((t) =>
          t.id === id ? { ...t, completed_at: prevAt, completed_day: prevDay } : t,
        );
      },
    });
    return null;
  },
  delete_task: ({ id }: { id: string }): null => {
    const existing = tasks.find((t) => t.id === id && !t.deleted);
    if (!existing) throw { kind: "not_found", message: `task '${id}' not found` };
    tasks = tasks.map((t) => (t.id === id ? { ...t, deleted: true } : t));
    undoStack.push({
      action: { kind: "delete-task", title: existing.title },
      restore: () => {
        tasks = tasks.map((t) => (t.id === id ? { ...t, deleted: false } : t));
      },
    });
    return null;
  },
  reorder_tasks: ({ items }: { items: TaskOrderItem[] }): null => {
    if (items.length === 0) {
      throw { kind: "invalid", message: "reorder_tasks requires at least one item" };
    }
    const orderById = new Map(items.map((item) => [item.id, item.sort_order]));
    for (const item of items) {
      if (!tasks.some((t) => t.id === item.id && !t.deleted)) {
        throw { kind: "not_found", message: `task '${item.id}' not found` };
      }
    }
    tasks = tasks.map((t) =>
      orderById.has(t.id) ? { ...t, sort_order: orderById.get(t.id)! } : t,
    );
    return null;
  },
  reschedule_overdue_tasks: ({ targetDate }: { targetDate: string }): number => {
    const today = todayDate();
    let count = 0;
    tasks = tasks.map((t) => {
      if (!t.deleted && t.completed_at === null && t.due_date !== null && t.due_date < today) {
        count += 1;
        return { ...t, due_date: targetDate };
      }
      return t;
    });
    return count;
  },
  move_task_to_quadrant: ({ id, quadrant }: { id: string; quadrant: QuadrantKey }): TaskDto => {
    const existing = tasks.find((t) => t.id === id && !t.deleted);
    if (!existing) throw { kind: "not_found", message: `task '${id}' not found` };
    const updated: StoredTask = { ...existing, manual_quadrant: quadrant };
    tasks = tasks.map((t) => (t.id === id ? updated : t));
    return toTaskDto(updated, todayDate());
  },
  save_matrix_quadrant: ({ quadrant }: { quadrant: MatrixQuadrantDto }): MatrixQuadrantDto => {
    if (quadrant.title.trim().length > 120) {
      throw { kind: "invalid", message: "quadrant title must not exceed 120 characters" };
    }
    if (
      quadrant.rule.lists.mode === "custom" &&
      quadrant.rule.lists.list_ids.length === 0 &&
      quadrant.rule.lists.deck_ids.length === 0
    ) {
      throw {
        kind: "invalid",
        message: "custom list filter must include at least one list_id or deck_id",
      };
    }
    if (quadrant.rule.date_filters && quadrant.rule.date_filters.length === 0) {
      throw { kind: "invalid", message: "date_filters must be None or a non-empty list" };
    }
    if (quadrant.rule.priorities && quadrant.rule.priorities.length === 0) {
      throw { kind: "invalid", message: "priorities must be None or a non-empty list" };
    }
    if (quadrant.rule.types && quadrant.rule.types.length === 0) {
      throw { kind: "invalid", message: "types must be None or a non-empty list" };
    }
    quadrants = quadrants.map((q) => (q.quadrant_key === quadrant.quadrant_key ? quadrant : q));
    return quadrant;
  },
  restore_matrix_defaults: ({
    quadrant,
  }: {
    quadrant: QuadrantKey | null;
  }): MatrixQuadrantDto[] => {
    quadrants = quadrants.map((q) => {
      if (quadrant && q.quadrant_key !== quadrant) return q;
      const def = DEFAULT_QUADRANTS.find((d) => d.quadrant_key === q.quadrant_key)!;
      return {
        ...def,
        rule: {
          ...def.rule,
          pinned_deck_ids: [...(def.rule.pinned_deck_ids ?? [])],
          excluded_deck_ids: [...(def.rule.excluded_deck_ids ?? [])],
        },
      };
    });
    return quadrants;
  },

  // ── Habits (M3 / PLN0) ─────────────────────────────────────────────────────
  get_habit_board: ({
    weekStartDay,
    weekStart,
  }: {
    weekStartDay: number | null;
    weekStart?: WeekStart | null;
  }): HabitBoardDto => {
    const ws = weekStart ?? "mon";
    const startDay = weekStartDay ?? startOfWeekDayIndex(MOCK_TODAY_DAY_INDEX, ws);
    const activeHabits = habits.filter((h) => !h.deleted && h.archived_at === null);

    const week_days: HabitDayRingDto[] = Array.from({ length: 7 }, (_, i) => {
      const day_index = startDay + i;
      const date = dateForDayIndex(day_index);
      let scheduled_count = 0;
      let completed_count = 0;
      let excused_count = 0;
      let ratio_sum = 0;
      for (const h of activeHabits) {
        if (!isHabitScheduledOnDay(h, day_index)) continue;
        const log = habitLogs.find((l) => l.habit_id === h.id && l.day_index === day_index);
        if (log && (log.status === "skipped" || log.status === "frozen")) {
          excused_count += 1;
          continue;
        }
        scheduled_count += 1;
        if (log) {
          if (log.completed) completed_count += 1;
          const contrib =
            log.goal_target > 0
              ? Math.min(1, Math.max(0, log.logged_value / log.goal_target))
              : log.completed
                ? 1
                : 0;
          ratio_sum += contrib;
        }
      }
      return {
        day_index,
        date,
        scheduled_count,
        completed_count,
        excused_count,
        completion_ratio: scheduled_count > 0 ? ratio_sum / scheduled_count : 0,
      };
    });

    return {
      today_day_index: MOCK_TODAY_DAY_INDEX,
      today_date: dateForDayIndex(MOCK_TODAY_DAY_INDEX),
      week_days,
      habits: activeHabits.map(toHabitDto),
      logs: habitLogs.filter((l) => l.day_index >= startDay && l.day_index <= startDay + 6),
    };
  },
  get_habit_history: ({
    habitId,
    months,
  }: {
    habitId: string;
    months: number | null;
    weekStart?: WeekStart | null;
  }): HabitHistoryDto => {
    const habit = habits.find((h) => h.id === habitId && !h.deleted);
    if (!habit) throw { kind: "not_found", message: `habit '${habitId}' not found` };
    const clampedMonths = Math.min(24, Math.max(1, months ?? 12));
    const windowStart = MOCK_TODAY_DAY_INDEX - (clampedMonths * 31 - 1);
    const logs = habitLogs
      .filter(
        (l) =>
          l.habit_id === habitId &&
          l.day_index >= windowStart &&
          l.day_index <= MOCK_TODAY_DAY_INDEX,
      )
      .sort((a, b) => a.day_index - b.day_index);
    const completed_days = logs.filter((l) => l.status === "logged" && l.completed).length;
    const skipped_days = logs.filter((l) => l.status === "skipped").length;
    const frozen_days = logs.filter((l) => l.status === "frozen").length;
    const evalStart = Math.max(windowStart, habit.start_day_index);
    const scheduledDays = Math.max(0, MOCK_TODAY_DAY_INDEX - evalStart + 1);
    const denom = Math.max(1, scheduledDays - skipped_days - frozen_days);
    const completion_rate_pct =
      scheduledDays === 0 ? 0 : Math.min(100, (completed_days / denom) * 100);
    const streak = computeMockHabitStreak(habit);
    const longest_streak = Math.max(streak, computeMockHabitLongestStreak(habit));
    return {
      habit: toHabitDto(habit),
      today_day_index: MOCK_TODAY_DAY_INDEX,
      today_date: dateForDayIndex(MOCK_TODAY_DAY_INDEX),
      current_streak: streak,
      longest_streak,
      completed_days,
      skipped_days,
      frozen_days,
      completion_rate_pct,
      logs,
    };
  },
  list_archived_habits: (): HabitDto[] =>
    habits.filter((h) => !h.deleted && h.archived_at !== null).map(toHabitDto),
  create_habit: ({ input }: { input: HabitInput }): HabitDto => {
    const title = input.title.trim();
    if (!title) throw { kind: "invalid", message: "habit title cannot be empty" };
    const startDate = input.start_date ?? dateForDayIndex(MOCK_TODAY_DAY_INDEX);
    const created: StoredHabit = {
      id: mockUuid(),
      title,
      notes: input.notes,
      icon_key: input.icon_key || "check-circle",
      color_token: input.color_token || "accent",
      frequency_kind: input.frequency_kind,
      weekdays: input.weekdays,
      weekly_target: input.weekly_target,
      interval_days: input.interval_days,
      goal_mode: input.goal_mode,
      goal_target: input.goal_target,
      goal_unit: input.goal_unit,
      start_day_index: MOCK_TODAY_DAY_INDEX,
      start_date: startDate,
      target_days: input.target_days,
      section: input.section,
      reminders: input.reminders,
      auto_popup_log: input.auto_popup_log,
      deck_id: input.deck_id,
      archived_at: null,
      sort_order: input.sort_order,
      deleted: false,
    };
    habits = [...habits, created];
    return toHabitDto(created);
  },
  update_habit: ({ id, input }: { id: string; input: HabitInput }): HabitDto => {
    const title = input.title.trim();
    if (!title) throw { kind: "invalid", message: "habit title cannot be empty" };
    const existing = habits.find((h) => h.id === id && !h.deleted);
    if (!existing) throw { kind: "not_found", message: `habit '${id}' not found` };
    const updated: StoredHabit = {
      ...existing,
      title,
      notes: input.notes,
      icon_key: input.icon_key || "check-circle",
      color_token: input.color_token || "accent",
      frequency_kind: input.frequency_kind,
      weekdays: input.weekdays,
      weekly_target: input.weekly_target,
      interval_days: input.interval_days,
      goal_mode: input.goal_mode,
      goal_target: input.goal_target,
      goal_unit: input.goal_unit,
      start_date: input.start_date ?? existing.start_date,
      target_days: input.target_days,
      section: input.section,
      reminders: input.reminders,
      auto_popup_log: input.auto_popup_log,
      deck_id: input.deck_id,
      sort_order: input.sort_order,
    };
    habits = habits.map((h) => (h.id === id ? updated : h));
    return toHabitDto(updated);
  },
  archive_habit: ({ id, archived }: { id: string; archived: boolean }): null => {
    const existing = habits.find((h) => h.id === id && !h.deleted);
    if (!existing) throw { kind: "not_found", message: `habit '${id}' not found` };
    habits = habits.map((h) =>
      h.id === id ? { ...h, archived_at: archived ? Date.now() : null } : h,
    );
    return null;
  },
  delete_habit: ({ id }: { id: string }): null => {
    const existing = habits.find((h) => h.id === id && !h.deleted);
    if (!existing) throw { kind: "not_found", message: `habit '${id}' not found` };
    habits = habits.map((h) => (h.id === id ? { ...h, deleted: true } : h));
    undoStack.push({
      action: { kind: "delete-habit", title: existing.title },
      restore: () => {
        habits = habits.map((h) => (h.id === id ? { ...h, deleted: false } : h));
      },
    });
    return null;
  },
  log_habit: ({ input }: { input: HabitLogInput }): HabitLogDto => {
    const status: HabitLogStatus = input.status ?? "logged";
    if (status === "frozen") {
      throw { kind: "invalid", message: "freeze status requires Game streak-freeze inventory" };
    }
    const existingHabit = habits.find((h) => h.id === input.habit_id && !h.deleted);
    if (!existingHabit) throw { kind: "not_found", message: `habit '${input.habit_id}' not found` };
    const dayIndex = input.day_index ?? MOCK_TODAY_DAY_INDEX;
    const prevLog = habitLogs.find(
      (l) => l.habit_id === input.habit_id && l.day_index === dayIndex,
    );
    const loggedValue = status === "logged" ? input.logged_value : 0;
    const nextLog: HabitLogDto = {
      habit_id: input.habit_id,
      day_index: dayIndex,
      date: dateForDayIndex(dayIndex),
      logged_value: loggedValue,
      goal_target: existingHabit.goal_target,
      completed: status === "logged" && loggedValue >= existingHabit.goal_target,
      status,
      mood: input.mood,
      note: input.note,
    };
    habitLogs = [
      ...habitLogs.filter((l) => !(l.habit_id === input.habit_id && l.day_index === dayIndex)),
      nextLog,
    ];
    undoStack.push({
      action: { kind: "log-habit", title: existingHabit.title },
      restore: () => {
        habitLogs = habitLogs.filter(
          (l) => !(l.habit_id === input.habit_id && l.day_index === dayIndex),
        );
        if (prevLog) habitLogs = [...habitLogs, prevLog];
      },
    });
    return nextLog;
  },

  // ── Calendar (CAL1) ────────────────────────────────────────────────────────
  list_calendar_occurrences: ({
    windowStartMs,
    windowEndMs,
  }: {
    windowStartMs: number;
    windowEndMs: number;
  }): CalendarOccurrenceDto[] => expandMockCalendarEvents(windowStartMs, windowEndMs),
  create_calendar_event: ({ input }: { input: CalendarEventInput }): CalendarOccurrenceDto => {
    const title = input.title.trim();
    if (!title) throw { kind: "invalid", message: "calendar event title cannot be empty" };
    if (input.end_ms <= input.start_ms) {
      throw { kind: "invalid", message: "end_ms must be after start_ms" };
    }
    const created: StoredCalendarEvent = {
      id: mockUuid(),
      title,
      description: input.description,
      location: input.location,
      color_token: input.color_token || "accent",
      start_ms: input.start_ms,
      end_ms: input.end_ms,
      is_all_day: input.is_all_day,
      recurrence: input.recurrence,
      linked_task_id: input.linked_task_id,
      deleted: false,
    };
    calendarEvents = [...calendarEvents, created];
    return singleOccurrence(created);
  },
  update_calendar_event: ({
    id,
    input,
  }: {
    id: string;
    input: CalendarEventInput;
  }): CalendarOccurrenceDto => {
    const existing = calendarEvents.find((e) => e.id === id && !e.deleted);
    if (!existing) throw { kind: "not_found", message: `calendar event '${id}' not found` };
    const title = input.title.trim();
    if (!title) throw { kind: "invalid", message: "calendar event title cannot be empty" };
    const updated: StoredCalendarEvent = {
      ...existing,
      title,
      description: input.description,
      location: input.location,
      color_token: input.color_token || "accent",
      start_ms: input.start_ms,
      end_ms: input.end_ms,
      is_all_day: input.is_all_day,
      recurrence: input.recurrence,
      linked_task_id: input.linked_task_id,
    };
    calendarEvents = calendarEvents.map((e) => (e.id === id ? updated : e));
    return singleOccurrence(updated);
  },
  delete_calendar_event: ({ id }: { id: string }): null => {
    const existing = calendarEvents.find((e) => e.id === id && !e.deleted);
    if (!existing) throw { kind: "not_found", message: `calendar event '${id}' not found` };
    calendarEvents = calendarEvents.map((e) => (e.id === id ? { ...e, deleted: true } : e));
    undoStack.push({
      action: { kind: "delete-calendar-event", title: existing.title },
      restore: () => {
        calendarEvents = calendarEvents.map((e) => (e.id === id ? { ...e, deleted: false } : e));
      },
    });
    return null;
  },
  delete_calendar_occurrence: ({
    id,
    occurrenceDate,
  }: {
    id: string;
    occurrenceDate: string;
  }): null => {
    const existing = calendarEvents.find((e) => e.id === id && !e.deleted);
    if (!existing) throw { kind: "not_found", message: `calendar event '${id}' not found` };
    if (!existing.recurrence) {
      calendarEvents = calendarEvents.map((e) => (e.id === id ? { ...e, deleted: true } : e));
      undoStack.push({
        action: { kind: "delete-calendar-event", title: existing.title },
        restore: () => {
          calendarEvents = calendarEvents.map((e) => (e.id === id ? { ...e, deleted: false } : e));
        },
      });
      return null;
    }
    const prevExdates = [...existing.recurrence.exdates];
    const nextRec: CalendarRecurrence = {
      ...existing.recurrence,
      exdates: prevExdates.includes(occurrenceDate)
        ? prevExdates
        : [...prevExdates, occurrenceDate],
    };
    calendarEvents = calendarEvents.map((e) => (e.id === id ? { ...e, recurrence: nextRec } : e));
    undoStack.push({
      action: { kind: "delete-calendar-event", title: existing.title },
      restore: () => {
        calendarEvents = calendarEvents.map((e) =>
          e.id === id && e.recurrence
            ? { ...e, recurrence: { ...e.recurrence, exdates: prevExdates } }
            : e,
        );
      },
    });
    return null;
  },
};
