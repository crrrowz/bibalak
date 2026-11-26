import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, FolderKanban, LayoutGrid, List, Undo2 } from "lucide-react";
import type {
  MatrixQuadrantDto,
  QuadrantKey,
  TaskDto,
  TaskInput,
  TaskListInput,
  TaskOrderItem,
  TaskPriority,
} from "@bibalak/ipc-types";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { useProgressSummary } from "@/features/progress/useProgressSummary";
import { errorMessage, ipc, isTauri } from "@/lib/ipc";
import { formatNumber, t, tn } from "@/lib/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { formatUndoAction } from "@/lib/undo";
import { cn } from "@/lib/utils";
import { toast } from "@/stores/toast";
import {
  buildQuadrantsForDeckMove,
  computeReorderItems,
  groupAndSortTasks,
  inferTaskQuadrant,
  QUADRANT_ORDER,
  stepReorderItems,
  taskToInput,
} from "./matrixHelpers";
import { EditMatrixDialog } from "./EditMatrixDialog";
import { MatrixTaskSection } from "./MatrixExtraSections";
import { MatrixQuadrantCard } from "./MatrixQuadrantCard";
import { type QuickAddSubmitPayload } from "./QuickAddBar";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { TaskListManagerDialog } from "./TaskListManagerDialog";
import { TaskListView } from "./TaskListView";

type MatrixViewMode = "matrix" | "list";

interface ReorderDragState {
  taskId: string;
  quadrantKey: QuadrantKey;
  startY: number;
  active: boolean;
  insertIndex: number;
}

function isEditableOrOverlayActive(target: EventTarget | null): boolean {
  if (target instanceof HTMLElement) {
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable
    ) {
      return true;
    }
  }
  if (
    document.querySelector(
      '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [data-popover-layer]',
    )
  ) {
    return true;
  }
  return false;
}

