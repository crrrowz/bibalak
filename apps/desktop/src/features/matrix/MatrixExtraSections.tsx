import type { MatrixQuadrantDto, QuadrantKey, TaskDto, TaskInput } from "@bibalak/ipc-types";
import { formatNumber } from "@/lib/i18n";
import { TaskRow } from "./TaskRow";

interface MatrixTaskSectionProps {
  testId: string;
  title: string;
  hint?: string;
  tasks: TaskDto[];
  todayDate: string;
  quadrants: MatrixQuadrantDto[];
  selectedTaskId: string | null;
  focusedTaskId?: string | null;
  editingTaskTitleId?: string | null;
  onRequestInlineEdit?: (taskId: string | null) => void;
  onSelectTask: (task: TaskDto) => void;
  onFocusTask?: (taskId: string | null) => void;
  onToggleComplete: (task: TaskDto) => void;
  onUpdateTask: (id: string, input: TaskInput) => void;
  onDeleteTask: (task: TaskDto) => void;
  onMoveToQuadrant: (id: string, target: QuadrantKey) => void;
  onTaskDragStart: (id: string) => void;
  onTaskDragEnd: () => void;
}

export function MatrixTaskSection({
  testId,
  title,
  hint,
  tasks,
  todayDate,
  quadrants,
  selectedTaskId,
  focusedTaskId,
  editingTaskTitleId,
  onRequestInlineEdit,
  onSelectTask,
  onFocusTask,
  onToggleComplete,
  onUpdateTask,
  onDeleteTask,
  onMoveToQuadrant,
  onTaskDragStart,
  onTaskDragEnd,
}: MatrixTaskSectionProps) {
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <span className="tnum rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
            {formatNumber(tasks.length)}
          </span>
        </div>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {tasks.map((task) => (
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
            onDragStart={(e, id) => {
              e.dataTransfer.setData("text/plain", id);
              onTaskDragStart(id);
            }}
            onDragEnd={onTaskDragEnd}
          />
        ))}
      </div>
    </section>
  );
}
