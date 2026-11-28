import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  WORKLOAD_TICKS,
  axisProps,
  categorical,
  gridProps,
  tooltipItemStyle,
  tooltipLabelStyle,
  tooltipStyle,
} from "./chartTheme";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { formatNumber, t } from "@/lib/i18n";

export function WorkloadSimulatorChart({
  deckId,
  desiredRetention,
  newPerDay,
  weights,
}: {
  deckId: number;
  desiredRetention: number;
  newPerDay: number;
  weights: number[];
}) {
  const [horizonDays, setHorizonDays] = useState<30 | 90>(30);

  const simQuery = useQuery({
    queryKey: queryKeys.statsSimulateWorkload(
      deckId,
      desiredRetention,
      newPerDay,
      horizonDays,
      weights,
    ),
    queryFn: () => ipc.simulateWorkload(deckId, desiredRetention, newPerDay, horizonDays, weights),
    placeholderData: keepPreviousData,
  });

  const data = simQuery.data;

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">{t("options.simulator.title")}</p>
        <div className="inline-flex rounded border border-border bg-secondary/40 p-0.5">
          {([30, 90] as const).map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHorizonDays(h)}
              className={[
                "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                horizonDays === h
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {h === 30 ? t("options.simulator.horizon30") : t("options.simulator.horizon90")}
            </button>
          ))}
        </div>
      </div>

      {simQuery.isError ? (
        <p className="text-xs text-destructive">{t("options.simulator.error")}</p>
      ) : data ? (
        <>
          <p className="text-xs text-muted-foreground">
            {t("options.simulator.summary", {
              curTotal: formatNumber(data.total_current_reviews),
              curMin: formatNumber(data.avg_daily_minutes_current, { maximumFractionDigits: 1 }),
              propTotal: formatNumber(data.total_proposed_reviews),
              propMin: formatNumber(data.avg_daily_minutes_proposed, { maximumFractionDigits: 1 }),
            })}
          </p>
          <ResponsiveContainer width="100%" height={165}>
            <LineChart data={data.days} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
              <CartesianGrid {...gridProps} vertical={false} />
              <XAxis
                dataKey="day"
                {...axisProps}
                ticks={[...WORKLOAD_TICKS[horizonDays]]}
                tickFormatter={(d) => formatNumber(Number(d) + 1)}
              />
              <YAxis {...axisProps} allowDecimals={false} tickFormatter={(v) => formatNumber(v)} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                labelFormatter={(d) =>
                  t("options.simulator.dayLabel", { day: formatNumber(Number(d) + 1) })
                }
                formatter={(value, name) => [
                  t("options.simulator.reviewsPerDay", { count: formatNumber(Number(value ?? 0)) }),
                  String(name),
                ]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="current_reviews"
                name={t("options.simulator.current", {
                  min: formatNumber(data.avg_daily_minutes_current, { maximumFractionDigits: 1 }),
                })}
                stroke={categorical[1]}
                strokeWidth={1.75}
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="proposed_reviews"
                name={t("options.simulator.proposed", {
                  min: formatNumber(data.avg_daily_minutes_proposed, { maximumFractionDigits: 1 }),
                })}
                stroke={categorical[0]}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </>
      ) : null}
    </div>
  );
}
