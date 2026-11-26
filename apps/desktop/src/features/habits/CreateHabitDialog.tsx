import { useId, useState } from "react";
import {
  BookOpen,
  Brain,
  CheckCircle2,
  Clock,
  Droplet,
  Dumbbell,
  Moon,
  Plus,
  Sparkles,
  Sun,
  Target,
  X,
} from "lucide-react";
import type {
  DeckSummary,
  HabitDto,
  HabitFrequencyKind,
  HabitGoalMode,
  HabitInput,
  HabitSection,
} from "@bibalak/ipc-types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { errorMessage } from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  HABIT_ICON_KEYS,
  HABIT_SECTIONS,
  localizedWeekdayOptions,
  type AsyncHandler,
  type HabitIconKey,
} from "./habitHelpers";

export function HabitIconGlyph({ iconKey, className }: { iconKey: string; className?: string }) {
  switch (iconKey as HabitIconKey) {
    case "book-open":
      return <BookOpen className={className} />;
    case "droplet":
      return <Droplet className={className} />;
    case "dumbbell":
      return <Dumbbell className={className} />;
    case "brain":
      return <Brain className={className} />;
    case "moon":
      return <Moon className={className} />;
    case "sun":
      return <Sun className={className} />;
    case "clock":
      return <Clock className={className} />;
    case "sparkles":
      return <Sparkles className={className} />;
    case "target":
      return <Target className={className} />;
    default:
      return <CheckCircle2 className={className} />;
  }
}

interface CreateHabitDialogProps {
  open: boolean;
  habit?: HabitDto | null;
  defaultStartDate: string;
  decks: DeckSummary[];
  nextSortOrder: number;
  onSubmit: AsyncHandler<[HabitInput]>;
  onClose: () => void;
}

