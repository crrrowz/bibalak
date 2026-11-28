import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { AvatarStage } from "@/components/avatar/AvatarStage";
import { useGameDepthState } from "@/features/game/depth/useGameDepth";
import { useGameState } from "@/features/game/useGameState";
import { useMotivationState } from "@/features/motivation/useMotivation";
import {
  pushNotification,
  setNotificationCollectionScope,
} from "@/features/notifications/notificationStore";
import { formatNumber, t } from "@/lib/i18n";
import { ipc, isTauri } from "@/lib/ipc";
import { dur, ease, useReducedMotion } from "@/lib/motion";
import { queryKeys } from "@/lib/queryKeys";
import { playStyleCue } from "@/lib/styleAudio";
import { getStyleSkin } from "@/lib/styles/skins";
import { cn } from "@/lib/utils";
import { useStyle, type Style } from "@/stores/style";
import { CertificateDialog } from "./CertificateDialog";
import { GameRankDialog } from "./GameRankDialog";
import { useProgressSummary } from "./useProgressSummary";

export const GOAL_CELEBRATED_DAY_KEY = "keepsake-goal-celebrated-day";

function hashCollectionScope(raw: string): string {
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function scopedCelebrationKey(baseKey: string, scopeHash: string): string {
  return scopeHash ? `${baseKey}:${scopeHash}` : baseKey;
}

interface PendingDialog {
  mode: "game_rank" | "scholar_certificate";
  tierIndex: number;
  level: number;
  totalXp: number;
  date: Date;
}

interface GoalCelebrationState {
  style: Style;
  earned: number;
  goal: number;
}

function readHighWater(key: string): number | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeHighWater(key: string, value: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore storage failures
  }
}

/**
 * Shared celebration watcher for Game and Scholar styles:
 * - Initializes high-water marks silently on first run (never retroactive)
 * - Keeps high-water marks updated silently in Default style (never lowers on undo)
 * - Shows a non-blocking level-up toast + tier-up dialog (GameRankDialog / CertificateDialog)
 *   once per higher milestone in Game and Scholar, calling `playStyleCue("level_up")`.
 */
