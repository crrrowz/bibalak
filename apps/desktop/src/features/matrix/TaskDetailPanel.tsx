import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type {
  DeckSummary,
  TaskDto,
  TaskInput,
  TaskListDto,
  TaskPriority,
} from "@bibalak/ipc-types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SidePanel } from "@/components/ui/side-panel";
import { t } from "@/lib/i18n";
import { dateAndTimeToMs, msToDateInput, msToTimeInput, taskToInput } from "./matrixHelpers";

interface TaskDetailPanelProps {
  task: TaskDto | null;
  todayDate: string;
  taskLists: TaskListDto[];
  decks: DeckSummary[];
  onUpdateTask: (id: string, input: TaskInput) => void;
  onDeleteTask: (id: string) => void;
  onClose: () => void;
}

interface DraftState {
  title: string;
  notes: string;
  priority: TaskPriority;
  dueDate: string;
  startTime: string;
  endTime: string;
  listId: string;
  deckId: string;
  tags: string[];
}

function draftFromTask(task: TaskDto): DraftState {
  return {
    title: task.title,
    notes: task.notes,
    priority: task.priority,
    dueDate: task.due_date ?? "",
    startTime: task.scheduled_start_ms !== null ? msToTimeInput(task.scheduled_start_ms) : "",
    endTime: task.scheduled_end_ms !== null ? msToTimeInput(task.scheduled_end_ms) : "",
    listId: task.list_id ?? "",
    deckId: task.deck_id !== null ? String(task.deck_id) : "",
    tags: [...task.tags],
  };
}

function buildInputFromDraft(
  task: TaskDto,
  draft: DraftState,
  todayDate: string,
): TaskInput | null {
  const title = draft.title.trim();
  if (!title) return null;

  let scheduledStartMs: number | null = null;
  let scheduledEndMs: number | null = null;
  if (draft.startTime && draft.endTime) {
    const baseDate =
      draft.dueDate ||
      (task.scheduled_start_ms !== null ? msToDateInput(task.scheduled_start_ms) : todayDate);
    const s = dateAndTimeToMs(baseDate, draft.startTime);
    const e = dateAndTimeToMs(baseDate, draft.endTime);
    if (e > s) {
      scheduledStartMs = s;
      scheduledEndMs = e;
    }
  }

  return taskToInput(task, {
    title,
    notes: draft.notes,
    priority: draft.priority,
    due_date: draft.dueDate.trim() || null,
    scheduled_start_ms: scheduledStartMs,
    scheduled_end_ms: scheduledEndMs,
    list_id: draft.listId || null,
    deck_id: draft.deckId ? Number(draft.deckId) : null,
    tags: draft.tags,
  });
}

function inputsDiffer(a: TaskInput, task: TaskDto): boolean {
  return (
    a.title !== task.title ||
    a.notes !== task.notes ||
    a.priority !== task.priority ||
    a.due_date !== task.due_date ||
    a.scheduled_start_ms !== task.scheduled_start_ms ||
    a.scheduled_end_ms !== task.scheduled_end_ms ||
    a.list_id !== task.list_id ||
    a.deck_id !== task.deck_id ||
    a.tags.length !== task.tags.length ||
    a.tags.some((tag, idx) => tag !== task.tags[idx])
  );
}

