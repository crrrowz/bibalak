import { motion } from "framer-motion";
import { AvatarStage } from "@/components/avatar/AvatarStage";
import { FrostShieldIcon, StreakFlameIcon } from "@/components/icons/game";
import { GoldIcon, KnowledgePointsIcon } from "@/components/icons/progress";
import { Button } from "@/components/ui/button";
import { useGameDepthState } from "@/features/game/depth/useGameDepth";
import { useGameState } from "@/features/game/useGameState";
import { GoalRing } from "@/features/motivation/GoalRing";
import { useMotivationState } from "@/features/motivation/useMotivation";
import { useProgressSummary } from "@/features/progress/useProgressSummary";
import { useAvatarReaction } from "@/features/study/feedback/useAvatarReaction";
import { useCountUp } from "@/features/study/feedback/useCountUp";
import { XpFloatBadge } from "@/features/study/feedback/XpFloatBadge";
import { formatNumber, t, tn } from "@/lib/i18n";
import { isTauri } from "@/lib/ipc";
import { avatarBounce, useReducedMotion } from "@/lib/motion";
import { formatCurrency } from "@/lib/styles/scholar";
import { getStyleSkin } from "@/lib/styles/skins";
import { useOptionalNavigate, type OptionalRouteTarget } from "@/lib/useOptionalNavigate";
import { cn } from "@/lib/utils";
import { useStyle } from "@/stores/style";

export interface StyleHudProps {
  inFocus?: boolean;
}

/**
 * Shared style HUD bar mounted above `<main>` in Game and Scholar styles
 * (never in Default, never during Study focus mode). Wraps cleanly on narrow
 * viewports with zero horizontal scroll.
 */
