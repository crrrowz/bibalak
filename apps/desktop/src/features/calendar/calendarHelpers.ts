import type { HabitDto, HabitSection, StatsDto, WeekStart } from "@bibalak/ipc-types";
import type { DueForecastDto } from "@/lib/ipc";
import { formatDate } from "@/lib/i18n";
import { isHabitScheduledForDay } from "@/features/habits/habitHelpers";

export type AsyncHandler<A extends unknown[]> = (...args: A) => Promise<void>;

export type CalendarViewMode = "day" | "threeDay" | "week" | "month" | "agenda";

export const HOUR_HEIGHT_PX = 48;
export const SNAP_MINUTES = 15;
export const MIN_DURATION_MINUTES = 15;

export const HABIT_SECTION_ORDER: readonly HabitSection[] = [
  "morning",
  "afternoon",
  "night",
  "others",
];

export function snapMinutes(yPx: number): number {
  const raw = Math.round(((yPx / HOUR_HEIGHT_PX) * 60) / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.max(0, Math.min(24 * 60 - SNAP_MINUTES, raw));
}

export function snapMinutesAllowEnd(yPx: number): number {
  const raw = Math.round(((yPx / HOUR_HEIGHT_PX) * 60) / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.max(0, Math.min(24 * 60, raw));
}

export function minutesToInputHm(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function minutesToDisplayHm(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function formatMinutesRange(startMin: number, endMin: number): string {
  return `${minutesToDisplayHm(startMin)}–${minutesToDisplayHm(endMin)}`;
}

export function msToMinutesSinceMidnight(ms: number, dateStr: string): number {
  const dayStart = parseIsoDateLocal(dateStr).getTime();
  const mins = Math.round((ms - dayStart) / 60_000);
  return Math.max(0, Math.min(24 * 60, mins));
}

export function dateAndMinutesToMs(dateStr: string, minutes: number): number {
  const dt = parseIsoDateLocal(dateStr);
  dt.setHours(0, minutes, 0, 0);
  return dt.getTime();
}

export interface TimedLayoutInput {
  id: string;
  startMin: number;
  endMin: number;
}

export interface TimedLayoutItem<T extends TimedLayoutInput> {
  item: T;
  colIndex: number;
  colCount: number;
}

/**
 * Partition overlapping timed blocks into connected clusters and assign greedy
 * side-by-side column indices (`colIndex`, `colCount`).
 */
export function layoutDayBlocks<T extends TimedLayoutInput>(items: T[]): TimedLayoutItem<T>[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const out: TimedLayoutItem<T>[] = [];
  let cluster: { item: T; colIndex: number }[] = [];
  let colEnds: number[] = [];
  let clusterMaxEnd = -1;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const colCount = Math.max(1, colEnds.length);
    for (const entry of cluster) {
      out.push({ item: entry.item, colIndex: entry.colIndex, colCount });
    }
    cluster = [];
    colEnds = [];
    clusterMaxEnd = -1;
  };

  for (const item of sorted) {
    const safeEnd = Math.max(item.startMin + MIN_DURATION_MINUTES, item.endMin);
    if (cluster.length > 0 && item.startMin >= clusterMaxEnd) {
      flushCluster();
    }
    let placedCol = colEnds.findIndex((end) => end <= item.startMin);
    if (placedCol === -1) {
      placedCol = colEnds.length;
      colEnds.push(safeEnd);
    } else {
      colEnds[placedCol] = safeEnd;
    }
    clusterMaxEnd = Math.max(clusterMaxEnd, safeEnd);
    cluster.push({ item, colIndex: placedCol });
  }
  flushCluster();
  return out;
}

export function parseIsoDateLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function toIsoDateLocal(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDaysIso(iso: string, delta: number): string {
  const dt = parseIsoDateLocal(iso);
  dt.setDate(dt.getDate() + delta);
  return toIsoDateLocal(dt);
}

export function addMonthsIso(iso: string, delta: number): string {
  const dt = parseIsoDateLocal(iso);
  dt.setMonth(dt.getMonth() + delta);
  return toIsoDateLocal(dt);
}

/** ISO weekday 1..=7 (1 = Mon .. 7 = Sun). */
export function isoWeekdayFromIso(iso: string): number {
  const jsDay = parseIsoDateLocal(iso).getDay();
  return jsDay === 0 ? 7 : jsDay;
}

export function startOfWeekIso(iso: string, weekStart: WeekStart = "mon"): string {
  const wd = isoWeekdayFromIso(iso);
  const firstWd = weekStart === "sat" ? 6 : weekStart === "sun" ? 7 : 1;
  const offset = (wd - firstWd + 7) % 7;
  return addDaysIso(iso, -offset);
}

export function buildWeekDays(anchorIso: string, weekStart: WeekStart = "mon"): string[] {
  const start = startOfWeekIso(anchorIso, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
}

export function buildThreeDayDays(anchorIso: string): string[] {
  return Array.from({ length: 3 }, (_, i) => addDaysIso(anchorIso, i));
}

export function buildMonthGridDays(
  anchorIso: string,
  weekStart: WeekStart = "mon",
): {
  days: string[];
  monthPrefix: string;
} {
  const dt = parseIsoDateLocal(anchorIso);
  const firstOfMonth = new Date(dt.getFullYear(), dt.getMonth(), 1);
  const firstIso = toIsoDateLocal(firstOfMonth);
  const gridStart = startOfWeekIso(firstIso, weekStart);
  const days = Array.from({ length: 42 }, (_, i) => addDaysIso(gridStart, i));
  return {
    days,
    monthPrefix: firstIso.slice(0, 7),
  };
}

export function buildAgendaDays(anchorIso: string, count = 14): string[] {
  return Array.from({ length: count }, (_, i) => addDaysIso(anchorIso, i));
}

export function computeWindowMs(
  view: CalendarViewMode,
  anchorIso: string,
  weekStart: WeekStart = "mon",
): { startIso: string; endIso: string; windowStartMs: number; windowEndMs: number } {
  let startIso: string;
  let endIso: string;
  if (view === "day") {
    startIso = anchorIso;
    endIso = addDaysIso(anchorIso, 1);
  } else if (view === "threeDay") {
    startIso = anchorIso;
    endIso = addDaysIso(anchorIso, 3);
  } else if (view === "week") {
    startIso = startOfWeekIso(anchorIso, weekStart);
    endIso = addDaysIso(startIso, 7);
  } else if (view === "month") {
    const { days } = buildMonthGridDays(anchorIso, weekStart);
    startIso = days[0];
    endIso = addDaysIso(days[days.length - 1], 1);
  } else {
    startIso = anchorIso;
    endIso = addDaysIso(anchorIso, 14);
  }
  const s = parseIsoDateLocal(startIso);
  const e = parseIsoDateLocal(endIso);
  // Pad by 1 day on each side so UTC all-day boundaries always overlap cleanly.
  const PAD = 86_400_000;
  return {
    startIso,
    endIso,
    windowStartMs: s.getTime() - PAD,
    windowEndMs: e.getTime() + PAD,
  };
}

/**
 * Map `DueForecastDto.forecast` (or legacy `StatsDto.forecast`) counts to
 * `"YYYY-MM-DD"` dates.
 */
export function forecastByDate(source: DueForecastDto | StatsDto | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!source) return map;
  for (const item of source.forecast) {
    if (item.count <= 0) continue;
    const dateStr =
      item.date ||
      ("dates" in source ? source.dates?.[source.today + item.day] : undefined) ||
      ("day0_ms" in source
        ? toIsoDateLocal(new Date(source.day0_ms + (source.today + item.day) * 86_400_000))
        : "");
    if (dateStr) {
      map.set(dateStr, (map.get(dateStr) ?? 0) + item.count);
    }
  }
  return map;
}

export function localDateFromMs(ms: number): string {
  return toIsoDateLocal(new Date(ms));
}

export function formatEventTimeRange(startMs: number, endMs: number): string {
  const startStr = formatDate(startMs, { timeStyle: "short" }).replace(/\s+/g, "\u00A0");
  const endStr = formatDate(endMs, { timeStyle: "short" }).replace(/\s+/g, "\u00A0");
  return `${startStr}–${endStr}`;
}

export function isoDayDiff(aIso: string, bIso: string): number {
  const a = parseIsoDateLocal(aIso);
  const b = parseIsoDateLocal(bIso);
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcA - utcB) / 86_400_000);
}

export function scheduledHabitsForDate(
  habits: HabitDto[],
  dateStr: string,
  todayDayIndex: number,
  todayDate: string,
): HabitDto[] {
  const dayIndex = todayDayIndex + isoDayDiff(dateStr, todayDate);
  return habits.filter((h) => isHabitScheduledForDay(h, dayIndex, dateStr));
}

export function localizedWeekdayOptions(
  weekStart: WeekStart = "mon",
  width: "short" | "narrow" = "short",
): { iso: number; label: string }[] {
  const firstWd = weekStart === "sat" ? 6 : weekStart === "sun" ? 7 : 1;
  return Array.from({ length: 7 }, (_, i) => {
    const iso = ((firstWd - 1 + i) % 7) + 1;
    // 2024-01-01 is ISO weekday 1 (Monday).
    return {
      iso,
      label: formatDate(new Date(2024, 0, iso), { weekday: width }),
    };
  });
}
