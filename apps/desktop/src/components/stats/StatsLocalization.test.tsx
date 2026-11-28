import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AnswerButtonsChart } from "@/components/stats/AnswerButtonsChart";
import { FsrsPanels } from "@/components/stats/FsrsPanels";
import { HourlyChart } from "@/components/stats/HourlyChart";
import { StatsFilters } from "@/components/stats/StatsFilters";
import { setLocale } from "@/lib/i18n";

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <div style={{ width: 600, height: 200 }}>{children}</div>
    ),
    BarChart: ({ data }: { data?: Array<{ label: string }> }) => (
      <div data-testid="mock-bar-chart">
        {(data ?? []).map((d) => (
          <span key={d.label}>{d.label}</span>
        ))}
      </div>
    ),
  };
});

describe("A3-15: Stats Arabic localization and RTL/chart layout", () => {
  beforeEach(() => {
    setLocale("ar");
  });

  afterEach(() => {
    setLocale("en");
  });

  it("localizes range filter buttons in Arabic instead of leaving '7d'/'1M'/'3M'/'1Y'", () => {
    render(
      <StatsFilters
        decks={[]}
        deckId={null}
        range="all"
        onDeckChange={vi.fn()}
        onRangeChange={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons.some((label) => /^(7d|1M|3M|1Y)$/.test(label ?? ""))).toBe(false);
    expect(buttons).toContain("7 أيام");
    expect(buttons).toContain("سنة");
  });

  it("localizes FSRS stability bucket axis labels in Arabic instead of '<1d'/'365d+'", () => {
    render(
      <FsrsPanels
        fsrs={{
          card_count: 10,
          stability_buckets: [2, 2, 2, 1, 1, 1, 1],
          difficulty_buckets: [1, 2, 2, 2, 1, 1, 1],
          avg_retrievability: 91,
        }}
        onDrill={vi.fn()}
        deckName={null}
      />,
    );

    expect(screen.queryByText("<1d")).toBeNull();
    expect(screen.queryByText("365d+")).toBeNull();
    expect(screen.getByText("أقل من يوم")).toBeInTheDocument();
  });

  it("HourlyChart keeps its legend in normal flow above the chart instead of absolute overlay", () => {
    const { container } = render(<HourlyChart hourly={[{ hour: 9, total: 5, passed: 4 }]} />);
    const exportBtn = screen.getByRole("button", { name: /تصدير/i });
    expect(exportBtn.parentElement?.className).not.toContain("absolute");
    expect(container.firstElementChild?.className).not.toContain("relative");
  });

  it("AnswerButtonsChart uses custom RTL-safe HTML legend renderer", () => {
    const { container } = render(
      <AnswerButtonsChart
        buttons={{ learning: [1, 0, 2, 0], young: [0, 1, 3, 1], mature: [0, 0, 5, 2] }}
        onDrill={vi.fn()}
        deckName={null}
        rangeDays={null}
      />,
    );
    expect(container.querySelector("[data-testid='mock-bar-chart']")).toBeInTheDocument();
  });
});