export function StyleHud({ inFocus = false }: StyleHudProps) {
  const tauri = isTauri();
  const style = useStyle((s) => s.style);
  const skin = getStyleSkin(style);
  const reducedMotion = Boolean(useReducedMotion());
  const navigate = useOptionalNavigate();

  const active = tauri && skin !== null && !inFocus;
  const gameQuery = useGameState(active);
  const depthQuery = useGameDepthState(active && skin?.id === "game");
  const depth = depthQuery.data;
  const activePet = depth?.pets.find((p) => p.id === depth.active_pet_id) ?? null;
  const progressQuery = useProgressSummary(active && skin?.id === "scholar");
  const motivationQuery = useMotivationState(active);

  const isGame = skin?.id === "game";
  const hasData = active && skin !== null && (isGame ? !!gameQuery.data : !!progressQuery.data);
  const rawLevel = hasData ? (isGame ? gameQuery.data!.level : progressQuery.data!.level) : null;
  const rawXpIntoLevel = hasData
    ? isGame
      ? gameQuery.data!.xp_into_level
      : progressQuery.data!.xp_into_level
    : null;
  const rawGoldCents = hasData
    ? isGame
      ? gameQuery.data!.available_gold_cents
      : progressQuery.data!.gold_cents
    : null;
  const rawTotalXp = hasData
    ? isGame
      ? gameQuery.data!.total_xp
      : progressQuery.data!.total_xp
    : null;

  const displayXpIntoLevel = useCountUp(rawXpIntoLevel, { durationMs: 360, reducedMotion });
  const displayGoldCents = useCountUp(rawGoldCents, { durationMs: 360, reducedMotion });
  const avatarReaction = useAvatarReaction({
    level: rawLevel,
    hasPet: Boolean(isGame && activePet),
    reducedMotion,
  });

  if (!active || !skin) return null;

  const isLoading = isGame ? gameQuery.isLoading : progressQuery.isLoading;
  const isError = isGame ? gameQuery.isError : progressQuery.isError;

  if (isLoading) {
    return (
      <header aria-label={t(skin.hud.ariaLabelKey)} className={skin.hud.containerClass}>
        <div className="flex flex-wrap items-center gap-4">
          <div className="h-8 w-8 rounded-lg bg-muted" />
          <div className="h-4 w-40 rounded bg-muted" />
          <div className="h-2 min-w-[160px] max-w-sm flex-1 rounded-full bg-muted" />
        </div>
      </header>
    );
  }

  if (isError || (isGame && !gameQuery.data) || (!isGame && !progressQuery.data)) {
    return (
      <header aria-label={t(skin.hud.ariaLabelKey)} className={skin.hud.containerClass}>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t("game.error")}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              void gameQuery.refetch();
              if (!isGame) void progressQuery.refetch();
            }}
          >
            {t("game.retry")}
          </Button>
        </div>
      </header>
    );
  }

  const level = isGame ? gameQuery.data!.level : progressQuery.data!.level;
  const xpIntoLevel = isGame ? gameQuery.data!.xp_into_level : progressQuery.data!.xp_into_level;
  const xpToNext = isGame ? gameQuery.data!.xp_to_next_level : progressQuery.data!.xp_to_next_level;
  const streak = motivationQuery.data?.current_streak ?? gameQuery.data?.study_streak ?? 0;
  const motivation = motivationQuery.data ?? null;
  const freezeHeld = gameQuery.data?.freeze_tokens_held ?? 0;
  const freezeCap = gameQuery.data?.freeze_token_cap ?? 3;
  const profile = gameQuery.data?.avatar ?? null;
  const equipped = isGame ? (gameQuery.data?.equipped ?? null) : null;

  const rankInfo = skin.rankForLevel(level);
  const rankName = t(rankInfo.labelKey);
  const rankLevelText =
    skin.id === "game"
      ? t("game.hud.rankLevel", { rank: rankName, level: formatNumber(level) })
      : t("progress.scholarLevel", { title: rankName, level: formatNumber(level) });

  const pct = xpToNext > 0 ? Math.min(100, Math.max(0, (xpIntoLevel / xpToNext) * 100)) : 0;
  const xpNextText = t("progress.xpIntoNext", {
    current: formatNumber(displayXpIntoLevel),
    next: formatNumber(xpToNext),
  });
  const currencyText = formatCurrency(displayGoldCents, skin.id);
  const streakText = tn(skin.hud.streakKeyBase, streak, { count: formatNumber(streak) });

  const go = (to: OptionalRouteTarget) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (navigate) {
      e.preventDefault();
      navigate(to);
    }
  };

  const CurrencyIcon = skin.hud.currencyUnit === "knowledgePoints" ? KnowledgePointsIcon : GoldIcon;

  return (
    <header aria-label={t(skin.hud.ariaLabelKey)} className={skin.hud.containerClass}>
      <div className="flex flex-wrap items-center justify-between gap-x-2.5 gap-y-1.5 lg:flex-nowrap">
        {/* Avatar + Rank / Title · Level */}
        <a
          href={skin.hud.avatarLinkTo}
          onClick={go(skin.hud.avatarLinkTo)}
          className="inline-flex min-w-0 shrink-0 items-center gap-2 rounded-lg pe-1 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <motion.div
            ref={avatarReaction.stageRef}
            data-testid="hud-avatar-reaction"
            data-reacting={avatarReaction.reacting ? "true" : "false"}
            data-pet-hopping={avatarReaction.petHopping ? "true" : "false"}
            data-still={avatarReaction.still ? "true" : "false"}
            animate={avatarReaction.reacting ? avatarBounce.active : avatarBounce.still}
            className="shrink-0"
          >
            <AvatarStage
              style={skin.id}
              size={32}
              level={level}
              profile={profile}
              equipped={equipped}
              pet={
                activePet
                  ? { speciesKey: activePet.species_key, variantKey: activePet.variant_key }
                  : null
              }
              mounted={depth?.mounted ?? false}
              className="rounded-lg border border-border"
            />
          </motion.div>
          <span
            className={cn(
              "truncate text-sm font-semibold text-foreground",
              skin.hud.levelFontClass,
            )}
          >
            {rankLevelText}
          </span>
        </a>

        {/* XP progress bar */}
        <div className="relative flex min-w-[110px] max-w-xs flex-1 items-center gap-2">
          <div
            role="progressbar"
            aria-label={t("progress.levelProgress")}
            aria-valuemin={0}
            aria-valuemax={xpToNext}
            aria-valuenow={xpIntoLevel}
            className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"
          >
            <div
              className={cn(
                "h-full rounded-full",
                skin.hud.xpFillClass,
                reducedMotion ? "transition-none" : "transition-[width] duration-200 ease-out",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="tnum shrink-0 text-xs text-muted-foreground">{xpNextText}</span>
          <XpFloatBadge totalXp={rawTotalXp} />
        </div>

        {/* Currency, Streak & Freezes */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs lg:flex-nowrap">
          {skin.id === "game" ? (
            <a
              href={skin.hud.currencyLinkTo}
              onClick={go(skin.hud.currencyLinkTo)}
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border bg-card px-1.5 py-0.5 font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                skin.hud.currencyClass,
              )}
            >
              <CurrencyIcon className="size-3.5 shrink-0" />
              <span className="tnum">{currencyText}</span>
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border bg-card px-1.5 py-0.5 font-medium text-foreground">
              <CurrencyIcon className="size-3.5 shrink-0 text-primary" />
              <span className="tnum">{currencyText}</span>
            </span>
          )}

          {motivation && (
            <a
              href="/"
              onClick={go("/")}
              title={t("motivation.goal.todayPillTooltip", {
                earned: formatNumber(motivation.today_xp),
                goal: formatNumber(motivation.daily_goal_xp),
              })}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border bg-card px-1.5 py-0.5 font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <GoalRing earned={motivation.today_xp} goal={motivation.daily_goal_xp} size={24} />
              <span className="tnum hidden sm:inline">
                {t("motivation.goal.todayPill", {
                  earned: formatNumber(motivation.today_xp),
                  goal: formatNumber(motivation.daily_goal_xp),
                })}
              </span>
            </a>
          )}

          <a
            href="/streak"
            onClick={go("/streak")}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border bg-card px-1.5 py-0.5 font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <StreakFlameIcon className="size-3.5 shrink-0 text-primary" />
            <span className="tnum">{streakText}</span>
          </a>

          {skin.hud.showFreezes && skin.hud.freezeLinkTo && (
            <a
              href={skin.hud.freezeLinkTo}
              onClick={go(skin.hud.freezeLinkTo)}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border bg-card px-1.5 py-0.5 font-medium text-[hsl(var(--game-freeze))] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FrostShieldIcon className="size-3.5 shrink-0" />
              <span className="tnum">
                {t("game.hud.freezes", {
                  held: formatNumber(freezeHeld),
                  cap: formatNumber(freezeCap),
                })}
              </span>
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
