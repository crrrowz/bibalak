import { MoreHorizontal, Pencil, Repeat, Trash2 } from "lucide-react";
import type { CalendarOccurrenceDto } from "@bibalak/ipc-types";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { t } from "@/lib/i18n";
import { formatEventTimeRange } from "./calendarHelpers";

export function OccurrenceRow({
  occ,
  onEdit,
  onDeleteOccurrence,
  onDeleteSeries,
}: {
  occ: CalendarOccurrenceDto;
  onEdit: (occ: CalendarOccurrenceDto) => void;
  onDeleteOccurrence: (occ: CalendarOccurrenceDto) => void;
  onDeleteSeries: (occ: CalendarOccurrenceDto) => void;
}) {
  return (
    <div className="group relative rounded-lg border border-primary/30 bg-primary/10 px-1.5 py-1.5 text-xs">
      <p
        dir="auto"
        title={occ.title}
        className="line-clamp-2 font-medium leading-snug text-foreground"
      >
        {occ.title}
      </p>
      <p className="mt-1 flex min-w-0 items-center gap-0.5 text-[10px] leading-tight text-muted-foreground">
        {occ.is_recurring && (
          <Repeat
            className="size-3 shrink-0 text-primary"
            aria-label={t("calendar.recurringBadge")}
          />
        )}
        <span dir="ltr" className="tnum min-w-0 truncate whitespace-nowrap tracking-tight">
          {occ.is_all_day ? t("calendar.allDay") : formatEventTimeRange(occ.start_ms, occ.end_ms)}
        </span>
      </p>

      <div className="absolute bottom-1 end-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <ActionMenu
          menuLabel={t("calendar.event.actionsAria", { title: occ.title })}
          triggerAriaLabel={t("calendar.event.actionsAria", { title: occ.title })}
          triggerVariant="ghost"
          triggerSize="sm"
          triggerClassName="h-5 w-5 p-0 bg-card/90 hover:bg-card"
          triggerContent={<MoreHorizontal className="size-3.5" />}
        >
          <ActionMenuItem
            icon={<Pencil className="size-3.5" />}
            label={t("calendar.event.edit")}
            onSelect={() => onEdit(occ)}
          />
          <ActionMenuSeparator />
          {occ.is_recurring ? (
            <>
              <ActionMenuItem
                icon={<Trash2 className="size-3.5" />}
                label={t("calendar.event.deleteOccurrence")}
                danger
                onSelect={() => onDeleteOccurrence(occ)}
              />
              <ActionMenuItem
                icon={<Trash2 className="size-3.5" />}
                label={t("calendar.event.deleteSeries")}
                danger
                onSelect={() => onDeleteSeries(occ)}
              />
            </>
          ) : (
            <ActionMenuItem
              icon={<Trash2 className="size-3.5" />}
              label={t("calendar.event.delete")}
              danger
              onSelect={() => onDeleteSeries(occ)}
            />
          )}
        </ActionMenu>
      </div>
    </div>
  );
}
