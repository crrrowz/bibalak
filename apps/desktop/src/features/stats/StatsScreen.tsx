import { useCallback, useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { AlertCircle, BarChart3, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import type { CoachInput, CoachReport, StatsDto } from "@bibalak/ipc-types";
import { CoachConsentDialog } from "@/components/stats/CoachConsentDialog";
import { CoachPanel } from "@/components/stats/CoachPanel";
import { toast } from "@/stores/toast";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { errorMessage, ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { listItem, staggerList } from "@/lib/motion";
import { AnswerButtonsChart } from "@/components/stats/AnswerButtonsChart";
import { DeckTable } from "@/components/stats/DeckTable";
import { ForecastChart } from "@/components/stats/ForecastChart";
import { FsrsPanels } from "@/components/stats/FsrsPanels";
import { HourlyChart } from "@/components/stats/HourlyChart";
import { CoachCards } from "@/components/stats/CoachCards";
import { InsightsRow } from "@/components/stats/InsightsRow";
import { MaturityDonut } from "@/components/stats/MaturityDonut";
import { PanelSkeleton } from "@/components/stats/PanelSkeleton";
import { RetentionChart } from "@/components/stats/RetentionChart";
import { StatsFilters } from "@/components/stats/StatsFilters";
import { RANGE_DAYS, type StatsRange } from "@/components/stats/statsFilterUtils";
import { StatCards } from "@/components/stats/StatCards";
import { YearHeatmap } from "@/components/stats/YearHeatmap";
import { computeStreaks } from "@/components/stats/heatmapUtils";
import { ProgressPanel } from "@/features/progress/ProgressPanel";
import { t } from "@/lib/i18n";

export function StatsScreen() {
  const tauri = isTauri();
  const search = useSearch({ from: "/stats" });
  const navigate = useNavigate({ from: "/stats" });

  const deckId = search.deck ?? null;
  const range: StatsRange = search.range ?? "all";
  const days = RANGE_DAYS[range];

  const setDeckId = (id: number | null) => {
    void navigate({ search: (prev) => ({ ...prev, deck: id ?? undefined }) });
  };
  const setRange = (r: StatsRange) => {
    void navigate({ search: (prev) => ({ ...prev, range: r === "all" ? undefined : r }) });
  };

  const decksQuery = useQuery({
    queryKey: queryKeys.decks,
    queryFn: ipc.listDecks,
    enabled: tauri,
  });
  const decks = useMemo(() => decksQuery.data ?? [], [decksQuery.data]);
  const deckName = decks.find((d) => d.id === deckId)?.name ?? null;

  const scopedDecks = useMemo(() => {
    const nonFiltered = decks.filter((d) => !d.is_filtered);
    if (deckId === null) return nonFiltered;
    const selected = nonFiltered.find((d) => d.id === deckId);
    if (!selected) return [];
    return nonFiltered.filter((d) => d.id === deckId || d.name.startsWith(`${selected.name}::`));
  }, [decks, deckId]);

  const fsrsDecksQuery = useQuery({
    queryKey: queryKeys.statsFsrsDecks(
      deckId,
      scopedDecks.map((d) => d.id),
    ),
    enabled: tauri && scopedDecks.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        scopedDecks.map(async (d) => {
          try {
            const cfg = await ipc.getDeckConfig(d.id);
            return cfg?.algorithm === "fsrs" ? d.name : null;
          } catch {
            return null;
          }
        }),
      );
      return results.filter((name): name is string => Boolean(name));
    },
  });
  const fsrsDeckNames = fsrsDecksQuery.data ?? [];
  const fsrsConfigLoaded =
    decksQuery.isSuccess && (scopedDecks.length === 0 || fsrsDecksQuery.isSuccess);

  const drill = (query: string) => {
    void navigate({
      to: "/browse",
      search: {
        q: query,
        from: "stats",
        backDeck: deckId ?? undefined,
        backRange: range === "all" ? undefined : range,
      },
    });
  };
  const statsQuery = useQuery({
    queryKey: queryKeys.stats(deckId, days),
    queryFn: () => ipc.getStats(deckId, days),
    enabled: tauri,
    placeholderData: keepPreviousData,
  });

  const aiConfigQuery = useQuery({
    queryKey: queryKeys.aiConfig,
    queryFn: async () => {
      try {
        return (await ipc.aiGetConfig()) ?? null;
      } catch {
        return null;
      }
    },
    enabled: tauri,
  });

  const [coachReport, setCoachReport] = useState<CoachReport | null>(null);
  const [coachInput, setCoachInput] = useState<CoachInput | null>(null);
  const [isCoachDialogOpen, setIsCoachDialogOpen] = useState(false);
  const [isCoachLoading, setIsCoachLoading] = useState(false);

  const handleAskCoach = useCallback(async () => {
    setIsCoachLoading(true);
    try {
      const input = await ipc.getCoachInput(deckId);
      setCoachInput(input);
      setIsCoachDialogOpen(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsCoachLoading(false);
    }
  }, [deckId]);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t("stats.title")} description={t("stats.description")} />
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
        {!tauri ? (
          <EmptyState
            icon={BarChart3}
            title={t("decks.noTauri.title")}
            description={t("stats.noTauri.description")}
          />
        ) : (
          <div className="mx-auto max-w-5xl space-y-6">
            <StatsFilters
              decks={decksQuery.data ?? []}
              deckId={deckId}
              range={range}
              onDeckChange={setDeckId}
              onRangeChange={setRange}
            />
            <ProgressPanel variant="section" />
            {statsQuery.isError ? (
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 py-12">
                <EmptyState
                  icon={AlertCircle}
                  title={t("stats.error.title")}
                  description={t("stats.error.description")}
                  detail={
                    errorMessage(statsQuery.error).trim()
                      ? t("stats.error.reason", {
                          reason: errorMessage(statsQuery.error).trim(),
                        })
                      : undefined
                  }
                  action={
                    <Button variant="outline" size="sm" onClick={() => statsQuery.refetch()}>
                      <RefreshCw className="me-2 size-3.5" />
                      {t("common.retry")}
                    </Button>
                  }
                />
              </div>
            ) : statsQuery.data ? (
              <Dashboard
                stats={statsQuery.data}
                onSelectDeck={setDeckId}
                onDrill={drill}
                deckName={deckName}
                fsrsDeckNames={fsrsDeckNames}
                fsrsConfigLoaded={fsrsConfigLoaded}
                rangeDays={days}
                onAskCoach={handleAskCoach}
                isCoachLoading={isCoachLoading}
                coachReport={coachReport}
                onClearCoachReport={() => setCoachReport(null)}
              />
            ) : (
              <div className="space-y-6">
                <PanelSkeleton height={88} />
                <PanelSkeleton height={140} />
                <PanelSkeleton height={220} />
              </div>
            )}
          </div>
        )}
      </div>

      <CoachConsentDialog
        open={isCoachDialogOpen}
        input={coachInput}
        configured={aiConfigQuery.data?.enabled}
        onSuccess={(report) => setCoachReport(report)}
        onClose={() => setIsCoachDialogOpen(false)}
      />
    </div>
  );
}

