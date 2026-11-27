import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TodaySummary } from "./TodaySummary";
import { setLocale } from "@/lib/i18n";
import type { DeckSummary } from "@bibalak/ipc-types";

describe("TodaySummary responsive & i18n", () => {
  afterEach(() => {
    setLocale("en");
  });

  const dummyDecks: DeckSummary[] = [
    {
      id: 1,
      name: "Deck 1",
      parent_id: null,
      new_count: 5,
      learning_count: 3,
      review_count: 12,
      is_filtered: false,
      collapsed: false,
    },
  ];

  it("renders both detailed and shortened summary for responsive viewports", () => {
    const { container } = render(<TodaySummary decks={dummyDecks} />);

    // Detailed text for larger screens
    expect(screen.getByText(/5 new · 3 learning · 12 to review today/i)).toBeInTheDocument();
    // Shortened text for compact viewports (800px / < xl)
    expect(screen.getByText("20 due today")).toBeInTheDocument();

    const shortSpan = container.querySelector(".inline.xl\\:hidden");
    const longSpan = container.querySelector(".hidden.xl\\:inline");
    expect(shortSpan).toBeTruthy();
    expect(longSpan).toBeTruthy();
  });

  it("renders localized summary in Arabic with pluralized forms", () => {
    setLocale("ar");
    render(<TodaySummary decks={dummyDecks} />);

    // In Arabic 20 cards uses the many plural (20 بطاقة مستحقة اليوم or 20 مستحقة اليوم)
    expect(screen.getByText("20 مستحقة اليوم")).toBeInTheDocument();
  });

  it("formats four-digit counts consistently with locale grouping", () => {
    const largeDecks: DeckSummary[] = [
      {
        id: 1,
        name: "Large Deck",
        parent_id: null,
        new_count: 1200,
        learning_count: 3,
        review_count: 1500,
        is_filtered: false,
        collapsed: false,
      },
    ];
    setLocale("ar");
    render(<TodaySummary decks={largeDecks} />);

    expect(screen.getByText(/1,200 جديدة · 3 قيد التعلّم · 1,500 للمراجعة/)).toBeInTheDocument();
    expect(screen.getByText("2,703 مستحقة اليوم")).toBeInTheDocument();
  });

  it("includes nested filtered subdecks in due totals", () => {
    const decks: DeckSummary[] = [
      {
        id: 1,
        name: "Parent",
        parent_id: null,
        new_count: 0,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
      {
        id: 2,
        name: "Parent::Cram",
        parent_id: 1,
        new_count: 5,
        learning_count: 0,
        review_count: 0,
        is_filtered: true,
        collapsed: false,
      },
    ];
    render(<TodaySummary decks={decks} />);
    expect(screen.getByText("5 due today")).toBeInTheDocument();
  });
});
