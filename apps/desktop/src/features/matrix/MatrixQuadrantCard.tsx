import { Fragment, type RefObject } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type {
  MatrixDeckDueItemDto,
  MatrixGroupBy,
  MatrixQuadrantDto,
  MatrixSortBy,
  QuadrantKey,
  TaskDto,
  TaskInput,
  TaskListDto,
} from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { DeckDueCard } from "./DeckDueCard";
import { QuadrantHeaderMenu } from "./QuadrantHeaderMenu";
import { QuickAddBar, type QuickAddSubmitPayload } from "./QuickAddBar";
import { TaskRow } from "./TaskRow";
import { quadrantBadgeClass, quadrantDisplayTitle, quadrantRoman } from "./matrixHelpers";
import { quadrantQuickAddDefaults } from "./quickAddParser";

interface TaskGroup {
  key: string;
  label: string | null;
  tasks: TaskDto[];
}

interface MatrixQuadrantCardProps {
  quadrantKey: QuadrantKey;
  quadrant: MatrixQuadrantDto;
  quadrants: MatrixQuadrantDto[];
  groups: TaskGroup[];
  flatTasks: TaskDto[];
  deckDue: MatrixDeckDueItemDto[];
  completed: TaskDto[];
  todayDate: string;
  taskLists: TaskListDto[];
  includeCompleted: boolean;
  isQuickAdding: boolean;
  isDropTarget: boolean;
  isCreatingTask: boolean;
  selectedTaskId: string | null;
  focusedTaskId: string | null;
  editingTaskTitleId: string | null;
  collapsedGroups: Record<string, boolean>;
  completedFooterOpen: boolean;
  activeDragInsertIndex: number | null;
  quickAddInputRef: RefObject<HTMLInputElement | null>;
  onDragOverQuadrant: () => void;
  onDragLeaveQuadrant: () => void;
  onDropOnQuadrant: (transferId: string) => void;
  onToggleQuickAdd: () => void;
  onOpenQuickAdd: () => void;
  onCloseQuickAdd: () => void;
  onQuickAddSubmit: (payload: QuickAddSubmitPayload) => void;
  onEditQuadrant: () => void;
  onChangeGroupBy: (groupBy: MatrixGroupBy) => void;
  onChangeSortBy: (sortBy: MatrixSortBy) => void;
  onToggleGroupCollapse: (groupId: string) => void;
  onToggleCompletedFooter: () => void;
  onRequestInlineEdit: (taskId: string | null) => void;
  onSelectTask: (task: TaskDto) => void;
  onFocusTask: (taskId: string | null) => void;
  onToggleComplete: (task: TaskDto) => void;
  onUpdateTask: (id: string, input: TaskInput) => void;
  onDeleteTask: (task: TaskDto) => void;
  onMoveToQuadrant: (id: string, target: QuadrantKey) => void;
  onReorderStep: (id: string, delta: -1 | 1) => void;
  onReorderPointerDown: (clientY: number, id: string, index: number) => void;
  onTaskDragStart: (id: string) => void;
  onTaskDragEnd: () => void;
  onMoveDeckToQuadrant: (deckId: number, target: QuadrantKey) => void;
  onDeckDragStart: (deckId: number) => void;
  onDeckDragEnd: () => void;
}

