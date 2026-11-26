import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReminderPlanDto, ReminderSettingsInput } from "@bibalak/ipc-types";
import { setLocale } from "@/lib/i18n";
import type { NotificationPayload, NotificationsApi } from "@/lib/platform/types";
import {
  createMemoryFiredStore,
  createReminderScheduler,
  type ReminderSettingsSnapshot,
} from "./scheduler";

function makeFakeNotifications(granted = true): {
  api: NotificationsApi;
  sent: NotificationPayload[];
} {
  const sent: NotificationPayload[] = [];
  return {
    sent,
    api: {
      isPermissionGranted: vi.fn(async () => granted),
      requestPermission: vi.fn(async () => (granted ? "granted" : "denied")),
      sendNotification: vi.fn(async (payload) => {
        sent.push(payload);
      }),
    },
  };
}

const BASE_SETTINGS: ReminderSettingsSnapshot = {
  dailyStudyEnabled: true,
  dailyStudyTime: "19:00",
  eveningStreakEnabled: false,
  eveningStreakTime: "21:00",
  habitRemindersEnabled: false,
};

describe("reminder runner (16c)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setLocale("en");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls plan_reminders on start and schedules single timer until fire_at_ms", async () => {
    const startMs = 1_795_000_000_000;
    vi.setSystemTime(startMs);

    const { api, sent } = makeFakeNotifications(true);
    const planReminders = vi.fn(
      async (_settings: ReminderSettingsInput): Promise<ReminderPlanDto> => ({
        items: [
          {
            id: "daily:10",
            kind: "daily_study",
            fire_at_ms: startMs + 60_000,
            title_key: "reminders.daily.title.default",
            body_key: "reminders.daily.body.default",
            args: {},
          },
        ],
        next_rollover_ms: startMs + 3_600_000,
      }),
    );

    const runner = createReminderScheduler({
      notifications: api,
      planReminders,
      getSettings: () => BASE_SETTINGS,
      getStyle: () => "default",
      firedStore: createMemoryFiredStore(),
    });

    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(planReminders).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe("Time for a quick review");
    runner.stop();
  });

  it("hands due items to notifications and remembers fired ids across replans", async () => {
    const nowMs = 1_795_000_000_000;
    vi.setSystemTime(nowMs);

    const { api, sent } = makeFakeNotifications(true);
    const planReminders = vi.fn(
      async (): Promise<ReminderPlanDto> => ({
        items: [
          {
            id: "evening:10",
            kind: "evening_streak",
            fire_at_ms: nowMs,
            title_key: "reminders.evening.title.game",
            body_key: "reminders.evening.bodyWithFreeze.game",
            args: { count: "7" },
          },
        ],
        next_rollover_ms: nowMs + 3_600_000,
      }),
    );

    const runner = createReminderScheduler({
      notifications: api,
      planReminders,
      getSettings: () => ({
        ...BASE_SETTINGS,
        dailyStudyEnabled: false,
        eveningStreakEnabled: true,
      }),
      getStyle: () => "game",
      firedStore: createMemoryFiredStore(),
    });

    await runner.replan();
    await runner.replan();
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe("Your streak is waiting");
    expect(sent[0].body).toContain("7");
    expect(sent[0].body.toLowerCase()).toContain("freeze");
    runner.stop();
  });

  it("replans at backend next_rollover_ms using a single timer", async () => {
    const nowMs = 1_795_000_000_000;
    vi.setSystemTime(nowMs);

    const { api, sent } = makeFakeNotifications(true);
    let call = 0;
    const planReminders = vi.fn(async (): Promise<ReminderPlanDto> => {
      call += 1;
      if (call === 1) {
        return {
          items: [],
          next_rollover_ms: nowMs + 30_000,
        };
      }
      return {
        items: [
          {
            id: "habit:h1:08:00:11",
            kind: "habit",
            fire_at_ms: nowMs + 30_500,
            title_key: "reminders.habit.title.scholar",
            body_key: "reminders.habit.body.scholar",
            args: { title: "Read" },
          },
        ],
        next_rollover_ms: nowMs + 86_430_000,
      };
    });

    const runner = createReminderScheduler({
      notifications: api,
      planReminders,
      getSettings: () => ({
        ...BASE_SETTINGS,
        dailyStudyEnabled: false,
        habitRemindersEnabled: true,
      }),
      getStyle: () => "scholar",
      firedStore: createMemoryFiredStore(),
    });

    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(planReminders).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(30_600);
    expect(planReminders).toHaveBeenCalledTimes(2);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain("Read");
    runner.stop();
  });
});
