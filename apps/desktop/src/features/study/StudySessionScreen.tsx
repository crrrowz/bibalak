import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  Flag,
  Maximize2,
  Minimize2,
  Minus,
  MinusCircle,
  Plus,
  SkipForward,
  Sparkles,
  Volume2,
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
import { TutorPanel } from "@/features/study/TutorPanel";
import { isAiConfigured } from "@/stores/aiSession";
import { CardFace } from "@/components/CardFace";
import { DeckOptionsDialog } from "@/components/DeckOptionsDialog";
import { DeckCounts } from "@/components/decks/DeckCounts";
import { Kbd } from "@/components/Kbd";
import { ipc, isTauri, Rating, type RatingValue } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { invalidateTodayCounts } from "@/lib/queryRefresh";
import { mediaUrl, type QueueEntry } from "@/lib/renderCard";
import { dur, ease, listItem, staggerList, useReducedMotion } from "@/lib/motion";
import { useTheme } from "@/stores/theme";
import { useUi } from "@/stores/ui";
import { getCardEffectiveVolume, subscribeCardEffectiveVolume } from "@/stores/sound";
import { speak, cancelSpeech } from "@/lib/tts";
import { formatNumber, t } from "@/lib/i18n";
import { playStyleCue } from "@/lib/styleAudio";
import { formatUndoAction } from "@/lib/undo";

const FLAG_COLORS: Record<number, string> = {
  1: "text-red-500",
  2: "text-orange-500",
  3: "text-green-500",
  4: "text-blue-500",
};

