import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, PlusCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FieldEditor } from "@/components/FieldEditor";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { useActiveFieldEditor } from "@/components/editor/useActiveFieldEditor";
import { maxClozeIndex } from "@/lib/clozeUtils";
import { errorMessage, ipc, isTauri } from "@/lib/ipc";
import { platform } from "@/lib/platform";
import { queryKeys } from "@/lib/queryKeys";
import { t, tn } from "@/lib/i18n";
import {
  partitionFieldsByTemplates,
  readMoreFieldsExpanded,
  writeMoreFieldsExpanded,
} from "@/lib/noteFieldGroups";
import { useNoteComposer } from "@/hooks/useNoteComposer";

function hideWindow() {
  if (platform.window) {
    void platform.window.hide();
  } else {
    void ipc.hideQuickAdd();
  }
}

export function QuickAddScreen() {
  const tauri = isTauri();
  const { activeEditor, onFocusEditor, onDestroyEditor } = useActiveFieldEditor();
  const cfgQuery = useQuery({
    queryKey: queryKeys.quickAddConfig,
    queryFn: ipc.getQuickAddConfig,
    enabled: tauri,
  });

  const composer = useNoteComposer({
    enabled: tauri,
    preferredDeckId: cfgQuery.data?.last_deck_id ?? null,
    preferredNotetypeId: cfgQuery.data?.last_notetype_id ?? null,
    onSelectDeck: (deckId) => {
      void ipc.rememberQuickAddTarget(deckId, null);
    },
    onSelectNotetype: (notetypeId) => {
      void ipc.rememberQuickAddTarget(null, notetypeId);
    },
  });

  const moreRegionId = useId();
  const [moreExpanded, setMoreExpanded] = useState(() =>
    readMoreFieldsExpanded(composer.notetypeId),
  );
  useEffect(() => {
    setMoreExpanded(readMoreFieldsExpanded(composer.notetypeId));
  }, [composer.notetypeId]);

  const fieldNames = composer.selectedNotetype?.field_names ?? [];
  const { primary: primaryIndices, extra: extraIndices } = useMemo(
    () => partitionFieldsByTemplates(fieldNames, composer.notetypeDetail.data?.templates),
    [fieldNames, composer.notetypeDetail.data?.templates],
  );

  const toggleMoreFields = () => {
    setMoreExpanded((prev) => {
      const next = !prev;
      writeMoreFieldsExpanded(composer.notetypeId, next);
      return next;
    });
  };

  const renderFieldBlock = (index: number, isFirstPrimary: boolean) => {
    const name = fieldNames[index] ?? "";
    const fieldId = `quick-add-field-${index}`;
    const labelId = `quick-add-field-label-${index}`;
    const hintId = `quick-add-field-hint-${index}`;
    const options = composer.notetypeDetail.data?.fields[index]?.options;
    const hint = options?.description?.trim() ?? "";
    return (
      <div key={`${composer.notetypeId}:${name}:${composer.formVersion}`} className="space-y-1">
        <label id={labelId} htmlFor={fieldId} className="text-xs font-medium">
          {name}
        </label>
        <FieldEditor
          id={fieldId}
          ariaLabelledBy={labelId}
          ariaDescribedBy={hint ? hintId : undefined}
          value={composer.fields[index] ?? ""}
          otherFieldsHtml={composer.fields.filter((_, i) => i !== index)}
          autoFocus={isFirstPrimary}
          onFocusEditor={onFocusEditor}
          onDestroyEditor={onDestroyEditor}
          options={options}
          onCtrlEnter={() => {
            if (!composer.add.isPending) composer.add.mutate();
          }}
          onChange={(html) => composer.setField(index, html)}
        />
        {hint && (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
        {index === 0 && composer.duplicateWarning && (
          <p className="text-xs font-medium text-amber-500">{t("add.duplicateWarning")}</p>
        )}
      </div>
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hideWindow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* Slim draggable chrome header */}
      <header
        data-tauri-drag-region
        className="glass-chrome flex h-10 shrink-0 items-center justify-between border-b border-border px-4"
      >
        <span data-tauri-drag-region className="text-sm font-semibold">
          {t("quickAdd.title")}
        </span>
        <button
          type="button"
          onClick={hideWindow}
          aria-label={t("quickAdd.hide")}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="quick-add-notetype" className="text-xs font-medium">
              {t("add.notetype")}
            </label>
            <Select
              id="quick-add-notetype"
              selectSize="sm"
              className="text-sm"
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

          <div className="space-y-1">
            <label htmlFor="quick-add-deck" className="text-xs font-medium">
              {t("browse.col.deck")}
            </label>
            <Select
              id="quick-add-deck"
              selectSize="sm"
              className="text-sm"
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

        {(composer.selectedNotetype?.field_names ?? []).length > 0 && (
          <div className="sticky top-0 z-10 bg-background/95 py-1 backdrop-blur">
            <EditorToolbar
              editor={activeEditor}
              nextClozeIndex={maxClozeIndex(composer.fields) + 1}
            />
          </div>
        )}

        {primaryIndices.map((index, pos) => renderFieldBlock(index, pos === 0))}

        {extraIndices.length > 0 && (
          <div className="space-y-2.5 rounded-lg border border-border/70 bg-card/40 p-2.5">
            <button
              type="button"
              aria-expanded={moreExpanded}
              aria-controls={moreRegionId}
              onClick={toggleMoreFields}
              className="flex w-full items-center justify-between text-start text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              <span>
                {moreExpanded ? t("add.hideMoreFields") : tn("add.moreFields", extraIndices.length)}
              </span>
              <ChevronDown
                className={`size-4 transition-transform ${moreExpanded ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
            {moreExpanded && (
              <div id={moreRegionId} className="space-y-2.5">
                {extraIndices.map((index) => renderFieldBlock(index, false))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor="quick-add-tags" className="text-xs font-medium">
            {t("browse.tags")}
          </label>
          <input
            id="quick-add-tags"
            value={composer.tags}
            onChange={(e) => composer.setTags(e.target.value)}
            placeholder={t("browse.tagsPlaceholder")}
            list="quick-add-tags-suggestions"
            className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <datalist id="quick-add-tags-suggestions">
            {(composer.tagsQuery.data ?? []).map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </div>

        {composer.add.isError && (
          <p role="alert" className="text-xs text-destructive">
            {errorMessage(composer.add.error)}
          </p>
        )}
        {composer.lastResult && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {composer.lastResult}
          </p>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2.5">
        <span className="text-xs text-muted-foreground">{t("quickAdd.hint")}</span>
        <Button size="sm" onClick={() => composer.add.mutate()} disabled={composer.add.isPending}>
          <PlusCircle className="me-1.5 size-3.5" />
          {composer.add.isPending ? t("add.adding") : t("add.title")}
        </Button>
      </footer>
    </div>
  );
}
