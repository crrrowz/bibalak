import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, Columns3, Copy, Search } from "lucide-react";
import type { CardRow, NoteRow } from "@bibalak/ipc-types";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  BrowseColumnsDialog,
  CardPreviewDialog,
  ChangeNotetypeDialog,
  FindDuplicatesDialog,
  FindReplaceDialog,
  ForgetCardsDialog,
  RepositionCardsDialog,
  SetDueDateDialog,
} from "@/features/browse/BrowseActionDialogs";
import {
  CARD_COLUMNS,
  DEFAULT_CARD_COLUMNS,
  DEFAULT_NOTE_COLUMNS,
  NOTE_COLUMNS,
  readBrowseMode,
  readCardColumns,
  readNoteColumns,
  writeBrowseMode,
  writeCardColumns,
  writeNoteColumns,
  type BrowseDialogKind,
  type BrowseMode,
  type CardColumnId,
  type ColumnDef,
  type NoteColumnId,
} from "@/lib/browseColumns";
import { ipc, isTauri } from "@/lib/ipc";
import { t, tn } from "@/lib/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "@/stores/toast";
import { BrowseBulkBar, type BulkActionKind } from "@/features/browse/BrowseBulkBar";
import { BrowseTable } from "@/features/browse/BrowseTable";
import { isEditingTarget, querySyntax, type SortKey } from "@/features/browse/browseHelpers";
import { NoteEditorPanel, type NoteEditorHandle } from "@/features/browse/NoteEditorPanel";
import { TagSidebar } from "@/features/browse/TagSidebar";

const BROWSE_PAGE_SIZES = [50, 100, 250, 500] as const;
type BrowsePageSize = (typeof BROWSE_PAGE_SIZES)[number];
const BROWSE_PAGE_SIZE_KEY = "keepsake-browse-page-size";

function readPageSize(): BrowsePageSize {
  if (typeof localStorage === "undefined") return 100;
  const n = Number(localStorage.getItem(BROWSE_PAGE_SIZE_KEY));
  return (BROWSE_PAGE_SIZES as readonly number[]).includes(n) ? (n as BrowsePageSize) : 100;
}

