import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Save,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import type { TagCount } from "@bibalak/ipc-types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ipc } from "@/lib/ipc";
import { formatNumber, t } from "@/lib/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "@/stores/toast";

const TAGS_WIDTH_KEY = "keepsake-tags-width";
const TAGS_COLLAPSED_KEY = "keepsake-tags-collapsed";
const MIN_TAG_WIDTH = 140;
const MAX_TAG_WIDTH = 380;
const DEFAULT_TAG_WIDTH = 208;
const KEYBOARD_RESIZE_STEP = 16;

function readTagsWidth(): number {
  if (typeof localStorage === "undefined") return DEFAULT_TAG_WIDTH;
  const n = Number(localStorage.getItem(TAGS_WIDTH_KEY));
  if (!Number.isFinite(n) || n < MIN_TAG_WIDTH) return DEFAULT_TAG_WIDTH;
  return Math.min(MAX_TAG_WIDTH, n);
}

function readTagsCollapsed(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(TAGS_COLLAPSED_KEY) === "1";
}

type TagTreeNode = {
  segment: string;
  fullPath: string;
  isLeaf: boolean;
  ownCount: number | null;
  totalCount: number | null;
  children: TagTreeNode[];
};

function computeTreeTotals(node: TagTreeNode): number | null {
  let sum = node.ownCount ?? 0;
  let hasCount = node.ownCount !== null;
  for (const child of node.children) {
    const c = computeTreeTotals(child);
    if (c !== null) {
      sum += c;
      hasCount = true;
    }
  }
  node.totalCount = hasCount ? sum : null;
  return node.totalCount;
}

function buildTagTree(items: Array<{ name: string; count: number | null }>): TagTreeNode[] {
  const roots: TagTreeNode[] = [];
  const byPath = new Map<string, TagTreeNode>();

  for (const item of [...items].sort((a, b) => a.name.localeCompare(b.name))) {
    const parts = item.name.split("::");
    let parentChildren = roots;
    for (let i = 0; i < parts.length; i++) {
      const fullPath = parts.slice(0, i + 1).join("::");
      let node = byPath.get(fullPath);
      if (!node) {
        node = {
          segment: parts[i],
          fullPath,
          isLeaf: false,
          ownCount: null,
          totalCount: null,
          children: [],
        };
        byPath.set(fullPath, node);
        parentChildren.push(node);
      }
      if (i === parts.length - 1) {
        node.isLeaf = true;
        node.ownCount = item.count;
      }
      parentChildren = node.children;
    }
  }

  for (const root of roots) {
    computeTreeTotals(root);
  }
  return roots;
}