export function CelebrationHost() {
  const style = useStyle((s) => s.style);
  const skin = getStyleSkin(style);
  const reducedMotion = Boolean(useReducedMotion());
  const { data } = useProgressSummary();
  const { data: motivationData } = useMotivationState();
  const appInfoQuery = useQuery({
    queryKey: queryKeys.appInfo,
    queryFn: async () => (await ipc.appInfo()) ?? null,
    enabled: isTauri(),
    staleTime: Infinity,
  });
  const mediaDir = appInfoQuery.data?.media_dir ?? "";
  const scopeHash = useMemo(() => (mediaDir ? hashCollectionScope(mediaDir) : ""), [mediaDir]);

  useEffect(() => {
    setNotificationCollectionScope(mediaDir || null);
  }, [mediaDir]);

  const gameQuery = useGameState(skin !== null);
  const depthQuery = useGameDepthState(style === "game");
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const [goalBanner, setGoalBanner] = useState<GoalCelebrationState | null>(null);
  const sawUnmetDayRef = useRef<number | null>(null);
  const prevStyleRef = useRef<Style>(style);
  const styleChanged = prevStyleRef.current !== style;

  useEffect(() => {
    prevStyleRef.current = style;
  }, [style]);

  useEffect(() => {
    if (!motivationData) return;
    const today = motivationData.today_day_index;
    const goalKey = scopedCelebrationKey(GOAL_CELEBRATED_DAY_KEY, scopeHash);
    let seenDay = readHighWater(goalKey);
    if (seenDay !== null && today < seenDay) {
      // Collection switched or reset to an earlier day index: clear stale high-water ceiling.
      seenDay = null;
    }

    if (!motivationData.goal_met_today) {
      sawUnmetDayRef.current = today;
      if (seenDay === null && readHighWater(goalKey) !== null) {
        try {
          localStorage.removeItem(goalKey);
        } catch {
          // ignore storage failures
        }
      }
      return;
    }

    const transitionedThisSession = sawUnmetDayRef.current === today;
    if (seenDay === null) {
      writeHighWater(goalKey, today);
      if (!transitionedThisSession) {
        return;
      }
    } else if (today > seenDay) {
      writeHighWater(goalKey, today);
    } else {
      return;
    }

    setGoalBanner({
      style,
      earned: motivationData.today_xp,
      goal: motivationData.daily_goal_xp,
    });
    if (!styleChanged && (style === "game" || style === "scholar")) {
      playStyleCue("unlock");
    }
  }, [motivationData, scopeHash, style, styleChanged]);

  useEffect(() => {
    if (!goalBanner) return;
    const timer = setTimeout(() => setGoalBanner(null), 4000);
    return () => clearTimeout(timer);
  }, [goalBanner]);

  useEffect(() => {
    if (!data) return;

    const gameSkin = getStyleSkin("game")!;
    const scholarSkin = getStyleSkin("scholar")!;
    const allSkins = [gameSkin, scholarSkin] as const;

    let cueTriggered = false;

    for (const s of allSkins) {
      const currentLevel = data.level;
      const currentTier = s.rankForLevel(currentLevel).index;
      const levelKey = scopedCelebrationKey(s.celebration.levelSeenStorageKey, scopeHash);
      const tierKey = scopedCelebrationKey(s.celebration.tierSeenStorageKey, scopeHash);
      const seenLevel = readHighWater(levelKey);
      const seenTier = readHighWater(tierKey);

      const isActiveSkin = skin?.id === s.id;

      if (seenLevel === null) {
        writeHighWater(levelKey, currentLevel);
      } else if (currentLevel > seenLevel) {
        writeHighWater(levelKey, currentLevel);
        if (isActiveSkin) {
          pushNotification({
            kind: "level_up",
            title: t(s.celebration.levelUpTitleKey),
            body: t(s.celebration.levelUpBodyKey, {
              level: formatNumber(currentLevel),
            }),
            link: "/character",
            dedupeKey: `level_up:${s.id}:${currentLevel}`,
            soundCue: null,
          });
          cueTriggered = true;
        }
      }

      if (seenTier === null) {
        writeHighWater(tierKey, currentTier);
      } else if (currentTier > seenTier) {
        writeHighWater(tierKey, currentTier);
        if (isActiveSkin) {
          const rankLabel = t(s.rankForLevel(currentLevel).labelKey);
          pushNotification({
            kind: "title_up",
            title: t(s.celebration.tierUpTitleKey),
            body: rankLabel,
            link: s.id === "scholar" ? "/transcript" : "/character",
            dedupeKey: `title_up:${s.id}:${currentTier}`,
            showPopup: false,
            soundCue: null,
          });
          setPending({
            mode: s.celebration.tierUpMode,
            tierIndex: currentTier,
            level: currentLevel,
            totalXp: data.total_xp,
            date: new Date(),
          });
          cueTriggered = true;
        }
      }
    }

    if (cueTriggered && !styleChanged) {
      playStyleCue("level_up");
    }
  }, [data, scopeHash, skin, styleChanged]);

  const avatar = gameQuery.data?.avatar ?? null;
  const equipped = gameQuery.data?.equipped ?? null;
  const activePet =
    depthQuery.data?.pets.find((p) => p.id === depthQuery.data.active_pet_id) ?? null;

  const goalReachedKey =
    goalBanner?.style === "game"
      ? "motivation.goal.reached.game"
      : goalBanner?.style === "scholar"
        ? "motivation.goal.reached.scholar"
        : "motivation.goal.reached.default";

  return (
    <>
      {goalBanner && (
        <motion.div
          data-testid="goal-reached-celebration"
          data-style={goalBanner.style}
          data-reduced-motion={reducedMotion ? "true" : "false"}
          role="status"
          aria-live="polite"
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : dur.fast, ease }}
          className={cn(
            "glass-panel fixed bottom-4 start-4 z-30 flex max-w-xs items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 shadow-lg",
            goalBanner.style === "game" ? "border-[hsl(var(--game-xp))]/50" : "border-primary/40",
          )}
        >
          {goalBanner.style !== "default" ? (
            <AvatarStage
              style={goalBanner.style}
              size={32}
              level={data?.level ?? gameQuery.data?.level ?? 1}
              profile={avatar}
              equipped={goalBanner.style === "game" ? equipped : null}
              pet={
                goalBanner.style === "game" && activePet
                  ? { speciesKey: activePet.species_key, variantKey: activePet.variant_key }
                  : null
              }
              mounted={depthQuery.data?.mounted ?? false}
              className="shrink-0 rounded-lg border border-border"
            />
          ) : (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Check className="size-4" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-foreground">{t(goalReachedKey)}</p>
            <p className="tnum text-[11px] text-muted-foreground">
              {t("motivation.goal.progress", {
                earned: formatNumber(goalBanner.earned),
                goal: formatNumber(goalBanner.goal),
              })}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => setGoalBanner(null)}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </motion.div>
      )}
      <GameRankDialog
        open={pending?.mode === "game_rank"}
        rankIndex={pending?.tierIndex ?? 0}
        level={pending?.level ?? 1}
        profile={avatar}
        equipped={equipped}
        onClose={() => setPending(null)}
      />
      <CertificateDialog
        open={pending?.mode === "scholar_certificate"}
        titleIndex={pending?.tierIndex ?? 0}
        level={pending?.level ?? 1}
        totalXp={pending?.totalXp ?? 0}
        date={pending?.date}
        avatar={avatar}
        onClose={() => setPending(null)}
      />
    </>
  );
}
