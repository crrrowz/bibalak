import { create } from "zustand";

export const DEFAULT_DAILY_STUDY_TIME = "19:00";
export const DEFAULT_EVENING_STREAK_TIME = "21:00";

const STORAGE_KEY_DAILY_ENABLED = "keepsake-reminder-daily-enabled";
const STORAGE_KEY_DAILY_TIME = "keepsake-reminder-daily-time";
const STORAGE_KEY_EVENING_ENABLED = "keepsake-reminder-evening-enabled";
const STORAGE_KEY_EVENING_TIME = "keepsake-reminder-evening-time";
const STORAGE_KEY_HABITS_ENABLED = "keepsake-reminder-habits-enabled";

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidReminderTime(value: string): boolean {
  return TIME_PATTERN.test(value.trim());
}

function readStoredBool(key: string, fallback: boolean): boolean {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function readStoredTime(key: string, fallback: string): string {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null && isValidReminderTime(raw)) {
      return raw.trim();
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable
  }
}

export interface ReminderSettings {
  dailyStudyEnabled: boolean;
  dailyStudyTime: string;
  eveningStreakEnabled: boolean;
  eveningStreakTime: string;
  habitRemindersEnabled: boolean;
}

export interface RemindersState extends ReminderSettings {
  setDailyStudyEnabled: (enabled: boolean) => void;
  setDailyStudyTime: (time: string) => void;
  setEveningStreakEnabled: (enabled: boolean) => void;
  setEveningStreakTime: (time: string) => void;
  setHabitRemindersEnabled: (enabled: boolean) => void;
  reloadFromStorage: () => void;
  reset: () => void;
}

function loadFromStorage(): ReminderSettings {
  return {
    dailyStudyEnabled: readStoredBool(STORAGE_KEY_DAILY_ENABLED, false),
    dailyStudyTime: readStoredTime(STORAGE_KEY_DAILY_TIME, DEFAULT_DAILY_STUDY_TIME),
    eveningStreakEnabled: readStoredBool(STORAGE_KEY_EVENING_ENABLED, false),
    eveningStreakTime: readStoredTime(STORAGE_KEY_EVENING_TIME, DEFAULT_EVENING_STREAK_TIME),
    habitRemindersEnabled: readStoredBool(STORAGE_KEY_HABITS_ENABLED, false),
  };
}

export const useReminders = create<RemindersState>((set) => ({
  ...loadFromStorage(),

  setDailyStudyEnabled: (enabled) => {
    writeStorage(STORAGE_KEY_DAILY_ENABLED, String(enabled));
    set({ dailyStudyEnabled: enabled });
  },

  setDailyStudyTime: (time) => {
    const clean = time.trim();
    if (!isValidReminderTime(clean)) return;
    writeStorage(STORAGE_KEY_DAILY_TIME, clean);
    set({ dailyStudyTime: clean });
  },

  setEveningStreakEnabled: (enabled) => {
    writeStorage(STORAGE_KEY_EVENING_ENABLED, String(enabled));
    set({ eveningStreakEnabled: enabled });
  },

  setEveningStreakTime: (time) => {
    const clean = time.trim();
    if (!isValidReminderTime(clean)) return;
    writeStorage(STORAGE_KEY_EVENING_TIME, clean);
    set({ eveningStreakTime: clean });
  },

  setHabitRemindersEnabled: (enabled) => {
    writeStorage(STORAGE_KEY_HABITS_ENABLED, String(enabled));
    set({ habitRemindersEnabled: enabled });
  },

  reloadFromStorage: () => {
    set(loadFromStorage());
  },

  reset: () => {
    set({
      dailyStudyEnabled: false,
      dailyStudyTime: DEFAULT_DAILY_STUDY_TIME,
      eveningStreakEnabled: false,
      eveningStreakTime: DEFAULT_EVENING_STREAK_TIME,
      habitRemindersEnabled: false,
    });
  },
}));
