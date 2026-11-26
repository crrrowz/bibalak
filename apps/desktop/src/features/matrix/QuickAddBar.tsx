import { useMemo, useState, type RefObject } from "react";
import { X } from "lucide-react";
import type { TaskListDto, TaskPriority } from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { styleKey } from "@/lib/styles/styleKey";
import { useStyle } from "@/stores/style";
import { formatDueDateLabel, priorityLabel } from "./matrixHelpers";
import { parseQuickAdd, type QuickAddToken } from "./quickAddParser";

export interface QuickAddSubmitPayload {
  title: string;
  priority: TaskPriority;
  dueDate: string | null;
  listId: string | null;
  tags: string[];
}

interface QuickAddBarProps {
  todayDate: string;
  taskLists: TaskListDto[];
  defaultPriority?: TaskPriority;
  defaultDueDate?: string | null;
  defaultListId?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  isPending?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onSubmit: (payload: QuickAddSubmitPayload) => void;
  onCancel?: () => void;
  className?: string;
}

function tokenChipLabel(token: QuickAddToken, todayDate: string): string {
  switch (token.kind) {
    case "date":
      return formatDueDateLabel(token.value, todayDate).label;
    case "priority":
      return priorityLabel(token.value as TaskPriority);
    case "list":
      return `~${token.listName ?? token.raw}`;
    case "tag":
      return `#${token.value}`;
  }
}

export function QuickAddBar({
  todayDate,
  taskLists,
  defaultPriority = "none",
  defaultDueDate = null,
  defaultListId = null,
  placeholder,
  autoFocus = false,
  isPending = false,
  inputRef,
  onSubmit,
  onCancel,
  className,
}: QuickAddBarProps) {
  const style = useStyle((s) => s.style);
  const [rawInput, setRawInput] = useState("");
  const [suppressedIds, setSuppressedIds] = useState<string[]>([]);

  const suppressedSet = useMemo(() => new Set(suppressedIds), [suppressedIds]);
  const parsed = useMemo(
    () =>
      parseQuickAdd(rawInput, {
        todayDate,
        taskLists,
        defaultPriority,
        defaultDueDate,
        defaultListId,
        suppressedTokenIds: suppressedSet,
      }),
    [rawInput, todayDate, taskLists, defaultPriority, defaultDueDate, defaultListId, suppressedSet],
  );

  const effectivePlaceholder = placeholder ?? t(styleKey("matrix.quickAdd.hint", style));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const title = parsed.title.trim();
    if (!title) return;
    onSubmit({
      title,
      priority: parsed.priority,
      dueDate: parsed.dueDate,
      listId: parsed.listId,
      tags: parsed.tags,
    });
    setRawInput("");
    setSuppressedIds([]);
  };

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          autoFocus={autoFocus}
          value={rawInput}
          onChange={(e) => {
            setRawInput(e.target.value);
            if (suppressedIds.length > 0 && e.target.value === "") {
              setSuppressedIds([]);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setRawInput("");
              setSuppressedIds([]);
              onCancel?.();
            }
          }}
          placeholder={effectivePlaceholder}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="sm" disabled={isPending || !parsed.title.trim()}>
          {t("matrix.quickAddSubmit")}
        </Button>
      </div>

      {parsed.tokens.length > 0 && (
        <div data-testid="quick-add-chips" className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {parsed.tokens.map((tok) => {
            const label = tokenChipLabel(tok, todayDate);
            return (
              <span
                key={tok.id}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/60 px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground"
              >
                <span dir="auto">{label}</span>
                <button
                  type="button"
                  aria-label={t("matrix.quickAdd.removeChip", { label })}
                  onClick={() => setSuppressedIds((prev) => [...prev, tok.id])}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </form>
  );
}
