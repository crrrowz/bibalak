import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DAILY_STUDY_TIME, DEFAULT_EVENING_STREAK_TIME, useReminders } from "./reminders";

describe("reminders store (16c)", () => {
  beforeEach(() => {
    localStorage.clear();
    useReminders.getState().reset();
  });

  it("settings_switches_persist", () => {
    const state = useReminders.getState();
    expect(state.dailyStudyEnabled).toBe(false);
    expect(state.dailyStudyTime).toBe(DEFAULT_DAILY_STUDY_TIME);
    expect(state.eveningStreakEnabled).toBe(false);
    expect(state.eveningStreakTime).toBe(DEFAULT_EVENING_STREAK_TIME);
    expect(state.habitRemindersEnabled).toBe(false);

    state.setDailyStudyEnabled(true);
    state.setDailyStudyTime("08:30");
    state.setEveningStreakEnabled(true);
    state.setEveningStreakTime("22:15");
    state.setHabitRemindersEnabled(true);

    // Reload from localStorage (simulating app restart on the same device).
    useReminders.getState().reloadFromStorage();

    const reloaded = useReminders.getState();
    expect(reloaded.dailyStudyEnabled).toBe(true);
    expect(reloaded.dailyStudyTime).toBe("08:30");
    expect(reloaded.eveningStreakEnabled).toBe(true);
    expect(reloaded.eveningStreakTime).toBe("22:15");
    expect(reloaded.habitRemindersEnabled).toBe(true);
  });

  it("ignores invalid time strings and keeps previous valid time", () => {
    const state = useReminders.getState();
    state.setDailyStudyTime("25:99");
    expect(useReminders.getState().dailyStudyTime).toBe("19:00");

    state.setEveningStreakTime("not-a-time");
    expect(useReminders.getState().eveningStreakTime).toBe("21:00");
  });
});
