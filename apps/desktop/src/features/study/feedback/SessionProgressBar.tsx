import { formatNumber, t } from "@/lib/i18n";
import { useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useStyle } from "@/stores/style";

export interface SessionProgressBarProps {
  done: number;
  total: number;
  className?: string;
}

/**
 * Slim session progress bar mounted at the top of the study screen.
 * Uses the active presentation style's progress colour and logical RTL flow.
 */
export function SessionProgressBar({ done, total, className }: SessionProgressBarProps) {
  const style = useStyle((s) => s.style);
  const reducedMotion = useReducedMotion();

  const safeTotal = Math.max(0, total);
  const safeDone = Math.max(0, Math.min(done, safeTotal));
  const pct = safeTotal > 0 ? Math.min(100, Math.max(0, (safeDone / safeTotal) * 100)) : 0;

  const fillClass = style === "game" ? "bg-[hsl(var(--game-xp))]" : "bg-primary";
  const countText = t("study.feedback.progressCount", {
    done: formatNumber(safeDone),
    total: formatNumber(safeTotal),
  });

  return (
    <div
      data-testid="session-progress-bar"
      data-feedback-style={style}
      className={cn(
        "relative z-10 flex shrink-0 items-center gap-3 border-b border-border/60 bg-background/80 px-4 py-1.5 sm:px-6",
        className,
      )}
    >
      <div
        role="progressbar"
        aria-label={t("study.feedback.progressAria")}
        aria-valuemin={0}
        aria-valuemax={safeTotal}
        aria-valuenow={safeDone}
        aria-valuetext={countText}
        className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary"
      >
        <div
          data-testid="session-progress-fill"
          className={cn(
            "h-full rounded-full",
            fillClass,
            reducedMotion ? "transition-none" : "transition-[width] duration-200 ease-out",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="tnum shrink-0 text-xs font-medium text-muted-foreground">{countText}</span>
    </div>
  );
}
