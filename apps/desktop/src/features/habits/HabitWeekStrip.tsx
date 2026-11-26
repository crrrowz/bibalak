import { useRef } from "react";
import { Check, ChevronLeft, ChevronRight, Minus } from "lucide-react";
import type { HabitDayRingDto, HabitLogDto } from "@bibalak/ipc-types";
import { FrostShieldIcon } from "@/components/icons/game";
import { Button } from "@/components/ui/button";
import { formatDate, t, tn } from "@/lib/i18n";
import type { PresentationStyleOrGame } from "@/lib/styles/styleKey";
import { cn } from "@/lib/utils";
import { parseIsoDateLocal } from "./habitHelpers";

const RING_RADIUS = 10;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function DayRingSvg({ day, frozenCount }: { day: HabitDayRingDto; frozenCount: number }) {
  const ratio = Math.min(1, Math.max(0, day.completion_ratio));
  const dashOffset = RING_CIRCUMFERENCE * (1 - ratio);
  const isComplete = ratio >= 1 && day.scheduled_count > 0;
  const isExcusedOnly = day.scheduled_count === 0 && day.excused_count > 0;
  const isFrozenOnly = isExcusedOnly && frozenCount > 0 && frozenCount >= day.excused_count;
  const isEmpty = ratio <= 0 && !isExcusedOnly;

  return (
    <div
      data-testid={`habit-ring-${day.day_index}`}
      data-ratio={String(day.completion_ratio)}
      data-excused={String(day.excused_count)}
      data-frozen={String(frozenCount)}
      className="relative flex size-7 items-center justify-center"
    >
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <circle
          cx="14"
          cy="14"
          r={RING_RADIUS}
          fill={
            isComplete
              ? "hsl(var(--good))"
              : isFrozenOnly
                ? "hsl(var(--game-freeze) / 0.15)"
                : isExcusedOnly
                  ? "hsl(var(--muted))"
                  : "none"
          }
          stroke={
            isComplete
              ? "hsl(var(--good))"
              : isFrozenOnly
                ? "hsl(var(--game-freeze))"
                : "hsl(var(--muted-foreground))"
          }
          strokeWidth="2.5"
          strokeDasharray={isEmpty ? "3 3" : undefined}
          opacity={
            isEmpty ? 0.45 : isFrozenOnly ? 0.9 : isExcusedOnly ? 0.6 : isComplete ? 1 : 0.25
          }
        />
        {!isEmpty && !isComplete && !isExcusedOnly && (
          <circle
            cx="14"
            cy="14"
            r={RING_RADIUS}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 14 14)"
          />
        )}
      </svg>
      {isComplete && <Check className="absolute size-3.5 text-white" aria-hidden="true" />}
      {isFrozenOnly && (
        <FrostShieldIcon
          className="absolute size-3 text-[hsl(var(--game-freeze))]"
          aria-hidden="true"
        />
      )}
      {isExcusedOnly && !isFrozenOnly && (
        <Minus className="absolute size-3 text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}

interface HabitWeekStripProps {
  weekDays: HabitDayRingDto[];
  logs?: HabitLogDto[];
  todayDayIndex: number;
  selectedDayIndex: number | null;
  style?: PresentationStyleOrGame;
  onSelectDay: (dayIndex: number) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onThisWeek: () => void;
}

export function HabitWeekStrip({
  weekDays,
  logs = [],
  todayDayIndex,
  selectedDayIndex,
  style = "default",
  onSelectDay,
  onPrevWeek,
  onNextWeek,
  onThisWeek,
}: HabitWeekStripProps) {
  const dayButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const firstDay = weekDays[0];
  const lastDay = weekDays[weekDays.length - 1];
  const rangeLabel =
    firstDay && lastDay
      ? `${formatDate(parseIsoDateLocal(firstDay.date), { month: "short", day: "numeric" })} – ${formatDate(parseIsoDateLocal(lastDay.date), { month: "short", day: "numeric" })}`
      : "";

  const handleStripKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const isRtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
    const step = (e.key === "ArrowRight" ? 1 : -1) * (isRtl ? -1 : 1);
    const nextIdx = Math.max(0, Math.min(weekDays.length - 1, idx + step));
    dayButtonRefs.current[nextIdx]?.focus();
  };

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t("habits.prevWeek")}
            onClick={onPrevWeek}
          >
            <ChevronLeft className="size-4 rtl:-scale-x-100" />
          </Button>

          <Button type="button" variant="outline" size="sm" onClick={onThisWeek}>
            {t("habits.thisWeek")}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t("habits.nextWeek")}
            onClick={onNextWeek}
          >
            <ChevronRight className="size-4 rtl:-scale-x-100" />
          </Button>
        </div>

        {rangeLabel && (
          <span className="tnum text-xs font-medium text-muted-foreground">{rangeLabel}</span>
        )}
      </div>

      <div data-testid="habit-week-strip" className="grid grid-cols-7 gap-1.5">
        {weekDays.map((day, idx) => {
          const dt = parseIsoDateLocal(day.date);
          const weekdayLabel = formatDate(dt, { weekday: "short" });
          const dayNumLabel = formatDate(dt, { day: "numeric" });
          const isToday = day.day_index === todayDayIndex;
          const isSelected = day.day_index === selectedDayIndex;
          const isFuture = day.day_index > todayDayIndex;
          const dayLogs = logs.filter((l) => l.day_index === day.day_index);
          const loggedFrozen = dayLogs.filter((l) => l.status === "frozen").length;
          const loggedSkipped = dayLogs.filter((l) => l.status === "skipped").length;
          const hasExcusedLogs = loggedFrozen + loggedSkipped > 0;
          const frozenCount = style === "game" ? loggedFrozen : 0;
          const skippedCount = hasExcusedLogs
            ? loggedSkipped + (style === "game" ? 0 : loggedFrozen)
            : Math.max(0, day.excused_count - frozenCount);

          const tooltipParts: string[] = [];
          if (skippedCount > 0) {
            tooltipParts.push(
              tn(
                style === "scholar" ? "habits.strip.excused.scholar" : "habits.strip.excused",
                skippedCount,
              ),
            );
          }
          if (frozenCount > 0) {
            tooltipParts.push(tn("habits.strip.frozen", frozenCount));
          }
          const excusedTitle =
            tooltipParts.length > 0
              ? `${formatDate(dt, { dateStyle: "medium" })} — ${tooltipParts.join(" · ")}`
              : undefined;

          return (
            <button
              key={day.day_index}
              ref={(el) => {
                dayButtonRefs.current[idx] = el;
              }}
              type="button"
              data-testid={`habit-day-${day.day_index}`}
              aria-pressed={isSelected}
              title={excusedTitle}
              onClick={() => onSelectDay(day.day_index)}
              onKeyDown={(e) => handleStripKeyDown(e, idx)}
              className={cn(
                "flex min-w-0 flex-col items-center gap-1 rounded-lg border px-1 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "border-primary bg-primary/10 text-foreground"
                  : isToday
                    ? "border-primary/40 bg-secondary/40 text-foreground hover:bg-accent"
                    : "border-transparent hover:bg-accent/60",
                isFuture && "opacity-65",
              )}
            >
              <span className="text-[11px] font-medium text-muted-foreground">{weekdayLabel}</span>
              <span className="tnum text-xs font-semibold text-foreground">{dayNumLabel}</span>
              <DayRingSvg day={day} frozenCount={frozenCount} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
