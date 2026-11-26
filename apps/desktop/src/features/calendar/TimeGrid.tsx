import { useEffect, useMemo, useRef, useState } from "react";
import type { CalendarOccurrenceDto, HabitDto, HabitLogDto, TaskDto } from "@bibalak/ipc-types";
import { formatDate, t, textDirection } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Style } from "@/stores/style";
import {
  formatMinutesRange,
  HOUR_HEIGHT_PX,
  layoutDayBlocks,
  MIN_DURATION_MINUTES,
  msToMinutesSinceMidnight,
  parseIsoDateLocal,
  scheduledHabitsForDate,
  snapMinutes,
  snapMinutesAllowEnd,
  type TimedLayoutItem,
} from "./calendarHelpers";
import { TimeGridAllDayStrip } from "./TimeGridAllDayStrip";
import { TimeGridBlock } from "./TimeGridBlock";
import type { ExternalDropTarget, TimedBlock } from "./timeGridTypes";

export type { ExternalDropTarget } from "./timeGridTypes";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DRAG_THRESHOLD_PX = 4;

type DragSession =
  | {
      mode: "pending-create";
      pointerId: number;
      startX: number;
      startY: number;
      date: string;
      colTop: number;
      anchorMin: number;
    }
  | {
      mode: "creating";
      pointerId: number;
      date: string;
      colTop: number;
      anchorMin: number;
      startMin: number;
      endMin: number;
    }
  | {
      mode: "pending-move";
      pointerId: number;
      startX: number;
      startY: number;
      block: TimedBlock;
      sourceDate: string;
      grabOffsetPx: number;
    }
  | {
      mode: "moving";
      pointerId: number;
      block: TimedBlock;
      sourceDate: string;
      targetDate: string;
      grabOffsetPx: number;
      startMin: number;
      endMin: number;
    }
  | {
      mode: "pending-resize";
      pointerId: number;
      startX: number;
      startY: number;
      block: TimedBlock;
      date: string;
      edge: "top" | "bottom";
      colTop: number;
    }
  | {
      mode: "resizing";
      pointerId: number;
      block: TimedBlock;
      date: string;
      edge: "top" | "bottom";
      colTop: number;
      startMin: number;
      endMin: number;
    };

export interface TimeGridProps {
  days: string[];
  todayDate: string;
  todayDayIndex: number;
  occurrencesByDate: Map<string, CalendarOccurrenceDto[]>;
  tasksByDate: { timed: Map<string, TaskDto[]>; dueOnly: Map<string, TaskDto[]> };
  habits: HabitDto[];
  habitLogs: HabitLogDto[];
  forecastMap: Map<string, number>;
  style: Style;
  isLoading?: boolean;
  externalDropTarget?: ExternalDropTarget | null;
  onCreateSlot: (dateStr: string, startMin: number, endMin: number) => void;
  onMoveEvent: (
    occ: CalendarOccurrenceDto,
    targetDate: string,
    startMin: number,
    endMin: number,
  ) => void;
  onResizeEvent: (occ: CalendarOccurrenceDto, startMin: number, endMin: number) => void;
  onEditEvent: (occ: CalendarOccurrenceDto) => void;
  onDeleteOccurrence: (occ: CalendarOccurrenceDto) => void;
  onDeleteSeries: (occ: CalendarOccurrenceDto) => void;
  onMoveTask: (task: TaskDto, targetDate: string, startMin: number, endMin: number) => void;
  onResizeTask: (task: TaskDto, startMin: number, endMin: number) => void;
  onScheduleTask: (task: TaskDto) => void;
  onToggleHabit: (habit: HabitDto, dateStr: string, dayIndex: number, log?: HabitLogDto) => void;
  onNavigateDecks: () => void;
}

