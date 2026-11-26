import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RetentionWeek } from "@bibalak/ipc-types";
import {
  axisProps,
  categorical,
  gridProps,
  tooltipItemStyle,
  tooltipLabelStyle,
  tooltipStyle,
} from "./chartTheme";
import { ExportButton } from "./ExportButton";
import { t, formatDate, formatNumber } from "@/lib/i18n";

const MIN_SAMPLE = 5;

export function RetentionChart({
  weekly,
  goalPct,
  day0Ms,
  dates,
}: {
  weekly: RetentionWeek[];
  goalPct: number;
  day0Ms?: number;
  dates?: Record<number, string>;
}) {
  const dateOf = (day: number) => {
    const dateStr = dates?.[day];
    if (dateStr) {
      const [y, m, d] = dateStr.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date((day0Ms ?? 0) + day * 86_400_000);
  };

  const data = weekly.map((w) => ({
    label: formatDate(dateOf(w.week_index * 7), {
      month: "short",
      day: "numeric",
    }),
    young: w.young_total >= MIN_SAMPLE ? (w.young_passed / w.young_total) * 100 : null,
    mature: w.mature_total >= MIN_SAMPLE ? (w.mature_passed / w.mature_total) * 100 : null,
  }));

  if (weekly.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("stats.notEnoughHistory")}</p>;
  }

  return (
    <div className="relative">
      <div className="absolute end-0 top-0">
        <ExportButton filename="retention-weekly" rows={weekly.map((w) => ({ ...w }))} />
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
          <YAxis domain={[0, 100]} {...axisProps} />
          <ReferenceLine
            y={goalPct}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="4 4"
            label={{
              value: t("stats.retention.goal", {
                pct: formatNumber(goalPct, { maximumFractionDigits: 0 }),
              }),
              fontSize: 10,
              fill: "hsl(var(--muted-foreground))",
            }}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            itemStyle={tooltipItemStyle}
            labelStyle={tooltipLabelStyle}
            formatter={(v) =>
              typeof v === "number"
                ? `${formatNumber(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
                : v
            }
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="young"
            name={t("stats.phase.young")}
            stroke={categorical[0]}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="mature"
            name={t("stats.phase.mature")}
            stroke={categorical[1]}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
