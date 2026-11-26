import type { EarnedMonthlyBadgeDto, MonthlyBadgeStatusDto } from "@bibalak/ipc-types";
import { Check } from "lucide-react";
import { GoldIcon, KnowledgePointsIcon } from "@/components/icons/progress";
import { formatDate, formatNumber, t, tn } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Style } from "@/stores/style";
import { formatMonthKey, formatQuestGold } from "./questFormatting";
import { MonthlyBadgeStyleIcon } from "./questIcons";

export interface MonthlyBadgeCardProps {
  badge: MonthlyBadgeStatusDto;
  earnedBadges: EarnedMonthlyBadgeDto[];
  style: Style;
  reducedMotion: boolean;
}

/**
 * Displays this month's progress toward 20 daily quests and the gallery of
 * previously earned monthly badges.
 */
export function MonthlyBadgeCard({
  badge,
  earnedBadges,
  style,
  reducedMotion,
}: MonthlyBadgeCardProps) {
  const clamped = Math.min(badge.completed_daily_quests, badge.target_daily_quests);
  const pct =
    badge.target_daily_quests > 0
      ? Math.min(100, Math.max(0, (clamped / badge.target_daily_quests) * 100))
      : 0;
  const CurrencyIcon = style === "scholar" ? KnowledgePointsIcon : GoldIcon;

  const rewardChipClass =
    style === "game"
      ? "border-[hsl(var(--game-gold)/0.35)] bg-[hsl(var(--game-gold)/0.1)] text-[hsl(var(--game-gold))]"
      : style === "scholar"
        ? "border-[hsl(var(--scholar-accent)/0.3)] bg-[hsl(var(--scholar-accent)/0.08)] text-[hsl(var(--scholar-accent))]"
        : "border-border/80 bg-secondary/60 text-foreground";

  const sortedEarned = [...earnedBadges].sort((a, b) => b.month_key.localeCompare(a.month_key));

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "rounded-[14px] border border-border bg-card p-4 sm:p-5",
          badge.earned &&
            (style === "game"
              ? "border-[hsl(var(--game-gold)/0.5)] bg-[hsl(var(--game-gold)/0.06)]"
              : "border-primary/40 bg-primary/5"),
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-lg",
                badge.earned
                  ? style === "game"
                    ? "bg-[hsl(var(--game-gold)/0.18)] text-[hsl(var(--game-gold))]"
                    : "bg-primary/15 text-primary"
                  : "bg-secondary text-muted-foreground",
              )}
            >
              <MonthlyBadgeStyleIcon
                style={style}
                className="size-5"
                testId={`monthly-badge-icon-${style}`}
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {formatMonthKey(badge.month_key)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground tnum">
                {tn("motivation.quests.monthlyCount", clamped, {
                  target: formatNumber(badge.target_daily_quests),
                })}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span
              data-testid="monthly-reward-chip"
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium tnum",
                rewardChipClass,
              )}
            >
              <CurrencyIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{formatQuestGold(badge.reward_gold_cents, style)}</span>
            </span>
            {badge.earned && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium",
                  style === "game"
                    ? "border-[hsl(var(--game-xp)/0.4)] bg-[hsl(var(--game-xp)/0.16)] text-[hsl(var(--game-xp))]"
                    : "border-primary/35 bg-primary/12 text-primary",
                )}
              >
                <Check className="size-3 shrink-0" aria-hidden="true" />
                <span>{t("motivation.quests.completed")}</span>
              </span>
            )}
          </div>
        </div>

        <div className="mt-3.5 flex items-center gap-2.5">
          <div
            role="progressbar"
            aria-label={t("motivation.quests.badgeProgressLabel")}
            aria-valuenow={clamped}
            aria-valuemin={0}
            aria-valuemax={badge.target_daily_quests}
            className="h-2.5 flex-1 overflow-hidden rounded-full bg-secondary"
          >
            <div
              className={cn(
                "h-full rounded-full",
                badge.earned && style === "game" ? "bg-[hsl(var(--game-gold))]" : "bg-primary",
                reducedMotion ? "transition-none" : "transition-[width] duration-300",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="shrink-0 text-xs font-medium text-muted-foreground tnum">
            {t("motivation.quests.progress", {
              done: formatNumber(clamped),
              target: formatNumber(badge.target_daily_quests),
            })}
          </span>
        </div>
      </div>

      <div className="space-y-2.5">
        <h3 className="text-sm font-medium text-foreground">
          {t("motivation.quests.earnedGallery")}
        </h3>
        {sortedEarned.length === 0 ? (
          <p className="rounded-[14px] border border-dashed border-border bg-card/50 p-4 text-xs text-muted-foreground">
            {t("motivation.quests.emptyGallery")}
          </p>
        ) : (
          <ul
            data-testid="monthly-badge-row"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3"
          >
            {sortedEarned.map((item) => (
              <li
                key={item.month_key}
                className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-3.5"
              >
                <div
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg",
                    style === "game"
                      ? "bg-[hsl(var(--game-gold)/0.16)] text-[hsl(var(--game-gold))]"
                      : "bg-primary/12 text-primary",
                  )}
                >
                  <MonthlyBadgeStyleIcon style={style} className="size-4.5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {formatMonthKey(item.month_key)}
                  </p>
                  <p className="text-xs text-muted-foreground tnum">
                    {t("motivation.quests.earnedOn", {
                      date: formatDate(item.earned_at, { dateStyle: "medium" }),
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
