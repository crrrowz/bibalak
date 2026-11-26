import { BookOpen } from "lucide-react";
import type { CalendarOccurrenceDto, HabitDto, TaskDto } from "@bibalak/ipc-types";
import { formatDate, t, tn } from "@/lib/i18n";
import { formatEventTimeRange, parseIsoDateLocal, scheduledHabitsForDate } from "./calendarHelpers";
import { OccurrenceRow } from "./CalendarOccurrenceRow";

interface CalendarAgendaViewProps {
  agendaDays: string[];
  todayDayIndex: number;
  backendTodayDate: string;
  occurrencesByDate: Map<string, CalendarOccurrenceDto[]>;
  tasksByDate: { timed: Map<string, TaskDto[]>; dueOnly: Map<string, TaskDto[]> };
  habits: HabitDto[];
  forecastMap: Map<string, number>;
  onNavigateDecks: () => void;
  onEditEvent: (occ: CalendarOccurrenceDto) => void;
  onDeleteOccurrence: (occ: CalendarOccurrenceDto) => void;
  onDeleteSeries: (occ: CalendarOccurrenceDto) => void;
}

export function CalendarAgendaView({
  agendaDays,
  todayDayIndex,
  backendTodayDate,
  occurrencesByDate,
  tasksByDate,
  habits,
  forecastMap,
  onNavigateDecks,
  onEditEvent,
  onDeleteOccurrence,
  onDeleteSeries,
}: CalendarAgendaViewProps) {
  const isEmpty = agendaDays.every(
    (d) =>
      (occurrencesByDate.get(d)?.length ?? 0) === 0 &&
      (tasksByDate.timed.get(d)?.length ?? 0) === 0 &&
      (tasksByDate.dueOnly.get(d)?.length ?? 0) === 0 &&
      (forecastMap.get(d) ?? 0) === 0,
  );

  return (
    <div data-testid="calendar-agenda-view" className="space-y-3">
      {isEmpty ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {t("calendar.emptyAgenda")}
        </div>
      ) : (
        agendaDays.map((dateStr) => {
          const dayEvents = occurrencesByDate.get(dateStr) ?? [];
          const timedTasks = tasksByDate.timed.get(dateStr) ?? [];
          const dueTasks = tasksByDate.dueOnly.get(dateStr) ?? [];
          const dueCards = forecastMap.get(dateStr) ?? 0;
          const dayHabits = scheduledHabitsForDate(
            habits,
            dateStr,
            todayDayIndex,
            backendTodayDate,
          );
          if (
            dayEvents.length === 0 &&
            timedTasks.length === 0 &&
            dueTasks.length === 0 &&
            dueCards === 0 &&
            dayHabits.length === 0
          ) {
            return null;
          }
          const dt = parseIsoDateLocal(dateStr);
          return (
            <section
              key={dateStr}
              className="rounded-xl border border-border bg-card p-4 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
                <h2 className="text-sm font-semibold text-foreground">
                  {formatDate(dt, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </h2>
                {dueCards > 0 && (
                  <button
                    type="button"
                    onClick={onNavigateDecks}
                    className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <BookOpen className="size-3 shrink-0 text-primary" />
                    <span className="tnum">{tn("calendar.forecast", dueCards)}</span>
                  </button>
                )}
              </div>

              <div className="space-y-1.5">
                {dayEvents.map((occ) => (
                  <OccurrenceRow
                    key={`${occ.event_id}:${occ.occurrence_date}`}
                    occ={occ}
                    onEdit={onEditEvent}
                    onDeleteOccurrence={onDeleteOccurrence}
                    onDeleteSeries={onDeleteSeries}
                  />
                ))}
                {timedTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between rounded-lg border border-easy/40 bg-easy/10 px-3 py-1.5 text-xs"
                  >
                    <span dir="auto" className="font-medium text-foreground">
                      {task.title}
                    </span>
                    {task.scheduled_start_ms !== null && task.scheduled_end_ms !== null && (
                      <span dir="ltr" className="tnum text-muted-foreground">
                        {formatEventTimeRange(task.scheduled_start_ms, task.scheduled_end_ms)}
                      </span>
                    )}
                  </div>
                ))}
                {dueTasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-xs"
                  >
                    <span className="font-medium text-muted-foreground">
                      {t("calendar.dueTask")}{" "}
                    </span>
                    <span dir="auto" className="text-foreground">
                      {task.title}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
