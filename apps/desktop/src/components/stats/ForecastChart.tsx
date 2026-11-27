import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DayCount } from "@bibalak/ipc-types";
import {
  axisProps,
  categorical,
  gridProps,
  tooltipCursor,
  tooltipItemStyle,
  tooltipLabelStyle,
  tooltipStyle,
} from "./chartTheme";
import { ExportButton } from "./ExportButton";
import { forecastQuery } from "./statQuery";
import { formatNumber, t, tn } from "@/lib/i18n";

const FORECAST_DAYS = 30;
const BACKLOG_COLOR = "hsl(1 74% 59%)"; // status-adjacent red, distinct from the categorical due-bar color

export function ForecastChart({
  forecast,
  backlogCount,
  today,
  onDrill,
  deckName,
}: {
  forecast: DayCount[];
  backlogCount: number;
  today: number;
  onDrill: (query: string) => void;
  deckName: string | null;
}) {
  const map = new Map(forecast.map((d) => [d.day, d.count]));
  const data = [
    {
      label: t("stats.forecast.overdueLabel"),
      count: backlogCount,
      isBacklog: true,
      dayOffset: null as number | null,
    },
    ...Array.from({ length: FORECAST_DAYS + 1 }, (_, i) => ({
      label: i === 0 ? t("stats.forecast.today") : `+${formatNumber(i)}`,
      count: map.get(i) ?? 0,
      isBacklog: false,
      dayOffset: i,
    })),
  ];

  const dueTotal = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="relative">
      <div className="absolute end-0 top-0">
        <ExportButton filename="forecast" rows={data} />
      </div>
      <p className="mb-2 text-xs text-muted-foreground tabular-nums">
        {tn("stats.forecast.summary", dueTotal)}
        {backlogCount > 0 ? (
          <> {t("stats.forecast.overdue", { count: formatNumber(backlogCount) })}</>
        ) : null}
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="label" {...axisProps} interval={4} />
          <YAxis allowDecimals={false} {...axisProps} />
          <Tooltip
            contentStyle={tooltipStyle}
            itemStyle={tooltipItemStyle}
            labelStyle={tooltipLabelStyle}
            cursor={tooltipCursor}
          />
          <Bar
            dataKey="count"
            radius={[3, 3, 0, 0]}
            onClick={(d) => {
              const payload = d.payload as (typeof data)[number];
              onDrill(forecastQuery(payload.dayOffset, today, deckName));
            }}
          >
            {data.map((d) => (
              <Cell
                key={d.label}
                fill={d.isBacklog ? BACKLOG_COLOR : categorical[0]}
                cursor="pointer"
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
