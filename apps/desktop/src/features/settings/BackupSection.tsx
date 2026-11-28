import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { BackupInfo } from "@bibalak/ipc-types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { errorMessage, ipc } from "@/lib/ipc";
import { platform } from "@/lib/platform";
import { queryKeys } from "@/lib/queryKeys";
import { Spinner } from "./SettingsSpinner";
import { fmt_date, fmt_size } from "./settingsUtils";

export function BackupSection() {
  const [backupMsg, setBackupMsg] = useState<string>("");
  const [restoreConfirm, setRestoreConfirm] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<BackupInfo | null>(null);
  const [restorePendingRestart, setRestorePendingRestart] = useState(false);

  const backupsQuery = useQuery({ queryKey: queryKeys.backups, queryFn: ipc.listBackups });

  const backupMut = useMutation({
    mutationFn: ipc.createBackup,
    onSuccess: (info) => {
      setRestorePendingRestart(false);
      setBackupMsg(
        t("settings.backup.created", { name: info.name, size: fmt_size(info.size_bytes) }),
      );
      void backupsQuery.refetch();
    },
    onError: (e) => setBackupMsg(errorMessage(e)),
  });

  const restoreMut = useMutation({
    mutationFn: (name: string) => ipc.restoreBackup(name),
    onSuccess: () => {
      setRestoreConfirm(null);
      setRestorePendingRestart(true);
      setBackupMsg(t("settings.backup.restored"));
    },
    onError: (e) => {
      setRestoreConfirm(null);
      setRestorePendingRestart(false);
      setBackupMsg(errorMessage(e));
    },
  });

  const deleteBackupMut = useMutation({
    mutationFn: (name: string) => ipc.deleteBackup(name),
    onSuccess: () => {
      setDeleteConfirm(null);
      void backupsQuery.refetch();
    },
    onError: (e) => {
      setDeleteConfirm(null);
      setBackupMsg(errorMessage(e));
    },
  });

  const busy = backupMut.isPending || restoreMut.isPending || deleteBackupMut.isPending;

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div>
        <h2 className="text-sm font-medium text-foreground">{t("settings.backup.title")}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{t("settings.backup.description")}</p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => backupMut.mutate()}>
            {backupMut.isPending && <Spinner />}
            {backupMut.isPending ? t("settings.backup.busy") : t("settings.backup.now")}
          </Button>
          {backupMsg && (
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {backupMsg}
              {backupMut.isError && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ms-2 h-6 px-2 text-xs"
                  onClick={() => backupMut.mutate()}
                >
                  {t("common.retry")}
                </Button>
              )}
              {restorePendingRestart && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ms-2 h-6 px-2 text-xs"
                  onClick={() => {
                    void platform.updater.relaunch().catch((e) => setBackupMsg(errorMessage(e)));
                  }}
                >
                  {t("settings.backup.restartNow")}
                </Button>
              )}
            </span>
          )}
        </div>

        {(backupsQuery.data ?? []).length > 0 && (
          <ul className="rounded-lg border border-border divide-y divide-border text-sm">
            {(backupsQuery.data ?? []).map((b: BackupInfo) => (
              <li
                key={b.name}
                className="grid grid-cols-[minmax(0,1fr)_minmax(5.5rem,auto)_auto] items-center gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground" title={b.name}>
                    {b.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {fmt_date(b.created_ms)}
                  </p>
                </div>
                <span className="whitespace-nowrap text-end text-xs text-muted-foreground tabular-nums">
                  {fmt_size(b.size_bytes)}
                </span>
                <div
                  data-testid="backup-row-actions"
                  className="flex shrink-0 items-center justify-end gap-1 whitespace-nowrap"
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs text-destructive"
                    disabled={busy}
                    onClick={() => setRestoreConfirm(b.name)}
                  >
                    {t("settings.backup.restore")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    onClick={() => setDeleteConfirm(b)}
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {restoreConfirm && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 space-y-2 text-sm">
            <p className="font-medium text-destructive">
              {t("settings.backup.confirmTitle", { name: restoreConfirm })}
            </p>
            <p className="text-muted-foreground text-xs">{t("settings.backup.confirmBody")}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={restoreMut.isPending}
                onClick={() => restoreMut.mutate(restoreConfirm)}
              >
                {restoreMut.isPending && <Spinner />}
                {restoreMut.isPending
                  ? t("settings.backup.restoring")
                  : t("settings.backup.yesRestore")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRestoreConfirm(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteConfirm !== null}
        title={t("settings.backup.deleteConfirmTitle", { name: deleteConfirm?.name ?? "" })}
        description={t("settings.backup.deleteConfirmBody", {
          name: deleteConfirm?.name ?? "",
          date: deleteConfirm ? fmt_date(deleteConfirm.created_ms) : "",
        })}
        confirmLabel={t("common.delete")}
        variant="destructive"
        isPending={deleteBackupMut.isPending}
        onConfirm={() => {
          if (deleteConfirm) deleteBackupMut.mutate(deleteConfirm.name);
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </section>
  );
}
