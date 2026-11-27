import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Flame, ShoppingBag, Trophy } from "lucide-react";
import type { StreakCalendarDayDto } from "@bibalak/ipc-types";
import { FrostShieldIcon } from "@/components/icons/game";
import { Button } from "@/components/ui/button";
import { isoWeekdayFromIso, localizedWeekdayOptions } from "@/features/calendar/calendarHelpers";
import { formatBackendDate } from "@/features/progress/useProgressSummary";
import { formatDate, formatNumber, t, tn } from "@/lib/i18n";
import { isTauri } from "@/lib/ipc";
import { useReducedMotion } from "@/lib/motion";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";
import { cn } from "@/lib/utils";
import { useStyle } from "@/stores/style";
import { useWeekStart } from "@/stores/weekStart";
import {
  splitIsoDate,
  useFreezeStudyDay,
  useMotivationState,
  useStreakCalendar,
} from "./useMotivation";

type DayStatus = "goal-met" | "studied" | "frozen" | "rest";

function dayStatus(day: StreakCalendarDayDto): DayStatus {
  if (day.frozen) return "frozen";
  if (day.goal_met) return "goal-met";
  if (day.studied) return "studied";
  return "rest";
}

/**
 * Full `/streak` content component (separated from route frame for mobile reuse):
 * header summary strip (current streak, best streak, next milestone + chips),
 * month-by-month calendar with RTL & week-start support, non-hover day detail
 * footer, and manual Streak Freeze button when eligible.
 */
export interface StreakViewProps {
  showTitle?: boolean;
}

