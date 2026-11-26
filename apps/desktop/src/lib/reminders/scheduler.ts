import type {
  PlannedReminderDto,
  ReminderPlanDto,
  ReminderSettingsInput,
} from "@bibalak/ipc-types";
import { t, tn, type PluralKey } from "@/lib/i18n";
import type { NotificationPayload, NotificationsApi } from "@/lib/platform/types";
import type { LocaleKey } from "@/locales/en";
import type { ReminderSettings } from "@/stores/reminders";
import type { Style } from "@/stores/style";

export type ReminderSettingsSnapshot = ReminderSettings;

export interface FiredRemindersStore {
  hasFired(id: string): boolean;
  markFired(id: string, nowMs: number): void;
}

export interface ReminderSchedulerOptions {
  notifications: NotificationsApi;
  planReminders: (settings: ReminderSettingsInput, style: Style) => Promise<ReminderPlanDto>;
  getSettings: () => ReminderSettingsSnapshot;
  getStyle: () => Style;
  firedStore?: FiredRemindersStore;
  now?: () => number;
}

export interface ReminderScheduler {
  start(): void;
  stop(): void;
  replan(): Promise<void>;
}

const FIRED_STORAGE_KEY = "keepsake-reminders-fired";
const ROLLOVER_BUFFER_MS = 500;
const RETENTION_MS = 48 * 3_600_000;

export function toReminderSettingsInput(settings: ReminderSettingsSnapshot): ReminderSettingsInput {
  return {
    daily_study_enabled: settings.dailyStudyEnabled,
    daily_study_time: settings.dailyStudyTime,
    evening_streak_enabled: settings.eveningStreakEnabled,
    evening_streak_time: settings.eveningStreakTime,
    habit_reminders_enabled: settings.habitRemindersEnabled,
  };
}

export function formatPlannedReminder(item: PlannedReminderDto): NotificationPayload {
  const title = t(item.title_key as LocaleKey, item.args);
  const body =
    item.kind === "evening_streak"
      ? tn(item.body_key as PluralKey, Number(item.args.count ?? 0), item.args)
      : t(item.body_key as LocaleKey, item.args);
  return { title, body };
}

export function createMemoryFiredStore(): FiredRemindersStore {
  const fired = new Map<string, number>();
  return {
    hasFired(id: string) {
      return fired.has(id);
    },
    markFired(id: string, nowMs: number) {
      for (const [existingId, ts] of fired) {
        if (nowMs - ts > RETENTION_MS) {
          fired.delete(existingId);
        }
      }
      fired.set(id, nowMs);
    },
  };
}

export function createLocalFiredStore(): FiredRemindersStore {
  function readAll(): Record<string, number> {
    if (typeof localStorage === "undefined") return {};
    try {
      const raw = localStorage.getItem(FIRED_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return parsed as Record<string, number>;
    } catch {
      return {};
    }
  }

  return {
    hasFired(id: string) {
      const map = readAll();
      return Object.prototype.hasOwnProperty.call(map, id);
    },
    markFired(id: string, nowMs: number) {
      if (typeof localStorage === "undefined") return;
      const map = readAll();
      const pruned: Record<string, number> = {};
      for (const [k, ts] of Object.entries(map)) {
        if (typeof ts === "number" && nowMs - ts <= RETENTION_MS) {
          pruned[k] = ts;
        }
      }
      pruned[id] = nowMs;
      try {
        localStorage.setItem(FIRED_STORAGE_KEY, JSON.stringify(pruned));
      } catch {
        // storage unavailable
      }
    },
  };
}

export function createReminderScheduler(options: ReminderSchedulerOptions): ReminderScheduler {
  const firedStore = options.firedStore ?? createLocalFiredStore();
  const now = options.now ?? (() => Date.now());
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let replanRequested = false;

  function clearTimer() {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function scheduleSingleTimer(wakeAtMs: number) {
    clearTimer();
    if (stopped) return;
    const delayMs = Math.max(1, wakeAtMs - now());
    timerId = setTimeout(() => {
      timerId = null;
      void runReplan();
    }, delayMs);
  }

  async function evaluateAndSchedule() {
    clearTimer();
    if (stopped) return;

    const settings = options.getSettings();
    const anyEnabled =
      settings.dailyStudyEnabled || settings.eveningStreakEnabled || settings.habitRemindersEnabled;
    if (!anyEnabled) return;

    const granted = await options.notifications.isPermissionGranted().catch(() => false);
    if (!granted || stopped) return;

    const plan = await options.planReminders(toReminderSettingsInput(settings), options.getStyle());
    if (stopped) return;

    const nowMs = now();
    let nextWakeAtMs = plan.next_rollover_ms + ROLLOVER_BUFFER_MS;

    for (const item of plan.items) {
      if (firedStore.hasFired(item.id)) continue;

      if (item.fire_at_ms <= nowMs) {
        firedStore.markFired(item.id, nowMs);
        const payload = formatPlannedReminder(item);
        await options.notifications.sendNotification(payload).catch(() => {});
        continue;
      }

      if (item.fire_at_ms < nextWakeAtMs) {
        nextWakeAtMs = item.fire_at_ms;
      }
    }

    if (!stopped) {
      scheduleSingleTimer(nextWakeAtMs);
    }
  }

  async function runReplan(): Promise<void> {
    if (stopped) return;
    if (inFlight) {
      replanRequested = true;
      return inFlight;
    }

    inFlight = (async () => {
      do {
        replanRequested = false;
        await evaluateAndSchedule().catch(() => {});
      } while (replanRequested && !stopped);
    })();

    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return {
    start() {
      stopped = false;
      void runReplan();
    },
    stop() {
      stopped = true;
      clearTimer();
    },
    replan() {
      return runReplan();
    },
  };
}