export function EisenhowerMatrixScreen() {
  const tauri = isTauri();
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<MatrixViewMode>("matrix");
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [quickAddQuadrant, setQuickAddQuadrant] = useState<QuadrantKey | null>(null);
  const [editingQuadrant, setEditingQuadrant] = useState<MatrixQuadrantDto | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [editingTaskTitleId, setEditingTaskTitleId] = useState<string | null>(null);
  const [listsOpen, setListsOpen] = useState(false);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragDeckId, setDragDeckId] = useState<number | null>(null);
  const [dropQuadrant, setDropQuadrant] = useState<QuadrantKey | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [completedFootersOpen, setCompletedFootersOpen] = useState<Record<string, boolean>>({});
  const [reorderDrag, setReorderDrag] = useState<ReorderDragState | null>(null);

  const listQuickAddRef = useRef<HTMLInputElement | null>(null);
  const quadrantQuickAddRef = useRef<HTMLInputElement | null>(null);
  const reorderDragRef = useRef<ReorderDragState | null>(null);
  reorderDragRef.current = reorderDrag;

  const boardQuery = useQuery({
    queryKey: [...queryKeys.matrixAll, includeCompleted],
    queryFn: () => ipc.getMatrixBoard(includeCompleted),
    placeholderData: keepPreviousData,
    enabled: tauri,
  });

  const taskListsQuery = useQuery({
    queryKey: queryKeys.taskListsAll,
    queryFn: ipc.listTaskLists,
    enabled: tauri,
  });

  const decksQuery = useQuery({
    queryKey: queryKeys.decks,
    queryFn: ipc.listDecks,
    enabled: tauri,
  });

  const undoStatusQuery = useQuery({
    queryKey: queryKeys.undoStatus,
    queryFn: ipc.undoStatus,
    enabled: tauri,
  });

  const progressSummaryQuery = useProgressSummary();
  const progress = progressSummaryQuery.data;

  const invalidateAll = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.matrixAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.taskListsAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.undoStatus }),
        queryClient.invalidateQueries({ queryKey: queryKeys.progressSummary }),
        queryClient.invalidateQueries({ queryKey: queryKeys.yesterdaySummary }),
      ]),
    [queryClient],
  );

  const onMutError = (err: unknown) => {
    toast.error(errorMessage(err));
  };

  const createTaskMut = useMutation({
    mutationFn: (input: TaskInput) => ipc.createTask(input),
    onSuccess: () => {
      setQuickAddQuadrant(null);
      void invalidateAll();
    },
    onError: onMutError,
  });

  const updateTaskMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: TaskInput }) => ipc.updateTask(id, input),
    onSuccess: () => void invalidateAll(),
    onError: onMutError,
  });

  const toggleCompleteMut = useMutation({
    mutationFn: (task: TaskDto) =>
      task.completed_at !== null ? ipc.reopenTask(task.id) : ipc.completeTask(task.id),
    onSuccess: () => void invalidateAll(),
    onError: onMutError,
  });

  const deleteTaskMut = useMutation({
    mutationFn: (id: string) => ipc.deleteTask(id),
    onSuccess: (_res, id) => {
      if (selectedTaskId === id) setSelectedTaskId(null);
      void invalidateAll();
    },
    onError: onMutError,
  });

  const moveTaskMut = useMutation({
    mutationFn: ({ id, quadrant }: { id: string; quadrant: QuadrantKey }) =>
      ipc.moveTaskToQuadrant(id, quadrant),
    onSuccess: () => void invalidateAll(),
    onError: onMutError,
  });

  const reorderTasksMut = useMutation({
    mutationFn: (items: TaskOrderItem[]) => ipc.reorderTasks(items),
    onSuccess: () => void invalidateAll(),
    onError: onMutError,
  });

  const rescheduleOverdueMut = useMutation({
    mutationFn: (targetDate: string) => ipc.rescheduleOverdueTasks(targetDate),
    onSuccess: (count) => {
      toast.success(tn("matrix.overdueRescheduled", count));
      void invalidateAll();
    },
    onError: onMutError,
  });

  const saveQuadrantMut = useMutation({
    mutationFn: (q: MatrixQuadrantDto) => ipc.saveMatrixQuadrant(q),
    onSuccess: () => void invalidateAll(),
  });

  const moveDeckMut = useMutation({
    mutationFn: async ({ deckId, quadrant }: { deckId: number; quadrant: QuadrantKey }) => {
      const changed = buildQuadrantsForDeckMove(quadrants, deckId, quadrant);
      await Promise.all(changed.map((q) => ipc.saveMatrixQuadrant(q)));
    },
    onSuccess: () => void invalidateAll(),
    onError: onMutError,
  });

  const restoreQuadrantMut = useMutation({
    mutationFn: (key: QuadrantKey) => ipc.restoreMatrixDefaults(key),
    onSuccess: () => void invalidateAll(),
  });

  const createListMut = useMutation({
    mutationFn: (input: TaskListInput) => ipc.createTaskList(input),
    onSuccess: () => void invalidateAll(),
  });

  const updateListMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: TaskListInput }) =>
      ipc.updateTaskList(id, input),
    onSuccess: () => void invalidateAll(),
  });

  const deleteListMut = useMutation({
    mutationFn: (id: string) => ipc.deleteTaskList(id),
    onSuccess: () => void invalidateAll(),
  });

  const undoMut = useMutation({
    mutationFn: () => ipc.undo(),
    onSuccess: () => void invalidateAll(),
    onError: onMutError,
  });

  const board = boardQuery.data;
  const quadrants = useMemo(() => board?.quadrants ?? [], [board]);
  const tasks = useMemo(() => board?.tasks ?? [], [board]);
  const deckDueItems = useMemo(() => board?.deck_due_items ?? [], [board]);
  const taskLists = taskListsQuery.data ?? [];
  const decks = decksQuery.data ?? [];
  const undoAction = undoStatusQuery.data ?? null;

  const selectedTask = useMemo(
    () => (selectedTaskId ? (tasks.find((item) => item.id === selectedTaskId) ?? null) : null),
    [tasks, selectedTaskId],
  );

  const overdueCount = useMemo(() => {
    if (!board) return 0;
    return tasks.filter(
      (item) =>
        item.completed_at === null && item.due_date !== null && item.due_date < board.today_date,
    ).length;
  }, [board, tasks]);

  const unsortedTasks = useMemo(
    () => tasks.filter((item) => item.completed_at === null && item.effective_quadrant === null),
    [tasks],
  );
  const completedTasks = useMemo(() => tasks.filter((item) => item.completed_at !== null), [tasks]);

  // Precompute grouped active tasks per quadrant so render, pointer drag, and keyboard reorder share one source.
  const quadrantBuckets = useMemo(() => {
    if (!board) return null;
    const map = new Map<
      QuadrantKey,
      {
        quadrant: MatrixQuadrantDto;
        groups: ReturnType<typeof groupAndSortTasks>;
        flatTasks: TaskDto[];
        deckDue: typeof deckDueItems;
        completed: TaskDto[];
      }
    >();

    for (const key of QUADRANT_ORDER) {
      const q = quadrants.find((item) => item.quadrant_key === key);
      if (!q) continue;
      const qTasks = tasks.filter(
        (item) => item.completed_at === null && item.effective_quadrant === key,
      );
      const groups = groupAndSortTasks(qTasks, q.group_by, q.sort_by, board.today_date);
      const flatTasks = groups.flatMap((g) => g.tasks);
      const qDecks = deckDueItems.filter((d) => d.quadrant_key === key);
      const qCompleted = includeCompleted
        ? completedTasks.filter(
            (tItem) => inferTaskQuadrant(tItem, quadrants, board.today_date) === key,
          )
        : [];
      map.set(key, {
        quadrant: q,
        groups,
        flatTasks,
        deckDue: qDecks,
        completed: qCompleted,
      });
    }
    return map;
  }, [board, quadrants, tasks, deckDueItems, includeCompleted, completedTasks]);

  const commitReorder = useCallback(
    (quadrantKey: QuadrantKey, items: TaskOrderItem[]) => {
      const q = quadrants.find((item) => item.quadrant_key === quadrantKey);
      if (q && q.sort_by !== "manual") {
        saveQuadrantMut.mutate({ ...q, sort_by: "manual" });
      }
      reorderTasksMut.mutate(items);
    },
    [quadrants, saveQuadrantMut, reorderTasksMut],
  );

  const handleStepReorder = useCallback(
    (quadrantKey: QuadrantKey, taskId: string, delta: -1 | 1) => {
      const bucket = quadrantBuckets?.get(quadrantKey);
      if (!bucket) return;
      const items = stepReorderItems(bucket.flatTasks, taskId, delta);
      if (items) commitReorder(quadrantKey, items);
    },
    [quadrantBuckets, commitReorder],
  );

  // Pointer Events intra-quadrant reorder listener
  const isReorderDragging = reorderDrag !== null;
  useEffect(() => {
    if (!isReorderDragging) return;

    const handlePointerMove = (e: PointerEvent) => {
      const cur = reorderDragRef.current;
      if (!cur) return;
      if (!cur.active && Math.abs(e.clientY - cur.startY) <= 4) return;

      const container = document.querySelector<HTMLElement>(
        `[data-quadrant-tasks="${cur.quadrantKey}"]`,
      );
      if (!container) return;
      const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-task-row-id]"));
      let insertIndex = rows.length;
      for (let i = 0; i < rows.length; i += 1) {
        const rect = rows[i].getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY < mid) {
          insertIndex = i;
          break;
        }
      }
      setReorderDrag((prev) => (prev ? { ...prev, active: true, insertIndex } : null));
    };

    const finishDrag = (commit: boolean) => {
      const cur = reorderDragRef.current;
      setReorderDrag(null);
      if (!commit || !cur || !cur.active) return;
      const bucket = quadrantBuckets?.get(cur.quadrantKey);
      if (!bucket) return;
      const items = computeReorderItems(bucket.flatTasks, cur.taskId, cur.insertIndex);
      if (items) commitReorder(cur.quadrantKey, items);
    };

    const handlePointerUp = () => finishDrag(true);
    const handlePointerCancel = () => finishDrag(false);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finishDrag(false);
      }
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isReorderDragging, quadrantBuckets, commitReorder]);

  // Matrix screen keyboard shortcuts (spec §2.2)
  useEffect(() => {
    if (!tauri || !board) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingTaskTitleId !== null) return;
      if (isEditableOrOverlayActive(e.target)) return;

      const activeId =
        focusedTaskId ??
        (document.activeElement instanceof HTMLElement
          ? (document.activeElement.closest<HTMLElement>("[data-task-row-id]")?.dataset.taskRowId ??
            null)
          : null);
      const activeTask = activeId ? (tasks.find((item) => item.id === activeId) ?? null) : null;

      const keyLower = e.key.toLowerCase();

      // V toggles Matrix | List
      if (keyLower === "v" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setViewMode((cur) => (cur === "matrix" ? "list" : "matrix"));
        return;
      }

      // Q focuses quick-add
      if (keyLower === "q" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (viewMode === "list") {
          listQuickAddRef.current?.focus();
        } else {
          const targetQ = activeTask?.effective_quadrant ?? "q1";
          setQuickAddQuadrant(targetQ);
          requestAnimationFrame(() => quadrantQuickAddRef.current?.focus());
        }
        return;
      }

      // Z or Ctrl/Cmd+Z triggers Undo
      if (
        keyLower === "z" &&
        !e.altKey &&
        !e.shiftKey &&
        (!e.ctrlKey && !e.metaKey ? true : e.ctrlKey || e.metaKey)
      ) {
        if (undoAction && !undoMut.isPending) {
          e.preventDefault();
          undoMut.mutate();
        }
        return;
      }

      // J / K move focus to next / previous task row
      if ((keyLower === "j" || keyLower === "k") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const rowEls = Array.from(document.querySelectorAll<HTMLElement>("[data-task-row-id]"));
        if (rowEls.length === 0) return;
        e.preventDefault();
        const curIdx = activeId ? rowEls.findIndex((el) => el.dataset.taskRowId === activeId) : -1;
        const nextIdx =
          keyLower === "j"
            ? curIdx < rowEls.length - 1
              ? curIdx + 1
              : 0
            : curIdx > 0
              ? curIdx - 1
              : rowEls.length - 1;
        const nextEl = rowEls[nextIdx];
        if (nextEl) {
          nextEl.focus();
          setFocusedTaskId(nextEl.dataset.taskRowId ?? null);
        }
        return;
      }

      if (!activeTask) return;

      // Alt+ArrowUp / Alt+ArrowDown reorder inside quadrant
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && !e.ctrlKey && !e.metaKey) {
        const qKey = activeTask.effective_quadrant;
        if (!qKey) return;
        e.preventDefault();
        handleStepReorder(qKey, activeTask.id, e.key === "ArrowUp" ? -1 : 1);
        return;
      }

      // Shift+1..4 moves to quadrant Q1..Q4
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const codeMap: Record<string, QuadrantKey> = {
          Digit1: "q1",
          Digit2: "q2",
          Digit3: "q3",
          Digit4: "q4",
        };
        const targetQ = codeMap[e.code];
        if (targetQ) {
          e.preventDefault();
          moveTaskMut.mutate({ id: activeTask.id, quadrant: targetQ });
          return;
        }
      }

      // 1..4 sets priority
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const prioMap: Record<string, TaskPriority> = {
          "1": "high",
          "2": "medium",
          "3": "low",
          "4": "none",
        };
        const prio = prioMap[e.key];
        if (prio) {
          e.preventDefault();
          updateTaskMut.mutate({
            id: activeTask.id,
            input: taskToInput(activeTask, { priority: prio }),
          });
          return;
        }
      }

      // F2 inline edits title
      if (e.key === "F2" && activeTask.completed_at === null) {
        e.preventDefault();
        setEditingTaskTitleId(activeTask.id);
        return;
      }

      // Delete / Backspace soft-deletes
      if ((e.key === "Delete" || e.key === "Backspace") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        deleteTaskMut.mutate(activeTask.id);
        return;
      }

      // Enter opens TaskDetailPanel, Space toggles complete (only when row itself is focused)
      const isRowItself =
        document.activeElement instanceof HTMLElement &&
        document.activeElement.hasAttribute("data-task-row-id");
      if (isRowItself && e.key === "Enter") {
        e.preventDefault();
        setSelectedTaskId(activeTask.id);
      } else if (isRowItself && e.key === " ") {
        e.preventDefault();
        toggleCompleteMut.mutate(activeTask);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    tauri,
    board,
    viewMode,
    focusedTaskId,
    editingTaskTitleId,
    tasks,
    undoAction,
    undoMut,
    handleStepReorder,
    moveTaskMut,
    updateTaskMut,
    deleteTaskMut,
    toggleCompleteMut,
  ]);

  const handleQuickAddPayload = (
    payload: QuickAddSubmitPayload,
    manualQuadrant: QuadrantKey | null,
  ) => {
    createTaskMut.mutate({
      list_id: payload.listId,
      title: payload.title,
      notes: "",
      priority: payload.priority,
      manual_quadrant: manualQuadrant,
      due_date: payload.dueDate,
      scheduled_start_ms: null,
      scheduled_end_ms: null,
      tags: payload.tags,
      deck_id: null,
      sort_order: tasks.length * 10,
    });
  };

  return (
    <div className="relative flex h-full flex-col">
      <ScreenHeader
        title={t("matrix.title")}
        description={t("matrix.description")}
        actions={
          <>
            <div
              role="tablist"
              aria-label={t("matrix.title")}
              className="inline-flex rounded-md border border-border bg-background p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "matrix"}
                onClick={() => setViewMode("matrix")}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  viewMode === "matrix"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <LayoutGrid className="size-3.5" aria-hidden="true" />
                <span>{t("matrix.view.matrix")}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "list"}
                onClick={() => setViewMode("list")}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  viewMode === "list"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <List className="size-3.5" aria-hidden="true" />
                <span>{t("matrix.view.list")}</span>
              </button>
            </div>

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
            {viewMode === "matrix" && (
              <Button
                variant="outline"
                size="sm"
                disabled={!tauri}
                onClick={() => setListsOpen(true)}
              >
                <FolderKanban /> {t("matrix.manageLists")}
              </Button>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={includeCompleted}
              aria-label={t("matrix.showCompleted")}
              disabled={!tauri}
              onClick={() => setIncludeCompleted((v) => !v)}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                includeCompleted
                  ? "bg-primary/15 text-foreground"
                  : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Check className="size-3.5" />
              <span>{t("matrix.showCompleted")}</span>
            </button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">
          {!tauri ? (
            <EmptyState
              icon={LayoutGrid}
              title={t("matrix.noTauri.title")}
              description={t("matrix.noTauri.description")}
            />
          ) : boardQuery.isLoading ? (
            <div
              data-testid="matrix-loading"
              className="mx-auto grid max-w-7xl grid-cols-1 gap-4 md:grid-cols-2"
            >
              {QUADRANT_ORDER.map((k) => (
                <div
                  key={k}
                  className="h-64 animate-pulse rounded-xl border border-border bg-card/70 p-4"
                />
              ))}
            </div>
          ) : boardQuery.isError ? (
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 rounded-xl border border-destructive/40 bg-card p-6 text-sm text-destructive">
              <span>{t("matrix.error")}</span>
              <Button variant="outline" size="sm" onClick={() => void boardQuery.refetch()}>
                {t("matrix.retry")}
              </Button>
            </div>
          ) : board ? (
            <div className="mx-auto max-w-7xl space-y-5">
              {(progress || overdueCount > 0) && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/70 px-3.5 py-2 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-3">
                    {progress && (
                      <span className="tnum font-medium text-foreground">
                        {t("matrix.rewardedToday", {
                          count: formatNumber(progress.tasks_rewarded_today),
                          cap: formatNumber(progress.task_reward_daily_cap),
                        })}
                      </span>
                    )}
                    {progress &&
                      progress.tasks_rewarded_today >= progress.task_reward_daily_cap && (
                        <span
                          data-testid="matrix-reward-cap-notice"
                          className="text-muted-foreground"
                        >
                          {t("matrix.rewardCapReached")}
                        </span>
                      )}
                  </div>
                  {overdueCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={rescheduleOverdueMut.isPending}
                      onClick={() => rescheduleOverdueMut.mutate(board.today_date)}
                    >
                      <CalendarClock className="size-3.5" aria-hidden="true" />
                      <span>
                        {t("matrix.moveOverdueToToday", { count: formatNumber(overdueCount) })}
                      </span>
                    </Button>
                  )}
                </div>
              )}

              {viewMode === "list" ? (
                <TaskListView
                  todayDate={board.today_date}
                  tasks={tasks}
                  deckDueItems={deckDueItems}
                  quadrants={quadrants}
                  taskLists={taskLists}
                  includeCompleted={includeCompleted}
                  selectedTaskId={selectedTaskId}
                  focusedTaskId={focusedTaskId}
                  editingTaskTitleId={editingTaskTitleId}
                  quickAddRef={listQuickAddRef}
                  isCreating={createTaskMut.isPending}
                  onRequestInlineEdit={setEditingTaskTitleId}
                  onSelectTask={(item) => setSelectedTaskId(item.id)}
                  onFocusTask={setFocusedTaskId}
                  onCreateTask={(payload) => handleQuickAddPayload(payload, null)}
                  onToggleComplete={(item) => toggleCompleteMut.mutate(item)}
                  onUpdateTask={(id, input) => updateTaskMut.mutate({ id, input })}
                  onDeleteTask={(item) => deleteTaskMut.mutate(item.id)}
                  onMoveToQuadrant={(id, target) => moveTaskMut.mutate({ id, quadrant: target })}
                  onMoveDeckToQuadrant={(deckId, target) =>
                    moveDeckMut.mutate({ deckId, quadrant: target })
                  }
                  onManageLists={() => setListsOpen(true)}
                />
              ) : (
                <>
                  <div data-testid="matrix-grid" className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {QUADRANT_ORDER.map((key) => {
                      const bucket = quadrantBuckets?.get(key);
                      if (!bucket) return null;
                      const activeDragInQuadrant =
                        reorderDrag?.active && reorderDrag.quadrantKey === key ? reorderDrag : null;

                      return (
                        <MatrixQuadrantCard
                          key={key}
                          quadrantKey={key}
                          quadrant={bucket.quadrant}
                          quadrants={quadrants}
                          groups={bucket.groups}
                          flatTasks={bucket.flatTasks}
                          deckDue={bucket.deckDue}
                          completed={bucket.completed}
                          todayDate={board.today_date}
                          taskLists={taskLists}
                          includeCompleted={includeCompleted}
                          isQuickAdding={quickAddQuadrant === key}
                          isDropTarget={dropQuadrant === key}
                          isCreatingTask={createTaskMut.isPending}
                          selectedTaskId={selectedTaskId}
                          focusedTaskId={focusedTaskId}
                          editingTaskTitleId={editingTaskTitleId}
                          collapsedGroups={collapsedGroups}
                          completedFooterOpen={Boolean(completedFootersOpen[key])}
                          activeDragInsertIndex={activeDragInQuadrant?.insertIndex ?? null}
                          quickAddInputRef={quadrantQuickAddRef}
                          onDragOverQuadrant={() => setDropQuadrant(key)}
                          onDragLeaveQuadrant={() => {
                            if (dropQuadrant === key) setDropQuadrant(null);
                          }}
                          onDropOnQuadrant={(transferId) => {
                            const deckFromTransfer = transferId.startsWith("deck:")
                              ? Number(transferId.slice("deck:".length))
                              : null;
                            const droppedDeckId =
                              deckFromTransfer !== null && Number.isFinite(deckFromTransfer)
                                ? deckFromTransfer
                                : dragDeckId;
                            const droppedTaskId = !droppedDeckId ? transferId || dragTaskId : null;
                            setDropQuadrant(null);
                            setDragTaskId(null);
                            setDragDeckId(null);
                            if (droppedDeckId !== null) {
                              moveDeckMut.mutate({ deckId: droppedDeckId, quadrant: key });
                            } else if (droppedTaskId) {
                              moveTaskMut.mutate({ id: droppedTaskId, quadrant: key });
                            }
                          }}
                          onToggleQuickAdd={() =>
                            setQuickAddQuadrant((cur) => (cur === key ? null : key))
                          }
                          onOpenQuickAdd={() => setQuickAddQuadrant(key)}
                          onCloseQuickAdd={() => setQuickAddQuadrant(null)}
                          onQuickAddSubmit={(payload) => handleQuickAddPayload(payload, key)}
                          onEditQuadrant={() => setEditingQuadrant(bucket.quadrant)}
                          onChangeGroupBy={(group_by) =>
                            saveQuadrantMut.mutate({ ...bucket.quadrant, group_by })
                          }
                          onChangeSortBy={(sort_by) =>
                            saveQuadrantMut.mutate({ ...bucket.quadrant, sort_by })
                          }
                          onToggleGroupCollapse={(groupId) =>
                            setCollapsedGroups((prev) => ({
                              ...prev,
                              [groupId]: !prev[groupId],
                            }))
                          }
                          onToggleCompletedFooter={() =>
                            setCompletedFootersOpen((prev) => ({
                              ...prev,
                              [key]: !prev[key],
                            }))
                          }
                          onRequestInlineEdit={setEditingTaskTitleId}
                          onSelectTask={(item) => setSelectedTaskId(item.id)}
                          onFocusTask={setFocusedTaskId}
                          onToggleComplete={(item) => toggleCompleteMut.mutate(item)}
                          onUpdateTask={(id, input) => updateTaskMut.mutate({ id, input })}
                          onDeleteTask={(item) => deleteTaskMut.mutate(item.id)}
                          onMoveToQuadrant={(id, target) =>
                            moveTaskMut.mutate({ id, quadrant: target })
                          }
                          onReorderStep={(id, delta) => handleStepReorder(key, id, delta)}
                          onReorderPointerDown={(clientY, id, idx) =>
                            setReorderDrag({
                              taskId: id,
                              quadrantKey: key,
                              startY: clientY,
                              active: false,
                              insertIndex: idx,
                            })
                          }
                          onTaskDragStart={(id) => {
                            setDragDeckId(null);
                            setDragTaskId(id);
                          }}
                          onTaskDragEnd={() => {
                            setDragTaskId(null);
                            setDropQuadrant(null);
                          }}
                          onMoveDeckToQuadrant={(deckId, target) =>
                            moveDeckMut.mutate({ deckId, quadrant: target })
                          }
                          onDeckDragStart={(deckId) => {
                            setDragTaskId(null);
                            setDragDeckId(deckId);
                          }}
                          onDeckDragEnd={() => {
                            setDragDeckId(null);
                            setDropQuadrant(null);
                          }}
                        />
                      );
                    })}
                  </div>

                  {unsortedTasks.length > 0 && (
                    <MatrixTaskSection
                      testId="matrix-unsorted"
                      title={t("matrix.unsorted")}
                      hint={t("matrix.unsortedHint")}
                      tasks={unsortedTasks}
                      todayDate={board.today_date}
                      quadrants={quadrants}
                      selectedTaskId={selectedTaskId}
                      focusedTaskId={focusedTaskId}
                      editingTaskTitleId={editingTaskTitleId}
                      onRequestInlineEdit={setEditingTaskTitleId}
                      onSelectTask={(item) => setSelectedTaskId(item.id)}
                      onFocusTask={setFocusedTaskId}
                      onToggleComplete={(item) => toggleCompleteMut.mutate(item)}
                      onUpdateTask={(id, input) => updateTaskMut.mutate({ id, input })}
                      onDeleteTask={(item) => deleteTaskMut.mutate(item.id)}
                      onMoveToQuadrant={(id, target) =>
                        moveTaskMut.mutate({ id, quadrant: target })
                      }
                      onTaskDragStart={(id) => setDragTaskId(id)}
                      onTaskDragEnd={() => {
                        setDragTaskId(null);
                        setDropQuadrant(null);
                      }}
                    />
                  )}

                  {includeCompleted && completedTasks.length > 0 && (
                    <MatrixTaskSection
                      testId="matrix-completed"
                      title={t("matrix.completed")}
                      tasks={completedTasks}
                      todayDate={board.today_date}
                      quadrants={quadrants}
                      selectedTaskId={selectedTaskId}
                      onSelectTask={(item) => setSelectedTaskId(item.id)}
                      onToggleComplete={(item) => toggleCompleteMut.mutate(item)}
                      onUpdateTask={(id, input) => updateTaskMut.mutate({ id, input })}
                      onDeleteTask={(item) => deleteTaskMut.mutate(item.id)}
                      onMoveToQuadrant={(id, target) =>
                        moveTaskMut.mutate({ id, quadrant: target })
                      }
                      onTaskDragStart={(id) => setDragTaskId(id)}
                      onTaskDragEnd={() => {
                        setDragTaskId(null);
                        setDropQuadrant(null);
                      }}
                    />
                  )}
                </>
              )}
            </div>
          ) : null}
        </div>

        {board && (
          <TaskDetailPanel
            task={selectedTask}
            todayDate={board.today_date}
            taskLists={taskLists}
            decks={decks}
            onUpdateTask={(id, input) => updateTaskMut.mutate({ id, input })}
            onDeleteTask={(id) => deleteTaskMut.mutate(id)}
            onClose={() => setSelectedTaskId(null)}
          />
        )}
      </div>

      {editingQuadrant && (
        <EditMatrixDialog
          key={editingQuadrant.quadrant_key}
          open={true}
          quadrant={editingQuadrant}
          taskLists={taskLists}
          decks={decks}
          onSave={async (updated) => {
            await saveQuadrantMut.mutateAsync(updated);
          }}
          onRestoreDefaults={async (key) => {
            await restoreQuadrantMut.mutateAsync(key);
          }}
          onClose={() => setEditingQuadrant(null)}
        />
      )}

      <TaskListManagerDialog
        open={listsOpen}
        lists={taskLists}
        onCreate={async (input) => {
          await createListMut.mutateAsync(input);
        }}
        onUpdate={async (id, input) => {
          await updateListMut.mutateAsync({ id, input });
        }}
        onDelete={async (id) => {
          await deleteListMut.mutateAsync(id);
        }}
        onClose={() => setListsOpen(false)}
      />
    </div>
  );
}
