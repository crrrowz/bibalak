import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { IntegrityReport } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { SettingsCard, SettingsSectionHeader } from "@/components/ui/settings-kit";
import { t, tn } from "@/lib/i18n";
import { errorMessage, ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { Spinner } from "./SettingsSpinner";

export function MaintenanceSection() {
  const [integrityReport, setIntegrityReport] = useState<IntegrityReport | null>(null);
  const [integrityError, setIntegrityError] = useState<string | null>(null);
  const [optimizeMsg, setOptimizeMsg] = useState<string>("");
  const [mediaResult, setMediaResult] = useState<{
    orphan_files: string[];
    missing_files: string[];
  } | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [deleteOrphanConfirm, setDeleteOrphanConfirm] = useState(false);

  const integrityMut = useMutation({
    mutationFn: ipc.checkIntegrity,
    onMutate: () => setIntegrityError(null),
    onSuccess: (report) => {
      setIntegrityError(null);
      setIntegrityReport(report);
    },
    onError: (e) => {
      setIntegrityReport(null);
      setIntegrityError(errorMessage(e));
    },
  });

  const optimizeMut = useMutation({
    mutationFn: ipc.optimizeDb,
    onSuccess: () => setOptimizeMsg(t("settings.optimize.done")),
    onError: (e) => setOptimizeMsg(errorMessage(e)),
  });

  const mediaMut = useMutation({
    mutationFn: ipc.checkMedia,
    onMutate: () => {
      setMediaError(null);
      setDeleteOrphanConfirm(false);
    },
    onSuccess: (r) => {
      setMediaError(null);
      setMediaResult(r);
    },
    onError: (e) => {
      setMediaResult(null);
      setDeleteOrphanConfirm(false);
      setMediaError(errorMessage(e));
    },
  });

  const deleteOrphanMut = useMutation({
    mutationFn: (files: string[]) => ipc.deleteOrphanMedia(files),
    onSuccess: (count) => {
      setDeleteOrphanConfirm(false);
      setMediaResult((prev) => (prev ? { ...prev, orphan_files: [] } : prev));
      setOptimizeMsg(tn("settings.media.deleted", count));
    },
    onError: (e) => {
      setDeleteOrphanConfirm(false);
      setOptimizeMsg(errorMessage(e));
    },
  });

  const legacyPendingQuery = useQuery({
    queryKey: queryKeys.legacyMediaPending,
    queryFn: ipc.legacyMediaPending,
  });
  const legacyMediaPending = legacyPendingQuery.data ?? false;

  const busy =
    integrityMut.isPending ||
    optimizeMut.isPending ||
    mediaMut.isPending ||
    deleteOrphanMut.isPending;

  return (
    <SettingsCard id="maintenance" className="space-y-6">
      <SettingsSectionHeader title={t("settings.maintenance.cardTitle")} />

      {/* Database Integrity */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => integrityMut.mutate()}>
            {integrityMut.isPending && <Spinner />}
            {integrityMut.isPending ? t("settings.integrity.busy") : t("settings.integrity.check")}
          </Button>
          {integrityError === null &&
            integrityReport !== null &&
            integrityReport.errors.length === 0 &&
            integrityReport.repaired_orphan_subdecks === 0 && (
              <span className="text-sm text-green-600 dark:text-green-400" aria-live="polite">
                {t("settings.integrity.healthy")}
              </span>
            )}
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.integrity.hint")}</p>
        {integrityError && (
          <p role="alert" className="text-sm text-destructive">
            {integrityError}
          </p>
        )}
        {integrityReport && integrityReport.repaired_orphan_subdecks > 0 && (
          <p className="text-sm text-amber-600 dark:text-amber-400" aria-live="polite">
            {tn("settings.integrity.repairedOrphans", integrityReport.repaired_orphan_subdecks)}
          </p>
        )}
        {integrityReport && integrityReport.errors.length > 0 && (
          <ul className="text-sm text-destructive space-y-0.5" aria-live="polite">
            {integrityReport.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Database Optimize */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => optimizeMut.mutate()}>
            {optimizeMut.isPending && <Spinner />}
            {optimizeMut.isPending ? t("settings.optimize.busy") : t("settings.optimize.button")}
          </Button>
          {optimizeMsg && (
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {optimizeMsg}
              {optimizeMut.isError && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ms-2 h-6 px-2 text-xs"
                  onClick={() => optimizeMut.mutate()}
                >
                  {t("common.retry")}
                </Button>
              )}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.optimize.hint")}</p>
      </div>

      {/* Media Check */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || legacyMediaPending}
            onClick={() => mediaMut.mutate()}
          >
            {mediaMut.isPending && <Spinner />}
            {mediaMut.isPending ? t("settings.media.busy") : t("settings.media.check")}
          </Button>
          {mediaError === null &&
            mediaResult &&
            mediaResult.orphan_files.length === 0 &&
            mediaResult.missing_files.length === 0 && (
              <span className="text-sm text-green-600 dark:text-green-400" aria-live="polite">
                {t("settings.media.consistent")}
              </span>
            )}
        </div>
        {legacyMediaPending && (
          <p className="text-xs text-muted-foreground">{t("media.legacyCopyPending")}</p>
        )}
        {mediaError && (
          <p role="alert" className="text-sm text-destructive">
            {mediaError}
          </p>
        )}
        {mediaResult &&
          (mediaResult.orphan_files.length > 0 || mediaResult.missing_files.length > 0) && (
            <div className="space-y-2 text-sm">
              {mediaResult.orphan_files.length > 0 && (
                <div className="space-y-2">
                  <p className="font-medium text-amber-600 dark:text-amber-400">
                    {tn("settings.media.orphansTitle", mediaResult.orphan_files.length)}
                  </p>
                  <ul className="max-h-48 overflow-auto text-xs text-muted-foreground ps-3 space-y-0.5">
                    {mediaResult.orphan_files.map((f) => (
                      <li key={f}>
                        <bdi dir="ltr">{f}</bdi>
                      </li>
                    ))}
                  </ul>
                  {!deleteOrphanConfirm ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive/40 hover:bg-destructive/10"
                      disabled={busy || legacyMediaPending}
                      onClick={() => setDeleteOrphanConfirm(true)}
                    >
                      {t("settings.media.deleteOrphans")}
                    </Button>
                  ) : (
                    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 space-y-2 text-sm">
                      <p className="font-medium text-destructive">
                        {tn("settings.media.deleteConfirm", mediaResult.orphan_files.length)}
                      </p>
                      <ul className="max-h-32 overflow-auto text-xs text-muted-foreground ps-3 space-y-0.5">
                        {mediaResult.orphan_files.map((f) => (
                          <li key={f}>
                            <bdi dir="ltr">{f}</bdi>
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-muted-foreground">
                        {t("settings.media.movedToTrash")}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={deleteOrphanMut.isPending}
                          onClick={() => deleteOrphanMut.mutate(mediaResult.orphan_files)}
                        >
                          {deleteOrphanMut.isPending && <Spinner />}
                          {deleteOrphanMut.isPending
                            ? t("settings.media.deleting")
                            : t("settings.media.yesDelete")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDeleteOrphanConfirm(false)}
                        >
                          {t("common.cancel")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {mediaResult.missing_files.length > 0 && (
                <div>
                  <p className="font-medium text-destructive">
                    {tn("settings.media.missingTitle", mediaResult.missing_files.length)}
                  </p>
                  <ul className="max-h-48 overflow-auto text-xs text-muted-foreground ps-3 space-y-0.5">
                    {mediaResult.missing_files.map((f) => (
                      <li key={f}>
                        <bdi dir="ltr">{f}</bdi>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
      </div>
    </SettingsCard>
  );
}
