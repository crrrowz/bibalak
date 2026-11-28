import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Check, Copy, Sparkles, X } from "lucide-react";
import type { AIActionRequest, StudyCardDto } from "@bibalak/ipc-types";
import { CardFace } from "@/components/CardFace";
import {
  AINotConfiguredContent,
  AIPreviewBody,
  AIResultBox,
  AISendingBox,
} from "@/components/ai/AIBlocks";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Kbd } from "@/components/Kbd";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAiActionRunner } from "@/hooks/useAiActionRunner";
import { buildAppendedFieldHtml } from "@/lib/aiFormat";
import { t } from "@/lib/i18n";
import { errorMessage, ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";
import { toast } from "@/stores/toast";

interface TutorPanelProps {
  card: StudyCardDto;
  sessionDeckId?: number;
  deckName: string | null;
  typedAnswer: string;
  configured: boolean;
  tauri: boolean;
  night: boolean;
  onClose: () => void;
  onSaveDialogChange?: (open: boolean) => void;
}

type TutorActionKind =
  | "explain-card"
  | "tutor-example"
  | "tutor-mnemonic"
  | "tutor-translate"
  | "tutor-why-wrong";

const TUTOR_ACTIONS: Array<{
  kind: TutorActionKind;
  labelKey:
    | "ai.action.explain"
    | "ai.tutor.example"
    | "ai.tutor.mnemonic"
    | "ai.tutor.translate"
    | "ai.tutor.whyWrong";
  titleKey:
    | "ai.explain.title"
    | "ai.tutor.exampleTitle"
    | "ai.tutor.mnemonicTitle"
    | "ai.tutor.translateTitle"
    | "ai.tutor.whyWrongTitle";
}> = [
  { kind: "explain-card", labelKey: "ai.action.explain", titleKey: "ai.explain.title" },
  { kind: "tutor-example", labelKey: "ai.tutor.example", titleKey: "ai.tutor.exampleTitle" },
  { kind: "tutor-mnemonic", labelKey: "ai.tutor.mnemonic", titleKey: "ai.tutor.mnemonicTitle" },
  { kind: "tutor-translate", labelKey: "ai.tutor.translate", titleKey: "ai.tutor.translateTitle" },
  { kind: "tutor-why-wrong", labelKey: "ai.tutor.whyWrong", titleKey: "ai.tutor.whyWrongTitle" },
];

export function TutorPanel({
  card,
  sessionDeckId,
  deckName,
  typedAnswer,
  configured,
  tauri,
  night,
  onClose,
  onSaveDialogChange,
}: TutorPanelProps) {
  const navigate = useOptionalNavigate();
  const queryClient = useQueryClient();
  const runner = useAiActionRunner(configured);
  const { reset } = runner;

  const [copied, setCopied] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [fieldIndex, setFieldIndex] = useState(1);

  useEffect(() => {
    reset();
    setCopied(false);
    setSaveOpen(false);
  }, [card.card_id, reset]);

  useEffect(() => {
    onSaveDialogChange?.(saveOpen);
  }, [saveOpen, onSaveDialogChange]);

  const noteQuery = useQuery({
    queryKey: queryKeys.notesDetail(card.note_id),
    queryFn: () => ipc.getNote(card.note_id),
    enabled: saveOpen && card.note_id > 0,
  });

  useEffect(() => {
    const fields = noteQuery.data?.fields;
    if (!fields || fields.length === 0) return;
    // Prefer Back / Back Extra over the first prompt field so saved tutor notes stay below the cue.
    const backIdx = fields.findIndex((f) => /^back(\s+extra)?$/i.test(f.name.trim()));
    if (backIdx >= 0) {
      setFieldIndex(backIdx);
    } else {
      setFieldIndex(fields.length > 1 ? 1 : 0);
    }
  }, [noteQuery.data]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const note = noteQuery.data;
      if (!note || !runner.result?.text) {
        throw new Error(t("ai.tutor.noNoteError"));
      }
      const target = note.fields[fieldIndex] ?? note.fields[0];
      if (!target) throw new Error(t("ai.tutor.noNoteError"));
      const nextHtml = buildAppendedFieldHtml(target.value, runner.result.text);
      const nextFields = note.fields.map((f, idx) => (idx === fieldIndex ? nextHtml : f.value));
      await ipc.saveNote(note.note_id, nextFields, note.tags);
      return target.name;
    },
    onSuccess: (fieldName) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notesDetail(card.note_id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.undoStatus });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.queue(String(sessionDeckId ?? card.deck_id)),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.queue(String(card.deck_id)) });
      toast.success(t("ai.tutor.savedToast", { field: fieldName }));
      setSaveOpen(false);
    },
  });

  const buildRequest = (kind: TutorActionKind): AIActionRequest => {
    switch (kind) {
      case "explain-card":
        return {
          kind: "explain-card",
          front_html: card.question,
          back_html: card.answer,
          deck_name: deckName,
        };
      case "tutor-example":
        return {
          kind: "tutor-example",
          front_html: card.question,
          back_html: card.answer,
          deck_name: deckName,
        };
      case "tutor-mnemonic":
        return {
          kind: "tutor-mnemonic",
          front_html: card.question,
          back_html: card.answer,
          deck_name: deckName,
        };
      case "tutor-translate":
        return {
          kind: "tutor-translate",
          front_html: card.question,
          back_html: card.answer,
          deck_name: deckName,
        };
      case "tutor-why-wrong":
        return {
          kind: "tutor-why-wrong",
          front_html: card.question,
          back_html: card.answer,
          typed_answer: typedAnswer.trim() ? typedAnswer.trim() : null,
          deck_name: deckName,
        };
    }
  };

  const activeTitle = useMemo(() => {
    const def = TUTOR_ACTIONS.find((a) => a.kind === runner.activeAction?.kind);
    return def ? t(def.titleKey) : t("ai.tutor.title");
  }, [runner.activeAction]);

  const previewModalOpen =
    runner.phase === "not-configured" ||
    runner.phase === "loading-preview" ||
    runner.phase === "preview";

  const selectedField = noteQuery.data?.fields[fieldIndex] ?? noteQuery.data?.fields[0] ?? null;
  const appendedPreviewHtml = useMemo(() => {
    if (!selectedField || !runner.result?.text) return "";
    return buildAppendedFieldHtml(selectedField.value, runner.result.text);
  }, [selectedField, runner.result]);

  const handleCopy = async () => {
    if (!runner.result?.text) return;
    try {
      await navigator.clipboard?.writeText(runner.result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable in headless environments; ignore silently.
    }
  };

  const handleSetupAI = () => {
    runner.cancel();
    navigate?.("/assistant");
  };

  return (
    <section
      aria-label={t("ai.tutor.title")}
      className="mt-3 max-h-[38vh] space-y-3 overflow-y-auto rounded-[14px] border border-border bg-card p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Sparkles className="size-3.5 text-primary" aria-hidden />
          <span>{t("ai.tutor.title")}</span>
          <Kbd>T</Kbd>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          onClick={onClose}
          aria-label={t("ai.tutor.closeLabel")}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TUTOR_ACTIONS.map((item) => {
          const isActive = runner.activeAction?.kind === item.kind && runner.phase !== "idle";
          return (
            <Button
              key={item.kind}
              type="button"
              size="sm"
              variant={isActive ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              disabled={runner.phase === "sending"}
              onClick={() => {
                setCopied(false);
                runner.trigger(buildRequest(item.kind));
              }}
            >
              {t(item.labelKey)}
            </Button>
          );
        })}
      </div>

      {runner.phase === "sending" && (
        <div className="space-y-2">
          <AISendingBox />
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="ghost" onClick={runner.cancel}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      {runner.phase === "error" && runner.error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          <span>{runner.error.message}</span>
          {runner.error.kind === "not-configured" ? (
            <Button type="button" size="sm" onClick={handleSetupAI}>
              {t("ai.notConfigured.setupButton")}
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={runner.retry}>
              {t("common.retry")}
            </Button>
          )}
        </div>
      )}

      {runner.phase === "result" && runner.result && (
        <div className="space-y-2">
          <AIResultBox result={runner.result} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void handleCopy()}>
              {copied ? (
                <>
                  <Check className="me-1.5 size-3.5 text-emerald-600" aria-hidden />
                  {t("ai.tutor.copied")}
                </>
              ) : (
                <>
                  <Copy className="me-1.5 size-3.5" aria-hidden />
                  {t("ai.tutor.copy")}
                </>
              )}
            </Button>
            {card.note_id > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={() => setSaveOpen(true)}>
                <BookmarkPlus className="me-1.5 size-3.5" aria-hidden />
                {t("ai.tutor.saveToField")}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Consent preview & not-configured modal reusing AI0 layout */}
      <Dialog
        open={previewModalOpen}
        onClose={runner.cancel}
        ariaLabel={activeTitle}
        className="flex max-h-[85vh] max-w-lg flex-col rounded-[14px] p-6"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden />
            <h2 className="text-base font-semibold">{activeTitle}</h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={runner.cancel}
            aria-label={t("common.close")}
          >
            <X className="size-4" />
          </Button>
        </div>

        {runner.phase === "not-configured" ? (
          <AINotConfiguredContent onCancel={runner.cancel} onSetup={handleSetupAI} />
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">{t("ai.plainTextNotice")}</p>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pe-1">
              {runner.phase === "loading-preview" && (
                <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                  <Spinner />
                  <span>{t("ai.loadingPreview")}</span>
                </div>
              )}

              {runner.phase === "preview" && runner.preview && (
                <>
                  <AIPreviewBody preview={runner.preview} />
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={runner.skipSession}
                      onChange={(e) => runner.setSkipSession(e.target.checked)}
                      className="size-3.5 accent-primary"
                    />
                    <span>{t("ai.dontAskSession")}</span>
                  </label>
                </>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={runner.cancel}>
                {t("common.cancel")}
              </Button>
              {runner.phase === "preview" && (
                <Button type="button" size="sm" onClick={runner.confirmSend}>
                  {t("ai.send")}
                </Button>
              )}
            </div>
          </>
        )}
      </Dialog>

      {/* Save-to-field preview modal (sandboxed CardFace preview, appends via <br><br>) */}
      <Dialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        ariaLabel={t("ai.tutor.saveTitle")}
        className="flex max-h-[85vh] max-w-lg flex-col rounded-[14px] p-6"
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookmarkPlus className="size-4 text-primary" aria-hidden />
            <h2 className="text-base font-semibold">{t("ai.tutor.saveTitle")}</h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setSaveOpen(false)}
            aria-label={t("common.close")}
          >
            <X className="size-4" />
          </Button>
        </div>

        <p className="mb-3 text-xs text-muted-foreground">{t("ai.tutor.saveHint")}</p>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pe-1">
          {noteQuery.isLoading && (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
              <Spinner />
              <span>{t("common.loading")}</span>
            </div>
          )}

          {noteQuery.isError && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
            >
              {t("ai.tutor.noNoteError")}
            </div>
          )}

          {noteQuery.data && (
            <>
              <div className="space-y-1.5">
                <label htmlFor="tutor-target-field" className="text-xs font-medium text-foreground">
                  {t("ai.tutor.fieldLabel")}
                </label>
                <Select
                  id="tutor-target-field"
                  value={fieldIndex}
                  onChange={(e) => setFieldIndex(Number(e.target.value))}
                >
                  {noteQuery.data.fields.map((f, idx) => (
                    <option key={`${idx}-${f.name}`} value={idx}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">
                  {t("ai.tutor.previewAfter")}
                </div>
                <div className="overflow-hidden rounded-xl border border-border bg-background p-2">
                  <CardFace
                    html={appendedPreviewHtml}
                    css={card.css}
                    tauri={tauri}
                    night={night}
                    className="h-36 w-full border-0"
                  />
                </div>
              </div>
            </>
          )}

          {saveMut.isError && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
            >
              {errorMessage(saveMut.error)}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setSaveOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!noteQuery.data || !runner.result?.text || saveMut.isPending}
            onClick={() => saveMut.mutate()}
          >
            {saveMut.isPending ? (
              <>
                <Spinner className="me-1.5" />
                {t("ai.tutor.saving")}
              </>
            ) : (
              t("ai.tutor.saveConfirm")
            )}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
