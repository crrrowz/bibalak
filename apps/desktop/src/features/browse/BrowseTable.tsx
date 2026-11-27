import type { RefObject } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Flag,
  Layers,
  Search,
} from "lucide-react";
import type { CardRow, NoteRow } from "@bibalak/ipc-types";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  FLAG_COLORS,
  QUEUE_LABELS,
  formatDue,
  plain,
  type SortKey,
} from "@/features/browse/browseHelpers";
import type { BrowseMode, CardColumnId, ColumnDef, NoteColumnId } from "@/lib/browseColumns";
import { formatDate, formatNumber, t } from "@/lib/i18n";

interface BrowseTableProps {
  tauri: boolean;
  mode: BrowseMode;
  rows: CardRow[];
  noteRows: NoteRow[];
  currentRows: Array<CardRow | NoteRow>;
  submitted: string;
  selected: Set<number>;
  lastClickIdx: number | null;
  activeCardCols: Array<ColumnDef<CardColumnId>>;
  activeNoteCols: Array<ColumnDef<NoteColumnId>>;
  sortKey: SortKey;
  sortAsc: boolean;
  today: number;
  offset: number;
  pageSize: number;
  pageSizes: readonly number[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  canPrev: boolean;
  canNext: boolean;
  isFetching: boolean;
  tableScrollRef: RefObject<HTMLDivElement | null>;
  paddingTop: number;
  paddingBottom: number;
  virtualItems: VirtualItem[];
  onSelectAll: (checked: boolean) => void;
  onToggleSort: (key: SortKey) => void;
  onRowClick: (row: CardRow | NoteRow, idx: number, e: React.MouseEvent) => void;
  onToggleRow: (id: number, checked: boolean) => void;
  onChangePageSize: (size: number) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
}

function renderCardCell(colId: CardColumnId, row: CardRow, today: number) {
  switch (colId) {
    case "sort_field":
      return (
        <td key={colId} className="max-w-xs truncate px-3 py-1.5 font-medium">
          {plain(row.sort_field) || t("browse.empty")}
        </td>
      );
    case "deck":
      return (
        <td key={colId} className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
          {row.deck}
        </td>
      );
    case "notetype":
      return (
        <td key={colId} className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
          {row.notetype}
        </td>
      );
    case "queue": {
      const known = QUEUE_LABELS[row.queue];
      const qInfo = known
        ? { text: t(known.text), cls: known.cls }
        : { text: formatNumber(row.queue), cls: "" };
      return (
        <td key={colId} className={`whitespace-nowrap px-3 py-1.5 font-medium ${qInfo.cls}`}>
          {qInfo.text}
        </td>
      );
    }
    case "due": {
      const isNew = row.card_type === 0 || (row.queue === 0 && row.due < 1000000);
      const dueText = formatDue(row, today);
      return (
        <td
          key={colId}
          className="whitespace-nowrap px-3 py-1.5 text-muted-foreground tabular-nums"
        >
          {isNew ? <span dir="ltr">{dueText}</span> : dueText}
        </td>
      );
    }
    case "interval":
      return (
        <td
          key={colId}
          className="whitespace-nowrap px-3 py-1.5 text-muted-foreground tabular-nums"
        >
          {row.interval > 0 ? t("browse.intervalDays", { n: formatNumber(row.interval) }) : "—"}
        </td>
      );
    case "lapses":
      return (
        <td
          key={colId}
          className="whitespace-nowrap px-3 py-1.5 text-muted-foreground tabular-nums"
        >
          {formatNumber(row.lapses)}
        </td>
      );
    case "reps":
      return (
        <td
          key={colId}
          className="whitespace-nowrap px-3 py-1.5 text-muted-foreground tabular-nums"
        >
          {formatNumber(row.reps)}
        </td>
      );
    case "tags":
      return (
        <td key={colId} className="max-w-xs px-3 py-1.5">
          <span className="line-clamp-1 text-xs text-muted-foreground">{row.tags.join(" ")}</span>
        </td>
      );
  }
}

function renderNoteCell(colId: NoteColumnId, row: NoteRow) {
  switch (colId) {
    case "sort_field":
      return (
        <td key={colId} className="max-w-xs truncate px-3 py-1.5 font-medium">
          {plain(row.sort_field) || t("browse.empty")}
        </td>
      );
    case "notetype":
      return (
        <td key={colId} className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
          {row.notetype}
        </td>
      );
    case "deck":
      return (
        <td key={colId} className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
          {row.deck}
        </td>
      );
    case "cards":
      return (
        <td
          key={colId}
          className="whitespace-nowrap px-3 py-1.5 text-muted-foreground tabular-nums"
        >
          {formatNumber(row.card_count)}
        </td>
      );
    case "tags":
      return (
        <td key={colId} className="max-w-xs px-3 py-1.5">
          <span className="line-clamp-1 text-xs text-muted-foreground">{row.tags.join(" ")}</span>
        </td>
      );
    case "modified":
      return (
        <td
          key={colId}
          className="whitespace-nowrap px-3 py-1.5 text-muted-foreground tabular-nums"
        >
          {formatDate(row.mod_ms)}
        </td>
      );
  }
}

/** Virtualized sortable card/note results table in Browse. */
export function BrowseTable({
  tauri,
  mode,
  rows,
  noteRows,
  currentRows,
  submitted,
  selected,
  lastClickIdx,
  activeCardCols,
  activeNoteCols,
  sortKey,
  sortAsc,
  today,
  offset,
  pageSize,
  pageSizes,
  totalCount,
  currentPage,
  totalPages,
  canPrev,
  canNext,
  isFetching,
  tableScrollRef,
  paddingTop,
  paddingBottom,
  virtualItems,
  onSelectAll,
  onToggleSort,
  onRowClick,
  onToggleRow,
  onChangePageSize,
  onPrevPage,
  onNextPage,
}: BrowseTableProps) {
  const colSpan = mode === "cards" ? activeCardCols.length + 2 : activeNoteCols.length + 1;
  const rangeFrom = currentRows.length === 0 ? 0 : offset + 1;
  const rangeTo = currentRows.length === 0 ? 0 : Math.min(totalCount, offset + currentRows.length);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div
        ref={tableScrollRef}
        data-testid="browse-table-scroll"
        className="min-h-0 flex-1 overflow-auto"
      >
        {!tauri ? (
          <EmptyState
            icon={Layers}
            title={t("decks.noTauri.title")}
            description={t("browse.noTauri.description")}
          />
        ) : currentRows.length === 0 && submitted !== "" ? (
          <EmptyState
            icon={Search}
            title={t("browse.noResults.title")}
            description={t("browse.noResults.description")}
          />
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-background">
              <tr>
                <th className="w-8 border-b border-border px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label={t("browse.selectAll")}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate = selected.size > 0 && selected.size < currentRows.length;
                      }
                    }}
                    checked={selected.size === currentRows.length && currentRows.length > 0}
                    onChange={(e) => onSelectAll(e.target.checked)}
                    className="cursor-pointer"
                  />
                </th>
                {mode === "cards" && <th className="w-5 border-b border-border px-1 py-2" />}
                {(mode === "cards" ? activeCardCols : activeNoteCols).map((col) =>
                  col.sortKey ? (
                    <th
                      key={col.id}
                      aria-sort={
                        sortKey === col.sortKey ? (sortAsc ? "ascending" : "descending") : "none"
                      }
                      className="select-none whitespace-nowrap border-b border-border px-3 py-2 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      <button
                        type="button"
                        onClick={() => onToggleSort(col.sortKey!)}
                        className="inline-flex w-full cursor-pointer items-center gap-1 rounded text-start uppercase tracking-wide hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {t(col.labelKey)}
                        {sortKey === col.sortKey &&
                          (sortAsc ? (
                            <ChevronUp className="size-3" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="size-3" aria-hidden="true" />
                          ))}
                      </button>
                    </th>
                  ) : (
                    <th
                      key={col.id}
                      className="border-b border-border px-3 py-2 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {t(col.labelKey)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {paddingTop > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={colSpan} style={{ height: paddingTop, padding: 0, border: 0 }} />
                </tr>
              )}
              {virtualItems.map((virtualRow) => {
                const idx = virtualRow.index;
                const row = mode === "cards" ? rows[idx] : noteRows[idx];
                if (!row) return null;
                const id = mode === "cards" ? (row as CardRow).card_id : (row as NoteRow).note_id;
                const isSelected = selected.has(id);
                const isActive = lastClickIdx === idx;
                return (
                  <tr
                    key={id}
                    data-index={idx}
                    aria-selected={isSelected}
                    onClick={(e) => onRowClick(row, idx, e)}
                    className={`cursor-pointer border-b border-border/50 hover:bg-accent/40 ${
                      isSelected ? "bg-accent" : isActive ? "bg-accent/30" : ""
                    }`}
                  >
                    <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={t("browse.selectRow")}
                        checked={isSelected}
                        onChange={(e) => onToggleRow(id, e.target.checked)}
                        className="cursor-pointer"
                      />
                    </td>
                    {mode === "cards" ? (
                      <>
                        <td className="px-1 py-1.5 text-center">
                          {(row as CardRow).flags > 0 && (
                            <Flag
                              className={`size-3.5 ${FLAG_COLORS[(row as CardRow).flags] ?? ""}`}
                            />
                          )}
                        </td>
                        {activeCardCols.map((col) => renderCardCell(col.id, row as CardRow, today))}
                      </>
                    ) : (
                      activeNoteCols.map((col) => renderNoteCell(col.id, row as NoteRow))
                    )}
                  </tr>
                );
              })}
              {paddingBottom > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={colSpan} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {tauri && (
        <footer
          data-testid="browse-paging-footer"
          aria-busy={isFetching || undefined}
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-card/60 px-4 py-2 text-xs text-muted-foreground"
        >
          <span className="tabular-nums">
            {totalCount === 0 || currentRows.length === 0
              ? t("browse.paging.empty")
              : t("browse.paging.showing", {
                  from: formatNumber(rangeFrom),
                  to: formatNumber(rangeTo),
                  total: formatNumber(totalCount),
                })}
          </span>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5">
              <span>{t("browse.paging.pageSize")}</span>
              <Select
                selectSize="xs"
                aria-label={t("browse.paging.pageSize")}
                containerClassName="w-auto"
                value={pageSize}
                onChange={(e) => onChangePageSize(Number(e.target.value))}
              >
                {pageSizes.map((sz) => (
                  <option key={sz} value={sz}>
                    {formatNumber(sz)}
                  </option>
                ))}
              </Select>
            </label>

            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                aria-label={t("browse.paging.prev")}
                disabled={!canPrev}
                onClick={onPrevPage}
              >
                <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
                <span>{t("browse.paging.prev")}</span>
              </Button>
              <span className="px-1 tabular-nums">
                {t("browse.paging.pageOf", {
                  page: formatNumber(currentPage),
                  total: formatNumber(totalPages),
                })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                aria-label={t("browse.paging.next")}
                disabled={!canNext}
                onClick={onNextPage}
              >
                <span>{t("browse.paging.next")}</span>
                <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
