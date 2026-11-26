import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  MessageSquarePlus,
  Minus,
  Snowflake,
} from "lucide-react";
import type { HabitDto, HabitLogDto, WeekStart } from "@bibalak/ipc-types";
import { FrostShieldIcon } from "@/components/icons/game";
import { sequential } from "@/components/stats/chartTheme";
import { Button } from "@/components/ui/button";
import { SidePanel } from "@/components/ui/side-panel";
import { ipc, isTauri } from "@/lib/ipc";
import { formatDate, formatNumber, t, tn } from "@/lib/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { styleKey, type PresentationStyleOrGame } from "@/lib/styles/styleKey";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";
import { cn } from "@/lib/utils";
import {
  addIsoDays,
  buildMonthGridCells,
  diffIsoDays,
  isHabitScheduledForDay,
  localizedWeekStartHeaders,
  parseIsoDateLocal,
  weekStartIsoWeekday,
} from "./habitHelpers";

interface HabitDetailPanelProps {
  habit: HabitDto | null;
  weekStart: WeekStart;
  style: PresentationStyleOrGame;
  freezeTokensHeld?: number;
  freezeTokenCap?: number;
  onToggleYesNo: (habit: HabitDto, dayIndex: number, completed: boolean, log?: HabitLogDto) => void;
  onToggleSkip: (habit: HabitDto, dayIndex: number, log?: HabitLogDto) => void;
  onToggleFreeze?: (habit: HabitDto, dayIndex: number, log?: HabitLogDto) => void;
  onOpenLog: (habit: HabitDto, dayIndex: number, log?: HabitLogDto) => void;
  onClose: () => void;
}

type CellState = "completed" | "partial" | "skipped" | "frozen" | "missed" | "today" | "rest";

function cellVisualState(
  habit: HabitDto,
  dayIndex: number,
  dateStr: string,
  todayDayIndex: number,
  log: HabitLogDto | undefined,
): CellState {
  if (dayIndex > todayDayIndex) return "rest";
  if (dayIndex < habit.start_day_index) return "rest";
  if (habit.target_days !== null && dayIndex >= habit.start_day_index + habit.target_days) {
    return "rest";
  }
  if (log?.status === "frozen") return "frozen";
  if (log?.status === "skipped") return "skipped";
  if (log?.completed) return "completed";
  if (log && log.logged_value > 0) return "partial";
  if (!isHabitScheduledForDay(habit, dayIndex, dateStr)) return "rest";
  return dayIndex === todayDayIndex ? "today" : "missed";
}

function heatmapFill(state: CellState, log: HabitLogDto | undefined): string {
  switch (state) {
    case "completed":
      return sequential[4];
    case "partial": {
      const ratio = log && log.goal_target > 0 ? log.logged_value / log.goal_target : 0.4;
      if (ratio >= 0.7) return sequential[3];
      if (ratio >= 0.35) return sequential[2];
      return sequential[1];
    }
    case "skipped":
    case "frozen":
      return "hsl(var(--muted))";
    default:
      return "hsl(var(--secondary))";
  }
}

function stateLabel(state: CellState, style: PresentationStyleOrGame): string {
  switch (state) {
    case "completed":
      return t("habits.detail.cellState.completed");
    case "partial":
      return t("habits.detail.cellState.partial");
    case "skipped":
      return t(styleKey("habits.status.skipped", style));
    case "frozen":
      return t("habits.status.frozen");
    case "missed":
      return t("habits.detail.cellState.missed");
    default:
      return t("habits.detail.cellState.rest");
  }
}

