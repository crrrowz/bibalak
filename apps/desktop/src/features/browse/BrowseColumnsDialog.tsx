import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ColumnDef } from "@/lib/browseColumns";
import { t } from "@/lib/i18n";
import { DialogFrame } from "./DialogFrame";

export function BrowseColumnsDialog<T extends string>({
  open,
  columns,
  visible,
  defaults,
  onChange,
  onClose,
}: {
  open: boolean;
  columns: ColumnDef<T>[];
  visible: T[];
  defaults: T[];
  onChange: (next: T[]) => void;
  onClose: () => void;
}) {
  const hidden = columns.filter((c) => !visible.includes(c.id));
  const ordered = [
    ...visible
      .map((id) => columns.find((c) => c.id === id))
      .filter((c): c is ColumnDef<T> => Boolean(c)),
    ...hidden,
  ];

  function toggle(id: T) {
    if (visible.includes(id)) {
      if (visible.length <= 1) return;
      onChange(visible.filter((v) => v !== id));
    } else {
      onChange([...visible, id]);
    }
  }

  function move(id: T, delta: -1 | 1) {
    const idx = visible.indexOf(id);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= visible.length) return;
    const copy = [...visible];
    [copy[idx], copy[nextIdx]] = [copy[nextIdx], copy[idx]];
    onChange(copy);
  }

  return (
    <DialogFrame open={open} title={t("browse.columns.title")} onClose={onClose}>
      <h2 className="mb-3 text-base font-semibold">{t("browse.columns.title")}</h2>
      <ul className="mb-4 divide-y divide-border rounded-lg border border-border">
        {ordered.map((col) => {
          const isShown = visible.includes(col.id);
          const visIdx = visible.indexOf(col.id);
          return (
            <li key={col.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <label className="flex flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={isShown}
                  disabled={isShown && visible.length <= 1}
                  onChange={() => toggle(col.id)}
                />
                <span>{t(col.labelKey)}</span>
              </label>
              {isShown && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={t("browse.columns.moveUp")}
                    title={t("browse.columns.moveUp")}
                    disabled={visIdx <= 0}
                    onClick={() => move(col.id, -1)}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("browse.columns.moveDown")}
                    title={t("browse.columns.moveDown")}
                    disabled={visIdx >= visible.length - 1}
                    onClick={() => move(col.id, 1)}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(defaults)}>
          {t("browse.columns.reset")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </DialogFrame>
  );
}
