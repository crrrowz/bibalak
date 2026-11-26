import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Check,
  CheckCircle2,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Plus,
  SkipForward,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { HabitDto, HabitInput, HabitLogDto, HabitLogInput } from "@bibalak/ipc-types";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/EmptyState";
import { EmptyStatePicture } from "@/components/illustrations/EmptyStatePicture";
import { FrostShieldIcon } from "@/components/icons/game";
import { Button } from "@/components/ui/button";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/ui/action-menu";
import { useGameState } from "@/features/game/useGameState";
import { errorMessage, ipc, isTauri } from "@/lib/ipc";
import { formatDate, formatNumber, t, tn } from "@/lib/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { styleKey, type PresentationStyleOrGame } from "@/lib/styles/styleKey";
import { formatUndoAction } from "@/lib/undo";
import { cn } from "@/lib/utils";
import { useStyle } from "@/stores/style";
import { toast } from "@/stores/toast";
import { useWeekStart } from "@/stores/weekStart";
import {
  HABIT_SECTIONS,
  amountPresetSteps,
  isHabitScheduledForDay,
  parseIsoDateLocal,
} from "./habitHelpers";
import { HabitWeekStrip } from "./HabitWeekStrip";
import { CreateHabitDialog, HabitIconGlyph } from "./CreateHabitDialog";
import { HabitLogDialog } from "./HabitLogDialog";
import { HabitDetailPanel } from "./HabitDetailPanel";
import { ArchivedHabitsDrawer } from "./ArchivedHabitsDrawer";

const AMOUNT_RING_RADIUS = 14;
const AMOUNT_RING_CIRCUMFERENCE = 2 * Math.PI * AMOUNT_RING_RADIUS;

function AmountRingSvg({
  habit,
  pct,
  completed,
}: {
  habit: HabitDto;
  pct: number;
  completed: boolean;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  const dashOffset = AMOUNT_RING_CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div
      data-testid={`habit-amount-ring-${habit.id}`}
      data-progress={String(Math.round(clamped))}
      className="relative flex size-9 shrink-0 items-center justify-center"
    >
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        <circle
          cx="18"
          cy="18"
          r={AMOUNT_RING_RADIUS}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth="3"
        />
        {clamped > 0 && (
          <circle
            cx="18"
            cy="18"
            r={AMOUNT_RING_RADIUS}
            fill="none"
            stroke={completed ? "hsl(var(--good))" : "hsl(var(--primary))"}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={AMOUNT_RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 18 18)"
          />
        )}
      </svg>
      <HabitIconGlyph
        iconKey={habit.icon_key}
        className={cn("absolute size-4", completed ? "text-good" : "text-primary")}
      />
    </div>
  );
}

