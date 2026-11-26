import type { ImportProgress } from "@bibalak/ipc-types";
import { DialogFrame } from "@/features/browse/DialogFrame";
import { formatNumber, t } from "@/lib/i18n";
import { PackageProgressBody } from "./PackageProgressBody";

/**
 * Staged import progress modal (BW2-25) reusing [`PackageProgressBody`]:
 * Reading package -> Copying media n/m -> Merging notes and cards.
 */
export function ImportProgressDialog({
  open,
  progress,
  cancelling,
  onCancel,
}: {
  open: boolean;
  progress: ImportProgress | null;
  cancelling: boolean;
  onCancel: () => void;
}) {
  if (!open) return null;

  const stage = progress?.stage ?? "reading-package";
  const stageLabel = t(`import.stage.${stage}`);
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;

  let percent: number | null = null;
  let detailText: string | null = null;
  if (stage === "copying-media" && total > 0) {
    percent = (done / total) * 100;
    detailText = t("import.mediaProgress", {
      done: formatNumber(done),
      total: formatNumber(total),
    });
  } else if (stage === "merging" && total > 0) {
    percent = (done / total) * 100;
    detailText = t("export.notesProgress", {
      done: formatNumber(done),
      total: formatNumber(total),
    });
  }

  // Merge runs in one atomic SQLite transaction; cancel is offered before merge starts.
  const canCancel = stage !== "merging";

  return (
    <DialogFrame
      open={open}
      title={t("import.title")}
      onClose={() => {
        if (canCancel && !cancelling) onCancel();
      }}
    >
      <h2 className="mb-3 text-base font-semibold text-foreground">{t("import.title")}</h2>
      <PackageProgressBody
        stageLabel={stageLabel}
        detailText={detailText}
        percent={percent}
        cancelling={cancelling}
        canCancel={canCancel}
        cancellingLabel={t("import.cancelling")}
        onCancel={onCancel}
      />
    </DialogFrame>
  );
}
