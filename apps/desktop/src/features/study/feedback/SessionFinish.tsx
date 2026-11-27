import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Check, Flame, RotateCcw, Settings } from "lucide-react";
import { AvatarStage } from "@/components/avatar/AvatarStage";
import { ExtendTodayLimit } from "@/components/decks/IncreaseLimitControl";
import { GoldIcon, KnowledgePointsIcon, XpIcon } from "@/components/icons/progress";
import { Button } from "@/components/ui/button";
import { useGameDepthState } from "@/features/game/depth/useGameDepth";
import { useGameState } from "@/features/game/useGameState";
import { GoalRing } from "@/features/motivation/GoalRing";
import { useMotivationState } from "@/features/motivation/useMotivation";
import { useProgressSummary } from "@/features/progress/useProgressSummary";
import { formatNumber, t, tn } from "@/lib/i18n";
import { isTauri } from "@/lib/ipc";
import { dur, ease, useReducedMotion } from "@/lib/motion";
import { formatCurrency } from "@/lib/styles/scholar";
import { getStyleSkin } from "@/lib/styles/skins";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";
import { cn } from "@/lib/utils";
import { useStyle } from "@/stores/style";

export interface SessionFinishProps {
  sessionCards: number;
  sessionXp: number;
  sessionAccuracyPct?: number | null;
  sessionDurationMs?: number;
  streakExtended?: boolean;
  deckId: number;
  onExit: () => void;
  onUndo: () => void;
  undoPending: boolean;
  onExtended: () => void;
  onOpenOptions: () => void;
}

function formatSessionDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) {
    return t("stats.unit.seconds", { n: formatNumber(totalSec) });
  }
  const totalMin = Math.floor(totalSec / 60);
  const remSec = totalSec % 60;
  if (totalMin < 60) {
    const minStr = t("stats.unit.minutes", { n: formatNumber(totalMin) });
    return remSec > 0
      ? `${minStr} ${t("stats.unit.seconds", { n: formatNumber(remSec) })}`
      : minStr;
  }
  const hours = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  const hourStr = t("stats.unit.hours", { n: formatNumber(hours) });
  return remMin > 0
    ? `${hourStr} ${t("stats.unit.minutes", { n: formatNumber(remMin) })}`
    : hourStr;
}

/**
 * End-of-session screen (Cycle 3, 16e): displays XP earned, cards reviewed,
 * accuracy, elapsed time, live daily XP goal ring, and a "Streak +1" moment
 * when this session started today's study streak, in the active style's words.
 */
