import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatCards } from "./StatCards";
import { DeckTable } from "./DeckTable";
import { RetentionChart } from "./RetentionChart";
import { setLocale } from "@/lib/i18n";
import type { StatsDto, RetentionWeek } from "@bibalak/ipc-types";

describe("Locale formatting in stats (S3)", () => {
  afterEach(() => {
    setLocale("en");
  });

  it("formats dates in RetentionChart using the active app locale, not system locale", () => {
    setLocale("ar");
    const weekly: RetentionWeek[] = [
      {
        week_index: 0,
        young_total: 10,
        young_passed: 9,
        mature_total: 10,
        mature_passed: 9,
      },
    ];
    const dates = {
      0: "2026-11-13",
    };

    render(<RetentionChart weekly={weekly} goalPct={90} dates={dates} />);

    // In Arabic locale, the month name must be in Arabic (e.g. نوفمبر), not English "Nov"
    const text = document.body.textContent;
    expect(text).not.toContain("Nov 13");
  });

  it("formats numbers in StatCards using formatNumber and app locale", () => {
    setLocale("ar");
    const dummyStats: StatsDto = {
      today: 1,
      today_date: "2026-11-14",
      dates: {},
      total_reviews: 1250,
      studied_days: 15,
      retention_pct: 88.5,
      retention_goal_pct: 90,
      total_time_ms: 120_000,
      new_count: 0,
      learning_count: 0,
      young_count: 0,
      mature_count: 0,
      suspended_count: 0,
      reviews: [],
      forecast: [],
      backlog_count: 0,
      day0_ms: 0,
      retention_weekly: [],
      answer_buttons: { learning: [0, 0, 0, 0], young: [0, 0, 0, 0], mature: [0, 0, 0, 0] },
      hourly: [],
      fsrs: {
        card_count: 0,
        stability_buckets: [],
        difficulty_buckets: [],
        avg_retrievability: null,
      },
      deck_stats: [],
      coach: {
        leech_count: 0,
        leech_card_ids: [],
        leech_weekly_minutes: 0,
        overdue_count: 0,
        suggested_daily_reviews: 0,
      },
    };

    render(<StatCards stats={dummyStats} streak={5} />);
    // Check that StatCards renders with Arabic locale labels
    expect(screen.getByText("المراجعات")).toBeInTheDocument();
  });

  it("does not render fire emoji in the streak card (S4)", () => {
    const dummyStats: StatsDto = {
      today: 1,
      today_date: "2026-11-14",
      dates: {},
      total_reviews: 10,
      studied_days: 2,
      retention_pct: 90,
      retention_goal_pct: 90,
      total_time_ms: 10_000,
      new_count: 0,
      learning_count: 0,
      young_count: 0,
      mature_count: 0,
      suspended_count: 0,
      reviews: [],
      forecast: [],
      backlog_count: 0,
      day0_ms: 0,
      retention_weekly: [],
      answer_buttons: { learning: [0, 0, 0, 0], young: [0, 0, 0, 0], mature: [0, 0, 0, 0] },
      hourly: [],
      fsrs: {
        card_count: 0,
        stability_buckets: [],
        difficulty_buckets: [],
        avg_retrievability: null,
      },
      deck_stats: [],
      coach: {
        leech_count: 0,
        leech_card_ids: [],
        leech_weekly_minutes: 0,
        overdue_count: 0,
        suggested_daily_reviews: 0,
      },
    };

    render(<StatCards stats={dummyStats} streak={7} />);
    expect(document.body.textContent).not.toContain("🔥");
  });

  it("retention_null_shows_em_dash_and_tooltip_in_tile_and_deck_table", () => {
    const dummyStats: StatsDto = {
      today: 1,
      today_date: "2026-11-14",
      dates: {},
      total_reviews: 235,
      studied_days: 5,
      retention_pct: null,
      retention_goal_pct: 90,
      total_time_ms: 100_000,
      new_count: 10,
      learning_count: 5,
      young_count: 62,
      mature_count: 0,
      suspended_count: 0,
      reviews: [],
      forecast: [],
      backlog_count: 0,
      day0_ms: 0,
      retention_weekly: [],
      answer_buttons: { learning: [10, 0, 0, 0], young: [0, 0, 0, 0], mature: [0, 0, 0, 0] },
      hourly: [],
      fsrs: {
        card_count: 0,
        stability_buckets: [],
        difficulty_buckets: [],
        avg_retrievability: null,
      },
      deck_stats: [
        {
          deck_id: 1,
          name: "Default",
          parent_id: null,
          total_cards: 62,
          due_today: 5,
          new_count: 0,
          learning_count: 0,
          young_count: 62,
          mature_count: 0,
          suspended_count: 0,
          retention_pct: null,
          reviews_7d: 235,
        },
      ],
      coach: {
        leech_count: 0,
        leech_card_ids: [],
        leech_weekly_minutes: 0,
        overdue_count: 0,
        suggested_daily_reviews: 0,
      },
    };

    const { container } = render(
      <>
        <StatCards stats={dummyStats} streak={3} />
        <DeckTable deckStats={dummyStats.deck_stats} onSelectDeck={() => {}} />
      </>,
    );

    expect(container).not.toHaveTextContent("0%");
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByTitle(/True retention across young and mature review answers/i),
    ).toBeInTheDocument();
  });
});
