import type { HabitDto, HabitSection, WeekStart } from "@bibalak/ipc-types";
import { formatDate, t, tn } from "@/lib/i18n";

export type AsyncHandler<A extends unknown[]> = (...args: A) => Promise<void>;

export const HABIT_SECTIONS: readonly HabitSection[] = ["morning", "afternoon", "night", "others"];

export const HABIT_ICON_KEYS = [
  "check-circle",
  "book-open",
  "droplet",
  "dumbbell",
  "brain",
  "moon",
  "sun",
  "clock",
  "sparkles",
  "target",
] as const;

export type HabitIconKey = (typeof HABIT_ICON_KEYS)[number];

export function parseIsoDateLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** ISO weekday 1..=7 (1 = Monday .. 7 = Sunday) from `"YYYY-MM-DD"`. */
export function isoWeekdayFromDate(iso: string): number {
  const jsDay = parseIsoDateLocal(iso).getDay();
  return jsDay === 0 ? 7 : jsDay;
}

/** Localized short weekday labels for ISO weekdays 1 (Mon) .. 7 (Sun). */
export function localizedWeekdayOptions(): { iso: number; label: string }[] {
  // 2024-01-01 is a Monday.
  return Array.from({ length: 7 }, (_, i) => ({
    iso: i + 1,
    label: formatDate(new Date(2024, 0, 1 + i), { weekday: "short" }),
  }));
}

/** Client-side schedule check when filtering the list by a clicked day ring. */
export function isHabitScheduledForDay(
  habit: HabitDto,
  dayIndex: number,
  dateStr: string,
): boolean {
  if (habit.archived_at !== null) return false;
  if (dayIndex < habit.start_day_index) return false;
  if (habit.target_days !== null && dayIndex >= habit.start_day_index + habit.target_days) {
    return false;
  }
  switch (habit.frequency_kind) {
    case "daily":
    case "weekly_count":
      return true;
    case "weekdays":
      return habit.weekdays.includes(isoWeekdayFromDate(dateStr));
    case "every_n_days": {
      const interval = Math.max(1, habit.interval_days ?? 1);
      return (dayIndex - habit.start_day_index) % interval === 0;
    }
  }
}

/** Quick-increment preset chips for `reach_amount` habits based on `goal_target` (spec §5.2). */
export function amountPresetSteps(goalTarget: number): number[] {
  if (goalTarget <= 10) return [1];
  if (goalTarget <= 100) return [1, 5, 10];
  return [50, 250];
}

/** ISO weekday (1 = Mon .. 7 = Sun) corresponding to `WeekStart`. */
export function weekStartIsoWeekday(weekStart: WeekStart): number {
  switch (weekStart) {
    case "sat":
      return 6;
    case "sun":
      return 7;
    case "mon":
      return 1;
  }
}

/** Whole calendar days `(isoA - isoB)` using UTC midnights (DST-safe). */
export function diffIsoDays(isoA: string, isoB: string): number {
  const [ya, ma, da] = isoA.split("-").map(Number);
  const [yb, mb, db] = isoB.split("-").map(Number);
  const utcA = Date.UTC(ya, (ma || 1) - 1, da || 1);
  const utcB = Date.UTC(yb, (mb || 1) - 1, db || 1);
  return Math.round((utcA - utcB) / 86_400_000);
}

/** Shift a `"YYYY-MM-DD"` date string by `delta` calendar days. */
export function addIsoDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + delta));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Localized 7 weekday headers ordered starting at `weekStart`. */
export function localizedWeekStartHeaders(weekStart: WeekStart): { iso: number; label: string }[] {
  const firstIso = weekStartIsoWeekday(weekStart);
  return Array.from({ length: 7 }, (_, i) => {
    const iso = ((firstIso - 1 + i) % 7) + 1;
    // 2024-01-01 is Monday (ISO 1).
    return {
      iso,
      label: formatDate(new Date(2024, 0, iso), { weekday: "narrow" }),
    };
  });
}

/** Build 35 or 42 month-grid cells starting on the configured `weekStart`. */
export function buildMonthGridCells(
  year: number,
  monthIndex0: number,
  weekStart: WeekStart,
): { date: string; dayNumber: number; inMonth: boolean }[] {
  const firstDayDt = new Date(Date.UTC(year, monthIndex0, 1));
  const jsDay = firstDayDt.getUTCDay();
  const firstIso = jsDay === 0 ? 7 : jsDay;
  const startIso = weekStartIsoWeekday(weekStart);
  const leading = (((firstIso - startIso) % 7) + 7) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;

  return Array.from({ length: totalCells }, (_, idx) => {
    const dt = new Date(Date.UTC(year, monthIndex0, 1 - leading + idx));
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return {
      date: `${yy}-${mm}-${dd}`,
      dayNumber: dt.getUTCDate(),
      inMonth: dt.getUTCMonth() === monthIndex0,
    };
  });
}

/** Concise localized frequency summary for archived and detail views. */
export function formatHabitFrequency(habit: HabitDto): string {
  switch (habit.frequency_kind) {
    case "daily":
      return t("habits.freq.daily");
    case "weekdays":
      return tn("habits.freq.weekdays", habit.weekdays.length);
    case "weekly_count":
      return tn("habits.freq.weeklyCount", habit.weekly_target ?? 1);
    case "every_n_days":
      return tn("habits.freq.everyNDays", habit.interval_days ?? 1);
  }
}
