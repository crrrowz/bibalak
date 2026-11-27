import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatDate, t } from "@/lib/i18n";
import { errorMessage, ipc } from "@/lib/ipc";
import { platform } from "@/lib/platform";
import { queryKeys } from "@/lib/queryKeys";
import { releasePageUrl, updateManifestUrl } from "@/lib/releases";
import { Spinner } from "./SettingsSpinner";
import { useUpdateCheck } from "./updateCheck";

export function UpdateSection() {
  const [installing, setInstalling] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const checking = useUpdateCheck((s) => s.checking);
  const result = useUpdateCheck((s) => s.result);
  const autoCheck = useUpdateCheck((s) => s.autoCheck);
  const setAutoCheck = useUpdateCheck((s) => s.setAutoCheck);
  const checkForUpdate = useUpdateCheck((s) => s.check);
  const setResult = useUpdateCheck((s) => s.setResult);

  const appInfoQuery = useQuery({ queryKey: queryKeys.appInfo, queryFn: ipc.appInfo });
  // A portable copy never installs updates itself (ADR-006): it links to the release page.
  const portableQuery = useQuery({
    queryKey: queryKeys.isPortable,
    queryFn: () => platform.updater.isPortable(),
    staleTime: Infinity,
  });
  const portable = portableQuery.data === true;

  const manifestUrl = updateManifestUrl();

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

  async function openReleasePage(version: string) {
    try {
      await platform.updater.openReleasePage(releasePageUrl(version));
    } catch (e) {
      setResult({ kind: "error", message: errorMessage(e) });
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
        <>
          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={autoCheck}
              onChange={(e) => setAutoCheck(e.target.checked)}
              className="size-4 rounded border border-input accent-primary"
            />
            <span>{t("settings.updates.autoCheck")}</span>
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={checking || installing}
            onClick={() => void checkForUpdate()}
          >
            {checking && <Spinner />}
            {checking ? t("settings.updates.checking") : t("settings.updates.check")}
          </Button>
        </>
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
            {portable
              ? t("settings.updates.portableAvailableBefore")
              : t("settings.updates.availableBefore")}{" "}
            <span className="font-mono">{result.version}</span>{" "}
            {portable
              ? t("settings.updates.portableAvailableAfter")
              : t("settings.updates.availableAfter")}
          </p>
          {result.notes && (
            <p className="text-xs text-muted-foreground whitespace-pre-line">{result.notes}</p>
          )}
          <div className="flex items-center gap-3">
            {portable ? (
              <Button size="sm" onClick={() => void openReleasePage(result.version)}>
                {t("settings.updates.openReleasePage")}
              </Button>
            ) : (
              <Button size="sm" disabled={installing} onClick={installAndRestart}>
                {installing && <Spinner />}
                {installing
                  ? downloadPercent !== null
                    ? t("settings.updates.downloading", { percent: downloadPercent })
                    : t("settings.updates.installing")
                  : t("settings.updates.install")}
              </Button>
            )}
          </div>
          {portable && (
            <p className="text-xs text-muted-foreground">{t("settings.updates.portableHint")}</p>
          )}
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
