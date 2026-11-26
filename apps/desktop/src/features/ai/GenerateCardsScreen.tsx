import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RotateCcw, Sparkles } from "lucide-react";
import type { AIActionRequest, BatchNoteInput, GeneratedNoteKind } from "@bibalak/ipc-types";
import { ScreenHeader } from "@/components/ScreenHeader";
import { AIActionDialog } from "@/components/ai/AIActionDialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  buildGeneratedBrowseQuery,
  DEFAULT_GENERATE_COUNT,
  distributeCardCounts,
  draftFromGenerated,
  matchingNotetypesForKind,
  MAX_GENERATE_CHARS,
  MAX_GENERATE_COUNT,
  MIN_GENERATE_COUNT,
  type EditableDraft,
} from "@/features/ai/generateHelpers";
import { mapAiErrorMessage, type MappedAiError } from "@/lib/aiErrors";
import { plainTextToFieldHtml } from "@/lib/aiFormat";
import { t, tn } from "@/lib/i18n";
import { errorMessage, ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";
import { isAiConfigured, useAiSession } from "@/stores/aiSession";
import { useTheme } from "@/stores/theme";
import { toast } from "@/stores/toast";
import { useUi } from "@/stores/ui";
import { GenerateConsentDialog, type ConsentState } from "./GenerateConsentDialog";
import { GenerateDraftReviewSection } from "./GenerateDraftReviewSection";

type RunPhase = "idle" | "sending" | "part-error" | "done";

function firstStrongDir(s?: string): "ltr" | "rtl" | undefined {
  if (!s) return undefined;
  for (const ch of s) {
    if (/[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(ch)) return "rtl";
    if (/[A-Za-z\u00C0-\u02AF\u0370-\u052F]/.test(ch)) return "ltr";
  }
  return undefined;
}

export function GenerateCardsScreen() {
  const navigate = useOptionalNavigate();
  const queryClient = useQueryClient();
  const tauri = isTauri();
  const night = useTheme((s) => s.resolved) === "dark";

  const lastAddDeckId = useUi((s) => s.lastAddDeckId);
  const setLastAddDeckId = useUi((s) => s.setLastAddDeckId);
  const lastAddNotetypeId = useUi((s) => s.lastAddNotetypeId);
  const setLastAddNotetypeId = useUi((s) => s.setLastAddNotetypeId);

  const aiConfigQuery = useQuery({
    queryKey: queryKeys.aiConfig,
    queryFn: ipc.aiGetConfig,
  });
  const decksQuery = useQuery({
    queryKey: queryKeys.decks,
    queryFn: ipc.listDecks,
  });
  const notetypesQuery = useQuery({
    queryKey: queryKeys.notetypesAll,
    queryFn: ipc.listNotetypes,
  });

  const aiConfigured = isAiConfigured(aiConfigQuery.data);
  const regularDecks = useMemo(
    () => (decksQuery.data ?? []).filter((d) => !d.is_filtered),
    [decksQuery.data],
  );

  const [noteKind, setNoteKind] = useState<GeneratedNoteKind>("basic");
  const matchingNotetypes = useMemo(
    () => matchingNotetypesForKind(notetypesQuery.data ?? [], noteKind),
    [notetypesQuery.data, noteKind],
  );

  const [deckId, setDeckId] = useState<number | null>(null);
  const [notetypeId, setNotetypeId] = useState<number | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [countInput, setCountInput] = useState(String(DEFAULT_GENERATE_COUNT));
  const [tagAiGenerated, setTagAiGenerated] = useState(true);

  const [addingStockCloze, setAddingStockCloze] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [setupPromptOpen, setSetupPromptOpen] = useState(false);
  const [preparingConsent, setPreparingConsent] = useState(false);
  const [consent, setConsent] = useState<ConsentState | null>(null);

  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [runParts, setRunParts] = useState<string[]>([]);
  const [runCounts, setRunCounts] = useState<number[]>([]);
  const [runPartIndex, setRunPartIndex] = useState(0);
  const [runError, setRunError] = useState<MappedAiError | null>(null);

  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [duplicates, setDuplicates] = useState<Record<string, number | null>>({});
  const [addingBatch, setAddingBatch] = useState(false);
  const [addedBanner, setAddedBanner] = useState<{
    cardsAdded: number;
    deckName: string;
    browseQuery: string;
  } | null>(null);

  // Monotonic sequence counters discard stale IPC responses on cancel or unmount.
  const runSeqRef = useRef(0);
  const dupSeqRef = useRef(0);
  const nextDraftSeqRef = useRef(0);

  useEffect(() => {
    const ref = runSeqRef;
    const dupRef = dupSeqRef;
    return () => {
      ref.current += 1;
      dupRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (regularDecks.length === 0) return;
    if (deckId != null && regularDecks.some((d) => d.id === deckId)) return;
    const preferred =
      lastAddDeckId != null ? regularDecks.find((d) => d.id === lastAddDeckId) : undefined;
    setDeckId((preferred ?? regularDecks[0]).id);
  }, [regularDecks, deckId, lastAddDeckId]);

  useEffect(() => {
    if (matchingNotetypes.length === 0) {
      setNotetypeId(null);
      return;
    }
    if (notetypeId != null && matchingNotetypes.some((nt) => nt.id === notetypeId)) return;
    const preferred =
      lastAddNotetypeId != null
        ? matchingNotetypes.find((nt) => nt.id === lastAddNotetypeId)
        : undefined;
    setNotetypeId((preferred ?? matchingNotetypes[0]).id);
  }, [matchingNotetypes, notetypeId, lastAddNotetypeId]);

  const selectedDeck = useMemo(
    () => regularDecks.find((d) => d.id === deckId) ?? null,
    [regularDecks, deckId],
  );
  const selectedNotetype = useMemo(
    () => matchingNotetypes.find((nt) => nt.id === notetypeId) ?? null,
    [matchingNotetypes, notetypeId],
  );

  // Re-check duplicates when drafts change (text edits, part additions) or target notetype changes.
  const draftFirstFieldsKey = useMemo(
    () => drafts.map((d) => `${d.id}:${d.kind === "basic" ? d.front : d.text}`).join("\u0000"),
    [drafts],
  );

  useEffect(() => {
    if (notetypeId == null || drafts.length === 0) {
      setDuplicates({});
      return;
    }
    const seq = ++dupSeqRef.current;
    const timer = setTimeout(async () => {
      const entries = await Promise.all(
        drafts.map(async (d) => {
          const raw = (d.kind === "basic" ? d.front : d.text).trim();
          if (!raw) return [d.id, null] as const;
          try {
            const match = await ipc.checkDuplicate(notetypeId, plainTextToFieldHtml(raw));
            return [d.id, match] as const;
          } catch {
            return [d.id, null] as const;
          }
        }),
      );
      if (dupSeqRef.current !== seq) return;
      setDuplicates(Object.fromEntries(entries));
    }, 120);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notetypeId, draftFirstFieldsKey]);

  const charCount = sourceText.length;
  const overLimit = charCount > MAX_GENERATE_CHARS;
  const parsedCount = Number.parseInt(countInput, 10);
  const clampedCount = Number.isFinite(parsedCount)
    ? Math.max(MIN_GENERATE_COUNT, Math.min(MAX_GENERATE_COUNT, parsedCount))
    : DEFAULT_GENERATE_COUNT;

  const canSubmit =
    sourceText.trim().length > 0 &&
    !overLimit &&
    selectedDeck != null &&
    selectedNotetype != null &&
    !preparingConsent &&
    runPhase !== "sending";

  const handleAddStockCloze = async () => {
    setActionError(null);
    setAddingStockCloze(true);
    try {
      const names = await ipc.listStockNotetypes();
      const idx = names.findIndex((name) => name.trim().toLowerCase() === "cloze");
      if (idx < 0) {
        throw new Error(t("ai.generate.stockClozeMissing"));
      }
      const created = await ipc.addStockNotetype(idx);
      await queryClient.invalidateQueries({ queryKey: queryKeys.notetypesAll });
      setNotetypeId(created.id);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setAddingStockCloze(false);
    }
  };

  const buildPartRequest = (
    partText: string,
    partCount: number,
    deckName: string | null,
  ): AIActionRequest => ({
    kind: "generate-cards",
    text: partText,
    note_kind: noteKind,
    count: partCount,
    deck_name: deckName,
  });

  const runPartsSequentially = async (
    parts: string[],
    counts: number[],
    startIndex: number,
    deckName: string | null,
    seq: number,
  ) => {
    setRunPhase("sending");
    setRunError(null);
    setRunParts(parts);
    setRunCounts(counts);

    for (let i = startIndex; i < parts.length; i += 1) {
      if (runSeqRef.current !== seq) return;
      setRunPartIndex(i);
      try {
        const res = await ipc.aiRunAction(buildPartRequest(parts[i], counts[i], deckName));
        if (runSeqRef.current !== seq) return;
        const incoming = (res.generated_cards ?? []).map((item) => {
          nextDraftSeqRef.current += 1;
          return draftFromGenerated(item, `draft-${nextDraftSeqRef.current}`);
        });
        setDrafts((prev) => [...prev, ...incoming]);
      } catch (err) {
        if (runSeqRef.current !== seq) return;
        setRunError(mapAiErrorMessage(err));
        setRunPartIndex(i);
        setRunPhase("part-error");
        return;
      }
    }

    if (runSeqRef.current !== seq) return;
    setRunPhase("done");
  };

  const handleGenerateClick = async () => {
    setActionError(null);
    setAddedBanner(null);
    if (!aiConfigured) {
      setSetupPromptOpen(true);
      return;
    }
    if (!canSubmit || !selectedDeck) return;

    setPreparingConsent(true);
    try {
      const splitParts = await ipc.aiSplitText(sourceText);
      const rawCounts = distributeCardCounts(clampedCount, splitParts.length);
      const parts = splitParts.filter((_, idx) => rawCounts[idx] > 0);
      const counts = rawCounts.filter((c) => c > 0);
      if (parts.length === 0) return;

      // Single-part runs honor "Don't ask again this session"; multi-part always confirms chunk count.
      if (parts.length === 1 && useAiSession.getState().shouldSkipPreview("generate-cards")) {
        const seq = ++runSeqRef.current;
        setDrafts([]);
        setDuplicates({});
        void runPartsSequentially(parts, counts, 0, selectedDeck.name, seq);
        return;
      }

      const preview = await ipc.aiPreviewAction(
        buildPartRequest(parts[0], counts[0], selectedDeck.name),
      );
      setConsent({ parts, counts, preview, skipSession: false });
    } catch (err) {
      setActionError(mapAiErrorMessage(err).message);
    } finally {
      setPreparingConsent(false);
    }
  };

  const handleConfirmSend = () => {
    if (!consent || !selectedDeck) return;
    if (consent.skipSession) {
      useAiSession.getState().setSkipPreview("generate-cards", true);
    }
    const { parts, counts } = consent;
    setConsent(null);
    setDrafts([]);
    setDuplicates({});
    const seq = ++runSeqRef.current;
    void runPartsSequentially(parts, counts, 0, selectedDeck.name, seq);
  };

  const handleCancelSending = () => {
    runSeqRef.current += 1;
    setRunPhase(drafts.length > 0 ? "done" : "idle");
    setRunError(null);
  };

  const handleRetryPart = () => {
    const seq = ++runSeqRef.current;
    void runPartsSequentially(runParts, runCounts, runPartIndex, selectedDeck?.name ?? null, seq);
  };

  const handleContinueRemaining = () => {
    const seq = ++runSeqRef.current;
    void runPartsSequentially(
      runParts,
      runCounts,
      runPartIndex + 1,
      selectedDeck?.name ?? null,
      seq,
    );
  };

  const handleStopHere = () => {
    runSeqRef.current += 1;
    setRunError(null);
    setRunPhase("done");
  };

  const updateDraft = (id: string, patch: Partial<EditableDraft>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const setAllAccepted = (accepted: boolean) => {
    setDrafts((prev) => prev.map((d) => ({ ...d, accepted })));
  };

  const acceptedDrafts = useMemo(() => drafts.filter((d) => d.accepted), [drafts]);

  const handleAddSelected = async () => {
    if (!selectedDeck || !selectedNotetype || acceptedDrafts.length === 0) return;
    setActionError(null);
    setAddingBatch(true);
    try {
      const totalFields = Math.max(2, selectedNotetype.field_names.length);
      const notes: BatchNoteInput[] = acceptedDrafts.map((d) => {
        const fields =
          d.kind === "basic"
            ? [
                plainTextToFieldHtml(d.front),
                plainTextToFieldHtml(d.back),
                ...Array<string>(Math.max(0, totalFields - 2)).fill(""),
              ]
            : [
                plainTextToFieldHtml(d.text),
                ...Array<string>(Math.max(0, totalFields - 1)).fill(""),
              ];
        return {
          fields,
          tags: tagAiGenerated ? ["ai-generated"] : [],
        };
      });

      const res = await ipc.addNotesBatch(selectedNotetype.id, selectedDeck.id, notes);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.decks }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notesAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tags }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notetypesAll }),
      ]);

      const browseQuery = buildGeneratedBrowseQuery(selectedDeck.name, tagAiGenerated);
      toast.success(tn("ai.generate.addedSummary", res.cards_added, { deck: selectedDeck.name }), {
        action: {
          label: t("ai.generate.openBrowse"),
          onClick: () => navigate?.("/browse", { q: browseQuery }),
        },
      });
      setAddedBanner({
        cardsAdded: res.cards_added,
        deckName: selectedDeck.name,
        browseQuery,
      });
      setDrafts([]);
      setDuplicates({});
      setRunPhase("idle");
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setAddingBatch(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title={t("ai.generate.title")}
        description={t("ai.generate.description")}
        breadcrumb={{
          label: t("ai.breadcrumb.assistant"),
          onBack: () => navigate?.("/assistant"),
        }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
          {/* Source text and generation options */}
          <section className="space-y-4 rounded-[14px] border border-border bg-card p-4 sm:p-5">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="gen-source" className="text-sm font-medium text-foreground">
                  {t("ai.generate.sourceLabel")}
                </label>
                <span
                  className={`text-xs tabular-nums ${
                    overLimit ? "font-medium text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {t("ai.generate.charCount", { count: charCount, max: MAX_GENERATE_CHARS })}
                </span>
              </div>
              <textarea
                id="gen-source"
                dir="auto"
                rows={7}
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                placeholder={t("ai.generate.sourcePlaceholder")}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {overLimit && (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {t("ai.generate.charLimitError")}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Target deck */}
              <div className="min-w-0 space-y-1.5">
                <label htmlFor="gen-deck" className="text-xs font-medium text-muted-foreground">
                  {t("ai.generate.deckLabel")}
                </label>
                {(() => {
                  const selectedDeckName = (
                    regularDecks.find((d) => d.id === deckId) ?? regularDecks[0]
                  )?.name;
                  const dir = firstStrongDir(selectedDeckName);
                  return (
                    <Select
                      id="gen-deck"
                      dir="auto"
                      title={selectedDeckName}
                      style={dir ? { direction: dir } : undefined}
                      value={deckId ?? ""}
                      onChange={(e) => {
                        const nextId = Number(e.target.value);
                        setDeckId(nextId);
                        setLastAddDeckId(nextId);
                      }}
                    >
                      {regularDecks.map((d) => (
                        <option key={d.id} value={d.id} dir="auto" title={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                  );
                })()}
              </div>

              {/* Card kind toggle */}
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-muted-foreground">
                  {t("ai.generate.kindLabel")}
                </span>
                <div className="flex min-w-0 rounded-lg border border-input bg-background p-0.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={noteKind === "basic" ? "default" : "ghost"}
                    aria-pressed={noteKind === "basic"}
                    onClick={() => setNoteKind("basic")}
                    className="h-8 min-w-0 flex-1 truncate px-2 text-xs"
                  >
                    {t("ai.generate.kindBasic")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={noteKind === "cloze" ? "default" : "ghost"}
                    aria-pressed={noteKind === "cloze"}
                    onClick={() => setNoteKind("cloze")}
                    className="h-8 min-w-0 flex-1 truncate px-2 text-xs"
                  >
                    {t("ai.generate.kindCloze")}
                  </Button>
                </div>
              </div>

              {/* Target notetype */}
              <div className="space-y-1.5">
                <label htmlFor="gen-notetype" className="text-xs font-medium text-muted-foreground">
                  {t("ai.generate.notetypeLabel")}
                </label>
                <Select
                  id="gen-notetype"
                  value={notetypeId ?? ""}
                  disabled={matchingNotetypes.length === 0}
                  onChange={(e) => {
                    const nextId = Number(e.target.value);
                    setNotetypeId(nextId);
                    setLastAddNotetypeId(nextId);
                  }}
                >
                  {matchingNotetypes.map((nt) => (
                    <option key={nt.id} value={nt.id}>
                      {nt.name}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Target card count */}
              <div className="space-y-1.5">
                <label htmlFor="gen-count" className="text-xs font-medium text-muted-foreground">
                  {t("ai.generate.countLabel")}
                </label>
                <input
                  id="gen-count"
                  type="number"
                  min={MIN_GENERATE_COUNT}
                  max={MAX_GENERATE_COUNT}
                  value={countInput}
                  onChange={(e) => setCountInput(e.target.value)}
                  onBlur={() => setCountInput(String(clampedCount))}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="text-[11px] text-muted-foreground">{t("ai.generate.countHint")}</p>
              </div>
            </div>

            {/* Missing Cloze helper */}
            {noteKind === "cloze" && matchingNotetypes.length === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs">
                <span className="text-foreground">{t("ai.generate.noClozeHint")}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={addingStockCloze}
                  onClick={() => void handleAddStockCloze()}
                >
                  {addingStockCloze ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : null}
                  {t("ai.generate.addStockCloze")}
                </Button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={tagAiGenerated}
                  onChange={(e) => setTagAiGenerated(e.target.checked)}
                  className="size-3.5 accent-primary"
                />
                <span>{t("ai.generate.tagLabel")}</span>
              </label>

              <Button
                type="button"
                disabled={overLimit || (aiConfigured ? !canSubmit : false)}
                onClick={() => void handleGenerateClick()}
              >
                {preparingConsent ? (
                  <Loader2 className="me-1.5 size-4 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="me-1.5 size-4" aria-hidden />
                )}
                {t("ai.generate.submitButton")}
              </Button>
            </div>
          </section>

          {actionError && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive"
            >
              {actionError}
            </div>
          )}

          {/* Added notes confirmation banner */}
          {addedBanner && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-emerald-600/30 bg-emerald-500/10 px-4 py-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
                <span>
                  {tn("ai.generate.addedSummary", addedBanner.cardsAdded, {
                    deck: addedBanner.deckName,
                  })}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => navigate?.("/browse", { q: addedBanner.browseQuery })}
              >
                {t("ai.generate.openBrowse")}
              </Button>
            </div>
          )}

          {/* Active sequential part progress */}
          {runPhase === "sending" && (
            <section
              aria-live="polite"
              className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border bg-card p-4"
            >
              <div className="flex items-center gap-2.5 text-sm font-medium text-foreground">
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                <span>
                  {t("ai.generate.partProgress", {
                    current: runPartIndex + 1,
                    total: runParts.length,
                  })}
                </span>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={handleCancelSending}>
                {t("common.cancel")}
              </Button>
            </section>
          )}

          {/* Partial part error recovery */}
          {runPhase === "part-error" && runError && (
            <section
              role="alert"
              className="space-y-3 rounded-[14px] border border-destructive/40 bg-destructive/10 p-4 text-xs"
            >
              <div className="space-y-1">
                <p className="text-sm font-semibold text-destructive">
                  {t("ai.generate.partFailed", {
                    current: runPartIndex + 1,
                    total: runParts.length,
                  })}
                </p>
                <p className="text-foreground">{runError.message}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={handleRetryPart}>
                  <RotateCcw className="me-1.5 size-3.5" aria-hidden />
                  {t("ai.generate.retryPart")}
                </Button>
                {runPartIndex + 1 < runParts.length && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleContinueRemaining}
                  >
                    {t("ai.generate.continueRemaining")}
                  </Button>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={handleStopHere}>
                  {t("ai.generate.stopHere")}
                </Button>
              </div>
            </section>
          )}

          {/* Review draft cards list */}
          {drafts.length > 0 && (
            <GenerateDraftReviewSection
              drafts={drafts}
              acceptedCount={acceptedDrafts.length}
              duplicates={duplicates}
              tauri={tauri}
              night={night}
              selectedDeckName={selectedDeck?.name ?? null}
              canAddSelected={
                acceptedDrafts.length > 0 &&
                Boolean(selectedDeck) &&
                Boolean(selectedNotetype) &&
                !addingBatch &&
                runPhase !== "sending"
              }
              addingBatch={addingBatch}
              onSetAllAccepted={setAllAccepted}
              onUpdateDraft={updateDraft}
              onAddSelected={() => void handleAddSelected()}
            />
          )}
        </div>
      </div>

      {/* Not-configured dialog reusing AI0 AIActionDialog */}
      <AIActionDialog
        open={setupPromptOpen}
        configured={false}
        title={t("ai.generate.title")}
        action={{
          kind: "generate-cards",
          text: sourceText.trim() || " ",
          note_kind: noteKind,
          count: clampedCount,
          deck_name: selectedDeck?.name ?? null,
        }}
        onClose={() => setSetupPromptOpen(false)}
      />

      {/* Explicit consent preview dialog (single or multi-part) */}
      <GenerateConsentDialog
        consent={consent}
        onClose={() => setConsent(null)}
        onSkipSessionChange={(skip) =>
          setConsent((prev) => (prev ? { ...prev, skipSession: skip } : prev))
        }
        onConfirmSend={handleConfirmSend}
      />
    </div>
  );
}
