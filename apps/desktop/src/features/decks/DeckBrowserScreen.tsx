import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { platform } from "@/lib/platform";
import { AnimatePresence, motion } from "framer-motion";
import { Download, FileText, Filter, LayoutGrid, Layers, List, Plus, Undo2 } from "lucide-react";
import type {
  DeckSummary,
  FilteredDeckConfig,
  ImportProgress,
  ImportSummary,
} from "@bibalak/ipc-types";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/EmptyState";
import { EmptyStatePicture } from "@/components/illustrations/EmptyStatePicture";
import { Button } from "@/components/ui/button";
import { DeckOptionsDialog } from "@/components/DeckOptionsDialog";
import { CreateDeckForm } from "@/components/decks/CreateDeckForm";
import { DeckRow } from "@/components/decks/DeckRow";
import { DeckGridCard } from "@/components/decks/DeckGridCard";
import { DeleteDeckDialog } from "@/components/decks/DeleteDeckDialog";
import { FilteredDeckDialog } from "@/components/decks/FilteredDeckDialog";
import { ResetDeckProgressDialog } from "@/components/decks/ResetDeckProgressDialog";
import { TextImportDialog } from "@/components/decks/TextImportDialog";
import { TodaySummary } from "@/components/decks/TodaySummary";
import { ComebackCard } from "@/features/motivation/ComebackCard";
import { TodayCard } from "@/features/motivation/TodayCard";
import { ProgressPanel } from "@/features/progress/ProgressPanel";
import { YesterdaySummaryCard } from "@/features/progress/YesterdaySummaryCard";
import { errorMessage, ipc, isTauri, pickAndImportPackage } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { invalidateTodayCounts } from "@/lib/queryRefresh";
import { listItem, staggerList } from "@/lib/motion";
import { useUi, type HomeLayout } from "@/stores/ui";
import { useStyle } from "@/stores/style";
import { cn } from "@/lib/utils";
import { t, tn, textDirection } from "@/lib/i18n";
import { formatUndoAction } from "@/lib/undo";
import type { LocaleKey } from "@/locales/en";

const LAYOUT_OPTIONS: { value: HomeLayout; icon: typeof List; label: LocaleKey }[] = [
  { value: "list", icon: List, label: "decks.layout.list" },
  { value: "grid", icon: LayoutGrid, label: "decks.layout.grid" },
];

