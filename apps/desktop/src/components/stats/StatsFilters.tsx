import type { DeckSummary } from "@bibalak/ipc-types";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales/en";
import type { StatsRange } from "./statsFilterUtils";

const RANGE_LABELS: { value: StatsRange; labelKey: LocaleKey }[] = [
  { value: "7d", labelKey: "stats.range.7d" },
  { value: "1m", labelKey: "stats.range.1m" },
  { value: "3m", labelKey: "stats.range.3m" },
  { value: "1y", labelKey: "stats.range.1y" },
  { value: "all", labelKey: "stats.range.all" },
];

function deckDepth(name: string): number {
  return name.split("::").length - 1;
}

function deckLabel(name: string): string {
  const parts = name.split("::");
  return parts[parts.length - 1];
}

export function StatsFilters({
  decks,
  deckId,
  range,
  onDeckChange,
  onRangeChange,
}: {
  decks: DeckSummary[];
  deckId: number | null;
  range: StatsRange;
  onDeckChange: (deckId: number | null) => void;
  onRangeChange: (range: StatsRange) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Select
        aria-label={t("stats.allDecks")}
        containerClassName="w-auto"
        value={deckId ?? "all"}
        onChange={(e) => onDeckChange(e.target.value === "all" ? null : Number(e.target.value))}
      >
        <option value="all">{t("stats.allDecks")}</option>
        {decks
          .filter((d) => !d.is_filtered)
          .map((d) => (
            <option key={d.id} value={d.id}>
              {"  ".repeat(deckDepth(d.name))}
              {deckLabel(d.name)}
            </option>
          ))}
      </Select>

      <div className="flex items-center gap-1 rounded-md border border-border bg-secondary/50 p-1">
        {RANGE_LABELS.map(({ value, labelKey }) => (
          <button
            key={value}
            type="button"
            aria-pressed={range === value}
            onClick={() => onRangeChange(value)}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
              range === value
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
