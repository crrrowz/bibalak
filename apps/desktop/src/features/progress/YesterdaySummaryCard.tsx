import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, X } from "lucide-react";
import { GoldIcon, KnowledgePointsIcon, XpIcon } from "@/components/icons/progress";
import { Button } from "@/components/ui/button";
import { ipc, isTauri } from "@/lib/ipc";
import { formatNumber, t, tn } from "@/lib/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { formatCurrency } from "@/lib/styles/scholar";
import { cn } from "@/lib/utils";
import { useStyle } from "@/stores/style";
import { formatBackendDate, useYesterdaySummary } from "./useProgressSummary";

/**
 * Dismissible, non-blocking "Yesterday" summary card displayed at most once per new day
 * when yesterday (`today - 1`) had at least one completed review, task, or habit.
 */
export function YesterdaySummaryCard() {
  const tauri = isTauri();
  const style = useStyle((s) => s.style);
  const queryClient = useQueryClient();
  const { data } = useYesterdaySummary();

  const dismissMut = useMutation({
    mutationFn: (day: number) => ipc.dismissYesterdaySummary(day),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.yesterdaySummary, null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.yesterdaySummary });
    },
  });

  if (!tauri || !data) return null;

  const formattedDate = formatBackendDate(data.date);
  const headingText = t(
    style === "game" ? "progress.yesterday.heading.game" : "progress.yesterday.heading",
    { date: formattedDate },
  );
  const reviewsText = tn("progress.yesterday.reviews", data.reviews, {
    count: formatNumber(data.reviews),
  });
  const tasksText = tn("progress.yesterday.tasks", data.tasks_completed, {
    count: formatNumber(data.tasks_completed),
  });
  const habitsText = tn("progress.yesterday.habits", data.habits_completed, {
    count: formatNumber(data.habits_completed),
  });
  const xpText = t("progress.yesterday.xp", { xp: formatNumber(data.xp) });
  const currencyText = formatCurrency(data.gold_cents, style);
  const CurrencyIcon = style === "scholar" ? KnowledgePointsIcon : GoldIcon;

  return (
    <section
      data-testid="yesterday-summary-card"
      aria-label={t("progress.yesterday.title")}
      className="mx-4 mt-2.5 rounded-[14px] border border-border bg-card px-4 py-3 sm:mx-6 lg:mx-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <CalendarCheck2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{headingText}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span
              data-testid="yesterday-loot-chip"
              className="tnum inline-flex items-center rounded-md border border-border/70 bg-secondary/45 px-2 py-0.5 text-muted-foreground"
            >
              {reviewsText}
            </span>
            <span
              data-testid="yesterday-loot-chip"
              className="tnum inline-flex items-center rounded-md border border-border/70 bg-secondary/45 px-2 py-0.5 text-muted-foreground"
            >
              {tasksText}
            </span>
            <span
              data-testid="yesterday-loot-chip"
              className="tnum inline-flex items-center rounded-md border border-border/70 bg-secondary/45 px-2 py-0.5 text-muted-foreground"
            >
              {habitsText}
            </span>
            <span
              data-testid="yesterday-loot-chip"
              className={cn(
                "tnum inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium",
                style === "game"
                  ? "border-[hsl(var(--game-xp)/0.35)] bg-[hsl(var(--game-xp)/0.1)] text-[hsl(var(--game-xp))]"
                  : "border-border/70 bg-secondary/55 text-foreground",
              )}
            >
              <XpIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span>{xpText}</span>
            </span>
            <span
              data-testid="yesterday-loot-chip"
              className={cn(
                "tnum inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium",
                style === "game"
                  ? "border-[hsl(var(--game-gold)/0.35)] bg-[hsl(var(--game-gold)/0.1)] text-[hsl(var(--game-gold))]"
                  : style === "scholar"
                    ? "border-[hsl(var(--scholar-accent)/0.3)] bg-[hsl(var(--scholar-accent)/0.08)] text-[hsl(var(--scholar-accent))]"
                    : "border-border/70 bg-secondary/55 text-foreground",
              )}
            >
              <CurrencyIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span>{currencyText}</span>
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={dismissMut.isPending}
          aria-label={t("progress.yesterday.dismiss")}
          onClick={() => dismissMut.mutate(data.day + 1)}
          className="h-7 shrink-0 gap-1 rounded-md border-border/80 bg-background/70 px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
          <span>{t("progress.yesterday.dismiss")}</span>
        </Button>
      </div>
    </section>
  );
}