function LayoutSwitcher({
  value,
  onChange,
}: {
  value: HomeLayout;
  onChange: (v: HomeLayout) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border bg-secondary/50 p-0.5">
      {LAYOUT_OPTIONS.map(({ value: v, icon: Icon, label }) => (
        <button
          key={v}
          type="button"
          title={t(label)}
          aria-label={t(label)}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded transition-colors",
            value === v
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

export function DeckBrowserScreen() {
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: "/" });
  const { create } = useSearch({ from: "/" });
  const tauri = isTauri();
  const style = useStyle((s) => s.style);

  useQuery({
    queryKey: queryKeys.appInfo,
    queryFn: ipc.appInfo,
    enabled: tauri,
  });

  const decksQuery = useQuery({
    queryKey: queryKeys.decks,
    queryFn: ipc.listDecks,
    enabled: tauri,
    // Backend "today" rolls over independently of user activity, and cache
    // invalidation elsewhere only fires on explicit mutation events — poll so
    // new-card counts don't stay frozen if the deck browser is left open
    // across a day boundary.
    refetchInterval: 60_000,
  });

  const undoStatusQuery = useQuery({
    queryKey: queryKeys.undoStatus,
    queryFn: ipc.undoStatus,
    enabled: tauri,
  });
  const undoAction = undoStatusQuery.data ?? null;

  const invalidateDecks = () => invalidateTodayCounts(queryClient);

  const [creating, setCreating] = useState(false);
  const [lastImport, setLastImport] = useState<ImportSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DeckSummary | null>(null);
  const [resetTarget, setResetTarget] = useState<DeckSummary | null>(null);
  const [optionsDeck, setOptionsDeck] = useState<DeckSummary | null>(null);
  const [showFilteredDialog, setShowFilteredDialog] = useState(false);
  const [showTextImport, setShowTextImport] = useState(false);
  const [rebuildTarget, setRebuildTarget] = useState<FilteredDeckConfig | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);

  // CommandPalette's "New deck" lands here with `?create=true`; open the form
  // once, then clear the search param so it doesn't reopen on back/refresh.
  useEffect(() => {
    if (create) {
      setCreating(true);
      void navigate({ search: {}, replace: true });
    }
  }, [create, navigate]);

  useEffect(() => {
    if (!tauri) return;
    return platform.listen<ImportProgress>("bibalak://import-progress", setImportProgress);
  }, [tauri]);

  const importMut = useMutation({
    mutationFn: () => {
      setImportProgress(null);
      return pickAndImportPackage();
    },
    onSuccess: (summary) => {
      if (summary) {
        setLastImport(summary);
        void invalidateDecks();
      }
    },
    onSettled: () => setImportProgress(null),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => ipc.deleteDeck(id),
    onSuccess: () => void invalidateDecks(),
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => ipc.renameDeck(id, name),
    onSuccess: () => void invalidateDecks(),
  });

  const emptyMut = useMutation({
    mutationFn: (id: number) => ipc.emptyFiltered(id),
    onSuccess: () => void invalidateDecks(),
  });

  const undoMut = useMutation({
    mutationFn: () => ipc.undo(),
    onSuccess: () => void invalidateDecks(),
  });

  const toggleCollapseMut = useMutation({
    mutationFn: ({ id, collapsed }: { id: number; collapsed: boolean }) =>
      ipc.setDeckCollapsed(id, collapsed),
    onSuccess: () => void invalidateDecks(),
  });

  const rawDecks = decksQuery.data;
  const decks = useMemo(() => rawDecks ?? [], [rawDecks]);

  const visibleDecks = useMemo(() => {
    function isHidden(deck: DeckSummary): boolean {
      const parts = deck.name.split("::");
      if (parts.length <= 1) return false;
      for (let i = 1; i < parts.length; i++) {
        const parentName = parts.slice(0, i).join("::");
        const parent = decks.find((d) => d.name === parentName);
        if (parent?.collapsed) return true;
      }
      return false;
    }
    return decks.filter((d) => !isHidden(d));
  }, [decks]);

  const deckDepthMap = useMemo(() => {
    const byId = new Map(decks.map((d) => [d.id, d]));
    const depthCache = new Map<number, number>();

    function getDepth(d: DeckSummary): number {
      if (depthCache.has(d.id)) return depthCache.get(d.id)!;
      if (d.parent_id === null || !byId.has(d.parent_id)) {
        depthCache.set(d.id, 0);
        return 0;
      }
      const visited = new Set<number>([d.id]);
      let curr = byId.get(d.parent_id);
      let depth = 0;
      while (curr && !visited.has(curr.id)) {
        depth++;
        visited.add(curr.id);
        curr = curr.parent_id !== null ? byId.get(curr.parent_id) : undefined;
      }
      depthCache.set(d.id, depth);
      return depth;
    }

    const map = new Map<number, number>();
    for (const d of decks) {
      map.set(d.id, getDepth(d));
    }
    return map;
  }, [decks]);

  const hasChildren = (deck: DeckSummary) => decks.some((d) => d.name.startsWith(`${deck.name}::`));
  const totalDue = useMemo(() => {
    const topLevel = decks.filter((d) => d.parent_id === null);
    const source = topLevel.length > 0 ? topLevel : decks;
    return source.reduce((acc, d) => acc + d.new_count + d.learning_count + d.review_count, 0);
  }, [decks]);
  const hideCaughtUpInHeader = tauri && decks.length > 0 && totalDue === 0;

  const homeLayout = useUi((s) => s.homeLayout);
  const setHomeLayout = useUi((s) => s.setHomeLayout);

  async function openRebuild(deck: DeckSummary) {
    const cfg = await ipc.getFilteredConfig(deck.id);
    if (cfg) setRebuildTarget(cfg);
  }

  function studyDeck(deck: DeckSummary) {
    void navigate({ to: "/study/$deckId", params: { deckId: deck.id } });
  }

  return (
    <div className="relative flex h-full flex-col">
      <ScreenHeader
        title={t("nav.decks")}
        description={hideCaughtUpInHeader ? undefined : <TodaySummary decks={decks} />}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => importMut.mutate()}
              disabled={!tauri || importMut.isPending}
              title={t("decks.importHint")}
            >
              <Download />{" "}
              {importMut.isPending
                ? importProgress && importProgress.total > 0
                  ? t("decks.importingProgress", {
                      done: importProgress.done,
                      total: importProgress.total,
                    })
                  : t("decks.importing")
                : t("decks.import")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTextImport(true)}
              disabled={!tauri}
              title={t("decks.importTextHint")}
            >
              <FileText /> {t("decks.importText")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => undoMut.mutate()}
              disabled={!tauri || undoMut.isPending || !undoAction}
              title={
                undoAction
                  ? t("decks.undoAction", { action: formatUndoAction(undoAction) })
                  : t("decks.undoEmpty")
              }
            >
              <Undo2 /> {t("decks.undo")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilteredDialog(true)}
              disabled={!tauri}
              title={t("decks.filteredHint")}
            >
              <Filter /> {t("decks.filtered")}
            </Button>
            <Button size="sm" onClick={() => setCreating((value) => !value)} disabled={!tauri}>
              <Plus /> {t("decks.newDeck")}
            </Button>
            <LayoutSwitcher value={homeLayout} onChange={setHomeLayout} />
          </>
        }
      />

      <div className="relative flex-1 overflow-auto">
        <AnimatePresence initial={false}>
          {creating && <CreateDeckForm onClose={() => setCreating(false)} />}
        </AnimatePresence>

        {tauri && <ComebackCard />}
        {tauri && <TodayCard decks={decks} onStudy={studyDeck} />}

        {tauri && style !== "game" && <ProgressPanel variant="compact" />}
        {tauri && <YesterdaySummaryCard />}

        {importMut.isError ? (
          <p className="px-4 py-2 text-sm text-destructive sm:px-6 lg:px-8">
            {t("decks.importFailed", { error: errorMessage(importMut.error) })}
          </p>
        ) : null}
        {deleteMut.isError ? (
          <p className="px-4 py-2 text-sm text-destructive sm:px-6 lg:px-8">
            {t("decks.deleteFailed", { error: errorMessage(deleteMut.error) })}
          </p>
        ) : null}
        {renameMut.isError ? (
          <p className="px-4 py-2 text-sm text-destructive sm:px-6 lg:px-8">
            {t("decks.renameFailed", { error: errorMessage(renameMut.error) })}
          </p>
        ) : null}
        {emptyMut.isError ? (
          <p className="px-4 py-2 text-sm text-destructive sm:px-6 lg:px-8">
            {t("decks.emptyFailed", { error: errorMessage(emptyMut.error) })}
          </p>
        ) : null}
        {undoMut.isError ? (
          <p className="px-4 py-2 text-sm text-destructive sm:px-6 lg:px-8">
            {t("decks.undoFailed", { error: errorMessage(undoMut.error) })}
          </p>
        ) : null}

        {lastImport ? (
          <p className="border-b border-border bg-secondary/40 px-4 py-2 text-sm text-muted-foreground sm:px-6 lg:px-8">
            {t("decks.importSummary.result", {
              parts: [
                tn("decks.importSummary.notes", lastImport.notes_added),
                tn("decks.importSummary.cards", lastImport.cards_added),
                tn("decks.importSummary.decks", lastImport.decks_added),
                tn("decks.importSummary.media", lastImport.media_imported),
              ].join(textDirection() === "rtl" ? "، " : ", "),
            })}
            {lastImport.notes_updated > 0
              ? ` · ${tn("decks.importSummary.updated", lastImport.notes_updated)}`
              : ""}
          </p>
        ) : null}

        {!tauri ? (
          <EmptyState
            icon={Layers}
            title={t("decks.noTauri.title")}
            description={t("decks.noTauri.description")}
          />
        ) : decks.length === 0 ? (
          style === "default" ? (
            <EmptyState
              icon={Layers}
              title={t("decks.none.title")}
              description={t("decks.none.description")}
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <Plus /> {t("decks.newDeck")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => importMut.mutate()}
                    disabled={importMut.isPending}
                  >
                    <Download /> {t("decks.importFromAnki")}
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <EmptyStatePicture scene="decks" style={style} />
              <div className="space-y-1.5">
                <h2 className="text-base font-semibold text-foreground">{t("decks.none.title")}</h2>
                <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
                  {t("decks.none.description")}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus /> {t("decks.newDeck")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => importMut.mutate()}
                  disabled={importMut.isPending}
                >
                  <Download /> {t("decks.importFromAnki")}
                </Button>
              </div>
            </div>
          )
        ) : homeLayout === "grid" ? (
          <motion.div
            variants={staggerList}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3 lg:p-8 xl:grid-cols-4"
          >
            <AnimatePresence>
              {decks.map((deck: DeckSummary) => (
                <motion.div key={deck.id} variants={listItem} exit={{ opacity: 0, scale: 0.96 }}>
                  <DeckGridCard
                    deck={deck}
                    hasChildren={hasChildren(deck)}
                    onStudy={() => studyDeck(deck)}
                    onRename={(name) => renameMut.mutate({ id: deck.id, name })}
                    onOptions={() => setOptionsDeck(deck)}
                    onCheckQuality={
                      deck.is_filtered
                        ? undefined
                        : () =>
                            void navigate({ to: "/assistant/quality", search: { deckId: deck.id } })
                    }
                    onResetProgress={deck.is_filtered ? undefined : () => setResetTarget(deck)}
                    onDelete={() => setPendingDelete(deck)}
                    onRebuild={() => void openRebuild(deck)}
                    onEmpty={() => emptyMut.mutate(deck.id)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 px-4 pb-1 pt-3 text-xs font-medium text-muted-foreground sm:px-6 lg:px-8">
              <span className="w-9 text-center">{t("decks.col.new")}</span>
              <span className="w-9 text-center">{t("decks.col.learn")}</span>
              <span className="w-9 text-center">{t("decks.col.due")}</span>
              <span className="w-36" />
            </div>
            <motion.ul variants={staggerList} initial="hidden" animate="show">
              <AnimatePresence>
                {visibleDecks.map((deck: DeckSummary) => (
                  <motion.li
                    key={deck.id}
                    variants={listItem}
                    exit={{ opacity: 0, x: textDirection() === "rtl" ? 16 : -16 }}
                  >
                    <DeckRow
                      deck={deck}
                      depth={deckDepthMap.get(deck.id) ?? 0}
                      hasChildren={hasChildren(deck)}
                      collapsed={deck.collapsed}
                      onToggleCollapse={() =>
                        toggleCollapseMut.mutate({ id: deck.id, collapsed: !deck.collapsed })
                      }
                      onStudy={() => studyDeck(deck)}
                      onRename={(name) => renameMut.mutate({ id: deck.id, name })}
                      onOptions={() => setOptionsDeck(deck)}
                      onCheckQuality={
                        deck.is_filtered
                          ? undefined
                          : () =>
                              void navigate({
                                to: "/assistant/quality",
                                search: { deckId: deck.id },
                              })
                      }
                      onResetProgress={deck.is_filtered ? undefined : () => setResetTarget(deck)}
                      onDelete={() => setPendingDelete(deck)}
                      onRebuild={() => void openRebuild(deck)}
                      onEmpty={() => emptyMut.mutate(deck.id)}
                    />
                  </motion.li>
                ))}
              </AnimatePresence>
            </motion.ul>
          </>
        )}
      </div>

      <DeleteDeckDialog
        deck={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        isPending={deleteMut.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteMut.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
      />

      <ResetDeckProgressDialog
        deck={resetTarget}
        hasSubdecks={resetTarget ? hasChildren(resetTarget) : false}
        onClose={() => setResetTarget(null)}
        onDone={() => void invalidateDecks()}
      />

      <AnimatePresence>
        {optionsDeck && (
          <DeckOptionsDialog
            key={optionsDeck.id}
            deckId={optionsDeck.id}
            deckName={optionsDeck.name}
            onClose={() => setOptionsDeck(null)}
            onSaved={() => void invalidateDecks()}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showFilteredDialog && (
          <FilteredDeckDialog
            key="filtered-new"
            onClose={() => setShowFilteredDialog(false)}
            onSaved={() => void invalidateDecks()}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {rebuildTarget && (
          <FilteredDeckDialog
            key={rebuildTarget.deck_id}
            initial={rebuildTarget}
            onClose={() => setRebuildTarget(null)}
            onSaved={() => void invalidateDecks()}
          />
        )}
      </AnimatePresence>

      <TextImportDialog
        open={showTextImport}
        onClose={() => setShowTextImport(false)}
        onImported={() => void invalidateDecks()}
      />
    </div>
  );
}