export function MatrixQuadrantCard({
  quadrantKey,
  quadrant,
  quadrants,
  groups,
  flatTasks,
  deckDue,
  completed,
  todayDate,
  taskLists,
  includeCompleted,
  isQuickAdding,
  isDropTarget,
  isCreatingTask,
  selectedTaskId,
  focusedTaskId,
  editingTaskTitleId,
  collapsedGroups,
  completedFooterOpen,
  activeDragInsertIndex,
  quickAddInputRef,
  onDragOverQuadrant,
  onDragLeaveQuadrant,
  onDropOnQuadrant,
  onToggleQuickAdd,
  onOpenQuickAdd,
  onCloseQuickAdd,
  onQuickAddSubmit,
  onEditQuadrant,
  onChangeGroupBy,
  onChangeSortBy,
  onToggleGroupCollapse,
  onToggleCompletedFooter,
  onRequestInlineEdit,
  onSelectTask,
  onFocusTask,
  onToggleComplete,
  onUpdateTask,
  onDeleteTask,
  onMoveToQuadrant,
  onReorderStep,
  onReorderPointerDown,
  onTaskDragStart,
  onTaskDragEnd,
  onMoveDeckToQuadrant,
  onDeckDragStart,
  onDeckDragEnd,
}: MatrixQuadrantCardProps) {
  const qTitle = quadrantDisplayTitle(quadrant);
  const totalCount = flatTasks.length + deckDue.length;
  const defaults = quadrantQuickAddDefaults(quadrant, todayDate);

  let flatIdxCounter = 0;

  return (
    <section
      data-testid={`quadrant-${quadrantKey}`}
      aria-label={qTitle}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverQuadrant();
      }}
      onDragLeave={onDragLeaveQuadrant}
      onDrop={(e) => {
        e.preventDefault();
        onDropOnQuadrant(e.dataTransfer.getData("text/plain"));
      }}
      className={cn(
        "flex min-h-[260px] flex-col rounded-xl border bg-card p-4 transition-colors",
        isDropTarget ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <header className="scholar-heading-rule mb-3 flex items-center justify-between gap-2 border-b border-border/60 pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md px-1.5 text-xs font-semibold",
              quadrantBadgeClass(quadrant.color_token),
            )}
          >
            {quadrantRoman(quadrantKey)}
          </span>
          <h2 className="truncate text-sm font-semibold text-foreground">{qTitle}</h2>
          <span className="tnum rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
            {formatNumber(totalCount)}
          </span>
          {quadrant.sort_by === "manual" && (
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t("matrix.sortedManually")}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            aria-label={t("matrix.quickAdd", { quadrant: qTitle })}
            onClick={onToggleQuickAdd}
          >
            <Plus className="size-4" />
          </Button>
          <QuadrantHeaderMenu
            quadrant={quadrant}
            title={qTitle}
            onEdit={onEditQuadrant}
            onChangeGroupBy={onChangeGroupBy}
            onChangeSortBy={onChangeSortBy}
          />
        </div>
      </header>

      {isQuickAdding && (
        <QuickAddBar
          todayDate={todayDate}
          taskLists={taskLists}
          defaultPriority={defaults.defaultPriority}
          defaultDueDate={defaults.defaultDueDate}
          autoFocus
          isPending={isCreatingTask}
          inputRef={quickAddInputRef}
          onSubmit={onQuickAddSubmit}
          onCancel={onCloseQuickAdd}
          className="mb-3"
        />
      )}

      <div data-quadrant-tasks={quadrantKey} className="flex-1 space-y-2">
        {totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <p className="text-xs text-muted-foreground">{t("matrix.noTasks")}</p>
            {!isQuickAdding && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-muted-foreground"
                onClick={onOpenQuickAdd}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                <span>{t("matrix.quickAddSubmit")}</span>
              </Button>
            )}
          </div>
        ) : (
          <>
            {groups.map((group) => {
              const groupId = `${quadrantKey}:${group.key}`;
              const isCollapsed = Boolean(collapsedGroups[groupId]);
              return (
                <div key={group.key} className="space-y-1.5">
                  {group.label && (
                    <button
                      type="button"
                      aria-expanded={!isCollapsed}
                      aria-label={t("matrix.group.toggleAria", {
                        name: group.label,
                      })}
                      onClick={() => onToggleGroupCollapse(groupId)}
                      className="flex items-center gap-1 px-1 pt-1 text-[11px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronDown
                        className={cn(
                          "size-3 transition-transform",
                          isCollapsed && "-rotate-90 rtl:rotate-90",
                        )}
                        aria-hidden="true"
                      />
                      <span>{group.label}</span>
                    </button>
                  )}
                  {!isCollapsed &&
                    group.tasks.map((task) => {
                      const myIdx = flatIdxCounter;
                      flatIdxCounter += 1;
                      const showLineBefore =
                        activeDragInsertIndex !== null && activeDragInsertIndex === myIdx;
                      const showLineAfter =
                        activeDragInsertIndex !== null &&
                        myIdx === flatTasks.length - 1 &&
                        activeDragInsertIndex >= flatTasks.length;

                      return (
                        <Fragment key={task.id}>
                          {showLineBefore && (
                            <div
                              data-testid="reorder-insertion-line"
                              className="h-0.5 w-full rounded-full bg-primary"
                            />
                          )}
                          <TaskRow
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
                            onReorderStep={onReorderStep}
                            canMoveUp={myIdx > 0}
                            canMoveDown={myIdx < flatTasks.length - 1}
                            onReorderPointerDown={(e, id) =>
                              onReorderPointerDown(e.clientY, id, myIdx)
                            }
                            onDragStart={(e, id) => {
                              e.dataTransfer.setData("text/plain", id);
                              onTaskDragStart(id);
                            }}
                            onDragEnd={onTaskDragEnd}
                          />
                          {showLineAfter && (
                            <div
                              data-testid="reorder-insertion-line"
                              className="h-0.5 w-full rounded-full bg-primary"
                            />
                          )}
                        </Fragment>
                      );
                    })}
                </div>
              );
            })}

            {deckDue.map((deckItem) => (
              <DeckDueCard
                key={deckItem.deck_id}
                deckItem={deckItem}
                quadrants={quadrants}
                onMoveToQuadrant={onMoveDeckToQuadrant}
                onEditRule={onEditQuadrant}
                onDragStart={(e, deckId) => {
                  e.dataTransfer.setData("text/plain", `deck:${deckId}`);
                  onDeckDragStart(deckId);
                }}
                onDragEnd={onDeckDragEnd}
              />
            ))}
          </>
        )}
      </div>

      {includeCompleted && completed.length > 0 && (
        <div className="mt-3 border-t border-border/60 pt-2">
          <button
            type="button"
            data-testid={`quadrant-completed-${quadrantKey}`}
            aria-expanded={completedFooterOpen}
            onClick={onToggleCompletedFooter}
            className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>
              {t("matrix.completedToggle", {
                count: formatNumber(completed.length),
              })}
            </span>
            <ChevronDown
              className={cn("size-3.5 transition-transform", completedFooterOpen && "rotate-180")}
              aria-hidden="true"
            />
          </button>
          {completedFooterOpen && (
            <div className="mt-2 space-y-1.5">
              {completed.map((doneTask) => (
                <TaskRow
                  key={doneTask.id}
                  task={doneTask}
                  todayDate={todayDate}
                  quadrants={quadrants}
                  isSelected={selectedTaskId === doneTask.id}
                  onSelectTask={onSelectTask}
                  onToggleComplete={onToggleComplete}
                  onUpdateTask={onUpdateTask}
                  onDelete={onDeleteTask}
                  onMoveToQuadrant={onMoveToQuadrant}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
