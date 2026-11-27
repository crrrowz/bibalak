import type { DeckSummary } from "@bibalak/ipc-types";
import { formatNumber, t, tn } from "@/lib/i18n";

/**
 * Glanceable "N new · M learning · K to review today" line for the deck
 * page header. Sums only top-level decks — counts are already rolled up
 * over each deck's subtree, so summing every row would double-count.
 */
export function TodaySummary({ decks }: { decks: DeckSummary[] }) {
  if (decks.length === 0) return t("summary.empty");

  const topLevel = decks.filter((d) => d.parent_id === null || d.is_filtered);
  const totals = topLevel.reduce(
    (acc, d) => ({
      new: acc.new + d.new_count,
      learning: acc.learning + d.learning_count,
      review: acc.review + d.review_count,
    }),
    { new: 0, learning: 0, review: 0 },
  );
  const total = totals.new + totals.learning + totals.review;

  if (total === 0) {
    return <span className="text-emerald-600 dark:text-emerald-400">{t("summary.caughtUp")}</span>;
  }

  const parts: string[] = [];
  if (totals.new > 0) parts.push(t("summary.new", { count: formatNumber(totals.new) }));
  if (totals.learning > 0) {
    parts.push(t("summary.learning", { count: formatNumber(totals.learning) }));
  }
  if (totals.review > 0) parts.push(t("summary.review", { count: formatNumber(totals.review) }));
  const fullText = t("summary.today", { parts: parts.join(" · ") });
  const shortText = tn("summary.dueShort", total);

  return (
    <>
      <span className="hidden xl:inline">{fullText}</span>
      <span className="inline xl:hidden">{shortText}</span>
    </>
  );
}
