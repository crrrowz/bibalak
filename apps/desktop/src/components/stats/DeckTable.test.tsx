import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DeckStat } from "@bibalak/ipc-types";
import { DeckTable } from "./DeckTable";

describe("DeckTable", () => {
  it("renders ExportButton in a non-overlapping toolbar outside the table and excludes filtered subdecks from parent rollup", () => {
    const deckStats: DeckStat[] = [
      {
        deck_id: 1,
        name: "Parent",
        parent_id: null,
        total_cards: 10,
        due_today: 2,
        new_count: 5,
        learning_count: 0,
        young_count: 3,
        mature_count: 2,
        suspended_count: 0,
        retention_pct: 90,
        reviews_7d: 4,
      },
      {
        deck_id: 2,
        name: "Parent::Cram",
        parent_id: 1,
        total_cards: 50,
        due_today: 20,
        new_count: 10,
        learning_count: 0,
        young_count: 20,
        mature_count: 20,
        suspended_count: 0,
        retention_pct: 80,
        reviews_7d: 10,
      },
    ];

    const { container } = render(
      <DeckTable deckStats={deckStats} filteredDeckIds={[2]} onSelectDeck={vi.fn()} />,
    );

    const exportBtn = screen.getByRole("button", { name: /Export/i });
    expect(exportBtn.parentElement?.className).not.toContain("absolute");
    expect(container.querySelector("table")?.contains(exportBtn)).toBe(false);

    // Parent row must show its own 10 cards, not 10 + 50 from filtered child.
    const rows = container.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("10");
    expect(rows[0].textContent).not.toContain("60");
  });

  it("A5-07: parent expand/collapse button has accessible label and aria-expanded and column headers use sort buttons", () => {
    const deckStats: DeckStat[] = [
      {
        deck_id: 1,
        name: "Parent",
        parent_id: null,
        total_cards: 10,
        due_today: 2,
        new_count: 5,
        learning_count: 0,
        young_count: 3,
        mature_count: 2,
        suspended_count: 0,
        retention_pct: 90,
        reviews_7d: 4,
      },
      {
        deck_id: 2,
        name: "Parent::Child",
        parent_id: 1,
        total_cards: 5,
        due_today: 1,
        new_count: 2,
        learning_count: 0,
        young_count: 2,
        mature_count: 1,
        suspended_count: 0,
        retention_pct: 80,
        reviews_7d: 2,
      },
    ];

    const { container } = render(
      <DeckTable deckStats={deckStats} filteredDeckIds={[]} onSelectDeck={vi.fn()} />,
    );

    const toggleBtn = container.querySelector("tbody tr button");
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn).toHaveAttribute("aria-expanded", "true");
    expect(toggleBtn?.getAttribute("aria-label")?.trim()).toBeTruthy();

    const sortButtons = container.querySelectorAll("thead th button");
    expect(sortButtons.length).toBeGreaterThanOrEqual(10);
  });

  it("A3-21: wraps the wide table in an overflow-x-auto container and labels filtered deck rows", () => {
    const deckStats: DeckStat[] = [
      {
        deck_id: 1,
        name: "Medical::Pharmacology::Cardiovascular",
        parent_id: null,
        total_cards: 120,
        due_today: 15,
        new_count: 10,
        learning_count: 2,
        young_count: 30,
        mature_count: 78,
        suspended_count: 0,
        retention_pct: 91,
        reviews_7d: 88,
      },
      {
        deck_id: 2,
        name: "CramSession",
        parent_id: null,
        total_cards: 10,
        due_today: 10,
        new_count: 0,
        learning_count: 0,
        young_count: 5,
        mature_count: 5,
        suspended_count: 0,
        retention_pct: null,
        reviews_7d: 3,
      },
    ];

    const { container } = render(
      <DeckTable deckStats={deckStats} filteredDeckIds={[2]} onSelectDeck={vi.fn()} />,
    );

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.parentElement?.className).toContain("overflow-x-auto");
    expect(screen.getByText("filtered")).toBeInTheDocument();
  });
});
