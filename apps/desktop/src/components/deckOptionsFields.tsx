import { useEffect, useId, useState, type ReactNode } from "react";
import { Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { formatNumber, t, tn } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type StepUnit = "minutes" | "hours" | "days";

const UNIT_MULTIPLIER: Record<StepUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
};

const MAX_STEP_MINUTES = 525_600;
const MAX_INTERVAL_DAYS = 36_500;

function inferStepUnit(minutes: number): StepUnit {
  if (minutes >= 1440 && minutes % 1440 === 0) return "days";
  if (minutes >= 60 && minutes % 60 === 0) return "hours";
  return "minutes";
}

function formatSingleStep(minutes: number): string {
  const unit = inferStepUnit(minutes);
  const amount = Math.round(minutes / UNIT_MULTIPLIER[unit]);
  if (unit === "days") return tn("options.dayStep", amount);
  if (unit === "hours") return tn("options.hourStep", amount);
  return tn("options.minuteStep", amount);
}

function formatStepsSummary(steps: number[]): string {
  if (steps.length === 0) return t("options.steps.empty");
  const parts = steps.map(formatSingleStep);
  return t("options.stepsEffect", { steps: parts.join(t("options.stepsJoinThen")) });
}

function validateWholeInteger(raw: string, min: number, max: number): string | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return t("options.validation.integerRange", {
      min: formatNumber(min),
      max: formatNumber(max),
    });
  }
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    return t("options.validation.integerRange", {
      min: formatNumber(min),
      max: formatNumber(max),
    });
  }
  return null;
}

export function NumField({
  fieldKey,
  label,
  description,
  when,
  effect,
  unit,
  hint,
  recommended = false,
  externalError = null,
  value,
  onChange,
  onValidityChange,
  min = 0,
  max = 99_999,
}: {
  fieldKey: string;
  label: string;
  description: string;
  when?: string;
  effect?: string;
  unit?: string;
  hint?: string;
  recommended?: boolean;
  externalError?: string | null;
  value: number;
  onChange: (v: number) => void;
  onValidityChange?: (key: string, valid: boolean) => void;
  min?: number;
  max?: number;
}) {
  const inputId = useId();
  const errorId = useId();
  const [text, setText] = useState(String(value));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setText(String(value));
    setErrorMsg(null);
    onValidityChange?.(fieldKey, true);
  }, [value, fieldKey, onValidityChange]);

  const activeError = errorMsg ?? externalError;

  return (
    <div className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1 space-y-0.5">
        <label
          htmlFor={inputId}
          className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground"
        >
          <span>{label}</span>
          {recommended && (
            <span className="rounded bg-primary/12 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {t("options.algo.recommendedBadge")}
            </span>
          )}
          {hint && <span className="tnum text-xs font-medium text-primary">{hint}</span>}
        </label>
        <p className="text-xs text-muted-foreground">{description}</p>
        {when && (
          <p className="text-[11px] text-muted-foreground/90">
            {t("options.whenLabel", { hint: when })}
          </p>
        )}
        {effect && <p className="text-xs font-medium text-primary/90 tabular-nums">{effect}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-start gap-1 sm:w-52 sm:items-end">
        <div className="flex items-center gap-1.5">
          <input
            id={inputId}
            type="number"
            min={min}
            max={max}
            step={1}
            aria-invalid={activeError ? "true" : undefined}
            aria-describedby={activeError ? errorId : undefined}
            value={text}
            onChange={(e) => {
              const raw = e.target.value;
              setText(raw);
              const err = validateWholeInteger(raw, min, max);
              setErrorMsg(err);
              onValidityChange?.(fieldKey, err === null);
              if (err === null) {
                onChange(Number(raw.trim()));
              }
            }}
            className={cn(
              "h-8 w-24 rounded-md border bg-background px-2 text-sm tabular-nums outline-none focus:ring-1",
              activeError
                ? "border-destructive focus:ring-destructive"
                : "border-input focus:ring-ring",
            )}
          />
          {unit && <span className="w-16 text-xs text-muted-foreground">{unit}</span>}
        </div>
        {activeError && (
          <p id={errorId} role="alert" className="text-xs text-destructive sm:text-end">
            {activeError}
          </p>
        )}
      </div>
    </div>
  );
}

