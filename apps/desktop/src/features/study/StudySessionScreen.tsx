import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Flag,
  Maximize2,
  Minimize2,
  Minus,
  MinusCircle,
  Plus,
  SkipForward,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import {
  IN_A_ROW_DURATION_MS,
  IN_A_ROW_THRESHOLDS,
  useStudyFeedbackStore,
} from "@/features/study/feedback/feedbackStore";
import { SessionFinish } from "@/features/study/feedback/SessionFinish";
import { SessionProgressBar } from "@/features/study/feedback/SessionProgressBar";
import { StreakBadge } from "@/features/study/feedback/StreakBadge";
import { useMotivationState } from "@/features/motivation/useMotivation";
import { useProgressSummary } from "@/features/progress/useProgressSummary";
import { TutorPanel } from "@/features/study/TutorPanel";
import { isAiConfigured } from "@/stores/aiSession";
import { CardFace } from "@/components/CardFace";
import { DeckOptionsDialog } from "@/components/DeckOptionsDialog";
import { DeckCounts } from "@/components/decks/DeckCounts";
import { Kbd } from "@/components/Kbd";
import { ipc, isTauri, Rating, type RatingValue, type StudyCardWithFlag } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { invalidateTodayCounts } from "@/lib/queryRefresh";
import { mediaUrl, type QueueEntry } from "@/lib/renderCard";
import { dur, ease, listItem, staggerList, useReducedMotion } from "@/lib/motion";
import { useTheme } from "@/stores/theme";
import { useUi } from "@/stores/ui";
import { getCardEffectiveVolume, subscribeCardEffectiveVolume } from "@/stores/sound";
import { speak, cancelSpeech } from "@/lib/tts";
import { formatDate, formatNumber, t, useLocale } from "@/lib/i18n";
import { digitHotkey, matchesKey } from "@/lib/shortcuts";
import { playStyleCue } from "@/lib/styleAudio";
import { formatUndoAction } from "@/lib/undo";

const EMPTY_QUEUE: QueueEntry[] = [];

function isStudyStepUndoKind(kind?: string): boolean {
  return kind === "answer-card" || kind === "bury-cards" || kind === "suspend-cards";
}

const FLAG_COLORS: Record<number, string> = {
  1: "text-red-500",
  2: "text-orange-500",
  3: "text-green-500",
  4: "text-blue-500",
};