/** Resizable, collapsible, searchable hierarchical tag filter & management sidebar inside Browse. */
export function TagSidebar({ onFilter }: { onFilter: (tag: string) => void }) {
  const queryClient = useQueryClient();
  const hasCountCmd = typeof ipc.listTagCounts === "function";

  const tagCountsQuery = useQuery({
    queryKey: queryKeys.tagCounts,
    queryFn: () => ipc.listTagCounts(),
    enabled: hasCountCmd,
  });
  const tagsFallbackQuery = useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => ipc.listTags(),
    enabled: !hasCountCmd,
  });

  const tagItems: Array<{ name: string; count: number | null }> = useMemo(() => {
    if (hasCountCmd && tagCountsQuery.data) {
      return tagCountsQuery.data.map((tc: TagCount) => ({ name: tc.name, count: tc.count }));
    }
    if (tagsFallbackQuery.data) {
      return tagsFallbackQuery.data.map((name) => ({ name, count: null }));
    }
    return [];
  }, [hasCountCmd, tagCountsQuery.data, tagsFallbackQuery.data]);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [width, setWidth] = useState<number>(readTagsWidth);
  const [collapsed, setCollapsed] = useState<boolean>(readTagsCollapsed);
  const [isResizing, setIsResizing] = useState(false);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    localStorage.setItem(TAGS_WIDTH_KEY, String(width));
  }, [width]);

  useEffect(() => {
    localStorage.setItem(TAGS_COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  const renameMut = useMutation({
    mutationFn: ({ old, next }: { old: string; next: string }) => ipc.renameTag(old, next),
    onSuccess: () => {
      setRenaming(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
      void queryClient.invalidateQueries({ queryKey: queryKeys.cardsAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (tag: string) => ipc.deleteTag(tag),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
      void queryClient.invalidateQueries({ queryKey: queryKeys.cardsAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      resizeCleanupRef.current?.();
      setIsResizing(true);
      const target = e.currentTarget;
      const pointerId = e.pointerId;
      if (typeof target.setPointerCapture === "function") {
        try {
          target.setPointerCapture(pointerId);
        } catch {
          // Synthetic pointer events in tests may lack an active pointer id.
        }
      }
      const startX = e.clientX;
      const startWidth = width;

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX;
        const next = startWidth + (document.documentElement.dir === "rtl" ? -delta : delta);
        setWidth(Math.max(MIN_TAG_WIDTH, Math.min(MAX_TAG_WIDTH, Math.round(next))));
      };

      const cleanup = () => {
        setIsResizing(false);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", cleanup);
        document.removeEventListener("pointercancel", cleanup);
        if (typeof target.releasePointerCapture === "function") {
          try {
            if (target.hasPointerCapture?.(pointerId)) {
              target.releasePointerCapture(pointerId);
            }
          } catch {
            // ignore
          }
        }
        resizeCleanupRef.current = null;
      };

      resizeCleanupRef.current = cleanup;
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", cleanup);
      document.addEventListener("pointercancel", cleanup);
    },
    [width],
  );

  const handleResizeKeyDown = (e: React.KeyboardEvent) => {
    const rtl = document.documentElement.dir === "rtl";
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setWidth((w) =>
        Math.max(
          MIN_TAG_WIDTH,
          Math.min(MAX_TAG_WIDTH, w + (rtl ? -KEYBOARD_RESIZE_STEP : KEYBOARD_RESIZE_STEP)),
        ),
      );
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setWidth((w) =>
        Math.max(
          MIN_TAG_WIDTH,
          Math.min(MAX_TAG_WIDTH, w + (rtl ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP)),
        ),
      );
    } else if (e.key === "Home") {
      e.preventDefault();
      setWidth(MIN_TAG_WIDTH);
    } else if (e.key === "End") {
      e.preventDefault();
      setWidth(MAX_TAG_WIDTH);
    }
  };

  const needle = search.trim().toLowerCase();
  const visibleItems = useMemo(() => {
    if (!needle) return tagItems;
    return tagItems.filter((item) => item.name.toLowerCase().includes(needle));
  }, [tagItems, needle]);

  const tree = useMemo(() => buildTagTree(visibleItems), [visibleItems]);
  const tagError = renameMut.error ?? deleteMut.error;

  const renderNode = (node: TagTreeNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = needle ? hasChildren : expanded.has(node.fullPath);
    const displayCount = node.ownCount ?? node.totalCount;

    return (
      <li key={node.fullPath}>
        <div
          className="group flex items-center gap-1 rounded-md py-1 pe-2 transition-colors hover:bg-sidebar-accent/60"
          style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
        >
          {renaming === node.fullPath ? (
            <form
              className="flex flex-1 items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (renameValue.trim() && renameValue.trim() !== node.fullPath) {
                  renameMut.mutate({ old: node.fullPath, next: renameValue.trim() });
                } else {
                  setRenaming(null);
                }
              }}
            >
              <input
                autoFocus
                aria-label={t("common.rename")}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="h-6 flex-1 rounded border border-input bg-background px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
              <button
                type="submit"
                aria-label={t("common.save")}
                title={t("common.save")}
                className="text-primary hover:opacity-70"
              >
                <Save className="size-3" />
              </button>
              <button
                type="button"
                aria-label={t("common.cancel")}
                title={t("common.cancel")}
                onClick={() => setRenaming(null)}
                className="text-muted-foreground hover:opacity-70"
              >
                <X className="size-3" />
              </button>
            </form>
          ) : (
            <>
              {hasChildren ? (
                <button
                  type="button"
                  aria-label={
                    isExpanded
                      ? t("browse.tags.collapse", { tag: node.fullPath })
                      : t("browse.tags.expand", { tag: node.fullPath })
                  }
                  onClick={() => toggleExpand(node.fullPath)}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  {isExpanded ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5 rtl:-scale-x-100" />
                  )}
                </button>
              ) : (
                <span className="size-3.5 shrink-0" />
              )}
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-start text-xs font-medium text-sidebar-foreground hover:text-foreground"
                onClick={() => onFilter(node.fullPath)}
                title={t("browse.tags.searchTag", { tag: node.fullPath })}
              >
                {node.segment}
              </button>
              {displayCount !== null && (
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {formatNumber(displayCount)}
                </span>
              )}
              {node.isLeaf && (
                <>
                  <button
                    type="button"
                    className="inline-flex opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setRenaming(node.fullPath);
                      setRenameValue(node.fullPath);
                    }}
                    aria-label={t("browse.tags.renameTag", { tag: node.fullPath })}
                    title={t("browse.tags.renameTag", { tag: node.fullPath })}
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(node.fullPath)}
                    aria-label={t("browse.tags.deleteTag", { tag: node.fullPath })}
                    title={t("browse.tags.deleteTag", { tag: node.fullPath })}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </>
              )}
            </>
          )}
        </div>
        {hasChildren && isExpanded && <ul>{node.children.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  if (collapsed) {
    return (
      <aside className="glass-chrome flex w-10 shrink-0 flex-col items-center border-e border-border py-2">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label={t("browse.tags.expandPanel")}
          aria-expanded="false"
          title={t("browse.tags.expandPanel")}
          className="flex flex-col items-center gap-2 rounded-md p-1.5 text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          <Tag className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      style={{ width }}
      className={`glass-chrome relative flex shrink-0 flex-col border-e border-border ${
        isResizing ? "select-none" : ""
      }`}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("browse.tags")}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label={t("browse.tags.collapsePanel")}
          aria-expanded="true"
          title={t("browse.tags.collapsePanel")}
          className="rounded p-1 text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
        </button>
      </div>

      <div className="shrink-0 px-2 pt-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("browse.tags.filterPlaceholder")}
            aria-label={t("browse.tags.filterLabel")}
            className="h-7 w-full rounded-md border border-input bg-background/80 ps-7 pe-6 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          {search && (
            <button
              type="button"
              aria-label={t("browse.clear")}
              onClick={() => setSearch("")}
              className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {tagError ? (
          <p role="alert" className="px-2 pb-2 text-xs text-destructive">
            {String((tagError as Error).message)}
          </p>
        ) : null}
        {tagItems.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">{t("browse.tags.none")}</p>
        ) : tree.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">{t("browse.tags.noMatches")}</p>
        ) : (
          <ul className="space-y-0.5">{tree.map((node) => renderNode(node, 0))}</ul>
        )}
      </div>

      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={t("browse.tags.resize")}
        aria-valuemin={MIN_TAG_WIDTH}
        aria-valuemax={MAX_TAG_WIDTH}
        aria-valuenow={width}
        onPointerDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
        className={`group/handle absolute end-0 top-0 z-10 -me-1 flex h-full w-2 cursor-col-resize items-center justify-center transition-colors hover:bg-primary/20 focus-visible:bg-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          isResizing ? "bg-primary/30" : ""
        }`}
      >
        <span
          data-testid="tags-resize-grip"
          aria-hidden="true"
          className={`w-0.5 rounded-full transition-all ${
            isResizing
              ? "h-12 bg-primary"
              : "h-8 bg-border group-hover/handle:h-12 group-hover/handle:bg-primary group-focus-visible/handle:h-12 group-focus-visible/handle:bg-primary"
          }`}
        />
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("browse.tags.deleteTitle")}
        description={deleteTarget ? t("browse.tags.deleteConfirm", { tag: deleteTarget }) : ""}
        confirmLabel={t("common.delete")}
        isPending={deleteMut.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMut.mutate(deleteTarget, {
              onSuccess: () => setDeleteTarget(null),
            });
          }
        }}
      />
    </aside>
  );
}
