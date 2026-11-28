interface LegendEntry {
  value?: string;
  color?: string;
}

/**
 * RTL-safe HTML legend for Recharts panels.
 * Recharts' default SVG `<Legend>` positions icons assuming LTR; flex layout
 * mirrors cleanly in Arabic (`dir="rtl"`).
 */
export function renderChartLegend(props: { payload?: ReadonlyArray<LegendEntry> }) {
  const payload = props.payload;
  if (!payload || payload.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-foreground">
      {payload.map((entry, i) => (
        <li key={`${entry.value ?? "item"}-${i}`} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: entry.color }}
            aria-hidden="true"
          />
          <span>{entry.value}</span>
        </li>
      ))}
    </ul>
  );
}
