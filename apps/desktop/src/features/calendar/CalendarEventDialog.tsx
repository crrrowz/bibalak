import { useId, useState } from "react";
import type {
  CalendarEventInput,
  CalendarOccurrenceDto,
  CalendarRecurrence,
} from "@bibalak/ipc-types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { errorMessage } from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { isoWeekdayFromIso, localizedWeekdayOptions, type AsyncHandler } from "./calendarHelpers";

function formatHm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

interface CalendarEventDialogProps {
  open: boolean;
  defaultDate: string;
  defaultStartTime?: string;
  defaultEndTime?: string;
  occurrence?: CalendarOccurrenceDto | null;
  onSave: AsyncHandler<[CalendarEventInput]>;
  onClose: () => void;
}

export function CalendarEventDialog({
  open,
  defaultDate,
  defaultStartTime,
  defaultEndTime,
  occurrence,
  onSave,
  onClose,
}: CalendarEventDialogProps) {
  const titleId = useId();
  const nameInputId = useId();
  const dateInputId = useId();
  const startTimeId = useId();
  const endTimeId = useId();
  const locationId = useId();
  const descriptionId = useId();
  const repeatId = useId();
  const intervalId = useId();
  const endModeId = useId();
  const untilId = useId();
  const countId = useId();

  const isEdit = Boolean(occurrence);
  const initialDate = defaultStartTime ? defaultDate : (occurrence?.occurrence_date ?? defaultDate);

  const [title, setTitle] = useState(occurrence?.title ?? "");
  const [date, setDate] = useState(initialDate);
  const [isAllDay, setIsAllDay] = useState(
    defaultStartTime ? false : (occurrence?.is_all_day ?? false),
  );
  const [startTime, setStartTime] = useState(
    defaultStartTime ??
      (occurrence && !occurrence.is_all_day ? formatHm(occurrence.start_ms) : "09:00"),
  );
  const [endTime, setEndTime] = useState(
    defaultEndTime ??
      (occurrence && !occurrence.is_all_day ? formatHm(occurrence.end_ms) : "10:00"),
  );
  const [location, setLocation] = useState(occurrence?.location ?? "");
  const [description, setDescription] = useState(occurrence?.description ?? "");

  const [repeatMode, setRepeatMode] = useState<"none" | "daily" | "weekly">(
    occurrence?.recurrence?.freq ?? "none",
  );
  const [interval, setInterval] = useState<number>(occurrence?.recurrence?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(
    occurrence?.recurrence?.weekdays && occurrence.recurrence.weekdays.length > 0
      ? occurrence.recurrence.weekdays
      : [isoWeekdayFromIso(initialDate)],
  );
  const [endMode, setEndMode] = useState<"never" | "until" | "count">(
    occurrence?.recurrence?.until_date
      ? "until"
      : occurrence?.recurrence?.count
        ? "count"
        : "never",
  );
  const [untilDate, setUntilDate] = useState(occurrence?.recurrence?.until_date ?? initialDate);
  const [count, setCount] = useState<number>(occurrence?.recurrence?.count ?? 10);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const weekdayOptions = localizedWeekdayOptions();

  const toggleWeekday = (iso: number) => {
    setWeekdays((prev) =>
      prev.includes(iso) ? prev.filter((w) => w !== iso) : [...prev, iso].sort((a, b) => a - b),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const [y, m, d] = date.split("-").map(Number);
      let start_ms: number;
      let end_ms: number;
      if (isAllDay) {
        start_ms = Date.UTC(y, m - 1, d);
        end_ms = Date.UTC(y, m - 1, d + 1);
      } else {
        const [sh, sm] = startTime.split(":").map(Number);
        const [eh, em] = endTime.split(":").map(Number);
        start_ms = new Date(y, m - 1, d, sh || 0, sm || 0, 0, 0).getTime();
        end_ms = new Date(y, m - 1, d, eh || 0, em || 0, 0, 0).getTime();
      }

      let recurrence: CalendarRecurrence | null = null;
      if (repeatMode !== "none") {
        recurrence = {
          freq: repeatMode,
          interval: Math.max(1, Number(interval) || 1),
          weekdays:
            repeatMode === "weekly"
              ? weekdays.length > 0
                ? weekdays
                : [isoWeekdayFromIso(date)]
              : [],
          until_date: endMode === "until" ? untilDate : null,
          count: endMode === "count" ? Math.max(1, Number(count) || 1) : null,
          exdates: occurrence?.recurrence?.exdates ?? [],
        };
      }

      await onSave({
        title,
        description,
        location,
        color_token: occurrence?.color_token ?? "accent",
        start_ms,
        end_ms,
        is_all_day: isAllDay,
        recurrence,
        linked_task_id: occurrence?.linked_task_id ?? null,
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      className="max-w-md max-h-[90vh] overflow-y-auto"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5 p-5">
        <h2 id={titleId} className="text-base font-semibold text-foreground">
          {isEdit ? t("calendar.eventDialog.editTitle") : t("calendar.eventDialog.createTitle")}
        </h2>

        <div className="space-y-1">
          <label htmlFor={nameInputId} className="block text-xs font-medium text-foreground">
            {t("calendar.eventDialog.titleLabel")}
          </label>
          <input
            id={nameInputId}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("calendar.eventDialog.titlePlaceholder")}
            required
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label htmlFor={dateInputId} className="block text-xs font-medium text-foreground">
              {t("calendar.eventDialog.dateLabel")}
            </label>
            <input
              id={dateInputId}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <label className="flex h-9 items-center gap-2 text-xs font-medium text-foreground">
            <input
              type="checkbox"
              checked={isAllDay}
              onChange={(e) => setIsAllDay(e.target.checked)}
            />
            <span>{t("calendar.eventDialog.allDay")}</span>
          </label>
        </div>

        {!isAllDay && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={startTimeId} className="block text-xs font-medium text-foreground">
                {t("calendar.eventDialog.startTimeLabel")}
              </label>
              <input
                id={startTimeId}
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={endTimeId} className="block text-xs font-medium text-foreground">
                {t("calendar.eventDialog.endTimeLabel")}
              </label>
              <input
                id={endTimeId}
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor={repeatId} className="block text-xs font-medium text-foreground">
              {t("calendar.eventDialog.repeatLabel")}
            </label>
            <Select
              id={repeatId}
              value={repeatMode}
              onChange={(e) => setRepeatMode(e.target.value as "none" | "daily" | "weekly")}
            >
              <option value="none">{t("calendar.eventDialog.repeatNone")}</option>
              <option value="daily">{t("calendar.eventDialog.repeatDaily")}</option>
              <option value="weekly">{t("calendar.eventDialog.repeatWeekly")}</option>
            </Select>
          </div>

          {repeatMode !== "none" && (
            <div className="space-y-1">
              <label htmlFor={intervalId} className="block text-xs font-medium text-foreground">
                {t("calendar.eventDialog.intervalLabel")}
              </label>
              <input
                id={intervalId}
                type="number"
                min={1}
                value={interval}
                onChange={(e) => setInterval(Number(e.target.value) || 1)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          )}
        </div>

        {repeatMode === "weekly" && (
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-foreground">
              {t("calendar.eventDialog.weekdaysLabel")}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {weekdayOptions.map((wd) => (
                <button
                  key={wd.iso}
                  type="button"
                  aria-pressed={weekdays.includes(wd.iso)}
                  onClick={() => toggleWeekday(wd.iso)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                    weekdays.includes(wd.iso)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground hover:bg-accent",
                  )}
                >
                  {wd.label}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {repeatMode !== "none" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={endModeId} className="block text-xs font-medium text-foreground">
                {t("calendar.eventDialog.endLabel")}
              </label>
              <Select
                id={endModeId}
                value={endMode}
                onChange={(e) => setEndMode(e.target.value as "never" | "until" | "count")}
              >
                <option value="never">{t("calendar.eventDialog.endNever")}</option>
                <option value="until">{t("calendar.eventDialog.endUntil")}</option>
                <option value="count">{t("calendar.eventDialog.endCount")}</option>
              </Select>
            </div>
            {endMode === "until" && (
              <div className="space-y-1">
                <label htmlFor={untilId} className="block text-xs font-medium text-foreground">
                  {t("calendar.eventDialog.untilDateLabel")}
                </label>
                <input
                  id={untilId}
                  type="date"
                  value={untilDate}
                  onChange={(e) => setUntilDate(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            )}
            {endMode === "count" && (
              <div className="space-y-1">
                <label htmlFor={countId} className="block text-xs font-medium text-foreground">
                  {t("calendar.eventDialog.countLabel")}
                </label>
                <input
                  id={countId}
                  type="number"
                  min={1}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value) || 1)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            )}
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor={locationId} className="block text-xs font-medium text-foreground">
            {t("calendar.eventDialog.locationLabel")}
          </label>
          <input
            id={locationId}
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor={descriptionId} className="block text-xs font-medium text-foreground">
            {t("calendar.eventDialog.descriptionLabel")}
          </label>
          <textarea
            id={descriptionId}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
            {t("calendar.eventDialog.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {t("calendar.eventDialog.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
