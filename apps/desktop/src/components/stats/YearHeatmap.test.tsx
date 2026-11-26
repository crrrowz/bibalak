import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { YearHeatmap } from "./YearHeatmap";
import { computeStreaks } from "./heatmapUtils";
import { formatDate } from "@/lib/i18n";
import type { DayCount } from "@bibalak/ipc-types";

describe("YearHeatmap & computeStreaks (S1)", () => {
  it("uses backend today to compute alive streaks even when now - day0_ms would disagree", () => {
    // Backend collection day 1 is today (e.g. after midnight local before rollover)
    const today = 1;
    const reviews: DayCount[] = [
      { day: 0, count: 5, date: "2026-11-13" },
      { day: 1, count: 8, date: "2026-11-14" },
    ];
    const streaks = computeStreaks(reviews, today);
    expect(streaks.current).toBe(2);
    expect(streaks.longest).toBe(2);
  });

  it("renders cell tooltips using dates provided by backend", () => {
    const today = 1;
    const reviews: DayCount[] = [{ day: 1, count: 3, date: "2026-11-14" }];
    const dates: Record<number, string> = {
      0: "2026-11-13",
      1: "2026-11-14",
    };
    const { container } = render(
      <YearHeatmap reviews={reviews} today={today} dates={dates} weeks={1} />,
    );
    // Find cell corresponding to today (day 1)
    const todayCell = container.querySelector('div[style*="outline: 1.5px"]');
    expect(todayCell).toBeTruthy();
    expect(todayCell?.getAttribute("title")).toContain(formatDate(new Date(2026, 10, 14)));
  });
});
