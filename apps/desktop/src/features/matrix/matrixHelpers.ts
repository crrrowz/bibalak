import type {
  MatrixDateFilter,
  MatrixGroupBy,
  MatrixQuadrantDto,
  MatrixSortBy,
  QuadrantKey,
  QuadrantRule,
  TaskDto,
  TaskInput,
  TaskOrderItem,
  TaskPriority,
} from "@bibalak/ipc-types";
import { formatDate, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales/en";

export type AsyncHandler<A extends unknown[]> = (...args: A) => Promise<void>;

export const QUADRANT_ORDER: readonly QuadrantKey[] = ["q1", "q2", "q3", "q4"];

export const GROUP_BY_OPTIONS: readonly MatrixGroupBy[] = [
  "none",
  "list",
  "priority",
  "tag",
  "date",
];

export const SORT_BY_OPTIONS: readonly MatrixSortBy[] = ["date", "priority", "title", "manual"];

const PRIORITY_RANK: Record<TaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

export function quadrantRoman(key: QuadrantKey): string {
  const map: Record<QuadrantKey, LocaleKey> = {
    q1: "matrix.roman.q1",
    q2: "matrix.roman.q2",
    q3: "matrix.roman.q3",
    q4: "matrix.roman.q4",
  };
  return t(map[key]);
}

export function quadrantDisplayTitle(q: MatrixQuadrantDto): string {
  const custom = q.title.trim();
  if (custom.length > 0) return custom;
  const map: Record<QuadrantKey, LocaleKey> = {
    q1: "matrix.quadrant.q1",
    q2: "matrix.quadrant.q2",
    q3: "matrix.quadrant.q3",
    q4: "matrix.quadrant.q4",
  };
  return t(map[q.quadrant_key]);
}

export function quadrantBadgeClass(colorToken: string): string {
  switch (colorToken) {
    case "danger":
      return "bg-again text-white";
    case "warning":
      return "bg-hard text-white";
    case "info":
      return "bg-easy text-white";
    case "success":
      return "bg-good text-white";
    default:
      return "bg-primary text-primary-foreground";
  }
}

export function priorityLabel(priority: TaskPriority): string {
  const map: Record<TaskPriority, LocaleKey> = {
    high: "matrix.priority.high",
    medium: "matrix.priority.medium",
    low: "matrix.priority.low",
    none: "matrix.priority.none",
  };
  return t(map[priority]);
}

export function priorityFlagClass(priority: TaskPriority): string {
  switch (priority) {
    case "high":
      return "text-again";
    case "medium":
      return "text-hard";
    case "low":
      return "text-easy";
    case "none":
      return "text-muted-foreground/70";
  }
}

export function parseIsoDateLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function offsetIsoDate(iso: string, deltaDays: number): string {
  const dt = parseIsoDateLocal(iso);
  dt.setDate(dt.getDate() + deltaDays);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatDueDateLabel(
  dueDate: string,
  todayDate: string,
): {
  label: string;
  isOverdue: boolean;
} {
  const formatted = formatDate(parseIsoDateLocal(dueDate), {
    month: "short",
    day: "numeric",
  });
  if (dueDate < todayDate) {
    return { label: t("matrix.task.dueOverdue", { date: formatted }), isOverdue: true };
  }
  if (dueDate === todayDate) {
    return { label: t("matrix.task.dueToday"), isOverdue: false };
  }
  if (dueDate === offsetIsoDate(todayDate, 1)) {
    return { label: t("matrix.task.dueTomorrow"), isOverdue: false };
  }
  return { label: formatted, isOverdue: false };
}

export function sortTasks(tasks: TaskDto[], sortBy: MatrixSortBy): TaskDto[] {
  const copy = [...tasks];
  copy.sort((a, b) => {
    switch (sortBy) {
      case "date": {
        if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
        if (a.due_date) return -1;
        if (b.due_date) return 1;
        return a.sort_order - b.sort_order;
      }
      case "priority": {
        const pDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (pDiff !== 0) return pDiff;
        return a.sort_order - b.sort_order;
      }
      case "title":
        return a.title.localeCompare(b.title);
      case "manual":
        return a.sort_order - b.sort_order;
    }
  });
  return copy;
}

export interface TaskGroup {
  key: string;
  label: string | null;
  tasks: TaskDto[];
}

export function groupAndSortTasks(
  tasks: TaskDto[],
  groupBy: MatrixGroupBy,
  sortBy: MatrixSortBy,
  todayDate: string,
): TaskGroup[] {
  const sorted = sortTasks(tasks, sortBy);
  if (groupBy === "none") {
    return [{ key: "__all__", label: null, tasks: sorted }];
  }

  const buckets = new Map<string, { label: string; tasks: TaskDto[] }>();
  const addToBucket = (key: string, label: string, task: TaskDto) => {
    const existing = buckets.get(key);
    if (existing) {
      existing.tasks.push(task);
    } else {
      buckets.set(key, { label, tasks: [task] });
    }
  };

  for (const task of sorted) {
    switch (groupBy) {
      case "list": {
        const key = task.list_id ?? "__inbox__";
        const label = task.list_name ?? t("matrix.task.inbox");
        addToBucket(key, label, task);
        break;
      }
      case "priority": {
        addToBucket(task.priority, priorityLabel(task.priority), task);
        break;
      }
      case "tag": {
        const firstTag = task.tags[0];
        if (firstTag) {
          addToBucket(`tag:${firstTag}`, firstTag, task);
        } else {
          addToBucket("__untagged__", t("matrix.group.untagged"), task);
        }
        break;
      }
      case "date": {
        if (!task.due_date) {
          addToBucket("__nodate__", t("matrix.editDialog.date.no_date"), task);
        } else {
          const { label } = formatDueDateLabel(task.due_date, todayDate);
          addToBucket(task.due_date, label, task);
        }
        break;
      }
    }
  }

  return Array.from(buckets.entries()).map(([key, v]) => ({
    key,
    label: v.label,
    tasks: v.tasks,
  }));
}

export function taskToInput(task: TaskDto, overrides?: Partial<TaskInput>): TaskInput {
  return {
    list_id: task.list_id,
    title: task.title,
    notes: task.notes,
    priority: task.priority,
    manual_quadrant: task.manual_quadrant,
    due_date: task.due_date,
    scheduled_start_ms: task.scheduled_start_ms,
    scheduled_end_ms: task.scheduled_end_ms,
    tags: task.tags,
    deck_id: task.deck_id,
    sort_order: task.sort_order,
    ...overrides,
  };
}

export function computeReorderItems(
  orderedTasks: TaskDto[],
  draggedId: string,
  insertIndex: number,
): TaskOrderItem[] | null {
  const fromIndex = orderedTasks.findIndex((item) => item.id === draggedId);
  if (fromIndex === -1) return null;

  const clampedTarget = Math.max(0, Math.min(orderedTasks.length, insertIndex));
  const adjustedTarget = fromIndex < clampedTarget ? clampedTarget - 1 : clampedTarget;
  if (adjustedTarget === fromIndex) return null;

  const reordered = [...orderedTasks];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(adjustedTarget, 0, moved);

  return reordered.map((item, idx) => ({
    id: item.id,
    sort_order: idx * 10,
  }));
}

export function stepReorderItems(
  orderedTasks: TaskDto[],
  taskId: string,
  delta: -1 | 1,
): TaskOrderItem[] | null {
  const fromIndex = orderedTasks.findIndex((item) => item.id === taskId);
  if (fromIndex === -1) return null;
  const targetIndex = fromIndex + delta;
  if (targetIndex < 0 || targetIndex >= orderedTasks.length) return null;

  const reordered = [...orderedTasks];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(targetIndex, 0, moved);

  return reordered.map((item, idx) => ({
    id: item.id,
    sort_order: idx * 10,
  }));
}

function matchesDateFilter(
  dueDate: string | null,
  filters: MatrixDateFilter[],
  todayDate: string,
): boolean {
  const tomorrow = offsetIsoDate(todayDate, 1);
  const plus7 = offsetIsoDate(todayDate, 7);
  const ym = todayDate.slice(0, 7);
  return filters.some((f) => {
    switch (f) {
      case "no_date":
        return dueDate === null;
      case "overdue":
        return dueDate !== null && dueDate < todayDate;
      case "today":
        return dueDate === todayDate;
      case "tomorrow":
        return dueDate === tomorrow;
      case "next7_days":
        return dueDate !== null && dueDate >= todayDate && dueDate < plus7;
      case "this_month":
        return dueDate !== null && dueDate.slice(0, 7) === ym;
    }
  });
}

function matchesQuadrantRule(task: TaskDto, rule: QuadrantRule, todayDate: string): boolean {
  if (rule.types && !rule.types.includes("task")) return false;
  if (rule.lists.mode === "inbox" && task.list_id !== null) return false;
  if (rule.lists.mode === "custom") {
    const inList = task.list_id !== null && rule.lists.list_ids.includes(task.list_id);
    const inDeck = task.deck_id !== null && rule.lists.deck_ids.includes(task.deck_id);
    if (!inList && !inDeck) return false;
  }
  if (rule.priorities && !rule.priorities.includes(task.priority)) return false;
  if (rule.date_filters && !matchesDateFilter(task.due_date, rule.date_filters, todayDate)) {
    return false;
  }
  return true;
}

export function inferTaskQuadrant(
  task: TaskDto,
  quadrants: MatrixQuadrantDto[],
  todayDate: string,
): QuadrantKey | null {
  if (task.effective_quadrant) return task.effective_quadrant;
  if (task.manual_quadrant) return task.manual_quadrant;
  for (const key of QUADRANT_ORDER) {
    const q = quadrants.find((item) => item.quadrant_key === key);
    if (q && matchesQuadrantRule(task, q.rule, todayDate)) return key;
  }
  return null;
}

export function msToDateInput(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function msToTimeInput(ms: number): string {
  const dt = new Date(ms);
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function dateAndTimeToMs(dateStr: string, timeStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0).getTime();
}

export function formatScheduleTimeRange(startMs: number, endMs: number): string {
  return `${msToTimeInput(startMs)}–${msToTimeInput(endMs)}`;
}

/**
 * Compute only the quadrants whose rules must change to move a study-drill deck
 * into `targetKey` while preserving all task list/inbox rules.
 */
export function buildQuadrantsForDeckMove(
  quadrants: MatrixQuadrantDto[],
  deckId: number,
  targetKey: QuadrantKey,
): MatrixQuadrantDto[] {
  const changed: MatrixQuadrantDto[] = [];

  for (const q of quadrants) {
    const pinned = q.rule.pinned_deck_ids ?? [];
    const excluded = q.rule.excluded_deck_ids ?? [];

    if (q.quadrant_key === targetKey) {
      const nextPinned = pinned.includes(deckId) ? pinned : [...pinned, deckId];
      const nextExcluded = excluded.filter((id) => id !== deckId);
      const nextTypes =
        q.rule.types !== null && !q.rule.types.includes("deck_due")
          ? q.rule.types.includes("task")
            ? null
            : [...q.rule.types, "deck_due" as const]
          : q.rule.types;

      const ruleChanged =
        nextPinned !== pinned ||
        nextExcluded.length !== excluded.length ||
        nextTypes !== q.rule.types;
      if (ruleChanged) {
        changed.push({
          ...q,
          rule: {
            ...q.rule,
            types: nextTypes,
            pinned_deck_ids: nextPinned,
            excluded_deck_ids: nextExcluded,
          },
        });
      }
    } else {
      const nextPinned = pinned.filter((id) => id !== deckId);
      const nextExcluded = excluded.includes(deckId) ? excluded : [...excluded, deckId];
      let nextLists = q.rule.lists;
      if (q.rule.lists.mode === "custom" && q.rule.lists.deck_ids.includes(deckId)) {
        const remainingDecks = q.rule.lists.deck_ids.filter((id) => id !== deckId);
        nextLists =
          q.rule.lists.list_ids.length === 0 && remainingDecks.length === 0
            ? { mode: "tasks" }
            : { mode: "custom", list_ids: q.rule.lists.list_ids, deck_ids: remainingDecks };
      }

      const ruleChanged =
        nextPinned.length !== pinned.length ||
        nextExcluded !== excluded ||
        nextLists !== q.rule.lists;
      if (ruleChanged) {
        changed.push({
          ...q,
          rule: {
            ...q.rule,
            lists: nextLists,
            pinned_deck_ids: nextPinned,
            excluded_deck_ids: nextExcluded,
          },
        });
      }
    }
  }

  return changed;
}

/** Human-readable tooltip explaining which box a study drill is placed in and why. */
export function explainDeckDuePlacement(
  deckId: number,
  quadrantKey: QuadrantKey,
  quadrants: MatrixQuadrantDto[],
): string {
  const q = quadrants.find((item) => item.quadrant_key === quadrantKey);
  const label = q
    ? `${quadrantRoman(quadrantKey)} (${quadrantDisplayTitle(q)})`
    : quadrantRoman(quadrantKey);
  if (q?.rule.pinned_deck_ids?.includes(deckId)) {
    return t("matrix.deckDue.reasonPinned", { quadrant: label });
  }
  if (q?.rule.lists.mode === "custom" && q.rule.lists.deck_ids.includes(deckId)) {
    return t("matrix.deckDue.reasonRule", { quadrant: label });
  }
  return t("matrix.deckDue.reasonAuto", { quadrant: label });
}
