import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar as CalendarIcon,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  PanelRight,
  Plus,
  Undo2,
} from "lucide-react";
import type {
  CalendarEventInput,
  CalendarOccurrenceDto,
  HabitDto,
  HabitLogDto,
  TaskDto,
} from "@bibalak/ipc-types";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { errorMessage, ipc, isTauri } from "@/lib/ipc";
import { formatDate, t } from "@/lib/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { formatUndoAction } from "@/lib/undo";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";
import { cn } from "@/lib/utils";
import { useStyle } from "@/stores/style";
import { toast } from "@/stores/toast";
import { useWeekStart } from "@/stores/weekStart";
import {
  addDaysIso,
  addMonthsIso,
  buildAgendaDays,
  buildMonthGridDays,
  buildThreeDayDays,
  buildWeekDays,
  computeWindowMs,
  dateAndMinutesToMs,
  forecastByDate,
  localDateFromMs,
  localizedWeekdayOptions,
  MIN_DURATION_MINUTES,
  minutesToInputHm,
  parseIsoDateLocal,
  toIsoDateLocal,
  type CalendarViewMode,
} from "./calendarHelpers";
import { CalendarAgendaView } from "./CalendarAgendaView";
import { CalendarEventDialog } from "./CalendarEventDialog";
import { CalendarMonthView } from "./CalendarMonthView";
import { MiniMonth } from "./MiniMonth";
import { ScheduleTaskDialog } from "./ScheduleTaskDialog";
import { TimeGrid, type ExternalDropTarget } from "./TimeGrid";
import { UnscheduledDrawer } from "./UnscheduledDrawer";

const VIEW_MODES: readonly CalendarViewMode[] = ["day", "threeDay", "week", "month", "agenda"];

function isTypingOrOverlayActive(): boolean {
  const active = document.activeElement;
  if (active) {
    const tag = active.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (active.getAttribute("contenteditable") === "true") return true;
  }
  if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) {
    return true;
  }
  return false;
}

interface EventDialogState {
  open: boolean;
  defaultDate: string;
  defaultStartTime?: string;
  defaultEndTime?: string;
  occurrence: CalendarOccurrenceDto | null;
}

