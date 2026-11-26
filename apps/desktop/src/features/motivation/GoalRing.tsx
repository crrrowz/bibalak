import { Check } from "lucide-react";
import { formatNumber, t } from "@/lib/i18n";
import { useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useStyle, type Style } from "@/stores/style";

export interface GoalRingProps {
  earned: number;
  goal: number;
  size?: number;
  strokeWidth?: number;
  styleVariant?: Style;
  showCheckWhenMet?: boolean;
  className?: string;
}

/**
 * Circular SVG progress ring for the daily XP goal. Rotated `-90deg` so the
 * fill always starts at 12 o'clock in both LTR and RTL layouts.
 */
export function GoalRing({
  earned,
  goal,
  size = 56,
  strokeWidth,
  styleVariant,
  showCheckWhenMet = true,
  className,
}: GoalRingProps) {
  const storeStyle = useStyle((s) => s.style);
  const style = styleVariant ?? storeStyle;
  const reducedMotion = Boolean(useReducedMotion());

  const safeGoal = Math.max(1, goal);
  const safeEarned = Math.max(0, earned);
  const ratio = Math.min(1, safeEarned / safeGoal);
  const met = safeEarned >= safeGoal;

  const stroke = strokeWidth ?? (size <= 28 ? 3 : 5);
  const radius = Math.max(1, (size - stroke) / 2);
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - ratio);

  const label = t("motivation.goal.progress", {
    earned: formatNumber(safeEarned),
    goal: formatNumber(safeGoal),
  });

  const arcColorClass = style === "game" ? "stroke-[hsl(var(--game-xp))]" : "stroke-primary";
  const metTextClass = style === "game" ? "text-[hsl(var(--game-xp))]" : "text-primary";

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeGoal}
      aria-valuenow={safeEarned}
      data-testid="goal-ring"
      data-met={met ? "true" : "false"}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-secondary"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn(
            arcColorClass,
            reducedMotion
              ? "transition-none"
              : "transition-[stroke-dashoffset] duration-300 ease-out",
          )}
        />
      </svg>

      {size >= 40 && (
        <span
          className={cn(
            "tnum pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-semibold",
            met ? metTextClass : "text-foreground",
          )}
          aria-hidden="true"
        >
          {met && showCheckWhenMet ? (
            <Check className="size-5" strokeWidth={2.5} />
          ) : (
            formatNumber(ratio, { style: "percent", maximumFractionDigits: 0 })
          )}
        </span>
      )}
    </div>
  );
}
