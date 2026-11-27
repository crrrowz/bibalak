import { Flame, Sparkles, TrendingUp } from "lucide-react";
import type { DayCount, HourlyStat } from "@bibalak/ipc-types";
import { t, tn, formatDate } from "@/lib/i18n";

function bestHour(hourly: HourlyStat[]): string | null {
  const candidates = hourly.filter((h) => h.total >= 20);
  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) => (b.passed / b.total > a.passed / a.total ? b : a));
  return formatDate(new Date(2000, 0, 1, best.hour), { hour: "numeric" });
}

function busiestWeekday(
  reviews: DayCount[],
  day0Ms?: number,
  dates?: Record<number, string>,
): string | null {
  if (reviews.length === 0) return null;
  const totals = new Array(7).fill(0);
  for (const d of reviews) {
    let weekday: number;
    const dateStr = d.date || dates?.[d.day];
    if (dateStr) {
      const [y, m, day] = dateStr.split("-").map(Number);
      weekday = new Date(y, m - 1, day).getDay();
    } else {
      weekday = new Date((day0Ms ?? 0) + d.day * 86_400_000).getDay();
    }
    totals[weekday] += d.count;
  }
  const maxIdx = totals.indexOf(Math.max(...totals));
  // 2000-01-02 was a Sunday, so day 2 + index gives that weekday.
  return formatDate(new Date(2000, 0, 2 + maxIdx), { weekday: "short" });
}

function Insight({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Flame;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <Icon className="size-4 text-primary" />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function InsightsRow({
  reviews,
  hourly,
  day0Ms,
  dates,
  longestStreak,
}: {
  reviews: DayCount[];
  hourly: HourlyStat[];
  day0Ms?: number;
  dates?: Record<number, string>;
  longestStreak: number;
}) {
  const hour = bestHour(hourly);
  const weekday = busiestWeekday(reviews, day0Ms, dates);

  if (!hour && !weekday && longestStreak === 0) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {hour ? <Insight icon={Sparkles} label={t("stats.insight.bestHour")} value={hour} /> : null}
      {weekday ? (
        <Insight icon={TrendingUp} label={t("stats.insight.busiestDay")} value={weekday} />
      ) : null}
      {longestStreak > 0 ? (
        <Insight
          icon={Flame}
          label={t("stats.insight.longestStreak")}
          value={tn("common.days", longestStreak)}
        />
      ) : null}
    </div>
  );
}