export function CalendarScreen() {
  const tauri = isTauri();
  const queryClient = useQueryClient();
  const navigate = useOptionalNavigate();
  const weekStart = useWeekStart((s) => s.weekStart);
  const style = useStyle((s) => s.style);

  const [view, setView] = useState<CalendarViewMode>("week");
  const [anchorOverride, setAnchorOverride] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [miniPopoverOpen, setMiniPopoverOpen] = useState(false);
  const [monthMoreDate, setMonthMoreDate] = useState<string | null>(null);
  const [eventDialogState, setEventDialogState] = useState<EventDialogState | null>(null);
  const [schedulingTask, setSchedulingTask] = useState<TaskDto | null>(null);
  const [externalDropTarget, setExternalDropTarget] = useState<ExternalDropTarget | null>(null);

  const miniPopoverRef = useRef<HTMLDivElement>(null);
  const monthMoreRef = useRef<HTMLDivElement>(null);

  const matrixQuery = useQuery({
    queryKey: [...queryKeys.matrixAll, false],
    queryFn: () => ipc.getMatrixBoard(false),
    enabled: tauri,
  });

  const habitQuery = useQuery({
    queryKey: [...queryKeys.habitsAll, weekStart],
    queryFn: () => ipc.getHabitBoard(null, weekStart),
    enabled: tauri,
  });

  const statsQuery = useQuery({
    queryKey: queryKeys.stats(null, null),
    queryFn: () => ipc.getStats(null, null),
    enabled: tauri,
  });

  const undoStatusQuery = useQuery({
    queryKey: queryKeys.undoStatus,
    queryFn: ipc.undoStatus,
    enabled: tauri,
  });

  const backendTodayDate =
    matrixQuery.data?.today_date ??
    habitQuery.data?.today_date ??
    statsQuery.data?.today_date ??
    toIsoDateLocal(new Date());

  const anchorDate = anchorOverride ?? backendTodayDate;
  const windowRange = useMemo(
    () => computeWindowMs(view, anchorDate, weekStart),
    [view, anchorDate, weekStart],
  );

  const occurrencesQuery = useQuery({
    queryKey: [...queryKeys.calendarAll, windowRange.windowStartMs, windowRange.windowEndMs],
    queryFn: () => ipc.listCalendarOccurrences(windowRange.windowStartMs, windowRange.windowEndMs),
    enabled: tauri,
  });

  const invalidateAll = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.calendarAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.matrixAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.habitsAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.undoStatus }),
      ]),
    [queryClient],
  );

  const onMutError = (err: unknown) => {
    toast.error(errorMessage(err));
  };

  const createEventMut = useMutation({
    mutationFn: (input: CalendarEventInput) => ipc.createCalendarEvent(input),
    onSuccess: () => void invalidateAll(),
  });

  const updateEventMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CalendarEventInput }) =>
      ipc.updateCalendarEvent(id, input),
    onSuccess: () => void invalidateAll(),
    onError: onMutError,
  });

  const deleteEventMut = useMutation({
    mutationFn: (id: string) => ipc.deleteCalendarEvent(id),
    onSuccess: () => void invalidateAll(),
    onError: onMutError,
  });

  const deleteOccMut = useMutation({
    mutationFn: ({ id, occurrenceDate }: { id: string; occurrenceDate: string }) =>
      ipc.deleteCalendarOccurrence(id, occurrenceDate),
    onSuccess: () => void invalidateAll(),
    onError: onMutError,
  });

  const updateTaskMut = useMutation({
    mutationFn: ({
      task,
      startMs,
      endMs,
      dueDate = task.due_date,
    }: {
      task: TaskDto;
      startMs: number | null;
      endMs: number | null;
      dueDate?: string | null;
    }) =>
      ipc.updateTask(task.id, {
        list_id: task.list_id,
        title: task.title,
        notes: task.notes,
        priority: task.priority,
        manual_quadrant: task.manual_quadrant,
        due_date: dueDate,
        scheduled_start_ms: startMs,
        scheduled_end_ms: endMs,
        tags: task.tags,
        deck_id: task.deck_id,
        sort_order: task.sort_order,
      }),
    onSuccess: () => void invalidateAll(),
    onError: onMutError,
  });

  const logHabitMut = useMutation({
    mutationFn: ({
      habit,
      dayIndex,
      log,
    }: {
      habit: HabitDto;
      dayIndex: number;
      log?: HabitLogDto;
    }) =>
      ipc.logHabit({
        habit_id: habit.id,
        day_index: dayIndex,
        logged_value: log?.completed ? 0 : habit.goal_target,
        status: "logged",
        mood: log?.mood ?? null,
        note: log?.note ?? "",
      }),
    onSuccess: () => void invalidateAll(),
    onError: onMutError,
  });

  const undoMut = useMutation({
    mutationFn: () => ipc.undo(),
    onSuccess: () => void invalidateAll(),
    onError: onMutError,
  });

  const occurrences = useMemo(() => occurrencesQuery.data ?? [], [occurrencesQuery.data]);
  const tasks = useMemo(() => matrixQuery.data?.tasks ?? [], [matrixQuery.data]);
  const habits = useMemo(() => habitQuery.data?.habits ?? [], [habitQuery.data]);
  const habitLogs = useMemo(() => habitQuery.data?.logs ?? [], [habitQuery.data]);
  const todayDayIndex = habitQuery.data?.today_day_index ?? 0;
  const forecastMap = useMemo(() => forecastByDate(statsQuery.data), [statsQuery.data]);
  const undoAction = undoStatusQuery.data ?? null;

  const unscheduledTasks = useMemo(
    () => tasks.filter((item) => item.completed_at === null && item.scheduled_start_ms === null),
    [tasks],
  );

  const occurrencesByDate = useMemo(() => {
    const map = new Map<string, CalendarOccurrenceDto[]>();
    for (const occ of occurrences) {
      const list = map.get(occ.occurrence_date) ?? [];
      list.push(occ);
      map.set(occ.occurrence_date, list);
    }
    return map;
  }, [occurrences]);

  const tasksByDate = useMemo(() => {
    const timed = new Map<string, TaskDto[]>();
    const dueOnly = new Map<string, TaskDto[]>();
    for (const task of tasks) {
      if (task.completed_at !== null) continue;
      if (task.scheduled_start_ms !== null) {
        const d = localDateFromMs(task.scheduled_start_ms);
        const list = timed.get(d) ?? [];
        list.push(task);
        timed.set(d, list);
      } else if (task.due_date) {
        const list = dueOnly.get(task.due_date) ?? [];
        list.push(task);
        dueOnly.set(task.due_date, list);
      }
    }
    return { timed, dueOnly };
  }, [tasks]);

  const stepPeriod = useCallback(
    (dir: -1 | 1) => {
      if (view === "day") {
        setAnchorOverride(addDaysIso(anchorDate, dir));
      } else if (view === "threeDay") {
        setAnchorOverride(addDaysIso(anchorDate, dir * 3));
      } else if (view === "week") {
        setAnchorOverride(addDaysIso(anchorDate, dir * 7));
      } else if (view === "month") {
        setAnchorOverride(addMonthsIso(anchorDate, dir));
      } else {
        setAnchorOverride(addDaysIso(anchorDate, dir * 14));
      }
    },
    [view, anchorDate],
  );

  const dayColumns = useMemo(() => {
    if (view === "day") return [anchorDate];
    if (view === "threeDay") return buildThreeDayDays(anchorDate);
    return buildWeekDays(anchorDate, weekStart);
  }, [view, anchorDate, weekStart]);

  const monthGrid = useMemo(
    () => buildMonthGridDays(anchorDate, weekStart),
    [anchorDate, weekStart],
  );
  const agendaDays = useMemo(() => buildAgendaDays(anchorDate, 14), [anchorDate]);
  const weekdayHeaders = useMemo(() => localizedWeekdayOptions(weekStart), [weekStart]);

  const periodTitle = useMemo(() => {
    const dt = parseIsoDateLocal(anchorDate);
    if (view === "day") {
      return formatDate(dt, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    }
    if (view === "threeDay" || view === "week") {
      const start = parseIsoDateLocal(dayColumns[0]);
      const end = parseIsoDateLocal(dayColumns[dayColumns.length - 1]);
      return `${formatDate(start, { month: "short", day: "numeric" })} – ${formatDate(end, { month: "short", day: "numeric" })}`;
    }
    if (view === "month") {
      return formatDate(dt, { month: "long", year: "numeric" });
    }
    const start = parseIsoDateLocal(agendaDays[0]);
    const end = parseIsoDateLocal(agendaDays[agendaDays.length - 1]);
    return `${formatDate(start, { month: "short", day: "numeric" })} – ${formatDate(end, { month: "short", day: "numeric" })}`;
  }, [anchorDate, view, dayColumns, agendaDays]);

  // Close non-blocking popovers on Escape or outside pointerdown.
  useEffect(() => {
    if (!miniPopoverOpen && !monthMoreDate) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (miniPopoverOpen && miniPopoverRef.current && !miniPopoverRef.current.contains(target)) {
        setMiniPopoverOpen(false);
      }
      if (monthMoreDate && monthMoreRef.current && !monthMoreRef.current.contains(target)) {
        setMonthMoreDate(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMiniPopoverOpen(false);
        setMonthMoreDate(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [miniPopoverOpen, monthMoreDate]);

  // Calendar keyboard shortcuts (spec §2.2).
  useEffect(() => {
    if (!tauri) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !isTypingOrOverlayActive()) {
          if (undoAction && !undoMut.isPending) {
            e.preventDefault();
            undoMut.mutate();
          }
        }
        return;
      }
      if (isTypingOrOverlayActive()) return;

      const lower = e.key.toLowerCase();
      if (lower === "1" || lower === "d") {
        e.preventDefault();
        setView("day");
      } else if (lower === "2") {
        e.preventDefault();
        setView("threeDay");
      } else if (lower === "3" || lower === "w") {
        e.preventDefault();
        setView("week");
      } else if (lower === "4" || lower === "m") {
        e.preventDefault();
        setView("month");
      } else if (lower === "5" || lower === "a") {
        e.preventDefault();
        setView("agenda");
      } else if (lower === "t") {
        e.preventDefault();
        setAnchorOverride(null);
      } else if (lower === "j") {
        e.preventDefault();
        stepPeriod(1);
      } else if (lower === "k") {
        e.preventDefault();
        stepPeriod(-1);
      } else if (lower === "u") {
        e.preventDefault();
        setDrawerOpen((v) => !v);
      } else if (lower === "q") {
        e.preventDefault();
        setEventDialogState({
          open: true,
          defaultDate: anchorDate,
          occurrence: null,
        });
      } else if (lower === "z") {
        if (undoAction && !undoMut.isPending) {
          e.preventDefault();
          undoMut.mutate();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tauri, anchorDate, stepPeriod, undoAction, undoMut]);

  const handleCreateSlot = useCallback((dateStr: string, startMin: number, endMin: number) => {
    setEventDialogState({
      open: true,
      defaultDate: dateStr,
      defaultStartTime: minutesToInputHm(startMin),
      defaultEndTime: minutesToInputHm(Math.max(startMin + MIN_DURATION_MINUTES, endMin)),
      occurrence: null,
    });
  }, []);

  const commitEventMoveOrResize = useCallback(
    (occ: CalendarOccurrenceDto, targetDate: string, startMin: number, endMin: number) => {
      if (occ.is_recurring) {
        setEventDialogState({
          open: true,
          defaultDate: targetDate,
          defaultStartTime: minutesToInputHm(startMin),
          defaultEndTime: minutesToInputHm(endMin),
          occurrence: occ,
        });
        return;
      }
      updateEventMut.mutate({
        id: occ.event_id,
        input: {
          title: occ.title,
          description: occ.description,
          location: occ.location,
          color_token: occ.color_token,
          start_ms: dateAndMinutesToMs(targetDate, startMin),
          end_ms: dateAndMinutesToMs(targetDate, endMin),
          is_all_day: false,
          recurrence: occ.recurrence,
          linked_task_id: occ.linked_task_id,
        },
      });
    },
    [updateEventMut],
  );

  const commitTaskMoveOrResize = useCallback(
    (task: TaskDto, targetDate: string, startMin: number, endMin: number) => {
      updateTaskMut.mutate({
        task,
        startMs: dateAndMinutesToMs(targetDate, startMin),
        endMs: dateAndMinutesToMs(targetDate, endMin),
      });
    },
    [updateTaskMut],
  );

  const handleDropTaskOnSlot = useCallback(
    (task: TaskDto, dateStr: string, startMin: number) => {
      const endMin = Math.min(24 * 60, startMin + 60);
      const effectiveStart = Math.min(startMin, endMin - MIN_DURATION_MINUTES);
      updateTaskMut.mutate({
        task,
        startMs: dateAndMinutesToMs(dateStr, effectiveStart),
        endMs: dateAndMinutesToMs(dateStr, endMin),
      });
    },
    [updateTaskMut],
  );

  const handleDropTaskOnAllDay = useCallback(
    (task: TaskDto, dateStr: string) => {
      updateTaskMut.mutate({
        task,
        startMs: null,
        endMs: null,
        dueDate: dateStr,
      });
    },
    [updateTaskMut],
  );

  const isLoading =
    tauri &&
    (occurrencesQuery.isLoading || matrixQuery.isLoading || habitQuery.isLoading) &&
    !occurrencesQuery.data;

  const hasError = occurrencesQuery.isError || matrixQuery.isError || habitQuery.isError;

  return (
    <div className="relative flex h-full flex-col">
      <ScreenHeader
        title={t("calendar.title")}
        description={t("calendar.description")}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => undoMut.mutate()}
              disabled={!tauri || undoMut.isPending || !undoAction}
              title={
                undoAction
                  ? t("decks.undoAction", { action: formatUndoAction(undoAction) })
                  : t("decks.undoEmpty")
              }
            >
              <Undo2 /> {t("decks.undo")}
            </Button>
            <Button
              size="sm"
              disabled={!tauri}
              onClick={() =>
                setEventDialogState({
                  open: true,
                  defaultDate: anchorDate,
                  occurrence: null,
                })
              }
            >
              <Plus /> {t("calendar.newEvent")}
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {!tauri ? (
          <EmptyState
            icon={CalendarIcon}
            title={t("calendar.noTauri.title")}
            description={t("calendar.noTauri.description")}
          />
        ) : hasError ? (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-destructive/40 bg-card p-6 text-sm text-destructive">
            <span>{t("calendar.error")}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void occurrencesQuery.refetch();
                void matrixQuery.refetch();
                void habitQuery.refetch();
              }}
            >
              {t("calendar.retry")}
            </Button>
          </div>
        ) : (
          <div className="mx-auto max-w-7xl space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2.5">
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t("calendar.prev")}
                  onClick={() => stepPeriod(-1)}
                >
                  <ChevronLeft className="size-4 rtl:-scale-x-100" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAnchorOverride(null)}
                >
                  {t("calendar.today")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t("calendar.next")}
                  onClick={() => stepPeriod(1)}
                >
                  <ChevronRight className="size-4 rtl:-scale-x-100" />
                </Button>
                <span className="ms-2 text-sm font-semibold text-foreground">{periodTitle}</span>

                {/* Mini-month popover trigger below lg (or when drawer closed) */}
                <div className={cn("relative", drawerOpen && "lg:hidden")} ref={miniPopoverRef}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t("calendar.datePicker")}
                    aria-expanded={miniPopoverOpen}
                    onClick={() => setMiniPopoverOpen((v) => !v)}
                    className="ms-1 h-7 px-2"
                  >
                    <CalendarDays className="size-4" />
                  </Button>
                  {miniPopoverOpen && (
                    <div className="glass-panel absolute start-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-border bg-card p-3 shadow-lg">
                      <MiniMonth
                        anchorDate={anchorDate}
                        todayDate={backendTodayDate}
                        view={view}
                        weekStart={weekStart}
                        onSelectDate={(dateStr) => {
                          setAnchorOverride(dateStr);
                          setMiniPopoverOpen(false);
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary/50 p-0.5">
                  {VIEW_MODES.map((mode) => (
                    <Button
                      key={mode}
                      type="button"
                      size="sm"
                      variant={view === mode ? "default" : "ghost"}
                      aria-pressed={view === mode}
                      onClick={() => setView(mode)}
                      className="h-7 px-2.5 text-xs"
                    >
                      {t(`calendar.view.${mode}`)}
                    </Button>
                  ))}
                </div>

                <Button
                  type="button"
                  variant={drawerOpen ? "secondary" : "outline"}
                  size="sm"
                  aria-pressed={drawerOpen}
                  onClick={() => setDrawerOpen((v) => !v)}
                  className="h-8 gap-1.5 px-2.5 text-xs"
                >
                  <PanelRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
                  <span>{t("calendar.unscheduledToggle")}</span>
                </Button>
              </div>
            </div>

            {/* Main area + Unscheduled tasks drawer */}
            <div className={cn("grid grid-cols-1 gap-4", drawerOpen && "lg:grid-cols-[1fr_280px]")}>
              <div className="min-w-0">
                {(view === "day" || view === "threeDay" || view === "week") && (
                  <TimeGrid
                    days={dayColumns}
                    todayDate={backendTodayDate}
                    todayDayIndex={todayDayIndex}
                    occurrencesByDate={occurrencesByDate}
                    tasksByDate={tasksByDate}
                    habits={habits}
                    habitLogs={habitLogs}
                    forecastMap={forecastMap}
                    style={style}
                    isLoading={isLoading}
                    externalDropTarget={externalDropTarget}
                    onCreateSlot={handleCreateSlot}
                    onMoveEvent={commitEventMoveOrResize}
                    onResizeEvent={(occ, startMin, endMin) =>
                      commitEventMoveOrResize(occ, occ.occurrence_date, startMin, endMin)
                    }
                    onEditEvent={(occ) =>
                      setEventDialogState({
                        open: true,
                        defaultDate: occ.occurrence_date,
                        occurrence: occ,
                      })
                    }
                    onDeleteOccurrence={(occ) =>
                      deleteOccMut.mutate({
                        id: occ.event_id,
                        occurrenceDate: occ.occurrence_date,
                      })
                    }
                    onDeleteSeries={(occ) => deleteEventMut.mutate(occ.event_id)}
                    onMoveTask={commitTaskMoveOrResize}
                    onResizeTask={(task, startMin, endMin) => {
                      const dateStr =
                        task.scheduled_start_ms !== null
                          ? localDateFromMs(task.scheduled_start_ms)
                          : backendTodayDate;
                      commitTaskMoveOrResize(task, dateStr, startMin, endMin);
                    }}
                    onScheduleTask={(task) => setSchedulingTask(task)}
                    onToggleHabit={(habit, _dateStr, dayIndex, log) =>
                      logHabitMut.mutate({ habit, dayIndex, log })
                    }
                    onNavigateDecks={() => navigate?.("/")}
                  />
                )}

                {view === "month" && (
                  <CalendarMonthView
                    weekdayHeaders={weekdayHeaders}
                    monthGrid={monthGrid}
                    backendTodayDate={backendTodayDate}
                    occurrencesByDate={occurrencesByDate}
                    tasksByDate={tasksByDate}
                    forecastMap={forecastMap}
                    monthMoreDate={monthMoreDate}
                    monthMoreRef={monthMoreRef}
                    onCreateEvent={(dateStr) =>
                      setEventDialogState({
                        open: true,
                        defaultDate: dateStr,
                        occurrence: null,
                      })
                    }
                    onEditEvent={(occ) =>
                      setEventDialogState({
                        open: true,
                        defaultDate: occ.occurrence_date,
                        occurrence: occ,
                      })
                    }
                    onScheduleTask={(task) => setSchedulingTask(task)}
                    onNavigateDecks={() => navigate?.("/")}
                    onSetMonthMoreDate={setMonthMoreDate}
                  />
                )}

                {view === "agenda" && (
                  <CalendarAgendaView
                    agendaDays={agendaDays}
                    todayDayIndex={todayDayIndex}
                    backendTodayDate={backendTodayDate}
                    occurrencesByDate={occurrencesByDate}
                    tasksByDate={tasksByDate}
                    habits={habits}
                    forecastMap={forecastMap}
                    onNavigateDecks={() => navigate?.("/")}
                    onEditEvent={(occ) =>
                      setEventDialogState({
                        open: true,
                        defaultDate: occ.occurrence_date,
                        occurrence: occ,
                      })
                    }
                    onDeleteOccurrence={(occ) =>
                      deleteOccMut.mutate({
                        id: occ.event_id,
                        occurrenceDate: occ.occurrence_date,
                      })
                    }
                    onDeleteSeries={(occ) => deleteEventMut.mutate(occ.event_id)}
                  />
                )}
              </div>

              {drawerOpen && (
                <UnscheduledDrawer
                  tasks={unscheduledTasks}
                  anchorDate={anchorDate}
                  todayDate={backendTodayDate}
                  view={view}
                  weekStart={weekStart}
                  onSelectDate={(dateStr) => setAnchorOverride(dateStr)}
                  onOpenScheduleDialog={(task) => setSchedulingTask(task)}
                  onDropTaskOnSlot={handleDropTaskOnSlot}
                  onDropTaskOnAllDay={handleDropTaskOnAllDay}
                  onExternalDropTargetChange={setExternalDropTarget}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {eventDialogState && (
        <CalendarEventDialog
          key={`${eventDialogState.occurrence?.event_id ?? "new"}-${eventDialogState.defaultDate}-${eventDialogState.defaultStartTime ?? ""}`}
          open={eventDialogState.open}
          defaultDate={eventDialogState.defaultDate}
          defaultStartTime={eventDialogState.defaultStartTime}
          defaultEndTime={eventDialogState.defaultEndTime}
          occurrence={eventDialogState.occurrence}
          onSave={async (input) => {
            if (eventDialogState.occurrence) {
              await updateEventMut.mutateAsync({
                id: eventDialogState.occurrence.event_id,
                input,
              });
            } else {
              await createEventMut.mutateAsync(input);
            }
          }}
          onClose={() => setEventDialogState(null)}
        />
      )}

      {schedulingTask && (
        <ScheduleTaskDialog
          key={schedulingTask.id}
          open={true}
          task={schedulingTask}
          defaultDate={backendTodayDate}
          onSchedule={async (task, startMs, endMs) => {
            await updateTaskMut.mutateAsync({ task, startMs, endMs });
          }}
          onClose={() => setSchedulingTask(null)}
        />
      )}
    </div>
  );
}