function Dashboard({
  stats,
  onSelectDeck,
  onDrill,
  deckName,
  fsrsDeckNames,
  fsrsConfigLoaded,
  rangeDays,
  onAskCoach,
  isCoachLoading,
  coachReport,
  onClearCoachReport,
}: {
  stats: StatsDto;
  onSelectDeck: (deckId: number) => void;
  onDrill: (query: string) => void;
  deckName: string | null;
  fsrsDeckNames: string[];
  fsrsConfigLoaded: boolean;
  rangeDays: number | null;
  onAskCoach: () => void;
  isCoachLoading: boolean;
  coachReport: CoachReport | null;
  onClearCoachReport: () => void;
}) {
  const today = stats.today;
  const streaks = useMemo(() => computeStreaks(stats.reviews, today), [stats.reviews, today]);

  return (
    <motion.div variants={staggerList} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={listItem}>
        <StatCards stats={stats} streak={streaks.current} />
      </motion.div>

      <motion.div variants={listItem}>
        <InsightsRow
          reviews={stats.reviews}
          hourly={stats.hourly}
          day0Ms={stats.day0_ms}
          dates={stats.dates}
          longestStreak={streaks.longest}
        />
      </motion.div>

      <motion.div variants={listItem} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold text-foreground">{t("ai.coach.hubTitle")}</h2>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={isCoachLoading}
            onClick={onAskCoach}
            className="gap-2 text-xs"
          >
            {isCoachLoading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-3.5 text-primary" aria-hidden />
            )}
            <span>{t("ai.coach.askButton")}</span>
          </Button>
        </div>

        {coachReport && (
          <CoachPanel
            report={coachReport}
            onSelectDeck={onSelectDeck}
            onClose={onClearCoachReport}
            onRefresh={onAskCoach}
            deckStats={stats.deck_stats}
          />
        )}

        <CoachCards coach={stats.coach} today={today} deckName={deckName} onDrill={onDrill} />
      </motion.div>

      <motion.div variants={listItem}>
        <Panel title={t("stats.panel.activity")}>
          <YearHeatmap
            reviews={stats.reviews}
            today={today}
            day0Ms={stats.day0_ms}
            dates={stats.dates}
          />
        </Panel>
      </motion.div>

      <motion.div variants={listItem}>
        <Panel title={t("stats.panel.retention")}>
          <RetentionChart
            weekly={stats.retention_weekly}
            goalPct={stats.retention_goal_pct}
            day0Ms={stats.day0_ms}
            dates={stats.dates}
          />
        </Panel>
      </motion.div>

      <div className="grid gap-6 md:grid-cols-2">
        <motion.div variants={listItem}>
          <Panel title={t("stats.panel.answers")}>
            <AnswerButtonsChart
              buttons={stats.answer_buttons}
              onDrill={onDrill}
              deckName={deckName}
              rangeDays={rangeDays}
            />
          </Panel>
        </motion.div>
        <motion.div variants={listItem}>
          <Panel title={t("stats.panel.hourly")}>
            <HourlyChart hourly={stats.hourly} />
          </Panel>
        </motion.div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <motion.div variants={listItem}>
          <Panel title={t("stats.panel.forecast")}>
            <ForecastChart
              forecast={stats.forecast}
              backlogCount={stats.backlog_count}
              today={today}
              onDrill={onDrill}
              deckName={deckName}
            />
          </Panel>
        </motion.div>
        <motion.div variants={listItem}>
          <Panel title={t("stats.panel.maturity")}>
            <MaturityDonut stats={stats} onDrill={onDrill} deckName={deckName} />
          </Panel>
        </motion.div>
      </div>

      <motion.div variants={listItem}>
        <Panel title={t("stats.panel.fsrs")}>
          <FsrsPanels
            fsrs={stats.fsrs}
            onDrill={onDrill}
            deckName={deckName}
            fsrsDeckNames={fsrsDeckNames}
            fsrsConfigLoaded={fsrsConfigLoaded}
          />
        </Panel>
      </motion.div>

      {stats.deck_stats.length > 0 ? (
        <motion.div variants={listItem}>
          <Panel title={t("nav.decks")}>
            <DeckTable deckStats={stats.deck_stats} onSelectDeck={onSelectDeck} />
          </Panel>
        </motion.div>
      ) : null}
    </motion.div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-4 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}
