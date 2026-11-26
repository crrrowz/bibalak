import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, Check, CheckCircle2, ChevronRight, Pencil, Play } from "lucide-react";
import type { DeckSummary } from "@bibalak/ipc-types";
import { StreakFlameIcon } from "@/components/icons/game";
import { GoldIcon, KnowledgePointsIcon } from "@/components/icons/progress";
import { Button } from "@/components/ui/button";
import { useProgressSummary } from "@/features/progress/useProgressSummary";
import { formatNumber, t, tn } from "@/lib/i18n";
import { isTauri } from "@/lib/ipc";
import { formatCurrency } from "@/lib/styles/scholar";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";
import { cn } from "@/lib/utils";
import { useStyle } from "@/stores/style";
import { GoalRing } from "./GoalRing";
import {
  DAILY_GOAL_XP_CHOICES,
  questTitle,
  useMotivationState,
  useSetDailyGoal,
} from "./useMotivation";

export interface TodayCardProps {
  decks: DeckSummary[];
  onStudy: (deck: DeckSummary) => void;
}

/**
 * Unified "Today" card anchored at the top of the Home deck browser in every
 * layout: daily XP goal ring with inline goal selector, streak chip linking to
 * `/streak`, due counts, compact 3-quest preview linking to `/quests`, and
 * primary Start/Continue CTA.
 */
