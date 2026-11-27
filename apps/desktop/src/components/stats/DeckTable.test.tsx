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
});
