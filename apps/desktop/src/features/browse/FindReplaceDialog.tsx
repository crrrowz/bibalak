import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { t, tn } from "@/lib/i18n";
import { ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { DialogFrame } from "./DialogFrame";

export function FindReplaceDialog({
  open,
  noteIds,
  notetypeNames,
  onClose,
  onDone,
}: {
  open: boolean;
  noteIds: number[];
  notetypeNames?: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const tauri = isTauri();
  const [fieldName, setFieldName] = useState("");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [includeHtml, setIncludeHtml] = useState(false);

  const notetypesQuery = useQuery({
    queryKey: queryKeys.notetypesAll,
    queryFn: ipc.listNotetypes,
    enabled: open && tauri,
  });

  const hasExplicitTypes = Boolean(notetypeNames && notetypeNames.length > 0);
  const noteTypesFromNotesQuery = useQuery({
    queryKey: queryKeys.noteNotetypesForIds(noteIds),
    queryFn: async () => {
      if (typeof ipc.getNote !== "function") return [];
      const uniqueIds = [...new Set(noteIds)].slice(0, 100);
      const details = await Promise.all(uniqueIds.map((id) => ipc.getNote(id).catch(() => null)));
      return [...new Set(details.flatMap((n) => (n ? [n.notetype_name] : [])))];
    },
    enabled: open && tauri && noteIds.length > 0 && !hasExplicitTypes,
  });

  const activeTypeNames = new Set(
    hasExplicitTypes ? notetypeNames : (noteTypesFromNotesQuery.data ?? []),
  );
  const availableFields = [
    ...new Set(
      (notetypesQuery.data ?? [])
        .filter((nt) => activeTypeNames.has(nt.name))
        .flatMap((nt) => nt.field_names),
    ),
  ];

  const previewMut = useMutation({
    mutationFn: () =>
      ipc.previewFindReplace(
        noteIds,
        fieldName === "" ? null : fieldName,
        find,
        useRegex,
        caseSensitive,
        replace,
        includeHtml,
      ),
  });

  const applyMut = useMutation({
    mutationFn: () =>
      ipc.findReplaceNotes(
        noteIds,
        fieldName === "" ? null : fieldName,
        find,
        replace,
        useRegex,
        caseSensitive,
        includeHtml,
      ),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  useEffect(() => {
    if (open) {
      setFieldName("");
      setFind("");
      setReplace("");
      setUseRegex(false);
      setCaseSensitive(false);
      setIncludeHtml(false);
      previewMut.reset();
      applyMut.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const errorMessage = previewMut.isError
    ? String((previewMut.error as Error).message)
    : applyMut.isError
      ? String((applyMut.error as Error).message)
      : null;

  return (
    <DialogFrame open={open} title={t("browse.findReplace.title")} onClose={onClose}>
      <h2 className="mb-2 text-base font-semibold">{t("browse.findReplace.title")}</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {tn("browse.findReplace.description", noteIds.length)}
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          applyMut.mutate();
        }}
      >
        <div>
          <label htmlFor="find-replace-field" className="mb-1 block text-xs font-medium">
            {t("browse.findReplace.fieldLabel")}
          </label>
          <Select
            id="find-replace-field"
            value={fieldName}
            onChange={(e) => {
              setFieldName(e.target.value);
              previewMut.reset();
            }}
          >
            <option value="">{t("browse.findReplace.allFields")}</option>
            {availableFields.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="find-replace-find" className="mb-1 block text-xs font-medium">
            {t("browse.findReplace.findLabel")}
          </label>
          <input
            id="find-replace-find"
            autoFocus
            value={find}
            onChange={(e) => {
              setFind(e.target.value);
              previewMut.reset();
            }}
            placeholder={t("browse.findReplace.findPlaceholder")}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label htmlFor="find-replace-replace" className="mb-1 block text-xs font-medium">
            {t("browse.findReplace.replaceLabel")}
          </label>
          <input
            id="find-replace-replace"
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            placeholder={t("browse.findReplace.replacePlaceholder")}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex flex-wrap gap-4 pt-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useRegex}
              onChange={(e) => {
                setUseRegex(e.target.checked);
                previewMut.reset();
              }}
            />
            <span>{t("browse.findReplace.regex")}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => {
                setCaseSensitive(e.target.checked);
                previewMut.reset();
              }}
            />
            <span>{t("browse.findReplace.caseSensitive")}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeHtml}
              onChange={(e) => {
                setIncludeHtml(e.target.checked);
                previewMut.reset();
              }}
            />
            <span>{t("browse.findReplace.includeHtml")}</span>
          </label>
        </div>

        {previewMut.isSuccess && previewMut.data && (
          <div className="space-y-1.5 rounded-md bg-secondary/60 px-3 py-2 text-xs text-foreground">
            <p>
              {t("browse.findReplace.previewResult", {
                occurrences: previewMut.data.occurrences,
                notes: previewMut.data.notes_matched,
              })}
            </p>
            {previewMut.data.sample_before !== null && previewMut.data.sample_after !== null && (
              <div className="space-y-1 border-t border-border/60 pt-1.5 font-mono text-[11px]">
                <div className="truncate text-muted-foreground">
                  <span className="font-semibold">{t("browse.findReplace.previewBefore")}: </span>
                  {previewMut.data.sample_before}
                </div>
                <div className="truncate text-foreground">
                  <span className="font-semibold">{t("browse.findReplace.previewAfter")}: </span>
                  {previewMut.data.sample_after}
                </div>
              </div>
            )}
          </div>
        )}
        {errorMessage && <p className="text-xs text-destructive">{errorMessage}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={applyMut.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!find || previewMut.isPending || noteIds.length === 0}
            onClick={() => previewMut.mutate()}
          >
            {t("browse.findReplace.previewBtn")}
          </Button>
          <Button type="submit" disabled={!find || applyMut.isPending || noteIds.length === 0}>
            {t("browse.findReplace.apply")}
          </Button>
        </div>
      </form>
    </DialogFrame>
  );
}
