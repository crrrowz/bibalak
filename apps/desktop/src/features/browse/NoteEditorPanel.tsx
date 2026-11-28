import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Sparkles } from "lucide-react";
import type { NoteField } from "@bibalak/ipc-types";
import { AIActionDialog } from "@/components/ai/AIActionDialog";
import { FieldEditor } from "@/components/FieldEditor";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { useActiveFieldEditor } from "@/components/editor/useActiveFieldEditor";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/Kbd";
import { plainTextToEditorHtml } from "@/lib/aiFormat";
import { maxClozeIndex } from "@/lib/clozeUtils";
import { t } from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { resolveFieldMediaKind } from "@/lib/noteFieldGroups";
import { queryKeys } from "@/lib/queryKeys";
import { modShortcut } from "@/lib/shortcuts";
import { isAiConfigured } from "@/stores/aiSession";
import { toast } from "@/stores/toast";

export type SaveFn = { (): Promise<void> };

export type NoteEditorHandle = {
  isDirty(): boolean;
  save: SaveFn;
};

/** Side-panel editor for a selected note inside Browse, supporting dirty-save and AI leech rewrite. */
export const NoteEditorPanel = forwardRef<
  NoteEditorHandle,
  { noteId: number; lapses?: number; onSaved: () => void }
>(function NoteEditorPanel({ noteId, lapses, onSaved }, ref) {
  const queryClient = useQueryClient();
  const note = useQuery({
    queryKey: queryKeys.notesDetail(noteId),
    queryFn: () => ipc.getNote(noteId),
  });
  const aiConfig = useQuery({
    queryKey: queryKeys.aiConfig,
    queryFn: async () => (await ipc.aiGetConfig()) ?? null,
  }).data;
  const aiConfigured = isAiConfigured(aiConfig);

  const [fields, setFields] = useState<NoteField[]>([]);
  const [tags, setTags] = useState("");
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [aiApplyVersion, setAiApplyVersion] = useState(0);
  const { activeEditor, onFocusEditor, onDestroyEditor } = useActiveFieldEditor();
  const initialRef = useRef<{ fields: NoteField[]; tags: string } | null>(null);

  useEffect(() => {
    if (note.data) {
      setFields(note.data.fields);
      const tStr = note.data.tags.join(" ");
      setTags(tStr);
      initialRef.current = { fields: note.data.fields, tags: tStr };
    }
  }, [note.data]);

  const isDirty = () => {
    if (!initialRef.current) return false;
    if (tags !== initialRef.current.tags) return true;
    if (fields.length !== initialRef.current.fields.length) return true;
    for (let i = 0; i < fields.length; i++) {
      if (fields[i].value !== initialRef.current.fields[i].value) return true;
    }
    return false;
  };

  const saveNote = async () => {
    await ipc.saveNote(
      noteId,
      fields.map((f) => f.value),
      tags.split(/\s+/).filter(Boolean),
    );
    initialRef.current = { fields, tags };
    void queryClient.invalidateQueries({ queryKey: queryKeys.notesDetail(noteId) });
    onSaved();
  };

  useImperativeHandle(ref, () => ({
    isDirty,
    save: saveNote,
  }));

  const save = useMutation({
    mutationFn: saveNote,
    onSuccess: () => toast.success(t("browse.saved")),
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  if (!note.data) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  const dirty = isDirty();

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-auto p-4">
        <div className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span>{note.data.notetype_name}</span>
          {dirty && (
            <span
              className="inline-flex items-center gap-1 text-[11px] normal-case text-amber-600 dark:text-amber-400"
              aria-label={t("browse.unsaved")}
            >
              <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
              {t("browse.unsaved")}
            </span>
          )}
        </div>

        {fields.length > 0 && (
          <div className="sticky top-0 z-10 bg-background/95 py-1 backdrop-blur">
            <EditorToolbar
              editor={activeEditor}
              nextClozeIndex={maxClozeIndex(fields.map((f) => f.value)) + 1}
            />
          </div>
        )}

        {fields.map((field, index) => {
          const fieldId = `note-field-${index}`;
          const labelId = `note-field-label-${index}`;
          return (
            <div key={`${noteId}:${field.name}:${aiApplyVersion}`} className="space-y-1">
              <label id={labelId} htmlFor={fieldId} className="text-sm font-medium">
                {field.name}
              </label>
              <FieldEditor
                id={fieldId}
                ariaLabelledBy={labelId}
                value={field.value}
                otherFieldsHtml={fields.filter((_, i) => i !== index).map((f) => f.value)}
                onCtrlEnter={() => save.mutate()}
                onFocusEditor={onFocusEditor}
                onDestroyEditor={onDestroyEditor}
                options={field.options}
                mediaFieldKind={resolveFieldMediaKind(field.name, field.options)}
                onChange={(html) =>
                  setFields((current) =>
                    current.map((f, i) => (i === index ? { ...f, value: html } : f)),
                  )
                }
              />
            </div>
          );
        })}

        <div className="space-y-1.5">
          <label htmlFor="note-editor-tags" className="text-sm font-medium">
            {t("browse.tags")}
          </label>
          <input
            id="note-editor-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                save.mutate();
              }
            }}
            placeholder={t("browse.tagsPlaceholder")}
            className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-4 py-2.5 backdrop-blur">
        <Button
          size="sm"
          aria-label={save.isPending ? t("common.saving") : t("common.save")}
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          <Save className="size-3.5" aria-hidden="true" />
          <span>{save.isPending ? t("common.saving") : t("common.save")}</span>
          <span aria-hidden="true">
            <Kbd className="ms-1 hidden sm:inline-flex">{modShortcut("Enter")}</Kbd>
          </span>
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setRewriteOpen(true)}>
          <Sparkles className="me-1.5 size-3.5" aria-hidden />
          {t("ai.action.rewriteLeech")}
        </Button>
        {save.isSuccess && !dirty ? (
          <span className="text-xs text-muted-foreground">{t("browse.saved")}</span>
        ) : null}
        {save.isError ? (
          <span role="alert" className="text-xs text-destructive">
            {String((save.error as Error).message)}
          </span>
        ) : null}
      </div>
      <AIActionDialog
        open={rewriteOpen}
        title={t("ai.rewrite.title")}
        configured={aiConfigured}
        action={{
          kind: "rewrite-leech",
          fields: fields.map((f) => ({ name: f.name, value_html: f.value })),
          lapses: lapses ?? null,
        }}
        onAccept={(res) => {
          if (res.suggested_fields && res.suggested_fields.length === fields.length) {
            setFields((current) =>
              current.map((f, i) => ({
                ...f,
                value: plainTextToEditorHtml(res.suggested_fields![i]),
              })),
            );
            setAiApplyVersion((v) => v + 1);
          } else if (fields.length > 0) {
            const targetIdx = fields.length > 1 ? 1 : 0;
            setFields((current) =>
              current.map((f, i) =>
                i === targetIdx ? { ...f, value: plainTextToEditorHtml(res.text) } : f,
              ),
            );
            setAiApplyVersion((v) => v + 1);
          }
        }}
        onClose={() => setRewriteOpen(false)}
      />
    </div>
  );
});
