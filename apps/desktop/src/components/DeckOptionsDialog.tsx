import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ipc, errorMessage } from "@/lib/ipc";
import type { DeckConfig, FsrsOptimizeResult } from "@bibalak/ipc-types";
import { formatNumber, t } from "@/lib/i18n";
import { handleTabListKeyDown } from "@/lib/a11y";
import { queryKeys } from "@/lib/queryKeys";
import { WorkloadSimulatorChart } from "@/components/stats/WorkloadSimulatorChart";

type Tab = "general" | "new" | "reviews" | "lapses" | "fsrs";

function NumField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <label className="flex items-center justify-between gap-4 py-1">
      <span className="flex flex-wrap items-baseline gap-1.5 text-sm text-muted-foreground">
        <span>{label}</span>
        {hint && <span className="tnum text-xs font-medium text-primary">{hint}</span>}
      </span>
      <input
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
        className="h-7 w-28 rounded border border-input bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}

function StepsField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const text = value.join(" ");
  return (
    <label className="flex flex-col gap-1 py-1">
      <span className="text-sm text-muted-foreground">{label} (minutes, space-separated)</span>
      <input
        type="text"
        defaultValue={text}
        key={text}
        onBlur={(e) => {
          const parsed = e.target.value
            .trim()
            .split(/\s+/)
            .map(Number)
            .filter((n) => Number.isFinite(n) && n > 0);
          if (parsed.length > 0) onChange(parsed);
        }}
        className="h-7 rounded border border-input bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}

interface Props {
  deckId: number;
  deckName: string;
  onClose: () => void;
  onSaved: () => void;
}

export function DeckOptionsDialog({ deckId, deckName, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<Tab>("general");
  const [cfg, setCfg] = useState<DeckConfig | null>(null);
  const [extraNew, setExtraNew] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<FsrsOptimizeResult | null>(null);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const titleId = `deck-options-title-${deckId}`;

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

  const tabs: { key: Tab; label: string }[] = [
    { key: "general", label: t("options.tab.general") },
    { key: "new", label: t("options.tab.new") },
    { key: "reviews", label: t("options.tab.reviews") },
    { key: "lapses", label: t("options.tab.lapses") },
    { key: "fsrs", label: "FSRS" },
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      ariaLabelledBy={titleId}
      className="flex max-h-[90vh] w-[560px] max-w-none flex-col overflow-hidden bg-background"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          {t("options.title", { name: deckName })}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("shortcuts.closeDialog")}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {loadErr ? (
        <p className="px-5 py-4 text-sm text-destructive">{loadErr}</p>
      ) : !cfg ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <>
          {/* Tab bar */}
          <div
            className="flex border-b border-border"
            role="tablist"
            aria-label={t("options.title", { name: deckName })}
          >
            {tabs.map((item) => (
              <button
                key={item.key}
                id={`deck-options-tab-${item.key}`}
                type="button"
                role="tab"
                tabIndex={tab === item.key ? 0 : -1}
                aria-selected={tab === item.key}
                aria-controls={`deck-options-panel-${item.key}`}
                onClick={() => setTab(item.key)}
                onKeyDown={(e) =>
                  handleTabListKeyDown(
                    e,
                    tabs.map((tItem) => tItem.key),
                    tab,
                    setTab,
                  )
                }
                className={[
                  "px-4 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  tab === item.key
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div
            role="tabpanel"
            id={`deck-options-panel-${tab}`}
            aria-labelledby={`deck-options-tab-${tab}`}
            className="flex-1 overflow-auto px-5 py-4"
          >
            {tab === "general" && (
              <div className="space-y-1">
                <p className="mb-3 text-xs text-muted-foreground">
                  {t("options.algorithm")}{" "}
                  <span className="font-medium text-foreground">
                    {cfg.algorithm === "fsrs" ? "FSRS-5" : "SM-2"}
                  </span>
                </p>
                <div className="mb-4 flex gap-2">
                  <Button
                    size="sm"
                    variant={cfg.algorithm === "sm2" ? "default" : "outline"}
                    aria-pressed={cfg.algorithm === "sm2"}
                    onClick={() => set("algorithm", "sm2")}
                  >
                    SM-2
                  </Button>
                  <Button
                    size="sm"
                    variant={cfg.algorithm === "fsrs" ? "default" : "outline"}
                    aria-pressed={cfg.algorithm === "fsrs"}
                    onClick={() => set("algorithm", "fsrs")}
                  >
                    FSRS-5
                  </Button>
                </div>
                <NumField
                  label={t("options.newPerDay")}
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
                  label={t("options.reviewsPerDay")}
                  value={cfg.review_per_day}
                  onChange={(v) => set("review_per_day", v)}
                  min={0}
                  max={9999}
                />
                {sharedOtherDecks.length > 0 && (
                  <div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">
                      {t("options.sharedWith", { decks: sharedOtherDecks.join(", ") })}
                    </p>
                    <p className="mt-0.5">{t("options.sharedNotice")}</p>
                  </div>
                )}
              </div>
            )}

            {tab === "new" && (
              <div className="space-y-1">
                <StepsField
                  label={t("options.learningSteps")}
                  value={cfg.learning_steps_min}
                  onChange={(v) => set("learning_steps_min", v)}
                />
                <NumField
                  label={t("options.graduatingInterval")}
                  value={cfg.graduating_interval_days}
                  onChange={(v) => set("graduating_interval_days", v)}
                  min={1}
                />
                <NumField
                  label={t("options.easyInterval")}
                  value={cfg.easy_interval_days}
                  onChange={(v) => set("easy_interval_days", v)}
                  min={1}
                />
                <NumField
                  label={t("options.startingEase")}
                  value={cfg.starting_ease_milli}
                  onChange={(v) => set("starting_ease_milli", v)}
                  min={1300}
                  max={9999}
                />
              </div>
            )}

            {tab === "reviews" && (
              <div className="space-y-1">
                <NumField
                  label={t("options.easyBonus")}
                  value={cfg.easy_bonus}
                  onChange={(v) => set("easy_bonus", v)}
                  min={1.0}
                  max={5.0}
                  step={0.1}
                />
                <NumField
                  label={t("options.hardInterval")}
                  value={cfg.hard_interval_factor}
                  onChange={(v) => set("hard_interval_factor", v)}
                  min={0.5}
                  max={3.0}
                  step={0.1}
                />
                <NumField
                  label={t("options.intervalModifier")}
                  value={cfg.interval_modifier}
                  onChange={(v) => set("interval_modifier", v)}
                  min={0.01}
                  max={9.99}
                  step={0.01}
                />
                <NumField
                  label={t("options.maxInterval")}
                  value={cfg.maximum_interval_days}
                  onChange={(v) => set("maximum_interval_days", v)}
                  min={1}
                />
              </div>
            )}

            {tab === "lapses" && (
              <div className="space-y-1">
                <StepsField
                  label={t("options.relearningSteps")}
                  value={cfg.relearning_steps_min}
                  onChange={(v) => set("relearning_steps_min", v)}
                />
                <NumField
                  label={t("options.lapseInterval")}
                  value={cfg.lapse_interval_factor}
                  onChange={(v) => set("lapse_interval_factor", v)}
                  min={0.0}
                  max={1.0}
                  step={0.01}
                />
                <NumField
                  label={t("options.minInterval")}
                  value={cfg.minimum_interval_days}
                  onChange={(v) => set("minimum_interval_days", v)}
                  min={1}
                />
                <NumField
                  label={t("options.leechThreshold")}
                  value={cfg.leech_threshold}
                  onChange={(v) => set("leech_threshold", v)}
                  min={1}
                  max={99}
                />
              </div>
            )}

            {tab === "fsrs" && (
              <div className="space-y-3">
                <NumField
                  label={t("options.desiredRetention")}
                  value={cfg.desired_retention}
                  onChange={(v) => set("desired_retention", v)}
                  min={0.5}
                  max={0.99}
                  step={0.01}
                />
                <WorkloadSimulatorChart
                  deckId={deckId}
                  desiredRetention={cfg.desired_retention}
                  newPerDay={cfg.new_per_day}
                  weights={cfg.fsrs_weights}
                />
                <div className="space-y-1">
                  <label htmlFor="fsrs-weights-input" className="text-xs text-muted-foreground">
                    {t("options.weights")}
                  </label>
                  <textarea
                    id="fsrs-weights-input"
                    className="h-24 w-full resize-none rounded border border-input bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                    defaultValue={cfg.fsrs_weights.join(", ")}
                    key={cfg.fsrs_weights.join(",")}
                    onBlur={(e) => {
                      const parsed = e.target.value
                        .trim()
                        .split(/[\s,]+/)
                        .map(Number)
                        .filter((n) => Number.isFinite(n));
                      if (parsed.length === 21) {
                        set("fsrs_weights", parsed);
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground">{t("options.weightsHint")}</p>
                </div>

                {/* Optimize */}
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <p className="text-xs font-medium">{t("options.optimizer")}</p>
                  <p className="text-xs text-muted-foreground">{t("options.optimizerHint")}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={optimizeMut.isPending}
                    onClick={() => optimizeMut.mutate()}
                  >
                    {optimizeMut.isPending ? t("options.optimizing") : t("options.optimize")}
                  </Button>
                  {optimizeError && <p className="text-xs text-destructive">{optimizeError}</p>}
                  {optimizeResult && (
                    <div className="space-y-1.5 text-xs">
                      <p className="text-muted-foreground">
                        {t("options.trainedOn", {
                          reviews: optimizeResult.review_count,
                          cards: optimizeResult.card_count,
                        })}
                      </p>
                      <p>
                        {t("options.logLoss")}{" "}
                        <span className="text-muted-foreground">
                          {optimizeResult.log_loss_before.toFixed(4)}
                        </span>{" "}
                        →{" "}
                        <span
                          className={
                            optimizeResult.log_loss_after < optimizeResult.log_loss_before
                              ? "text-green-600 dark:text-green-400 font-semibold"
                              : "text-destructive"
                          }
                        >
                          {optimizeResult.log_loss_after.toFixed(4)}
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
                        <Button size="sm" variant="ghost" onClick={() => setOptimizeResult(null)}>
                          {t("options.discard")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
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
