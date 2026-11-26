import { useState } from "react";
import { Award, CheckCircle2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber, t } from "@/lib/i18n";
import type { ActiveSkinId } from "@/lib/styles/skins";
import { cn } from "@/lib/utils";
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_LOCALE_MAP } from "./depthCatalog";
import { useGameDepthState } from "./useGameDepth";

export interface AchievementsPanelProps {
  skinId?: ActiveSkinId;
}

/**
 * Achievements panel shared by Game ("Achievements") and Scholar ("Academic Milestones").
 * Shows all 25 milestones with earned dates and inline progress bars for locked items.
 */
export function AchievementsPanel({ skinId = "game" }: AchievementsPanelProps) {
  const depthQuery = useGameDepthState();
  const [category, setCategory] = useState<string>("all");
  const isScholar = skinId === "scholar";

  if (depthQuery.isLoading) {
    return (
      <div aria-label={t("game.depth.loading")} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, idx) => (
          <div
            key={idx}
            className="h-28 animate-pulse rounded-xl border border-border bg-card p-4"
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

  const allAchievements = depthQuery.data.achievements;

  if (allAchievements.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        {isScholar ? t("scholar.achievements.empty") : t("game.depth.ach.empty")}
      </div>
    );
  }

  const earnedCount = allAchievements.filter((a) => a.unlocked).length;
  const filtered =
    category === "all" ? allAchievements : allAchievements.filter((a) => a.category === category);
  const sorted = [...filtered].sort((a, b) => Number(b.unlocked) - Number(a.unlocked));

  return (
    <section
      aria-label={isScholar ? t("scholar.achievements.title") : t("game.depth.achievements.title")}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {isScholar ? t("scholar.achievements.title") : t("game.depth.achievements.title")}
          </h3>
          <p className="tnum text-xs text-muted-foreground">
            {t(isScholar ? "scholar.achievements.summary" : "game.depth.achievements.summary", {
              earned: formatNumber(earnedCount),
              total: formatNumber(allAchievements.length),
            })}
          </p>
        </div>

        <div
          role="group"
          aria-label={t("game.depth.ach.filterAll")}
          className="flex flex-wrap gap-1.5"
        >
          <Button
            type="button"
            size="sm"
            variant={category === "all" ? "default" : "outline"}
            onClick={() => setCategory("all")}
          >
            {t("game.depth.ach.filterAll")}
          </Button>
          {ACHIEVEMENT_CATEGORIES.map((cat) => (
            <Button
              key={cat.id}
              type="button"
              size="sm"
              variant={category === cat.id ? "default" : "outline"}
              onClick={() => setCategory(cat.id)}
            >
              {t(cat.labelKey)}
            </Button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {t("game.depth.ach.empty")}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sorted.map((ach) => {
            const loc = ACHIEVEMENT_LOCALE_MAP[ach.achievement_key];
            const titleText = loc
              ? t(isScholar && loc.scholarTitleKey ? loc.scholarTitleKey : loc.titleKey)
              : ach.achievement_key;
            const descText = loc
              ? t(isScholar && loc.scholarDescKey ? loc.scholarDescKey : loc.descKey)
              : "";
            const pct =
              ach.target_value > 0
                ? Math.min(100, Math.max(0, (ach.current_value / ach.target_value) * 100))
                : 0;

            return (
              <article
                key={ach.achievement_key}
                className={cn(
                  "flex flex-col justify-between gap-2.5 rounded-xl border bg-card p-4",
                  ach.unlocked ? "border-primary/50" : "border-border opacity-90",
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                      ach.unlocked
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-secondary/50 text-muted-foreground",
                    )}
                  >
                    {ach.unlocked ? (
                      <Award className="size-4" aria-hidden="true" />
                    ) : (
                      <Lock className="size-4" aria-hidden="true" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-semibold leading-snug text-foreground">
                        {titleText}
                      </h4>
                      {ach.unlocked && (
                        <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
                      )}
                    </div>
                    {descText && <p className="text-xs text-muted-foreground">{descText}</p>}
                  </div>
                </div>

                {ach.unlocked ? (
                  ach.earned_at !== null && (
                    <p className="text-xs text-muted-foreground">
                      {t("game.depth.achievements.earnedOn", {
                        date: formatDate(new Date(ach.earned_at), { dateStyle: "medium" }),
                      })}
                    </p>
                  )
                ) : (
                  <div className="space-y-1">
                    <div className="flex justify-end text-xs text-muted-foreground">
                      <span className="tnum">
                        {t("game.depth.achievements.progress", {
                          current: formatNumber(ach.current_value),
                          target: formatNumber(ach.target_value),
                        })}
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={titleText}
                      aria-valuemin={0}
                      aria-valuemax={ach.target_value}
                      aria-valuenow={ach.current_value}
                      className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
                    >
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
