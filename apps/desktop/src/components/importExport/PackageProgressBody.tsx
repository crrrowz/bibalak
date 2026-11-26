import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

/**
 * Shared determinate/indeterminate progress body reused by ExportDialog and
 * ImportProgressDialog (EXP1 + BW2-25).
 */
export function PackageProgressBody({
  stageLabel,
  detailText,
  percent,
  cancelling,
  canCancel = true,
  cancelLabel,
  cancellingLabel,
  onCancel,
}: {
  stageLabel: string;
  detailText?: string | null;
  /** 0–100 when determinate, `null` when indeterminate. */
  percent: number | null;
  cancelling: boolean;
  canCancel?: boolean;
  cancelLabel?: string;
  cancellingLabel: string;
  onCancel?: () => void;
}) {
  const clamped = percent === null ? null : Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium text-foreground" aria-live="polite">
            {stageLabel}
          </span>
          {clamped !== null && (
            <span className="tabular-nums text-xs text-muted-foreground" dir="ltr">
              {clamped}%
            </span>
          )}
        </div>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clamped ?? undefined}
          className="h-2 w-full overflow-hidden rounded-full bg-secondary"
        >
          {clamped !== null ? (
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-150"
              style={{ width: `${clamped}%` }}
            />
          ) : (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          )}
        </div>

        {detailText ? (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {detailText}
          </p>
        ) : null}
      </div>

      {canCancel && onCancel ? (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={cancelling}>
            {cancelling ? cancellingLabel : (cancelLabel ?? t("common.cancel"))}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
