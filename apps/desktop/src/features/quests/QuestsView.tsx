import type { MotivationStateDto } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { useReducedMotion } from "@/lib/motion";
import { styleKey } from "@/lib/styles/styleKey";
import { cn } from "@/lib/utils";
import type { Style } from "@/stores/style";
import { MonthlyBadgeCard } from "./MonthlyBadgeCard";
import { QuestCard } from "./QuestCard";

export interface QuestsViewProps {
  state: MotivationStateDto | undefined;
  style: Style;
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
}

/**
 * Presentational quests view (3 daily quests, weekly quest, and monthly badge
 * gallery). Separated from the route/query shell for desktop + mobile reuse.
 */
export function QuestsView({ state, style, isLoading, isError, onRetry }: QuestsViewProps) {
  const reducedMotion = Boolean(useReducedMotion());

  if (isLoading) {
    return (
      <div
        data-testid="quests-loading"
        aria-label={t("motivation.quests.loading")}
        className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={cn(
                "h-28 rounded-xl border border-border bg-card p-4",
                !reducedMotion && "animate-pulse",
              )}
            />
          ))}
        </div>
        <div
          className={cn(
            "h-28 rounded-xl border border-border bg-card p-4",
            !reducedMotion && "animate-pulse",
          )}
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div data-testid="quests-error" className="mx-auto max-w-4xl p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">{t("motivation.quests.error")}</p>
          {onRetry && (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              {t("motivation.quests.retry")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-base font-semibold text-foreground">
            {t(styleKey("motivation.quests.title", style))}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("motivation.quests.empty")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <section aria-labelledby="quests-daily-heading" className="space-y-3">
        <h2
          id="quests-daily-heading"
          className="scholar-heading-rule pb-1.5 text-base font-semibold tracking-tight text-foreground"
        >
          {t(styleKey("motivation.quests.dailyHeading", style))}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {state.daily_quests.map((quest) => (
            <QuestCard key={quest.id} quest={quest} style={style} reducedMotion={reducedMotion} />
          ))}
        </div>
      </section>

      <section aria-labelledby="quests-weekly-heading" className="space-y-3">
        <h2
          id="quests-weekly-heading"
          className="scholar-heading-rule pb-1.5 text-base font-semibold tracking-tight text-foreground"
        >
          {t(styleKey("motivation.quests.weeklyHeading", style))}
        </h2>
        <QuestCard
          quest={state.weekly_quest}
          style={style}
          daysRemaining={state.days_remaining_in_week}
          reducedMotion={reducedMotion}
        />
      </section>

      <section aria-labelledby="quests-monthly-heading" className="space-y-3">
        <h2
          id="quests-monthly-heading"
          className="scholar-heading-rule pb-1.5 text-base font-semibold tracking-tight text-foreground"
        >
          {t(styleKey("motivation.quests.monthlyHeading", style))}
        </h2>
        <MonthlyBadgeCard
          badge={state.monthly_badge}
          earnedBadges={state.earned_monthly_badges}
          style={style}
          reducedMotion={reducedMotion}
        />
      </section>
    </div>
  );
}
