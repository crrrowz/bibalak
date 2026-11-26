import { useState } from "react";
import { Check, ChevronDown, ListFilter, MoreHorizontal, Pencil, SortAsc } from "lucide-react";
import type { MatrixGroupBy, MatrixQuadrantDto, MatrixSortBy } from "@bibalak/ipc-types";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { GROUP_BY_OPTIONS, SORT_BY_OPTIONS } from "./matrixHelpers";

export function QuadrantHeaderMenu({
  quadrant,
  title,
  onEdit,
  onChangeGroupBy,
  onChangeSortBy,
}: {
  quadrant: MatrixQuadrantDto;
  title: string;
  onEdit: () => void;
  onChangeGroupBy: (groupBy: MatrixGroupBy) => void;
  onChangeSortBy: (sortBy: MatrixSortBy) => void;
}) {
  const [groupOpen, setGroupOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  return (
    <ActionMenu
      menuLabel={t("matrix.quadrantOptions", { quadrant: title })}
      triggerAriaLabel={t("matrix.quadrantOptions", { quadrant: title })}
      triggerVariant="ghost"
      triggerSize="sm"
      triggerClassName="h-7 w-7 p-0"
      triggerContent={<MoreHorizontal className="size-4" />}
      onOpenChange={(open) => {
        if (!open) {
          setGroupOpen(false);
          setSortOpen(false);
        }
      }}
    >
      <ActionMenuItem
        icon={<Pencil className="size-4" />}
        label={t("matrix.editQuadrant")}
        onSelect={onEdit}
      />
      <ActionMenuSeparator />
      <button
        type="button"
        role="menuitem"
        aria-expanded={groupOpen}
        onClick={() => setGroupOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm outline-none hover:bg-accent focus-visible:bg-accent"
      >
        <span className="flex items-center gap-2">
          <ListFilter className="size-4 text-muted-foreground" />
          <span>{t("matrix.groupBy")}</span>
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground transition-transform",
            groupOpen && "rotate-180",
          )}
        />
      </button>
      {groupOpen &&
        GROUP_BY_OPTIONS.map((opt) => (
          <ActionMenuItem
            key={opt}
            icon={
              quadrant.group_by === opt ? (
                <Check className="size-3.5 text-primary" />
              ) : (
                <span className="inline-block size-3.5" />
              )
            }
            label={t(`matrix.groupBy.${opt}`)}
            onSelect={() => onChangeGroupBy(opt)}
          />
        ))}
      <button
        type="button"
        role="menuitem"
        aria-expanded={sortOpen}
        onClick={() => setSortOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm outline-none hover:bg-accent focus-visible:bg-accent"
      >
        <span className="flex items-center gap-2">
          <SortAsc className="size-4 text-muted-foreground" />
          <span>{t("matrix.sortBy")}</span>
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground transition-transform",
            sortOpen && "rotate-180",
          )}
        />
      </button>
      {sortOpen &&
        SORT_BY_OPTIONS.map((opt) => (
          <ActionMenuItem
            key={opt}
            icon={
              quadrant.sort_by === opt ? (
                <Check className="size-3.5 text-primary" />
              ) : (
                <span className="inline-block size-3.5" />
              )
            }
            label={t(`matrix.sortBy.${opt}`)}
            onSelect={() => onChangeSortBy(opt)}
          />
        ))}
    </ActionMenu>
  );
}