export function HabitDetailPanel({
  habit,
  weekStart,
  style,
  freezeTokensHeld = 0,
  freezeTokenCap = 3,
  onToggleYesNo,
  onToggleSkip,
  onToggleFreeze,
  onOpenLog,
  onClose,
}: HabitDetailPanelProps) {
  const tauri = isTauri();
  const navigate = useOptionalNavigate();
  const open = habit !== null;

  const historyQuery = useQuery({
    queryKey: habit
      ? [...queryKeys.habitHistory(habit.id, 12), weekStart]
      : queryKeys.habitHistoryAll,
    queryFn: () => ipc.getHabitHistory(habit!.id, 12, weekStart),
    enabled: tauri && open,
  });

  const history = historyQuery.data;

  const [monthCursor, setMonthCursor] = useState<{ year: number; month: number } | null>(null);
  const [selectedCellDate, setSelectedCellDate] = useState<string | null>(null);

  useEffect(() => {
    setMonthCursor(null);
    setSelectedCellDate(null);
  }, [habit?.id]);

  const activeMonth = useMemo(() => {
    if (monthCursor) return monthCursor;
    const baseDate = history?.today_date ?? habit?.start_date ?? "2026-01-01";
    const [y, m] = baseDate.split("-").map(Number);
    return { year: y || 2026, month: (m || 1) - 1 };
  }, [monthCursor, history?.today_date, habit?.start_date]);

  const logByDate = useMemo(() => {
    const map = new Map<string, HabitLogDto>();
    if (!history) return map;
    for (const log of history.logs) {
      map.set(log.date, log);
    }
    return map;
  }, [history]);

  const monthCells = useMemo(
    () => buildMonthGridCells(activeMonth.year, activeMonth.month, weekStart),
    [activeMonth.year, activeMonth.month, weekStart],
  );

  const weekdayHeaders = useMemo(() => localizedWeekStartHeaders(weekStart), [weekStart]);

  const heatmapCells = useMemo(() => {
    if (!history) return [];
    const todayIso = history.today_date;
    const [ty, tm, td] = todayIso.split("-").map(Number);
    const jsDay = new Date(Date.UTC(ty, (tm || 1) - 1, td || 1)).getUTCDay();
    const todayIsoWd = jsDay === 0 ? 7 : jsDay;
    const firstWd = weekStartIsoWeekday(weekStart);
    const offsetInWeek = (((todayIsoWd - firstWd) % 7) + 7) % 7;
    const currentWeekStartIso = addIsoDays(todayIso, -offsetInWeek);
    const gridStartIso = addIsoDays(currentWeekStartIso, -(51 * 7));

    return Array.from({ length: 52 * 7 }, (_, i) => {
      const dateStr = addIsoDays(gridStartIso, i);
      const dayIndex = history.today_day_index + diffIsoDays(dateStr, todayIso);
      const log = logByDate.get(dateStr);
      const state = cellVisualState(history.habit, dayIndex, dateStr, history.today_day_index, log);
      return { dateStr, dayIndex, log, state };
    });
  }, [history, weekStart, logByDate]);

  const notesLogs = useMemo(() => {
    if (!history) return [];
    return history.logs
      .filter((l) => l.mood !== null || l.note.trim().length > 0)
      .slice()
      .sort((a, b) => b.day_index - a.day_index);
  }, [history]);

  const selectedCellInfo = useMemo(() => {
    if (!history || !selectedCellDate) return null;
    const dayIndex = history.today_day_index + diffIsoDays(selectedCellDate, history.today_date);
    if (dayIndex > history.today_day_index || dayIndex < history.habit.start_day_index) {
      return null;
    }
    const log = logByDate.get(selectedCellDate);
    return { date: selectedCellDate, dayIndex, log };
  }, [history, selectedCellDate, logByDate]);

  const stepMonth = (delta: number) => {
    const dt = new Date(Date.UTC(activeMonth.year, activeMonth.month + delta, 1));
    setMonthCursor({ year: dt.getUTCFullYear(), month: dt.getUTCMonth() });
  };

  const panelTitle = habit ? `${t(styleKey("habits.detail.title", style))}: ${habit.title}` : "";

  return (
    <SidePanel open={open} title={panelTitle} width={420} onClose={onClose}>
      {habit && (
        <div className="space-y-5 p-4">
          {historyQuery.isLoading ? (
            <div data-testid="habit-detail-loading" className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-lg border border-border bg-secondary/40"
                  />
                ))}
              </div>
              <div className="h-52 animate-pulse rounded-xl border border-border bg-secondary/40" />
              <div className="h-24 animate-pulse rounded-xl border border-border bg-secondary/40" />
            </div>
          ) : historyQuery.isError ? (
            <div className="space-y-3 rounded-xl border border-destructive/40 bg-card p-4 text-sm text-destructive">
              <p>{t("habits.error")}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void historyQuery.refetch()}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : history ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <StatTile
                  label={t(styleKey("habits.detail.stat.streak", style))}
                  value={tn("habits.streak", history.current_streak)}
                />
                <StatTile
                  label={t("habits.detail.stat.best")}
                  value={tn("habits.streak", history.longest_streak)}
                />
                <StatTile
                  label={t(styleKey("habits.detail.stat.rate", style))}
                  value={`${formatNumber(Math.round(history.completion_rate_pct))}%`}
                />
                <StatTile
                  label={t(styleKey("habits.detail.stat.skipped", style))}
                  value={formatNumber(history.skipped_days)}
                />
                {style === "game" && history.frozen_days > 0 && (
                  <StatTile
                    label={t("habits.detail.frozenStat")}
                    value={formatNumber(history.frozen_days)}
                  />
                )}
              </div>

              {style === "game" && (
                <section
                  data-slot="game-freeze"
                  aria-label={t("habits.streakProtection")}
                  className="space-y-3 rounded-xl border border-border bg-background/50 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FrostShieldIcon className="size-4 text-[hsl(var(--game-freeze))]" />
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                        {t("habits.streakProtection")}
                      </h3>
                    </div>
                    <span className="tnum rounded-md border border-[hsl(var(--game-freeze))]/30 bg-[hsl(var(--game-freeze))]/10 px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--game-freeze))]">
                      {t("game.freeze.held", {
                        held: formatNumber(freezeTokensHeld),
                        cap: formatNumber(freezeTokenCap),
                      })}
                    </span>
                  </div>

                  {(() => {
                    const todayIdx = history.today_day_index;
                    const yesterdayIdx = todayIdx - 1;
                    const todayLog = history.logs.find((l) => l.day_index === todayIdx);
                    const yesterdayLog = history.logs.find((l) => l.day_index === yesterdayIdx);
                    const showYesterday = yesterdayIdx >= history.habit.start_day_index;

                    const renderDayButton = (
                      dayIdx: number,
                      dayLog: HabitLogDto | undefined,
                      freezeLabelKey: "habits.freezeToday" | "habits.freezeYesterday",
                    ) => {
                      const isFrozen = dayLog?.status === "frozen";
                      const isDone = dayLog?.completed ?? false;
                      const disabledReason = isFrozen
                        ? undefined
                        : isDone
                          ? t("habits.freezeAlreadyCompleted")
                          : freezeTokensHeld <= 0
                            ? t("habits.noFreezeTokens")
                            : undefined;

                      return (
                        <Button
                          key={dayIdx}
                          type="button"
                          variant={isFrozen ? "secondary" : "outline"}
                          size="sm"
                          className="min-h-8 text-xs"
                          aria-pressed={isFrozen}
                          disabled={Boolean(disabledReason) || !onToggleFreeze}
                          title={disabledReason}
                          onClick={() => onToggleFreeze?.(history.habit, dayIdx, dayLog)}
                        >
                          <FrostShieldIcon className="size-3.5 text-[hsl(var(--game-freeze))]" />
                          {isFrozen ? t("habits.unfreezeDay") : t(freezeLabelKey)}
                        </Button>
                      );
                    };

                    return (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          {renderDayButton(todayIdx, todayLog, "habits.freezeToday")}
                          {showYesterday &&
                            renderDayButton(yesterdayIdx, yesterdayLog, "habits.freezeYesterday")}
                        </div>

                        {freezeTokensHeld <= 0 && (
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{t("habits.noFreezeTokens")}</span>
                            <a
                              href="/shop"
                              onClick={(e) => {
                                if (navigate) {
                                  e.preventDefault();
                                  navigate("/shop");
                                }
                              }}
                              className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {t("habits.goToShop")}
                            </a>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </section>
              )}

              <section className="space-y-2.5 rounded-xl border border-border bg-background/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("habits.detail.monthSection")}
                  </h3>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      aria-label={t("habits.detail.prevMonth")}
                      onClick={() => stepMonth(-1)}
                    >
                      <ChevronLeft className="size-4 rtl:-scale-x-100" />
                    </Button>
                    <span className="min-w-24 text-center text-xs font-medium text-foreground">
                      {formatDate(new Date(activeMonth.year, activeMonth.month, 1), {
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      aria-label={t("habits.detail.nextMonth")}
                      onClick={() => stepMonth(1)}
                    >
                      <ChevronRight className="size-4 rtl:-scale-x-100" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
                  {weekdayHeaders.map((wd) => (
                    <span key={wd.iso}>{wd.label}</span>
                  ))}
                </div>

                <div data-testid="habit-month-grid" className="grid grid-cols-7 gap-1">
                  {monthCells.map((cell) => {
                    const dayIndex =
                      history.today_day_index + diffIsoDays(cell.date, history.today_date);
                    const log = logByDate.get(cell.date);
                    const state = cellVisualState(
                      history.habit,
                      dayIndex,
                      cell.date,
                      history.today_day_index,
                      log,
                    );
                    const interactive =
                      dayIndex <= history.today_day_index &&
                      dayIndex >= history.habit.start_day_index &&
                      (history.habit.target_days === null ||
                        dayIndex < history.habit.start_day_index + history.habit.target_days);
                    const isSelected = selectedCellDate === cell.date;
                    const cellDateLabel = formatDate(parseIsoDateLocal(cell.date), {
                      dateStyle: "medium",
                    });

                    return (
                      <button
                        key={cell.date}
                        type="button"
                        disabled={!interactive}
                        data-date={cell.date}
                        data-state={state}
                        aria-label={`${cellDateLabel} — ${stateLabel(state, style)}`}
                        aria-pressed={interactive ? isSelected : undefined}
                        onClick={() =>
                          setSelectedCellDate((cur) => (cur === cell.date ? null : cell.date))
                        }
                        className={cn(
                          "tnum relative flex aspect-square items-center justify-center rounded-md border text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none",
                          !cell.inMonth && "opacity-40",
                          state === "completed" && "border-good bg-good text-white font-medium",
                          state === "partial" &&
                            "border-primary/50 bg-primary/15 text-primary font-medium",
                          state === "skipped" && "border-border bg-muted text-muted-foreground",
                          state === "frozen" && "border-easy/40 bg-easy/15 text-easy",
                          state === "missed" &&
                            "border-border/80 bg-background text-muted-foreground",
                          state === "today" &&
                            "border-primary bg-primary/5 font-semibold text-foreground",
                          state === "rest" && "border-transparent text-muted-foreground/50",
                          isSelected && "ring-2 ring-ring ring-offset-1",
                        )}
                      >
                        {state === "frozen" ? (
                          <Snowflake className="size-3.5" aria-hidden="true" />
                        ) : (
                          formatNumber(cell.dayNumber)
                        )}
                        {state === "skipped" && (
                          <Minus
                            className="absolute bottom-0.5 size-2.5 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>

                {selectedCellInfo && (
                  <div
                    data-testid="habit-detail-day-actions"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-2.5"
                  >
                    <span className="text-xs font-medium text-foreground">
                      {formatDate(parseIsoDateLocal(selectedCellInfo.date), {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {history.habit.deck_id === null && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() =>
                            onToggleYesNo(
                              history.habit,
                              selectedCellInfo.dayIndex,
                              selectedCellInfo.log?.completed ?? false,
                              selectedCellInfo.log,
                            )
                          }
                        >
                          <Check className="size-3" />
                          {selectedCellInfo.log?.completed
                            ? t("habits.detail.clearCheckInButton")
                            : t("habits.detail.checkInButton")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          onToggleSkip(
                            history.habit,
                            selectedCellInfo.dayIndex,
                            selectedCellInfo.log,
                          )
                        }
                      >
                        {selectedCellInfo.log?.status === "skipped"
                          ? t(styleKey("habits.unskipDay", style))
                          : t(styleKey("habits.skipDay", style))}
                      </Button>
                      {style === "game" &&
                        onToggleFreeze &&
                        (selectedCellInfo.dayIndex === history.today_day_index ||
                          selectedCellInfo.dayIndex === history.today_day_index - 1 ||
                          selectedCellInfo.log?.status === "frozen") && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            aria-pressed={selectedCellInfo.log?.status === "frozen"}
                            disabled={
                              selectedCellInfo.log?.status !== "frozen" &&
                              ((selectedCellInfo.log?.completed ?? false) || freezeTokensHeld <= 0)
                            }
                            title={
                              selectedCellInfo.log?.status === "frozen"
                                ? undefined
                                : selectedCellInfo.log?.completed
                                  ? t("habits.freezeAlreadyCompleted")
                                  : freezeTokensHeld <= 0
                                    ? t("habits.noFreezeTokens")
                                    : undefined
                            }
                            onClick={() =>
                              onToggleFreeze(
                                history.habit,
                                selectedCellInfo.dayIndex,
                                selectedCellInfo.log,
                              )
                            }
                          >
                            <FrostShieldIcon className="size-3" />
                            {selectedCellInfo.log?.status === "frozen"
                              ? t("habits.unfreezeDay")
                              : t("habits.freezeDay")}
                          </Button>
                        )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          onOpenLog(history.habit, selectedCellInfo.dayIndex, selectedCellInfo.log)
                        }
                      >
                        <MessageSquarePlus className="size-3" />
                        {selectedCellInfo.log ? t("habits.detail.editLog") : t("habits.addLog")}
                      </Button>
                    </div>
                  </div>
                )}
              </section>

              <section className="space-y-2 rounded-xl border border-border bg-background/50 p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("habits.detail.heatmapSection")}
                </h3>
                <div
                  data-testid="habit-year-heatmap"
                  className="grid gap-[2px]"
                  style={{
                    gridTemplateColumns: "repeat(52, minmax(0, 1fr))",
                    gridTemplateRows: "repeat(7, minmax(0, 1fr))",
                    gridAutoFlow: "column",
                  }}
                >
                  {heatmapCells.map((cell) => {
                    const cellDateLabel = formatDate(parseIsoDateLocal(cell.dateStr), {
                      dateStyle: "medium",
                    });
                    return (
                      <div
                        key={cell.dateStr}
                        title={t("habits.detail.heatmapCell", {
                          date: cellDateLabel,
                          status: stateLabel(cell.state, style),
                        })}
                        className="aspect-square w-full rounded-[2px]"
                        style={{
                          backgroundColor: heatmapFill(cell.state, cell.log),
                          outline:
                            cell.dayIndex === history.today_day_index
                              ? "1.5px solid hsl(var(--foreground))"
                              : undefined,
                          outlineOffset:
                            cell.dayIndex === history.today_day_index ? "-1.5px" : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("habits.detail.notesSection")}
                </h3>
                {notesLogs.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                    {t(styleKey("habits.detail.emptyNotes", style))}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {notesLogs.map((log) => (
                      <li
                        key={`${log.habit_id}:${log.day_index}`}
                        className="space-y-1 rounded-xl border border-border bg-background/50 p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="font-medium text-foreground">
                            {formatDate(parseIsoDateLocal(log.date), {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {log.status === "skipped" && (
                              <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                {t(styleKey("habits.status.skipped", style))}
                              </span>
                            )}
                            {log.status === "frozen" && style === "game" && (
                              <span className="rounded border border-[hsl(var(--game-freeze))]/40 bg-[hsl(var(--game-freeze))]/15 px-1.5 py-0.5 text-[11px] text-[hsl(var(--game-freeze))]">
                                {t("habits.status.frozen")}
                              </span>
                            )}
                            {log.mood !== null && (
                              <span className="tnum rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
                                {t("habits.logDialog.moodOption", { n: formatNumber(log.mood) })}
                              </span>
                            )}
                          </div>
                        </div>
                        {log.note.trim().length > 0 && (
                          <p dir="auto" className="text-sm text-foreground">
                            {log.note}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : null}
        </div>
      )}
    </SidePanel>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/60 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="tnum mt-0.5 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
