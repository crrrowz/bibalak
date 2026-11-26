import { useState, type ComponentProps } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DeckSummary } from "@bibalak/ipc-types";
import { BrowseBulkBar, type BulkActionKind } from "./BrowseBulkBar";

const decks: DeckSummary[] = [
  {
    id: 1,
    name: "Default",
    parent_id: null,
    new_count: 2,
    learning_count: 0,
    review_count: 5,
    is_filtered: false,
    collapsed: false,
  },
  {
    id: 2,
    name: "Medicine::Cardiology",
    parent_id: 1,
    new_count: 1,
    learning_count: 1,
    review_count: 3,
    is_filtered: false,
    collapsed: false,
  },
];

type BarProps = ComponentProps<typeof BrowseBulkBar>;

function makeProps(overrides: Partial<BarProps> = {}): BarProps {
  return {
    bulkRef: { current: null },
    selectedCount: 3,
    hasSuspended: false,
    hasUnsuspended: true,
    hasBuried: false,
    hasUnburied: true,
    hasNew: true,
    isSuspendPending: false,
    isUnsuspendPending: false,
    isBuryPending: false,
    isUnburyPending: false,
    isDeletePending: false,
    isMoveDeckPending: false,
    moveDeckError: null,
    bulkAction: null,
    setBulkAction: vi.fn(),
    bulkTag: "",
    setBulkTag: vi.fn(),
    existingTags: ["cardiology", "verbs"],
    deckFilter: "",
    setDeckFilter: vi.fn(),
    selectedDeckId: null,
    setSelectedDeckId: vi.fn(),
    availableDecks: decks,
    bulkError: null,
    onSuspend: vi.fn(),
    onUnsuspend: vi.fn(),
    onBury: vi.fn(),
    onUnbury: vi.fn(),
    onSetFlag: vi.fn(),
    onSubmitTags: vi.fn(),
    onMoveDeck: vi.fn(),
    onOpenDialog: vi.fn(),
    onRequestDelete: vi.fn(),
    onClearSelection: vi.fn(),
    ...overrides,
  };
}

function StatefulBulkBar(overrides: Partial<BarProps> = {}) {
  const [bulkAction, setBulkAction] = useState<BulkActionKind>(overrides.bulkAction ?? null);
  const [bulkTag, setBulkTag] = useState(overrides.bulkTag ?? "");
  const [deckFilter, setDeckFilter] = useState(overrides.deckFilter ?? "");
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(
    overrides.selectedDeckId ?? null,
  );

  return (
    <BrowseBulkBar
      {...makeProps({
        ...overrides,
        bulkAction,
        setBulkAction,
        bulkTag,
        setBulkTag,
        deckFilter,
        setDeckFilter,
        selectedDeckId,
        setSelectedDeckId,
      })}
    />
  );
}