export function TaskDetailPanel({
  task,
  todayDate,
  taskLists,
  decks,
  onUpdateTask,
  onDeleteTask,
  onClose,
}: TaskDetailPanelProps) {
  const titleId = useId();
  const notesId = useId();
  const priorityId = useId();
  const dueDateId = useId();
  const startTimeId = useId();
  const endTimeId = useId();
  const listId = useId();
  const deckId = useId();
  const tagInputId = useId();

  const [draft, setDraft] = useState<DraftState | null>(() => (task ? draftFromTask(task) : null));
  const [newTag, setNewTag] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const prevTaskRef = useRef<TaskDto | null>(null);
  const draftRef = useRef<DraftState | null>(draft);
  draftRef.current = draft;

  const commitDraft = useCallback(
    (targetTask: TaskDto | null, targetDraft: DraftState | null) => {
      if (!targetTask || !targetDraft) return;
      const nextInput = buildInputFromDraft(targetTask, targetDraft, todayDate);
      if (nextInput && inputsDiffer(nextInput, targetTask)) {
        onUpdateTask(targetTask.id, nextInput);
      }
    },
    [onUpdateTask, todayDate],
  );

  // Commit pending draft when switching selected task, then load the new task.
  useEffect(() => {
    const prevTask = prevTaskRef.current;
    if (prevTask && task && prevTask.id !== task.id) {
      commitDraft(prevTask, draftRef.current);
    }
    prevTaskRef.current = task;
    setDraft(task ? draftFromTask(task) : null);
    setNewTag("");
    setConfirmDeleteOpen(false);
  }, [task, commitDraft]);

  const handleClose = () => {
    commitDraft(task, draftRef.current);
    onClose();
  };

  const commitWithPatch = (patch: Partial<DraftState>) => {
    if (!task || !draft) return;
    const nextDraft = { ...draft, ...patch };
    setDraft(nextDraft);
    commitDraft(task, nextDraft);
  };

  const handleAddTag = () => {
    if (!draft) return;
    const cleaned = newTag.trim().replace(/^#+/, "");
    if (!cleaned) return;
    if (!draft.tags.some((tg) => tg.toLowerCase() === cleaned.toLowerCase())) {
      commitWithPatch({ tags: [...draft.tags, cleaned] });
    }
    setNewTag("");
  };

  return (
    <SidePanel
      open={task !== null}
      title={t("matrix.detail.title")}
      width={360}
      onClose={handleClose}
    >
      {task && draft && (
        <div
          className="space-y-4 p-4"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              commitDraft(task, draft);
            }
          }}
        >
          <div className="space-y-1">
            <label htmlFor={titleId} className="block text-xs font-medium text-foreground">
              {t("matrix.taskDialog.titleLabel")}
            </label>
            <input
              id={titleId}
              type="text"
              dir="auto"
              value={draft.title}
              onChange={(e) => setDraft((d) => (d ? { ...d, title: e.target.value } : d))}
              onBlur={() => commitDraft(task, draft)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor={notesId} className="block text-xs font-medium text-foreground">
              {t("matrix.taskDialog.notesLabel")}
            </label>
            <textarea
              id={notesId}
              rows={3}
              dir="auto"
              value={draft.notes}
              onChange={(e) => setDraft((d) => (d ? { ...d, notes: e.target.value } : d))}
              onBlur={() => commitDraft(task, draft)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={priorityId} className="block text-xs font-medium text-foreground">
                {t("matrix.taskDialog.priorityLabel")}
              </label>
              <Select
                id={priorityId}
                value={draft.priority}
                onChange={(e) => commitWithPatch({ priority: e.target.value as TaskPriority })}
              >
                <option value="high">{t("matrix.priority.high")}</option>
                <option value="medium">{t("matrix.priority.medium")}</option>
                <option value="low">{t("matrix.priority.low")}</option>
                <option value="none">{t("matrix.priority.none")}</option>
              </Select>
            </div>

            <div className="space-y-1">
              <label htmlFor={dueDateId} className="block text-xs font-medium text-foreground">
                {t("matrix.taskDialog.dueDateLabel")}
              </label>
              <div className="flex items-center gap-1">
                <input
                  id={dueDateId}
                  type="date"
                  value={draft.dueDate}
                  onChange={(e) => commitWithPatch({ dueDate: e.target.value })}
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {draft.dueDate && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 px-2 text-xs"
                    onClick={() => commitWithPatch({ dueDate: "" })}
                  >
                    {t("matrix.taskDialog.clearDate")}
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                {t("matrix.detail.scheduleLabel")}
              </span>
              {(draft.startTime || draft.endTime) && (
                <button
                  type="button"
                  onClick={() => commitWithPatch({ startTime: "", endTime: "" })}
                  className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {t("matrix.detail.clearSchedule")}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                id={startTimeId}
                type="time"
                aria-label={t("matrix.detail.scheduleStart")}
                value={draft.startTime}
                onChange={(e) => setDraft((d) => (d ? { ...d, startTime: e.target.value } : d))}
                onBlur={() => commitDraft(task, draft)}
                className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <input
                id={endTimeId}
                type="time"
                aria-label={t("matrix.detail.scheduleEnd")}
                value={draft.endTime}
                onChange={(e) => setDraft((d) => (d ? { ...d, endTime: e.target.value } : d))}
                onBlur={() => commitDraft(task, draft)}
                className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={listId} className="block text-xs font-medium text-foreground">
                {t("matrix.taskDialog.listLabel")}
              </label>
              <Select
                id={listId}
                value={draft.listId}
                onChange={(e) => commitWithPatch({ listId: e.target.value })}
              >
                <option value="">{t("matrix.task.inbox")}</option>
                {taskLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1">
              <label htmlFor={deckId} className="block text-xs font-medium text-foreground">
                {t("matrix.taskDialog.deckLabel")}
              </label>
              <Select
                id={deckId}
                value={draft.deckId}
                onChange={(e) => commitWithPatch({ deckId: e.target.value })}
              >
                <option value="">{t("matrix.taskDialog.noDeck")}</option>
                {decks
                  .filter((d) => !d.is_filtered)
                  .map((d) => (
                    <option key={d.id} value={String(d.id)}>
                      {d.name}
                    </option>
                  ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={tagInputId} className="block text-xs font-medium text-foreground">
              {t("matrix.taskDialog.tagsLabel")}
            </label>
            {draft.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {draft.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/60 px-2 py-0.5 text-xs text-secondary-foreground"
                  >
                    <span dir="auto">#{tag}</span>
                    <button
                      type="button"
                      aria-label={t("matrix.detail.removeTag", { tag })}
                      onClick={() =>
                        commitWithPatch({ tags: draft.tags.filter((item) => item !== tag) })
                      }
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <input
                id={tagInputId}
                type="text"
                dir="auto"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    handleAddTag();
                  }
                }}
                placeholder={t("matrix.detail.addTagPlaceholder")}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2"
                aria-label={t("matrix.detail.addTag")}
                disabled={!newTag.trim()}
                onClick={handleAddTag}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-center gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              <span>{t("matrix.task.delete")}</span>
            </Button>
          </div>

          <ConfirmDialog
            open={confirmDeleteOpen}
            title={t("matrix.detail.deleteConfirmTitle")}
            description={t("matrix.detail.deleteConfirmDesc", { title: task.title })}
            onConfirm={() => {
              setConfirmDeleteOpen(false);
              onDeleteTask(task.id);
              onClose();
            }}
            onCancel={() => setConfirmDeleteOpen(false)}
          />
        </div>
      )}
    </SidePanel>
  );
}
