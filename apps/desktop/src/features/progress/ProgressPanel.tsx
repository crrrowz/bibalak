import { AvatarStage } from "@/components/avatar/AvatarStage";
import {
  GoldIcon,
  KnowledgePointsIcon,
  LevelIcon,
  TranscriptIcon,
  XpIcon,
} from "@/components/icons/progress";
import { useGameState } from "@/features/game/useGameState";
import { isTauri } from "@/lib/ipc";
import { formatNumber, t } from "@/lib/i18n";
import { useReducedMotion } from "@/lib/motion";
import { gameRank } from "@/lib/styles/game";
import { formatCurrency, scholarTitle } from "@/lib/styles/scholar";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";
import { cn } from "@/lib/utils";
import { useStyle } from "@/stores/style";
import { useProgressSummary } from "./useProgressSummary";

export interface ProgressPanelProps {
  variant?: "compact" | "section";
  className?: string;
}

/**
 * Quiet progress summary panel (level, XP bar, total XP, gold/knowledge points,
 * and today's XP). Shared between Home (compact) and Stats (section).
 */
export function ProgressPanel({ variant = "compact", className }: ProgressPanelProps) {
  const tauri = isTauri();
  const style = useStyle((s) => s.style);
  const reducedMotion = useReducedMotion();
  const navigate = useOptionalNavigate();
  const { data, isLoading, isError } = useProgressSummary();
  const gameQuery = useGameState(tauri && style !== "default");

  if (!tauri) return null;

  const containerClass = cn(
    variant === "compact"
      ? "mx-4 mt-4 rounded-xl border border-border bg-card px-4 py-3 sm:mx-6 lg:mx-8"
      : "rounded-xl border border-border bg-card p-5",
    className,
  );

  if (isLoading) {
    return (
      <section
        data-testid="progress-panel-loading"
        aria-label={t("progress.loading")}
        className={containerClass}
      >
        <div className="space-y-2">
          <div className="h-4 w-36 rounded bg-muted" />
          <div className="h-2 w-full rounded-full bg-muted" />
        </div>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section data-testid="progress-panel-error" className={containerClass}>
        <p className="text-xs text-muted-foreground">{t("progress.error")}</p>
      </section>
    );
  }

  const levelText =
    style === "scholar"
      ? t("progress.scholarLevel", {
          title: t(scholarTitle(data.level)),
          level: formatNumber(data.level),
        })
      : style === "game"
        ? t("game.hud.rankLevel", {
            rank: t(gameRank(data.level)),
            level: formatNumber(data.level),
          })
        : t("progress.level", { level: formatNumber(data.level) });

  const xpNextText = t("progress.xpIntoNext", {
    current: formatNumber(data.xp_into_level),
    next: formatNumber(data.xp_to_next_level),
  });
  const totalXpText = t("progress.totalXp", { xp: formatNumber(data.total_xp) });
  const currencyText = formatCurrency(data.gold_cents, style);
  const todayXpText = t("progress.todayXp", { xp: formatNumber(data.today_xp) });

  const pct =
    data.xp_to_next_level > 0
      ? Math.min(100, Math.max(0, (data.xp_into_level / data.xp_to_next_level) * 100))
      : 0;

  const CurrencyIcon = style === "scholar" ? KnowledgePointsIcon : GoldIcon;

  // Game on Home: TodayCard shows today's gold and tasks (no duplicate "Today's Loot" row).
  if (style === "game" && variant === "compact") {
    return null;
  }

  // Scholar on Home: the StyleHud shows the title, avatar and XP bar, and
  // TodayCard shows today's XP, so the compact panel shows gold + Transcript link.
  if (style === "scholar" && variant === "compact") {
    return (
      <section aria-label={t("progress.panel.title")} className={containerClass}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <KnowledgePointsIcon className="size-3.5 shrink-0 text-primary" />
            <span className="tnum">{formatCurrency(data.today_gold_cents, "scholar")}</span>
          </span>
          <a
            href="/transcript"
            onClick={(e) => {
              if (navigate) {
                e.preventDefault();
                navigate("/transcript");
              }
            }}
            className="inline-flex items-center gap-1 rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <TranscriptIcon className="size-3.5 shrink-0" />
            <span>{t("scholar.transcript.link")}</span>
          </a>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label={variant === "compact" ? t("progress.panel.title") : undefined}
      className={containerClass}
    >
      {variant === "section" && (
        <h2 className="mb-3 text-sm font-medium text-foreground">{t("progress.panel.title")}</h2>
      )}

      <div className="flex items-start gap-4">
        {style !== "default" && (
          <AvatarStage
            style={style}
            size={variant === "section" ? 64 : 32}
            level={data.level}
            profile={gameQuery.data?.avatar}
            equipped={style === "game" ? gameQuery.data?.equipped : undefined}
            className="rounded-xl border border-border"
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <div className="flex items-center gap-2">
              <LevelIcon className="size-4 shrink-0 text-primary" />
              <span
                className={cn(
                  "text-sm font-semibold text-foreground",
                  style === "game" && "game-hud-level text-base",
                )}
              >
                {levelText}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <XpIcon className="size-3.5 shrink-0 text-primary" />
                <span className="tnum">{totalXpText}</span>
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  style === "game" && "font-medium text-[hsl(var(--game-gold))]",
                )}
              >
                <CurrencyIcon className="size-3.5 shrink-0 text-primary" />
                <span className="tnum">{currencyText}</span>
              </span>
              {variant === "section" && (
                <span className="tnum font-medium text-foreground">{todayXpText}</span>
              )}
              {style === "scholar" && (
                <a
                  href="/transcript"
                  onClick={(e) => {
                    if (navigate) {
                      e.preventDefault();
                      navigate("/transcript");
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <TranscriptIcon className="size-3.5 shrink-0" />
                  <span>{t("scholar.transcript.link")}</span>
                </a>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div
              role="progressbar"
              aria-label={t("progress.levelProgress")}
              aria-valuemin={0}
              aria-valuemax={data.xp_to_next_level}
              aria-valuenow={data.xp_into_level}
              className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"
            >
              <div
                className={cn(
                  "h-full rounded-full",
                  style === "game" ? "bg-[hsl(var(--game-xp))]" : "bg-primary",
                  reducedMotion ? "transition-none" : "transition-[width] duration-200 ease-out",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="tnum shrink-0 text-xs text-muted-foreground">{xpNextText}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
