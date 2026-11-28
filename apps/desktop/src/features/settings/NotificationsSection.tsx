import { useId, useState } from "react";
import {
  SettingsCard,
  SettingsSectionHeader,
  SettingsToggleRow,
} from "@/components/ui/settings-kit";
import { t } from "@/lib/i18n";
import { platform } from "@/lib/platform";
import { useReminders } from "@/stores/reminders";

export function NotificationsSection() {
  const baseId = useId();
  const dailyStudyEnabled = useReminders((s) => s.dailyStudyEnabled);
  const dailyStudyTime = useReminders((s) => s.dailyStudyTime);
  const eveningStreakEnabled = useReminders((s) => s.eveningStreakEnabled);
  const eveningStreakTime = useReminders((s) => s.eveningStreakTime);
  const habitRemindersEnabled = useReminders((s) => s.habitRemindersEnabled);
  const setDailyStudyEnabled = useReminders((s) => s.setDailyStudyEnabled);
  const setDailyStudyTime = useReminders((s) => s.setDailyStudyTime);
  const setEveningStreakEnabled = useReminders((s) => s.setEveningStreakEnabled);
  const setEveningStreakTime = useReminders((s) => s.setEveningStreakTime);
  const setHabitRemindersEnabled = useReminders((s) => s.setHabitRemindersEnabled);

  const [checkingPermission, setCheckingPermission] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  async function toggleWithPermission(next: boolean, apply: (enabled: boolean) => void) {
    if (!next) {
      setPermissionDenied(false);
      apply(false);
      return;
    }

    const api = platform.notifications;
    if (!api) {
      setPermissionDenied(false);
      apply(true);
      return;
    }

    setCheckingPermission(true);
    try {
      let granted = await api.isPermissionGranted().catch(() => false);
      if (!granted) {
        const result = await api.requestPermission().catch(() => "denied" as const);
        granted = result === "granted";
      }
      if (!granted) {
        setPermissionDenied(true);
        apply(false);
        return;
      }
      setPermissionDenied(false);
      apply(true);
    } finally {
      setCheckingPermission(false);
    }
  }

  return (
    <SettingsCard>
      <SettingsSectionHeader title={t("settings.notifications.cardTitle")} />

      <div className="space-y-3">
        <SettingsToggleRow
          divider
          id={`${baseId}-daily`}
          label={t("settings.notifications.dailyStudy")}
          hint={t("settings.notifications.dailyStudyHint")}
          checked={dailyStudyEnabled}
          disabled={checkingPermission}
          onToggle={(next) => void toggleWithPermission(next, setDailyStudyEnabled)}
        >
          <div className="flex items-center gap-3 ps-1">
            <label
              htmlFor={`${baseId}-daily-time`}
              className="text-xs font-medium text-muted-foreground"
            >
              {t("settings.notifications.dailyStudyTime")}
            </label>
            <input
              id={`${baseId}-daily-time`}
              type="time"
              value={dailyStudyTime}
              onChange={(e) => setDailyStudyTime(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </SettingsToggleRow>

        <SettingsToggleRow
          divider
          id={`${baseId}-evening`}
          label={t("settings.notifications.eveningStreak")}
          hint={t("settings.notifications.eveningStreakHint")}
          checked={eveningStreakEnabled}
          disabled={checkingPermission}
          onToggle={(next) => void toggleWithPermission(next, setEveningStreakEnabled)}
        >
          <div className="flex items-center gap-3 ps-1">
            <label
              htmlFor={`${baseId}-evening-time`}
              className="text-xs font-medium text-muted-foreground"
            >
              {t("settings.notifications.eveningStreakTime")}
            </label>
            <input
              id={`${baseId}-evening-time`}
              type="time"
              value={eveningStreakTime}
              onChange={(e) => setEveningStreakTime(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </SettingsToggleRow>

        <SettingsToggleRow
          divider
          id={`${baseId}-habits`}
          label={t("settings.notifications.habitReminders")}
          hint={t("settings.notifications.habitRemindersHint")}
          checked={habitRemindersEnabled}
          disabled={checkingPermission}
          onToggle={(next) => void toggleWithPermission(next, setHabitRemindersEnabled)}
        />
      </div>

      {permissionDenied && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
        >
          {t("settings.notifications.permissionDenied")}
        </p>
      )}

      <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
        {t("settings.notifications.runningHint")}
      </p>
    </SettingsCard>
  );
}
