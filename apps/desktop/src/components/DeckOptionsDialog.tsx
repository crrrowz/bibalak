import { useEffect, useId, useState, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import type { DeckConfig, FsrsOptimizeResult } from "@bibalak/ipc-types";
import { WorkloadSimulatorChart } from "@/components/stats/WorkloadSimulatorChart";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatNumber, t, tn } from "@/lib/i18n";
import { errorMessage, ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import {
  DECK_CONFIG_DEFAULTS,
  FSRS_ALGORITHM_NAME,
  FSRS6_DEFAULT_WEIGHTS,
  SM2_ALGORITHM_NAME,
} from "@/lib/schedulingConstants";
import { cn } from "@/lib/utils";

const ADVANCED_STORAGE_KEY = "keepsake-deck-options-advanced";

function readAdvancedPreference(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(ADVANCED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeAdvancedPreference(value: boolean) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ADVANCED_STORAGE_KEY, String(value));
  } catch {
    // ignore storage failures
  }
}

function formatStepsSummary(steps: number[]): string {
  const parts = steps.map((m) => tn("options.minuteStep", m));
  return t("options.stepsEffect", { steps: parts.join(t("options.stepsJoinThen")) });
}

function parseStepsInput(raw: string): number[] | null {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const parsed = tokens.map((tok) => Number(tok.replace(/[mد]$/i, "")));
  if (parsed.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return parsed;
}

function NumField({
  label,
  description,
  effect,
  unit,
  hint,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  description: string;
  effect?: string;
  unit?: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const inputId = useId();
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <div className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1 space-y-0.5">
        <label
          htmlFor={inputId}
          className="flex flex-wrap items-baseline gap-1.5 text-sm font-medium text-foreground"
        >
          <span>{label}</span>
          {hint && <span className="tnum text-xs font-medium text-primary">{hint}</span>}
        </label>
        <p className="text-xs text-muted-foreground">{description}</p>
        {effect && <p className="text-xs font-medium text-primary/90 tabular-nums">{effect}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <input
          id={inputId}
          type="number"
          min={min}
          max={max}
          step={step ?? 1}
          value={text}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            if (raw !== "" && !Number.isNaN(Number(raw))) {
              onChange(Number(raw));
            }
          }}
          onBlur={() => {
            if (text === "" || Number.isNaN(Number(text))) {
              setText(String(value));
            }
          }}
          className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm tabular-nums outline-none focus:ring-1 focus:ring-ring"
        />
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

function StepsField({
  label,
  description,
  unit,
  value,
  onChange,
}: {
  label: string;
  description: string;
  unit: string;
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const inputId = useId();
  const formatted = value.map((m) => `${m}m`).join(" ");
  const [text, setText] = useState(formatted);

  useEffect(() => {
    setText(value.map((m) => `${m}m`).join(" "));
  }, [value]);

  return (
    <div className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1 space-y-0.5">
        <label htmlFor={inputId} className="block text-sm font-medium text-foreground">
          {label}
        </label>
        <p className="text-xs text-muted-foreground">{description}</p>
        <p className="text-xs font-medium text-primary/90 tabular-nums">
          {formatStepsSummary(value)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <input
          id={inputId}
          type="text"
          value={text}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            const parsed = parseStepsInput(next);
            if (parsed) onChange(parsed);
          }}
          onBlur={() => {
            const parsed = parseStepsInput(text);
            if (parsed) {
              onChange(parsed);
              setText(parsed.map((m) => `${m}m`).join(" "));
            } else {
              setText(formatted);
            }
          }}
          className="h-8 w-28 rounded-md border border-input bg-background px-2 text-sm tabular-nums outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

function OptionSection({
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

interface Props {
  deckId: number;
  deckName: string;
  onClose: () => void;
  onSaved: () => void;
}

export function DeckOptionsDialog({ deckId, deckName, onClose, onSaved }: Props) {
  const [advanced, setAdvanced] = useState<boolean>(readAdvancedPreference);
  const [fsrsParamsOpen, setFsrsParamsOpen] = useState(false);
  const [editingWeights, setEditingWeights] = useState(false);
  const [weightsDraft, setWeightsDraft] = useState("");
  const [weightsError, setWeightsError] = useState<string | null>(null);
  const [cfg, setCfg] = useState<DeckConfig | null>(null);
  const [extraNew, setExtraNew] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<FsrsOptimizeResult | null>(null);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const titleId = `deck-options-title-${deckId}`;
  const retentionId = `deck-options-retention-${deckId}`;

  const optimizeMut = useMutation({
    mutationFn: () => ipc.optimizeFsrs(deckId),
    onSuccess: (r) => {
      setOptimizeResult(r);
      setOptimizeError(null);
    },
    onError: (e) => {
      setOptimizeError(errorMessage(e));
      setOptimizeResult(null);
    },
  });

  useEffect(() => {
    Promise.resolve(ipc.getDeckConfig(deckId))
      .then((c) => {
        if (c) setCfg(c);
      })
      .catch((e) => setLoadErr(String(e)));
    Promise.resolve(ipc.getTodayExtraNew(deckId))
      .then((n) => setExtraNew(typeof n === "number" && Number.isFinite(n) ? n : 0))
      .catch(() => setExtraNew(0));
  }, [deckId]);

  const decksQuery = useQuery({
    queryKey: queryKeys.decks,
    queryFn: async () => {
      try {
        return (await ipc.listDecks()) ?? [];
      } catch {
        return [];
      }
    },
  });

  const nonFilteredDecks = (decksQuery.data ?? []).filter((d) => !d.is_filtered);
  const sharedDecksQuery = useQuery({
    queryKey: queryKeys.deckPresetSharing(
      cfg?.config_id ?? null,
      nonFilteredDecks.map((d) => d.id),
    ),
    enabled: Boolean(cfg) && nonFilteredDecks.length > 1,
    queryFn: async () => {
      const targetConfigId = cfg!.config_id;
      const results = await Promise.all(
        nonFilteredDecks
          .filter((d) => d.id !== deckId)
          .map(async (d) => {
            try {
              const other = await ipc.getDeckConfig(d.id);
              return other?.config_id === targetConfigId ? d.name : null;
            } catch {
              return null;
            }
          }),
      );
      return results.filter((name): name is string => Boolean(name));
    },
  });
  const sharedOtherDecks = sharedDecksQuery.data ?? [];

  const retentionSimQuery = useQuery({
    queryKey: queryKeys.statsSimulateWorkload(
      deckId,
      cfg?.desired_retention ?? 0.9,
      cfg?.new_per_day ?? 20,
      30,
      cfg?.fsrs_weights ?? [],
    ),
    enabled: Boolean(cfg && cfg.algorithm === "fsrs"),
    queryFn: () =>
      ipc.simulateWorkload(deckId, cfg!.desired_retention, cfg!.new_per_day, 30, cfg!.fsrs_weights),
    placeholderData: keepPreviousData,
  });

  const saveMut = useMutation({
    mutationFn: (c: DeckConfig) => ipc.setDeckConfig(c),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  function set<K extends keyof DeckConfig>(key: K, val: DeckConfig[K]) {
    setCfg((prev) => (prev ? { ...prev, [key]: val } : prev));
  }

  function toggleAdvanced() {
    const next = !advanced;
    setAdvanced(next);
    writeAdvancedPreference(next);
  }

  function startEditingWeights() {
    if (!cfg) return;
    setWeightsDraft(cfg.fsrs_weights.join(", "));
    setWeightsError(null);
    setEditingWeights(true);
  }

  function applyWeightsDraft() {
    const parsed = weightsDraft
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (parsed.length !== 21 || parsed.some((n) => !Number.isFinite(n))) {
      setWeightsError(t("options.weightsInvalid"));
      return;
    }
    set("fsrs_weights", parsed);
    setWeightsError(null);
    setEditingWeights(false);
  }

  const sliderMin = cfg ? Math.min(0.8, Math.round(cfg.desired_retention * 100) / 100) : 0.8;
  const sliderMax = cfg ? Math.max(0.95, Math.round(cfg.desired_retention * 100) / 100) : 0.95;

  return (
    <Dialog
      open
      onClose={onClose}
      ariaLabelledBy={titleId}
      className="flex max-h-[90vh] w-[600px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden bg-background"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2
          id={titleId}
          dir="auto"
          className="min-w-0 flex-1 text-sm font-semibold [overflow-wrap:anywhere]"
        >
          {t("options.title", { name: deckName })}
        </h2>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant={advanced ? "secondary" : "outline"}
            size="sm"
            aria-expanded={advanced}
            onClick={toggleAdvanced}
            className="h-7 gap-1.5 px-2.5 text-xs"
          >
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
            <span>{advanced ? t("options.mode.simple") : t("options.mode.advanced")}</span>
          </Button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("shortcuts.closeDialog")}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {loadErr ? (
        <p className="px-5 py-4 text-sm text-destructive">{loadErr}</p>
      ) : !cfg ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <>
          <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
            {sharedOtherDecks.length > 0 && (
              <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                <p className="font-medium text-foreground">
                  {t("options.sharedWith", { decks: sharedOtherDecks.join(", ") })}
                </p>
                <p className="mt-0.5">{t("options.sharedNotice")}</p>
              </div>
            )}

            {/* Simple view: always shows the three everyday items (retention hidden under SM-2) */}
            <div className="divide-y divide-border/60">
              <NumField
                label={t("options.simple.newPerDay")}
                description={t("options.simple.newPerDayDesc")}
                effect={t("options.simple.newPerDayEffect", {
                  count: formatNumber(cfg.new_per_day),
                })}
                unit={t("options.unit.cards")}
                hint={
                  extraNew > 0
                    ? t("options.extraToday", { count: formatNumber(extraNew) })
                    : undefined
                }
                value={cfg.new_per_day}
                onChange={(v) => set("new_per_day", v)}
                min={0}
                max={9999}
              />
              <NumField
                label={t("options.simple.reviewsPerDay")}
                description={t("options.simple.reviewsPerDayDesc")}
                effect={t("options.simple.reviewsPerDayEffect", {
                  count: formatNumber(cfg.review_per_day),
                })}
                unit={t("options.unit.reviews")}
                value={cfg.review_per_day}
                onChange={(v) => set("review_per_day", v)}
                min={0}
                max={9999}
              />

              {cfg.algorithm === "fsrs" && (
                <div className="space-y-2 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-0.5">
                      <label
                        htmlFor={retentionId}
                        className="block text-sm font-medium text-foreground"
                      >
                        {t("options.simple.rememberLabel")}
                      </label>
                      <p className="text-xs text-muted-foreground">
                        {t("options.simple.rememberDesc")}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-foreground tabular-nums">
                      {formatNumber(Math.round(cfg.desired_retention * 100))}
                      {t("options.unit.percent")}
                    </span>
                  </div>
                  <input
                    id={retentionId}
                    type="range"
                    min={sliderMin}
                    max={sliderMax}
                    step={0.01}
                    value={cfg.desired_retention}
                    onChange={(e) => set("desired_retention", Number(e.target.value))}
                    className="h-2 w-full cursor-pointer accent-primary"
                  />
                  <div className="flex justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
                    <span>{t("options.simple.scaleLow")}</span>
                    <span className="font-medium text-foreground">
                      {t("options.simple.scaleRec")}
                    </span>
                    <span>{t("options.simple.scaleHigh")}</span>
                  </div>
                  <p className="text-xs font-medium text-primary/90 tabular-nums">
                    {retentionSimQuery.data
                      ? retentionSimQuery.data.avg_daily_minutes_proposed < 1
                        ? t("options.simple.dailyMinutesUnderOne")
                        : t("options.simple.dailyMinutes", {
                            span: tn(
                              "options.minuteStep",
                              Math.round(retentionSimQuery.data.avg_daily_minutes_proposed),
                            ),
                          })
                      : t("options.simple.dailyMinutesPending")}
                  </p>
                </div>
              )}
            </div>

            {advanced && (
              <div className="space-y-4">
                <OptionSection
                  title={t("options.section.scheduling")}
                  onReset={() => {
                    set("algorithm", DECK_CONFIG_DEFAULTS.algorithm);
                    set("maximum_interval_days", DECK_CONFIG_DEFAULTS.maximum_interval_days);
                    set("desired_retention", DECK_CONFIG_DEFAULTS.desired_retention);
                  }}
                >
                  <div className="space-y-2.5 py-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        aria-pressed={cfg.algorithm === "fsrs"}
                        onClick={() => set("algorithm", "fsrs")}
                        className={cn(
                          "rounded-lg border p-3 text-start transition-colors",
                          cfg.algorithm === "fsrs"
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border hover:bg-accent/50",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            {FSRS_ALGORITHM_NAME}
                          </span>
                          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            {t("options.algo.recommendedBadge")}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("options.algo.fsrsDesc")}
                        </p>
                      </button>

                      <button
                        type="button"
                        aria-pressed={cfg.algorithm === "sm2"}
                        onClick={() => set("algorithm", "sm2")}
                        className={cn(
                          "rounded-lg border p-3 text-start transition-colors",
                          cfg.algorithm === "sm2"
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border hover:bg-accent/50",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            {SM2_ALGORITHM_NAME}
                          </span>
                          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {t("options.algo.classicBadge")}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("options.algo.sm2Desc")}
                        </p>
                      </button>
                    </div>

                    {cfg.algorithm === "fsrs" && (
                      <div className="space-y-3 pt-1">
                        <WorkloadSimulatorChart
                          deckId={deckId}
                          desiredRetention={cfg.desired_retention}
                          newPerDay={cfg.new_per_day}
                          weights={cfg.fsrs_weights}
                        />
                        <div className="space-y-2 rounded-lg border border-border p-3">
                          <p className="text-xs font-medium">{t("options.optimizer")}</p>
                          <p className="text-xs text-muted-foreground">
                            {t("options.optimizerHint")}
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={optimizeMut.isPending}
                            onClick={() => optimizeMut.mutate()}
                          >
                            {optimizeMut.isPending
                              ? t("options.optimizing")
                              : t("options.optimize")}
                          </Button>
                          {optimizeError && (
                            <p className="text-xs text-destructive">{optimizeError}</p>
                          )}
                          {optimizeResult && (
                            <div className="space-y-1.5 text-xs">
                              <p className="text-muted-foreground">
                                {t("options.trainedOn", {
                                  reviews: formatNumber(optimizeResult.review_count),
                                  cards: formatNumber(optimizeResult.card_count),
                                })}
                              </p>
                              <p>
                                {t("options.logLoss")}{" "}
                                <span className="text-muted-foreground tabular-nums">
                                  {formatNumber(optimizeResult.log_loss_before, {
                                    minimumFractionDigits: 4,
                                    maximumFractionDigits: 4,
                                  })}
                                </span>{" "}
                                →{" "}
                                <span
                                  className={
                                    optimizeResult.log_loss_after < optimizeResult.log_loss_before
                                      ? "font-semibold text-green-600 tabular-nums dark:text-green-400"
                                      : "text-destructive tabular-nums"
                                  }
                                >
                                  {formatNumber(optimizeResult.log_loss_after, {
                                    minimumFractionDigits: 4,
                                    maximumFractionDigits: 4,
                                  })}
                                </span>
                              </p>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => {
                                    if (cfg) {
                                      set("fsrs_weights", optimizeResult.weights);
                                      setOptimizeResult(null);
                                    }
                                  }}
                                >
                                  {t("options.applyWeights")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setOptimizeResult(null)}
                                >
                                  {t("options.discard")}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <NumField
                    label={t("options.maxInterval")}
                    description={t("options.maxIntervalDesc")}
                    effect={t("options.maxIntervalEffect", {
                      span: tn("common.days", cfg.maximum_interval_days),
                    })}
                    unit={t("options.unit.days")}
                    value={cfg.maximum_interval_days}
                    onChange={(v) => set("maximum_interval_days", v)}
                    min={1}
                  />
                </OptionSection>

                <OptionSection
                  title={t("options.section.learningNew")}
                  onReset={() => {
                    set("learning_steps_min", [...DECK_CONFIG_DEFAULTS.learning_steps_min]);
                    set("graduating_interval_days", DECK_CONFIG_DEFAULTS.graduating_interval_days);
                    set("easy_interval_days", DECK_CONFIG_DEFAULTS.easy_interval_days);
                  }}
                >
                  <StepsField
                    label={t("options.learningSteps")}
                    description={t("options.learningStepsDesc")}
                    unit={t("options.unit.minutes")}
                    value={cfg.learning_steps_min}
                    onChange={(v) => set("learning_steps_min", v)}
                  />
                  <NumField
                    label={t("options.graduatingInterval")}
                    description={t("options.graduatingIntervalDesc")}
                    effect={t("options.waitDaysEffect", {
                      span: tn("common.days", cfg.graduating_interval_days),
                    })}
                    unit={t("options.unit.days")}
                    value={cfg.graduating_interval_days}
                    onChange={(v) => set("graduating_interval_days", v)}
                    min={1}
                  />
                  <NumField
                    label={t("options.easyInterval")}
                    description={t("options.easyIntervalDesc")}
                    effect={t("options.waitDaysEffect", {
                      span: tn("common.days", cfg.easy_interval_days),
                    })}
                    unit={t("options.unit.days")}
                    value={cfg.easy_interval_days}
                    onChange={(v) => set("easy_interval_days", v)}
                    min={1}
                  />
                </OptionSection>

                <OptionSection
                  title={t("options.section.forgetting")}
                  onReset={() => {
                    set("relearning_steps_min", [...DECK_CONFIG_DEFAULTS.relearning_steps_min]);
                    set("leech_threshold", DECK_CONFIG_DEFAULTS.leech_threshold);
                    if (cfg.algorithm === "sm2") {
                      set("lapse_interval_factor", DECK_CONFIG_DEFAULTS.lapse_interval_factor);
                      set("minimum_interval_days", DECK_CONFIG_DEFAULTS.minimum_interval_days);
                    }
                  }}
                >
                  <StepsField
                    label={t("options.relearningSteps")}
                    description={t("options.relearningStepsDesc")}
                    unit={t("options.unit.minutes")}
                    value={cfg.relearning_steps_min}
                    onChange={(v) => set("relearning_steps_min", v)}
                  />
                  <NumField
                    label={t("options.leechThreshold")}
                    description={t("options.leechThresholdDesc")}
                    effect={t("options.leechThresholdEffect", {
                      count: formatNumber(cfg.leech_threshold),
                    })}
                    unit={t("options.unit.lapses")}
                    value={cfg.leech_threshold}
                    onChange={(v) => set("leech_threshold", v)}
                    min={1}
                    max={99}
                  />
                  {cfg.algorithm === "sm2" && (
                    <>
                      <NumField
                        label={t("options.lapseIntervalPct")}
                        description={t("options.lapseIntervalDesc")}
                        effect={
                          cfg.lapse_interval_factor === 0
                            ? t("options.lapseIntervalEffectZero")
                            : t("options.lapseIntervalEffectPct", {
                                pct: formatNumber(Math.round(cfg.lapse_interval_factor * 100)),
                              })
                        }
                        unit={t("options.unit.percent")}
                        value={Math.round(cfg.lapse_interval_factor * 100)}
                        onChange={(v) =>
                          set(
                            "lapse_interval_factor",
                            Math.max(0, Math.min(1, Math.round(v) / 100)),
                          )
                        }
                        min={0}
                        max={100}
                        step={1}
                      />
                      <NumField
                        label={t("options.minInterval")}
                        description={t("options.minIntervalDesc")}
                        effect={t("options.minIntervalEffect", {
                          span: tn("common.days", cfg.minimum_interval_days),
                        })}
                        unit={t("options.unit.days")}
                        value={cfg.minimum_interval_days}
                        onChange={(v) => set("minimum_interval_days", v)}
                        min={1}
                      />
                    </>
                  )}
                </OptionSection>

                {cfg.algorithm === "sm2" && (
                  <OptionSection
                    title={t("options.section.sm2Fine")}
                    onReset={() => {
                      set("starting_ease_milli", DECK_CONFIG_DEFAULTS.starting_ease_milli);
                      set("easy_bonus", DECK_CONFIG_DEFAULTS.easy_bonus);
                      set("hard_interval_factor", DECK_CONFIG_DEFAULTS.hard_interval_factor);
                      set("interval_modifier", DECK_CONFIG_DEFAULTS.interval_modifier);
                    }}
                  >
                    <NumField
                      label={t("options.startingEasePct")}
                      description={t("options.startingEaseDesc")}
                      effect={t("options.startingEaseEffect", {
                        pct: formatNumber(Math.round(cfg.starting_ease_milli / 10)),
                      })}
                      unit={t("options.unit.percent")}
                      value={Math.round(cfg.starting_ease_milli / 10)}
                      onChange={(v) =>
                        set(
                          "starting_ease_milli",
                          Math.max(1300, Math.min(9999, Math.round(v * 10))),
                        )
                      }
                      min={130}
                      max={999}
                      step={1}
                    />
                    <NumField
                      label={t("options.easyBonusPct")}
                      description={t("options.easyBonusDesc")}
                      effect={t("options.easyBonusEffect", {
                        pct: formatNumber(Math.round(cfg.easy_bonus * 100)),
                      })}
                      unit={t("options.unit.percent")}
                      value={Math.round(cfg.easy_bonus * 100)}
                      onChange={(v) =>
                        set("easy_bonus", Math.max(1, Math.min(5, Math.round(v) / 100)))
                      }
                      min={100}
                      max={500}
                      step={1}
                    />
                    <NumField
                      label={t("options.hardIntervalPct")}
                      description={t("options.hardIntervalDesc")}
                      effect={t("options.hardIntervalEffect", {
                        pct: formatNumber(Math.round(cfg.hard_interval_factor * 100)),
                      })}
                      unit={t("options.unit.percent")}
                      value={Math.round(cfg.hard_interval_factor * 100)}
                      onChange={(v) =>
                        set("hard_interval_factor", Math.max(0.5, Math.min(3, Math.round(v) / 100)))
                      }
                      min={50}
                      max={300}
                      step={1}
                    />
                    <NumField
                      label={t("options.intervalModifierPct")}
                      description={t("options.intervalModifierDesc")}
                      effect={t("options.intervalModifierEffect", {
                        pct: formatNumber(Math.round(cfg.interval_modifier * 100)),
                      })}
                      unit={t("options.unit.percent")}
                      value={Math.round(cfg.interval_modifier * 100)}
                      onChange={(v) =>
                        set(
                          "interval_modifier",
                          Math.max(0.01, Math.min(9.99, Math.round(v) / 100)),
                        )
                      }
                      min={1}
                      max={999}
                      step={1}
                    />
                  </OptionSection>
                )}

                {cfg.algorithm === "fsrs" && (
                  <section className="space-y-2 border-t border-border pt-4">
                    <button
                      type="button"
                      aria-expanded={fsrsParamsOpen}
                      onClick={() => setFsrsParamsOpen((open) => !open)}
                      className="flex w-full items-center justify-between gap-2 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                    >
                      <span>{t("options.section.fsrsParams", { algo: FSRS_ALGORITHM_NAME })}</span>
                      {fsrsParamsOpen ? (
                        <ChevronDown className="size-4" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
                      )}
                    </button>

                    {fsrsParamsOpen && (
                      <div className="space-y-2 pt-1">
                        {!editingWeights ? (
                          <>
                            <p className="rounded-md border border-border bg-secondary/30 p-2.5 font-mono text-xs text-muted-foreground break-all">
                              {cfg.fsrs_weights
                                .map((w) => formatNumber(w, { maximumFractionDigits: 4 }))
                                .join(", ")}
                            </p>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={startEditingWeights}
                              >
                                {t("options.weightsEdit")}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => set("fsrs_weights", [...FSRS6_DEFAULT_WEIGHTS])}
                              >
                                {t("options.weightsReset")}
                              </Button>
                            </div>
                          </>
                        ) : (
                          <div className="space-y-1.5">
                            <label
                              htmlFor="fsrs-weights-input"
                              className="block text-xs text-muted-foreground"
                            >
                              {t("options.weights", { algo: FSRS_ALGORITHM_NAME })}
                            </label>
                            <textarea
                              id="fsrs-weights-input"
                              dir="ltr"
                              value={weightsDraft}
                              onChange={(e) => {
                                setWeightsDraft(e.target.value);
                                setWeightsError(null);
                              }}
                              className="h-24 w-full resize-none rounded border border-input bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                            />
                            {weightsError && (
                              <p role="alert" className="text-xs text-destructive">
                                {weightsError}
                              </p>
                            )}
                            <div className="flex gap-2">
                              <Button type="button" size="sm" onClick={applyWeightsDraft}>
                                {t("options.weightsApply")}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditingWeights(false);
                                  setWeightsError(null);
                                }}
                              >
                                {t("common.cancel")}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {saveMut.isError && (
            <p className="px-5 text-xs text-destructive">
              {String((saveMut.error as { message?: string })?.message ?? saveMut.error)}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={() => saveMut.mutate(cfg)} disabled={saveMut.isPending}>
              {saveMut.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
