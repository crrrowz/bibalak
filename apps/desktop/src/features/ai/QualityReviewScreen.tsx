import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useSearch } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCheck,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Sparkles,
  Undo2,
} from "lucide-react";
import type { AIPreviewPayload, QualityNoteInput, QualityScanNote } from "@bibalak/ipc-types";
import { ScreenHeader } from "@/components/ScreenHeader";
import { AINotConfiguredContent, AISendingBox } from "@/components/ai/AIBlocks";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { QualityConsentDialog } from "@/features/ai/quality/QualityConsentDialog";
import { deckSearchToken } from "@/features/browse/browseHelpers";
import { QualityFindingCard } from "@/features/ai/quality/QualityFindingCard";
import {
  buildQualityApplyPlan,
  chunkQualityNotes,
  DEFAULT_QUALITY_CHUNK_NOTES,
  isActionableFindingKind,
  QUALITY_FINDING_KINDS,
  type QualityFindingKind,
  type QualityReviewItem,
} from "@/features/ai/quality/qualityHelpers";
import { mapAiErrorMessage, type MappedAiError } from "@/lib/aiErrors";
import { t, tn } from "@/lib/i18n";
import { errorMessage, ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";
import { isAiConfigured, useAiSession } from "@/stores/aiSession";
import { useTheme } from "@/stores/theme";
import { toast } from "@/stores/toast";

type ScanPhase = "idle" | "loading" | "sending" | "part-error" | "done";

interface ConsentState {
  chunks: QualityNoteInput[][];
  preview: AIPreviewPayload;
  skipSession: boolean;
}

interface AppliedBanner {
  totalChanges: number;
  canUndo: boolean;
  undoUnavailable?: boolean;
  hasSplits: boolean;
  browseQuery: string;
}

export interface QualityReviewScreenProps {
  initialDeckId?: number;
  initialNoteIds?: number[];
  onUnappliedChange?: (count: number) => void;
}

export function QualityReviewScreen({
  initialDeckId,
  initialNoteIds,
  onUnappliedChange,
}: QualityReviewScreenProps) {
  const navigate = useOptionalNavigate();
  const queryClient = useQueryClient();
  const tauri = isTauri();
  const night = useTheme((s) => s.resolved) === "dark";

  const hasInitialSelection = Boolean(initialNoteIds && initialNoteIds.length > 0);
  const [scopeMode, setScopeMode] = useState<"deck" | "selection">(
    hasInitialSelection ? "selection" : "deck",
  );
  const [deckId, setDeckId] = useState<number | null>(initialDeckId ?? null);
  const [leechesOnly, setLeechesOnly] = useState(false);

  const aiConfigQuery = useQuery({ queryKey: queryKeys.aiConfig, queryFn: ipc.aiGetConfig });
  const decksQuery = useQuery({ queryKey: queryKeys.decks, queryFn: ipc.listDecks });
  const notetypesQuery = useQuery({ queryKey: queryKeys.notetypesAll, queryFn: ipc.listNotetypes });

  const aiConfigured = isAiConfigured(aiConfigQuery.data);
  const regularDecks = useMemo(
    () => (decksQuery.data ?? []).filter((d) => !d.is_filtered),
    [decksQuery.data],
  );
  const effectiveDeckId = useMemo(() => {
    if (deckId !== null && regularDecks.some((d) => d.id === deckId)) return deckId;
    return regularDecks[0]?.id ?? null;
  }, [deckId, regularDecks]);

  const selectedDeck = useMemo(
    () => regularDecks.find((d) => d.id === effectiveDeckId) ?? null,
    [regularDecks, effectiveDeckId],
  );
  const clozeNotetype = useMemo(
    () => (notetypesQuery.data ?? []).find((nt) => Number(nt.kind) === 1) ?? null,
    [notetypesQuery.data],
  );

  const [showNotConfigured, setShowNotConfigured] = useState(false);
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [chunks, setChunks] = useState<QualityNoteInput[][]>([]);
  const [notesById, setNotesById] = useState<Map<number, QualityScanNote>>(() => new Map());
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [failedChunkIndex, setFailedChunkIndex] = useState<number | null>(null);
  const [chunkError, setChunkError] = useState<MappedAiError | null>(null);
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [items, setItems] = useState<QualityReviewItem[]>([]);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [appliedBanner, setAppliedBanner] = useState<AppliedBanner | null>(null);

  const runSeqRef = useRef(0);
  const nextItemSeqRef = useRef(1);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const acceptedActionableCount = useMemo(
    () => items.filter((it) => it.accepted && isActionableFindingKind(it.finding.kind)).length,
    [items],
  );

  useEffect(() => {
    onUnappliedChange?.(acceptedActionableCount);
  }, [acceptedActionableCount, onUnappliedChange]);

  useEffect(() => {
    if (acceptedActionableCount === 0) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [acceptedActionableCount]);

  useEffect(() => {
    return () => {
      onUnappliedChange?.(0);
    };
  }, [onUnappliedChange]);

  const executeChunks = useCallback(
    async (allChunks: QualityNoteInput[][], startIndex: number, deckName?: string) => {
      const seq = ++runSeqRef.current;
      setPhase("sending");
      setChunkError(null);
      setFailedChunkIndex(null);

      for (let idx = startIndex; idx < allChunks.length; idx += 1) {
        if (runSeqRef.current !== seq) return;
        setProgress({ current: idx + 1, total: allChunks.length });

        try {
          const result = await ipc.aiRunAction({
            kind: "review-quality",
            notes: allChunks[idx],
            deck_name: deckName ?? null,
          });
          if (runSeqRef.current !== seq) return;

          const parsedFindings = result.quality_findings ?? [];
          const newItems: QualityReviewItem[] = parsedFindings.map((finding) => ({
            id: `qf-${nextItemSeqRef.current++}`,
            finding,
            accepted: false,
          }));
          setItems((prev) => [...prev, ...newItems]);
        } catch (err) {
          if (runSeqRef.current !== seq) return;
          setChunkError(mapAiErrorMessage(err));
          setFailedChunkIndex(idx);
          setPhase("part-error");
          return;
        }
      }

      if (runSeqRef.current !== seq) return;
      setProgress(null);
      setPhase("done");
    },
    [],
  );

  async function handleStartScan() {
    setApplyError(null);
    setAppliedBanner(null);
    if (!aiConfigured) {
      setShowNotConfigured(true);
      return;
    }

    const useSelection = scopeMode === "selection" && hasInitialSelection;
    const targetDeckId = useSelection ? null : effectiveDeckId;
    const targetNoteIds = useSelection ? (initialNoteIds ?? null) : null;
    const deckName = useSelection ? undefined : selectedDeck?.name;

    if (!useSelection && targetDeckId === null && !leechesOnly) {
      setStatusMessage(t("ai.quality.emptyScope"));
      return;
    }

    const seq = ++runSeqRef.current;
    setPhase("loading");
    setStatusMessage(null);
    setChunkError(null);
    setItems([]);

    try {
      const loaded = await ipc.loadQualityNotes(targetDeckId, targetNoteIds, leechesOnly);
      if (runSeqRef.current !== seq) return;

      if (loaded.length === 0) {
        setNotesById(new Map());
        setChunks([]);
        setPhase("idle");
        setStatusMessage(t("ai.quality.emptyScope"));
        return;
      }

      const map = new Map<number, QualityScanNote>();
      for (const note of loaded) map.set(note.note_id, note);
      setNotesById(map);

      const partitioned = chunkQualityNotes(loaded, DEFAULT_QUALITY_CHUNK_NOTES);
      setChunks(partitioned);

      const preview = await ipc.aiPreviewAction({
        kind: "review-quality",
        notes: partitioned[0],
        deck_name: deckName ?? null,
      });
      if (runSeqRef.current !== seq) return;

      if (useAiSession.getState().shouldSkipPreview("review-quality")) {
        void executeChunks(partitioned, 0, deckName);
      } else {
        setPhase("idle");
        setConsent({
          chunks: partitioned,
          preview,
          skipSession: false,
        });
      }
    } catch (err) {
      if (runSeqRef.current !== seq) return;
      setPhase("idle");
      setStatusMessage(errorMessage(err));
    }
  }

  function handleConfirmConsent() {
    if (!consent) return;
    if (consent.skipSession) {
      useAiSession.getState().setSkipPreview("review-quality", true);
    }
    const targetChunks = consent.chunks;
    const deckName = scopeMode === "deck" ? selectedDeck?.name : undefined;
    setConsent(null);
    void executeChunks(targetChunks, 0, deckName);
  }

  function handleCancelScan() {
    runSeqRef.current += 1;
    setProgress(null);
    setChunkError(null);
    setFailedChunkIndex(null);
    setConsent(null);
    setPhase(itemsRef.current.length > 0 ? "done" : "idle");
  }

  function handleAcceptToggle(id: string, accepted: boolean) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, accepted } : it)));
  }

  function handleDismissItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  function handleAcceptGroup(kind: QualityFindingKind) {
    setItems((prev) =>
      prev.map((it) => (it.finding.kind === kind ? { ...it, accepted: true } : it)),
    );
  }

  async function handleUndoApplied() {
    try {
      const status = await ipc.undoStatus();
      if (status?.kind !== "quality-fixes") {
        setAppliedBanner((prev) =>
          prev ? { ...prev, canUndo: false, undoUnavailable: true } : null,
        );
        return;
      }
      const undone = await ipc.undo();
      if (undone) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.decks }),
          queryClient.invalidateQueries({ queryKey: queryKeys.notesAll }),
          queryClient.invalidateQueries({ queryKey: queryKeys.tags }),
        ]);
        toast.info(t("ai.quality.undoneToast"));
        setAppliedBanner((prev) => (prev ? { ...prev, canUndo: false } : null));
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function handleApplyAccepted() {
    setApplyError(null);
    const clozeFieldsLen = clozeNotetype ? Math.max(1, clozeNotetype.field_names.length) : 2;
    const plan = buildQualityApplyPlan(items, notesById, clozeFieldsLen);

    if (plan.clozeSplits.length > 0 && !clozeNotetype) {
      setApplyError(t("ai.quality.clozeNoNotetype"));
      return;
    }
    if (plan.edits.length === 0 && plan.clozeSplits.length === 0) {
      return;
    }

    setApplying(true);
    try {
      let updatedCount = 0;
      const touchedIds = new Set<number>();

      if (plan.edits.length > 0) {
        const res = await ipc.applyQualityFixes(plan.edits);
        updatedCount += res.notes_updated;
        for (const id of res.note_ids) touchedIds.add(id);
      }

      if (plan.clozeSplits.length > 0 && clozeNotetype) {
        for (const batch of plan.clozeSplits) {
          const added = await ipc.addNotesBatch(clozeNotetype.id, batch.deckId, batch.notes);
          updatedCount += added.note_ids.length;
          for (const id of added.note_ids) touchedIds.add(id);
        }
      }

      if (plan.suspendCardIds.length > 0) {
        await ipc.suspendCards(plan.suspendCardIds);
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.decks }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notesAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tags }),
      ]);

      setItems((prev) =>
        prev.filter((it) => !(it.accepted && isActionableFindingKind(it.finding.kind))),
      );

      const browseQuery =
        touchedIds.size > 0
          ? `nid:${Array.from(touchedIds).join(",")}`
          : selectedDeck
            ? deckSearchToken(selectedDeck.name)
            : "";

      const banner: AppliedBanner = {
        totalChanges: updatedCount,
        canUndo: plan.edits.length > 0,
        hasSplits: plan.clozeSplits.length > 0,
        browseQuery,
      };
      setAppliedBanner(banner);
      scrollContainerRef.current?.scrollTo?.({ top: 0, behavior: "smooth" });

      toast.success(tn("ai.quality.appliedToast", updatedCount), {
        action: banner.canUndo
          ? {
              label: t("ai.quality.undoApplied"),
              onClick: () => void handleUndoApplied(),
            }
          : undefined,
      });
    } catch (err) {
      setApplyError(errorMessage(err));
    } finally {
      setApplying(false);
    }
  }

  const groupedItems = useMemo(() => {
    const groups: { kind: QualityFindingKind; list: QualityReviewItem[] }[] = [];
    for (const kind of QUALITY_FINDING_KINDS) {
      const list = items.filter((it) => it.finding.kind === kind);
      if (list.length > 0) groups.push({ kind, list });
    }
    return groups;
  }, [items]);

  const busyScanning = phase === "loading" || phase === "sending";

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title={t("ai.quality.title")}
        description={t("ai.quality.description")}
        breadcrumb={{
          label: t("ai.breadcrumb.assistant"),
          onBack: () => navigate?.("/assistant"),
        }}
        actions={
          acceptedActionableCount > 0 && (
            <Button type="button" size="sm" disabled={applying} onClick={handleApplyAccepted}>
              {applying ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <CheckCheck className="size-3.5" aria-hidden />
              )}
              {applying
                ? t("ai.quality.applying")
                : tn("ai.quality.actionSummary", acceptedActionableCount)}
            </Button>
          )
        }
      />

      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
          <section
            aria-labelledby="quality-scope-heading"
            className="space-y-4 rounded-[14px] border border-border bg-card p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="quality-scope-heading" className="text-sm font-semibold text-foreground">
                {t("ai.quality.scopeHeading")}
              </h2>
              <span className="text-xs text-muted-foreground">{t("ai.quality.upToLimitNote")}</span>
            </div>

            {hasInitialSelection && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={scopeMode === "selection" ? "default" : "outline"}
                  onClick={() => setScopeMode("selection")}
                >
                  {t("ai.quality.scopeSelection", { count: initialNoteIds?.length ?? 0 })}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={scopeMode === "deck" ? "default" : "outline"}
                  onClick={() => setScopeMode("deck")}
                >
                  {t("ai.quality.scopeDeck")}
                </Button>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-4">
              {scopeMode === "deck" && (
                <label className="min-w-[220px] flex-1 text-xs font-medium text-muted-foreground">
                  {t("ai.quality.scopeDeckLabel")}
                  {(() => {
                    const selectedDeckName = regularDecks.find(
                      (d) => d.id === effectiveDeckId,
                    )?.name;
                    return (
                      <Select
                        aria-label={t("ai.quality.scopeDeckLabel")}
                        dir="auto"
                        title={selectedDeckName}
                        value={effectiveDeckId ?? ""}
                        onChange={(e) => setDeckId(e.target.value ? Number(e.target.value) : null)}
                        className="mt-1"
                      >
                        {regularDecks.map((d) => (
                          <option key={d.id} value={d.id} dir="auto" title={d.name}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                    );
                  })()}
                </label>
              )}

              <label className="flex h-9 items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={leechesOnly}
                  onChange={(e) => setLeechesOnly(e.target.checked)}
                  className="size-3.5 accent-primary"
                />
                <span>{t("ai.quality.leechesOnly")}</span>
              </label>

              <Button
                type="button"
                size="sm"
                disabled={busyScanning || applying}
                onClick={handleStartScan}
              >
                {busyScanning ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="size-3.5" aria-hidden />
                )}
                {phase === "loading" ? t("ai.quality.scanning") : t("ai.quality.scanButton")}
              </Button>
            </div>

            {statusMessage && (
              <p className="text-xs text-muted-foreground" role="status">
                {statusMessage}
              </p>
            )}
          </section>

          {phase === "sending" && progress && (
            <section className="space-y-3 rounded-[14px] border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">
                  {t("ai.quality.chunkProgress", {
                    current: progress.current,
                    total: progress.total,
                  })}
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={handleCancelScan}>
                  {t("ai.quality.cancelScan")}
                </Button>
              </div>
              <AISendingBox />
            </section>
          )}

          {phase === "part-error" && chunkError && failedChunkIndex !== null && (
            <section
              role="alert"
              className="space-y-3 rounded-[14px] border border-destructive/40 bg-destructive/5 p-4 text-xs"
            >
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <AlertTriangle className="size-4 text-destructive" aria-hidden />
                <span>
                  {t("ai.quality.failedBatch", {
                    index: failedChunkIndex + 1,
                    total: chunks.length,
                  })}
                </span>
              </div>
              <p dir="auto" className="text-muted-foreground">
                {chunkError.message}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void executeChunks(
                      chunks,
                      failedChunkIndex,
                      scopeMode === "deck" ? selectedDeck?.name : undefined,
                    )
                  }
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  {t("ai.quality.retryBatch")}
                </Button>
                {failedChunkIndex + 1 < chunks.length && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void executeChunks(
                        chunks,
                        failedChunkIndex + 1,
                        scopeMode === "deck" ? selectedDeck?.name : undefined,
                      )
                    }
                  >
                    {t("ai.quality.continueNext")}
                  </Button>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={handleCancelScan}>
                  {t("ai.quality.cancelScan")}
                </Button>
              </div>
            </section>
          )}

          {appliedBanner && (
            <section className="flex flex-col gap-2 rounded-[14px] border border-emerald-600/30 bg-emerald-500/10 p-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
                  <span>{tn("ai.quality.appliedToast", appliedBanner.totalChanges)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {appliedBanner.canUndo && (
                    <Button type="button" size="sm" variant="outline" onClick={handleUndoApplied}>
                      <Undo2 className="size-3.5" aria-hidden />
                      {t("ai.quality.undoApplied")}
                    </Button>
                  )}
                  {navigate && appliedBanner.browseQuery && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => navigate("/browse", { q: appliedBanner.browseQuery })}
                    >
                      {t("ai.quality.browseLink")}
                    </Button>
                  )}
                </div>
              </div>
              {appliedBanner.hasSplits && (
                <p className="text-muted-foreground">{t("ai.quality.undoSplitNotice")}</p>
              )}
              {appliedBanner.undoUnavailable && (
                <p className="text-muted-foreground">{t("ai.quality.undoUnavailableNotice")}</p>
              )}
            </section>
          )}

          {applyError && (
            <div
              role="alert"
              className="rounded-[14px] border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
            >
              {applyError}
            </div>
          )}

          {phase === "done" && items.length === 0 && (
            <section className="rounded-[14px] border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              {t("ai.quality.noFindings")}
            </section>
          )}

          {groupedItems.length > 0 && (
            <section aria-labelledby="quality-findings-heading" className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="quality-findings-heading" className="text-sm font-semibold text-foreground">
                  {t("ai.quality.findingsHeading")} ({items.length})
                </h2>
                {notesById.size > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {tn("ai.quality.loadedCount", notesById.size)}
                  </span>
                )}
              </div>

              {groupedItems.map(({ kind, list }) => (
                <div key={kind} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      {t(`ai.quality.group.${kind}`)} ({list.length})
                    </h3>
                    {isActionableFindingKind(kind) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleAcceptGroup(kind)}
                      >
                        {t("ai.quality.acceptGroup")}
                      </Button>
                    )}
                  </div>

                  <div className="space-y-3">
                    {list.map((item) => (
                      <QualityFindingCard
                        key={item.id}
                        item={item}
                        note={notesById.get(item.finding.note_id)}
                        otherNote={
                          item.finding.kind === "duplicate-meaning"
                            ? notesById.get(item.finding.other_note_id)
                            : undefined
                        }
                        tauri={tauri}
                        night={night}
                        onToggleAccept={handleAcceptToggle}
                        onDismiss={handleDismissItem}
                        onUpdateFields={(id, fields) =>
                          setItems((prev) =>
                            prev.map((it) => (it.id === id ? { ...it, editedFields: fields } : it)),
                          )
                        }
                        onUpdateTags={(id, tags) =>
                          setItems((prev) =>
                            prev.map((it) => (it.id === id ? { ...it, editedTags: tags } : it)),
                          )
                        }
                        onUpdateClozes={(id, clozes) =>
                          setItems((prev) =>
                            prev.map((it) => (it.id === id ? { ...it, editedClozes: clozes } : it)),
                          )
                        }
                        onToggleSuspendOriginal={(id, suspendOriginal) =>
                          setItems((prev) =>
                            prev.map((it) => (it.id === id ? { ...it, suspendOriginal } : it)),
                          )
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}

              {acceptedActionableCount > 0 && (
                <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-primary/40 bg-card/95 p-3.5 shadow-lg backdrop-blur">
                  <span className="text-xs font-medium text-foreground">
                    {tn("ai.quality.actionSummary", acceptedActionableCount)}
                  </span>
                  <Button type="button" size="sm" disabled={applying} onClick={handleApplyAccepted}>
                    {applying ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <CheckCheck className="size-3.5" aria-hidden />
                    )}
                    {t("ai.quality.applyButton")}
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      <QualityConsentDialog
        open={Boolean(consent)}
        chunks={consent?.chunks ?? []}
        preview={consent?.preview ?? null}
        skipSession={consent?.skipSession ?? false}
        onChangeSkipSession={(skipSession) =>
          setConsent((prev) => (prev ? { ...prev, skipSession } : null))
        }
        onConfirm={handleConfirmConsent}
        onCancel={() => setConsent(null)}
      />

      <Dialog
        open={showNotConfigured}
        onClose={() => setShowNotConfigured(false)}
        ariaLabel={t("ai.notConfigured.title")}
        className="max-w-md rounded-[14px] p-6"
      >
        <AINotConfiguredContent
          onCancel={() => setShowNotConfigured(false)}
          onSetup={() => {
            setShowNotConfigured(false);
            navigate?.("/assistant");
          }}
        />
      </Dialog>
    </div>
  );
}

/** Route wrapper reading TanStack search params and blocking navigation if accepted edits await Apply. */
export function QualityReviewRoute() {
  const search = useSearch({ strict: false }) as { deckId?: number; noteIds?: string };
  const unappliedRef = useRef(0);
  useBlocker({
    shouldBlockFn: () => unappliedRef.current > 0 && !window.confirm(t("ai.quality.leaveWarning")),
    enableBeforeUnload: false,
  });
  const initialNoteIds = search.noteIds
    ?.split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return (
    <QualityReviewScreen
      initialDeckId={search.deckId}
      initialNoteIds={initialNoteIds && initialNoteIds.length > 0 ? initialNoteIds : undefined}
      onUnappliedChange={(count) => {
        unappliedRef.current = count;
      }}
    />
  );
}
