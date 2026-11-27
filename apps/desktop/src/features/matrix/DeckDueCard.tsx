import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRightLeft,
  BookOpen,
  ChevronDown,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Search,
} from "lucide-react";
import type { MatrixDeckDueItemDto, MatrixQuadrantDto, QuadrantKey } from "@bibalak/ipc-types";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
import { buildBrowseFilterQuery } from "@/features/browse/browseHelpers";
import { t, tn } from "@/lib/i18n";
import { styleKey } from "@/lib/styles/styleKey";
import { cn } from "@/lib/utils";
import { useStyle } from "@/stores/style";
import {
  explainDeckDuePlacement,
  QUADRANT_ORDER,
  quadrantBadgeClass,
  quadrantDisplayTitle,
  quadrantRoman,
} from "./matrixHelpers";

interface DeckDueCardProps {
  deckItem: MatrixDeckDueItemDto;
  quadrants?: MatrixQuadrantDto[];
  onMoveToQuadrant?: (deckId: number, quadrant: QuadrantKey) => void;
  onEditRule?: () => void;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>, deckId: number) => void;
  onDragEnd?: () => void;
}

export function DeckDueCard({
  deckItem,
  quadrants = [],
  onMoveToQuadrant,
  onEditRule,
  onDragStart,
  onDragEnd,
}: DeckDueCardProps) {
  const navigate = useNavigate();
  const style = useStyle((s) => s.style);
  const [moveOpen, setMoveOpen] = useState(false);

  const canDrag = Boolean(onDragStart);
  const tooltip =
    quadrants.length > 0
      ? explainDeckDuePlacement(deckItem.deck_id, deckItem.quadrant_key, quadrants)
      : t("matrix.deckDue.hint");

  return (
    <div
      data-testid={`deck-due-${deckItem.deck_id}`}
      draggable={canDrag}
      onDragStart={(e) => {
        if (canDrag && onDragStart) {
          onDragStart(e, deckItem.deck_id);
        }
      }}
      onDragEnd={onDragEnd}
      title={tooltip}
      className={cn(
        "group flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-secondary/35 px-3 py-2 text-sm transition-colors",
        canDrag && "cursor-grab hover:bg-secondary/55 active:cursor-grabbing",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {canDrag && (
          <GripVertical
            className="size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <BookOpen className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="shrink-0 rounded border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {t(styleKey("matrix.deckDue.badge", style))}
            </span>
            <p dir="auto" className="truncate font-medium text-foreground">
              {deckItem.deck_name}
            </p>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {tn("matrix.deckDue.count", deckItem.due_count)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Link
          to="/study/$deckId"
          params={{ deckId: deckItem.deck_id }}
          className="inline-flex h-7 shrink-0 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("matrix.study")}
        </Link>
        <ActionMenu
          menuLabel={t("matrix.deckDue.actions", { deck: deckItem.deck_name })}
          triggerAriaLabel={t("matrix.deckDue.actions", { deck: deckItem.deck_name })}
          triggerVariant="ghost"
          triggerSize="sm"
          triggerClassName="h-7 w-7 shrink-0 p-0"
          triggerContent={<MoreHorizontal className="size-4" />}
          onOpenChange={(open) => {
            if (!open) setMoveOpen(false);
          }}
        >
          <ActionMenuItem
            icon={<BookOpen className="size-4" />}
            label={t("matrix.study")}
            onSelect={() => {
              void navigate({
                to: "/study/$deckId",
                params: { deckId: deckItem.deck_id },
              });
            }}
          />
          <ActionMenuItem
            icon={<Search className="size-4" />}
            label={t("matrix.deckDue.openInBrowse")}
            onSelect={() => {
              void navigate({
                to: "/browse",
                search: { q: buildBrowseFilterQuery(deckItem.deck_name, null) },
              });
            }}
          />
          {onMoveToQuadrant && (
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
                      onSelect={() => onMoveToQuadrant(deckItem.deck_id, qKey)}
                    />
                  );
                })}
            </>
          )}
          {onEditRule && (
            <ActionMenuItem
              icon={<Pencil className="size-4" />}
              label={t("matrix.deckDue.editRule")}
              onSelect={onEditRule}
            />
          )}
        </ActionMenu>
      </div>
    </div>
  );
}