function HabitRow({
  habit,
  log,
  activeDayIndex,
  isFutureDay,
  isTodayOrYesterday,
  freezeTokensHeld,
  isSelected,
  style,
  onFocusRow,
  onOpenDetail,
  onToggleYesNo,
  onSaveAmount,
  onToggleSkip,
  onToggleFreeze,
  onEdit,
  onOpenLog,
  onArchive,
  onDelete,
}: {
  habit: HabitDto;
  log: HabitLogDto | undefined;
  activeDayIndex: number;
  isFutureDay: boolean;
  isTodayOrYesterday: boolean;
  freezeTokensHeld: number;
  isSelected: boolean;
  style: PresentationStyleOrGame;
  onFocusRow: (habitId: string) => void;
  onOpenDetail: (habit: HabitDto) => void;
  onToggleYesNo: (habit: HabitDto, completed: boolean, log?: HabitLogDto) => void;
  onSaveAmount: (habit: HabitDto, value: number, log?: HabitLogDto) => void;
  onToggleSkip: (habit: HabitDto, log?: HabitLogDto) => void;
  onToggleFreeze: (habit: HabitDto, log?: HabitLogDto) => void;
  onEdit: (habit: HabitDto) => void;
  onOpenLog: (habit: HabitDto, log?: HabitLogDto) => void;
  onArchive: (habit: HabitDto) => void;
  onDelete: (habit: HabitDto) => void;
}) {
  const loggedVal = log?.logged_value ?? 0;
  const completed = log?.completed ?? false;
  const isSkipped = log?.status === "skipped";
  const isFrozen = log?.status === "frozen";
  const isDeckLinked = habit.deck_id !== null;
  const [amountDraft, setAmountDraft] = useState<string>(String(loggedVal));

  useEffect(() => {
    setAmountDraft(String(loggedVal));
  }, [loggedVal, activeDayIndex]);

  const pct =
    habit.goal_target > 0 ? Math.min(100, Math.max(0, (loggedVal / habit.goal_target) * 100)) : 0;
  const presets = amountPresetSteps(habit.goal_target);

  return (
    <div
      data-testid={`habit-row-${habit.id}`}
      data-habit-row={habit.id}
      data-status={log?.status ?? "unlogged"}
      tabIndex={0}
      onFocus={() => onFocusRow(habit.id)}
      className={cn(
        "group flex flex-col gap-2.5 rounded-xl border bg-card px-4 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected ? "border-primary/60" : "border-border",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {habit.goal_mode === "reach_amount" ? (
            <AmountRingSvg habit={habit} pct={pct} completed={completed} />
          ) : habit.goal_mode === "achieve_all" && !isDeckLinked ? (
            <button
              type="button"
              disabled={isFutureDay}
              aria-label={
                completed
                  ? t("habits.clearCheckInAria", { title: habit.title })
                  : t("habits.checkInAria", { title: habit.title })
              }
              aria-pressed={completed}
              onClick={() => onToggleYesNo(habit, completed, log)}
              className={cn(
                "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                completed
                  ? "border-good bg-good text-white"
                  : isSkipped
                    ? "border-border bg-muted text-muted-foreground"
                    : "border-border bg-secondary/40 text-muted-foreground hover:border-primary hover:text-primary",
              )}
            >
              {completed ? (
                <Check className="size-4" />
              ) : (
                <HabitIconGlyph iconKey={habit.icon_key} className="size-4" />
              )}
            </button>
          ) : (
            <div
              className={cn(
                "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border",
                completed
                  ? "border-good bg-good/15 text-good"
                  : "border-border bg-secondary/40 text-primary",
              )}
            >
              <HabitIconGlyph iconKey={habit.icon_key} className="size-4" />
            </div>
          )}

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label={t("habits.detail.openAria", { title: habit.title })}
                onClick={() => onOpenDetail(habit)}
                className="rounded text-start font-medium text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span dir="auto">{habit.title}</span>
              </button>
              {habit.deck_id !== null && (
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
                  {habit.deck_name ?? t("habits.missingDeck")}
                </span>
              )}
              {habit.current_streak > 0 && (
                <span className="tnum text-xs text-muted-foreground">
                  {tn("habits.streak", habit.current_streak)}
                </span>
              )}
              {isSkipped && (
                <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {t(styleKey("habits.status.skipped", style))}
                </span>
              )}
              {isFrozen && style === "game" && (
                <span className="rounded-md border border-[hsl(var(--game-freeze))]/40 bg-[hsl(var(--game-freeze))]/15 px-1.5 py-0.5 text-[11px] font-medium text-[hsl(var(--game-freeze))]">
                  {t("habits.status.frozen")}
                </span>
              )}
            </div>

            {habit.goal_mode === "reach_amount" && (
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="progressbar"
                  aria-label={habit.title}
                  aria-valuemin={0}
                  aria-valuemax={habit.goal_target}
                  aria-valuenow={loggedVal}
                  className="h-1.5 min-w-20 flex-1 overflow-hidden rounded-full bg-secondary"
                >
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-200",
                      completed ? "bg-good" : "bg-primary",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="tnum text-xs text-muted-foreground">
                  {t("habits.progressFraction", {
                    logged: formatNumber(loggedVal),
                    target: formatNumber(habit.goal_target),
                    unit: habit.goal_unit,
                  })}
                </span>
                {isDeckLinked && (
                  <span className="text-xs text-muted-foreground">{t("habits.fromReviews")}</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isDeckLinked && habit.goal_mode !== "reach_amount" && (
            <span className="text-xs text-muted-foreground">{t("habits.fromReviews")}</span>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isFutureDay}
            onClick={() => onToggleSkip(habit, log)}
            className="text-muted-foreground hover:text-foreground"
          >
            <SkipForward className="size-3.5" aria-hidden="true" />
            {isSkipped
              ? t(styleKey("habits.unskipDay", style))
              : t(styleKey("habits.skipDay", style))}
          </Button>

          {style === "game" &&
            (() => {
              const freezeDisabledReason = isFrozen
                ? isFutureDay
                  ? t("habits.futureDayNotice")
                  : undefined
                : completed
                  ? t("habits.freezeAlreadyCompleted")
                  : !isTodayOrYesterday
                    ? t("habits.freezeWindowHint")
                    : freezeTokensHeld <= 0
                      ? t("habits.noFreezeTokens")
                      : undefined;

              return (
                <div data-slot="game-freeze">
                  <Button
                    type="button"
                    variant={isFrozen ? "secondary" : "ghost"}
                    size="sm"
                    disabled={Boolean(freezeDisabledReason)}
                    aria-pressed={isFrozen}
                    title={freezeDisabledReason}
                    onClick={() => onToggleFreeze(habit, log)}
                    className={cn(
                      "min-h-8",
                      isFrozen
                        ? "border border-[hsl(var(--game-freeze))]/40 bg-[hsl(var(--game-freeze))]/15 text-[hsl(var(--game-freeze))]"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <FrostShieldIcon className="size-3.5" aria-hidden="true" />
                    {isFrozen ? t("habits.unfreezeDay") : t("habits.freezeDay")}
                  </Button>
                </div>
              );
            })()}

          <ActionMenu
            menuLabel={t("habits.actionsAria", { title: habit.title })}
            triggerAriaLabel={t("habits.actionsAria", { title: habit.title })}
            triggerVariant="ghost"
            triggerSize="sm"
            triggerClassName="h-8 w-8 p-0"
            triggerContent={<MoreHorizontal className="size-4" />}
          >
            <ActionMenuItem
              icon={<Pencil className="size-4" />}
              label={t("habits.edit")}
              onSelect={() => onEdit(habit)}
            />
            {!isFutureDay && (
              <ActionMenuItem
                icon={<MessageSquarePlus className="size-4" />}
                label={t("habits.addLog")}
                onSelect={() => onOpenLog(habit, log)}
              />
            )}
            {!isFutureDay && (
              <ActionMenuItem
                icon={<SkipForward className="size-4" />}
                label={
                  isSkipped
                    ? t(styleKey("habits.unskipDay", style))
                    : t(styleKey("habits.skipDay", style))
                }
                onSelect={() => onToggleSkip(habit, log)}
              />
            )}
            <ActionMenuItem
              icon={<Archive className="size-4" />}
              label={t("habits.archive")}
              onSelect={() => onArchive(habit)}
            />
            <ActionMenuSeparator />
            <ActionMenuItem
              icon={<Trash2 className="size-4" />}
              label={t("habits.delete")}
              danger
              onSelect={() => onDelete(habit)}
            />
          </ActionMenu>
        </div>
      </div>

      {!isDeckLinked && habit.goal_mode === "reach_amount" && (
        <div className="flex flex-wrap items-center gap-1.5 ps-12">
          <input
            id={`habit-amount-${habit.id}`}
            name={`habit-amount-${habit.id}`}
            type="number"
            min={0}
            step="any"
            disabled={isFutureDay}
            aria-label={t("habits.amountInputAria", { title: habit.title })}
            value={amountDraft}
            onChange={(e) => setAmountDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const val = Math.max(0, Number(amountDraft) || 0);
                onSaveAmount(habit, val, log);
              }
            }}
            className="tnum h-8 w-20 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isFutureDay}
            onClick={() => {
              const val = Math.max(0, Number(amountDraft) || 0);
              onSaveAmount(habit, val, log);
            }}
          >
            {t("habits.saveAmount")}
          </Button>
          {presets.map((step) => (
            <Button
              key={step}
              type="button"
              variant="secondary"
              size="sm"
              disabled={isFutureDay}
              aria-label={t("habits.addAmountAria", {
                amount: formatNumber(step),
                title: habit.title,
              })}
              onClick={() => onSaveAmount(habit, loggedVal + step, log)}
            >
              <span dir="ltr">+{formatNumber(step)}</span>
            </Button>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isFutureDay || completed}
            onClick={() => onSaveAmount(habit, habit.goal_target, log)}
          >
            {t(styleKey("habits.preset.complete", style))}
          </Button>
        </div>
      )}
    </div>
  );
}

export function HabitTrackerScreen() {
  const tauri = isTauri();
  const queryClient = useQueryClient();
  const weekStart = useWeekStart((s) => s.weekStart);
  const style = useStyle((s) => s.style) as PresentationStyleOrGame;

  const [weekStartDay, setWeekStartDay] = useState<number | null>(null);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);
  const [focusedHabitId, setFocusedHabitId] = useState<string | null>(null);
  const [drawerMode, setDrawerMode] = useState<
    { kind: "detail"; habitId: string } | { kind: "archived" } | null
  >(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<HabitDto | null>(null);
  const [logDialogTarget, setLogDialogTarget] = useState<{
    habit: HabitDto;
    dayIndex: number;
    existingLog?: HabitLogDto;
  } | null>(null);

  const listContainerRef = useRef<HTMLDivElement>(null);
  const prevWeekStartRef = useRef(weekStart);

  useEffect(() => {
    if (prevWeekStartRef.current !== weekStart) {
      prevWeekStartRef.current = weekStart;
      setWeekStartDay(null);
    }
  }, [weekStart]);

  const boardQuery = useQuery({
    queryKey: [...queryKeys.habitsAll, weekStartDay, weekStart],
    queryFn: () => ipc.getHabitBoard(weekStartDay, weekStart),
    enabled: tauri,
  });

  const decksQuery = useQuery({
    queryKey: queryKeys.decks,
    queryFn: ipc.listDecks,
    enabled: tauri,
  });

  const undoStatusQuery = useQuery({
    queryKey: queryKeys.undoStatus,
    queryFn: ipc.undoStatus,
    enabled: tauri,
  });

  const gameQuery = useGameState(tauri && style === "game");
  const freezeTokensHeld = gameQuery.data?.freeze_tokens_held ?? 0;
  const freezeTokenCap = gameQuery.data?.freeze_token_cap ?? 3;

  const invalidateAll = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.habitsAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.habitHistoryAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.undoStatus }),
        queryClient.invalidateQueries({ queryKey: queryKeys.progressSummary }),
        queryClient.invalidateQueries({ queryKey: queryKeys.gameState }),
      ]),
    [queryClient],
  );

  const onMutError = (err: unknown) => {
    toast.error(errorMessage(err));
  };

  const createHabitMut = useMutation({
    mutationFn: (input: HabitInput) => ipc.createHabit(input),
    onSuccess: () => void invalidateAll(),
  });

  const updateHabitMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: HabitInput }) => ipc.updateHabit(id, input),
    onSuccess: () => void invalidateAll(),
  });

  const archiveMut = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      ipc.archiveHabit(id, archived),
    onSuccess: () => void invalidateAll(),
    onError: onMutError,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => ipc.deleteHabit(id),
    onSuccess: (_data, id) => {
      setDrawerMode((cur) => (cur?.kind === "detail" && cur.habitId === id ? null : cur));
      void invalidateAll();
    },
    onError: onMutError,
  });

  const logMut = useMutation({
    mutationFn: (input: HabitLogInput) => ipc.logHabit(input),
    onSuccess: () => void invalidateAll(),
    onError: onMutError,
  });

  const undoMut = useMutation({
    mutationFn: () => ipc.undo(),
    onSuccess: () => void invalidateAll(),
    onError: onMutError,
  });

  const board = boardQuery.data;
  const decks = decksQuery.data ?? [];
  const undoAction = undoStatusQuery.data ?? null;

  const activeDayIndex = selectedDayIndex ?? board?.today_day_index ?? 0;
  const isFutureDay = board ? activeDayIndex > board.today_day_index : false;
  const isTodayOrYesterday = board
    ? activeDayIndex === board.today_day_index || activeDayIndex === board.today_day_index - 1
    : false;

  const selectedDayDto = useMemo(
    () => board?.week_days.find((d) => d.day_index === selectedDayIndex),
    [board, selectedDayIndex],
  );

  const logsByHabit = useMemo(() => {
    const map = new Map<string, HabitLogDto>();
    if (!board) return map;
    for (const l of board.logs) {
      if (l.day_index === activeDayIndex) {
        map.set(l.habit_id, l);
      }
    }
    return map;
  }, [board, activeDayIndex]);

  const visibleHabits = useMemo(() => {
    if (!board) return [];
    const active = board.habits.filter((h) => h.archived_at === null);
    if (selectedDayIndex === null || !selectedDayDto) return active;
    return active.filter((h) => isHabitScheduledForDay(h, selectedDayIndex, selectedDayDto.date));
  }, [board, selectedDayIndex, selectedDayDto]);

  const detailHabit = useMemo(() => {
    if (drawerMode?.kind !== "detail" || !board) return null;
    return board.habits.find((h) => h.id === drawerMode.habitId && h.archived_at === null) ?? null;
  }, [drawerMode, board]);

  const handleToggleYesNo = useCallback(
    async (habit: HabitDto, dayIndex: number, completed: boolean, log?: HabitLogDto) => {
      if (board && dayIndex > board.today_day_index) return;
      const nextValue = completed ? 0 : habit.goal_mode === "reach_amount" ? habit.goal_target : 1;
      const result = await logMut.mutateAsync({
        habit_id: habit.id,
        day_index: dayIndex,
        logged_value: nextValue,
        status: "logged",
        mood: log?.mood ?? null,
        note: log?.note ?? "",
      });
      if (!completed && habit.auto_popup_log) {
        setLogDialogTarget({ habit, dayIndex, existingLog: result });
      }
    },
    [board, logMut],
  );

  const handleSaveAmount = useCallback(
    async (habit: HabitDto, value: number, log?: HabitLogDto) => {
      if (isFutureDay) return;
      const wasCompleted = log?.completed ?? false;
      const result = await logMut.mutateAsync({
        habit_id: habit.id,
        day_index: activeDayIndex,
        logged_value: value,
        status: "logged",
        mood: log?.mood ?? null,
        note: log?.note ?? "",
      });
      if (!wasCompleted && result.completed && habit.auto_popup_log) {
        setLogDialogTarget({ habit, dayIndex: activeDayIndex, existingLog: result });
      }
    },
    [activeDayIndex, isFutureDay, logMut],
  );

  const handleToggleSkip = useCallback(
    async (habit: HabitDto, dayIndex: number, log?: HabitLogDto) => {
      if (board && dayIndex > board.today_day_index) return;
      const nextStatus = log?.status === "skipped" ? "logged" : "skipped";
      await logMut.mutateAsync({
        habit_id: habit.id,
        day_index: dayIndex,
        logged_value: 0,
        status: nextStatus,
        mood: log?.mood ?? null,
        note: log?.note ?? "",
      });
    },
    [board, logMut],
  );

  const handleToggleFreeze = useCallback(
    async (habit: HabitDto, dayIndex: number, log?: HabitLogDto) => {
      if (!board || style !== "game") return;
      const isFrozen = log?.status === "frozen";
      if (!isFrozen && (dayIndex < board.today_day_index - 1 || dayIndex > board.today_day_index)) {
        return;
      }
      const nextStatus = isFrozen ? "logged" : "frozen";
      await logMut.mutateAsync({
        habit_id: habit.id,
        day_index: dayIndex,
        logged_value: 0,
        status: nextStatus,
        mood: log?.mood ?? null,
        note: log?.note ?? "",
      });
      if (nextStatus === "frozen") {
        const dayMatch = board.week_days.find((d) => d.day_index === dayIndex);
        const dateText = dayMatch
          ? formatDate(parseIsoDateLocal(dayMatch.date), { month: "short", day: "numeric" })
          : formatNumber(dayIndex);
        toast.info(
          t("habits.freezeToast", {
            date: dateText,
            left: formatNumber(Math.max(0, freezeTokensHeld - 1)),
          }),
        );
      }
    },
    [board, freezeTokensHeld, logMut, style],
  );

  const handleArchive = (habit: HabitDto) => {
    archiveMut.mutate(
      { id: habit.id, archived: true },
      {
        onSuccess: () => {
          setDrawerMode((cur) => (cur?.kind === "detail" && cur.habitId === habit.id ? null : cur));
          toast.info(t("habits.archivedToast", { title: habit.title }), {
            action: {
              label: t("habits.unarchive"),
              onClick: () => archiveMut.mutate({ id: habit.id, archived: false }),
            },
          });
        },
      },
    );
  };

  useEffect(() => {
    if (!tauri) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (dialogOpen || logDialogTarget !== null) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]'))
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === "q" && board) {
        e.preventDefault();
        setEditingHabit(null);
        setDialogOpen(true);
        return;
      }
      if (key === "t" && board) {
        e.preventDefault();
        setWeekStartDay(null);
        setSelectedDayIndex(null);
        return;
      }
      if (key === "j" && board) {
        e.preventDefault();
        const curStart = board.week_days[0]?.day_index ?? board.today_day_index;
        setWeekStartDay(curStart + 7);
        return;
      }
      if (key === "k" && board) {
        e.preventDefault();
        const curStart = board.week_days[0]?.day_index ?? board.today_day_index;
        setWeekStartDay(curStart - 7);
        return;
      }
      if (key === "a") {
        e.preventDefault();
        setDrawerMode((cur) => (cur?.kind === "archived" ? null : { kind: "archived" }));
        return;
      }
      if (key === "z" && undoAction && !undoMut.isPending) {
        e.preventDefault();
        undoMut.mutate();
        return;
      }
      if (e.key === "Escape" && !drawerMode && selectedDayIndex !== null) {
        setSelectedDayIndex(null);
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const rows = Array.from(
          listContainerRef.current?.querySelectorAll<HTMLElement>("[data-habit-row]") ?? [],
        );
        if (rows.length === 0) return;
        const activeRow = target?.closest<HTMLElement>("[data-habit-row]");
        const idx = activeRow ? rows.indexOf(activeRow) : -1;
        const nextIdx =
          e.key === "ArrowDown"
            ? idx < 0
              ? 0
              : Math.min(rows.length - 1, idx + 1)
            : idx < 0
              ? rows.length - 1
              : Math.max(0, idx - 1);
        e.preventDefault();
        rows[nextIdx]?.focus();
        return;
      }

      const targetHabitId =
        target?.closest<HTMLElement>("[data-habit-row]")?.dataset.habitId ??
        target?.closest<HTMLElement>("[data-habit-row]")?.getAttribute("data-habit-row") ??
        focusedHabitId ??
        detailHabit?.id ??
        null;
      const targetHabit = targetHabitId
        ? visibleHabits.find((h) => h.id === targetHabitId)
        : undefined;
      if (!targetHabit) return;

      if (key === "s" && !isFutureDay) {
        e.preventDefault();
        void handleToggleSkip(targetHabit, activeDayIndex, logsByHabit.get(targetHabit.id));
        return;
      }

      const isRowWrapper = target?.hasAttribute("data-habit-row") ?? false;
      if (isRowWrapper && e.key === "Enter") {
        e.preventDefault();
        setDrawerMode({ kind: "detail", habitId: targetHabit.id });
        return;
      }
      if (
        isRowWrapper &&
        e.key === " " &&
        targetHabit.goal_mode === "achieve_all" &&
        targetHabit.deck_id === null &&
        !isFutureDay
      ) {
        e.preventDefault();
        const log = logsByHabit.get(targetHabit.id);
        void handleToggleYesNo(targetHabit, activeDayIndex, log?.completed ?? false, log);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    tauri,
    dialogOpen,
    logDialogTarget,
    board,
    undoAction,
    undoMut,
    drawerMode,
    selectedDayIndex,
    focusedHabitId,
    detailHabit?.id,
    visibleHabits,
    isFutureDay,
    activeDayIndex,
    logsByHabit,
    handleToggleSkip,
    handleToggleYesNo,
  ]);

  return (
    <div className="relative flex h-full flex-col">
      <ScreenHeader
        title={t("habits.title")}
        description={t(styleKey("habits.description", style))}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!tauri}
              aria-pressed={drawerMode?.kind === "archived"}
              onClick={() =>
                setDrawerMode((cur) => (cur?.kind === "archived" ? null : { kind: "archived" }))
              }
            >
              <Archive /> {t("habits.archived.open")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => undoMut.mutate()}
              disabled={!tauri || undoMut.isPending || !undoAction}
              title={
                undoAction
                  ? t("decks.undoAction", { action: formatUndoAction(undoAction) })
                  : t("decks.undoEmpty")
              }
            >
              <Undo2 /> {t("decks.undo")}
            </Button>
            <Button
              size="sm"
              disabled={!tauri}
              onClick={() => {
                setEditingHabit(null);
                setDialogOpen(true);
              }}
            >
              <Plus /> {t("habits.newHabit")}
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div ref={listContainerRef} className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">
          {!tauri ? (
            <EmptyState
              icon={CheckCircle2}
              title={t("habits.noTauri.title")}
              description={t("habits.noTauri.description")}
            />
          ) : boardQuery.isLoading ? (
            <div data-testid="habits-loading" className="mx-auto max-w-4xl space-y-5">
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="grid grid-cols-7 gap-2 py-2">
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="flex flex-col items-center gap-1.5">
                      <div className="h-3 w-8 animate-pulse rounded bg-secondary" />
                      <div className="size-7 animate-pulse rounded-full bg-secondary" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2.5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-xl border border-border bg-card"
                  />
                ))}
              </div>
            </div>
          ) : boardQuery.isError ? (
            <div className="mx-auto max-w-4xl space-y-3 rounded-xl border border-destructive/40 bg-card p-6 text-sm text-destructive">
              <p>{t("habits.error")}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void boardQuery.refetch()}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : board ? (
            <div className="mx-auto max-w-4xl space-y-5">
              <HabitWeekStrip
                weekDays={board.week_days}
                logs={board.logs}
                todayDayIndex={board.today_day_index}
                selectedDayIndex={selectedDayIndex}
                style={style}
                onSelectDay={(dayIdx) =>
                  setSelectedDayIndex((cur) => (cur === dayIdx ? null : dayIdx))
                }
                onPrevWeek={() => {
                  const curStart = board.week_days[0]?.day_index ?? board.today_day_index;
                  setWeekStartDay(curStart - 7);
                }}
                onNextWeek={() => {
                  const curStart = board.week_days[0]?.day_index ?? board.today_day_index;
                  setWeekStartDay(curStart + 7);
                }}
                onThisWeek={() => {
                  setWeekStartDay(null);
                  setSelectedDayIndex(null);
                }}
              />

              {selectedDayDto && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3 py-1 text-xs font-medium text-foreground">
                    <span>
                      {t("habits.filteredDay", {
                        date: formatDate(parseIsoDateLocal(selectedDayDto.date), {
                          month: "short",
                          day: "numeric",
                        }),
                      })}
                    </span>
                    <button
                      type="button"
                      aria-label={t("habits.clearDayFilter")}
                      onClick={() => setSelectedDayIndex(null)}
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>

                  {isFutureDay && (
                    <p data-testid="habit-future-notice" className="text-xs text-muted-foreground">
                      {t("habits.futureDayNotice")}
                    </p>
                  )}
                </div>
              )}

              {visibleHabits.length === 0 ? (
                style === "default" ? (
                  <EmptyState
                    icon={CheckCircle2}
                    title={selectedDayIndex !== null ? t("habits.emptyForDay") : t("habits.empty")}
                    action={
                      selectedDayIndex === null ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            setEditingHabit(null);
                            setDialogOpen(true);
                          }}
                        >
                          <Plus /> {t("habits.newHabit")}
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-4 px-6 py-8 text-center">
                    <EmptyStatePicture scene="habits" style={style} />
                    <div className="space-y-1.5">
                      <h2 className="text-base font-semibold text-foreground">
                        {selectedDayIndex !== null ? t("habits.emptyForDay") : t("habits.empty")}
                      </h2>
                    </div>
                    {selectedDayIndex === null ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditingHabit(null);
                          setDialogOpen(true);
                        }}
                      >
                        <Plus /> {t("habits.newHabit")}
                      </Button>
                    ) : null}
                  </div>
                )
              ) : (
                <div className="space-y-5">
                  {HABIT_SECTIONS.map((sec) => {
                    const secHabits = visibleHabits.filter((h) => h.section === sec);
                    if (secHabits.length === 0) return null;
                    return (
                      <section
                        key={sec}
                        aria-label={t(`habits.section.${sec}`)}
                        className="space-y-2"
                      >
                        <h2 className="scholar-heading-rule text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {t(`habits.section.${sec}`)}
                        </h2>
                        <div className="space-y-2">
                          {secHabits.map((habit) => (
                            <HabitRow
                              key={habit.id}
                              habit={habit}
                              log={logsByHabit.get(habit.id)}
                              activeDayIndex={activeDayIndex}
                              isFutureDay={isFutureDay}
                              isTodayOrYesterday={isTodayOrYesterday}
                              freezeTokensHeld={freezeTokensHeld}
                              isSelected={detailHabit?.id === habit.id}
                              style={style}
                              onFocusRow={setFocusedHabitId}
                              onOpenDetail={(h) =>
                                setDrawerMode((cur) =>
                                  cur?.kind === "detail" && cur.habitId === h.id
                                    ? null
                                    : { kind: "detail", habitId: h.id },
                                )
                              }
                              onToggleYesNo={(h, c, l) =>
                                void handleToggleYesNo(h, activeDayIndex, c, l)
                              }
                              onSaveAmount={(h, v, l) => void handleSaveAmount(h, v, l)}
                              onToggleSkip={(h, l) => void handleToggleSkip(h, activeDayIndex, l)}
                              onToggleFreeze={(h, l) =>
                                void handleToggleFreeze(h, activeDayIndex, l)
                              }
                              onEdit={(h) => {
                                setEditingHabit(h);
                                setDialogOpen(true);
                              }}
                              onOpenLog={(h, l) =>
                                setLogDialogTarget({
                                  habit: h,
                                  dayIndex: activeDayIndex,
                                  existingLog: l,
                                })
                              }
                              onArchive={handleArchive}
                              onDelete={(h) => deleteMut.mutate(h.id)}
                            />
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>

        <HabitDetailPanel
          habit={detailHabit}
          weekStart={weekStart}
          style={style}
          freezeTokensHeld={freezeTokensHeld}
          freezeTokenCap={freezeTokenCap}
          onToggleYesNo={(h, dayIdx, c, l) => void handleToggleYesNo(h, dayIdx, c, l)}
          onToggleSkip={(h, dayIdx, l) => void handleToggleSkip(h, dayIdx, l)}
          onToggleFreeze={(h, dayIdx, l) => void handleToggleFreeze(h, dayIdx, l)}
          onOpenLog={(h, dayIdx, l) =>
            setLogDialogTarget({ habit: h, dayIndex: dayIdx, existingLog: l })
          }
          onClose={() => setDrawerMode(null)}
        />

        <ArchivedHabitsDrawer
          open={drawerMode?.kind === "archived"}
          style={style}
          isMutating={archiveMut.isPending || deleteMut.isPending}
          onRestore={(h) => archiveMut.mutate({ id: h.id, archived: false })}
          onDelete={(h) => deleteMut.mutate(h.id)}
          onClose={() => setDrawerMode(null)}
        />
      </div>

      {dialogOpen && board && (
        <CreateHabitDialog
          key={editingHabit?.id ?? "new"}
          open={true}
          habit={editingHabit}
          defaultStartDate={board.today_date}
          decks={decks}
          nextSortOrder={board.habits.length}
          onSubmit={async (input) => {
            if (editingHabit) {
              await updateHabitMut.mutateAsync({ id: editingHabit.id, input });
            } else {
              await createHabitMut.mutateAsync(input);
            }
          }}
          onClose={() => {
            setDialogOpen(false);
            setEditingHabit(null);
          }}
        />
      )}

      {logDialogTarget && (
        <HabitLogDialog
          key={`${logDialogTarget.habit.id}:${logDialogTarget.dayIndex}`}
          open={true}
          habit={logDialogTarget.habit}
          dayIndex={logDialogTarget.dayIndex}
          existingLog={logDialogTarget.existingLog}
          onSave={async (input) => {
            await logMut.mutateAsync(input);
          }}
          onClose={() => setLogDialogTarget(null)}
        />
      )}
    </div>
  );
}
