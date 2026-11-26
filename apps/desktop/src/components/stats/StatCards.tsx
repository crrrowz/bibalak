import { useEffect, useRef } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { Flame, type LucideIcon } from "lucide-react";
import type { StatsDto } from "@bibalak/ipc-types";
import { t, formatNumber } from "@/lib/i18n";

function CountUp({ value, format }: { value: number; format?: (n: number) => string }) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => (format ? format(v) : formatNumber(Math.round(v))));
  const prev = useRef(0);

  useEffect(() => {
    if (reduced) {
      mv.set(value);
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration: 0.6,
      ease: [0.2, 0, 0, 1],
      onUpdate: (v) => mv.set(v),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, mv, reduced]);

  return <motion.span>{text}</motion.span>;
}

function StatCard({
  label,
  value,
  format,
  icon: Icon,
  title,
}: {
  label: string;
  value: number | null;
  format?: (n: number) => string;
  icon?: LucideIcon;
  title?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4" title={title}>
      <div className="flex items-center justify-between gap-1">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {Icon ? <Icon className="size-3.5 text-muted-foreground" /> : null}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {value === null ? "—" : <CountUp value={value} format={format} />}
      </div>
    </div>
  );
}

function formatTime(n: number): string {
  const minutes = Math.round(n / 60000);
  return minutes >= 60
    ? t("stats.unit.hours", {
        n: formatNumber(minutes / 60, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      })
    : t("stats.unit.minutes", { n: formatNumber(minutes) });
}

export function StatCards({ stats, streak }: { stats: StatsDto; streak: number }) {
  const avgSec = stats.total_reviews > 0 ? stats.total_time_ms / stats.total_reviews / 1000 : 0;
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      <StatCard label={t("stats.card.reviews")} value={stats.total_reviews} />
      <StatCard
        label={t("stats.card.retention")}
        value={stats.retention_pct}
        format={(n) => `${formatNumber(n, { maximumFractionDigits: 0 })}%`}
        title={t("stats.card.retentionTooltip")}
      />
      <StatCard
        label={t("stats.card.streak")}
        value={streak}
        icon={Flame}
        format={(n) => formatNumber(Math.round(n))}
      />
      <StatCard label={t("stats.card.daysStudied")} value={stats.studied_days} />
      <StatCard label={t("stats.card.time")} value={stats.total_time_ms} format={formatTime} />
      <StatCard
        label={t("stats.card.avgPerCard")}
        value={avgSec}
        format={(n) =>
          t("stats.unit.seconds", {
            n: formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
          })
        }
      />
    </div>
  );
}
