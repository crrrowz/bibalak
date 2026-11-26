import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CoachReport } from "@bibalak/ipc-types";
import { setLocale } from "@/lib/i18n";
import { CoachPanel } from "./CoachPanel";

const REPORT: CoachReport = {
  summary: "Keep reviews steady.",
  advice: [
    {
      title: "Clear backlog early",
      detail: "Do 30 reviews each morning.",
      deck_id: 1,
    },
  ],
  plan: [
    { day: 1, reviews: 30, new_cards: 5, focus: "Backlog" },
    { day: 2, reviews: 30, new_cards: 5, focus: "Backlog" },
    { day: 3, reviews: 25, new_cards: 5, focus: "Backlog" },
    { day: 4, reviews: 20, new_cards: 10, focus: "Regular" },
    { day: 5, reviews: 20, new_cards: 10, focus: "Regular" },
    { day: 6, reviews: 15, new_cards: 15, focus: "Weekend" },
    { day: 7, reviews: 15, new_cards: 10, focus: "Audit" },
  ],
};

describe("CoachPanel (Z1a)", () => {
  afterEach(() => {
    setLocale("en");
  });

  it("renders advice card titles with dir='auto' as block elements matching the detail alignment", () => {
    setLocale("ar");
    render(<CoachPanel report={REPORT} onSelectDeck={vi.fn()} onClose={vi.fn()} />);

    const title = screen.getByRole("heading", { level: 4, name: "Clear backlog early" });
    const detail = screen.getByText("Do 30 reviews each morning.");

    expect(title).toHaveAttribute("dir", "auto");
    expect(detail).toHaveAttribute("dir", "auto");
    expect(title.parentElement).not.toHaveClass("flex");
    expect(title.parentElement).toContainElement(detail);
  });
});
