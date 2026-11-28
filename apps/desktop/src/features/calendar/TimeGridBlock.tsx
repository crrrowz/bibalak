import type { KeyboardEvent, PointerEvent } from "react";
import { Clock, MoreHorizontal, Pencil, Repeat, Trash2 } from "lucide-react";
import type { CalendarOccurrenceDto, TaskDto } from "@bibalak/ipc-types";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { t } from "@/lib/i18n";
import { styleKey } from "@/lib/styles/styleKey";
import { cn } from "@/lib/utils";
import type { Style } from "@/stores/style";
import {
  formatEventTimeRange,
  formatMinutesRange,
  HOUR_HEIGHT_PX,
  MIN_DURATION_MINUTES,
} from "./calendarHelpers";
import type { TimedBlock } from "./timeGridTypes";

interface TimeGridBlockProps {
  block: TimedBlock;
  colIndex: number;
  colCount: number;
  effStartMin: number;
  effEndMin: number;
  isMovingSource: boolean;
  style: Style;
  onBlockPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onBlockKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onResizePointerDown: (e: PointerEvent<HTMLDivElement>, edge: "top" | "bottom") => void;
  onResizeEvent: (occ: CalendarOccurrenceDto, startMin: number, endMin: number) => void;
  onResizeTask: (task: TaskDto, startMin: number, endMin: number) => void;
  onEditEvent: (occ: CalendarOccurrenceDto) => void;
  onDeleteOccurrence: (occ: CalendarOccurrenceDto) => void;
  onDeleteSeries: (occ: CalendarOccurrenceDto) => void;
}

export function TimeGridBlock({
  block,
  colIndex,
  colCount,
  effStartMin,
  effEndMin,
  isMovingSource,
  style,
  onBlockPointerDown,
  onBlockKeyDown,
  onResizePointerDown,
  onResizeEvent,
  onResizeTask,
  onEditEvent,
  onDeleteOccurrence,
  onDeleteSeries,
}: TimeGridBlockProps) {
  const topPx = (effStartMin / 60) * HOUR_HEIGHT_PX;
  const heightPx = Math.max(18, ((effEndMin - effStartMin) / 60) * HOUR_HEIGHT_PX);
  const isCompact = heightPx <= 54;
  const isTiny = heightPx <= 32 || (isCompact && colCount > 1);

  return (
    <div
      data-block-id={block.id}
      data-testid={`calendar-block-${block.id}`}
      tabIndex={0}
      aria-label={`${block.title} (${formatMinutesRange(effStartMin, effEndMin)})`}
      onPointerDown={onBlockPointerDown}
      onKeyDown={onBlockKeyDown}
      style={{
        top: `${topPx}px`,
        height: `${heightPx}px`,
        minHeight: `${heightPx}px`,
        width: `calc(${100 / colCount}% - 2px)`,
        insetInlineStart: `${(colIndex * 100) / colCount}%`,
      }}
      className={cn(
        "group absolute z-10 overflow-hidden rounded-lg border text-[11px] transition-opacity hover:z-30 hover:!h-auto hover:overflow-visible hover:shadow-md focus-within:z-30 focus-within:!h-auto focus-within:overflow-visible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        colCount > 1 ? "px-1 py-0.5" : isCompact ? "px-1.5 py-0.5" : "px-1.5 py-1",
        block.kind === "event"
          ? "border-primary/40 bg-primary/15 text-foreground"
          : "border-easy/45 bg-easy/15 text-foreground",
        isMovingSource && "opacity-40",
      )}
    >
      {/* Top resize handle */}
      <div
        role="button"
        tabIndex={0}
        data-resize-handle="top"
        data-testid={`resize-top-${block.id}`}
        aria-label={t(styleKey("calendar.resizeEvent", style))}
        onPointerDown={(e) => onResizePointerDown(e, "top")}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            const delta = e.key === "ArrowDown" ? 15 : -15;
            const nextStart = Math.max(
              0,
              Math.min(block.endMin - MIN_DURATION_MINUTES, block.startMin + delta),
            );
            if (nextStart !== block.startMin) {
              if (block.kind === "event") {
                onResizeEvent(block.occ, nextStart, block.endMin);
              } else {
                onResizeTask(block.task, nextStart, block.endMin);
              }
            }
          }
        }}
        className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize bg-primary/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
      />

      <p
        dir="auto"
        title={block.title}
        className={cn(
          "min-w-0 overflow-hidden text-ellipsis font-medium leading-[1.15] text-foreground [overflow-wrap:anywhere] group-hover:line-clamp-none group-focus-within:line-clamp-none",
          isTiny ? "line-clamp-1" : "line-clamp-2",
        )}
      >
        {block.title}
      </p>

      {block.kind === "event" && (
        <div className="absolute top-0.5 end-0.5 z-10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <ActionMenu
            menuLabel={t("calendar.event.actionsAria", { title: block.title })}
            triggerAriaLabel={t("calendar.event.actionsAria", { title: block.title })}
            triggerVariant="ghost"
            triggerSize="sm"
            triggerClassName="h-5 w-5 p-0 bg-card/90 hover:bg-card"
            triggerContent={<MoreHorizontal className="size-3.5" />}
          >
            <ActionMenuItem
              icon={<Pencil className="size-3.5" />}
              label={t("calendar.event.edit")}
              onSelect={() => onEditEvent(block.occ)}
            />
            <ActionMenuSeparator />
            {block.occ.is_recurring ? (
              <>
                <ActionMenuItem
                  icon={<Trash2 className="size-3.5" />}
                  label={t("calendar.event.deleteOccurrence")}
                  danger
                  onSelect={() => onDeleteOccurrence(block.occ)}
                />
                <ActionMenuItem
                  icon={<Trash2 className="size-3.5" />}
                  label={t("calendar.event.deleteSeries")}
                  danger
                  onSelect={() => onDeleteSeries(block.occ)}
                />
              </>
            ) : (
              <ActionMenuItem
                icon={<Trash2 className="size-3.5" />}
                label={t("calendar.event.delete")}
                danger
                onSelect={() => onDeleteSeries(block.occ)}
              />
            )}
          </ActionMenu>
        </div>
      )}

      {!isTiny && (
        <p className="mt-0.5 flex min-w-0 items-center gap-0.5 text-[10px] leading-none text-muted-foreground">
          {block.isRecurring ? (
            <Repeat
              className="size-2.5 shrink-0 text-primary"
              aria-label={t("calendar.recurringBadge")}
            />
          ) : block.kind === "task" ? (
            <Clock className="size-2.5 shrink-0" aria-hidden="true" />
          ) : null}
          <span dir="ltr" className="tnum min-w-0 truncate whitespace-nowrap">
            {formatEventTimeRange(block.startMs, block.endMs)}
          </span>
        </p>
      )}

      {/* Bottom resize handle */}
      <div
        role="button"
        tabIndex={0}
        data-resize-handle="bottom"
        data-testid={`resize-bottom-${block.id}`}
        aria-label={t(styleKey("calendar.resizeEvent", style))}
        onPointerDown={(e) => onResizePointerDown(e, "bottom")}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            const delta = e.key === "ArrowDown" ? 15 : -15;
            const nextEnd = Math.max(
              block.startMin + MIN_DURATION_MINUTES,
              Math.min(24 * 60, block.endMin + delta),
            );
            if (nextEnd !== block.endMin) {
              if (block.kind === "event") {
                onResizeEvent(block.occ, block.startMin, nextEnd);
              } else {
                onResizeTask(block.task, block.startMin, nextEnd);
              }
            }
          }
        }}
        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize bg-primary/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
      />
    </div>
  );
}
