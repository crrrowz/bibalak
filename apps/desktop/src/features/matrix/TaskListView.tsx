import { useMemo, useState, type RefObject } from "react";
import { ChevronDown, FolderKanban, ListChecks } from "lucide-react";
import type {
  MatrixDeckDueItemDto,
  MatrixQuadrantDto,
  QuadrantKey,
  TaskDto,
  TaskInput,
  TaskListDto,
} from "@bibalak/ipc-types";
import { EmptyState } from "@/components/EmptyState";
import { EmptyStatePicture } from "@/components/illustrations/EmptyStatePicture";
import { formatNumber, t } from "@/lib/i18n";
import { useStyle } from "@/stores/style";
import { cn } from "@/lib/utils";
import { DeckDueCard } from "./DeckDueCard";
import { QuickAddBar, type QuickAddSubmitPayload } from "./QuickAddBar";
import { TaskRow } from "./TaskRow";
import { sortTasks } from "./matrixHelpers";

export type ListSmartFilter =
  | { kind: "today" }
  | { kind: "inbox" }
  | { kind: "all" }
  | { kind: "list"; listId: string };

interface TaskListViewProps {
  todayDate: string;
  tasks: TaskDto[];
  deckDueItems: MatrixDeckDueItemDto[];
  quadrants: MatrixQuadrantDto[];
  taskLists: TaskListDto[];
  includeCompleted: boolean;
  selectedTaskId: string | null;
  focusedTaskId: string | null;
  editingTaskTitleId: string | null;
  quickAddRef: RefObject<HTMLInputElement | null>;
  isCreating: boolean;
  onRequestInlineEdit: (taskId: string | null) => void;
  onSelectTask: (task: TaskDto) => void;
  onFocusTask: (taskId: string) => void;
  onCreateTask: (payload: QuickAddSubmitPayload) => void;
  onToggleComplete: (task: TaskDto) => void;
  onUpdateTask: (id: string, input: TaskInput) => void;
  onDeleteTask: (task: TaskDto) => void;
  onMoveToQuadrant: (id: string, quadrant: QuadrantKey) => void;
  onMoveDeckToQuadrant?: (deckId: number, quadrant: QuadrantKey) => void;
  onManageLists: () => void;
}

