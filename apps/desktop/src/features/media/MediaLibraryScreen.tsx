import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type {
  MediaKind,
  MediaLibraryFilter,
  MediaLibraryItem,
  MediaSort,
  MediaUsageFilter,
} from "@bibalak/ipc-types";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { buildBrowseFilterQuery } from "@/features/browse/browseHelpers";
import { MediaKindIcon } from "@/features/media/MediaKindIcon";
import { MediaPreviewPanel } from "@/features/media/MediaPreviewPanel";
import {
  browseQueryForMedia,
  formatBytes,
  MEDIA_PAGE_SIZE,
  mediaKindLabel,
  mediaUrl,
} from "@/lib/media";
import { errorMessage, ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { formatNumber, t, tn } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { LocaleKey } from "@/locales/en";

const KIND_CHIPS: Array<{ value: MediaKind | null; labelKey: LocaleKey }> = [
  { value: null, labelKey: "media.filter.allKinds" },
  { value: "image", labelKey: "media.kind.images" },
  { value: "audio", labelKey: "media.kind.audio" },
  { value: "video", labelKey: "media.kind.video" },
  { value: "other", labelKey: "media.kind.other" },
];

function MediaTile({
  item,
  selected,
  buttonRef,
  onSelect,
}: {
  item: MediaLibraryItem;
  selected: boolean;
  buttonRef: (el: HTMLButtonElement | null) => void;
  onSelect: (filename: string) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => onSelect(item.filename)}
      aria-label={t("media.tileLabel", { name: item.filename })}
      aria-pressed={selected}
      className={cn(
        "group flex flex-col overflow-hidden rounded-lg border bg-card text-start transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-primary ring-1 ring-primary" : "border-border",
      )}
    >
      <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-muted/40">
        {item.kind === "image" && !imgFailed ? (
          <img
            src={mediaUrl(item.filename)}
            alt={item.filename}
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="size-full object-contain p-2 transition-transform duration-150 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5 px-2 text-center">
            <MediaKindIcon kind={item.kind} />
            <span className="text-[11px] font-medium text-muted-foreground">
              {mediaKindLabel(item.kind)}
            </span>
          </div>
        )}
      </div>

      <div className="flex w-full flex-col gap-1 border-t border-border/70 p-2.5">
        <span
          className="truncate text-xs font-medium text-foreground"
          title={item.filename}
          dir="auto"
        >
          {item.filename}
        </span>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="tabular-nums">
            <bdi dir="ltr">{formatBytes(item.size_bytes)}</bdi>
          </span>
          <span
            title={item.usage_count === 0 ? t("media.unusedExplain") : undefined}
            className={
              item.usage_count === 0
                ? "rounded bg-muted px-1.5 py-0.5 font-medium text-muted-foreground"
                : "rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary tabular-nums"
            }
          >
            {item.usage_count === 0
              ? t("media.unusedBadge")
              : tn("media.usageCount", item.usage_count)}
          </span>
        </div>
      </div>
    </button>
  );
}

