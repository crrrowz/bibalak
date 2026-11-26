import type { QuestDto } from "@bibalak/ipc-types";
import { Check } from "lucide-react";
import { GoldIcon, KnowledgePointsIcon } from "@/components/icons/progress";
import { formatNumber, t, tn } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Style } from "@/stores/style";
import { formatQuestGold, formatQuestTitle } from "./questFormatting";
import { QuestStyleIcon } from "./questIcons";

export interface QuestCardProps {
  quest: QuestDto;
  style: Style;
  daysRemaining?: number;
  reducedMotion: boolean;
}

/**
 * Single daily or weekly quest card with progress bar, fixed gold reward,
 * completed state, and style-matched iconography.
 */
export function QuestCard({ quest, style, daysRemaining, reducedMotion }: QuestCardProps) {
  const title = formatQuestTitle(quest);
  const clamped = Math.max(0, Math.min(quest.progress, quest.target));
  const pct = quest.target > 0 ? Math.min(100, Math.max(0, (clamped / quest.target) * 100)) : 0;
  const CurrencyIcon = style === "scholar" ? KnowledgePointsIcon : GoldIcon;

  const doneCardClass =
    style === "game"
      ? "border-[hsl(var(--game-xp)/0.5)] bg-[hsl(var(--game-xp)/0.07)]"
      : "border-primary/45 bg-primary/5";

  const iconToneClass = quest.completed
    ? style === "game"
      ? "bg-[hsl(var(--game-xp)/0.16)] text-[hsl(var(--game-xp))]"
      : "bg-primary/15 text-primary"
    : "bg-secondary text-muted-foreground";

  const barFillClass = quest.completed
    ? style === "game"
      ? "bg-[hsl(var(--game-xp))]"
      : "bg-primary"
    : style === "game"
      ? "bg-primary"
      : "bg-primary/80";

  const rewardChipClass =
    style === "game"
      ? "border-[hsl(var(--game-gold)/0.35)] bg-[hsl(var(--game-gold)/0.1)] text-[hsl(var(--game-gold))]"
      : style === "scholar"
        ? "border-[hsl(var(--scholar-accent)/0.3)] bg-[hsl(var(--scholar-accent)/0.08)] text-[hsl(var(--scholar-accent))]"
        : "border-border/80 bg-secondary/60 text-foreground";

  return (
    <article
      data-completed={quest.completed ? "true" : "false"}
      className={cn(
        "flex flex-col justify-between gap-3.5 rounded-[14px] border border-border bg-card p-4 transition-colors sm:p-5",
        quest.completed && doneCardClass,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg border border-transparent",
              iconToneClass,
            )}
          >
            <QuestStyleIcon style={style} className="size-4.5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-snug text-foreground">{title}</h3>
            {typeof daysRemaining === "number" && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {tn("motivation.quests.daysRemaining", daysRemaining)}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            data-testid="quest-reward-chip"
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium tnum",
              rewardChipClass,
            )}
          >
            <CurrencyIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{formatQuestGold(quest.reward_gold_cents, style)}</span>
          </span>
          {quest.completed && (
            <span
              data-testid="quest-completed-badge"
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

      <div className="flex items-center gap-2.5">
        <div
          role="progressbar"
          aria-label={title}
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={quest.target}
          className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"
        >
          <div
            className={cn(
              "h-full rounded-full",
              barFillClass,
              reducedMotion ? "transition-none" : "transition-[width] duration-300",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="shrink-0 text-xs font-medium text-muted-foreground tnum">
          {t("motivation.quests.progress", {
            done: formatNumber(clamped),
            target: formatNumber(quest.target),
          })}
        </span>
      </div>
    </article>
  );
}