function reviewXpForRating(rating: RatingValue): number {
  if (rating === Rating.Again) return 1;
  if (rating === Rating.Hard) return 2;
  return 3;
}

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
  const tauri = isTauri();
  const queryClient = useQueryClient();
  const prefersReduced = useReducedMotion();
  const [revealed, setRevealed] = useState(false);
  const [flagMenuOpen, setFlagMenuOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [tutorSaveOpen, setTutorSaveOpen] = useState(false);
  const [sessionAnswered, setSessionAnswered] = useState(0);
  const [sessionXp, setSessionXp] = useState(0);
  const [sessionPassed, setSessionPassed] = useState(0);
  const [sessionTimeMs, setSessionTimeMs] = useState(0);
  const [streakBadgeCount, setStreakBadgeCount] = useState<number | null>(null);
  const inARowRef = useRef(0);
  const streakHistoryRef = useRef<number[]>([]);
  const passHistoryRef = useRef<boolean[]>([]);
  const timeHistoryRef = useRef<number[]>([]);
  const rewardedCardIdsRef = useRef<Set<number>>(new Set());
  const xpHistoryRef = useRef<Array<{ cardId: number; xp: number }>>([]);
  const streakTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initialStudiedTodayRef = useRef<boolean | null>(null);
  const triggerAvatarReaction = useStudyFeedbackStore((s) => s.triggerAvatarReaction);
  const flagRef = useRef<HTMLDivElement>(null);

  const motivationQuery = useMotivationState();
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

  const deckName = useQuery({
    queryKey: queryKeys.decks,
    queryFn: ipc.listDecks,
    enabled: tauri,
    select: (decks) => decks.find((d) => d.id === deckId)?.name,
  }).data;

  const cardQuery = useQuery({
    queryKey: queryKeys.queue(String(deckId)),
    queryFn: () => ipc.getNextCard(deckId),
    refetchInterval: (query) => (query.state.data == null ? 15000 : false),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  const answerMut = useMutation({
    mutationFn: ({ cardId, rating }: { cardId: number; rating: RatingValue }) =>
      ipc.answerCard(cardId, rating, deckId, Date.now() - shownAtRef.current),
    onSuccess: (next, variables) => {
      queryClient.setQueryData(queryKeys.queue(String(deckId)), next ?? null);
      setRevealed(false);
      setSessionAnswered((n) => n + 1);
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

      if (!rewardedCardIdsRef.current.has(variables.cardId)) {
        rewardedCardIdsRef.current.add(variables.cardId);
        const gained = reviewXpForRating(variables.rating);
        xpHistoryRef.current.push({ cardId: variables.cardId, xp: gained });
        setSessionXp((xp) => xp + gained);
      } else {
        xpHistoryRef.current.push({ cardId: variables.cardId, xp: 0 });
      }

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
    toastTimerRef.current = setTimeout(() => setActionToast(null), 3000);
  }, []);

  const unsuspendMut = useMutation({
    mutationFn: (cardId: number) => ipc.unsuspendCards([cardId]),
    onSuccess: () => {
      setActionToast(null);
      void queryClient.refetchQueries({ queryKey: queryKeys.queue(String(deckId)) });
    },
  });

  const suspendMut = useMutation({
    mutationFn: (cardId: number) => ipc.suspendCards([cardId]),
    onSuccess: (_data, cardId) => {
      showActionToast(t("study.toast.suspended"), () => unsuspendMut.mutate(cardId));
      void queryClient
        .refetchQueries({ queryKey: queryKeys.queue(String(deckId)) })
        .then(() => setRevealed(false));
    },
  });

  const buryMut = useMutation({
    mutationFn: (cardId: number) => ipc.buryCards([cardId]),
    onSuccess: () => {
      // No per-card unbury IPC command exists yet (only whole-deck unbury) —
      // confirm the action without offering undo until one is added.
      showActionToast(t("study.toast.buried"));
      void queryClient
        .refetchQueries({ queryKey: queryKeys.queue(String(deckId)) })
        .then(() => setRevealed(false));
    },
  });

  const undoMut = useMutation({
    mutationFn: () => ipc.undo(),
    onSuccess: (undone) => {
      if (undone) {
        showActionToast(t("study.toast.undone", { action: formatUndoAction(undone) }));
        if (undone.kind === "answer-card") {
          setRevealed(false);
          setSessionAnswered((n) => Math.max(0, n - 1));
          const prevXp = xpHistoryRef.current.pop();
          if (prevXp && prevXp.xp > 0) {
            rewardedCardIdsRef.current.delete(prevXp.cardId);
            setSessionXp((xp) => Math.max(0, xp - prevXp.xp));
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
        void queryClient.invalidateQueries({ queryKey: queryKeys.queue(String(deckId)) });
        void invalidateTodayCounts(queryClient);
        void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
      }
    },
  });

  const flagMut = useMutation({
    mutationFn: ({ cardId, flag }: { cardId: number; flag: number }) =>
      ipc.setCardFlag([cardId], flag),
    onSuccess: () => setFlagMenuOpen(false),
  });

  const card = cardQuery.data ?? null;
  const actionBusy = suspendMut.isPending || buryMut.isPending || flagMut.isPending;

  const night = useTheme((s) => s.resolved === "dark");
  const [frontQueue, setFrontQueue] = useState<QueueEntry[]>([]);
  const [backQueue, setBackQueue] = useState<QueueEntry[]>([]);
  const [typedAnswer, setTypedAnswer] = useState("");
  const currentQueue = revealed ? backQueue : frontQueue;

  // Sound + TTS sequencer — plays [sound:...] files and {{tts:}} utterances
  // in the document order the render engine's unified queue reports.
  const [queueIdx, setQueueIdx] = useState(-1);
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
    setQueueIdx(currentQueue.length > 0 ? 0 : -1);
  }, [cardKey, revealed]); // eslint-disable-line react-hooks/exhaustive-deps

  const replayAudio = useCallback(() => {
    if (currentQueue.length > 0) setQueueIdx(0);
  }, [currentQueue.length]);

  useEffect(() => {
    if (queueIdx < 0 || queueIdx >= currentQueue.length) return;
    const entry = currentQueue[queueIdx];
    const advance = () => setQueueIdx((i) => i + 1);

    if (entry.kind === "file") {
      if (!tauri) {
        advance();
        return;
      }
      const audio = new Audio(mediaUrl(entry.name));
      audio.volume = getCardEffectiveVolume();
      audio.play().catch(() => {});
      audio.onended = advance;
      const unsub = subscribeCardEffectiveVolume((vol) => {
        audio.volume = vol;
      });
      return () => {
        unsub();
        audio.pause();
        audio.src = "";
      };
    }

    let cancelled = false;
    void speak(entry.text, { lang: entry.lang, voices: entry.voices, rate: entry.rate }).then(
      () => {
        if (!cancelled) advance();
      },
    );
    return () => {
      cancelled = true;
      cancelSpeech();
    };
  }, [tauri, queueIdx, currentQueue]);

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

      const isUndo = (e.key === "z" || e.key === "Z") && !e.altKey && !e.shiftKey;
      if (isUndo) {
        e.preventDefault();
        if (!undoMut.isPending) {
          undoMut.mutate();
        }
        return;
      }

      if (e.key === "f" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toggleFocusMode();
        return;
      }
      if (!card || answerMut.isPending || actionBusy || tutorSaveOpen) return;

      if ((e.key === "t" || e.key === "T") && !e.metaKey && !e.ctrlKey && !e.altKey && revealed) {
        e.preventDefault();
        setTutorOpen((open) => !open);
        return;
      }

      if (tutorOpen) return;

      if (e.key === "r" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        replayAudio();
        return;
      }
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        const btn = getAnswerButtons(card).find((b) => b.hotkey === e.key);
        if (btn) answerMut.mutate({ cardId: card.card_id, rating: btn.rating });
        return;
      }
      if (e.key === "s" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        suspendMut.mutate(card.card_id);
      }
      if (e.key === "b" && !e.metaKey && !e.ctrlKey) {
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
    ? sessionAnswered + card.new_count + card.learning_count + card.review_count
    : sessionAnswered;
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

  return (
    <div className="relative flex h-full flex-col">
      {focusMode ? (
        <div className="glass-panel relative z-20 flex h-9 shrink-0 items-center justify-between gap-3 border-b px-4">
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
          className="relative z-20 flex min-h-[30px] shrink-0 items-center gap-2 border-b border-border/60 bg-background/80 px-4 py-1 sm:px-6"
        >
          <SessionProgressBar
            done={sessionAnswered}
            total={sessionTotal}
            className="min-w-0 flex-1 border-b-0 bg-transparent px-0 py-0 sm:px-0"
          />
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

      {card ? (
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
              onQueue={revealed ? setBackQueue : setFrontQueue}
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
                  onQueue={setFrontQueue}
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
                  onQueue={setBackQueue}
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
                        onClick={() =>
                          answerMut.mutate({ cardId: card.card_id, rating: btn.rating })
                        }
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

            {/* Card actions: tutor / audio / suspend / bury / flag */}
            <div className="mt-3 flex flex-wrap items-center justify-end gap-1">
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
                title={t("study.buryHint")}
              >
                <SkipForward className="size-3.5" />
                {t("study.bury")}
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
                  <Flag className="size-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">{t("study.flag")}</span>
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
                          className={`p-2 hover:bg-accent ${FLAG_COLORS[f]}`}
                          onClick={() => flagMut.mutate({ cardId: card.card_id, flag: f })}
                        >
                          <Flag className="size-4" />
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {revealed && tutorOpen && (
              <TutorPanel
                card={card}
                deckName={deckName ?? null}
                typedAnswer={typedAnswer}
                configured={aiConfigured}
                tauri={tauri}
                night={night}
                onClose={() => setTutorOpen(false)}
                onSaveDialogChange={setTutorSaveOpen}
              />
            )}

            {!focusMode && (
              <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/70">
                <Kbd>Space</Kbd> {t("study.hint.reveal")}
                <span className="mx-1">·</span>
                <Kbd>1–4</Kbd> {t("study.hint.rate")}
                <span className="mx-1">·</span>
                <Kbd>T</Kbd> {t("ai.tutor.button")}
                <span className="mx-1">·</span>
                <Kbd>Z</Kbd> {t("decks.undo")}
                <span className="mx-1">·</span>
                <Kbd>F</Kbd> {t("study.hint.focus")}
              </div>
            )}
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
        {actionToast && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: dur.fast, ease }}
            className="glass-panel absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border px-3 py-2 text-sm shadow-md"
          >
            <span>{actionToast.message}</span>
            {actionToast.onUndo && (
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={actionToast.onUndo}
              >
                {t("decks.undo")}
              </button>
            )}
          </motion.div>
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
  onClick: () => void;
}) {
  return (
    <motion.div whileTap={{ scale: 0.97 }} className="w-full">
      <Button
        variant={props.variant}
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
