import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { StatsDto } from "@bibalak/ipc-types";
import { categorical, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "./chartTheme";
import { maturityQuery, type MaturityBucket } from "./statQuery";
import { t } from "@/lib/i18n";

const MATURITY_COLORS: Record<string, string> = {
  New: categorical[0],
  Learning: categorical[2],
  Young: categorical[1],
  Mature: categorical[3],
  Suspended: "hsl(var(--muted-foreground))",
};

const MATURITY_BUCKETS: Record<string, MaturityBucket> = {
  New: "new",
  Learning: "learning",
  Young: "young",
  Mature: "mature",
  Suspended: "suspended",
};

export function MaturityDonut({
  stats,
  onDrill,
  deckName,
}: {
  stats: StatsDto;
  onDrill: (query: string) => void;
  deckName: string | null;
}) {
  const data = [
    { key: "New", name: t("stats.phase.new"), value: stats.new_count },
    { key: "Learning", name: t("stats.phase.learning"), value: stats.learning_count },
    { key: "Young", name: t("stats.phase.young"), value: stats.young_count },
    { key: "Mature", name: t("stats.phase.mature"), value: stats.mature_count },
    { key: "Suspended", name: t("stats.phase.suspended"), value: stats.suspended_count },
  ].filter((d) => d.value > 0);

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("stats.noCards")}</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={45}
          outerRadius={75}
          paddingAngle={2}
          stroke="none"
          cursor="pointer"
          onClick={(d) => {
            const payload = d.payload as { key: string };
            onDrill(maturityQuery(MATURITY_BUCKETS[payload.key], deckName));
          }}
        >
          {data.map((entry) => (
            <Cell key={entry.key} fill={MATURITY_COLORS[entry.key]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={tooltipStyle}
          itemStyle={tooltipItemStyle}
          labelStyle={tooltipLabelStyle}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
