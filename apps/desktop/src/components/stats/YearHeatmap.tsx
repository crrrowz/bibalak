import type { DayCount } from "@bibalak/ipc-types";
import { sequential } from "./chartTheme";
import { tn, formatDate } from "@/lib/i18n";

const DEFAULT_WEEKS = 52;

function heatColor(count: number): string {
  if (count === 0) return "hsl(var(--secondary))";
  if (count < 3) return sequential[0];
  if (count < 6) return sequential[1];
  if (count < 12) return sequential[2];
  if (count < 20) return sequential[3];
  return sequential[4];
}

export function YearHeatmap({
  reviews,
  today,
  day0Ms,
  dates,
  weeks = DEFAULT_WEEKS,
}: {
  reviews: DayCount[];
  today: number;
  day0Ms?: number;
  dates?: Record<number, string>;
  /** Window width in weeks — defaults to a full year; pass a smaller value for compact use. */
  weeks?: number;
}) {
  const counts = new Map(reviews.map((d) => [d.day, d.count]));
  const days = weeks * 7;
  const start = today - (days - 1);
  const cells = Array.from({ length: days }, (_, i) => {
    const day = start + i;
    return { day, count: counts.get(day) ?? 0 };
  });

  const dateOf = (day: number) => {
    const dateStr = dates?.[day];
    if (dateStr) {
      const [y, m, d] = dateStr.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date((day0Ms ?? 0) + day * 86_400_000);
  };

  // Month labels: mark the first column (week) whose Monday falls in a new month.
  const weekCount = Math.ceil(days / 7);
  const monthLabels: { week: number; label: string }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < weekCount; w++) {
    const day = start + w * 7;
    const m = dateOf(day).getMonth();
    if (m !== lastMonth) {
      // Leave at least 3 columns per label so neighbouring names don't overlap.
      const prev = monthLabels[monthLabels.length - 1];
      if (prev && w - prev.week < 3) monthLabels.pop();
      monthLabels.push({ week: w, label: formatDate(new Date(2000, m, 1), { month: "short" }) });
      lastMonth = m;
    }
  }

  return (
    <div className="w-full">
      <div
        className="mb-1 grid text-[10px] text-muted-foreground"
        style={{ gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: weekCount }, (_, w) => {
          const label = monthLabels.find((m) => m.week === w)?.label;
          // Zero intrinsic width: long month names (e.g. Arabic) overflow into the
          // next columns instead of widening the grid.
          return (
            <span key={w} className="w-0 whitespace-nowrap">
              {label}
            </span>
          );
        })}
      </div>
      <div
        className="grid gap-[2px]"
        style={{
          gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))`,
          gridTemplateRows: "repeat(7, minmax(0, 1fr))",
          gridAutoFlow: "column",
        }}
      >
        {cells.map((cell) => (
          <div
            key={cell.day}
            title={tn("stats.heatmap.cell", cell.count, { date: formatDate(dateOf(cell.day)) })}
            className="aspect-square w-full rounded-sm transition-transform hover:scale-125"
            style={{
              backgroundColor: heatColor(cell.count),
              outline: cell.day === today ? "1.5px solid hsl(var(--foreground))" : undefined,
              outlineOffset: cell.day === today ? "-1.5px" : undefined,
            }}
          />
        ))}
      </div>
    </div>
  );
}