export function CreateHabitDialog({
  open,
  habit,
  defaultStartDate,
  decks,
  nextSortOrder,
  onSubmit,
  onClose,
}: CreateHabitDialogProps) {
  const titleId = useId();
  const titleInputId = useId();
  const notesInputId = useId();
  const freqId = useId();
  const weeklyTargetId = useId();
  const intervalId = useId();
  const goalModeId = useId();
  const goalTargetId = useId();
  const goalUnitId = useId();
  const startDateId = useId();
  const durationModeId = useId();
  const durationDaysId = useId();
  const sectionId = useId();
  const deckId = useId();
  const reminderInputId = useId();

  const isEdit = Boolean(habit);
  const [title, setTitle] = useState(habit?.title ?? "");
  const [notes, setNotes] = useState(habit?.notes ?? "");
  const [iconKey, setIconKey] = useState(habit?.icon_key ?? "check-circle");
  const [frequencyKind, setFrequencyKind] = useState<HabitFrequencyKind>(
    habit?.frequency_kind ?? "daily",
  );
  const [weekdays, setWeekdays] = useState<number[]>(
    habit && habit.weekdays.length > 0 ? habit.weekdays : [1, 2, 3, 4, 5],
  );
  const [weeklyTarget, setWeeklyTarget] = useState<number>(habit?.weekly_target ?? 3);
  const [intervalDays, setIntervalDays] = useState<number>(habit?.interval_days ?? 2);
  const [goalMode, setGoalMode] = useState<HabitGoalMode>(habit?.goal_mode ?? "achieve_all");
  const [goalTarget, setGoalTarget] = useState<number>(habit?.goal_target ?? 1);
  const [goalUnit, setGoalUnit] = useState(habit?.goal_unit ?? "");
  const [startDate, setStartDate] = useState(habit?.start_date ?? defaultStartDate);
  const [durationMode, setDurationMode] = useState<"forever" | "days">(
    habit?.target_days ? "days" : "forever",
  );
  const [targetDays, setTargetDays] = useState<number>(habit?.target_days ?? 21);
  const [section, setSection] = useState<HabitSection>(habit?.section ?? "morning");
  const [selectedDeckId, setSelectedDeckId] = useState<string>(
    habit?.deck_id !== null && habit?.deck_id !== undefined ? String(habit.deck_id) : "",
  );
  const [reminders, setReminders] = useState<string[]>(habit?.reminders ?? []);
  const [reminderDraft, setReminderDraft] = useState("08:00");
  const [autoPopupLog, setAutoPopupLog] = useState<boolean>(habit?.auto_popup_log ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const weekdayOptions = localizedWeekdayOptions();

  const toggleWeekday = (iso: number) => {
    setWeekdays((prev) =>
      prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort((a, b) => a - b),
    );
  };

  const addReminder = () => {
    const clean = reminderDraft.trim();
    if (!clean || reminders.includes(clean)) return;
    setReminders((prev) => [...prev, clean].sort());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const normalizedTarget =
        goalMode === "achieve_all" ? 1 : Math.max(1, Number(goalTarget) || 1);
      await onSubmit({
        title,
        notes,
        icon_key: iconKey,
        color_token: habit?.color_token ?? "accent",
        frequency_kind: frequencyKind,
        weekdays: frequencyKind === "weekdays" ? weekdays : [],
        weekly_target: frequencyKind === "weekly_count" ? weeklyTarget : null,
        interval_days: frequencyKind === "every_n_days" ? intervalDays : null,
        goal_mode: goalMode,
        goal_target: normalizedTarget,
        goal_unit: goalMode === "achieve_all" ? "" : goalUnit.trim(),
        start_date: startDate.trim() || null,
        target_days: durationMode === "days" ? Math.max(1, Number(targetDays) || 1) : null,
        section,
        reminders,
        auto_popup_log: autoPopupLog,
        deck_id: selectedDeckId ? Number(selectedDeckId) : null,
        sort_order: habit?.sort_order ?? nextSortOrder,
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
      className="max-w-lg max-h-[90vh] overflow-y-auto"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5 p-5">
        <h2 id={titleId} className="text-base font-semibold text-foreground">
          {isEdit ? t("habits.dialog.editTitle") : t("habits.dialog.createTitle")}
        </h2>

        <div className="space-y-1">
          <label htmlFor={titleInputId} className="block text-xs font-medium text-foreground">
            {t("habits.dialog.titleLabel")}
          </label>
          <input
            id={titleInputId}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("habits.dialog.titlePlaceholder")}
            required
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-foreground">
            {t("habits.dialog.iconLabel")}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {HABIT_ICON_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                aria-label={key}
                aria-pressed={iconKey === key}
                onClick={() => setIconKey(key)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md border transition-colors",
                  iconKey === key
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                <HabitIconGlyph iconKey={key} className="size-4" />
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor={freqId} className="block text-xs font-medium text-foreground">
              {t("habits.dialog.frequencyLabel")}
            </label>
            <Select
              id={freqId}
              value={frequencyKind}
              onChange={(e) => setFrequencyKind(e.target.value as HabitFrequencyKind)}
            >
              <option value="daily">{t("habits.dialog.freq.daily")}</option>
              <option value="weekdays">{t("habits.dialog.freq.weekdays")}</option>
              <option value="weekly_count">{t("habits.dialog.freq.weekly_count")}</option>
              <option value="every_n_days">{t("habits.dialog.freq.every_n_days")}</option>
            </Select>
          </div>

          <div className="space-y-1">
            <label htmlFor={sectionId} className="block text-xs font-medium text-foreground">
              {t("habits.dialog.sectionLabel")}
            </label>
            <Select
              id={sectionId}
              value={section}
              onChange={(e) => setSection(e.target.value as HabitSection)}
            >
              {HABIT_SECTIONS.map((sec) => (
                <option key={sec} value={sec}>
                  {t(`habits.section.${sec}`)}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {frequencyKind === "weekdays" && (
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-foreground">
              {t("habits.dialog.weekdaysLabel")}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {weekdayOptions.map((wd) => (
                <button
                  key={wd.iso}
                  type="button"
                  aria-pressed={weekdays.includes(wd.iso)}
                  onClick={() => toggleWeekday(wd.iso)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
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

        {frequencyKind === "weekly_count" && (
          <div className="space-y-1">
            <label htmlFor={weeklyTargetId} className="block text-xs font-medium text-foreground">
              {t("habits.dialog.weeklyTargetLabel")}
            </label>
            <input
              id={weeklyTargetId}
              type="number"
              min={1}
              max={7}
              value={weeklyTarget}
              onChange={(e) => setWeeklyTarget(Number(e.target.value) || 1)}
              className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}

        {frequencyKind === "every_n_days" && (
          <div className="space-y-1">
            <label htmlFor={intervalId} className="block text-xs font-medium text-foreground">
              {t("habits.dialog.intervalDaysLabel")}
            </label>
            <input
              id={intervalId}
              type="number"
              min={1}
              value={intervalDays}
              onChange={(e) => setIntervalDays(Number(e.target.value) || 1)}
              className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}

        <div className="space-y-2">
          <div className="space-y-1">
            <label htmlFor={goalModeId} className="block text-xs font-medium text-foreground">
              {t("habits.dialog.goalModeLabel")}
            </label>
            <Select
              id={goalModeId}
              value={goalMode}
              onChange={(e) => {
                const next = e.target.value as HabitGoalMode;
                setGoalMode(next);
                if (next === "reach_amount" && goalTarget <= 1) {
                  setGoalTarget(10);
                }
              }}
            >
              <option value="achieve_all">{t("habits.dialog.goalMode.achieve_all")}</option>
              <option value="reach_amount">{t("habits.dialog.goalMode.reach_amount")}</option>
            </Select>
          </div>

          {goalMode === "reach_amount" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor={goalTargetId} className="block text-xs font-medium text-foreground">
                  {t("habits.dialog.goalTargetLabel")}
                </label>
                <input
                  id={goalTargetId}
                  type="number"
                  min={1}
                  step="any"
                  value={goalTarget}
                  onChange={(e) => setGoalTarget(Number(e.target.value) || 1)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={goalUnitId} className="block text-xs font-medium text-foreground">
                  {t("habits.dialog.goalUnitLabel")}
                </label>
                <input
                  id={goalUnitId}
                  type="text"
                  value={goalUnit}
                  onChange={(e) => setGoalUnit(e.target.value)}
                  placeholder={t("habits.dialog.goalUnitPlaceholder")}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor={startDateId} className="block text-xs font-medium text-foreground">
              {t("habits.dialog.startDateLabel")}
            </label>
            <input
              id={startDateId}
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor={durationModeId} className="block text-xs font-medium text-foreground">
              {t("habits.dialog.durationLabel")}
            </label>
            <Select
              id={durationModeId}
              value={durationMode}
              onChange={(e) => setDurationMode(e.target.value as "forever" | "days")}
            >
              <option value="forever">{t("habits.dialog.durationForever")}</option>
              <option value="days">{t("habits.dialog.durationDays")}</option>
            </Select>
          </div>
        </div>

        {durationMode === "days" && (
          <div className="space-y-1">
            <label htmlFor={durationDaysId} className="block text-xs font-medium text-foreground">
              {t("habits.dialog.durationDaysLabel")}
            </label>
            <input
              id={durationDaysId}
              type="number"
              min={1}
              value={targetDays}
              onChange={(e) => setTargetDays(Number(e.target.value) || 1)}
              className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor={deckId} className="block text-xs font-medium text-foreground">
            {t("habits.dialog.deckLabel")}
          </label>
          <Select
            id={deckId}
            value={selectedDeckId}
            onChange={(e) => setSelectedDeckId(e.target.value)}
          >
            <option value="">{t("habits.dialog.noDeck")}</option>
            {decks
              .filter((d) => !d.is_filtered)
              .map((d) => (
                <option key={d.id} value={String(d.id)}>
                  {d.name}
                </option>
              ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={reminderInputId} className="block text-xs font-medium text-foreground">
            {t("habits.dialog.remindersLabel")}
          </label>
          <div className="flex items-center gap-2">
            <input
              id={reminderInputId}
              type="time"
              value={reminderDraft}
              onChange={(e) => setReminderDraft(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="button" variant="outline" size="sm" onClick={addReminder}>
              <Plus className="size-3.5" />
              <span>{t("habits.dialog.addReminder")}</span>
            </Button>
          </div>
          {reminders.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {reminders.map((tm) => (
                <span
                  key={tm}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                >
                  <span>{tm}</span>
                  <button
                    type="button"
                    aria-label={t("habits.dialog.removeReminder", { time: tm })}
                    onClick={() => setReminders((prev) => prev.filter((r) => r !== tm))}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{t("habits.dialog.remindersHelper")}</p>
        </div>

        <div className="space-y-1">
          <label htmlFor={notesInputId} className="block text-xs font-medium text-foreground">
            {t("habits.dialog.notesLabel")}
          </label>
          <textarea
            id={notesInputId}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <label className="flex items-center gap-2 text-xs text-foreground">
          <input
            type="checkbox"
            checked={autoPopupLog}
            onChange={(e) => setAutoPopupLog(e.target.checked)}
          />
          <span>{t("habits.dialog.autoPopupLog")}</span>
        </label>

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
            {t("habits.dialog.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {isEdit ? t("habits.dialog.save") : t("habits.dialog.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
