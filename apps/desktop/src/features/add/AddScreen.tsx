import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { ChevronDown, PlusCircle, Sparkles } from "lucide-react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/EmptyState";
import { AIActionDialog } from "@/components/ai/AIActionDialog";
import { plainTextToEditorHtml } from "@/lib/aiFormat";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FieldEditor } from "@/components/FieldEditor";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { useActiveFieldEditor } from "@/components/editor/useActiveFieldEditor";
import { Kbd } from "@/components/Kbd";
import { OcclusionEditor } from "@/components/occlusion/OcclusionEditor";
import { maxClozeIndex } from "@/lib/clozeUtils";
import { htmlToText } from "@/lib/htmlText";
import { errorMessage, ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { t, tn } from "@/lib/i18n";
import {
  formatAddError,
  localizeStockFieldName,
  partitionFieldsByTemplates,
  readMoreFieldsExpanded,
  resolveFieldMediaKind,
  writeMoreFieldsExpanded,
} from "@/lib/noteFieldGroups";
import { modShortcut } from "@/lib/shortcuts";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";
import { isAiConfigured } from "@/stores/aiSession";
import { useUi } from "@/stores/ui";
import { useNoteComposer } from "@/hooks/useNoteComposer";

export function AddScreen() {
  const tauri = isTauri();
  const navigate = useOptionalNavigate();
  let search: { deckId?: number } = {};
  try {
    search = (useSearch as (opts: { from?: string; strict?: boolean }) => { deckId?: number })({
      strict: false,
    });
  } catch {
    // Outside router context (e.g. unit tests / preview)
  }

  const lastAddNotetypeId = useUi((s) => s.lastAddNotetypeId);
  const setLastAddNotetypeId = useUi((s) => s.setLastAddNotetypeId);
  const lastAddDeckId = useUi((s) => s.lastAddDeckId);
  const setLastAddDeckId = useUi((s) => s.setLastAddDeckId);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [aiApplyVersion, setAiApplyVersion] = useState(0);
  const { activeEditor, onFocusEditor, onDestroyEditor } = useActiveFieldEditor();

  const aiConfig = useQuery({
    queryKey: queryKeys.aiConfig,
    queryFn: async () => (await ipc.aiGetConfig()) ?? null,
    enabled: tauri,
  }).data;
  const aiConfigured = isAiConfigured(aiConfig);

  const composer = useNoteComposer({
    enabled: tauri,
    preferredDeckId: search.deckId ?? lastAddDeckId,
    preferredNotetypeId: lastAddNotetypeId,
    onSelectDeck: setLastAddDeckId,
    onSelectNotetype: setLastAddNotetypeId,
  });

  const moreRegionId = useId();
  const [moreExpanded, setMoreExpanded] = useState(() =>
    readMoreFieldsExpanded(composer.notetypeId),
  );
  useEffect(() => {
    setMoreExpanded(readMoreFieldsExpanded(composer.notetypeId));
  }, [composer.notetypeId]);

  const fieldNames = useMemo(
    () => composer.selectedNotetype?.field_names ?? [],
    [composer.selectedNotetype?.field_names],
  );
  const excludedIndices = useMemo(() => {
    const set = new Set<number>();
    if (composer.isImageOcclusion) {
      if (composer.imageFieldIdx >= 0) set.add(composer.imageFieldIdx);
      if (composer.occlusionFieldIdx >= 0) set.add(composer.occlusionFieldIdx);
    }
    return set;
  }, [composer.isImageOcclusion, composer.imageFieldIdx, composer.occlusionFieldIdx]);

  const { primary: primaryIndices, extra: extraIndices } = useMemo(
    () =>
      partitionFieldsByTemplates(
        fieldNames,
        composer.notetypeDetail.data?.templates,
        excludedIndices,
      ),
    [fieldNames, composer.notetypeDetail.data?.templates, excludedIndices],
  );

  useEffect(() => {
    if (!composer.add.isError) return;
    if (/first field cannot be empty/i.test(errorMessage(composer.add.error))) {
      if (extraIndices.includes(0)) {
        setMoreExpanded(true);
      }
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          document.getElementById("add-field-0")?.focus();
        });
      }
    }
  }, [composer.add.isError, composer.add.error, extraIndices]);

  const toggleMoreFields = () => {
    setMoreExpanded((prev) => {
      const next = !prev;
      writeMoreFieldsExpanded(composer.notetypeId, next);
      return next;
    });
  };

  const renderDuplicateNotice = () =>
    composer.duplicateWarning ? (
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-amber-500">
        <span>
          {composer.duplicateNoteTitle
            ? t("add.duplicateWarningNamed", { title: composer.duplicateNoteTitle })
            : t("add.duplicateWarning")}
        </span>
        {composer.duplicateNoteId !== null && navigate && (
          <button
            type="button"
            className="underline hover:opacity-80"
            onClick={() => navigate("/browse", { q: `nid:${composer.duplicateNoteId}` })}
          >
            {t("add.viewDuplicate")}
          </button>
        )}
      </div>
    ) : null;

  const renderFieldBlock = (index: number, isFirstPrimary: boolean) => {
    const rawName = fieldNames[index] ?? "";
    const name = localizeStockFieldName(rawName);
    const fieldId = `add-field-${index}`;
    const labelId = `add-field-label-${index}`;
    const hintId = `add-field-hint-${index}`;
    const options = composer.notetypeDetail.data?.fields[index]?.options;
    const hint = options?.description?.trim() ?? "";
    const isSortRequired = index === 0;
    const mediaKind = resolveFieldMediaKind(
      rawName,
      options,
      composer.notetypeDetail.data?.templates,
    );
    const describedByIds = [
      hint ? hintId : "",
      isSortRequired && extraIndices.includes(0) ? `${fieldId}-req` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <div
        key={`${composer.notetypeId}:${rawName}:${composer.formVersion}:${index === 1 ? aiApplyVersion : 0}`}
        className="space-y-1"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <label id={labelId} htmlFor={fieldId} className="text-sm font-medium">
              {name}
            </label>
            {isSortRequired && (
              <>
                <span aria-hidden="true" className="text-sm font-semibold text-destructive">
                  *
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {t("add.requiredBadge")}
                </span>
              </>
            )}
          </div>
          {index === 1 && !composer.isImageOcclusion && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
              disabled={aiConfigured && !htmlToText(composer.fields[0] ?? "")}
              onClick={() => setSuggestOpen(true)}
            >
              <Sparkles className="size-3.5" aria-hidden />
              {t("ai.action.suggestBack")}
            </Button>
          )}
        </div>
        <FieldEditor
          id={fieldId}
          ariaLabelledBy={labelId}
          ariaDescribedBy={describedByIds || undefined}
          value={composer.fields[index] ?? ""}
          otherFieldsHtml={composer.fields.filter((_, i) => i !== index)}
          autoFocus={isFirstPrimary}
          onFocusEditor={onFocusEditor}
          onDestroyEditor={onDestroyEditor}
          options={options}
          mediaFieldKind={mediaKind}
          onCtrlEnter={() => {
            if (!composer.add.isPending) composer.add.mutate();
          }}
          onChange={(html) => composer.setField(index, html)}
        />
        {isSortRequired && extraIndices.includes(0) && (
          <p id={`${fieldId}-req`} className="text-xs text-muted-foreground">
            {t("add.requiredSortHint", { field: name })}
          </p>
        )}
        {hint && (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
        {index === 0 && renderDuplicateNotice()}
      </div>
    );
  };

  if (!tauri) {
    return (
      <EmptyState
        icon={PlusCircle}
        title={t("decks.noTauri.title")}
        description={t("add.noTauri.description")}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title={t("add.title")}
        description={t("add.description")}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate?.("/assistant/generate")}
          >
            <Sparkles className="me-1.5 size-3.5 text-primary" aria-hidden />
            {t("ai.generate.openButton")}
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-2xl space-y-3 p-4 sm:p-5">
          {/* Notetype + Deck pickers */}
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex-1 space-y-1.5">
              <label htmlFor="add-notetype" className="text-sm font-medium">
                {t("add.notetype")}
              </label>
              <Select
                id="add-notetype"
                value={composer.notetypeId ?? ""}
                onChange={(e) => composer.handleNotetypeChange(Number(e.target.value))}
              >
                {(composer.notetypes.data ?? []).map((nt) => (
                  <option key={nt.id} value={nt.id}>
                    {nt.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex-1 space-y-1.5">
              <label htmlFor="add-deck" className="text-sm font-medium">
                {t("browse.col.deck")}
              </label>
              <Select
                id="add-deck"
                value={composer.deckId ?? ""}
                onChange={(e) => composer.handleDeckChange(Number(e.target.value))}
              >
                {(composer.decks.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* Image Occlusion notetype: draw-on-image editor for its Image + Occlusion fields. */}
          {composer.isImageOcclusion &&
            composer.imageFieldIdx >= 0 &&
            composer.occlusionFieldIdx >= 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t("add.occlusion")}</label>
                <OcclusionEditor
                  imageHtml={composer.fields[composer.imageFieldIdx] ?? ""}
                  onImageHtmlChange={(html) => composer.setField(composer.imageFieldIdx, html)}
                  occlusionHtml={composer.fields[composer.occlusionFieldIdx] ?? ""}
                  onOcclusionHtmlChange={(html) =>
                    composer.setField(composer.occlusionFieldIdx, html)
                  }
                />
              </div>
            )}

          {/* Shared formatting toolbar sticky at the top of the field list */}
          {(primaryIndices.length > 0 || extraIndices.length > 0) && (
            <div className="sticky top-0 z-10 bg-background/95 py-1 backdrop-blur">
              <EditorToolbar
                editor={activeEditor}
                nextClozeIndex={maxClozeIndex(composer.fields) + 1}
              />
            </div>
          )}

          {/* Template front/back fields first */}
          {primaryIndices.map((index, pos) => renderFieldBlock(index, pos === 0))}
          {extraIndices.includes(0) && !moreExpanded && renderDuplicateNotice()}

          {/* Remaining fields folded under "More fields" (remembered per note type) */}
          {extraIndices.length > 0 && (
            <div className="space-y-3 rounded-lg border border-border/70 bg-card/40 p-3">
              <button
                type="button"
                aria-expanded={moreExpanded}
                aria-controls={moreRegionId}
                onClick={toggleMoreFields}
                className="flex w-full items-center justify-between text-start text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                <span>
                  {moreExpanded
                    ? t("add.hideMoreFields")
                    : tn("add.moreFields", extraIndices.length)}
                </span>
                <ChevronDown
                  className={`size-4 transition-transform ${moreExpanded ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
              {moreExpanded && (
                <div id={moreRegionId} className="space-y-3">
                  {extraIndices.map((index) => renderFieldBlock(index, false))}
                </div>
              )}
            </div>
          )}

          {/* Tags */}
          <div className="space-y-1.5">
            <label htmlFor="add-tags" className="text-sm font-medium">
              {t("browse.tags")}
            </label>
            <input
              id="add-tags"
              value={composer.tags}
              onChange={(e) => composer.setTags(e.target.value)}
              placeholder={t("browse.tagsPlaceholder")}
              list="add-tags-suggestions"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <datalist id="add-tags-suggestions">
              {(composer.tagsQuery.data ?? []).map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
          </div>
        </div>
      </div>

      <footer className="sticky bottom-0 z-10 shrink-0 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-5">
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button onClick={() => composer.add.mutate()} disabled={composer.add.isPending}>
              <PlusCircle className="me-1.5 size-4" />
              {composer.add.isPending ? t("add.adding") : t("add.title")}
            </Button>
            {composer.lastResult && (
              <span className="text-sm text-muted-foreground">{composer.lastResult}</span>
            )}
            {composer.add.isError && (
              <span role="alert" className="text-sm text-destructive">
                {formatAddError(composer.add.error, localizeStockFieldName(fieldNames[0] ?? ""))}
              </span>
            )}
          </div>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span dir="ltr" className="inline-flex">
              <Kbd>{modShortcut("Enter")}</Kbd>
            </span>
            <span>{t("add.shortcutHint")}</span>
          </span>
        </div>
      </footer>

      <AIActionDialog
        open={suggestOpen}
        title={t("ai.suggestBack.title")}
        configured={aiConfigured}
        action={{
          kind: "suggest-back",
          front_html: composer.fields[0] ?? "",
          notetype_name: composer.selectedNotetype?.name ?? null,
          back_field_name: composer.selectedNotetype?.field_names[1] ?? null,
        }}
        onAccept={(res) => {
          composer.setField(1, plainTextToEditorHtml(res.text));
          setAiApplyVersion((v) => v + 1);
        }}
        onClose={() => setSuggestOpen(false)}
      />
    </div>
  );
}