export function TodayCard({ decks, onStudy }: TodayCardProps) {
  const tauri = isTauri();
  const style = useStyle((s) => s.style);
  const navigate = useOptionalNavigate();
  const { data: state, isLoading } = useMotivationState();
  const progressQuery = useProgressSummary();
  const progress = progressQuery.data ?? null;
  const setGoalMut = useSetDailyGoal();
  const [goalMenuOpen, setGoalMenuOpen] = useState(false);
  const goalPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!goalMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (goalPopoverRef.current && !goalPopoverRef.current.contains(e.target as Node)) {
        setGoalMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGoalMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [goalMenuOpen]);

  const dueTotals = useMemo(() => {
    const topLevel = decks.filter((d) => d.parent_id === null);
    const source = topLevel.length > 0 ? topLevel : decks;
    return source.reduce(
      (acc, d) => ({
        newCount: acc.newCount + d.new_count,
        learningCount: acc.learningCount + d.learning_count,
        reviewCount: acc.reviewCount + d.review_count,
      }),
      { newCount: 0, learningCount: 0, reviewCount: 0 },
    );
  }, [decks]);

  const nextDueDeck = useMemo(
    () => decks.find((d) => d.new_count + d.learning_count + d.review_count > 0) ?? null,
    [decks],
  );

  if (!tauri) return null;

  if (isLoading) {
    return (
      <section
        data-testid="today-card-loading"
        aria-label={t("motivation.today.title")}
        className="mx-4 mt-4 rounded-xl border border-border bg-card p-4 sm:mx-6 sm:p-5 lg:mx-8"
      >
        <div className="flex items-center gap-4">
          <div className="size-14 shrink-0 rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 rounded bg-muted" />
            <div className="h-3 w-56 rounded bg-muted" />
          </div>
        </div>
      </section>
    );
  }

  if (!state) return null;

  const goalLabelKey =
    style === "game"
      ? "motivation.goal.label.game"
      : style === "scholar"
        ? "motivation.goal.label.scholar"
        : "motivation.goal.label.default";

  const goalReachedKey =
    style === "game"
      ? "motivation.goal.reached.game"
      : style === "scholar"
        ? "motivation.goal.reached.scholar"
        : "motivation.goal.reached.default";

  const questsPreviewKey =
    style === "game"
      ? "motivation.today.questsPreview.game"
      : style === "scholar"
        ? "motivation.today.questsPreview.scholar"
        : "motivation.today.questsPreview.default";

  const remainingXp = Math.max(0, state.daily_goal_xp - state.today_xp);
  const totalDue = dueTotals.newCount + dueTotals.learningCount + dueTotals.reviewCount;
  const dueSummaryText = t("motivation.today.dueSummary", {
    newCount: formatNumber(dueTotals.newCount),
    learningCount: formatNumber(dueTotals.learningCount),
    reviewCount: formatNumber(dueTotals.reviewCount),
  });
  const streakCountText = tn("motivation.streak.dayCount", state.current_streak, {
    count: formatNumber(state.current_streak),
  });

  const go = (to: "/streak" | "/quests") => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (navigate) {
      e.preventDefault();
      navigate(to);
    }
  };

  return (
    <section
      data-testid="today-card"
      aria-label={t("motivation.today.title")}
      className="mx-4 mt-4 rounded-[14px] border border-border bg-card p-4 sm:mx-6 sm:p-5 lg:mx-8"
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Headline: goal ring + cards left + XP goal selector */}
          <div className="flex min-w-0 flex-1 items-center gap-3.5">
            <GoalRing earned={state.today_xp} goal={state.daily_goal_xp} size={56} />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2
                  data-testid="today-headline"
                  className="tnum text-base font-semibold tracking-tight text-foreground"
                >
                  {totalDue > 0
                    ? tn("motivation.today.cardsLeft", totalDue)
                    : t("motivation.today.title")}
                </h2>
                {totalDue > 0 && (
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("motivation.today.title")}
                  </span>
                )}
                <span className="text-xs text-muted-foreground" aria-hidden="true">
                  ·
                </span>
                <div className="relative" ref={goalPopoverRef}>
                  <button
                    type="button"
                    aria-label={t("motivation.goal.change")}
                    aria-expanded={goalMenuOpen}
                    onClick={() => setGoalMenuOpen((open) => !open)}
                    className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-border/70 bg-secondary/40 px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="tnum">
                      {t("motivation.goal.progress", {
                        earned: formatNumber(state.today_xp),
                        goal: formatNumber(state.daily_goal_xp),
                      })}
                    </span>
                    <Pencil className="size-3 text-muted-foreground" aria-hidden="true" />
                  </button>

                  {goalMenuOpen && (
                    <div
                      role="dialog"
                      aria-label={t(goalLabelKey)}
                      className="glass-panel absolute start-0 top-full z-30 mt-1.5 min-w-[168px] rounded-lg border border-border p-1.5 shadow-md"
                    >
                      <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                        {t(goalLabelKey)}
                      </p>
                      <div className="space-y-0.5">
                        {DAILY_GOAL_XP_CHOICES.map((choice) => {
                          const active = state.daily_goal_xp === choice;
                          return (
                            <button
                              key={choice}
                              type="button"
                              disabled={setGoalMut.isPending}
                              onClick={() => {
                                setGoalMut.mutate(choice);
                                setGoalMenuOpen(false);
                              }}
                              className={cn(
                                "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                active
                                  ? "bg-accent font-semibold text-foreground"
                                  : "text-foreground",
                              )}
                            >
                              <span className="tnum">
                                {t("motivation.goal.option", { xp: formatNumber(choice) })}
                              </span>
                              {active && (
                                <Check className="size-3.5 text-primary" aria-hidden="true" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* One short secondary line */}
              <div
                data-testid="today-secondary-line"
                className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground"
              >
                <span
                  className={cn(
                    "tnum",
                    state.goal_met_today
                      ? style === "game"
                        ? "font-medium text-[hsl(var(--game-xp))]"
                        : "font-medium text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  {state.goal_met_today
                    ? t(goalReachedKey)
                    : t("motivation.goal.remaining", { xp: formatNumber(remainingXp) })}
                </span>
                <span aria-hidden="true">·</span>
                <span className="tnum">{dueSummaryText}</span>
                <span aria-hidden="true">·</span>
                <span>{t("motivation.today.xpGoalHint")}</span>

                <a
                  href="/streak"
                  onClick={go("/streak")}
                  aria-label={t("motivation.streak.openCalendar")}
                  className="inline-flex min-h-[24px] items-center gap-1 rounded-md border border-border/70 bg-secondary/45 px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {style === "default" ? (
                    <CalendarCheck className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  ) : (
                    <StreakFlameIcon
                      className="size-3.5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                  )}
                  <span className="tnum">{streakCountText}</span>
                </a>

                {progress && (
                  <>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium tnum",
                        style === "game"
                          ? "border-[hsl(var(--game-gold)/0.35)] bg-[hsl(var(--game-gold)/0.1)] text-[hsl(var(--game-gold))]"
                          : "border-border/70 bg-secondary/45 text-foreground",
                      )}
                    >
                      {style === "scholar" ? (
                        <KnowledgePointsIcon
                          className="size-3.5 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                      ) : (
                        <GoldIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                      )}
                      <span>{formatCurrency(progress.today_gold_cents, style)}</span>
                    </span>
                    <span className="tnum rounded-md border border-border/70 bg-secondary/45 px-2 py-0.5 text-xs text-muted-foreground">
                      {t("game.todayTasks", {
                        done: formatNumber(progress.tasks_rewarded_today),
                        cap: formatNumber(progress.task_reward_daily_cap),
                      })}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Start / Continue CTA */}
          <div className="flex shrink-0 items-center justify-end">
            {nextDueDeck ? (
              <Button
                size="lg"
                className="min-h-[44px] w-full sm:w-auto"
                onClick={() => onStudy(nextDueDeck)}
                title={t("decks.studyNamed", { name: nextDueDeck.name })}
              >
                <Play className="size-4" aria-hidden="true" />
                <span>
                  {state.studied_today
                    ? t("motivation.sessionEnd.continue")
                    : t("motivation.today.startStudy")}
                </span>
              </Button>
            ) : (
              <span className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-border bg-secondary/40 px-3.5 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                <span>{t("motivation.today.caughtUp")}</span>
              </span>
            )}
          </div>
        </div>

        {/* Compact 3 daily quests bar */}
        <a
          href="/quests"
          onClick={go("/quests")}
          className="group flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg border border-border/70 bg-secondary/25 px-3 py-2 text-xs transition-colors hover:bg-accent/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="font-medium text-foreground">{t(questsPreviewKey)}:</span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {state.daily_quests.map((q) => {
              const displayDone = Math.max(0, Math.min(q.progress, q.target));
              return (
                <span
                  key={q.id}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5",
                    q.completed
                      ? style === "game"
                        ? "border-[hsl(var(--game-xp)/0.4)] bg-[hsl(var(--game-xp)/0.1)] font-medium text-[hsl(var(--game-xp))]"
                        : "border-primary/35 bg-primary/10 font-medium text-primary"
                      : "border-border/70 bg-card/80 text-muted-foreground",
                  )}
                >
                  {q.completed && <Check className="size-3 shrink-0" aria-hidden="true" />}
                  <span className="truncate">{questTitle(q)}</span>
                  <span className="tnum">
                    (
                    {t("motivation.quests.progress", {
                      done: formatNumber(displayDone),
                      target: formatNumber(q.target),
                    })}
                    )
                  </span>
                </span>
              );
            })}
          </div>
          <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-primary group-hover:underline">
            <span>{t("motivation.today.viewQuests")}</span>
            <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
          </span>
        </a>
      </div>
    </section>
  );
}
