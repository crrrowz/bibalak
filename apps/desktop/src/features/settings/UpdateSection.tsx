import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatDate, t } from "@/lib/i18n";
import { errorMessage, ipc } from "@/lib/ipc";
import { platform } from "@/lib/platform";
import { queryKeys } from "@/lib/queryKeys";
import { updateManifestUrl } from "@/lib/releases";
import { Spinner } from "./SettingsSpinner";

export function UpdateSection() {
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const [result, setResult] = useState<
    | { kind: "up-to-date" }
    | { kind: "available"; version: string; notes?: string }
    | { kind: "error"; message: string }
    | null
  >(null);

  const appInfoQuery = useQuery({ queryKey: queryKeys.appInfo, queryFn: ipc.appInfo });

  const manifestUrl = updateManifestUrl();

  async function checkForUpdate() {
    if (!manifestUrl) return;
    setChecking(true);
    setResult(null);
    try {
      const update = await platform.updater.check();
      if (update === "not-available") {
        setResult({ kind: "error", message: t("settings.updates.notAvailable") });
      } else if (update === null) {
        setResult({ kind: "up-to-date" });
      } else {
        setResult({ kind: "available", version: update.version, notes: update.notes });
      }
    } catch (e) {
      setResult({ kind: "error", message: errorMessage(e) });
    } finally {
      setChecking(false);
    }
  }

  async function installAndRestart() {
    setInstalling(true);
    setDownloadPercent(null);
    try {
      await platform.updater.downloadAndInstall((progress) => {
        if (progress.kind === "progress" && progress.contentLength && progress.contentLength > 0) {
          setDownloadPercent(
            Math.min(100, Math.round((progress.downloadedBytes / progress.contentLength) * 100)),
          );
        }
      });
      await platform.updater.relaunch();
    } catch (e) {
      setResult({ kind: "error", message: errorMessage(e) });
    } finally {
      setInstalling(false);
      setDownloadPercent(null);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div>
        <h2 className="text-sm font-medium text-foreground">{t("settings.updates.title")}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("settings.updates.current")}{" "}
          <span className="font-mono">{appInfoQuery.data?.version ?? "…"}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("settings.updates.buildStamp", {
            sha: __BUILD_SHA__,
            date: formatDate(new Date(__BUILD_DATE__), {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })}
        </p>
      </div>
      {manifestUrl ? (
        <Button
          size="sm"
          variant="outline"
          disabled={checking || installing}
          onClick={checkForUpdate}
        >
          {checking && <Spinner />}
          {checking ? t("settings.updates.checking") : t("settings.updates.check")}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">{t("settings.updates.noSite")}</p>
      )}
      {result?.kind === "up-to-date" && (
        <p className="text-sm text-green-600 dark:text-green-400" aria-live="polite">
          {t("settings.updates.upToDate")}
        </p>
      )}
      {result?.kind === "available" && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2 text-sm">
          <p className="font-medium">
            {t("settings.updates.availableBefore")}{" "}
            <span className="font-mono">{result.version}</span>{" "}
            {t("settings.updates.availableAfter")}
          </p>
          {result.notes && <p className="text-xs text-muted-foreground">{result.notes}</p>}
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={installing} onClick={installAndRestart}>
              {installing && <Spinner />}
              {installing
                ? downloadPercent !== null
                  ? t("settings.updates.downloading", { percent: downloadPercent })
                  : t("settings.updates.installing")
                : t("settings.updates.install")}
            </Button>
          </div>
        </div>
      )}
      {result?.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {result.message}
        </p>
      )}
    </section>
  );
}
