import { BookOpen, Check, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { CalendarOccurrenceDto, HabitDto, HabitLogDto, TaskDto } from "@bibalak/ipc-types";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { t, tn } from "@/lib/i18n";
import { styleKey } from "@/lib/styles/styleKey";
import { cn } from "@/lib/utils";
import type { Style } from "@/stores/style";
import { isoDayDiff, scheduledHabitsForDate } from "./calendarHelpers";
import type { ExternalDropTarget } from "./timeGridTypes";

interface TimeGridAllDayStripProps {
  days: string[];
  todayDate: string;
  todayDayIndex: number;
  occurrencesByDate: Map<string, CalendarOccurrenceDto[]>;
  dueOnlyTasks: Map<string, TaskDto[]>;
  habits: HabitDto[];
  habitLogMap: Map<string, HabitLogDto>;
  forecastMap: Map<string, number>;
  style: Style;
  maxAllDayItems: number;
  allDayExpanded: boolean;
  externalDropTarget?: ExternalDropTarget | null;
  onToggleExpand: () => void;
  onNavigateDecks: () => void;
  onEditEvent: (occ: CalendarOccurrenceDto) => void;
  onDeleteOccurrence: (occ: CalendarOccurrenceDto) => void;
  onDeleteSeries: (occ: CalendarOccurrenceDto) => void;
  onScheduleTask: (task: TaskDto) => void;
  onToggleHabit: (habit: HabitDto, dateStr: string, dayIndex: number, log?: HabitLogDto) => void;
}

export function TimeGridAllDayStrip({
  days,
  todayDate,
  todayDayIndex,
  occurrencesByDate,
  dueOnlyTasks,
  habits,
  habitLogMap,
  forecastMap,
  style,
  maxAllDayItems,
  allDayExpanded,
  externalDropTarget,
  onToggleExpand,
  onNavigateDecks,
  onEditEvent,
  onDeleteOccurrence,
  onDeleteSeries,
  onScheduleTask,
  onToggleHabit,
}: TimeGridAllDayStripProps) {
  return (
    <div className="flex border-b border-border bg-card/80">
      <div className="flex w-14 shrink-0 flex-col items-center justify-between border-e border-border px-1 py-1.5 text-[10px] font-medium text-muted-foreground">
        <span className="text-center leading-tight">{t("calendar.allDay")}</span>
        {maxAllDayItems > 3 && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="mt-1 rounded px-1 py-0.5 text-[10px] text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {allDayExpanded
              ? t("calendar.allDayCollapse")
              : t("calendar.allDayExpand", { count: maxAllDayItems })}
          </button>
        )}
      </div>
      <div
        className={cn(
          "grid flex-1 overflow-y-auto [scrollbar-gutter:stable]",
          allDayExpanded ? "max-h-56" : "max-h-28",
        )}
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {days.map((dateStr) => {
          const isToday = dateStr === todayDate;
          const dayIndex = todayDayIndex + isoDayDiff(dateStr, todayDate);
          const isFuture = dayIndex > todayDayIndex;
          const dueCards = forecastMap.get(dateStr) ?? 0;
          const allDayEvents = (occurrencesByDate.get(dateStr) ?? []).filter((o) => o.is_all_day);
          const dueTasks = dueOnlyTasks.get(dateStr) ?? [];
          const dayHabits = scheduledHabitsForDate(habits, dateStr, todayDayIndex, todayDate);
          const isAllDayDropTarget =
            externalDropTarget?.isAllDay && externalDropTarget.date === dateStr;

          const items: React.ReactNode[] = [];
          if (dueCards > 0) {
            items.push(
              <button
                key={`fc-${dateStr}`}
                type="button"
                title={tn("calendar.forecast", dueCards)}
                onClick={onNavigateDecks}
                className="inline-flex w-full items-center gap-1 rounded-md bg-secondary/75 px-1.5 py-0.5 text-start text-[10px] font-medium text-secondary-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <BookOpen className="size-3 shrink-0 text-primary" aria-hidden="true" />
                <span className="tnum truncate">{tn("calendar.forecast", dueCards)}</span>
              </button>,
            );
          }
          for (const occ of allDayEvents) {
            items.push(
              <div
                key={`ad-${occ.event_id}`}
                className="group relative flex items-center justify-between gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px]"
              >
                <button
                  type="button"
                  dir="auto"
                  title={occ.title}
                  onClick={() => onEditEvent(occ)}
                  className="min-w-0 flex-1 truncate text-start font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {occ.title}
                </button>
                <ActionMenu
                  menuLabel={t("calendar.event.actionsAria", { title: occ.title })}
                  triggerAriaLabel={t("calendar.event.actionsAria", { title: occ.title })}
                  triggerVariant="ghost"
                  triggerSize="sm"
                  triggerClassName="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                  triggerContent={<MoreHorizontal className="size-3" />}
                >
                  <ActionMenuItem
                    icon={<Pencil className="size-3.5" />}
                    label={t("calendar.event.edit")}
                    onSelect={() => onEditEvent(occ)}
                  />
                  <ActionMenuSeparator />
                  {occ.is_recurring ? (
                    <>
                      <ActionMenuItem
                        icon={<Trash2 className="size-3.5" />}
                        label={t("calendar.event.deleteOccurrence")}
                        danger
                        onSelect={() => onDeleteOccurrence(occ)}
                      />
                      <ActionMenuItem
                        icon={<Trash2 className="size-3.5" />}
                        label={t("calendar.event.deleteSeries")}
                        danger
                        onSelect={() => onDeleteSeries(occ)}
                      />
                    </>
                  ) : (
                    <ActionMenuItem
                      icon={<Trash2 className="size-3.5" />}
                      label={t("calendar.event.delete")}
                      danger
                      onSelect={() => onDeleteSeries(occ)}
                    />
                  )}
                </ActionMenu>
              </div>,
            );
          }
          for (const task of dueTasks) {
            items.push(
              <button
                key={`due-${task.id}`}
                type="button"
                title={task.title}
                onClick={() => onScheduleTask(task)}
                className="flex w-full items-center gap-1 rounded-md border border-border bg-secondary/40 px-1.5 py-0.5 text-start text-[10px] hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="shrink-0 font-medium text-muted-foreground">
                  {t("calendar.dueTask")}
                </span>
                <span dir="auto" className="truncate text-foreground">
                  {task.title}
                </span>
              </button>,
            );
          }
          for (const h of dayHabits) {
            const log = habitLogMap.get(`${h.id}:${dayIndex}`);
            const isDone = Boolean(log?.completed);
            const isSkipped = log?.status === "skipped";
            items.push(
              <button
                key={`hab-${h.id}`}
                type="button"
                disabled={isFuture}
                title={h.title}
                aria-label={t("calendar.habit.toggleAria", { title: h.title })}
                aria-pressed={isDone}
                onClick={() => onToggleHabit(h, dateStr, dayIndex, log)}
                className={cn(
                  "inline-flex w-full items-center justify-between gap-1 rounded px-1.5 py-0.5 text-start text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                  isDone
                    ? "bg-good/15 text-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                )}
              >
                <span className="flex min-w-0 items-center gap-1">
                  {isDone && <Check className="size-3 shrink-0 text-good" aria-hidden="true" />}
                  <span dir="auto" title={h.title} className="min-w-0 truncate leading-snug">
                    {h.title}
                  </span>
                </span>
                {isSkipped && (
                  <span className="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground">
                    {t(styleKey("habits.status.skipped", style))}
                  </span>
                )}
              </button>,
            );
          }

          const visibleItems = allDayExpanded ? items : items.slice(0, 3);

          return (
            <div
              key={dateStr}
              data-allday-date={dateStr}
              data-testid={`calendar-allday-${dateStr}`}
              className={cn(
                "min-h-8 space-y-1 border-e border-border/60 p-1 last:border-e-0 transition-colors",
                isToday && "bg-primary/5",
                isAllDayDropTarget && "bg-primary/15 ring-1 ring-inset ring-primary",
              )}
            >
              {visibleItems}
            </div>
          );
        })}
      </div>
    </div>
  );
}