export function StreakView({ showTitle = true }: StreakViewProps = {}) {
  const tauri = isTauri();
  const style = useStyle((s) => s.style);
  const weekStart = useWeekStart((s) => s.weekStart);
  const reducedMotion = Boolean(useReducedMotion());
  const navigate = useOptionalNavigate();

  const motivationQuery = useMotivationState();
  const todayYm = splitIsoDate(motivationQuery.data?.today_date);
  const [period, setPeriod] = useState<{ year: number; month: number }>(() => todayYm);
  const syncedTodayRef = useRef<string | undefined>(motivationQuery.data?.today_date);

  useEffect(() => {
    const loaded = motivationQuery.data?.today_date;
    if (!loaded || syncedTodayRef.current === loaded) return;
    syncedTodayRef.current = loaded;
    setPeriod(splitIsoDate(loaded));
  }, [motivationQuery.data?.today_date]);

  const calQuery = useStreakCalendar(period.year, period.month);
  const freezeMut = useFreezeStudyDay();

  const data = calQuery.data ?? null;
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!data?.days.length) return;
    setSelectedDayIndex((prev) => {
      if (prev !== null && data.days.some((d) => d.day_index === prev)) return prev;
      const todayCell = data.days.find((d) => d.day_index === data.today_day_index);
      return todayCell ? todayCell.day_index : data.days[data.days.length - 1].day_index;
    });
  }, [data]);

  const titleKey =
    style === "game"
      ? "motivation.streak.title.game"
      : style === "scholar"
        ? "motivation.streak.title.scholar"
        : "motivation.streak.title.default";

  const weekdayHeaders = useMemo(() => localizedWeekdayOptions(weekStart, "short"), [weekStart]);

  const leadingBlanks = useMemo(() => {
    if (!data?.days.length) return 0;
    const firstWd = isoWeekdayFromIso(data.days[0].date);
    const startWd = weekStart === "sat" ? 6 : weekStart === "sun" ? 7 : 1;
    return (firstWd - startWd + 7) % 7;
  }, [data, weekStart]);

  const selectedDay = useMemo(() => {
    if (!data?.days.length) return null;
    return data.days.find((d) => d.day_index === selectedDayIndex) ?? data.days[0];
  }, [data, selectedDayIndex]);

  const monthTitle = formatDate(new Date(period.year, period.month - 1, 1), {
    month: "long",
    year: "numeric",
  });

  const goShop = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (navigate) {
      e.preventDefault();
      navigate("/shop");
    }
  };

  return (
    <section
      data-testid="streak-view"
      aria-label={t(titleKey)}
      className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6"
    >
      {showTitle && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="screen-title text-lg font-semibold text-foreground">{t(titleKey)}</h2>
        </div>
      )}

      {!tauri ? (
        <div className="rounded-xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">{t("motivation.streak.current")}</p>
        </div>
      ) : calQuery.isLoading && !data ? (
        <div
          data-testid="streak-view-loading"
          className="space-y-4 rounded-xl border border-border bg-card p-6"
        >
          <div className="h-5 w-40 rounded bg-muted" />
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 14 }, (_, i) => (
              <div key={i} className="h-9 rounded-lg bg-muted" />
            ))}
          </div>
        </div>
      ) : !data ? (
        <div className="rounded-xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">{t("progress.error")}</p>
        </div>
      ) : (
        <>
          {/* Summary strip: Current streak, Best streak, Next milestone */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("motivation.streak.current")}
                </span>
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px] font-medium",
                    data.studied_today
                      ? "bg-primary/15 text-primary"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  {data.studied_today
                    ? t("motivation.streak.activeToday")
                    : t("motivation.streak.waitingToday")}
                </span>
              </div>
              <p className="tnum mt-2 flex items-center gap-1.5 text-2xl font-semibold text-foreground">
                <Flame className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  {tn("motivation.streak.dayCount", data.current_streak, {
                    count: formatNumber(data.current_streak),
                  })}
                </span>
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <span className="text-xs font-medium text-muted-foreground">
                {t("motivation.streak.best")}
              </span>
              <p className="tnum mt-2 flex items-center gap-1.5 text-2xl font-semibold text-foreground">
                <Trophy className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  {tn("motivation.streak.dayCount", data.best_streak, {
                    count: formatNumber(data.best_streak),
                  })}
                </span>
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <span className="text-xs font-medium text-muted-foreground">
                {data.next_milestone !== null
                  ? t("motivation.streak.nextMilestone", {
                      days: formatNumber(data.next_milestone),
                    })
                  : t("motivation.streak.milestoneAchieved")}
              </span>
              {data.next_milestone !== null && (
                <>
                  <div
                    role="progressbar"
                    aria-label={t("motivation.streak.nextMilestone", {
                      days: formatNumber(data.next_milestone),
                    })}
                    aria-valuemin={0}
                    aria-valuemax={data.next_milestone}
                    aria-valuenow={Math.min(data.current_streak, data.next_milestone)}
                    className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary"
                  >
                    <div
                      className={cn(
                        "h-full rounded-full bg-primary",
                        reducedMotion
                          ? "transition-none"
                          : "transition-[width] duration-200 ease-out",
                      )}
                      style={{
                        width: `${Math.min(100, (data.current_streak / Math.max(1, data.next_milestone)) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="tnum mt-1.5 text-xs text-muted-foreground">
                    {t("motivation.streak.milestoneProgress", {
                      current: formatNumber(data.current_streak),
                      target: formatNumber(data.next_milestone),
                    })}
                  </p>
                </>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {data.milestones.map((m) => (
                  <span
                    key={m.target}
                    className={cn(
                      "tnum inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                      m.achieved
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-border bg-secondary/40 text-muted-foreground",
                    )}
                  >
                    {m.achieved && <Check className="size-3" aria-hidden="true" />}
                    <span>{formatNumber(m.target)}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Freeze status & manual freeze yesterday button */}
          {(style === "game" || data.can_freeze_day !== null || data.freeze_tokens_held > 0) && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--game-freeze))]">
                <FrostShieldIcon className="size-4 shrink-0" aria-hidden="true" />
                <span className="tnum text-foreground">
                  {t("motivation.streak.freezeTokensHeld", {
                    held: formatNumber(data.freeze_tokens_held),
                    cap: formatNumber(data.freeze_token_cap),
                  })}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {data.can_freeze_day !== null && data.freeze_tokens_held > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={freezeMut.isPending}
                    onClick={() => freezeMut.mutate(data.can_freeze_day!)}
                    className="gap-1.5 text-xs"
                  >
                    <FrostShieldIcon className="size-3.5" aria-hidden="true" />
                    <span>{t("motivation.streak.freezeYesterday")}</span>
                  </Button>
                )}
                {style === "game" && (
                  <a
                    href="/shop"
                    onClick={goShop}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ShoppingBag className="size-3.5" aria-hidden="true" />
                    <span>{t("motivation.streak.buyFreeze")}</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Month calendar */}
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">{monthTitle}</h3>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t("calendar.miniMonth.prevMonth")}
                  onClick={() =>
                    setPeriod((p) =>
                      p.month === 1
                        ? { year: p.year - 1, month: 12 }
                        : { year: p.year, month: p.month - 1 },
                    )
                  }
                >
                  <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPeriod(splitIsoDate(data.today_date))}
                >
                  {t("calendar.today")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t("calendar.miniMonth.nextMonth")}
                  onClick={() =>
                    setPeriod((p) =>
                      p.month === 12
                        ? { year: p.year + 1, month: 1 }
                        : { year: p.year, month: p.month + 1 },
                    )
                  }
                >
                  <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-medium text-muted-foreground">
              {weekdayHeaders.map((wd) => (
                <div key={wd.iso} className="py-1">
                  {wd.label}
                </div>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-1.5">
              {Array.from({ length: leadingBlanks }, (_, i) => (
                <div key={`blank-${i}`} aria-hidden="true" />
              ))}

              {data.days.map((day) => {
                const status = dayStatus(day);
                const isToday = day.day_index === data.today_day_index;
                const isSelected = selectedDay?.day_index === day.day_index;
                const statusLabelKey =
                  status === "goal-met"
                    ? "motivation.streak.status.goalMet"
                    : status === "studied"
                      ? "motivation.streak.status.studied"
                      : status === "frozen"
                        ? "motivation.streak.status.frozen"
                        : "motivation.streak.status.rest";

                return (
                  <button
                    key={day.day_index}
                    type="button"
                    data-testid={`streak-day-${day.day_of_month}`}
                    data-day-status={status}
                    aria-pressed={isSelected}
                    aria-label={`${formatBackendDate(day.date)} · ${t(statusLabelKey)}`}
                    onClick={() => setSelectedDayIndex(day.day_index)}
                    className={cn(
                      "relative flex min-h-[42px] flex-col items-center justify-center gap-0.5 rounded-lg border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      status === "goal-met" &&
                        (style === "game"
                          ? "border-transparent bg-[hsl(var(--game-xp))] text-white"
                          : "border-transparent bg-primary text-primary-foreground"),
                      status === "studied" && "border-primary/35 bg-primary/15 text-foreground",
                      status === "frozen" &&
                        "border-[hsl(var(--game-freeze))]/40 bg-[hsl(var(--game-freeze))]/15 text-[hsl(var(--game-freeze))]",
                      status === "rest" &&
                        "border-transparent bg-secondary/40 text-muted-foreground",
                      isToday && "ring-2 ring-ring ring-offset-1 ring-offset-card",
                      isSelected && !isToday && "border-foreground/50",
                    )}
                  >
                    <span className="tnum leading-none">{formatNumber(day.day_of_month)}</span>
                    {status === "goal-met" && (
                      <Check className="size-3" strokeWidth={2.5} aria-hidden="true" />
                    )}
                    {status === "studied" && (
                      <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                    )}
                    {status === "frozen" && (
                      <FrostShieldIcon className="size-3" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Selected day detail footer (touch & keyboard accessible) */}
            {selectedDay && (
              <div
                data-testid="streak-day-detail"
                className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">
                    {formatBackendDate(selectedDay.date)}
                  </span>
                  <span>·</span>
                  <span>
                    {t(
                      selectedDay.frozen
                        ? "motivation.streak.status.frozen"
                        : selectedDay.goal_met
                          ? "motivation.streak.status.goalMet"
                          : selectedDay.studied
                            ? "motivation.streak.status.studied"
                            : "motivation.streak.status.rest",
                    )}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="tnum font-medium text-foreground">
                    {t("progress.yesterday.xp", { xp: formatNumber(selectedDay.xp) })}
                  </span>
                  <span className="tnum">
                    {tn("progress.yesterday.reviews", selectedDay.reviews, {
                      count: formatNumber(selectedDay.reviews),
                    })}
                  </span>
                  <span className="tnum">
                    {tn("progress.yesterday.tasks", selectedDay.tasks_completed, {
                      count: formatNumber(selectedDay.tasks_completed),
                    })}
                  </span>
                  <span className="tnum">
                    {tn("progress.yesterday.habits", selectedDay.habits_completed, {
                      count: formatNumber(selectedDay.habits_completed),
                    })}
                  </span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