/** Card/Note Browser route coordinating search, virtualized table, sidebar tags, bulk bar, and note editor. */
export function BrowseScreen() {
  const tauri = isTauri();
  const queryClient = useQueryClient();
  const search = useSearch({ from: "/browse" });
  const navigate = useNavigate({ from: "/browse" });

  const [query, setQuery] = useState(search.q ?? "");
  const [submitted, setSubmitted] = useState(search.q ?? "");

  useEffect(() => {
    if (search.q !== undefined) {
      setQuery(search.q);
      setSubmitted(search.q);
    }
  }, [search.q]);
  const [sortKey, setSortKey] = useState<SortKey>("sort_field");
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lastClickIdx, setLastClickIdx] = useState<number | null>(null);
  const [editNoteId, setEditNoteId] = useState<number | null>(null);
  const [showSyntax, setShowSyntax] = useState(false);
  const [bulkTag, setBulkTag] = useState("");
  const [bulkAction, setBulkAction] = useState<BulkActionKind>(null);
  const [activeDialog, setActiveDialog] = useState<BrowseDialogKind>(null);
  const [confirmDeleteNotes, setConfirmDeleteNotes] = useState(false);
  const [deckFilter, setDeckFilter] = useState("");
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null);
  const bulkRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<NoteEditorHandle | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  const [mode, setMode] = useState<BrowseMode>(readBrowseMode);
  const [cardCols, setCardCols] = useState<CardColumnId[]>(readCardColumns);
  const [noteCols, setNoteCols] = useState<NoteColumnId[]>(readNoteColumns);

  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState<BrowsePageSize>(readPageSize);
  const [rows, setRows] = useState<CardRow[]>([]);
  const [noteRows, setNoteRows] = useState<NoteRow[]>([]);

  const tagsQuery = useQuery({ queryKey: queryKeys.tags, queryFn: ipc.listTags, enabled: tauri });
  const decksQuery = useQuery({
    queryKey: queryKeys.decks,
    queryFn: ipc.listDecks,
    enabled: tauri,
  });
  const availableDecks = (decksQuery.data ?? []).filter((d) => !d.is_filtered);

  const statsQuery = useQuery({
    queryKey: queryKeys.statsAll,
    queryFn: () => ipc.getStats(null, null),
    enabled: tauri,
  });

  const today = statsQuery.data
    ? Math.floor((Date.now() - statsQuery.data.day0_ms) / 86_400_000)
    : Math.floor(Date.now() / 86_400_000);

  function switchMode(next: BrowseMode) {
    if (next === mode) return;
    writeBrowseMode(next);
    setMode(next);
    setSelected(new Set());
    setLastClickIdx(null);
    setBulkAction(null);
    setOffset(0);
    setSortKey("sort_field");
    setSortAsc(true);
  }

  // New search, sort, mode, or page size change: drop back to page 1.
  useEffect(() => {
    setOffset(0);
    setSelected(new Set());
    setLastClickIdx(null);
  }, [submitted, sortKey, sortAsc, mode, pageSize]);

  const cardsCountQuery = useQuery({
    queryKey: queryKeys.cardsCount(submitted),
    queryFn: () =>
      typeof ipc.countCards === "function" ? ipc.countCards(submitted) : Promise.resolve(-1),
    enabled: tauri && mode === "cards",
  });

  const notesCountQuery = useQuery({
    queryKey: queryKeys.notesCount(submitted),
    queryFn: () =>
      typeof ipc.countNoteRows === "function" ? ipc.countNoteRows(submitted) : Promise.resolve(-1),
    enabled: tauri && mode === "notes",
  });

  const cardsQuery = useQuery({
    queryKey: queryKeys.cardsList(submitted, offset, pageSize, sortKey, sortAsc),
    queryFn: () => ipc.searchCards(submitted, offset, sortKey, sortAsc, pageSize),
    enabled: tauri && mode === "cards",
  });

  useEffect(() => {
    if (!cardsQuery.data) return;
    setRows(cardsQuery.data);
  }, [cardsQuery.data]);

  const notesQuery = useQuery({
    queryKey: queryKeys.notesList(submitted, offset, pageSize, sortKey, sortAsc),
    queryFn: () => ipc.searchNoteRows(submitted, offset, sortKey, sortAsc, pageSize),
    enabled: tauri && mode === "notes",
  });

  useEffect(() => {
    if (!notesQuery.data) return;
    setNoteRows(notesQuery.data);
  }, [notesQuery.data]);

  const invalidate = () => {
    setOffset(0);
    void queryClient.invalidateQueries({
      queryKey: mode === "cards" ? queryKeys.cardsAll : queryKeys.notesAll,
    });
  };

  const isFetching = mode === "cards" ? cardsQuery.isFetching : notesQuery.isFetching;
  const rawTotalCount = mode === "cards" ? cardsCountQuery.data : notesCountQuery.data;
  const currentPageRows = mode === "cards" ? rows : noteRows;
  const totalCount =
    rawTotalCount !== undefined && rawTotalCount >= 0
      ? rawTotalCount
      : offset + currentPageRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(totalPages, Math.floor(offset / pageSize) + 1);
  const canPrev = offset > 0;
  const canNext = offset + pageSize < totalCount;

  useEffect(() => {
    if (totalCount > 0 && offset >= totalCount) {
      setOffset(Math.max(0, (totalPages - 1) * pageSize));
    }
  }, [totalCount, offset, totalPages, pageSize]);

  function changePageSize(next: BrowsePageSize) {
    setPageSize(next);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(BROWSE_PAGE_SIZE_KEY, String(next));
    }
  }

  function goPrevPage() {
    if (!canPrev) return;
    setOffset((o) => Math.max(0, o - pageSize));
    if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
  }

  function goNextPage() {
    if (!canNext) return;
    setOffset((o) => o + pageSize);
    if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
  }

  const onMutError = (err: unknown) =>
    toast.error(err instanceof Error ? err.message : String(err));

  const deleteMut = useMutation({
    mutationFn: (noteIds: number[]) => ipc.deleteNotes(noteIds),
    onSuccess: () => {
      setSelected(new Set());
      void invalidate();
    },
    onError: onMutError,
  });

  const suspendMut = useMutation({
    mutationFn: (cardIds: number[]) => ipc.suspendCards(cardIds),
    onSuccess: () => {
      setSelected(new Set());
      void invalidate();
    },
    onError: onMutError,
  });

  const unsuspendMut = useMutation({
    mutationFn: (cardIds: number[]) => ipc.unsuspendCards(cardIds),
    onSuccess: () => {
      setSelected(new Set());
      void invalidate();
    },
    onError: onMutError,
  });

  const buryMut = useMutation({
    mutationFn: (cardIds: number[]) => ipc.buryCards(cardIds),
    onSuccess: () => {
      setSelected(new Set());
      void invalidate();
    },
    onError: onMutError,
  });

  const unburyMut = useMutation({
    mutationFn: (cardIds: number[]) => ipc.unburyCards(cardIds),
    onSuccess: () => {
      setSelected(new Set());
      void invalidate();
    },
    onError: onMutError,
  });

  const flagMut = useMutation({
    mutationFn: ({ cardIds, flag }: { cardIds: number[]; flag: number }) =>
      ipc.setCardFlag(cardIds, flag),
    onSuccess: () => {
      setBulkAction(null);
      void invalidate();
    },
    onError: onMutError,
  });

  const addTagMut = useMutation({
    mutationFn: ({ noteIds, tag }: { noteIds: number[]; tag: string }) =>
      ipc.bulkAddTag(noteIds, tag),
    onSuccess: () => {
      setBulkTag("");
      setBulkAction(null);
      void invalidate();
    },
    onError: onMutError,
  });

  const removeTagMut = useMutation({
    mutationFn: ({ noteIds, tag }: { noteIds: number[]; tag: string }) =>
      ipc.bulkRemoveTag(noteIds, tag),
    onSuccess: () => {
      setBulkTag("");
      setBulkAction(null);
      void invalidate();
    },
    onError: onMutError,
  });

  const moveDeckMut = useMutation({
    mutationFn: ({ cardIds, deckId }: { cardIds: number[]; deckId: number }) =>
      ipc.moveCardsToDeck(cardIds, deckId),
    onSuccess: () => {
      setSelectedDeckId(null);
      setDeckFilter("");
      setBulkAction(null);
      void invalidate();
    },
    onError: onMutError,
  });

  const currentRows: Array<CardRow | NoteRow> = mode === "cards" ? rows : noteRows;
  const getRowId = (r: CardRow | NoteRow) =>
    mode === "cards" ? (r as CardRow).card_id : (r as NoteRow).note_id;

  const rowVirtualizer = useVirtualizer({
    count: currentRows.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 34,
    overscan: 12,
    initialRect: { width: 960, height: 600 },
    observeElementRect: (instance, cb) =>
      observeElementRect(instance, (rect) => {
        cb(rect.height === 0 && rect.width === 0 ? { width: 960, height: 600 } : rect);
      }),
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalVirtualHeight = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalVirtualHeight - virtualItems[virtualItems.length - 1].end : 0;

  async function commitDirtyEditor() {
    try {
      await editorRef.current?.save();
    } catch (err) {
      console.error("Failed to autosave note on switch:", err);
    }
  }

  async function focusRowAt(idx: number) {
    const row = currentRows[idx];
    if (!row) return;
    if (editorRef.current?.isDirty()) {
      await commitDirtyEditor();
    }
    const id = getRowId(row);
    setSelected(new Set([id]));
    setEditNoteId(row.note_id);
    setLastClickIdx(idx);
    rowVirtualizer.scrollToIndex(idx, { align: "auto" });
  }

  // Keyboard: Ctrl+A, Ctrl/Cmd+F, Up/Down row nav (with B3 autosave), Space toggle, Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditingTarget(e.target) || activeDialog !== null) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "a" && currentRows.length > 0) {
        e.preventDefault();
        setSelected(
          new Set(
            currentRows.map((r) =>
              mode === "cards" ? (r as CardRow).card_id : (r as NoteRow).note_id,
            ),
          ),
        );
        return;
      }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && currentRows.length > 0) {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        const fallbackIdx = currentRows.findIndex((r) => selected.has(getRowId(r)));
        const baseIdx = lastClickIdx !== null ? lastClickIdx : fallbackIdx;
        const nextIdx =
          e.key === "ArrowDown"
            ? baseIdx < 0
              ? 0
              : Math.min(currentRows.length - 1, baseIdx + 1)
            : baseIdx < 0
              ? currentRows.length - 1
              : Math.max(0, baseIdx - 1);
        void focusRowAt(nextIdx);
        return;
      }
      if (e.key === " " && currentRows.length > 0) {
        if (
          e.target instanceof HTMLElement &&
          (e.target.closest("button") || e.target.closest("a") || e.target.closest("input"))
        ) {
          return;
        }
        e.preventDefault();
        const fallbackIdx = currentRows.findIndex((r) => selected.has(getRowId(r)));
        const targetIdx = lastClickIdx !== null ? lastClickIdx : Math.max(0, fallbackIdx);
        const row = currentRows[targetIdx];
        if (!row) return;
        const id = getRowId(row);
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        setLastClickIdx(targetIdx);
        return;
      }
      if (e.key === "Escape") {
        if (bulkAction !== null) {
          setBulkAction(null);
          return;
        }
        if (editorRef.current?.isDirty()) {
          return;
        }
        setSelected(new Set());
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  function toggleRowSelection(id: number, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  async function handleRowClick(row: CardRow | NoteRow, idx: number, e: React.MouseEvent) {
    const id = getRowId(row);
    if (editorRef.current?.isDirty()) {
      await commitDirtyEditor();
    }
    if (e.shiftKey && lastClickIdx !== null) {
      const lo = Math.min(lastClickIdx, idx);
      const hi = Math.max(lastClickIdx, idx);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) next.add(getRowId(currentRows[i]));
        return next;
      });
    } else if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelected(new Set([id]));
      setEditNoteId(row.note_id);
    }
    setLastClickIdx(idx);
  }

  const selArray = [...selected];
  const selectedRows = mode === "cards" ? rows.filter((r) => selected.has(r.card_id)) : [];
  const selectedNoteRows = mode === "notes" ? noteRows.filter((r) => selected.has(r.note_id)) : [];
  const selectedNoteIds =
    mode === "cards"
      ? [...new Set(selectedRows.map((r) => r.note_id))]
      : selectedNoteRows.map((r) => r.note_id);

  const orderedSelectedIds =
    mode === "cards"
      ? selectedRows.map((r) => r.card_id)
      : selectedNoteRows.flatMap((r) => r.card_ids);
  const hasSuspended = mode === "cards" && selectedRows.some((r) => r.queue === -1);
  const hasUnsuspended =
    mode === "cards" ? selectedRows.some((r) => r.queue !== -1) : orderedSelectedIds.length > 0;
  const hasBuried = mode === "cards" && selectedRows.some((r) => r.queue === -2 || r.queue === -3);
  const hasUnburied =
    mode === "cards"
      ? selectedRows.some((r) => r.queue !== -2 && r.queue !== -3)
      : orderedSelectedIds.length > 0;
  const selectedNotetypeNames =
    mode === "cards"
      ? selectedRows.map((r) => r.notetype)
      : selectedNoteRows.map((r) => r.notetype);
  const bulkError =
    [
      deleteMut,
      suspendMut,
      unsuspendMut,
      buryMut,
      unburyMut,
      flagMut,
      addTagMut,
      removeTagMut,
      moveDeckMut,
    ].find((m) => m.isError)?.error ?? null;
  const hasNew = mode === "cards" && selectedRows.some((r) => r.card_type === 0);

  const activeCardCols = cardCols
    .map((id) => CARD_COLUMNS.find((c) => c.id === id))
    .filter((c): c is ColumnDef<CardColumnId> => Boolean(c));
  const activeNoteCols = noteCols
    .map((id) => NOTE_COLUMNS.find((c) => c.id === id))
    .filter((c): c is ColumnDef<NoteColumnId> => Boolean(c));

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t("browse.title")} description={t("browse.description")} />

      {search.from === "stats" && (
        <button
          type="button"
          onClick={() =>
            void navigate({
              to: "/stats",
              search: { deck: search.backDeck, range: search.backRange },
            })
          }
          className="flex items-center gap-1.5 border-b border-border bg-secondary/40 px-4 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5 rtl:-scale-x-100" />
          {t("browse.backToStats")}
        </button>
      )}

      {/* Search bar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <div className="relative flex-1">
          <Search
            className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            ref={searchInputRef}
            aria-label={t("browse.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setSubmitted(query);
            }}
            placeholder={t("browse.searchPlaceholder")}
            className="h-9 w-full rounded-md bg-secondary ps-9 pe-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <Button size="sm" onClick={() => setSubmitted(query)}>
          {t("browse.search")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowSyntax((v) => !v)}
          aria-label={t("browse.syntaxHelp")}
          aria-expanded={showSyntax}
          title={t("browse.syntaxHelp")}
        >
          ?
        </Button>
        <div className="inline-flex rounded-md border border-input bg-background p-0.5">
          <Button
            type="button"
            variant={mode === "cards" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            aria-pressed={mode === "cards"}
            onClick={() => switchMode("cards")}
          >
            {t("browse.mode.cards")}
          </Button>
          <Button
            type="button"
            variant={mode === "notes" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            aria-pressed={mode === "notes"}
            onClick={() => switchMode("notes")}
          >
            {t("browse.mode.notes")}
          </Button>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setActiveDialog("findDuplicates")}
        >
          <Copy className="size-3.5" /> {t("browse.findDuplicates")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setActiveDialog("columns")}
        >
          <Columns3 className="size-3.5" /> {t("browse.columns.button")}
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {tn(mode === "cards" ? "browse.loaded" : "browse.loadedNotes", currentRows.length)}
        </span>
      </div>

      {showSyntax && (
        <pre
          dir="ltr"
          className="border-b border-border bg-secondary/60 px-5 py-3 text-xs text-muted-foreground"
        >
          {querySyntax()}
        </pre>
      )}

      <div className="flex min-h-0 flex-1">
        {tauri && (
          <TagSidebar
            onFilter={(tag) => {
              const q = `tag:${tag}`;
              setQuery(q);
              setSubmitted(q);
            }}
          />
        )}

        <BrowseTable
          tauri={tauri}
          mode={mode}
          rows={rows}
          noteRows={noteRows}
          currentRows={currentRows}
          submitted={submitted}
          selected={selected}
          lastClickIdx={lastClickIdx}
          activeCardCols={activeCardCols}
          activeNoteCols={activeNoteCols}
          sortKey={sortKey}
          sortAsc={sortAsc}
          today={today}
          offset={offset}
          pageSize={pageSize}
          pageSizes={BROWSE_PAGE_SIZES}
          totalCount={totalCount}
          currentPage={currentPage}
          totalPages={totalPages}
          canPrev={canPrev}
          canNext={canNext}
          isFetching={isFetching}
          tableScrollRef={tableScrollRef}
          paddingTop={paddingTop}
          paddingBottom={paddingBottom}
          virtualItems={virtualItems}
          onSelectAll={(checked) =>
            setSelected(checked ? new Set(currentRows.map(getRowId)) : new Set())
          }
          onToggleSort={toggleSort}
          onRowClick={(row, idx, e) => void handleRowClick(row, idx, e)}
          onToggleRow={toggleRowSelection}
          onChangePageSize={(size) => changePageSize(size as BrowsePageSize)}
          onPrevPage={goPrevPage}
          onNextPage={goNextPage}
        />

        {editNoteId !== null && selected.size === 1 && (
          <aside className="w-80 shrink-0 overflow-auto border-s border-border">
            <NoteEditorPanel
              key={editNoteId}
              ref={editorRef}
              noteId={editNoteId}
              lapses={
                mode === "cards"
                  ? (rows.find((r) => r.note_id === editNoteId)?.lapses ?? undefined)
                  : undefined
              }
              onSaved={() => void invalidate()}
            />
          </aside>
        )}
      </div>

      {selArray.length > 0 && (
        <BrowseBulkBar
          bulkRef={bulkRef}
          selectedCount={selArray.length}
          hasSuspended={hasSuspended}
          hasUnsuspended={hasUnsuspended}
          hasBuried={hasBuried}
          hasUnburied={hasUnburied}
          hasNew={hasNew}
          isSuspendPending={suspendMut.isPending}
          isUnsuspendPending={unsuspendMut.isPending}
          isBuryPending={buryMut.isPending}
          isUnburyPending={unburyMut.isPending}
          isDeletePending={deleteMut.isPending}
          isMoveDeckPending={moveDeckMut.isPending}
          moveDeckError={moveDeckMut.isError ? moveDeckMut.error : null}
          bulkAction={bulkAction}
          setBulkAction={setBulkAction}
          bulkTag={bulkTag}
          setBulkTag={setBulkTag}
          existingTags={tagsQuery.data ?? []}
          deckFilter={deckFilter}
          setDeckFilter={setDeckFilter}
          selectedDeckId={selectedDeckId}
          setSelectedDeckId={setSelectedDeckId}
          availableDecks={availableDecks}
          bulkError={bulkError}
          onSuspend={() => {
            const ids = hasSuspended
              ? selectedRows.filter((r) => r.queue !== -1).map((r) => r.card_id)
              : orderedSelectedIds;
            suspendMut.mutate(ids);
          }}
          onUnsuspend={() => {
            const ids = hasUnsuspended
              ? selectedRows.filter((r) => r.queue === -1).map((r) => r.card_id)
              : orderedSelectedIds;
            unsuspendMut.mutate(ids);
          }}
          onBury={() => {
            const ids = hasBuried
              ? selectedRows.filter((r) => r.queue !== -2 && r.queue !== -3).map((r) => r.card_id)
              : orderedSelectedIds;
            buryMut.mutate(ids);
          }}
          onUnbury={() => {
            const ids = hasUnburied
              ? selectedRows.filter((r) => r.queue === -2 || r.queue === -3).map((r) => r.card_id)
              : orderedSelectedIds;
            unburyMut.mutate(ids);
          }}
          onSetFlag={(flag) => flagMut.mutate({ cardIds: orderedSelectedIds, flag })}
          onSubmitTags={(tagList, action) => {
            for (const tagName of tagList) {
              if (action === "addTag") {
                addTagMut.mutate({ noteIds: selectedNoteIds, tag: tagName });
              } else {
                removeTagMut.mutate({ noteIds: selectedNoteIds, tag: tagName });
              }
            }
          }}
          onMoveDeck={(deckId) => moveDeckMut.mutate({ cardIds: orderedSelectedIds, deckId })}
          onOpenDialog={(dialog) => setActiveDialog(dialog)}
          onCheckQuality={() =>
            void navigate({
              to: "/assistant/quality" as never,
              search: { noteIds: selectedNoteIds.join(",") } as never,
            })
          }
          onRequestDelete={() => setConfirmDeleteNotes(true)}
          onClearSelection={() => {
            setSelected(new Set());
            setBulkAction(null);
          }}
        />
      )}

      <ForgetCardsDialog
        open={activeDialog === "forget"}
        cardIds={orderedSelectedIds}
        onClose={() => setActiveDialog(null)}
        onDone={() => void invalidate()}
      />
      <SetDueDateDialog
        open={activeDialog === "setDueDate"}
        cardIds={orderedSelectedIds}
        onClose={() => setActiveDialog(null)}
        onDone={() => void invalidate()}
      />
      <RepositionCardsDialog
        open={activeDialog === "reposition"}
        cardIds={orderedSelectedIds}
        onClose={() => setActiveDialog(null)}
        onDone={() => void invalidate()}
      />
      <CardPreviewDialog
        open={activeDialog === "preview"}
        cardIds={orderedSelectedIds}
        onClose={() => setActiveDialog(null)}
      />
      <FindReplaceDialog
        open={activeDialog === "findReplace"}
        noteIds={selectedNoteIds}
        onClose={() => setActiveDialog(null)}
        onDone={() => void invalidate()}
      />
      <FindDuplicatesDialog
        open={activeDialog === "findDuplicates"}
        onClose={() => setActiveDialog(null)}
        onOpenGroup={(ids) => {
          const next = `nid:${ids.join(",")}`;
          setQuery(next);
          setSubmitted(next);
          setActiveDialog(null);
        }}
        onTagged={() => {
          void invalidate();
          void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
        }}
      />
      <ChangeNotetypeDialog
        open={activeDialog === "changeNotetype"}
        noteIds={selectedNoteIds}
        sourceNotetypeNames={selectedNotetypeNames}
        onClose={() => setActiveDialog(null)}
        onDone={() => {
          void invalidate();
          void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
        }}
      />
      <ConfirmDialog
        open={confirmDeleteNotes}
        title={t("browse.deleteNotesTitle")}
        description={tn("browse.deleteNotesConfirm", selectedNoteIds.length)}
        confirmLabel={t("common.delete")}
        isPending={deleteMut.isPending}
        onCancel={() => setConfirmDeleteNotes(false)}
        onConfirm={() => {
          deleteMut.mutate(selectedNoteIds, {
            onSuccess: () => setConfirmDeleteNotes(false),
          });
        }}
      />
      {mode === "cards" ? (
        <BrowseColumnsDialog
          open={activeDialog === "columns"}
          columns={CARD_COLUMNS}
          visible={cardCols}
          defaults={DEFAULT_CARD_COLUMNS}
          onChange={(next) => {
            setCardCols(next);
            writeCardColumns(next);
          }}
          onClose={() => setActiveDialog(null)}
        />
      ) : (
        <BrowseColumnsDialog
          open={activeDialog === "columns"}
          columns={NOTE_COLUMNS}
          visible={noteCols}
          defaults={DEFAULT_NOTE_COLUMNS}
          onChange={(next) => {
            setNoteCols(next);
            writeNoteColumns(next);
          }}
          onClose={() => setActiveDialog(null)}
        />
      )}
    </div>
  );
}
