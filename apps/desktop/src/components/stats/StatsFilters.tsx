import type { DeckSummary } from "@bibalak/ipc-types";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales/en";
import type { StatsRange } from "./statsFilterUtils";

const RANGE_LABELS: { value: StatsRange; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "stats.range.all" },
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
        {decks.map((d) => (
          <option key={d.id} value={d.id}>
            {"  ".repeat(deckDepth(d.name))}
            {deckLabel(d.name)}
          </option>
        ))}
      </Select>

      <div className="flex items-center gap-1 rounded-md border border-border bg-secondary/50 p-1">
        {RANGE_LABELS.map(({ value, label }) => (
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
            {label.startsWith("stats.") ? t(label as LocaleKey) : label}
          </button>
        ))}
      </div>
    </div>
  );
}
