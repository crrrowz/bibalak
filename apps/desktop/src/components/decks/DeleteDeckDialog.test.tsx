import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeckSummary } from "@bibalak/ipc-types";
import { setLocale } from "@/lib/i18n";
import { DeleteDeckDialog } from "./DeleteDeckDialog";

const longDeck: DeckSummary = {
  id: 7,
  name: "Audio_English_sentences_with_Arabic_translations",
  parent_id: null,
  new_count: 5,
  learning_count: 0,
  review_count: 2,
  is_filtered: false,
  collapsed: false,
};

describe("DeleteDeckDialog (UX2 C1)", () => {
  afterEach(() => setLocale("en"));

  it("wraps long unbroken deck names cleanly and explains Undo availability", () => {
    render(
      <DeleteDeckDialog deck={longDeck} onCancel={vi.fn()} onConfirm={vi.fn()} isPending={false} />,
    );

    const nameBox = screen.getByText("Audio_English_sentences_with_Arabic_translations");
    expect(nameBox.className).toContain("[overflow-wrap:anywhere]");
    expect(nameBox.className).toContain("px-3");
    expect(nameBox.className).toContain("py-2");

    expect(screen.getByText("You can undo this from the Undo button.")).toBeInTheDocument();
    expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument();

    setLocale("ar");
    render(
      <DeleteDeckDialog deck={longDeck} onCancel={vi.fn()} onConfirm={vi.fn()} isPending={false} />,
    );
    expect(screen.getByText("يمكنك التراجع عن هذا من زر التراجع.")).toBeInTheDocument();
  });
});
