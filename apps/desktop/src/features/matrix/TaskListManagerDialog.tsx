import { useId, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { TaskListDto, TaskListInput } from "@bibalak/ipc-types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/ipc";
import { t } from "@/lib/i18n";
import type { AsyncHandler } from "./matrixHelpers";

interface TaskListManagerDialogProps {
  open: boolean;
  lists: TaskListDto[];
  onCreate: AsyncHandler<[TaskListInput]>;
  onUpdate: AsyncHandler<[string, TaskListInput]>;
  onDelete: AsyncHandler<[string]>;
  onClose: () => void;
}

export function TaskListManagerDialog({
  open,
  lists,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
}: TaskListManagerDialogProps) {
  const titleId = useId();
  const newListId = useId();
  const renameInputId = useId();

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await onCreate({
        name: newName.trim(),
        color_token: "accent",
        icon_key: null,
        sort_order: lists.length,
      });
      setNewName("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (e: React.FormEvent, list: TaskListDto) => {
    e.preventDefault();
    if (!editingName.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await onUpdate(list.id, {
        name: editingName.trim(),
        color_token: list.color_token,
        icon_key: list.icon_key,
        sort_order: list.sort_order,
      });
      setEditingId(null);
      setEditingName("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    setBusy(true);
    try {
      await onDelete(id);
      if (editingId === id) {
        setEditingId(null);
        setEditingName("");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} ariaLabelledBy={titleId} className="max-w-md">
      <div className="space-y-4 p-5">
        <div>
          <h2 id={titleId} className="text-base font-semibold text-foreground">
            {t("matrix.listsDialog.title")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("matrix.listsDialog.fallbackHint")}
          </p>
        </div>

        <form onSubmit={(e) => void handleCreate(e)} className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <label htmlFor={newListId} className="block text-xs font-medium text-foreground">
              {t("matrix.listsDialog.newLabel")}
            </label>
            <input
              id={newListId}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("matrix.listsDialog.newPlaceholder")}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <Button type="submit" size="sm" disabled={busy || !newName.trim()}>
            <Plus className="size-4" />
            <span>{t("matrix.listsDialog.add")}</span>
          </Button>
        </form>

        {lists.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">
            {t("matrix.listsDialog.empty")}
          </p>
        ) : (
          <ul className="max-h-60 space-y-1.5 overflow-y-auto">
            {lists.map((list) => (
              <li
                key={list.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2"
              >
                {editingId === list.id ? (
                  <form
                    onSubmit={(e) => void handleRename(e, list)}
                    className="flex flex-1 items-center gap-2"
                  >
                    <input
                      id={renameInputId}
                      aria-label={t("matrix.listsDialog.renameLabel")}
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      autoFocus
                      className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <Button type="submit" size="sm" disabled={busy || !editingName.trim()}>
                      {t("matrix.listsDialog.save")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingId(null);
                        setEditingName("");
                      }}
                    >
                      {t("matrix.listsDialog.cancel")}
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="truncate text-sm font-medium text-foreground">
                      {list.name}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t("matrix.listsDialog.renameButton", { name: list.name })}
                        onClick={() => {
                          setEditingId(list.id);
                          setEditingName(list.name);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t("matrix.listsDialog.deleteButton", { name: list.name })}
                        onClick={() => void handleDelete(list.id)}
                        disabled={busy}
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t("matrix.listsDialog.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
