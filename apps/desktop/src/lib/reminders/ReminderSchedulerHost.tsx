import { useEffect } from "react";
import type { CoreEventName } from "@bibalak/ipc-types";
import { ipc, isTauri } from "@/lib/ipc";
import { platform } from "@/lib/platform";
import { useReminders } from "@/stores/reminders";
import { useStyle } from "@/stores/style";
import { createReminderScheduler } from "./scheduler";

/**
 * Mounts the single-timer desktop reminder runner in the main window.
 * Delegates all reminder rules to `ipc.planReminders` on app start, settings
 * or style changes, backend rollover, and core domain events.
 */
export function ReminderSchedulerHost() {
  const dailyStudyEnabled = useReminders((s) => s.dailyStudyEnabled);
  const dailyStudyTime = useReminders((s) => s.dailyStudyTime);
  const eveningStreakEnabled = useReminders((s) => s.eveningStreakEnabled);
  const eveningStreakTime = useReminders((s) => s.eveningStreakTime);
  const habitRemindersEnabled = useReminders((s) => s.habitRemindersEnabled);
  const style = useStyle((s) => s.style);

  useEffect(() => {
    const notifications = platform.notifications;
    if (!isTauri() || !notifications) return;

    const scheduler = createReminderScheduler({
      notifications,
      planReminders: (settings, currentStyle) => ipc.planReminders(settings, currentStyle),
      getSettings: () => {
        const s = useReminders.getState();
        return {
          dailyStudyEnabled: s.dailyStudyEnabled,
          dailyStudyTime: s.dailyStudyTime,
          eveningStreakEnabled: s.eveningStreakEnabled,
          eveningStreakTime: s.eveningStreakTime,
          habitRemindersEnabled: s.habitRemindersEnabled,
        };
      },
      getStyle: () => useStyle.getState().style,
    });

    scheduler.start();

    const unlisten = platform.listen<CoreEventName>("bibalak://event", (event) => {
      if (
        event === "card-answered" ||
        event === "productivity-changed" ||
        event === "game-changed" ||
        event === "schema-changed" ||
        event === "collection-opened"
      ) {
        void scheduler.replan();
      }
    });

    return () => {
      unlisten();
      scheduler.stop();
    };
  }, [
    dailyStudyEnabled,
    dailyStudyTime,
    eveningStreakEnabled,
    eveningStreakTime,
    habitRemindersEnabled,
    style,
  ]);

  return null;
}
