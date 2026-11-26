import type { WeekStart } from "@bibalak/ipc-types";
import { create } from "zustand";
import { getLocale, useLocale, type Locale } from "@/lib/i18n";

const STORAGE_KEY = "keepsake-week-start";

function isWeekStart(value: unknown): value is WeekStart {
  return value === "sat" || value === "sun" || value === "mon";
}

export function defaultWeekStartForLocale(locale: Locale): WeekStart {
  return locale === "ar" ? "sat" : "mon";
}

function readStoredOverride(): WeekStart | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isWeekStart(value) ? value : null;
  } catch {
    return null;
  }
}

interface WeekStartState {
  weekStart: WeekStart;
  setWeekStart: (weekStart: WeekStart) => void;
}

const initial: WeekStart = readStoredOverride() ?? defaultWeekStartForLocale(getLocale());

export const useWeekStart = create<WeekStartState>((set) => ({
  weekStart: initial,
  setWeekStart: (weekStart) => {
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, weekStart);
      } catch {
        // storage unavailable: still update in-memory state
      }
    }
    set({ weekStart });
  },
}));

// Keep effective start day synced with locale changes unless user set an explicit override.
useLocale.subscribe((state) => {
  if (readStoredOverride() === null) {
    useWeekStart.setState({ weekStart: defaultWeekStartForLocale(state.locale) });
  }
});
