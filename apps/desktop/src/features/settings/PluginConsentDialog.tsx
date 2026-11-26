import { ShieldAlert } from "lucide-react";
import type { PluginInfo } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t } from "@/lib/i18n";
import { permissionLabel } from "./settingsUtils";

export interface PluginConsentDialogProps {
  plugin: PluginInfo | null;
  isPending?: boolean;
  onConfirm: (plugin: PluginInfo) => void;
  onCancel: () => void;
}

/** Accessible permission review modal shown before enabling a plugin. */
export function PluginConsentDialog({
  plugin,
  isPending = false,
  onConfirm,
  onCancel,
}: PluginConsentDialogProps) {
  return (
    <Dialog
      open={plugin !== null}
      onClose={onCancel}
      role="dialog"
      ariaLabel={plugin ? t("settings.plugins.consentTitle", { name: plugin.name }) : undefined}
      closeOnEscape={!isPending}
      closeOnBackdrop={!isPending}
      className="max-w-md p-6"
    >
      {plugin && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShieldAlert className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">
                {t("settings.plugins.consentTitle", { name: plugin.name })}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                v{plugin.version}
                {plugin.author ? ` · ${t("settings.plugins.by", { author: plugin.author })}` : ""}
                {plugin.api_version ? ` · API ${plugin.api_version}` : ""}
              </p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">{t("settings.plugins.consentSubtitle")}</p>

          {plugin.permissions.length === 0 ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {t("settings.plugins.consentNone")}
            </p>
          ) : (
            <ul className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
              {plugin.permissions.map((perm) => (
                <li key={perm} className="flex items-start gap-2">
                  <span
                    className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="text-foreground">{permissionLabel(perm)}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{perm}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onCancel} disabled={isPending}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => onConfirm(plugin)} disabled={isPending}>
              {t("settings.plugins.consentAllow")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