describe("BrowseBulkBar (OT-05)", () => {
  it("renders selection count, Clear, grouped primary controls, More menu, and Delete last", () => {
    const props = makeProps({ hasSuspended: true, hasBuried: true });
    const { container } = render(<BrowseBulkBar {...props} />);

    expect(screen.getByText("3 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Clear$/i })).toBeInTheDocument();

    const studyGroup = screen.getByRole("group", { name: /Study state/i });
    expect(within(studyGroup).getByRole("button", { name: /^Suspend$/i })).toBeInTheDocument();
    expect(within(studyGroup).getByRole("button", { name: /^Unsuspend$/i })).toBeInTheDocument();
    expect(within(studyGroup).getByRole("button", { name: /^Bury$/i })).toBeInTheDocument();
    expect(within(studyGroup).getByRole("button", { name: /^Unbury$/i })).toBeInTheDocument();

    const tagsGroup = screen.getByRole("group", { name: /Tag actions/i });
    expect(within(tagsGroup).getByRole("button", { name: /^Add tag$/i })).toBeInTheDocument();
    expect(within(tagsGroup).getByRole("button", { name: /^Remove tag$/i })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /^Flag$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Move to deck$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^More$/i })).toHaveAttribute(
      "aria-haspopup",
      "menu",
    );

    const deleteBtn = screen.getByRole("button", { name: /^Delete$/i });
    expect(deleteBtn.className).toContain("text-destructive");

    // Primary bar order: count + Clear first, Delete last among top-level bar actions.
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons[0]).toHaveTextContent("Clear");
    expect(buttons[buttons.length - 1]).toHaveTextContent("Delete");
  });

  it("hides inapplicable study-state actions", () => {
    render(<BrowseBulkBar {...makeProps({ hasSuspended: false, hasBuried: false })} />);
    const studyGroup = screen.getByRole("group", { name: /Study state/i });
    expect(within(studyGroup).getByRole("button", { name: /^Suspend$/i })).toBeInTheDocument();
    expect(
      within(studyGroup).queryByRole("button", { name: /^Unsuspend$/i }),
    ).not.toBeInTheDocument();
    expect(within(studyGroup).getByRole("button", { name: /^Bury$/i })).toBeInTheDocument();
    expect(within(studyGroup).queryByRole("button", { name: /^Unbury$/i })).not.toBeInTheDocument();
  });

  it("reaches every overflow dialog action via the More menu and hides Reposition when hasNew is false", async () => {
    const user = userEvent.setup();
    const onOpenDialog = vi.fn();
    const { rerender } = render(<BrowseBulkBar {...makeProps({ hasNew: true, onOpenDialog })} />);

    const moreTrigger = screen.getByRole("button", { name: /^More$/i });
    await user.click(moreTrigger);
    const menu = await screen.findByRole("menu");

    const cases: Array<[RegExp, string]> = [
      [/^Preview$/i, "preview"],
      [/^Forget$/i, "forget"],
      [/^Set due date$/i, "setDueDate"],
      [/^Reposition$/i, "reposition"],
      [/^Find & replace$/i, "findReplace"],
      [/^Change note type$/i, "changeNotetype"],
    ];

    for (const [label, dialog] of cases) {
      if (!screen.queryByRole("menu")) {
        await user.click(moreTrigger);
      }
      const item = await screen.findByRole("menuitem", { name: label });
      await user.click(item);
      expect(onOpenDialog).toHaveBeenLastCalledWith(dialog);
      await waitFor(() => {
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      });
    }

    expect(menu).not.toBeInTheDocument();

    rerender(<BrowseBulkBar {...makeProps({ hasNew: false, onOpenDialog })} />);
    await user.click(screen.getByRole("button", { name: /^More$/i }));
    await screen.findByRole("menu");
    expect(screen.queryByRole("menuitem", { name: /^Reposition$/i })).not.toBeInTheDocument();
  });

  it("opens More menu with keyboard, moves with arrows, and returns focus on Escape without leaking Escape", async () => {
    const user = userEvent.setup();
    const onWindowEscape = vi.fn();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") onWindowEscape(e);
    };
    window.addEventListener("keydown", listener);

    try {
      render(<BrowseBulkBar {...makeProps()} />);
      const moreTrigger = screen.getByRole("button", { name: /^More$/i });
      moreTrigger.focus();

      await user.keyboard("{Enter}");
      const menu = await screen.findByRole("menu");
      const items = within(menu).getAllByRole("menuitem");
      expect(items.length).toBeGreaterThanOrEqual(5);

      await user.keyboard("{ArrowDown}");
      expect(items[1]).toHaveFocus();

      await user.keyboard("{ArrowUp}");
      expect(items[0]).toHaveFocus();

      await user.keyboard("{End}");
      expect(items[items.length - 1]).toHaveFocus();

      await user.keyboard("{Home}");
      expect(items[0]).toHaveFocus();

      await user.keyboard("{Escape}");
      await waitFor(() => {
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      });
      expect(moreTrigger).toHaveFocus();
      expect(onWindowEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", listener);
    }
  });

  it("keeps inline Flag, Tag, and Move to deck sub-panels working one at a time", async () => {
    const user = userEvent.setup();
    const onSetFlag = vi.fn();
    const onSubmitTags = vi.fn();
    const onMoveDeck = vi.fn();
    render(
      <StatefulBulkBar onSetFlag={onSetFlag} onSubmitTags={onSubmitTags} onMoveDeck={onMoveDeck} />,
    );

    await user.click(screen.getByRole("button", { name: /^Flag$/i }));
    expect(screen.getByRole("button", { name: /Flag 3/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Flag 3/i }));
    expect(onSetFlag).toHaveBeenCalledWith(3);

    await user.click(screen.getByRole("button", { name: /^Add tag$/i }));
    expect(screen.queryByRole("button", { name: /Flag 3/i })).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/tag name/i), "alpha beta");
    await user.click(screen.getByRole("button", { name: /^Add$/i }));
    expect(onSubmitTags).toHaveBeenCalledWith(["alpha", "beta"], "addTag");

    await user.click(screen.getByRole("button", { name: /^Move to deck$/i }));
    expect(screen.queryByPlaceholderText(/tag name/i)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox"), "2");
    await user.click(screen.getByRole("button", { name: /^Move$/i }));
    expect(onMoveDeck).toHaveBeenCalledWith(2);
  });

  it("shows Check quality with AI inside More menu and invokes onCheckQuality", async () => {
    const user = userEvent.setup();
    const onCheckQuality = vi.fn();
    render(<StatefulBulkBar onCheckQuality={onCheckQuality} />);

    await user.click(screen.getByRole("button", { name: /^More$/i }));
    const item = await screen.findByRole("menuitem", { name: /Check quality with AI/i });
    await user.click(item);
    expect(onCheckQuality).toHaveBeenCalledTimes(1);
  });
});
