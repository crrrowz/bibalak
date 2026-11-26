import { useEffect, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { PluginInfo } from "@bibalak/ipc-types";
import { AlertTriangle, FolderOpen, PackageOpen, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { errorMessage, ipc } from "@/lib/ipc";
import { platform } from "@/lib/platform";
import { pluginHost, type PluginToast } from "@/lib/pluginHost";
import { queryKeys } from "@/lib/queryKeys";
import { PluginConsentDialog } from "./PluginConsentDialog";
import { Spinner } from "./SettingsSpinner";
import { permissionLabel } from "./settingsUtils";

function isCompatibleApiVersion(version: string): boolean {
  if (!version) return true;
  const trimmed = version.trim();
  return trimmed === "0.2" || /^0\.2\.\d+$/.test(trimmed);
}

export function PluginManagerSection() {
  const [toast, setToast] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [runResult, setRunResult] = useState<string | null>(null);
  const [consentPlugin, setConsentPlugin] = useState<PluginInfo | null>(null);
  const [removeTarget, setRemoveTarget] = useState<PluginInfo | null>(null);

  const hostSnapshot = useSyncExternalStore(pluginHost.subscribe, pluginHost.getSnapshot);
  const pluginsQuery = useQuery({ queryKey: queryKeys.plugins, queryFn: ipc.listPlugins });

  // Subscribe to plugin toasts
  useEffect(() => {
    const unsub = pluginHost.onToast((toastMsg: PluginToast) => {
      setToast(toastMsg.message);
      setTimeout(() => setToast(null), 4000);
    });
    return unsub;
  }, []);

  function markLoading(id: string, loading: boolean) {
    setLoadingIds((prev) => {
      const next = new Set(prev);
      if (loading) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const enableMut = useMutation({
    mutationFn: async (plugin: PluginInfo) => {
      setErrorMsg(null);
      await ipc.enablePlugin(plugin.id);
      const code = await ipc.getPluginEntry(plugin.id);
      pluginHost.load(plugin.id, plugin.permissions, code, {
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description ?? undefined,
        author: plugin.author ?? undefined,
        apiVersion: plugin.api_version || "0.2.0",
      });
    },
    onSuccess: () => {
      setConsentPlugin(null);
      void pluginsQuery.refetch();
    },
    onError: (e) => {
      setConsentPlugin(null);
      const msg = errorMessage(e);
      setErrorMsg(msg);
      setToast(msg);
    },
  });

  const disableMut = useMutation({
    mutationFn: async (plugin: PluginInfo) => {
      setErrorMsg(null);
      await ipc.disablePlugin(plugin.id);
      pluginHost.unload(plugin.id);
    },
    onSuccess: () => void pluginsQuery.refetch(),
    onError: (e) => {
      const msg = errorMessage(e);
      setErrorMsg(msg);
      setToast(msg);
    },
  });

  const reloadMut = useMutation({
    mutationFn: async (plugin: PluginInfo) => {
      setErrorMsg(null);
      const code = await ipc.getPluginEntry(plugin.id);
      pluginHost.load(plugin.id, plugin.permissions, code, {
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description ?? undefined,
        author: plugin.author ?? undefined,
        apiVersion: plugin.api_version || "0.2.0",
      });
    },
    onSuccess: (_data, plugin) => {
      setToast(t("settings.plugins.reloaded", { name: plugin.name }));
    },
    onError: (e) => {
      const msg = errorMessage(e);
      setErrorMsg(msg);
      setToast(msg);
    },
  });

  const removeMut = useMutation({
    mutationFn: async (plugin: PluginInfo) => {
      setErrorMsg(null);
      pluginHost.unload(plugin.id);
      await ipc.removePlugin(plugin.id);
    },
    onSuccess: () => {
      setRemoveTarget(null);
      void pluginsQuery.refetch();
    },
    onError: (e) => {
      setRemoveTarget(null);
      const msg = errorMessage(e);
      setErrorMsg(msg);
      setToast(msg);
    },
  });

  const installFolderMut = useMutation({
    mutationFn: async () => {
      setErrorMsg(null);
      const selected = await platform.pickPath({
        directory: true,
        title: t("settings.plugins.selectFolder"),
      });
      if (selected === null) return null;
      return ipc.installPlugin(selected);
    },
    onSuccess: (installed) => {
      void pluginsQuery.refetch();
      if (installed) {
        setConsentPlugin(installed);
      }
    },
    onError: (e) => {
      const msg = errorMessage(e);
      setErrorMsg(msg);
      setToast(msg);
    },
  });

  const installZipMut = useMutation({
    mutationFn: async () => {
      setErrorMsg(null);
      const selected = await platform.pickPath({
        title: t("settings.plugins.selectZip"),
        filters: [{ name: t("settings.plugins.zipFilter"), extensions: ["zip"] }],
      });
      if (selected === null) return null;
      return ipc.installPluginZip(selected);
    },
    onSuccess: (installed) => {
      void pluginsQuery.refetch();
      if (installed) {
        setConsentPlugin(installed);
      }
    },
    onError: (e) => {
      const msg = errorMessage(e);
      setErrorMsg(msg);
      setToast(msg);
    },
  });

  const installSamplesMut = useMutation({
    mutationFn: async () => {
      setErrorMsg(null);
      return ipc.installSamplePlugins();
    },
    onSuccess: () => {
      void pluginsQuery.refetch();
      setToast(t("settings.plugins.samplesInstalled"));
    },
    onError: (e) => {
      const msg = errorMessage(e);
      setErrorMsg(msg);
      setToast(msg);
    },
  });

  const plugins = pluginsQuery.data ?? [];
  const commands = hostSnapshot.commands;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">{t("settings.plugins.title")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("settings.plugins.description")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={installFolderMut.isPending}
            onClick={() => installFolderMut.mutate()}
          >
            {installFolderMut.isPending ? (
              <Spinner />
            ) : (
              <FolderOpen className="size-3.5" aria-hidden="true" />
            )}
            {installFolderMut.isPending
              ? t("settings.plugins.installing")
              : t("settings.plugins.install")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={installZipMut.isPending}
            onClick={() => installZipMut.mutate()}
          >
            {installZipMut.isPending ? (
              <Spinner />
            ) : (
              <PackageOpen className="size-3.5" aria-hidden="true" />
            )}
            {t("settings.plugins.installZip")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={installSamplesMut.isPending}
            onClick={() => installSamplesMut.mutate()}
          >
            {installSamplesMut.isPending ? (
              <Spinner />
            ) : (
              <Sparkles className="size-3.5" aria-hidden="true" />
            )}
            {t("settings.plugins.installSamples")}
          </Button>
        </div>
      </div>

      {toast && (
        <div
          className="rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary"
          aria-live="polite"
        >
          {toast}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {pluginsQuery.isLoading && (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          <span>{t("common.loading")}</span>
        </div>
      )}

      {pluginsQuery.isError && (
        <div role="alert" className="text-sm text-destructive">
          {errorMessage(pluginsQuery.error)}
        </div>
      )}

      {plugins.length === 0 && !pluginsQuery.isLoading && !pluginsQuery.isError && (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          <p>{t("settings.plugins.none")}</p>
        </div>
      )}

      {plugins.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {plugins.map((p) => {
            const runtime = hostSnapshot.statuses.get(p.id);
            const crashed = runtime?.status === "crashed";
            const incompatible = !isCompatibleApiVersion(p.api_version);
            const busy = loadingIds.has(p.id);

            return (
              <li key={p.id} className="flex flex-col gap-2 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{p.name}</span>
                      <span className="text-xs text-muted-foreground">v{p.version}</span>
                      {p.author && (
                        <span className="text-xs text-muted-foreground">
                          {t("settings.plugins.by", { author: p.author })}
                        </span>
                      )}
                      {p.api_version && (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          API {p.api_version}
                        </span>
                      )}
                      {crashed && (
                        <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                          {t("settings.plugins.statusCrashed")}
                        </span>
                      )}
                      {incompatible && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                          {t("settings.plugins.statusIncompatible")}
                        </span>
                      )}
                      {!crashed && !incompatible && (
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
                          {p.enabled
                            ? t("settings.plugins.statusRunning")
                            : t("settings.plugins.statusDisabled")}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {p.enabled && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        title={t("settings.plugins.reloadHint")}
                        onClick={async () => {
                          markLoading(p.id, true);
                          try {
                            await reloadMut.mutateAsync(p);
                          } catch {
                            // surfaced in onError
                          } finally {
                            markLoading(p.id, false);
                          }
                        }}
                      >
                        <RefreshCw className="size-3.5" aria-hidden="true" />
                        {t("settings.plugins.reload")}
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant={p.enabled ? "default" : "outline"}
                      disabled={busy || (incompatible && !p.enabled)}
                      onClick={async () => {
                        if (!p.enabled) {
                          setConsentPlugin(p);
                          return;
                        }
                        markLoading(p.id, true);
                        try {
                          await disableMut.mutateAsync(p);
                        } catch {
                          // surfaced in onError
                        } finally {
                          markLoading(p.id, false);
                        }
                      }}
                    >
                      {busy && <Spinner />}
                      {busy
                        ? ""
                        : p.enabled
                          ? t("settings.plugins.enabled")
                          : t("settings.plugins.enable")}
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={t("settings.plugins.remove")}
                      title={t("settings.plugins.remove")}
                      onClick={() => setRemoveTarget(p)}
                    >
                      <Trash2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      <span className="sr-only sm:not-sr-only">{t("settings.plugins.remove")}</span>
                    </Button>
                  </div>
                </div>

                {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}

                {crashed && runtime?.error && (
                  <p
                    role="alert"
                    className="rounded border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
                  >
                    {t("settings.plugins.crashDetail", { error: runtime.error })}
                  </p>
                )}

                {p.permissions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {p.permissions.map((perm) => (
                      <span
                        key={perm}
                        title={permissionLabel(perm)}
                        className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground"
                      >
                        {perm}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Plugin commands contributed by enabled plugins */}
      {commands.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("settings.plugins.commands")}
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {commands.map((cmd) => (
              <li
                key={`${cmd.pluginId}::${cmd.id}`}
                className="flex items-center justify-between gap-2 px-3 py-2"
              >
                <span>{cmd.title}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    pluginHost.invokeCommand(cmd.pluginId, cmd.id);
                    setRunResult(t("settings.plugins.invoked", { title: cmd.title }));
                    setTimeout(() => setRunResult(null), 3000);
                  }}
                >
                  {t("settings.plugins.run")}
                </Button>
              </li>
            ))}
          </ul>
          {runResult && <p className="text-xs text-muted-foreground">{runResult}</p>}
        </div>
      )}

      <PluginConsentDialog
        plugin={consentPlugin}
        isPending={enableMut.isPending}
        onCancel={() => setConsentPlugin(null)}
        onConfirm={(plugin) => {
          markLoading(plugin.id, true);
          void enableMut
            .mutateAsync(plugin)
            .catch(() => {})
            .finally(() => markLoading(plugin.id, false));
        }}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title={t("settings.plugins.removeTitle")}
        description={
          removeTarget ? t("settings.plugins.removeConfirm", { name: removeTarget.name }) : ""
        }
        confirmLabel={t("common.delete")}
        isPending={removeMut.isPending}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget) {
            removeMut.mutate(removeTarget);
          }
        }}
      />
    </section>
  );
}
