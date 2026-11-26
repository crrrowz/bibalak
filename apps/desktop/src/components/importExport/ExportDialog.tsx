import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ExportProgress, ExportScope, ExportSummary } from "@bibalak/ipc-types";
import { DialogFrame } from "@/features/browse/DialogFrame";
import { Button } from "@/components/ui/button";
import { formatNumber, t, tn } from "@/lib/i18n";
import { errorMessage, ipc, isCancelledError, pickExportDestination } from "@/lib/ipc";
import { formatBytes } from "@/lib/media";
import { platform } from "@/lib/platform";
import { queryKeys } from "@/lib/queryKeys";
import { PackageProgressBody } from "./PackageProgressBody";

type ExportDialogState =
  | { kind: "configure" }
  | { kind: "running"; exportId: string; cancelling: boolean }
  | { kind: "done"; summary: ExportSummary }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/::/g, "_")
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${cleaned || "deck"}.apkg`;
}

function makeExportId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `exp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ExportDialog({
  open,
  scope,
  deckName,
  hasChildren = false,
  onClose,
}: {
  open: boolean;
  scope: ExportScope | null;
  deckName?: string;
  hasChildren?: boolean;
  onClose: () => void;
}) {
  const scopeKind = scope?.kind ?? null;
  const isCollection = scopeKind === "collection";
  const deckId = scope?.kind === "deck" ? scope.deck_id : null;

  const [includeSubdecks, setIncludeSubdecks] = useState(true);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [includeScheduling, setIncludeScheduling] = useState(isCollection);
  const [state, setState] = useState<ExportDialogState>({ kind: "configure" });
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const activeExportIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !scopeKind) return;
    setIncludeSubdecks(true);
    setIncludeMedia(true);
    setIncludeScheduling(isCollection);
    setState({ kind: "configure" });
    setProgress(null);
    activeExportIdRef.current = null;
  }, [open, scopeKind, isCollection, deckId]);

  const effectiveScope: ExportScope | null = useMemo(() => {
    if (!scope) return null;
    if (scope.kind === "collection") return scope;
    return {
      kind: "deck",
      deck_id: scope.deck_id,
      include_subdecks: hasChildren ? includeSubdecks : false,
    };
  }, [scope, hasChildren, includeSubdecks]);

  const estimateQuery = useQuery({
    queryKey: queryKeys.exportEstimate(effectiveScope, includeMedia),
    queryFn: () => ipc.getExportEstimate(effectiveScope!, includeMedia),
    enabled: Boolean(open && effectiveScope && state.kind === "configure"),
  });

  useEffect(() => {
    if (!open) return;
    return platform.listen<ExportProgress>("bibalak://export-progress", (payload) => {
      if (payload.export_id === activeExportIdRef.current) {
        setProgress(payload);
      }
    });
  }, [open]);

  if (!open || !effectiveScope) return null;

  const title = isCollection
    ? t("export.titleCollection")
    : t("export.titleDeck", { name: deckName ?? "" });

  async function startExport() {
    if (!effectiveScope) return;
    const defaultName =
      effectiveScope.kind === "collection"
        ? "collection.apkg"
        : sanitizeFileName(deckName ?? "deck");
    const dest = await pickExportDestination(defaultName);
    if (dest === null) return;

    const exportId = makeExportId();
    activeExportIdRef.current = exportId;
    setProgress(null);
    setState({ kind: "running", exportId, cancelling: false });

    try {
      const summary = await ipc.exportPackage({
        export_id: exportId,
        path: dest,
        scope: effectiveScope,
        include_media: includeMedia,
        include_scheduling: includeScheduling,
      });
      if (activeExportIdRef.current === exportId) {
        setState({ kind: "done", summary });
      }
    } catch (err) {
      if (activeExportIdRef.current !== exportId) return;
      if (isCancelledError(err)) {
        setState({ kind: "cancelled" });
      } else {
        setState({ kind: "error", message: errorMessage(err) });
      }
    } finally {
      if (activeExportIdRef.current === exportId) {
        activeExportIdRef.current = null;
      }
    }
  }

  function requestCancel() {
    if (state.kind !== "running" || state.cancelling) return;
    setState({ kind: "running", exportId: state.exportId, cancelling: true });
    void ipc.cancelExport(state.exportId);
  }

  function handleDialogClose() {
    if (state.kind === "running") {
      requestCancel();
      return;
    }
    onClose();
  }

  const stageKey = progress
    ? (`export.stage.${progress.stage}` as const)
    : ("export.stage.preparing" as const);

  let percent: number | null = null;
  let detailText: string | null = null;
  if (progress) {
    if (progress.stage === "packing-media" && progress.bytes_total > 0) {
      percent = (progress.bytes_done / progress.bytes_total) * 100;
      detailText = t("export.mediaProgress", {
        done: formatNumber(progress.media_done),
        total: formatNumber(progress.media_total),
        bytesDone: formatBytes(progress.bytes_done),
        bytesTotal: formatBytes(progress.bytes_total),
      });
    } else if (progress.notes_total > 0 && progress.stage === "writing-db") {
      percent = (progress.notes_done / progress.notes_total) * 100;
      detailText = t("export.notesProgress", {
        done: formatNumber(progress.notes_done),
        total: formatNumber(progress.notes_total),
      });
    } else if (progress.stage === "finalizing") {
      percent = 100;
    }
  }

  return (
    <DialogFrame open={open} title={title} onClose={handleDialogClose}>
      <h2 className="mb-1 text-base font-semibold text-foreground">{title}</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        {isCollection ? t("export.subtitleCollection") : t("export.subtitleDeck")}
      </p>

      {state.kind === "configure" && (
        <>
          <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            {estimateQuery.isLoading ? (
              <span>{t("export.estimateLoading")}</span>
            ) : estimateQuery.data ? (
              <span>
                {t("export.estimateSummary", {
                  cards: tn("export.cardsCount", estimateQuery.data.cards, {
                    count: formatNumber(estimateQuery.data.cards),
                  }),
                  media: tn("export.mediaCount", estimateQuery.data.media_files, {
                    count: formatNumber(estimateQuery.data.media_files),
                    size: formatBytes(estimateQuery.data.media_bytes),
                  }),
                })}
              </span>
            ) : estimateQuery.isError ? (
              <span className="text-destructive">{errorMessage(estimateQuery.error)}</span>
            ) : null}
          </div>

          <div className="mb-5 space-y-3">
            {!isCollection && hasChildren && (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={includeSubdecks}
                  onChange={(e) => setIncludeSubdecks(e.target.checked)}
                />
                <span>{t("export.includeSubdecks")}</span>
              </label>
            )}

            <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="mt-1"
                checked={includeMedia}
                onChange={(e) => setIncludeMedia(e.target.checked)}
              />
              <span>
                <span className="block">{t("export.includeMedia")}</span>
                <span className="block text-xs text-muted-foreground">
                  {isCollection
                    ? t("export.includeMediaAllHint")
                    : t("export.includeMediaDeckHint")}
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="mt-1"
                checked={includeScheduling}
                onChange={(e) => setIncludeScheduling(e.target.checked)}
              />
              <span>
                <span className="block">{t("export.includeScheduling")}</span>
                {!includeScheduling && (
                  <span className="block text-xs text-muted-foreground">
                    {t("export.asNewNote")}
                  </span>
                )}
              </span>
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void startExport()}>{t("export.startButton")}</Button>
          </div>
        </>
      )}

      {state.kind === "running" && (
        <PackageProgressBody
          stageLabel={t(stageKey)}
          detailText={detailText}
          percent={percent}
          cancelling={state.cancelling}
          cancellingLabel={t("export.cancelling")}
          onCancel={requestCancel}
        />
      )}

      {state.kind === "done" && (
        <div className="space-y-4">
          <div className="space-y-1.5 text-sm">
            <p className="font-medium text-foreground">{t("export.done")}</p>
            <p className="text-muted-foreground">
              {t("export.doneSummary", {
                cards: tn("export.cardsCount", state.summary.cards_exported, {
                  count: formatNumber(state.summary.cards_exported),
                }),
                media: tn("export.mediaExported", state.summary.media_exported, {
                  count: formatNumber(state.summary.media_exported),
                }),
              })}
            </p>
            {state.summary.media_skipped_missing > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {tn("export.skippedMissing", state.summary.media_skipped_missing, {
                  count: formatNumber(state.summary.media_skipped_missing),
                })}
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>{t("export.doneButton")}</Button>
          </div>
        </div>
      )}

      {state.kind === "cancelled" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("export.cancelled")}</p>
          <div className="flex justify-end">
            <Button onClick={onClose}>{t("common.close")}</Button>
          </div>
        </div>
      )}

      {state.kind === "error" && (
        <div className="space-y-4">
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("common.close")}
            </Button>
            <Button onClick={() => setState({ kind: "configure" })}>{t("export.tryAgain")}</Button>
          </div>
        </div>
      )}
    </DialogFrame>
  );
}
