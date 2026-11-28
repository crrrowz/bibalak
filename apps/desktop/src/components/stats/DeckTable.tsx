import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { DeckStat } from "@bibalak/ipc-types";
import { cn } from "@/lib/utils";
import { ExportButton } from "./ExportButton";
import { t, formatNumber } from "@/lib/i18n";

type SortKey =
  | "name"
  | "total_cards"
  | "due_today"
  | "new_count"
  | "learning_count"
  | "young_count"
  | "mature_count"
  | "suspended_count"
  | "retention_pct"
  | "reviews_7d";

interface DeckNode extends DeckStat {
  children: DeckNode[];
  rollup: DeckStat;
}

function buildTree(rows: DeckStat[], filteredIds: Set<number>): DeckNode[] {
  const byId = new Map<number, DeckNode>();
  for (const r of rows) {
    byId.set(r.deck_id, { ...r, children: [], rollup: { ...r } });
  }
  const roots: DeckNode[] = [];
  for (const node of byId.values()) {
    if (!filteredIds.has(node.deck_id) && node.parent_id !== null && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Roll up totals/new/due from children into every ancestor; retention stays
  // per-deck (averaging percentages across decks of different sizes is misleading).
  function rollup(node: DeckNode): DeckStat {
    let total = node.total_cards;
    let due = node.due_today;
    let newCount = node.new_count;
    let reviews7d = node.reviews_7d;
    let learning = node.learning_count;
    let young = node.young_count;
    let mature = node.mature_count;
    let suspended = node.suspended_count;
    for (const child of node.children) {
      const r = rollup(child);
      total += r.total_cards;
      due += r.due_today;
      newCount += r.new_count;
      reviews7d += r.reviews_7d;
      learning += r.learning_count;
      young += r.young_count;
      mature += r.mature_count;
      suspended += r.suspended_count;
    }
    node.rollup = {
      ...node,
      total_cards: total,
      due_today: due,
      new_count: newCount,
      reviews_7d: reviews7d,
      learning_count: learning,
      young_count: young,
      mature_count: mature,
      suspended_count: suspended,
    };
    return node.rollup;
  }
  for (const root of roots) rollup(root);

  const sortByName = (a: DeckNode, b: DeckNode) => a.name.localeCompare(b.name);
  const sortTree = (nodes: DeckNode[]) => {
    nodes.sort(sortByName);
    for (const n of nodes) sortTree(n.children);
  };
  sortTree(roots);
  return roots;
}

function leafLabel(name: string): string {
  const parts = name.split("::");
  return parts[parts.length - 1];
}

export function DeckTable({
  deckStats,
  filteredDeckIds = [],
  onSelectDeck,
}: {
  deckStats: DeckStat[];
  filteredDeckIds?: number[];
  onSelectDeck: (deckId: number) => void;
}) {
  const filteredKey = filteredDeckIds.join(",");
  const filteredSet = useMemo(
    () => new Set(filteredKey ? filteredKey.split(",").map(Number) : []),
    [filteredKey],
  );
  const tree = useMemo(() => buildTree(deckStats, filteredSet), [deckStats, filteredSet]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDesc, setSortDesc] = useState(false);

  const toggle = (id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const cycleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(false);
    }
  };

  const compareByKey = (a: DeckNode, b: DeckNode) => {
    const av = sortKey === "name" ? a.name : (a.rollup[sortKey] ?? -1);
    const bv = sortKey === "name" ? b.name : (b.rollup[sortKey] ?? -1);
    const cmp =
      typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortDesc ? -cmp : cmp;
  };

  const sorted = useMemo(() => {
    function sortSiblings(nodes: DeckNode[]): DeckNode[] {
      return [...nodes]
        .sort(compareByKey)
        .map((n) => ({ ...n, children: sortSiblings(n.children) }));
    }
    return sortSiblings(tree);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, sortKey, sortDesc]);

  const rows: { node: DeckNode; depth: number }[] = [];
  function flatten(nodes: DeckNode[], depth: number) {
    for (const n of nodes) {
      rows.push({ node: n, depth });
      if (!collapsed.has(n.deck_id)) flatten(n.children, depth + 1);
    }
  }
  flatten(sorted, 0);

  const columns: { key: SortKey; label: string }[] = [
    { key: "name", label: t("browse.col.deck") },
    { key: "total_cards", label: t("stats.col.cards") },
    { key: "due_today", label: t("decks.col.due") },
    { key: "new_count", label: t("decks.col.new") },
    { key: "learning_count", label: t("stats.phase.learning") },
    { key: "young_count", label: t("stats.phase.young") },
    { key: "mature_count", label: t("stats.phase.mature") },
    { key: "suspended_count", label: t("stats.phase.suspended") },
    { key: "retention_pct", label: t("stats.card.retention") },
    { key: "reviews_7d", label: t("stats.col.reviews7d") },
  ];

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <ExportButton filename="deck-stats" rows={deckStats.map((d) => ({ ...d }))} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-border text-start text-xs text-muted-foreground">
              {columns.map((col) => (
                <th
                  key={col.key}
                  aria-sort={sortKey === col.key ? (sortDesc ? "descending" : "ascending") : "none"}
                  className={cn("py-2 pe-3 font-medium", col.key !== "name" && "text-end")}
                >
                  <button
                    type="button"
                    onClick={() => cycleSort(col.key)}
                    className={cn(
                      "inline-flex select-none items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      col.key !== "name" && "justify-end",
                    )}
                  >
                    {col.label}
                    {sortKey === col.key ? (sortDesc ? " ↓" : " ↑") : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ node, depth }) => (
              <tr
                key={node.deck_id}
                className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-secondary/40"
                onClick={() => onSelectDeck(node.deck_id)}
              >
                <td className="py-1.5 pe-3" style={{ paddingInlineStart: depth * 16 }}>
                  <span className="inline-flex items-center gap-1">
                    {node.children.length > 0 ? (
                      <button
                        type="button"
                        aria-expanded={!collapsed.has(node.deck_id)}
                        aria-label={
                          collapsed.has(node.deck_id) ? t("decks.expand") : t("decks.collapse")
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(node.deck_id);
                        }}
                        className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {collapsed.has(node.deck_id) ? (
                          <ChevronRight className="size-3.5 rtl:-scale-x-100" />
                        ) : (
                          <ChevronDown className="size-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="w-3.5" />
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectDeck(node.deck_id);
                      }}
                      className="text-start hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {leafLabel(node.name)}
                    </button>
                    {filteredSet.has(node.deck_id) && (
                      <span className="ms-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {t("decks.filteredBadge")}
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-1.5 pe-3 text-end tabular-nums">
                  {formatNumber(node.rollup.total_cards)}
                </td>
                <td className="py-1.5 pe-3 text-end tabular-nums">
                  {formatNumber(node.rollup.due_today)}
                </td>
                <td className="py-1.5 pe-3 text-end tabular-nums">
                  {formatNumber(node.rollup.new_count)}
                </td>
                <td className="py-1.5 pe-3 text-end tabular-nums">
                  {formatNumber(node.rollup.learning_count)}
                </td>
                <td className="py-1.5 pe-3 text-end tabular-nums">
                  {formatNumber(node.rollup.young_count)}
                </td>
                <td className="py-1.5 pe-3 text-end tabular-nums">
                  {formatNumber(node.rollup.mature_count)}
                </td>
                <td className="py-1.5 pe-3 text-end tabular-nums">
                  {formatNumber(node.rollup.suspended_count)}
                </td>
                <td className="py-1.5 pe-3 text-end tabular-nums">
                  {node.retention_pct !== null
                    ? `${formatNumber(node.retention_pct, { maximumFractionDigits: 0 })}%`
                    : "—"}
                </td>
                <td className="py-1.5 pe-3 text-end tabular-nums">
                  {formatNumber(node.rollup.reviews_7d)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
