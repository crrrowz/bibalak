import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  SettingsCard,
  SettingsSectionHeader,
  SettingsToggleRow,
} from "@/components/ui/settings-kit";
import { errorMessage, ipc } from "@/lib/ipc";
import { platform } from "@/lib/platform";
import { queryKeys } from "@/lib/queryKeys";
import { t } from "@/lib/i18n";

async function applyGlobalShortcut(
  previousShortcut: string | null,
  enabled: boolean,
  shortcut: string,
): Promise<void> {
  const api = platform.globalShortcut;
  if (!api) return;

  if (previousShortcut && (await api.isRegistered(previousShortcut).catch(() => false))) {
    await api.unregister(previousShortcut).catch(() => {});
  }

  if (enabled) {
    await api.register(shortcut, () => {
      void ipc.toggleQuickAdd();
    });
  }
}

export function QuickAddSection() {
  const queryClient = useQueryClient();
  const cfgQuery = useQuery({
    queryKey: queryKeys.quickAddConfig,
    queryFn: ipc.getQuickAddConfig,
  });

  const [enabled, setEnabled] = useState(false);
  const [shortcut, setShortcut] = useState("Ctrl+Shift+K");
  const [activeShortcut, setActiveShortcut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [refusalErr, setRefusalErr] = useState<string | null>(null);

  useEffect(() => {
    if (!cfgQuery.data) return;
    setEnabled(cfgQuery.data.enabled);
    setShortcut(cfgQuery.data.shortcut);
    setActiveShortcut(cfgQuery.data.enabled ? cfgQuery.data.shortcut : null);
  }, [cfgQuery.data]);

  async function commit(nextEnabled: boolean, nextShortcut: string) {
    const trimmed = nextShortcut.trim() || "Ctrl+Shift+K";
    setBusy(true);
    setStatusMsg(null);
    setRefusalErr(null);

    try {
      await applyGlobalShortcut(activeShortcut, nextEnabled, trimmed);
      const saved = await ipc.setQuickAddConfig(nextEnabled, trimmed);
      setEnabled(saved.enabled);
      setShortcut(saved.shortcut);
      setActiveShortcut(saved.enabled ? saved.shortcut : null);
      if (saved.enabled) {
        setStatusMsg(t("settings.quickAdd.saved", { shortcut: saved.shortcut }));
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.quickAddConfig });
    } catch (err) {
      // If the OS refuses the shortcut, keep quick-add disabled cleanly and tell the user.
      if (nextEnabled) {
        await ipc.setQuickAddConfig(false, trimmed).catch(() => {});
        setEnabled(false);
        setActiveShortcut(null);
        setRefusalErr(
          t("settings.quickAdd.refused", { shortcut: trimmed, reason: errorMessage(err) }),
        );
      } else {
        setRefusalErr(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard>
      <SettingsSectionHeader
        title={t("settings.quickAdd.title")}
        description={t("settings.quickAdd.description")}
      />

      <SettingsToggleRow
        label={t("settings.quickAdd.enable")}
        checked={enabled}
        disabled={busy || cfgQuery.isLoading}
        onToggle={(next) => {
          void commit(next, shortcut);
        }}
      />

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="quick-add-shortcut" className="block text-xs text-muted-foreground">
            {t("settings.quickAdd.shortcutLabel")}
          </label>
          <input
            id="quick-add-shortcut"
            value={shortcut}
            disabled={busy}
            onChange={(e) => setShortcut(e.target.value)}
            placeholder={t("settings.quickAdd.placeholder")}
            className="h-8 w-52 rounded-md border border-input bg-background px-2.5 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || cfgQuery.isLoading}
          onClick={() => {
            void commit(enabled, shortcut);
          }}
        >
          {t("settings.quickAdd.apply")}
        </Button>
        {enabled && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              void ipc.toggleQuickAdd();
            }}
          >
            {t("settings.quickAdd.openNow")}
          </Button>
        )}
      </div>

      {refusalErr && (
        <p role="alert" className="text-sm text-destructive">
          {refusalErr}
        </p>
      )}
      {statusMsg && !refusalErr && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {statusMsg}
        </p>
      )}
    </SettingsCard>
  );
}
