import type { GamePathId } from "@bibalak/ipc-types";
import { BookOpen, Compass, Shield, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGameState } from "@/features/game/useGameState";
import { formatNumber, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { GAME_PATHS, PATH_UNLOCK_LEVEL } from "./depthCatalog";
import { useChooseGamePathMutation, useGameDepthState } from "./useGameDepth";

const PATH_ICONS: Record<GamePathId, typeof Shield> = {
  vanguard: Shield,
  sage: BookOpen,
  scout: Compass,
  artisan: Sparkles,
};

/**
 * Paths selector on `/character` (Game style):
 * Locked below Level 10, first pick free, switching later costs 100 gold, zero abilities.
 */
export function PathSelector() {
  const depthQuery = useGameDepthState();
  const gameQuery = useGameState();
  const choosePath = useChooseGamePathMutation();

  if (depthQuery.isLoading) {
    return (
      <div aria-label={t("game.depth.loading")} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, idx) => (
          <div
            key={idx}
            className="h-36 animate-pulse rounded-xl border border-border bg-card p-4"
          />
        ))}
      </div>
    );
  }

  if (depthQuery.isError || !depthQuery.data) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <span>{t("game.depth.error.load")}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => void depthQuery.refetch()}>
          {t("game.depth.error.retry")}
        </Button>
      </div>
    );
  }

  const { level, chosen_path, path_switch_gold_cents } = depthQuery.data;
  const availableGoldCents = gameQuery.data?.available_gold_cents ?? 0;
  const unlocked = level >= PATH_UNLOCK_LEVEL;
  const isSwitch = chosen_path !== null;
  const switchGold = Math.round(path_switch_gold_cents / 100);
  const canAffordSwitch = !isSwitch || availableGoldCents >= path_switch_gold_cents;

  return (
    <section aria-label={t("game.depth.paths.title")} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <p className="text-muted-foreground">{t("game.depth.paths.cosmeticNote")}</p>
        {!unlocked && (
          <span className="tnum font-medium text-foreground">
            {t("game.depth.paths.lockedHint", { current: formatNumber(level) })}
          </span>
        )}
      </div>

      {unlocked && isSwitch && !canAffordSwitch && (
        <p className="text-sm text-muted-foreground">
          {t("game.depth.error.notEnoughGold", { gold: formatNumber(switchGold) })}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {GAME_PATHS.map((path) => {
          const Icon = PATH_ICONS[path.id];
          const isCurrent = chosen_path === path.id;
          const disabled =
            !unlocked || isCurrent || (isSwitch && !canAffordSwitch) || choosePath.isPending;

          return (
            <article
              key={path.id}
              className={cn(
                "flex flex-col justify-between gap-3 rounded-xl border bg-card p-4",
                isCurrent ? "border-primary" : "border-border",
                !unlocked && "opacity-75",
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/50"
                  style={{ color: path.accentHex }}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{t(path.nameKey)}</h3>
                    {isCurrent && (
                      <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                        {t("game.depth.paths.activeBadge")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{t(path.motifKey)}</p>
                  <p className="text-xs font-medium text-foreground">
                    {t(path.titleKey, { level: formatNumber(level) })}
                  </p>
                </div>
              </div>

              <div>
                {isCurrent ? (
                  <span className="inline-flex h-8 items-center text-xs font-medium text-primary">
                    {t(path.frameItemKey)}
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant={isSwitch ? "outline" : "default"}
                    disabled={disabled}
                    onClick={() => choosePath.mutate({ pathId: path.id, isSwitch })}
                  >
                    {isSwitch
                      ? t("game.depth.paths.switchCost", { gold: formatNumber(switchGold) })
                      : t("game.depth.paths.chooseFree")}
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
