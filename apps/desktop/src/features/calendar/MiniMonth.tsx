import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { WeekStart } from "@bibalak/ipc-types";
import { formatDate, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  addMonthsIso,
  buildMonthGridDays,
  buildThreeDayDays,
  buildWeekDays,
  localizedWeekdayOptions,
  parseIsoDateLocal,
  type CalendarViewMode,
} from "./calendarHelpers";

interface MiniMonthProps {
  anchorDate: string;
  todayDate: string;
  view: CalendarViewMode;
  weekStart: WeekStart;
  onSelectDate: (dateStr: string) => void;
  className?: string;
}

export function MiniMonth({
  anchorDate,
  todayDate,
  view,
  weekStart,
  onSelectDate,
  className,
}: MiniMonthProps) {
  const [displayAnchor, setDisplayAnchor] = useState(anchorDate);
  const prevAnchorMonth = useRef(anchorDate.slice(0, 7));

  useEffect(() => {
    const nextMonth = anchorDate.slice(0, 7);
    if (nextMonth !== prevAnchorMonth.current) {
      prevAnchorMonth.current = nextMonth;
      setDisplayAnchor(anchorDate);
    }
  }, [anchorDate]);

  const monthGrid = useMemo(
    () => buildMonthGridDays(displayAnchor, weekStart),
    [displayAnchor, weekStart],
  );
  const weekdayHeaders = useMemo(() => localizedWeekdayOptions(weekStart, "narrow"), [weekStart]);

  const visibleSpan = useMemo(() => {
    if (view === "day") return new Set([anchorDate]);
    if (view === "threeDay") return new Set(buildThreeDayDays(anchorDate));
    if (view === "week") return new Set(buildWeekDays(anchorDate, weekStart));
    return new Set([anchorDate]);
  }, [anchorDate, view, weekStart]);

  const monthTitle = formatDate(parseIsoDateLocal(displayAnchor), {
    month: "short",
    year: "numeric",
  });

  return (
    <div
      data-testid="calendar-mini-month"
      aria-label={t("calendar.miniMonth.label")}
      className={cn("space-y-2", className)}
    >
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          aria-label={t("calendar.miniMonth.prevMonth")}
          onClick={() => setDisplayAnchor((prev) => addMonthsIso(prev, -1))}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
        </button>
        <span className="text-xs font-semibold text-foreground">{monthTitle}</span>
        <button
          type="button"
          aria-label={t("calendar.miniMonth.nextMonth")}
          onClick={() => setDisplayAnchor((prev) => addMonthsIso(prev, 1))}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium text-muted-foreground">
        {weekdayHeaders.map((wd) => (
          <div key={wd.iso} className="py-0.5">
            {wd.label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {monthGrid.days.map((dateStr) => {
          const dt = parseIsoDateLocal(dateStr);
          const inMonth = dateStr.startsWith(monthGrid.monthPrefix);
          const isToday = dateStr === todayDate;
          const isAnchor = dateStr === anchorDate;
          const inSpan = visibleSpan.has(dateStr);

          return (
            <button
              key={dateStr}
              type="button"
              data-mini-date={dateStr}
              aria-current={isAnchor ? "date" : undefined}
              onClick={() => onSelectDate(dateStr)}
              className={cn(
                "tnum flex h-7 items-center justify-center rounded-md text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isAnchor
                  ? "bg-primary font-semibold text-primary-foreground"
                  : inSpan
                    ? "bg-primary/15 font-medium text-foreground hover:bg-primary/25"
                    : "hover:bg-accent",
                !isAnchor && isToday && "ring-1 ring-primary text-primary font-semibold",
                !inMonth && !isAnchor && "text-muted-foreground/45",
              )}
            >
              {formatDate(dt, { day: "numeric" })}
            </button>
          );
        })}
      </div>
    </div>
  );
}