const MAX_INTERVAL_PRESETS = [
  { days: 365, key: "options.maxIntervalPreset.1y" as const },
  { days: 1825, key: "options.maxIntervalPreset.5y" as const },
  { days: 3650, key: "options.maxIntervalPreset.10y" as const },
  { days: MAX_INTERVAL_DAYS, key: "options.maxIntervalPreset.unlimited" as const },
];

export function MaxIntervalField({
  value,
  recommended,
  onChange,
  onValidityChange,
}: {
  value: number;
  recommended: boolean;
  onChange: (days: number) => void;
  onValidityChange: (key: string, valid: boolean) => void;
}) {
  const inputId = useId();
  const errorId = useId();
  const [text, setText] = useState(String(value));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setText(String(value));
    setErrorMsg(null);
    onValidityChange("maximum_interval_days", true);
  }, [value, onValidityChange]);

  const years = Math.round((value / 365) * 10) / 10;

  return (
    <div className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1 space-y-0.5">
        <label
          htmlFor={inputId}
          className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground"
        >
          <span>{t("options.maxInterval")}</span>
          {recommended && (
            <span className="rounded bg-primary/12 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {t("options.algo.recommendedBadge")}
            </span>
          )}
        </label>
        <p className="text-xs text-muted-foreground">{t("options.maxIntervalDesc")}</p>
        <p className="text-[11px] text-muted-foreground/90">
          {t("options.whenLabel", { hint: t("options.when.maxInterval") })}
        </p>
        <p className="text-xs font-medium text-primary/90 tabular-nums">
          {value >= 365
            ? t("options.maxIntervalEffectYears", {
                years: formatNumber(years, { maximumFractionDigits: 1 }),
                span: tn("common.days", value),
              })
            : t("options.maxIntervalEffect", { span: tn("common.days", value) })}
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-1.5 sm:w-52 sm:items-end">
        <div className="flex flex-wrap gap-1 sm:justify-end">
          {MAX_INTERVAL_PRESETS.map((preset) => (
            <button
              key={preset.days}
              type="button"
              aria-pressed={value === preset.days}
              onClick={() => onChange(preset.days)}
              className={cn(
                "rounded border px-2 py-0.5 text-[11px] font-medium transition-colors",
                value === preset.days
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t(preset.key)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            id={inputId}
            type="number"
            min={1}
            max={MAX_INTERVAL_DAYS}
            step={1}
            aria-invalid={errorMsg ? "true" : undefined}
            aria-describedby={errorMsg ? errorId : undefined}
            value={text}
            onChange={(e) => {
              const raw = e.target.value;
              setText(raw);
              const err = validateWholeInteger(raw, 1, MAX_INTERVAL_DAYS);
              setErrorMsg(err);
              onValidityChange("maximum_interval_days", err === null);
              if (err === null) onChange(Number(raw.trim()));
            }}
            className={cn(
              "h-8 w-24 rounded-md border bg-background px-2 text-sm tabular-nums outline-none focus:ring-1",
              errorMsg
                ? "border-destructive focus:ring-destructive"
                : "border-input focus:ring-ring",
            )}
          />
          <span className="w-16 text-xs text-muted-foreground">{t("options.unit.days")}</span>
        </div>
        {errorMsg && (
          <p id={errorId} role="alert" className="text-xs text-destructive sm:text-end">
            {errorMsg}
          </p>
        )}
      </div>
    </div>
  );
}

interface ChipDraft {
  text: string;
  unit: StepUnit;
  error: string | null;
}

export function StepsField({
  fieldKey,
  label,
  description,
  when,
  addLabel,
  recommended,
  value,
  onChange,
  onValidityChange,
}: {
  fieldKey: string;
  label: string;
  description: string;
  when?: string;
  addLabel: string;
  recommended: boolean;
  value: number[];
  onChange: (v: number[]) => void;
  onValidityChange: (key: string, valid: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<ChipDraft[]>(() =>
    value.map((m) => {
      const unit = inferStepUnit(m);
      return { text: String(Math.round(m / UNIT_MULTIPLIER[unit])), unit, error: null };
    }),
  );

  // Sync drafts when parent updates `value` externally (e.g. Reset or initial load).
  useEffect(() => {
    const matchesCurrent =
      drafts.length === value.length &&
      drafts.every(
        (d, i) => d.error === null && Number(d.text) * UNIT_MULTIPLIER[d.unit] === value[i],
      );
    if (matchesCurrent) return;
    setDrafts(
      value.map((m) => {
        const unit = inferStepUnit(m);
        return { text: String(Math.round(m / UNIT_MULTIPLIER[unit])), unit, error: null };
      }),
    );
    onValidityChange(fieldKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, fieldKey, onValidityChange]);

  function commitDrafts(next: ChipDraft[]) {
    setDrafts(next);
    const hasError = next.some((d) => d.error !== null);
    onValidityChange(fieldKey, !hasError);
    if (!hasError) {
      onChange(next.map((d) => Number(d.text.trim()) * UNIT_MULTIPLIER[d.unit]));
    }
  }

  function updateChip(idx: number, text: string, unit: StepUnit) {
    const maxForUnit = Math.floor(MAX_STEP_MINUTES / UNIT_MULTIPLIER[unit]);
    const error = validateWholeInteger(text, 1, maxForUnit);
    const next = drafts.map((d, i) => (i === idx ? { text, unit, error } : d));
    commitDrafts(next);
  }

  return (
    <div className="space-y-2 py-2.5">
      <div className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
          <span>{label}</span>
          {recommended && (
            <span className="rounded bg-primary/12 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {t("options.algo.recommendedBadge")}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
        {when && (
          <p className="text-[11px] text-muted-foreground/90">
            {t("options.whenLabel", { hint: when })}
          </p>
        )}
        <p className="text-xs font-medium text-primary/90 tabular-nums">
          {formatStepsSummary(value)}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {drafts.map((chip, idx) => (
          <div key={idx} className="flex flex-col gap-1">
            <div
              className={cn(
                "flex items-center gap-1 rounded-lg border bg-card p-1",
                chip.error ? "border-destructive" : "border-border",
              )}
            >
              <input
                type="number"
                min={1}
                max={Math.floor(MAX_STEP_MINUTES / UNIT_MULTIPLIER[chip.unit])}
                step={1}
                aria-label={t("options.steps.valueAria", { index: formatNumber(idx + 1) })}
                aria-invalid={chip.error ? "true" : undefined}
                value={chip.text}
                onChange={(e) => updateChip(idx, e.target.value, chip.unit)}
                className="h-7 w-14 rounded border border-input bg-background px-1.5 text-xs tabular-nums outline-none focus:ring-1 focus:ring-ring"
              />
              <Select
                selectSize="xs"
                containerClassName="w-24"
                aria-label={t("options.steps.unitAria", { index: formatNumber(idx + 1) })}
                value={chip.unit}
                onChange={(e) => updateChip(idx, chip.text, e.target.value as StepUnit)}
              >
                <option value="minutes">{t("options.unit.minutes")}</option>
                <option value="hours">{t("options.unit.hours")}</option>
                <option value="days">{t("options.unit.days")}</option>
              </Select>
              <button
                type="button"
                aria-label={t("options.steps.remove", { index: formatNumber(idx + 1) })}
                onClick={() => commitDrafts(drafts.filter((_, i) => i !== idx))}
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
            {chip.error && (
              <p role="alert" className="text-[11px] text-destructive">
                {chip.error}
              </p>
            )}
          </div>
        ))}

        {drafts.length < 32 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => commitDrafts([...drafts, { text: "10", unit: "minutes", error: null }])}
            className="h-9 gap-1 px-2.5 text-xs"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            <span>{addLabel}</span>
          </Button>
        )}
      </div>
    </div>
  );
}

export function OptionSection({
  title,
  onReset,
  children,
}: {
  title: string;
  onReset: () => void;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="size-3" aria-hidden="true" />
          <span>{t("options.resetSection")}</span>
        </Button>
      </div>
      <div className="divide-y divide-border/60">{children}</div>
    </section>
  );
}
