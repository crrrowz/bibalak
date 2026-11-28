import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, FolderOpen, X } from "lucide-react";
import type {
  DeckSummary,
  DuplicatePolicy,
  TextColumnTarget,
  TextImportDelimiter,
  TextImportFormat,
  TextImportOptions,
  TextImportSummary,
} from "@bibalak/ipc-types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { errorMessage, ipc } from "@/lib/ipc";
import { platform } from "@/lib/platform";
import { queryKeys } from "@/lib/queryKeys";
import { formatNumber, t } from "@/lib/i18n";

function targetToSelectValue(target: TextColumnTarget | undefined): string {
  if (!target || target.kind === "ignore") return "ignore";
  if (target.kind === "tags") return "tags";
  return `field:${target.ord}`;
}

function selectValueToTarget(value: string): TextColumnTarget {
  if (value === "tags") return { kind: "tags" };
  if (value.startsWith("field:")) {
    const ord = Number(value.slice("field:".length));
    if (Number.isInteger(ord) && ord >= 0) return { kind: "field", ord };
  }
  return { kind: "ignore" };
}

function defaultMappingForColumns(columns: string[], fieldCount: number): TextColumnTarget[] {
  let nextOrd = 0;
  return columns.map((name) => {
    const lower = name.trim().toLowerCase();
    if (lower === "tags" || lower === "tag" || lower === "الوسوم") {
      return { kind: "tags" };
    }
    if (nextOrd < fieldCount) {
      const ord = nextOrd;
      nextOrd += 1;
      return { kind: "field", ord };
    }
    return { kind: "ignore" };
  });
}

