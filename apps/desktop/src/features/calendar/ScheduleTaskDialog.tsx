import { useId, useState } from "react";
import type { TaskDto } from "@bibalak/ipc-types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/ipc";
import { t } from "@/lib/i18n";
import type { AsyncHandler } from "./calendarHelpers";

interface ScheduleTaskDialogProps {
  open: boolean;
  task: TaskDto;
  defaultDate: string;
  onSchedule: AsyncHandler<[TaskDto, number, number]>;
  onClose: () => void;
}

export function ScheduleTaskDialog({
  open,
  task,
  defaultDate,
  onSchedule,
  onClose,
}: ScheduleTaskDialogProps) {
  const titleId = useId();
  const dateId = useId();
  const startId = useId();
  const durationId = useId();

  const [date, setDate] = useState(task.due_date ?? defaultDate);
  const [startTime, setStartTime] = useState("10:00");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const [y, m, d] = date.split("-").map(Number);
      const [hh, mm] = startTime.split(":").map(Number);
      const startMs = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).getTime();
      const mins = Math.max(5, Number(durationMinutes) || 30);
      const endMs = startMs + mins * 60_000;
      await onSchedule(task, startMs, endMs);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} ariaLabelledBy={titleId} className="max-w-sm">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5 p-5">
        <div>
          <h2 id={titleId} className="text-base font-semibold text-foreground">
            {t("calendar.scheduleDialog.title")}
          </h2>
          <p className="mt-1 truncate text-xs text-muted-foreground">{task.title}</p>
        </div>

        <div className="space-y-1">
          <label htmlFor={dateId} className="block text-xs font-medium text-foreground">
            {t("calendar.scheduleDialog.dateLabel")}
          </label>
          <input
            id={dateId}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor={startId} className="block text-xs font-medium text-foreground">
              {t("calendar.scheduleDialog.startTimeLabel")}
            </label>
            <input
              id={startId}
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor={durationId} className="block text-xs font-medium text-foreground">
              {t("calendar.scheduleDialog.durationLabel")}
            </label>
            <input
              id={durationId}
              type="number"
              min={5}
              step={5}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value) || 30)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
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
            {t("calendar.scheduleDialog.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {t("calendar.scheduleDialog.submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