function currentMinutesNow(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function TimeGrid({
  days,
  todayDate,
  todayDayIndex,
  occurrencesByDate,
  tasksByDate,
  habits,
  habitLogs,
  forecastMap,
  style,
  isLoading = false,
  externalDropTarget = null,
  onCreateSlot,
  onMoveEvent,
  onResizeEvent,
  onEditEvent,
  onDeleteOccurrence,
  onDeleteSeries,
  onMoveTask,
  onResizeTask,
  onScheduleTask,
  onToggleHabit,
  onNavigateDecks,
}: TimeGridProps) {
  const gridRootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowMinutes, setNowMinutes] = useState<number>(currentMinutesNow);
  const [allDayExpanded, setAllDayExpanded] = useState(false);
  const [drag, setDrag] = useState<DragSession | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dragRef = useRef<DragSession | null>(null);
  dragRef.current = drag;

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMinutes(currentMinutesNow());
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const habitLogMap = useMemo(() => {
    const map = new Map<string, HabitLogDto>();
    for (const log of habitLogs) {
      map.set(`${log.habit_id}:${log.day_index}`, log);
    }
    return map;
  }, [habitLogs]);

  const blocksByDate = useMemo(() => {
    const map = new Map<string, TimedBlock[]>();
    for (const dateStr of days) {
      const list: TimedBlock[] = [];
      for (const occ of occurrencesByDate.get(dateStr) ?? []) {
        if (occ.is_all_day) continue;
        const startMin = msToMinutesSinceMidnight(occ.start_ms, dateStr);
        const rawEnd = msToMinutesSinceMidnight(occ.end_ms, dateStr);
        const endMin = Math.max(startMin + MIN_DURATION_MINUTES, rawEnd);
        list.push({
          kind: "event",
          id: occ.event_id,
          occ,
          title: occ.title,
          startMs: occ.start_ms,
          endMs: occ.end_ms,
          startMin,
          endMin,
          isRecurring: occ.is_recurring,
        });
      }
      for (const task of tasksByDate.timed.get(dateStr) ?? []) {
        if (task.scheduled_start_ms === null || task.scheduled_end_ms === null) continue;
        const startMin = msToMinutesSinceMidnight(task.scheduled_start_ms, dateStr);
        const rawEnd = msToMinutesSinceMidnight(task.scheduled_end_ms, dateStr);
        const endMin = Math.max(startMin + MIN_DURATION_MINUTES, rawEnd);
        list.push({
          kind: "task",
          id: task.id,
          task,
          title: task.title,
          startMs: task.scheduled_start_ms,
          endMs: task.scheduled_end_ms,
          startMin,
          endMin,
          isRecurring: false,
        });
      }
      map.set(dateStr, list);
    }
    return map;
  }, [days, occurrencesByDate, tasksByDate]);

  const laidOutByDate = useMemo(() => {
    const map = new Map<string, TimedLayoutItem<TimedBlock>[]>();
    for (const dateStr of days) {
      map.set(dateStr, layoutDayBlocks(blocksByDate.get(dateStr) ?? []));
    }
    return map;
  }, [days, blocksByDate]);

  const hasAnyTimedItems = useMemo(
    () => days.some((d) => (blocksByDate.get(d)?.length ?? 0) > 0),
    [days, blocksByDate],
  );

  // Scroll near 07:00 (or earliest visible timed block if earlier, clamped >= 05:00).
  const daysKey = days.join(",");
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let earliestMin = 7 * 60;
    for (const dateStr of days) {
      for (const b of blocksByDate.get(dateStr) ?? []) {
        if (b.startMin < earliestMin) earliestMin = b.startMin;
      }
    }
    const targetHour = Math.max(5, Math.min(7, Math.floor(earliestMin / 60)));
    el.scrollTop = targetHour * HOUR_HEIGHT_PX;
  }, [daysKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const findColumnAtX = (clientX: number): { date: string; rect: DOMRect } | null => {
    const root = gridRootRef.current;
    if (!root) return null;
    const cols = root.querySelectorAll<HTMLElement>("[data-date]");
    for (const col of cols) {
      const rect = col.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && col.dataset.date) {
        return { date: col.dataset.date, rect };
      }
    }
    return null;
  };

  const isDragging = drag !== null;

  useEffect(() => {
    if (!isDragging) return;

    const onPointerMove = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur || e.pointerId !== cur.pointerId) return;

      if (cur.mode === "pending-create") {
        if (Math.hypot(e.clientX - cur.startX, e.clientY - cur.startY) <= DRAG_THRESHOLD_PX) {
          return;
        }
        const curMin = snapMinutesAllowEnd(e.clientY - cur.colTop);
        const startMin = Math.min(cur.anchorMin, curMin);
        const endMin = Math.max(startMin + MIN_DURATION_MINUTES, Math.max(cur.anchorMin, curMin));
        setAnnouncement(
          t("calendar.announced.creating", { range: formatMinutesRange(startMin, endMin) }),
        );
        setDrag({
          mode: "creating",
          pointerId: cur.pointerId,
          date: cur.date,
          colTop: cur.colTop,
          anchorMin: cur.anchorMin,
          startMin,
          endMin,
        });
        return;
      }

      if (cur.mode === "creating") {
        const curMin = snapMinutesAllowEnd(e.clientY - cur.colTop);
        const startMin = Math.min(cur.anchorMin, curMin);
        const endMin = Math.max(startMin + MIN_DURATION_MINUTES, Math.max(cur.anchorMin, curMin));
        setAnnouncement(
          t("calendar.announced.creating", { range: formatMinutesRange(startMin, endMin) }),
        );
        setDrag({ ...cur, startMin, endMin });
        return;
      }

      if (cur.mode === "pending-move") {
        if (Math.hypot(e.clientX - cur.startX, e.clientY - cur.startY) <= DRAG_THRESHOLD_PX) {
          return;
        }
        const hit = findColumnAtX(e.clientX);
        const targetDate = hit?.date ?? cur.sourceDate;
        const colTop = hit?.rect.top ?? 0;
        const duration = Math.max(MIN_DURATION_MINUTES, cur.block.endMin - cur.block.startMin);
        const rawStart = snapMinutes(e.clientY - colTop - cur.grabOffsetPx);
        const startMin = Math.max(0, Math.min(24 * 60 - duration, rawStart));
        const endMin = startMin + duration;
        setAnnouncement(
          t("calendar.announced.moving", {
            date: targetDate,
            range: formatMinutesRange(startMin, endMin),
          }),
        );
        setDrag({
          mode: "moving",
          pointerId: cur.pointerId,
          block: cur.block,
          sourceDate: cur.sourceDate,
          targetDate,
          grabOffsetPx: cur.grabOffsetPx,
          startMin,
          endMin,
        });
        return;
      }

      if (cur.mode === "moving") {
        const hit = findColumnAtX(e.clientX);
        const targetDate = hit?.date ?? cur.targetDate;
        const colTop = hit?.rect.top ?? 0;
        const duration = Math.max(MIN_DURATION_MINUTES, cur.block.endMin - cur.block.startMin);
        const rawStart = snapMinutes(e.clientY - colTop - cur.grabOffsetPx);
        const startMin = Math.max(0, Math.min(24 * 60 - duration, rawStart));
        const endMin = startMin + duration;
        setAnnouncement(
          t("calendar.announced.moving", {
            date: targetDate,
            range: formatMinutesRange(startMin, endMin),
          }),
        );
        setDrag({ ...cur, targetDate, startMin, endMin });
        return;
      }

      if (cur.mode === "pending-resize") {
        if (Math.hypot(e.clientX - cur.startX, e.clientY - cur.startY) <= DRAG_THRESHOLD_PX) {
          return;
        }
        const pointerMin = snapMinutesAllowEnd(e.clientY - cur.colTop);
        const startMin =
          cur.edge === "top"
            ? Math.max(0, Math.min(cur.block.endMin - MIN_DURATION_MINUTES, pointerMin))
            : cur.block.startMin;
        const endMin =
          cur.edge === "bottom"
            ? Math.min(24 * 60, Math.max(cur.block.startMin + MIN_DURATION_MINUTES, pointerMin))
            : cur.block.endMin;
        setAnnouncement(
          t("calendar.announced.resizing", { range: formatMinutesRange(startMin, endMin) }),
        );
        setDrag({
          mode: "resizing",
          pointerId: cur.pointerId,
          block: cur.block,
          date: cur.date,
          edge: cur.edge,
          colTop: cur.colTop,
          startMin,
          endMin,
        });
        return;
      }

      if (cur.mode === "resizing") {
        const pointerMin = snapMinutesAllowEnd(e.clientY - cur.colTop);
        const startMin =
          cur.edge === "top"
            ? Math.max(0, Math.min(cur.block.endMin - MIN_DURATION_MINUTES, pointerMin))
            : cur.block.startMin;
        const endMin =
          cur.edge === "bottom"
            ? Math.min(24 * 60, Math.max(cur.block.startMin + MIN_DURATION_MINUTES, pointerMin))
            : cur.block.endMin;
        setAnnouncement(
          t("calendar.announced.resizing", { range: formatMinutesRange(startMin, endMin) }),
        );
        setDrag({ ...cur, startMin, endMin });
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur || e.pointerId !== cur.pointerId) return;
      setDrag(null);

      if (cur.mode === "pending-create") {
        const startMin = cur.anchorMin;
        const endMin = Math.min(24 * 60, startMin + 30);
        onCreateSlot(cur.date, startMin, endMin);
      } else if (cur.mode === "creating") {
        onCreateSlot(cur.date, cur.startMin, cur.endMin);
      } else if (cur.mode === "pending-move") {
        if (cur.block.kind === "event") {
          onEditEvent(cur.block.occ);
        } else {
          onScheduleTask(cur.block.task);
        }
      } else if (cur.mode === "moving") {
        const changed = cur.targetDate !== cur.sourceDate || cur.startMin !== cur.block.startMin;
        if (changed) {
          setAnnouncement(
            t("calendar.announced.moved", {
              date: cur.targetDate,
              range: formatMinutesRange(cur.startMin, cur.endMin),
            }),
          );
          if (cur.block.kind === "event") {
            onMoveEvent(cur.block.occ, cur.targetDate, cur.startMin, cur.endMin);
          } else {
            onMoveTask(cur.block.task, cur.targetDate, cur.startMin, cur.endMin);
          }
        }
      } else if (cur.mode === "resizing") {
        const changed = cur.startMin !== cur.block.startMin || cur.endMin !== cur.block.endMin;
        if (changed) {
          if (cur.block.kind === "event") {
            onResizeEvent(cur.block.occ, cur.startMin, cur.endMin);
          } else {
            onResizeTask(cur.block.task, cur.startMin, cur.endMin);
          }
        }
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDrag(null);
        setAnnouncement(t("calendar.announced.cancelled"));
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [
    isDragging,
    onCreateSlot,
    onEditEvent,
    onMoveEvent,
    onMoveTask,
    onResizeEvent,
    onResizeTask,
    onScheduleTask,
  ]);

  const handleColumnPointerDown = (e: React.PointerEvent<HTMLDivElement>, dateStr: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-block-id]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const anchorMin = snapMinutes(e.clientY - rect.top);
    setDrag({
      mode: "pending-create",
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      date: dateStr,
      colTop: rect.top,
      anchorMin,
    });
  };

  const handleBlockPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    block: TimedBlock,
    dateStr: string,
  ) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, [role="menuitem"], [data-resize-handle]')) {
      return;
    }
    e.stopPropagation();
    const colEl = e.currentTarget.closest<HTMLElement>("[data-date]");
    const colTop = colEl ? colEl.getBoundingClientRect().top : 0;
    const blockTopPx = (block.startMin / 60) * HOUR_HEIGHT_PX;
    const grabOffsetPx = Math.max(0, e.clientY - colTop - blockTopPx);
    setDrag({
      mode: "pending-move",
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      block,
      sourceDate: dateStr,
      grabOffsetPx,
    });
  };

  const handleResizePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    block: TimedBlock,
    dateStr: string,
    edge: "top" | "bottom",
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const colEl = e.currentTarget.closest<HTMLElement>("[data-date]");
    const colTop = colEl ? colEl.getBoundingClientRect().top : 0;
    setDrag({
      mode: "pending-resize",
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      block,
      date: dateStr,
      edge,
      colTop,
    });
  };

  const handleBlockKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    block: TimedBlock,
    dateStr: string,
  ) => {
    if (e.target !== e.currentTarget) return;
    const duration = Math.max(MIN_DURATION_MINUTES, block.endMin - block.startMin);

    if (e.key === "Enter") {
      e.preventDefault();
      if (block.kind === "event") onEditEvent(block.occ);
      else onScheduleTask(block.task);
      return;
    }

    if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 15 : -15;
      const nextEnd = Math.max(
        block.startMin + MIN_DURATION_MINUTES,
        Math.min(24 * 60, block.endMin + delta),
      );
      if (nextEnd !== block.endMin) {
        if (block.kind === "event") onResizeEvent(block.occ, block.startMin, nextEnd);
        else onResizeTask(block.task, block.startMin, nextEnd);
      }
      return;
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 15 : -15;
      const nextStart = Math.max(0, Math.min(24 * 60 - duration, block.startMin + delta));
      const nextEnd = nextStart + duration;
      if (nextStart !== block.startMin) {
        if (block.kind === "event") onMoveEvent(block.occ, dateStr, nextStart, nextEnd);
        else onMoveTask(block.task, dateStr, nextStart, nextEnd);
      }
      return;
    }

    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const idx = days.indexOf(dateStr);
      if (idx === -1) return;
      const isRtl = textDirection() === "rtl";
      const step = e.key === "ArrowRight" ? (isRtl ? -1 : 1) : isRtl ? 1 : -1;
      const targetIdx = idx + step;
      if (targetIdx >= 0 && targetIdx < days.length) {
        const targetDate = days[targetIdx];
        if (block.kind === "event") {
          onMoveEvent(block.occ, targetDate, block.startMin, block.endMin);
        } else {
          onMoveTask(block.task, targetDate, block.startMin, block.endMin);
        }
      }
    }
  };

  if (isLoading) {
    return (
      <div
        data-testid="calendar-loading-skeleton"
        className="rounded-xl border border-border bg-card p-4 space-y-3"
      >
        <div className="h-7 w-full animate-pulse rounded-md bg-muted" />
        <div className="space-y-4 pt-2">
          {Array.from({ length: 8 }, (_, idx) => (
            <div key={idx} className="h-px w-full animate-pulse bg-border" />
          ))}
        </div>
      </div>
    );
  }

  const maxAllDayItems = days.reduce((max, dateStr) => {
    const dueCards = forecastMap.get(dateStr) ?? 0;
    const allDayEvents = (occurrencesByDate.get(dateStr) ?? []).filter((o) => o.is_all_day).length;
    const dueTasks = (tasksByDate.dueOnly.get(dateStr) ?? []).length;
    const dayHabits = scheduledHabitsForDate(habits, dateStr, todayDayIndex, todayDate).length;
    return Math.max(max, (dueCards > 0 ? 1 : 0) + allDayEvents + dueTasks + dayHabits);
  }, 0);

  return (
    <div
      ref={gridRootRef}
      role="grid"
      data-testid="calendar-time-grid"
      aria-label={t("calendar.title")}
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>

      {/* Column headers */}
      <div className="flex border-b border-border bg-card">
        <div className="w-14 shrink-0 border-e border-border" aria-hidden="true" />
        <div
          className="grid flex-1 overflow-y-auto [scrollbar-gutter:stable]"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
        >
          {days.map((dateStr) => {
            const dt = parseIsoDateLocal(dateStr);
            const isToday = dateStr === todayDate;
            return (
              <div
                key={dateStr}
                role="columnheader"
                className={cn(
                  "flex items-center justify-center gap-1.5 border-e border-border/60 px-2 py-2 last:border-e-0",
                  isToday && "bg-primary/5",
                )}
              >
                <span className="text-xs font-medium text-muted-foreground">
                  {formatDate(dt, { weekday: "short" })}
                </span>
                <span
                  className={cn(
                    "tnum inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold",
                    isToday ? "bg-primary text-primary-foreground" : "text-foreground",
                  )}
                >
                  {formatDate(dt, { day: "numeric" })}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pinned all-day / habits / forecast strip */}
      <TimeGridAllDayStrip
        days={days}
        todayDate={todayDate}
        todayDayIndex={todayDayIndex}
        occurrencesByDate={occurrencesByDate}
        dueOnlyTasks={tasksByDate.dueOnly}
        habits={habits}
        habitLogMap={habitLogMap}
        forecastMap={forecastMap}
        style={style}
        maxAllDayItems={maxAllDayItems}
        allDayExpanded={allDayExpanded}
        externalDropTarget={externalDropTarget}
        onToggleExpand={() => setAllDayExpanded((v) => !v)}
        onNavigateDecks={onNavigateDecks}
        onEditEvent={onEditEvent}
        onDeleteOccurrence={onDeleteOccurrence}
        onDeleteSeries={onDeleteSeries}
        onScheduleTask={onScheduleTask}
        onToggleHabit={onToggleHabit}
      />

      {/* Scrollable hourly grid */}
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto [scrollbar-gutter:stable]"
        style={{ maxHeight: "620px" }}
      >
        <div className="relative flex" style={{ height: `${HOURS.length * HOUR_HEIGHT_PX}px` }}>
          {/* Sticky hour gutter at inline-start */}
          <div
            data-testid="calendar-hour-gutter"
            className="sticky start-0 z-10 w-14 shrink-0 border-e border-border bg-card"
          >
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="relative border-b border-border/40 px-1.5 text-end text-[10px] text-muted-foreground"
                style={{ height: `${HOUR_HEIGHT_PX}px` }}
              >
                <span dir="ltr" className="tnum inline-block pt-0.5">
                  {formatDate(new Date(2024, 0, 1, hour, 0), { hour: "numeric" })}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          <div
            className="relative grid flex-1"
            style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
          >
            {!hasAnyTimedItems && (
              <p className="pointer-events-none absolute inset-x-4 top-6 z-10 text-center text-xs text-muted-foreground">
                {t("calendar.emptyHint")}
              </p>
            )}

            {days.map((dateStr) => {
              const dt = parseIsoDateLocal(dateStr);
              const formattedDate = formatDate(dt, {
                weekday: "short",
                month: "short",
                day: "numeric",
              });
              const isToday = dateStr === todayDate;
              const laidOut = laidOutByDate.get(dateStr) ?? [];

              return (
                <div
                  key={dateStr}
                  data-date={dateStr}
                  data-testid={`calendar-day-${dateStr}`}
                  onPointerDown={(e) => handleColumnPointerDown(e, dateStr)}
                  className={cn(
                    "relative select-none border-e border-border/60 last:border-e-0",
                    isToday && "bg-primary/[0.025]",
                  )}
                  style={{ height: `${HOURS.length * HOUR_HEIGHT_PX}px` }}
                >
                  {/* 24 hourly gridcells for keyboard creation + visual gridlines */}
                  {HOURS.map((hour) => {
                    const slotLabel = formatDate(new Date(2024, 0, 1, hour, 0), {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    });
                    return (
                      <div
                        key={hour}
                        role="gridcell"
                        tabIndex={0}
                        data-slot-date={dateStr}
                        data-slot-hour={hour}
                        aria-label={t("calendar.slotAria", {
                          date: formattedDate,
                          time: slotLabel,
                        })}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter") {
                            e.preventDefault();
                            onCreateSlot(dateStr, hour * 60, hour * 60 + 30);
                            return;
                          }
                          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                            e.preventDefault();
                            const nextHour = Math.max(
                              0,
                              Math.min(23, hour + (e.key === "ArrowDown" ? 1 : -1)),
                            );
                            gridRootRef.current
                              ?.querySelector<HTMLElement>(
                                `[data-slot-date="${dateStr}"][data-slot-hour="${nextHour}"]`,
                              )
                              ?.focus();
                            return;
                          }
                          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                            e.preventDefault();
                            const colIdx = days.indexOf(dateStr);
                            if (colIdx === -1) return;
                            const isRtl = textDirection() === "rtl";
                            const step = e.key === "ArrowRight" ? (isRtl ? -1 : 1) : isRtl ? 1 : -1;
                            const nextDate = days[colIdx + step];
                            if (nextDate) {
                              gridRootRef.current
                                ?.querySelector<HTMLElement>(
                                  `[data-slot-date="${nextDate}"][data-slot-hour="${hour}"]`,
                                )
                                ?.focus();
                            }
                          }
                        }}
                        className="border-b border-border/40 focus-visible:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                        style={{ height: `${HOUR_HEIGHT_PX}px` }}
                      />
                    );
                  })}

                  {/* Live "now" line in today's column */}
                  {isToday && (
                    <div
                      data-testid="calendar-now-line"
                      aria-label={t("calendar.nowLine")}
                      className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                      style={{ top: `${(nowMinutes / 60) * HOUR_HEIGHT_PX}px` }}
                    >
                      <span className="-ms-[3px] size-1.5 shrink-0 rounded-full bg-primary" />
                      <span className="h-px flex-1 bg-primary" />
                    </div>
                  )}

                  {/* Timed event & task blocks */}
                  {laidOut.map(({ item: block, colIndex, colCount }) => {
                    const isMovingSource = drag?.mode === "moving" && drag.block.id === block.id;
                    const isResizingThis = drag?.mode === "resizing" && drag.block.id === block.id;
                    const effStartMin = isResizingThis ? drag.startMin : block.startMin;
                    const effEndMin = isResizingThis ? drag.endMin : block.endMin;

                    return (
                      <TimeGridBlock
                        key={`${block.kind}-${block.id}`}
                        block={block}
                        colIndex={colIndex}
                        colCount={colCount}
                        effStartMin={effStartMin}
                        effEndMin={effEndMin}
                        isMovingSource={isMovingSource}
                        style={style}
                        onBlockPointerDown={(e) => handleBlockPointerDown(e, block, dateStr)}
                        onBlockKeyDown={(e) => handleBlockKeyDown(e, block, dateStr)}
                        onResizePointerDown={(e, edge) =>
                          handleResizePointerDown(e, block, dateStr, edge)
                        }
                        onResizeEvent={onResizeEvent}
                        onResizeTask={onResizeTask}
                        onEditEvent={onEditEvent}
                        onDeleteOccurrence={onDeleteOccurrence}
                        onDeleteSeries={onDeleteSeries}
                      />
                    );
                  })}

                  {/* Ghost preview while creating */}
                  {drag?.mode === "creating" && drag.date === dateStr && (
                    <div
                      data-testid="calendar-create-ghost"
                      style={{
                        top: `${(drag.startMin / 60) * HOUR_HEIGHT_PX}px`,
                        height: `${Math.max(12, ((drag.endMin - drag.startMin) / 60) * HOUR_HEIGHT_PX)}px`,
                      }}
                      className="pointer-events-none absolute inset-x-1 z-20 rounded-lg border border-primary bg-primary/20 px-1.5 py-1 text-[11px] font-medium text-foreground"
                    >
                      <span dir="ltr" className="tnum">
                        {formatMinutesRange(drag.startMin, drag.endMin)}
                      </span>
                    </div>
                  )}

                  {/* Ghost preview while moving */}
                  {drag?.mode === "moving" && drag.targetDate === dateStr && (
                    <div
                      data-testid="calendar-move-ghost"
                      style={{
                        top: `${(drag.startMin / 60) * HOUR_HEIGHT_PX}px`,
                        height: `${Math.max(18, ((drag.endMin - drag.startMin) / 60) * HOUR_HEIGHT_PX)}px`,
                      }}
                      className="pointer-events-none absolute inset-x-1 z-20 rounded-lg border border-primary bg-primary/20 px-1.5 py-1 text-xs font-medium text-foreground"
                    >
                      <p dir="auto" className="truncate">
                        {drag.block.title}
                      </p>
                      <span dir="ltr" className="tnum text-[10px] text-muted-foreground">
                        {formatMinutesRange(drag.startMin, drag.endMin)}
                      </span>
                    </div>
                  )}

                  {/* Ghost preview while dropping an external unscheduled task */}
                  {externalDropTarget &&
                    !externalDropTarget.isAllDay &&
                    externalDropTarget.date === dateStr &&
                    externalDropTarget.startMin !== null && (
                      <div
                        data-testid="calendar-drop-slot-ghost"
                        style={{
                          top: `${(externalDropTarget.startMin / 60) * HOUR_HEIGHT_PX}px`,
                          height: `${HOUR_HEIGHT_PX}px`,
                        }}
                        className="pointer-events-none absolute inset-x-1 z-20 rounded-lg border border-dashed border-primary bg-primary/15 px-1.5 py-1 text-[10px] font-medium text-primary"
                      >
                        <span dir="ltr" className="tnum">
                          {formatMinutesRange(
                            externalDropTarget.startMin,
                            Math.min(24 * 60, externalDropTarget.startMin + 60),
                          )}
                        </span>
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
