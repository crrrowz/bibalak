import type { RefObject } from "react";
import { X } from "lucide-react";
import type { CalendarOccurrenceDto, TaskDto } from "@bibalak/ipc-types";
import { formatDate, formatNumber, t, tn } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { parseIsoDateLocal } from "./calendarHelpers";

interface CalendarMonthViewProps {
  weekdayHeaders: Array<{ iso: number; label: string }>;
  monthGrid: { days: string[]; monthPrefix: string };
  backendTodayDate: string;
  occurrencesByDate: Map<string, CalendarOccurrenceDto[]>;
  tasksByDate: { timed: Map<string, TaskDto[]>; dueOnly: Map<string, TaskDto[]> };
  forecastMap: Map<string, number>;
  monthMoreDate: string | null;
  monthMoreRef: RefObject<HTMLDivElement | null>;
  onCreateEvent: (dateStr: string) => void;
  onEditEvent: (occ: CalendarOccurrenceDto) => void;
  onScheduleTask: (task: TaskDto) => void;
  onNavigateDecks: () => void;
  onSetMonthMoreDate: (dateStr: string | null) => void;
}

export function CalendarMonthView({
  weekdayHeaders,
  monthGrid,
  backendTodayDate,
  occurrencesByDate,
  tasksByDate,
  forecastMap,
  monthMoreDate,
  monthMoreRef,
  onCreateEvent,
  onEditEvent,
  onScheduleTask,
  onNavigateDecks,
  onSetMonthMoreDate,
}: CalendarMonthViewProps) {
  return (
    <div data-testid="calendar-month-view" className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
        {weekdayHeaders.map((wd) => (
          <div key={wd.iso} className="py-1">
            {wd.label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {monthGrid.days.map((dateStr) => {
          const dt = parseIsoDateLocal(dateStr);
          const inMonth = dateStr.startsWith(monthGrid.monthPrefix);
          const isToday = dateStr === backendTodayDate;
          const dayEvents = occurrencesByDate.get(dateStr) ?? [];
          const timedTasks = tasksByDate.timed.get(dateStr) ?? [];
          const dueTasks = tasksByDate.dueOnly.get(dateStr) ?? [];
          const dueCards = forecastMap.get(dateStr) ?? 0;

          type MonthChip =
            | { key: string; kind: "event"; occ: CalendarOccurrenceDto }
            | { key: string; kind: "task"; task: TaskDto };
          const allItems: MonthChip[] = [
            ...dayEvents.map((occ) => ({
              key: `ev-${occ.event_id}-${occ.occurrence_date}`,
              kind: "event" as const,
              occ,
            })),
            ...timedTasks.map((task) => ({
              key: `tt-${task.id}`,
              kind: "task" as const,
              task,
            })),
            ...dueTasks.map((task) => ({
              key: `dt-${task.id}`,
              kind: "task" as const,
              task,
            })),
          ];
          const visibleItems = allItems.slice(0, 3);
          const overflowCount = allItems.length - visibleItems.length;
          const isMoreOpen = monthMoreDate === dateStr;

          return (
            <div
              key={dateStr}
              data-testid={`calendar-month-cell-${dateStr}`}
              onClick={() => onCreateEvent(dateStr)}
              className={cn(
                "relative min-h-[96px] min-w-0 cursor-pointer rounded-lg border p-1.5 text-xs transition-colors hover:border-primary/40",
                isToday ? "border-primary bg-primary/5" : "border-border/70 bg-background/40",
                !inMonth && "opacity-45",
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cn("tnum font-semibold", isToday ? "text-primary" : "text-foreground")}
                >
                  {formatDate(dt, { day: "numeric" })}
                </span>
                {dueCards > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateDecks();
                    }}
                    className="tnum rounded bg-secondary px-1 text-[10px] text-muted-foreground hover:text-foreground"
                    title={tn("calendar.forecast", dueCards)}
                  >
                    {formatNumber(dueCards)}
                  </button>
                )}
              </div>

              <div className="space-y-0.5">
                {visibleItems.map((chip) =>
                  chip.kind === "event" ? (
                    <button
                      key={chip.key}
                      type="button"
                      dir="auto"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditEvent(chip.occ);
                      }}
                      className="block w-full truncate rounded bg-primary/15 px-1 py-0.5 text-start text-[10px] font-medium text-foreground hover:bg-primary/25"
                    >
                      {chip.occ.title}
                    </button>
                  ) : (
                    <button
                      key={chip.key}
                      type="button"
                      dir="auto"
                      onClick={(e) => {
                        e.stopPropagation();
                        onScheduleTask(chip.task);
                      }}
                      className="block w-full truncate rounded bg-easy/15 px-1 py-0.5 text-start text-[10px] text-foreground hover:bg-easy/25"
                    >
                      {chip.task.title}
                    </button>
                  ),
                )}
                {overflowCount > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetMonthMoreDate(isMoreOpen ? null : dateStr);
                    }}
                    className="block w-full rounded px-1 py-0.5 text-start text-[10px] font-medium text-primary hover:bg-primary/10"
                  >
                    {t("calendar.month.more", { count: overflowCount })}
                  </button>
                )}
              </div>

              {isMoreOpen && (
                <div
                  ref={monthMoreRef}
                  data-testid="calendar-month-more-popover"
                  onClick={(e) => e.stopPropagation()}
                  className="glass-panel absolute start-0 top-full z-30 mt-1 w-56 rounded-xl border border-border bg-card p-2.5 shadow-lg space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-1">
                    <span className="text-[11px] font-semibold text-foreground">
                      {t("calendar.month.moreTitle", {
                        date: formatDate(dt, { month: "short", day: "numeric" }),
                      })}
                    </span>
                    <button
                      type="button"
                      aria-label={t("common.close")}
                      onClick={() => onSetMonthMoreDate(null)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {allItems.map((chip) =>
                      chip.kind === "event" ? (
                        <button
                          key={chip.key}
                          type="button"
                          dir="auto"
                          onClick={() => {
                            onSetMonthMoreDate(null);
                            onEditEvent(chip.occ);
                          }}
                          className="block w-full truncate rounded bg-primary/15 px-1.5 py-1 text-start text-[11px] font-medium text-foreground hover:bg-primary/25"
                        >
                          {chip.occ.title}
                        </button>
                      ) : (
                        <button
                          key={chip.key}
                          type="button"
                          dir="auto"
                          onClick={() => {
                            onSetMonthMoreDate(null);
                            onScheduleTask(chip.task);
                          }}
                          className="block w-full truncate rounded bg-easy/15 px-1.5 py-1 text-start text-[11px] text-foreground hover:bg-easy/25"
                        >
                          {chip.task.title}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
