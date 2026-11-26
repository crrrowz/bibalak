import { useId, useState } from "react";
import type { HabitDto, HabitLogDto, HabitLogInput } from "@bibalak/ipc-types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/ipc";
import { formatNumber, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AsyncHandler } from "./habitHelpers";

interface HabitLogDialogProps {
  open: boolean;
  habit: HabitDto;
  dayIndex: number;
  existingLog?: HabitLogDto;
  onSave: AsyncHandler<[HabitLogInput]>;
  onClose: () => void;
}

export function HabitLogDialog({
  open,
  habit,
  dayIndex,
  existingLog,
  onSave,
  onClose,
}: HabitLogDialogProps) {
  const titleId = useId();
  const noteId = useId();

  const [mood, setMood] = useState<number | null>(existingLog?.mood ?? null);
  const [note, setNote] = useState<string>(existingLog?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave({
        habit_id: habit.id,
        day_index: dayIndex,
        logged_value: existingLog?.logged_value ?? habit.goal_target,
        status: existingLog?.status === "skipped" ? "skipped" : "logged",
        mood,
        note,
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} ariaLabelledBy={titleId} className="max-w-sm">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 p-5">
        <h2 id={titleId} className="text-base font-semibold text-foreground">
          {t("habits.logDialog.title", { title: habit.title })}
        </h2>

        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-foreground">
            {t("habits.logDialog.moodLabel")}
          </legend>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={t("habits.logDialog.moodOption", { n: formatNumber(n) })}
                aria-pressed={mood === n}
                onClick={() => setMood((cur) => (cur === n ? null : n))}
                className={cn(
                  "tnum flex h-9 flex-1 items-center justify-center rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  mood === n
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:bg-accent",
                )}
              >
                {formatNumber(n)}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1">
          <label htmlFor={noteId} className="block text-xs font-medium text-foreground">
            {t("habits.logDialog.noteLabel")}
          </label>
          <textarea
            id={noteId}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("habits.logDialog.notePlaceholder")}
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

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
            {t("habits.logDialog.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {t("habits.logDialog.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