export function MediaLibraryScreen() {
  const tauri = isTauri();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [selectedDeck, setSelectedDeck] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [kind, setKind] = useState<MediaKind | null>(null);
  const [usage, setUsage] = useState<MediaUsageFilter>("all");
  const [sort, setSort] = useState<MediaSort>("name");
  const [offset, setOffset] = useState(0);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deletedCount, setDeletedCount] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const tileRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const decksQuery = useQuery({
    queryKey: queryKeys.decks,
    queryFn: ipc.listDecks,
    enabled: tauri,
  });
  const tagsQuery = useQuery({
    queryKey: queryKeys.tags,
    queryFn: ipc.listTags,
    enabled: tauri,
  });

  const decks = useMemo(
    () => (decksQuery.data ?? []).filter((d) => !d.is_filtered),
    [decksQuery.data],
  );
  const tags = tagsQuery.data ?? [];

  const filter: MediaLibraryFilter = useMemo(
    () => ({
      query: buildBrowseFilterQuery(selectedDeck, selectedTag),
      kind,
      usage,
      sort,
    }),
    [selectedDeck, selectedTag, kind, usage, sort],
  );

  const libraryQuery = useQuery({
    queryKey: queryKeys.mediaLibrary(search, filter, offset),
    queryFn: () => ipc.listMediaLibrary(search, MEDIA_PAGE_SIZE, offset, filter),
    enabled: tauri,
    // Background legacy copy or external edits can populate collection.media
    // after the first visit; do not hold a 30s stale page across tab/route switches.
    staleTime: 0,
  });
  const legacyPendingQuery = useQuery({
    queryKey: queryKeys.legacyMediaPending,
    queryFn: ipc.legacyMediaPending,
    enabled: tauri,
  });
  const legacyMediaPending = legacyPendingQuery.data ?? false;

  const deleteUnused = useMutation({
    mutationFn: () => ipc.deleteUnusedMedia(),
    onSuccess: (count) => {
      setConfirmOpen(false);
      setActionError(null);
      setDeletedCount(count);
      setOffset(0);
      setSelectedFilename(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.mediaLibraryAll });
    },
    onError: (err: unknown) => {
      setConfirmOpen(false);
      setActionError(errorMessage(err));
    },
  });

  const page = libraryQuery.data;
  const totalCount = page?.total_count ?? 0;
  const libraryCount = page?.library_count ?? 0;
  const unusedCount = page?.unused_count ?? 0;
  const usedCount = Math.max(0, libraryCount - unusedCount);
  const totalPages = Math.max(1, Math.ceil(totalCount / MEDIA_PAGE_SIZE));
  const currentPage = Math.min(totalPages, Math.floor(offset / MEDIA_PAGE_SIZE) + 1);

  const selectedItem = useMemo(
    () => page?.items.find((item) => item.filename === selectedFilename) ?? null,
    [page?.items, selectedFilename],
  );

  const hasActiveFilters =
    Boolean(search.trim()) ||
    Boolean(selectedDeck) ||
    Boolean(selectedTag) ||
    kind !== null ||
    usage !== "all" ||
    sort !== "name";

  const resetPaging = () => {
    setOffset(0);
    setDeletedCount(null);
  };

  const resetAllFilters = () => {
    setSearch("");
    setSelectedDeck("");
    setSelectedTag("");
    setKind(null);
    setUsage("all");
    setSort("name");
    resetPaging();
  };

  const openInBrowse = (filename: string) => {
    void navigate({
      to: "/browse",
      search: { q: browseQueryForMedia(filename) },
    });
  };

  const closePreview = () => {
    const returnTarget = selectedFilename ? tileRefs.current.get(selectedFilename) : undefined;
    setSelectedFilename(null);
    returnTarget?.focus();
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader
        title={t("media.title")}
        description={t("media.description")}
        actions={
          tauri ? (
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              title={t("media.unusedExplain")}
              disabled={unusedCount === 0 || deleteUnused.isPending || legacyMediaPending}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              {t("media.moveToTrash", { count: formatNumber(unusedCount) })}
            </Button>
          ) : null
        }
      />

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4 sm:p-6">
        {!tauri && (
          <EmptyState icon={ImageIcon} title={t("media.title")} description={t("media.noTauri")} />
        )}

        {tauri && (
          <>
            {legacyMediaPending && (
              <p className="text-xs text-muted-foreground">{t("media.legacyCopyPending")}</p>
            )}
            <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
                  <Search
                    className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      resetPaging();
                    }}
                    placeholder={t("media.searchPlaceholder")}
                    aria-label={t("media.searchLabel")}
                    className="h-9 w-full rounded-md border border-input bg-background ps-9 pe-8 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  {search && (
                    <button
                      type="button"
                      aria-label={t("browse.clear")}
                      onClick={() => {
                        setSearch("");
                        resetPaging();
                      }}
                      className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>

                <Select
                  aria-label={t("media.filter.deck")}
                  containerClassName="w-auto min-w-[9.5rem]"
                  value={selectedDeck}
                  onChange={(e) => {
                    setSelectedDeck(e.target.value);
                    resetPaging();
                  }}
                >
                  <option value="">{t("media.filter.allDecks")}</option>
                  {decks.map((deck) => (
                    <option key={deck.id} value={deck.name}>
                      {deck.name}
                    </option>
                  ))}
                </Select>

                <Select
                  aria-label={t("media.filter.tag")}
                  containerClassName="w-auto min-w-[8.5rem]"
                  value={selectedTag}
                  onChange={(e) => {
                    setSelectedTag(e.target.value);
                    resetPaging();
                  }}
                >
                  <option value="">{t("media.filter.allTags")}</option>
                  {tags.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </Select>

                <div
                  role="group"
                  aria-label={t("media.filter.usage")}
                  className="inline-flex items-center gap-0.5 rounded-md border border-border bg-secondary/40 p-0.5"
                >
                  {(
                    [
                      {
                        value: "all" as const,
                        label: page
                          ? t("media.filter.allCount", { count: formatNumber(libraryCount) })
                          : t("media.filter.allUsage"),
                        title: undefined,
                      },
                      {
                        value: "used" as const,
                        label: page
                          ? t("media.filter.usedCount", { count: formatNumber(usedCount) })
                          : t("media.filter.usedOnly"),
                        title: undefined,
                      },
                      {
                        value: "unused" as const,
                        label: page
                          ? t("media.filter.unusedCount", { count: formatNumber(unusedCount) })
                          : t("media.filter.unusedOnly"),
                        title: t("media.unusedExplain"),
                      },
                    ] as const
                  ).map((seg) => {
                    const active = usage === seg.value;
                    return (
                      <button
                        key={seg.value}
                        type="button"
                        aria-pressed={active}
                        title={seg.title}
                        onClick={() => {
                          setUsage(seg.value);
                          resetPaging();
                        }}
                        className={cn(
                          "rounded px-2.5 py-1 text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {seg.label}
                      </button>
                    );
                  })}
                </div>

                <Select
                  aria-label={t("media.filter.sort")}
                  containerClassName="w-auto min-w-[8rem]"
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value as MediaSort);
                    resetPaging();
                  }}
                >
                  <option value="name">{t("media.filter.sortName")}</option>
                  <option value="size-desc">{t("media.filter.sortSize")}</option>
                  <option value="usage-desc">{t("media.filter.sortUsage")}</option>
                </Select>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    role="group"
                    aria-label={t("media.filter.kind")}
                    className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-secondary/40 p-0.5"
                  >
                    {KIND_CHIPS.map((chip) => {
                      const active = kind === chip.value;
                      return (
                        <button
                          key={chip.labelKey}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            setKind(chip.value);
                            resetPaging();
                          }}
                          className={cn(
                            "rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            active
                              ? "bg-card text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {t(chip.labelKey)}
                        </button>
                      );
                    })}
                  </div>

                  {hasActiveFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={resetAllFilters}
                    >
                      {t("media.filter.clear")}
                    </Button>
                  )}
                </div>

                {page && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {tn("media.statsSummary", libraryCount, {
                      totalSize: formatBytes(page.total_bytes),
                      unused: formatNumber(unusedCount),
                    })}
                  </p>
                )}
              </div>
            </div>

            {deletedCount !== null && (
              <div
                role="status"
                className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground"
              >
                {tn("media.movedToTrashResult", deletedCount)}
              </div>
            )}

            {(actionError || libraryQuery.isError) && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                <span>{actionError ?? errorMessage(libraryQuery.error)}</span>
              </div>
            )}

            <div className="flex flex-1 flex-col gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1 space-y-4">
                {libraryQuery.isPending ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    {t("common.loading")}
                  </p>
                ) : page && page.items.length === 0 ? (
                  <EmptyState
                    icon={ImageIcon}
                    title={t("media.title")}
                    description={
                      usage === "unused"
                        ? `${t("media.empty.unused")} ${t("media.unusedExplain")}`
                        : hasActiveFilters
                          ? t("media.empty.filtered")
                          : t("media.empty.library")
                    }
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                    {page?.items.map((item) => (
                      <MediaTile
                        key={item.filename}
                        item={item}
                        selected={selectedFilename === item.filename}
                        buttonRef={(el) => {
                          if (el) tileRefs.current.set(item.filename, el);
                          else tileRefs.current.delete(item.filename);
                        }}
                        onSelect={setSelectedFilename}
                      />
                    ))}
                  </div>
                )}

                {totalCount > MEDIA_PAGE_SIZE && (
                  <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset === 0}
                      onClick={() => setOffset((prev) => Math.max(0, prev - MEDIA_PAGE_SIZE))}
                    >
                      <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
                      {t("media.prevPage")}
                    </Button>

                    <span className="tabular-nums">
                      {t("media.pageOf", {
                        page: formatNumber(currentPage),
                        total: formatNumber(totalPages),
                      })}
                    </span>

                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset + MEDIA_PAGE_SIZE >= totalCount}
                      onClick={() => setOffset((prev) => prev + MEDIA_PAGE_SIZE)}
                    >
                      {t("media.nextPage")}
                      <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </div>

              {selectedItem && (
                <MediaPreviewPanel
                  item={selectedItem}
                  onClose={closePreview}
                  onShowNotes={openInBrowse}
                />
              )}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t("media.moveToTrashConfirmTitle")}
        description={tn("media.moveToTrashConfirmDescription", unusedCount)}
        confirmLabel={t("media.moveToTrashConfirmTitle")}
        variant="destructive"
        isPending={deleteUnused.isPending}
        onConfirm={() => deleteUnused.mutate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