export function TaskListView({
  todayDate,
  tasks,
  deckDueItems,
  quadrants,
  taskLists,
  includeCompleted,
  selectedTaskId,
  focusedTaskId,
  editingTaskTitleId,
  quickAddRef,
  isCreating,
  onRequestInlineEdit,
  onSelectTask,
  onFocusTask,
  onCreateTask,
  onToggleComplete,
  onUpdateTask,
  onDeleteTask,
  onMoveToQuadrant,
  onMoveDeckToQuadrant,
  onManageLists,
}: TaskListViewProps) {
  const style = useStyle((s) => s.style);
  const [filter, setFilter] = useState<ListSmartFilter>({ kind: "today" });
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const activeFilter: ListSmartFilter = useMemo(() => {
    if (filter.kind === "list" && !taskLists.some((l) => l.id === filter.listId)) {
      return { kind: "all" };
    }
    return filter;
  }, [filter, taskLists]);

  const visibleTasks = useMemo(() => {
    const base = includeCompleted ? tasks : tasks.filter((item) => item.completed_at === null);
    switch (activeFilter.kind) {
      case "today":
        return sortTasks(
          base.filter((item) => item.due_date !== null && item.due_date <= todayDate),
          "date",
        );
      case "inbox":
        return sortTasks(
          base.filter((item) => item.list_id === null),
          "date",
        );
      case "all":
        return sortTasks(base, "date");
      case "list":
        return sortTasks(
          base.filter((item) => item.list_id === activeFilter.listId),
          "date",
        );
    }
  }, [tasks, includeCompleted, activeFilter, todayDate]);

  const overdueTodayTasks = useMemo(
    () =>
      activeFilter.kind === "today"
        ? visibleTasks.filter(
            (item) =>
              item.completed_at === null && item.due_date !== null && item.due_date < todayDate,
          )
        : [],
    [activeFilter.kind, visibleTasks, todayDate],
  );

  const dueTodayOrCompletedTasks = useMemo(
    () =>
      activeFilter.kind === "today"
        ? visibleTasks.filter(
            (item) =>
              !(item.completed_at === null && item.due_date !== null && item.due_date < todayDate),
          )
        : visibleTasks,
    [activeFilter.kind, visibleTasks, todayDate],
  );

  const activeDeckDue = activeFilter.kind === "today" ? deckDueItems : [];

  const activeListName = useMemo(() => {
    switch (activeFilter.kind) {
      case "today":
        return t("matrix.list.today");
      case "inbox":
        return t("matrix.list.inbox");
      case "all":
        return t("matrix.list.all");
      case "list":
        return taskLists.find((l) => l.id === activeFilter.listId)?.name ?? t("matrix.list.all");
    }
  }, [activeFilter, taskLists]);

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderRow = (task: TaskDto) => (
    <TaskRow
      key={task.id}
      task={task}
      todayDate={todayDate}
      quadrants={quadrants}
      isSelected={selectedTaskId === task.id}
      isFocused={focusedTaskId === task.id}
      isEditingTitle={editingTaskTitleId === task.id}
      onRequestInlineEdit={onRequestInlineEdit}
      onSelectTask={onSelectTask}
      onFocusTask={onFocusTask}
      onToggleComplete={onToggleComplete}
      onUpdateTask={onUpdateTask}
      onDelete={onDeleteTask}
      onMoveToQuadrant={onMoveToQuadrant}
    />
  );

  const isCompletelyEmpty = visibleTasks.length === 0 && activeDeckDue.length === 0;

  return (
    <div data-testid="matrix-list-view" className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { key: "today", label: t("matrix.list.today"), filter: { kind: "today" } },
            { key: "inbox", label: t("matrix.list.inbox"), filter: { kind: "inbox" } },
            { key: "all", label: t("matrix.list.all"), filter: { kind: "all" } },
          ] as const
        ).map((pill) => {
          const active = activeFilter.kind === pill.key;
          return (
            <button
              key={pill.key}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(pill.filter)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {pill.label}
            </button>
          );
        })}

        {taskLists.map((list) => {
          const active = activeFilter.kind === "list" && activeFilter.listId === list.id;
          return (
            <button
              key={list.id}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter({ kind: "list", listId: list.id })}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {list.name}
            </button>
          );
        })}

        <button
          type="button"
          onClick={onManageLists}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FolderKanban className="size-3.5" aria-hidden="true" />
          <span>{t("matrix.manageLists")}</span>
        </button>
      </div>

      <QuickAddBar
        todayDate={todayDate}
        taskLists={taskLists}
        defaultDueDate={activeFilter.kind === "today" ? todayDate : null}
        defaultListId={activeFilter.kind === "list" ? activeFilter.listId : null}
        placeholder={t("matrix.quickAdd.listPlaceholder", { view: activeListName })}
        isPending={isCreating}
        inputRef={quickAddRef}
        onSubmit={onCreateTask}
        className="rounded-xl border border-border bg-card p-3"
      />

      {isCompletelyEmpty ? (
        style === "default" ? (
          <EmptyState
            icon={ListChecks}
            title={t("matrix.list.emptyTitle")}
            description={t("matrix.list.emptyDesc")}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-8 text-center">
            <EmptyStatePicture scene="tasks" style={style} />
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-foreground">
                {t("matrix.list.emptyTitle")}
              </h2>
              <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
                {t("matrix.list.emptyDesc")}
              </p>
            </div>
          </div>
        )
      ) : activeFilter.kind === "today" ? (
        <div className="space-y-4">
          {overdueTodayTasks.length > 0 && (
            <section className="space-y-1.5">
              <button
                type="button"
                aria-expanded={!collapsedSections.overdue}
                aria-label={t("matrix.group.toggleAria", { name: t("matrix.list.overdueHeading") })}
                onClick={() => toggleSection("overdue")}
                className="flex items-center gap-1.5 px-1 text-xs font-semibold text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform",
                    collapsedSections.overdue && "-rotate-90 rtl:rotate-90",
                  )}
                  aria-hidden="true"
                />
                <span>{t("matrix.list.overdueHeading")}</span>
                <span className="tnum text-muted-foreground">
                  ({formatNumber(overdueTodayTasks.length)})
                </span>
              </button>
              {!collapsedSections.overdue && (
                <div className="space-y-1.5">{overdueTodayTasks.map(renderRow)}</div>
              )}
            </section>
          )}

          {(dueTodayOrCompletedTasks.length > 0 || activeDeckDue.length > 0) && (
            <section className="space-y-1.5">
              <button
                type="button"
                aria-expanded={!collapsedSections.today}
                aria-label={t("matrix.group.toggleAria", { name: t("matrix.list.todayHeading") })}
                onClick={() => toggleSection("today")}
                className="flex items-center gap-1.5 px-1 text-xs font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform",
                    collapsedSections.today && "-rotate-90 rtl:rotate-90",
                  )}
                  aria-hidden="true"
                />
                <span>{t("matrix.list.todayHeading")}</span>
                <span className="tnum">
                  ({formatNumber(dueTodayOrCompletedTasks.length + activeDeckDue.length)})
                </span>
              </button>
              {!collapsedSections.today && (
                <div className="space-y-1.5">
                  {dueTodayOrCompletedTasks.map(renderRow)}
                  {activeDeckDue.map((deckItem) => (
                    <DeckDueCard
                      key={deckItem.deck_id}
                      deckItem={deckItem}
                      quadrants={quadrants}
                      onMoveToQuadrant={onMoveDeckToQuadrant}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">{visibleTasks.map(renderRow)}</div>
      )}
    </div>
  );
}
