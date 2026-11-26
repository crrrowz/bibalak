import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { formatNumber, t, tn } from "@/lib/i18n";
import { useStyle } from "@/stores/style";
import { BACKFILL_BANNER_SEEN_KEY } from "./depthCatalog";
import { useGameDepthState } from "./useGameDepth";

function readSeenFlag(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(BACKFILL_BANNER_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSeenFlag(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(BACKFILL_BANNER_SEEN_KEY, "1");
  } catch {
    // ignore storage errors
  }
}

/**
 * One-time calm summary banner for past-work unlocks.
 * Dismissing persists in `localStorage` so it never repeats.
 */
export function BackfillBanner() {
  const style = useStyle((s) => s.style);
  const active = style === "game" || style === "scholar";
  const depthQuery = useGameDepthState(active);
  const [dismissed, setDismissed] = useState<boolean>(readSeenFlag);

  if (!active || dismissed || !depthQuery.data?.backfill_applied) {
    return null;
  }

  const earnedAchievements = depthQuery.data.achievements.filter((a) => a.unlocked).length;
  const count = (style === "game" ? depthQuery.data.pets.length : 0) + earnedAchievements;
  if (count <= 0) {
    return null;
  }

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm text-foreground"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="tnum">
          {tn("game.depth.backfill.banner", count, { count: formatNumber(count) })}
        </span>
      </div>
      <button
        type="button"
        aria-label={t("game.depth.backfill.dismiss")}
        onClick={() => {
          writeSeenFlag();
          setDismissed(true);
        }}
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
