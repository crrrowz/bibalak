import { AnimatePresence, motion } from "framer-motion";
import { streakBadge, useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useStyle } from "@/stores/style";
import { formatInARowLabel } from "./feedbackStore";

export interface StreakBadgeProps {
  count: number | null;
}

/**
 * Calm, non-blocking "N in a row" encouragement pill shown briefly at
 * milestone counts (3, 5, 10, 20) in the active presentation style's words.
 */
export function StreakBadge({ count }: StreakBadgeProps) {
  const style = useStyle((s) => s.style);
  const reducedMotion = useReducedMotion();

  const toneClass =
    style === "game"
      ? "border-[hsl(var(--game-xp)/0.4)] bg-card text-[hsl(var(--game-xp))]"
      : style === "scholar"
        ? "border-primary/35 bg-card text-primary"
        : "border-border bg-card text-foreground";

  return (
    <div aria-live="polite" className="pointer-events-none flex shrink-0 items-center justify-end">
      <AnimatePresence>
        {count !== null && (
          <motion.div
            key={count}
            data-testid="in-a-row-badge"
            data-feedback-style={style}
            data-reduced-motion={reducedMotion ? "true" : "false"}
            role="status"
            initial={reducedMotion ? { opacity: 1 } : streakBadge.hidden}
            animate={reducedMotion ? { opacity: 1 } : streakBadge.show}
            exit={reducedMotion ? { opacity: 0, transition: { duration: 0 } } : streakBadge.exit}
            className={cn(
              "whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium shadow-sm",
              toneClass,
            )}
          >
            {formatInARowLabel(count, style)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