export function SessionFinish({
  sessionCards,
  sessionXp,
  sessionAccuracyPct = null,
  sessionDurationMs = 0,
  streakExtended = false,
  deckId,
  onExit,
  onUndo,
  undoPending,
  onExtended,
  onOpenOptions,
}: SessionFinishProps) {
  const tauri = isTauri();
  const style = useStyle((s) => s.style);
  const skin = getStyleSkin(style);
  const reducedMotion = Boolean(useReducedMotion());
  const navigate = useOptionalNavigate();

  const gameQuery = useGameState(tauri && skin !== null);
  const depthQuery = useGameDepthState(tauri && style === "game");
  const progressQuery = useProgressSummary(tauri);
  const motivationQuery = useMotivationState(tauri);
  const motivation = motivationQuery.data ?? null;
  const progress = progressQuery.data ?? null;

  // Capture initial studied_today=false -> true if parent didn't pass streakExtended explicitly.
  const initialStudiedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (motivation && initialStudiedRef.current === null) {
      initialStudiedRef.current = motivation.studied_today;
    }
  }, [motivation]);

  const isStreakPlusOne =
    streakExtended ||
    (initialStudiedRef.current === false && Boolean(motivation?.studied_today) && sessionCards > 0);

  const level =
    style === "game"
      ? (gameQuery.data?.level ?? 1)
      : (progressQuery.data?.level ?? gameQuery.data?.level ?? 1);
  const profile = gameQuery.data?.avatar ?? null;
  const equipped = style === "game" ? (gameQuery.data?.equipped ?? null) : null;
  const depth = depthQuery.data;
  const activePet = depth?.pets.find((p) => p.id === depth.active_pet_id) ?? null;

  const headingKey =
    sessionCards === 0
      ? style === "game"
        ? "motivation.sessionEnd.emptyQueue.game"
        : style === "scholar"
          ? "motivation.sessionEnd.emptyQueue.scholar"
          : "motivation.sessionEnd.emptyQueue.default"
      : style === "game"
        ? "motivation.sessionEnd.heading.game"
        : style === "scholar"
          ? "motivation.sessionEnd.heading.scholar"
          : "motivation.sessionEnd.heading.default";

  const goalReachedKey =
    style === "game"
      ? "motivation.goal.reached.game"
      : style === "scholar"
        ? "motivation.goal.reached.scholar"
        : "motivation.goal.reached.default";

  const accuracyText =
    sessionCards > 0 && sessionAccuracyPct !== null && sessionAccuracyPct !== undefined
      ? formatNumber(sessionAccuracyPct / 100, { style: "percent", maximumFractionDigits: 0 })
      : "—";

  const durationText = sessionCards > 0 ? formatSessionDuration(sessionDurationMs) : "—";

  const goStreak = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (navigate) {
      e.preventDefault();
      navigate("/streak");
    }
  };

  return (
    <motion.div
      data-testid="session-finish"
      data-feedback-style={style}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : dur.base, ease }}
      className="mx-auto flex h-full w-full max-w-lg flex-col items-center justify-center gap-5 px-4 py-8 text-center sm:px-6"
    >
      {skin ? (
        <AvatarStage
          style={skin.id}
          size={64}
          level={level}
          profile={profile}
          equipped={equipped}
          pet={
            activePet
              ? { speciesKey: activePet.species_key, variantKey: activePet.variant_key }
              : null
          }
          mounted={depth?.mounted ?? false}
          className="rounded-xl border border-border"
        />
      ) : (
        <div className="flex size-12 items-center justify-center rounded-xl bg-secondary text-primary">
          <Check className="size-6" aria-hidden="true" />
        </div>
      )}

      <div className="space-y-1">
        <h2 className="screen-title text-lg font-semibold text-foreground">{t(headingKey)}</h2>
        {sessionCards === 0 && (
          <p data-testid="session-finish-empty-line" className="text-sm text-muted-foreground">
            {t("motivation.sessionEnd.nothingDue")}
          </p>
        )}
      </div>

      {/* 4 session metrics when cards were reviewed; otherwise today's totals */}
      {sessionCards > 0 ? (
        <div
          data-testid="session-finish-tiles"
          className="grid w-full grid-cols-2 gap-2.5 sm:grid-cols-4"
        >
          <div className="rounded-xl border border-border bg-card px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              {t("motivation.sessionEnd.xpEarned")}
            </p>
            <p
              className={cn(
                "tnum mt-0.5 inline-flex items-center justify-center gap-1 text-sm font-semibold",
                style === "game"
                  ? "text-[hsl(var(--game-xp))]"
                  : style === "scholar"
                    ? "text-primary"
                    : "text-foreground",
              )}
            >
              {skin && <XpIcon className="size-3.5 shrink-0" aria-hidden="true" />}
              <span>{t("study.feedback.xpGain", { xp: formatNumber(sessionXp) })}</span>
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              {t("motivation.sessionEnd.cardsReviewed")}
            </p>
            <p className="tnum mt-0.5 text-sm font-semibold text-foreground">
              {formatNumber(sessionCards)}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              {t("motivation.sessionEnd.accuracy")}
            </p>
            <p className="tnum mt-0.5 text-sm font-semibold text-foreground">{accuracyText}</p>
          </div>

          <div className="rounded-xl border border-border bg-card px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              {t("motivation.sessionEnd.timeSpent")}
            </p>
            <p className="tnum mt-0.5 text-sm font-semibold text-foreground">{durationText}</p>
          </div>
        </div>
      ) : (
        progress && (
          <div
            data-testid="session-finish-today-totals"
            className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-xs text-muted-foreground"
          >
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <XpIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span className="tnum">
                {t("progress.todayXp", { xp: formatNumber(progress.today_xp) })}
              </span>
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 font-medium",
                style === "game" ? "text-[hsl(var(--game-gold))]" : "text-foreground",
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
              <span className="tnum">{formatCurrency(progress.today_gold_cents, style)}</span>
            </span>
            <span className="tnum">
              {t("game.todayTasks", {
                done: formatNumber(progress.tasks_rewarded_today),
                cap: formatNumber(progress.task_reward_daily_cap),
              })}
            </span>
          </div>
        )
      )}

      {/* Daily goal ring + Streak +1 moment */}
      {motivation && (
        <div className="flex w-full flex-col gap-3 rounded-xl border border-border bg-card p-4 text-start">
          <div className="flex items-center gap-3.5">
            <GoalRing earned={motivation.today_xp} goal={motivation.daily_goal_xp} size={56} />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="tnum text-sm font-semibold text-foreground">
                {t("motivation.goal.progress", {
                  earned: formatNumber(motivation.today_xp),
                  goal: formatNumber(motivation.daily_goal_xp),
                })}
              </p>
              <p
                className={cn(
                  "tnum text-xs",
                  motivation.goal_met_today
                    ? style === "game"
                      ? "font-medium text-[hsl(var(--game-xp))]"
                      : "font-medium text-primary"
                    : "text-muted-foreground",
                )}
              >
                {motivation.goal_met_today
                  ? t(goalReachedKey)
                  : t("motivation.goal.remaining", {
                      xp: formatNumber(Math.max(0, motivation.daily_goal_xp - motivation.today_xp)),
                    })}
              </p>
            </div>
          </div>

          {isStreakPlusOne && (
            <a
              href="/streak"
              onClick={goStreak}
              aria-label={t("motivation.streak.openCalendar")}
              data-testid="session-streak-plus-one"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-secondary/40 px-3 py-2 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <Flame
                  className={cn(
                    "size-4 shrink-0",
                    style === "game" ? "text-[hsl(var(--game-gold))]" : "text-primary",
                  )}
                  aria-hidden="true"
                />
                <span
                  className={cn(style === "game" ? "text-[hsl(var(--game-gold))]" : "text-primary")}
                >
                  {t("motivation.sessionEnd.streakExtended")}
                </span>
                <span className="tnum text-foreground">
                  {tn("motivation.streak.dayCount", motivation.current_streak, {
                    count: formatNumber(motivation.current_streak),
                  })}
                </span>
              </span>
              <span className="tnum text-muted-foreground">
                {motivation.next_milestone !== null
                  ? t("motivation.streak.nextMilestone", {
                      days: formatNumber(motivation.next_milestone),
                    })
                  : t("motivation.streak.milestoneAchieved")}
              </span>
            </a>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex w-full flex-col items-center gap-2.5">
        <Button className="min-h-[44px] w-full sm:w-auto sm:min-w-[180px]" onClick={onExit}>
          {t("motivation.sessionEnd.back")}
        </Button>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <ExtendTodayLimit deckId={deckId} onDone={onExtended} />
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-muted-foreground"
            onClick={onOpenOptions}
          >
            <Settings className="size-3.5" aria-hidden="true" />
            {t("motivation.sessionEnd.deckOptions")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-muted-foreground"
            onClick={onUndo}
            disabled={undoPending}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {t("motivation.sessionEnd.undo")}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