export function StudySessionScreen() {
  const { deckId } = useParams({ from: "/study/$deckId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const onExit = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
    void navigate({ to: "/" });
  };
  return <Session deckId={deckId} onExit={onExit} />;
}

function Session({ deckId, onExit }: { deckId: number; onExit: () => void }) {
  const navigate = useNavigate();
  const tauri = isTauri();
  const locale = useLocale((s) => s.locale);
  const queryClient = useQueryClient();
  const prefersReduced = useReducedMotion();
  const [revealed, setRevealed] = useState(false);
  const [flagMenuOpen, setFlagMenuOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [tutorSaveOpen, setTutorSaveOpen] = useState(false);
  const [sessionAnswered, setSessionAnswered] = useState(0);
  const [sessionUndoSteps, setSessionUndoSteps] = useState(0);
  const [sessionCompleted, setSessionCompleted] = useState(0);
  const [sessionPassed, setSessionPassed] = useState(0);
  const [sessionTimeMs, setSessionTimeMs] = useState(0);
  const [streakBadgeCount, setStreakBadgeCount] = useState<number | null>(null);
  const inARowRef = useRef(0);
  const streakHistoryRef = useRef<number[]>([]);
  const passHistoryRef = useRef<boolean[]>([]);
  const timeHistoryRef = useRef<number[]>([]);
  const completedHistoryRef = useRef<number[]>([]);
  const currentRemainingRef = useRef(0);
  const baselineTodayXpRef = useRef<number | null>(null);
  const streakTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initialStudiedTodayRef = useRef<boolean | null>(null);
  const triggerAvatarReaction = useStudyFeedbackStore((s) => s.triggerAvatarReaction);
  const flagRef = useRef<HTMLDivElement>(null);

  const progressQuery = useProgressSummary(tauri);
  const motivationQuery = useMotivationState();
  const undoStatusQuery = useQuery({
    queryKey: queryKeys.undoStatus,
    queryFn: ipc.undoStatus,
    enabled: tauri,
  });
  const backendTodayXp = progressQuery.data?.today_xp ?? motivationQuery.data?.today_xp ?? null;
  useEffect(() => {
    if (backendTodayXp !== null && baselineTodayXpRef.current === null && sessionAnswered === 0) {
      baselineTodayXpRef.current = backendTodayXp;
    }
  }, [backendTodayXp, sessionAnswered]);
  const sessionXp =
    backendTodayXp !== null && baselineTodayXpRef.current !== null
      ? Math.max(0, backendTodayXp - baselineTodayXpRef.current)
      : 0;
  useEffect(() => {
    if (motivationQuery.data && initialStudiedTodayRef.current === null && sessionAnswered === 0) {
      initialStudiedTodayRef.current = motivationQuery.data.studied_today;
    }
  }, [motivationQuery.data, sessionAnswered]);

  useEffect(() => {
    return () => clearTimeout(streakTimerRef.current);
  }, []);
  const focusMode = useUi((s) => s.focusMode);
  const toggleFocusMode = useUi((s) => s.toggleFocusMode);
  const setFocusMode = useUi((s) => s.setFocusMode);
  const studyScale = useUi((s) => s.studyScale);
  const stepStudyScale = useUi((s) => s.stepStudyScale);
  const setStudyScale = useUi((s) => s.setStudyScale);

  const aiConfig = useQuery({
    queryKey: queryKeys.aiConfig,
    queryFn: async () => (await ipc.aiGetConfig()) ?? null,
    enabled: tauri,
  }).data;
  const aiConfigured = isAiConfigured(aiConfig);

  const prefsQuery = useQuery({
    queryKey: queryKeys.collectionPrefs,
    queryFn: ipc.getCollectionPrefs,
    enabled: tauri,
  });
  const rolloverTime = formatDate(
    new Date(2000, 0, 1, prefsQuery.data?.rollover_hour ?? 4, 0, 0),
    { hour: "numeric", minute: "2-digit" },
    locale,
  );
  const deckMeta = useQuery({
    queryKey: queryKeys.decks,
    queryFn: async () => (await ipc.listDecks()) ?? [],
    enabled: tauri,
    select: (decks) => decks.find((d) => d.id === deckId) ?? null,
  }).data;
  const deckName = deckMeta?.name;
  const isFiltered = deckMeta?.is_filtered ?? false;

  const cardQuery = useQuery({
    queryKey: queryKeys.queue(String(deckId)),
    queryFn: () => ipc.getNextCard(deckId),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchInterval: (query) => (query.state.data == null ? 15000 : false),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  const answerPendingRef = useRef(false);
  const answerMut = useMutation({
    mutationFn: ({ cardId, rating }: { cardId: number; rating: RatingValue }) =>
      ipc.answerCard(cardId, rating, deckId, Date.now() - shownAtRef.current),
    onSettled: () => {
      answerPendingRef.current = false;
    },
    onMutate: () => ({ prevRemaining: currentRemainingRef.current }),
    onSuccess: (next, variables, context) => {
      const prevRemaining = context?.prevRemaining ?? 0;
      const nextRemaining = next ? next.new_count + next.learning_count + next.review_count : 0;
      const completedDelta = Math.max(0, prevRemaining - nextRemaining);
      completedHistoryRef.current.push(completedDelta);
      setSessionCompleted((n) => n + completedDelta);

      queryClient.setQueryData(queryKeys.queue(String(deckId)), next ?? null);
      setRevealed(false);
      setSessionAnswered((n) => n + 1);
      setSessionUndoSteps((n) => n + 1);
      playStyleCue("review_answer");

      const passed = variables.rating !== Rating.Again;
      passHistoryRef.current.push(passed);
      if (passed) {
        setSessionPassed((n) => n + 1);
      }
      const elapsedMs = Math.max(0, Date.now() - shownAtRef.current);
      timeHistoryRef.current.push(elapsedMs);
      setSessionTimeMs((ms) => ms + elapsedMs);
      void invalidateTodayCounts(queryClient);

      streakHistoryRef.current.push(inARowRef.current);
      if (variables.rating === Rating.Good || variables.rating === Rating.Easy) {
        const nextStreak = inARowRef.current + 1;
        inARowRef.current = nextStreak;
        if (IN_A_ROW_THRESHOLDS.has(nextStreak)) {
          clearTimeout(streakTimerRef.current);
          setStreakBadgeCount(nextStreak);
          streakTimerRef.current = setTimeout(
            () => setStreakBadgeCount(null),
            IN_A_ROW_DURATION_MS,
          );
          triggerAvatarReaction("streak");
        }
      } else if (variables.rating === Rating.Again) {
        inARowRef.current = 0;
        clearTimeout(streakTimerRef.current);
        setStreakBadgeCount(null);
      }
    },
  });

  const [actionToast, setActionToast] = useState<{ message: string; onUndo?: () => void } | null>(
    null,
  );
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showActionToast = useCallback((message: string, onUndo?: () => void) => {
    clearTimeout(toastTimerRef.current);
    setActionToast({ message, onUndo });
    toastTimerRef.current = setTimeout(() => setActionToast(null), 8000);
  }, []);

  const unsuspendMut = useMutation({
    mutationFn: (cardId: number) => ipc.unsuspendCards([cardId]),
    onSuccess: () => {
      setActionToast(null);
      setSessionUndoSteps((n) => Math.max(0, n - 1));
      void queryClient.refetchQueries({ queryKey: queryKeys.queue(String(deckId)) });
      void invalidateTodayCounts(queryClient);
    },
  });

  const suspendMut = useMutation({
    mutationFn: (cardId: number) => ipc.suspendCards([cardId]),
    onSuccess: (_data, cardId) => {
      setSessionUndoSteps((n) => n + 1);
      showActionToast(t("study.toast.suspended"), () => unsuspendMut.mutate(cardId));
      void queryClient
        .refetchQueries({ queryKey: queryKeys.queue(String(deckId)) })
        .then(() => setRevealed(false));
      void invalidateTodayCounts(queryClient);
    },
  });

  const unburyMut = useMutation({
    mutationFn: (cardId: number) => ipc.unburyCards([cardId]),
    onSuccess: () => {
      setActionToast(null);
      setSessionUndoSteps((n) => Math.max(0, n - 1));
      void queryClient.refetchQueries({ queryKey: queryKeys.queue(String(deckId)) });
      void invalidateTodayCounts(queryClient);
    },
  });

  const buryMut = useMutation({
    mutationFn: (cardId: number) => ipc.buryCards([cardId]),
    onSuccess: (_data, cardId) => {
      setSessionUndoSteps((n) => n + 1);
      showActionToast(t("study.toast.buried", { time: rolloverTime }), () =>
        unburyMut.mutate(cardId),
      );
      void queryClient
        .refetchQueries({ queryKey: queryKeys.queue(String(deckId)) })
        .then(() => setRevealed(false));
      void invalidateTodayCounts(queryClient);
    },
  });

  const undoMut = useMutation({
    mutationFn: () => ipc.undo(),
    onSuccess: (undone) => {
      if (undone) {
        showActionToast(t("study.toast.undone", { action: formatUndoAction(undone) }));
        if (isStudyStepUndoKind(undone.kind)) {
          setRevealed(false);
          setSessionUndoSteps((n) => Math.max(0, n - 1));
        }
        if (undone.kind === "answer-card") {
          setSessionAnswered((n) => Math.max(0, n - 1));
          const prevCompleted = completedHistoryRef.current.pop();
          if (prevCompleted !== undefined) {
            setSessionCompleted((n) => Math.max(0, n - prevCompleted));
          }
          const prevPassed = passHistoryRef.current.pop();
          if (prevPassed) {
            setSessionPassed((n) => Math.max(0, n - 1));
          }
          const prevTime = timeHistoryRef.current.pop();
          if (prevTime !== undefined) {
            setSessionTimeMs((ms) => Math.max(0, ms - prevTime));
          }
          const prevStreak = streakHistoryRef.current.pop();
          if (prevStreak !== undefined) {
            inARowRef.current = prevStreak;
          }
          clearTimeout(streakTimerRef.current);
          setStreakBadgeCount(null);
        }
        void queryClient.removeQueries({ queryKey: queryKeys.queueAll });
        void invalidateTodayCounts(queryClient);
        void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
      }
    },
  });

  const flagMut = useMutation({
    mutationFn: ({ cardId, flag }: { cardId: number; flag: number }) =>
      ipc.setCardFlag([cardId], flag),
    onSuccess: (_data, variables) => {
      queryClient.setQueryData<StudyCardWithFlag | null>(queryKeys.queue(String(deckId)), (prev) =>
        prev && prev.card_id === variables.cardId ? { ...prev, flag: variables.flag } : prev,
      );
      setFlagMenuOpen(false);
    },
  });

  const waitingForFirstFetch = !cardQuery.isFetchedAfterMount;
  const card = waitingForFirstFetch ? null : (cardQuery.data ?? null);
  const finishDeckCardIdsQuery = useQuery({
    queryKey: queryKeys.deckCardIds(deckId, true),
    queryFn: async () => (await ipc.deckCardIds(deckId, true)) ?? null,
    enabled: tauri && !waitingForFirstFetch && card === null && sessionAnswered === 0,
  });
  const deckEmpty =
    sessionAnswered === 0 &&
    Array.isArray(finishDeckCardIdsQuery.data) &&
    finishDeckCardIdsQuery.data.length === 0;
  const cardFlag = card?.flag ?? 0;
  currentRemainingRef.current = card ? card.new_count + card.learning_count + card.review_count : 0;
  const actionBusy =
    suspendMut.isPending || buryMut.isPending || unburyMut.isPending || flagMut.isPending;

  const night = useTheme((s) => s.resolved === "dark");
  const [frontPrepared, setFrontPrepared] = useState<{
    cardId: number;
    items: QueueEntry[];
  } | null>(null);
  const [backPrepared, setBackPrepared] = useState<{ cardId: number; items: QueueEntry[] } | null>(
    null,
  );
  const [typedAnswer, setTypedAnswer] = useState("");
  const activeSidePrepared = revealed ? backPrepared : frontPrepared;
  const sideReady = Boolean(
    card && activeSidePrepared && activeSidePrepared.cardId === card.card_id,
  );
  const currentQueue = sideReady && activeSidePrepared ? activeSidePrepared.items : EMPTY_QUEUE;
  const activeSideKey = card && sideReady ? `${card.card_id}:${revealed ? "back" : "front"}` : "";

  // Sound + TTS sequencer — plays [sound:...] files and {{tts:}} utterances
  // keyed synchronously by `(card_id, side)` so stale queues never replay on the next card.
  const [playState, setPlayState] = useState<{ key: string; idx: number; seq: number }>({
    key: "",
    idx: -1,
    seq: 0,
  });
  const cardKey = card?.card_id ?? -1;
  const shownAtRef = useRef(Date.now());

  useEffect(() => {
    setTypedAnswer("");
    setTutorOpen(false);
    setTutorSaveOpen(false);
    shownAtRef.current = Date.now();
  }, [cardKey]);

  useEffect(() => {
    if (!revealed) {
      setTutorOpen(false);
      setTutorSaveOpen(false);
    }
  }, [revealed]);

  useEffect(() => {
    if (!activeSideKey || currentQueue.length === 0) {
      setPlayState((s) =>
        s.key === activeSideKey && s.idx === -1
          ? s
          : { key: activeSideKey, idx: -1, seq: s.seq + 1 },
      );
      return;
    }
    setPlayState((s) => ({ key: activeSideKey, idx: 0, seq: s.seq + 1 }));
  }, [activeSideKey, currentQueue]);

  const replayAudio = useCallback(() => {
    if (!activeSideKey || currentQueue.length === 0) return;
    setPlayState((s) => ({ key: activeSideKey, idx: 0, seq: s.seq + 1 }));
  }, [activeSideKey, currentQueue.length]);

  useEffect(() => {
    if (!activeSideKey || playState.key !== activeSideKey) return;
    if (playState.idx < 0 || playState.idx >= currentQueue.length) return;
    const entry = currentQueue[playState.idx];
    let disposed = false;
    const advance = () => {
      if (disposed) return;
      setPlayState((s) => (s.key === activeSideKey ? { ...s, idx: s.idx + 1 } : s));
    };

    if (entry.kind === "file") {
      if (!tauri) {
        advance();
        return;
      }
      const audio = new Audio(mediaUrl(entry.name));
      audio.volume = getCardEffectiveVolume();
      audio.onended = advance;
      audio.onerror = advance;
      try {
        void Promise.resolve(audio.play()).catch(advance);
      } catch {
        advance();
      }
      const unsub = subscribeCardEffectiveVolume((vol) => {
        audio.volume = vol;
      });
      return () => {
        disposed = true;
        unsub();
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.src = "";
      };
    }

    void speak(entry.text, { lang: entry.lang, voices: entry.voices, rate: entry.rate }).then(
      () => {
        if (!disposed) advance();
      },
    );
    return () => {
      disposed = true;
      cancelSpeech();
    };
  }, [tauri, activeSideKey, playState, currentQueue]);

  // Close flag menu on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (flagRef.current && !flagRef.current.contains(e.target as Node)) {
        setFlagMenuOpen(false);
      }
    };
    if (flagMenuOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [flagMenuOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;

      // Esc closes an open Tutor panel first, or exits focus mode.
      if (e.key === "Escape") {
        if (tutorOpen && !tutorSaveOpen) {
          e.preventDefault();
          setTutorOpen(false);
          return;
        }
        if (focusMode) {
          e.preventDefault();
          setFocusMode(false);
        }
        return;
      }
      if (typing) return;

      const isUndo = matchesKey(e, "KeyZ", "z") && !e.altKey && !e.shiftKey;
      if (isUndo) {
        e.preventDefault();
        if (!undoMut.isPending) {
          undoMut.mutate();
        }
        return;
      }

      if (matchesKey(e, "KeyF", "f") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toggleFocusMode();
        return;
      }
      if (!card || answerMut.isPending || actionBusy || tutorSaveOpen) return;

      if (matchesKey(e, "KeyT", "t") && !e.metaKey && !e.ctrlKey && !e.altKey && revealed) {
        e.preventDefault();
        setTutorOpen((open) => !open);
        return;
      }

      if (tutorOpen) return;

      if (matchesKey(e, "KeyR", "r") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        replayAudio();
        return;
      }
      if (
        !revealed &&
        (matchesKey(e, "Space", " ") ||
          matchesKey(e, "Enter", "Enter") ||
          matchesKey(e, "NumpadEnter"))
      ) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      const ratingDigit = revealed ? digitHotkey(e) : null;
      if (ratingDigit) {
        e.preventDefault();
        const btn = getAnswerButtons(card).find((b) => b.hotkey === ratingDigit);
        if (btn) answerMut.mutate({ cardId: card.card_id, rating: btn.rating });
        return;
      }
      if (matchesKey(e, "KeyS", "s") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        suspendMut.mutate(card.card_id);
      }
      if (matchesKey(e, "KeyB", "b") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        buryMut.mutate(card.card_id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    card,
    revealed,
    answerMut,
    actionBusy,
    suspendMut,
    buryMut,
    undoMut,
    replayAudio,
    focusMode,
    setFocusMode,
    toggleFocusMode,
    tutorOpen,
    tutorSaveOpen,
  ]);

  const flipDuration = prefersReduced ? 0 : dur.slow;
  const fadeDuration = prefersReduced ? 0 : dur.base;

  const sessionTotal = card
    ? sessionCompleted + card.new_count + card.learning_count + card.review_count
    : sessionCompleted;
  const scaleLabel = t("study.textSize", { pct: formatNumber(Math.round(studyScale * 100)) });

  const zoomControls = card && (
    <div
      className="inline-flex items-center rounded-md border border-border bg-secondary/40"
      title={scaleLabel}
    >
      <button
        type="button"
        onClick={() => stepStudyScale(-0.1)}
        disabled={studyScale <= 0.8}
        aria-label={t("study.zoomOut")}
        className="flex h-7 w-6 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
      >
        <Minus className="size-3" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => setStudyScale(1)}
        disabled={studyScale === 1}
        aria-label={t("study.zoomReset")}
        className="px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground transition-colors hover:text-foreground disabled:hover:text-muted-foreground"
      >
        {formatNumber(Math.round(studyScale * 100))}%
      </button>
      <button
        type="button"
        onClick={() => stepStudyScale(0.1)}
        disabled={studyScale >= 1.5}
        aria-label={t("study.zoomIn")}
        className="flex h-7 w-6 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
      >
        <Plus className="size-3" aria-hidden="true" />
      </button>
    </div>
  );

  const actionToastNode = actionToast ? (
    <motion.div
      key="action-toast"
      data-testid="study-action-toast"
      role="status"
      aria-live="polite"
      initial={prefersReduced ? { opacity: 1 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
      transition={{ duration: dur.fast, ease }}
      className="glass-panel pointer-events-auto flex max-w-full items-center gap-2.5 rounded-lg border px-3 py-1.5 text-xs shadow-md sm:text-sm"
    >
      <span className="truncate">{actionToast.message}</span>
      {actionToast.onUndo && (
        <button
          type="button"
          className="shrink-0 rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={actionToast.onUndo}
        >
          {t("decks.undo")}
        </button>
      )}
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={() => {
          clearTimeout(toastTimerRef.current);
          setActionToast(null);
        }}
        className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </motion.div>
  ) : null;

  return (
    <div className="relative flex h-full flex-col">
      {focusMode ? (
        <div
          data-toast-anchor
          className="glass-panel relative z-20 flex h-9 shrink-0 items-center justify-between gap-3 border-b px-4"
        >
          <span className="truncate text-[13px] text-muted-foreground">{deckName}</span>
          <div className="flex items-center gap-3">
            {card && (
              <DeckCounts
                newCount={card.new_count}
                learningCount={card.learning_count}
                reviewCount={card.review_count}
              />
            )}
            {zoomControls}
            <button
              type="button"
              onClick={() => setFocusMode(false)}
              title={t("study.exitFocus")}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Minimize2 className="size-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <ScreenHeader
          title={deckName ?? t("study.studying")}
          actions={
            <div className="flex items-center gap-3">
              {card && (
                <DeckCounts
                  newCount={card.new_count}
                  learningCount={card.learning_count}
                  reviewCount={card.review_count}
                />
              )}
              {zoomControls}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFocusMode(true)}
                title={t("study.focusMode")}
              >
                <Maximize2 className="size-3.5" />
              </Button>
              <Button variant="ghost" size="sm" onClick={onExit}>
                {t("study.backToDecks")}
              </Button>
            </div>
          }
        />
      )}

      {card && (
        <div
          data-testid="study-progress-strip"
          data-toast-anchor
          className="relative z-20 flex min-h-[30px] shrink-0 items-center gap-2 border-b border-border/60 bg-background/80 px-4 py-1 sm:px-6"
        >
          <SessionProgressBar
            done={sessionCompleted}
            total={sessionTotal}
            className="min-w-0 flex-1 border-b-0 bg-transparent px-0 py-0 sm:px-0"
          />
          {cardFlag > 0 && (
            <span
              data-testid="study-card-flag"
              className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium ${FLAG_COLORS[cardFlag] ?? ""}`}
            >
              <Flag className="size-3 fill-current" aria-hidden="true" />
              {t("study.flagNumber", { n: cardFlag })}
            </span>
          )}
          <StreakBadge count={streakBadgeCount} />
        </div>
      )}

      {focusMode && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 45%, hsl(var(--background)) 100%)",
          }}
        />
      )}

      {waitingForFirstFetch ? (
        <div className="flex-1" aria-busy="true" />
      ) : card ? (
        <motion.div
          key={card.card_id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: fadeDuration, ease }}
          className={`relative z-10 mx-auto flex w-full min-h-0 flex-1 flex-col px-3 py-4 sm:px-6 sm:py-8 ${focusMode ? "max-w-3xl" : "max-w-2xl"}`}
        >
          {/* Card — 3D flip (or plain div for reduced-motion) */}
          {prefersReduced ? (
            <CardFace
              key={card.card_id}
              html={revealed ? card.answer : card.question}
              css={card.css}
              tauri={tauri}
              night={night}
              scale={studyScale}
              className="keepsake-card min-h-0 flex-1 rounded-xl border border-border bg-card p-4 sm:p-8 overflow-auto"
              onQueue={(items) =>
                revealed
                  ? setBackPrepared({ cardId: card.card_id, items })
                  : setFrontPrepared({ cardId: card.card_id, items })
              }
              onTypedInput={!revealed ? setTypedAnswer : undefined}
              typedAnswer={revealed ? typedAnswer : undefined}
            />
          ) : (
            <div className="keepsake-flip relative min-h-0 flex-1">
              <motion.div
                className="absolute inset-0"
                style={{ transformStyle: "preserve-3d" }}
                animate={{ rotateY: revealed ? 180 : 0 }}
                transition={{ duration: flipDuration, ease }}
              >
                {/* Front — question */}
                <CardFace
                  html={card.question}
                  css={card.css}
                  tauri={tauri}
                  night={night}
                  scale={studyScale}
                  className="keepsake-card absolute inset-0 rounded-xl border border-border bg-card p-4 sm:p-8 overflow-auto"
                  style={{ backfaceVisibility: "hidden" }}
                  onQueue={(items) => setFrontPrepared({ cardId: card.card_id, items })}
                  onTypedInput={setTypedAnswer}
                />
                {/* Back — answer (pre-rotated so it faces forward when parent is at 180°) */}
                <CardFace
                  html={card.answer}
                  css={card.css}
                  tauri={tauri}
                  night={night}
                  scale={studyScale}
                  className="keepsake-card absolute inset-0 rounded-xl border border-border bg-card p-4 sm:p-8 overflow-auto"
                  style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                  onQueue={(items) => setBackPrepared({ cardId: card.card_id, items })}
                  typedAnswer={typedAnswer}
                />
              </motion.div>
            </div>
          )}

          <div className="mt-6">
            {/* Answer buttons with stagger, or Show Answer button */}
            <AnimatePresence mode="wait" initial={false}>
              {revealed ? (
                <motion.div
                  key="answers"
                  className={`grid gap-2 ${getAnswerButtons(card).length === 3 ? "grid-cols-3" : "grid-cols-4"}`}
                  variants={staggerList}
                  initial="hidden"
                  animate="show"
                >
                  {getAnswerButtons(card).map((btn) => (
                    <motion.div key={btn.label} variants={listItem}>
                      <AnswerButton
                        label={btn.label}
                        hint={btn.hint}
                        hotkey={btn.hotkey}
                        variant={btn.variant}
                        disabled={answerMut.isPending || actionBusy}
                        onClick={() => {
                          if (answerPendingRef.current || answerMut.isPending) return;
                          answerPendingRef.current = true;
                          answerMut.mutate({ cardId: card.card_id, rating: btn.rating });
                        }}
                      />
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  key="reveal"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: fadeDuration }}
                >
                  <Button className="w-full" onClick={() => setRevealed(true)}>
                    {t("study.showAnswer")}
                    <Kbd className="ms-2 border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground/80">
                      Space
                    </Kbd>
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Card actions: previous / tutor / audio / suspend / bury / flag */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-1">
              <Button
                data-testid="study-prev-card"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                disabled={
                  undoMut.isPending ||
                  answerMut.isPending ||
                  !(sessionUndoSteps > 0 || isStudyStepUndoKind(undoStatusQuery.data?.kind))
                }
                onClick={() => undoMut.mutate()}
                title={
                  undoStatusQuery.data
                    ? t("decks.undoAction", { action: formatUndoAction(undoStatusQuery.data) })
                    : t("study.previousCardHint")
                }
              >
                <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
                {t("study.previousCard")}
              </Button>
              <div className="flex flex-wrap items-center justify-end gap-1">
                {revealed && (
                  <Button
                    variant={tutorOpen ? "secondary" : "ghost"}
                    size="sm"
                    aria-expanded={tutorOpen}
                    aria-pressed={tutorOpen}
                    title={t("ai.tutor.shortcutHint")}
                    className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                    onClick={() => setTutorOpen((open) => !open)}
                  >
                    <Sparkles className="size-3.5 text-primary" aria-hidden />
                    {t("ai.tutor.button")}
                    <Kbd className="ms-0.5">T</Kbd>
                  </Button>
                )}
                {currentQueue.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                    onClick={replayAudio}
                    title={t("study.replayHint")}
                  >
                    <Volume2 className="size-3.5" />
                    {t("study.replay")}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                  disabled={actionBusy}
                  onClick={() => suspendMut.mutate(card.card_id)}
                  title={t("study.suspendHint")}
                >
                  <MinusCircle className="size-3.5" />
                  {t("study.suspend")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                  disabled={actionBusy}
                  onClick={() => buryMut.mutate(card.card_id)}
                  title={t("study.hideTomorrowHint", { time: rolloverTime })}
                >
                  <SkipForward className="size-3.5" />
                  {t("study.hideTomorrow")}
                </Button>
                <div className="relative" ref={flagRef}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                    disabled={actionBusy}
                    onClick={() => setFlagMenuOpen((o) => !o)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      flagMut.mutate({ cardId: card.card_id, flag: 0 });
                    }}
                    title={t("study.flagHint")}
                  >
                    <Flag
                      className={`size-3.5 ${cardFlag > 0 ? `${FLAG_COLORS[cardFlag] ?? ""} fill-current` : "text-muted-foreground"}`}
                    />
                    <span
                      className={
                        cardFlag > 0
                          ? (FLAG_COLORS[cardFlag] ?? "text-foreground")
                          : "text-muted-foreground"
                      }
                    >
                      {cardFlag > 0 ? t("study.flagNumber", { n: cardFlag }) : t("study.flag")}
                    </span>
                  </Button>
                  <AnimatePresence>
                    {flagMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 4 }}
                        transition={{ duration: dur.fast, ease }}
                        role="menu"
                        aria-label={t("study.setFlag")}
                        className="glass-panel absolute bottom-full end-0 mb-1 flex overflow-hidden rounded-lg border shadow-md"
                      >
                        {[1, 2, 3, 4].map((f) => (
                          <button
                            key={f}
                            role="menuitem"
                            aria-label={t("study.flagNumber", { n: f })}
                            aria-checked={cardFlag === f}
                            className={`p-2 hover:bg-accent ${FLAG_COLORS[f]} ${cardFlag === f ? "bg-accent" : ""}`}
                            onClick={() =>
                              flagMut.mutate({
                                cardId: card.card_id,
                                flag: cardFlag === f ? 0 : f,
                              })
                            }
                          >
                            <Flag className={`size-4 ${cardFlag === f ? "fill-current" : ""}`} />
                          </button>
                        ))}
                        {cardFlag > 0 && (
                          <button
                            role="menuitem"
                            aria-label={t("study.clearFlag")}
                            className="px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                            onClick={() => flagMut.mutate({ cardId: card.card_id, flag: 0 })}
                          >
                            {t("study.clearFlag")}
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {revealed && tutorOpen && (
              <TutorPanel
                card={card}
                sessionDeckId={deckId}
                deckName={deckName ?? null}
                typedAnswer={typedAnswer}
                configured={aiConfigured}
                tauri={tauri}
                night={night}
                onClose={() => setTutorOpen(false)}
                onSaveDialogChange={setTutorSaveOpen}
              />
            )}

            <div className="mt-3 flex min-h-9 items-center justify-center">
              {actionToastNode ? (
                <AnimatePresence>{actionToastNode}</AnimatePresence>
              ) : (
                !focusMode && (
                  <div
                    data-testid="study-shortcut-legend"
                    className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-muted-foreground/70"
                  >
                    {revealed ? (
                      <>
                        <Kbd>
                          {t("study.hint.rateRange", {
                            max: formatNumber(getAnswerButtons(card).length),
                          })}
                        </Kbd>{" "}
                        {t("study.hint.rate")}
                        <span className="mx-1">·</span>
                        <Kbd>T</Kbd> {t("ai.tutor.button")}
                      </>
                    ) : (
                      <>
                        <Kbd>Space</Kbd> {t("study.hint.reveal")}
                      </>
                    )}
                    <span className="mx-1">·</span>
                    <Kbd>Z</Kbd> {t("study.hint.undoAnswer")}
                    <span className="mx-1">·</span>
                    <Kbd>F</Kbd> {t("study.hint.focus")}
                  </div>
                )
              )}
            </div>
          </div>
        </motion.div>
      ) : (
        <SessionFinish
          sessionCards={sessionAnswered}
          sessionXp={sessionXp}
          sessionAccuracyPct={
            sessionAnswered > 0 ? Math.round((sessionPassed / sessionAnswered) * 100) : null
          }
          sessionDurationMs={sessionTimeMs}
          streakExtended={
            initialStudiedTodayRef.current === false &&
            Boolean(motivationQuery.data?.studied_today) &&
            sessionAnswered > 0
          }
          deckId={deckId}
          deckEmpty={deckEmpty}
          isFiltered={isFiltered}
          canUndo={!deckEmpty && (sessionUndoSteps > 0 || undoStatusQuery.data !== null)}
          onAddNote={() => void navigate({ to: "/add", search: { deckId } })}
          onExit={onExit}
          onUndo={() => undoMut.mutate()}
          undoPending={undoMut.isPending}
          onExtended={() =>
            void queryClient.refetchQueries({ queryKey: queryKeys.queue(String(deckId)) })
          }
          onOpenOptions={() => setOptionsOpen(true)}
        />
      )}

      <AnimatePresence>
        {optionsOpen && deckName && (
          <DeckOptionsDialog
            deckId={deckId}
            deckName={deckName}
            onClose={() => setOptionsOpen(false)}
            onSaved={() => {
              void invalidateTodayCounts(queryClient);
              void queryClient.invalidateQueries({ queryKey: queryKeys.queue(String(deckId)) });
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!card && actionToastNode && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
            {actionToastNode}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

type AnswerBtnDef = {
  label: string;
  hint: string;
  hotkey: string;
  variant: "again" | "hard" | "good" | "easy";
  rating: RatingValue;
};

function getAnswerButtons(card: {
  again: string;
  hard: string;
  good: string;
  easy: string;
  algorithm: string;
  card_phase: string;
}): AnswerBtnDef[] {
  const isFsrsReview =
    card.algorithm === "fsrs" && (card.card_phase === "review" || card.card_phase === "relearning");

  if (isFsrsReview) {
    return [
      {
        label: t("rating.forgot"),
        hint: card.again,
        hotkey: "1",
        variant: "again",
        rating: Rating.Again,
      },
      {
        label: t("rating.remembered"),
        hint: card.good,
        hotkey: "2",
        variant: "good",
        rating: Rating.Good,
      },
      {
        label: t("rating.easy"),
        hint: card.easy,
        hotkey: "3",
        variant: "easy",
        rating: Rating.Easy,
      },
    ];
  }

  const isFsrs = card.algorithm === "fsrs";
  return [
    {
      label: isFsrs ? t("rating.forgot") : t("rating.again"),
      hint: card.again,
      hotkey: "1",
      variant: "again",
      rating: Rating.Again,
    },
    { label: t("rating.hard"), hint: card.hard, hotkey: "2", variant: "hard", rating: Rating.Hard },
    {
      label: isFsrs ? t("rating.remembered") : t("rating.good"),
      hint: card.good,
      hotkey: "3",
      variant: "good",
      rating: Rating.Good,
    },
    { label: t("rating.easy"), hint: card.easy, hotkey: "4", variant: "easy", rating: Rating.Easy },
  ];
}

function AnswerButton(props: {
  label: string;
  hint: string;
  hotkey: string;
  variant: "again" | "hard" | "good" | "easy";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.div whileTap={{ scale: props.disabled ? 1 : 0.97 }} className="w-full">
      <Button
        variant={props.variant}
        disabled={props.disabled}
        className="h-auto w-full flex-col gap-0.5 py-2"
        onClick={props.onClick}
      >
        <span className="text-xs opacity-70">{props.hint}</span>
        <span>
          {props.label} <span className="opacity-60">{props.hotkey}</span>
        </span>
      </Button>
    </motion.div>
  );
}
