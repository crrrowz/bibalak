import { useEffect, useRef, useState } from "react";
import type { TaskDto, WeekStart } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { formatMinutesRange, snapMinutes, type CalendarViewMode } from "./calendarHelpers";
import type { ExternalDropTarget } from "./TimeGrid";
import { MiniMonth } from "./MiniMonth";

const DRAG_THRESHOLD_PX = 4;

interface TaskDragState {
  task: TaskDto;
  pointerId: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  active: boolean;
}

export interface UnscheduledDrawerProps {
  tasks: TaskDto[];
  anchorDate: string;
  todayDate: string;
  view: CalendarViewMode;
  weekStart: WeekStart;
  onSelectDate: (dateStr: string) => void;
  onOpenScheduleDialog: (task: TaskDto) => void;
  onDropTaskOnSlot: (task: TaskDto, dateStr: string, startMin: number) => void;
  onDropTaskOnAllDay: (task: TaskDto, dateStr: string) => void;
  onExternalDropTargetChange: (target: ExternalDropTarget | null) => void;
}

function hitTestDropTarget(clientX: number, clientY: number): ExternalDropTarget | null {
  const cols = document.querySelectorAll<HTMLElement>("[data-date]");
  for (const col of cols) {
    const rect = col.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom &&
      col.dataset.date
    ) {
      return {
        date: col.dataset.date,
        startMin: snapMinutes(clientY - rect.top),
        isAllDay: false,
      };
    }
  }

  const allDayCells = document.querySelectorAll<HTMLElement>("[data-allday-date]");
  for (const cell of allDayCells) {
    const rect = cell.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom &&
      cell.dataset.alldayDate
    ) {
      return {
        date: cell.dataset.alldayDate,
        startMin: null,
        isAllDay: true,
      };
    }
  }
  return null;
}

export function UnscheduledDrawer({
  tasks,
  anchorDate,
  todayDate,
  view,
  weekStart,
  onSelectDate,
  onOpenScheduleDialog,
  onDropTaskOnSlot,
  onDropTaskOnAllDay,
  onExternalDropTargetChange,
}: UnscheduledDrawerProps) {
  const [dragState, setDragState] = useState<TaskDragState | null>(null);
  const dragRef = useRef<TaskDragState | null>(null);
  dragRef.current = dragState;
  const isDragging = dragState !== null;

  useEffect(() => {
    if (!isDragging) return;

    const onPointerMove = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur || e.pointerId !== cur.pointerId) return;
      const moved = Math.hypot(e.clientX - cur.startX, e.clientY - cur.startY);
      if (!cur.active && moved <= DRAG_THRESHOLD_PX) return;

      const target = hitTestDropTarget(e.clientX, e.clientY);
      onExternalDropTargetChange(target);
      setDragState({
        ...cur,
        active: true,
        clientX: e.clientX,
        clientY: e.clientY,
      });
    };

    const onPointerUp = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur || e.pointerId !== cur.pointerId) return;
      const wasActive = cur.active;
      setDragState(null);
      onExternalDropTargetChange(null);

      if (!wasActive) return;
      const target = hitTestDropTarget(e.clientX, e.clientY);
      if (!target) return;
      if (target.isAllDay) {
        onDropTaskOnAllDay(cur.task, target.date);
      } else if (target.startMin !== null) {
        onDropTaskOnSlot(cur.task, target.date, target.startMin);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDragState(null);
        onExternalDropTargetChange(null);
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
  }, [isDragging, onDropTaskOnAllDay, onDropTaskOnSlot, onExternalDropTargetChange]);

  const activeTarget = dragState?.active
    ? hitTestDropTarget(dragState.clientX, dragState.clientY)
    : null;

  return (
    <aside
      data-testid="calendar-unscheduled"
      aria-label={t("calendar.unscheduledTitle")}
      className="flex h-fit flex-col gap-3 rounded-xl border border-border bg-card p-3.5"
    >
      <div className="hidden lg:block border-b border-border/60 pb-3">
        <MiniMonth
          anchorDate={anchorDate}
          todayDate={todayDate}
          view={view}
          weekStart={weekStart}
          onSelectDate={onSelectDate}
        />
      </div>

      <div className="space-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("calendar.unscheduledTitle")}
        </h2>
        {tasks.length > 0 && (
          <p className="text-[11px] text-muted-foreground">{t("calendar.dragHint")}</p>
        )}
      </div>

      {tasks.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {t("calendar.unscheduledEmpty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              data-testid={`unscheduled-task-${task.id}`}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                if ((e.target as HTMLElement).closest("button, a, input")) return;
                setDragState({
                  task,
                  pointerId: e.pointerId,
                  startX: e.clientX,
                  startY: e.clientY,
                  clientX: e.clientX,
                  clientY: e.clientY,
                  active: false,
                });
              }}
              className="cursor-grab touch-none select-none rounded-lg border border-border bg-background/60 p-2.5 text-xs space-y-2 transition-colors hover:border-primary/40 active:cursor-grabbing"
            >
              <p dir="auto" className="font-medium text-foreground">
                {task.title}
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {task.due_date ?? task.list_name ?? t("matrix.task.inbox")}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t("calendar.scheduleTaskAria", { title: task.title })}
                  onClick={() => onOpenScheduleDialog(task)}
                  className="h-6 px-2 text-[11px]"
                >
                  {t("calendar.scheduleTask")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dragState?.active && (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            left: dragState.clientX + 10,
            top: dragState.clientY + 10,
          }}
          className="pointer-events-none z-50 max-w-52 rounded-lg border border-primary bg-card px-2.5 py-1.5 text-xs shadow-lg"
        >
          <p dir="auto" className="truncate font-medium text-foreground">
            {dragState.task.title}
          </p>
          {activeTarget && !activeTarget.isAllDay && activeTarget.startMin !== null && (
            <span dir="ltr" className="tnum text-[10px] text-primary">
              {formatMinutesRange(
                activeTarget.startMin,
                Math.min(24 * 60, activeTarget.startMin + 60),
              )}
            </span>
          )}
        </div>
      )}
    </aside>
  );
}