export function TextImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [options, setOptions] = useState<TextImportOptions>({
    format: "auto",
    delimiter: "auto",
    has_header: true,
    allow_html: true,
  });
  const [duplicatePolicy, setDuplicatePolicy] = useState<DuplicatePolicy>("skip");
  const [deckId, setDeckId] = useState<number | null>(null);
  const [notetypeId, setNotetypeId] = useState<number | null>(null);
  const [defaultTags, setDefaultTags] = useState("");
  const [columnTargets, setColumnTargets] = useState<TextColumnTarget[]>([]);
  const [result, setResult] = useState<TextImportSummary | null>(null);

  useEffect(() => {
    if (!open) {
      setResult(null);
    }
  }, [open]);

  const decksQuery = useQuery({
    queryKey: queryKeys.decks,
    queryFn: ipc.listDecks,
    enabled: open,
  });
  const notetypesQuery = useQuery({
    queryKey: queryKeys.notetypesAll,
    queryFn: ipc.listNotetypes,
    enabled: open,
  });

  const nonFilteredDecks = useMemo(
    () => (decksQuery.data ?? []).filter((d: DeckSummary) => !d.is_filtered),
    [decksQuery.data],
  );
  const notetypes = notetypesQuery.data ?? [];

  const effectiveDeckId =
    deckId !== null && nonFilteredDecks.some((d) => d.id === deckId)
      ? deckId
      : (nonFilteredDecks[0]?.id ?? null);
  const effectiveNotetypeId =
    notetypeId !== null && notetypes.some((n) => n.id === notetypeId)
      ? notetypeId
      : (notetypes[0]?.id ?? null);

  const notetypeDetailQuery = useQuery({
    queryKey: queryKeys.notetypesDetail(effectiveNotetypeId),
    queryFn: () => ipc.getNotetype(effectiveNotetypeId!),
    enabled: open && effectiveNotetypeId !== null,
  });
  const fields = notetypeDetailQuery.data?.fields ?? [];

  const previewQuery = useQuery({
    queryKey: queryKeys.textImportPreview(filePath, options),
    queryFn: () => ipc.previewTextImport(filePath!, options),
    enabled: open && filePath !== null,
  });

  const columnsKey = (previewQuery.data?.columns ?? []).join("\u001f");
  useEffect(() => {
    const cols = previewQuery.data?.columns ?? [];
    if (cols.length > 0 && fields.length > 0) {
      setColumnTargets(defaultMappingForColumns(cols, fields.length));
    } else if (cols.length > 0) {
      setColumnTargets(cols.map(() => ({ kind: "ignore" })));
    }
    // Re-seed default mapping whenever file columns or target field count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnsKey, fields.length]);

  const importMut = useMutation({
    mutationFn: () =>
      ipc.importText(filePath!, {
        deck_id: effectiveDeckId!,
        notetype_id: effectiveNotetypeId!,
        duplicate_policy: duplicatePolicy,
        columns: columnTargets,
        default_tags: defaultTags
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean),
        options,
      }),
    onSuccess: (summary) => {
      setResult(summary);
      onImported();
    },
  });

  async function chooseFile() {
    const picked = await platform.pickPath({
      filters: [
        {
          name: t("dialog.textImportFile"),
          extensions: ["csv", "tsv", "txt", "md", "markdown"],
        },
      ],
    });
    if (picked !== null) {
      setResult(null);
      setFilePath(picked);
    }
  }

  const preview = previewQuery.data;
  const effectiveFormat: TextImportFormat =
    options.format === "auto" ? (preview?.detected_format ?? "csv") : options.format;
  const isMarkdown = effectiveFormat === "markdown";
  const firstFieldName = fields[0]?.name ?? "";
  const hasFirstFieldMapped = columnTargets.some(
    (target) => target.kind === "field" && target.ord === 0,
  );
  const missingFirstField = Boolean(preview && fields.length > 0 && !hasFirstFieldMapped);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabel={t("textImport.title")}
      className="flex max-h-[88vh] max-w-4xl flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">{t("textImport.title")}</h2>
        </div>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-6">
        {/* File picker + format options */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-secondary/20 p-3">
          <Button type="button" variant="outline" size="sm" onClick={() => void chooseFile()}>
            <FolderOpen className="size-3.5" /> {t("textImport.chooseFile")}
          </Button>
          <span className="flex-1 truncate text-xs text-muted-foreground">
            {filePath ?? t("textImport.noFile")}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <div className="space-y-1">
            <label htmlFor="ti-format" className="text-xs font-medium text-muted-foreground">
              {t("textImport.format")}
            </label>
            <Select
              id="ti-format"
              selectSize="sm"
              value={options.format}
              onChange={(e) =>
                setOptions((prev) => ({
                  ...prev,
                  format: e.target.value as TextImportFormat,
                }))
              }
            >
              <option value="auto">{t("textImport.format.auto")}</option>
              <option value="csv">{t("textImport.format.csv")}</option>
              <option value="markdown">{t("textImport.format.markdown")}</option>
            </Select>
          </div>

          {!isMarkdown && (
            <div className="space-y-1">
              <label htmlFor="ti-delim" className="text-xs font-medium text-muted-foreground">
                {t("textImport.delimiter")}
              </label>
              <Select
                id="ti-delim"
                selectSize="sm"
                value={options.delimiter}
                onChange={(e) =>
                  setOptions((prev) => ({
                    ...prev,
                    delimiter: e.target.value as TextImportDelimiter,
                  }))
                }
              >
                <option value="auto">{t("textImport.delimiter.auto")}</option>
                <option value="comma">{t("textImport.delimiter.comma")}</option>
                <option value="tab">{t("textImport.delimiter.tab")}</option>
                <option value="semicolon">{t("textImport.delimiter.semicolon")}</option>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="ti-deck" className="text-xs font-medium text-muted-foreground">
              {t("textImport.deck")}
            </label>
            <Select
              id="ti-deck"
              selectSize="sm"
              value={effectiveDeckId ?? ""}
              onChange={(e) => setDeckId(Number(e.target.value))}
            >
              {nonFilteredDecks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <label htmlFor="ti-notetype" className="text-xs font-medium text-muted-foreground">
              {t("textImport.notetype")}
            </label>
            <Select
              id="ti-notetype"
              selectSize="sm"
              value={effectiveNotetypeId ?? ""}
              onChange={(e) => setNotetypeId(Number(e.target.value))}
            >
              {notetypes.map((nt) => (
                <option key={nt.id} value={nt.id}>
                  {nt.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <label htmlFor="ti-dups" className="text-xs font-medium text-muted-foreground">
              {t("textImport.duplicates")}
            </label>
            <Select
              id="ti-dups"
              selectSize="sm"
              value={duplicatePolicy}
              onChange={(e) => setDuplicatePolicy(e.target.value as DuplicatePolicy)}
            >
              <option value="skip">{t("textImport.duplicates.skip")}</option>
              <option value="update">{t("textImport.duplicates.update")}</option>
              <option value="keep-both">{t("textImport.duplicates.keepBoth")}</option>
            </Select>
          </div>

          <div className="space-y-1 sm:col-span-2">
            <label htmlFor="ti-tags" className="text-xs font-medium text-muted-foreground">
              {t("textImport.defaultTags")}
            </label>
            <input
              id="ti-tags"
              value={defaultTags}
              onChange={(e) => setDefaultTags(e.target.value)}
              placeholder={t("browse.tagsPlaceholder")}
              className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-5">
          {!isMarkdown && (
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={options.has_header}
                onChange={(e) => setOptions((prev) => ({ ...prev, has_header: e.target.checked }))}
              />
              <span>{t("textImport.hasHeader")}</span>
            </label>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={options.allow_html}
              onChange={(e) => setOptions((prev) => ({ ...prev, allow_html: e.target.checked }))}
            />
            <span>{t("textImport.allowHtml")}</span>
          </label>
        </div>

        {previewQuery.isError && (
          <p role="alert" className="text-xs text-destructive">
            {errorMessage(previewQuery.error)}
          </p>
        )}

        {preview && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              {t("textImport.previewHeading", {
                shown: preview.rows.length,
                total: preview.total_rows,
              })}
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-secondary/40">
                  <tr>
                    {preview.columns.map((col, idx) => (
                      <th
                        key={`${idx}-${col}`}
                        className="min-w-36 border-b border-border px-3 py-2 text-start font-medium"
                      >
                        <div className="mb-1 truncate text-foreground">{col}</div>
                        <Select
                          selectSize="xs"
                          className="font-normal"
                          aria-label={t("textImport.columnMap", { column: col })}
                          value={targetToSelectValue(columnTargets[idx])}
                          onChange={(e) => {
                            const next = selectValueToTarget(e.target.value);
                            setColumnTargets((prev) => {
                              const copy = [...prev];
                              copy[idx] = next;
                              return copy;
                            });
                          }}
                        >
                          {fields.map((f, fIdx) => (
                            <option key={String(f.ord)} value={`field:${fIdx}`}>
                              {t("textImport.field", { name: f.name })}
                            </option>
                          ))}
                          <option value="tags">{t("textImport.tags")}</option>
                          <option value="ignore">{t("textImport.ignore")}</option>
                        </Select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="border-b border-border/50 last:border-b-0">
                      {preview.columns.map((_, cIdx) => (
                        <td
                          key={cIdx}
                          className="max-w-xs truncate px-3 py-1.5 text-start text-muted-foreground"
                        >
                          {row[cIdx] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {importMut.isError && (
          <p role="alert" className="text-xs text-destructive">
            {errorMessage(importMut.error)}
          </p>
        )}

        {result && (
          <div className="space-y-2 rounded-lg border border-border bg-secondary/30 p-3 text-xs">
            <p className="font-medium">
              {t("textImport.summaryResult", {
                added: formatNumber(result.notes_added),
                cards: formatNumber(result.cards_added),
                updated: formatNumber(result.notes_updated),
                skipped: formatNumber(result.notes_skipped),
              })}
            </p>
            {result.errors.length > 0 && (
              <div className="space-y-1 text-destructive">
                <div className="font-medium">
                  {t("textImport.errorsHeading", { count: formatNumber(result.errors.length) })}
                </div>
                <ul className="max-h-24 list-disc overflow-y-auto ps-4">
                  {result.errors.map((err, i) => (
                    <li key={i}>
                      {t("textImport.lineNumber", { line: formatNumber(err.line) })}: {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
        <div className="space-y-0.5 text-xs">
          <p className="text-muted-foreground">{t("textImport.cannotUndoNotice")}</p>
          {missingFirstField && (
            <p role="status" className="text-destructive">
              {t("textImport.firstFieldRequired", { field: firstFieldName })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={
              importMut.isPending ||
              filePath === null ||
              effectiveDeckId === null ||
              effectiveNotetypeId === null ||
              !preview ||
              missingFirstField
            }
            onClick={() => importMut.mutate()}
          >
            {importMut.isPending ? t("textImport.importing") : t("textImport.import")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
