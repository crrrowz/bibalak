import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Flag,
  GripVertical,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type {
  MatrixQuadrantDto,
  QuadrantKey,
  TaskDto,
  TaskInput,
  TaskPriority,
} from "@bibalak/ipc-types";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  formatDueDateLabel,
  formatScheduleTimeRange,
  offsetIsoDate,
  priorityFlagClass,
  priorityLabel,
  QUADRANT_ORDER,
  quadrantBadgeClass,
  quadrantDisplayTitle,
  quadrantRoman,
  taskToInput,
} from "./matrixHelpers";

const PRIORITY_OPTIONS: readonly TaskPriority[] = ["high", "medium", "low", "none"];

function PriorityFlag({ priority, className }: { priority: TaskPriority; className?: string }) {
  return (
    <Flag
      className={cn("size-3.5 shrink-0 rtl:-scale-x-100", priorityFlagClass(priority), className)}
      fill={priority === "none" ? "none" : "currentColor"}
      aria-hidden="true"
    />
  );
}

export interface TaskRowProps {
  task: TaskDto;
  todayDate: string;
  quadrants: MatrixQuadrantDto[];
  isSelected?: boolean;
  isFocused?: boolean;
  isEditingTitle?: boolean;
  onRequestInlineEdit?: (taskId: string | null) => void;
  onSelectTask: (task: TaskDto) => void;
  onFocusTask?: (taskId: string) => void;
  onToggleComplete: (task: TaskDto) => void;
  onUpdateTask: (id: string, input: TaskInput) => void;
  onDelete: (task: TaskDto) => void;
  onMoveToQuadrant: (id: string, quadrant: QuadrantKey) => void;
  onReorderStep?: (taskId: string, delta: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onReorderPointerDown?: (e: React.PointerEvent<HTMLButtonElement>, taskId: string) => void;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>, taskId: string) => void;
  onDragEnd?: () => void;
}

