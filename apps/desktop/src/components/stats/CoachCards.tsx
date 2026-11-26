import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock3, PauseCircle } from "lucide-react";
import type { StatsCoachDto } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { formatNumber, t, tn } from "@/lib/i18n";
import { forecastQuery, leechQuery } from "./statQuery";

export function CoachCards({
  coach,
  today,
  deckName,
  onDrill,
}: {
  coach: StatsCoachDto;
  today: number;
  deckName: string | null;
  onDrill: (query: string) => void;
}) {
  const queryClient = useQueryClient();

  const suspendMut = useMutation({
    mutationFn: (cardIds: number[]) => ipc.suspendCards(cardIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.statsAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
    },
  });

  const showLeeches = coach.leech_count > 0 && coach.leech_card_ids.length > 0;
  const showBacklog = coach.overdue_count > 0;

  if (!showLeeches && !showBacklog) {
    return null;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {showLeeches ? (
        <div
          data-testid="coach-leech-card"
          className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-card p-4 text-start"
        >
          <div className="flex items-start gap-3">
            <PauseCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {tn("stats.coach.leechTitle", coach.leech_count, {
                  minutes: formatNumber(coach.leech_weekly_minutes),
                })}
              </p>
              <p className="text-xs text-muted-foreground">{t("stats.coach.leechBody")}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onDrill(leechQuery(deckName))}>
              {t("stats.coach.viewInBrowse")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={suspendMut.isPending}
              onClick={() => suspendMut.mutate(coach.leech_card_ids)}
            >
              {suspendMut.isPending ? t("stats.coach.suspending") : t("stats.coach.suspendLeeches")}
            </Button>
          </div>
        </div>
      ) : null}

      {showBacklog ? (
        <div
          data-testid="coach-backlog-card"
          className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-card p-4 text-start"
        >
          <div className="flex items-start gap-3">
            <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {tn("stats.coach.backlogTitle", coach.overdue_count)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("stats.coach.backlogBody", {
                  daily: formatNumber(coach.suggested_daily_reviews),
                })}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDrill(forecastQuery(null, today, deckName))}
            >
              {t("stats.coach.viewInBrowse")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
