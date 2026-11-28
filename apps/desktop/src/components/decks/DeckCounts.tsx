import { formatNumber, t } from "@/lib/i18n";

function CountBadge({
  count,
  color,
  columnWidth,
  label,
}: {
  count: number;
  color: string;
  columnWidth?: string;
  label?: string;
}) {
  if (count === 0 && !label) {
    // In fixed-column mode (the deck list header lines up "New/Learn/Due"
    // above these), a hidden badge still reserves its column so the visible
    // ones don't drift out from under their label.
    return columnWidth ? <span className={`inline-block ${columnWidth}`} /> : null;
  }
  const badge = (
    <span
      className={`rounded px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums ${
        count > 0 ? color : "bg-secondary/60 text-muted-foreground"
      } ${columnWidth ?? ""}`}
    >
      {formatNumber(count)}
    </span>
  );
  if (!label) return badge;
  return (
    <span className="flex flex-col items-center gap-0.5">
      {badge}
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
    </span>
  );
}

/**
 * The blue/amber/green new-learning-review badge triple shown for a deck or
 * card. Pass `columnWidth` (e.g. "w-9") when this sits under fixed column
 * headers (the deck list) so each badge reserves its slot even at zero;
 * pass `showLabels` on Grid cards so columns read cleanly without headers.
 */
export function DeckCounts({
  newCount,
  learningCount,
  reviewCount,
  columnWidth,
  showLabels = false,
}: {
  newCount: number;
  learningCount: number;
  reviewCount: number;
  columnWidth?: string;
  showLabels?: boolean;
}) {
  return (
    <span className={`flex items-center ${showLabels ? "gap-2" : "gap-1"}`}>
      <CountBadge
        count={newCount}
        color="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
        columnWidth={columnWidth}
        label={showLabels ? t("decks.col.new") : undefined}
      />
      <CountBadge
        count={learningCount}
        color="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        columnWidth={columnWidth}
        label={showLabels ? t("decks.col.learn") : undefined}
      />
      <CountBadge
        count={reviewCount}
        color="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
        columnWidth={columnWidth}
        label={showLabels ? t("decks.col.due") : undefined}
      />
    </span>
  );
}