export function TaskRow({
  task,
  todayDate,
  quadrants,
  isSelected = false,
  isFocused = false,
  isEditingTitle = false,
  onRequestInlineEdit,
  onSelectTask,
  onFocusTask,
  onToggleComplete,
  onUpdateTask,
  onDelete,
  onMoveToQuadrant,
  onReorderStep,
  canMoveUp = false,
  canMoveDown = false,
  onReorderPointerDown,
  onDragStart,
  onDragEnd,
}: TaskRowProps) {
  const [moveOpen, setMoveOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState(task.title);

  const rowRef = useRef<HTMLDivElement>(null);
  const priorityWrapRef = useRef<HTMLDivElement>(null);
  const dateWrapRef = useRef<HTMLDivElement>(null);

  const isCompleted = task.completed_at !== null;
  const dueInfo = task.due_date ? formatDueDateLabel(task.due_date, todayDate) : null;
  const scheduleLabel =
    task.scheduled_start_ms !== null && task.scheduled_end_ms !== null
      ? formatScheduleTimeRange(task.scheduled_start_ms, task.scheduled_end_ms)
      : null;

  useEffect(() => {
    if (isEditingTitle) {
      setDraftTitle(task.title);
    }
  }, [isEditingTitle, task.title]);

  useEffect(() => {
    if (!priorityOpen && !dateOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (priorityOpen && priorityWrapRef.current && !priorityWrapRef.current.contains(target)) {
        setPriorityOpen(false);
      }
      if (dateOpen && dateWrapRef.current && !dateWrapRef.current.contains(target)) {
        setDateOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setPriorityOpen(false);
        setDateOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [priorityOpen, dateOpen]);

  const commitInlineTitle = () => {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== task.title) {
      onUpdateTask(task.id, taskToInput(task, { title: trimmed }));
    }
    onRequestInlineEdit?.(null);
  };

  const cancelInlineTitle = () => {
    setDraftTitle(task.title);
    onRequestInlineEdit?.(null);
    rowRef.current?.focus();
  };

  const setDueDate = (nextDate: string | null) => {
    setDateOpen(false);
    if (nextDate !== task.due_date) {
      onUpdateTask(task.id, taskToInput(task, { due_date: nextDate }));
    }
  };

  const setPriority = (nextPriority: TaskPriority) => {
    setPriorityOpen(false);
    if (nextPriority !== task.priority) {
      onUpdateTask(task.id, taskToInput(task, { priority: nextPriority }));
    }
  };

  return (
    <div
      ref={rowRef}
      tabIndex={0}
      data-task-row-id={task.id}
      draggable={!isCompleted && !isEditingTitle}
      onDragStart={(e) => {
        if (!isCompleted && !isEditingTitle && onDragStart) {
          onDragStart(e, task.id);
        }
      }}
      onDragEnd={onDragEnd}
      onFocus={() => onFocusTask?.(task.id)}
      onClick={(e) => {
        if (isEditingTitle) return;
        const target = e.target as HTMLElement;
        if (target.closest("button, input, a, [data-popover-layer]")) return;
        onSelectTask(task);
      }}
      className={cn(
        "group relative flex items-stretch rounded-lg border text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected
          ? "border-primary/60 bg-primary/5"
          : isFocused
            ? "border-border bg-accent/40"
            : "border-border/70 bg-background/60 hover:bg-accent/40",
        isCompleted ? "opacity-70" : "cursor-grab active:cursor-grabbing",
      )}
    >
      {!isCompleted && onReorderPointerDown && (
        <button
          type="button"
          draggable={false}
          aria-label={t("matrix.task.reorderAria", { title: task.title })}
          onDragStart={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            onReorderPointerDown(e, task.id);
          }}
          className="flex w-5 shrink-0 self-stretch touch-none cursor-grab items-center justify-center rounded-s-[7px] border-e border-transparent text-muted-foreground/70 opacity-100 transition-[opacity,background-color,color,border-color] sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 hover:border-border/60 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing [@media(hover:none)]:opacity-70"
        >
          <GripVertical className="size-3.5" aria-hidden="true" />
        </button>
      )}

      <div
        className={cn(
          "flex min-w-0 flex-1 items-start gap-2.5 py-2 pe-2.5",
          !isCompleted && onReorderPointerDown ? "ps-2" : "ps-2.5",
        )}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={isCompleted}
          aria-label={task.title}
          onClick={(e) => {
            e.stopPropagation();
            onToggleComplete(task);
          }}
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isCompleted
              ? "border-primary bg-primary text-primary-foreground"
              : "border-input bg-card hover:border-primary",
          )}
        >
          {isCompleted && <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <div ref={priorityWrapRef} className="relative flex items-center">
              <button
                type="button"
                aria-label={t("matrix.task.setPriority", { title: task.title })}
                aria-expanded={priorityOpen}
                title={priorityLabel(task.priority)}
                onClick={(e) => {
                  e.stopPropagation();
                  setDateOpen(false);
                  setPriorityOpen((v) => !v);
                }}
                className="flex size-5 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PriorityFlag priority={task.priority} />
              </button>

              {priorityOpen && (
                <div
                  data-popover-layer="true"
                  role="listbox"
                  aria-label={t("matrix.task.setPriority", { title: task.title })}
                  onClick={(e) => e.stopPropagation()}
                  className="glass-panel absolute start-0 top-full z-30 mt-1 min-w-32 rounded-lg border py-1 shadow-md"
                >
                  {PRIORITY_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      role="option"
                      aria-selected={task.priority === opt}
                      onClick={() => setPriority(opt)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <PriorityFlag priority={opt} />
                      <span className="flex-1 text-foreground">{priorityLabel(opt)}</span>
                      {task.priority === opt && <Check className="size-3 text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {isEditingTitle ? (
              <input
                type="text"
                autoFocus
                aria-label={t("matrix.task.editTitleAria", { title: task.title })}
                value={draftTitle}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={commitInlineTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    commitInlineTitle();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    cancelInlineTitle();
                  }
                }}
                className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <span
                dir="auto"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isCompleted) onRequestInlineEdit?.(task.id);
                }}
                className={cn(
                  "break-words font-medium text-foreground",
                  isCompleted && "line-through text-muted-foreground",
                )}
              >
                {task.title}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <div ref={dateWrapRef} className="relative inline-flex items-center">
              {dueInfo ? (
                <button
                  type="button"
                  aria-label={t("matrix.task.setDueDate", { title: task.title })}
                  aria-expanded={dateOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPriorityOpen(false);
                    setDateOpen((v) => !v);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    dueInfo.isOverdue
                      ? "border-destructive/35 bg-destructive/10 text-destructive"
                      : "border-border/70 bg-secondary/50 text-foreground",
                  )}
                >
                  <Calendar className="size-3 shrink-0" aria-hidden="true" />
                  <span>{dueInfo.label}</span>
                </button>
              ) : !isCompleted ? (
                <button
                  type="button"
                  aria-label={t("matrix.task.setDueDate", { title: task.title })}
                  aria-expanded={dateOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPriorityOpen(false);
                    setDateOpen((v) => !v);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-secondary/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Calendar className="size-3 shrink-0" aria-hidden="true" />
                  <span>{t("matrix.task.addDate")}</span>
                </button>
              ) : null}

              {dateOpen && (
                <div
                  data-popover-layer="true"
                  role="group"
                  aria-label={t("matrix.task.setDueDate", { title: task.title })}
                  onClick={(e) => e.stopPropagation()}
                  className="glass-panel absolute start-0 top-full z-30 mt-1 w-48 space-y-1 rounded-lg border p-2 text-xs shadow-md"
                >
                  <button
                    type="button"
                    onClick={() => setDueDate(todayDate)}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-start text-foreground hover:bg-accent"
                  >
                    <span>{t("matrix.task.dueToday")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDueDate(offsetIsoDate(todayDate, 1))}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-start text-foreground hover:bg-accent"
                  >
                    <span>{t("matrix.task.dueTomorrow")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDueDate(offsetIsoDate(todayDate, 7))}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-start text-foreground hover:bg-accent"
                  >
                    <span>{t("matrix.task.nextWeek")}</span>
                  </button>
                  <input
                    type="date"
                    aria-label={t("matrix.taskDialog.dueDateLabel")}
                    value={task.due_date ?? ""}
                    onChange={(e) => setDueDate(e.target.value || null)}
                    className="mt-1 h-7 w-full rounded border border-input bg-background px-1.5 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  {task.due_date && (
                    <button
                      type="button"
                      onClick={() => setDueDate(null)}
                      className="mt-1 flex w-full items-center justify-center rounded border border-border py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {t("matrix.taskDialog.clearDate")}
                    </button>
                  )}
                </div>
              )}
            </div>

            {scheduleLabel && (
              <span
                dir="ltr"
                className="tnum inline-flex items-center gap-1 rounded bg-secondary/70 px-1.5 py-0.5 text-secondary-foreground"
              >
                <Clock className="size-3" aria-hidden="true" />
                {scheduleLabel}
              </span>
            )}

            {task.list_name && (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                {task.list_name}
              </span>
            )}

            {task.deck_id !== null && (
              <span
                title={t("matrix.task.linkedDeck", {
                  deck: task.deck_name ?? t("matrix.task.missingDeck"),
                })}
                className="rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground"
              >
                {task.deck_name ?? t("matrix.task.missingDeck")}
              </span>
            )}

            {task.tags.map((tag) => (
              <span key={tag} dir="auto" className="rounded border border-border px-1.5 py-0.5">
                #{tag}
              </span>
            ))}
          </div>
        </div>

        <ActionMenu
          menuLabel={t("matrix.task.actions", { title: task.title })}
          triggerAriaLabel={t("matrix.task.actions", { title: task.title })}
          triggerVariant="ghost"
          triggerSize="sm"
          triggerClassName="h-7 w-7 shrink-0 p-0"
          triggerContent={<MoreHorizontal className="size-4" />}
          stopContainerClickPropagation
          onOpenChange={(open) => {
            if (!open) setMoveOpen(false);
          }}
        >
          {!isCompleted ? (
            <ActionMenuItem
              icon={<Check className="size-4" />}
              label={t("matrix.task.complete")}
              onSelect={() => onToggleComplete(task)}
            />
          ) : (
            <ActionMenuItem
              icon={<RotateCcw className="size-4" />}
              label={t("matrix.task.reopen")}
              onSelect={() => onToggleComplete(task)}
            />
          )}
          <ActionMenuItem
            icon={<Pencil className="size-4" />}
            label={t("matrix.task.edit")}
            onSelect={() => onSelectTask(task)}
          />
          {!isCompleted && (
            <>
              <button
                type="button"
                role="menuitem"
                aria-expanded={moveOpen}
                onClick={() => setMoveOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm outline-none hover:bg-accent focus-visible:bg-accent"
              >
                <span className="flex items-center gap-2">
                  <ArrowRightLeft className="size-4 text-muted-foreground" />
                  <span>{t("matrix.task.moveTo")}</span>
                </span>
                <ChevronDown
                  className={cn(
                    "size-3.5 text-muted-foreground transition-transform",
                    moveOpen && "rotate-180",
                  )}
                />
              </button>
              {moveOpen &&
                QUADRANT_ORDER.map((qKey) => {
                  const q = quadrants.find((item) => item.quadrant_key === qKey);
                  const label = q ? quadrantDisplayTitle(q) : t(`matrix.quadrant.${qKey}`);
                  return (
                    <ActionMenuItem
                      key={qKey}
                      icon={
                        <span
                          className={cn(
                            "inline-flex size-4 items-center justify-center rounded text-[10px] font-semibold",
                            quadrantBadgeClass(q?.color_token ?? "accent"),
                          )}
                        >
                          {quadrantRoman(qKey)}
                        </span>
                      }
                      label={label}
                      onSelect={() => onMoveToQuadrant(task.id, qKey)}
                    />
                  );
                })}
              {onReorderStep && (
                <>
                  <ActionMenuItem
                    icon={<ArrowUp className="size-4" />}
                    label={t("matrix.task.moveUp")}
                    disabled={!canMoveUp}
                    onSelect={() => onReorderStep(task.id, -1)}
                  />
                  <ActionMenuItem
                    icon={<ArrowDown className="size-4" />}
                    label={t("matrix.task.moveDown")}
                    disabled={!canMoveDown}
                    onSelect={() => onReorderStep(task.id, 1)}
                  />
                </>
              )}
            </>
          )}
          <ActionMenuSeparator />
          <ActionMenuItem
            icon={<Trash2 className="size-4" />}
            label={t("matrix.task.delete")}
            danger
            onSelect={() => onDelete(task)}
          />
        </ActionMenu>
      </div>
    </div>
  );
}
