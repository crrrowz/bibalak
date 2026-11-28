import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeckRow } from "./DeckRow";
import { DeckGridCard } from "./DeckGridCard";
import { CreateDeckForm } from "./CreateDeckForm";
import { ipc } from "@/lib/ipc";
import type { DeckSummary } from "@bibalak/ipc-types";

describe("DeckRow collapse/expand", () => {
  const dummyDeck: DeckSummary = {
    id: 1,
    name: "Languages",
    parent_id: null,
    new_count: 5,
    learning_count: 2,
    review_count: 10,
    is_filtered: false,
    collapsed: false,
  };

  it("renders a collapse button when hasChildren is true and not collapsed", async () => {
    const onToggle = vi.fn();
    render(
      <DeckRow
        deck={dummyDeck}
        hasChildren={true}
        collapsed={false}
        onToggleCollapse={onToggle}
        onStudy={vi.fn()}
        onRename={vi.fn()}
        onOptions={vi.fn()}
        onDelete={vi.fn()}
        onRebuild={vi.fn()}
        onEmpty={vi.fn()}
      />,
    );

    const collapseBtn = screen.getByRole("button", { name: "Collapse subdecks" });
    expect(collapseBtn).toBeInTheDocument();

    await userEvent.click(collapseBtn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders an expand button when collapsed is true", () => {
    render(
      <DeckRow
        deck={{ ...dummyDeck, collapsed: true }}
        hasChildren={true}
        collapsed={true}
        onToggleCollapse={vi.fn()}
        onStudy={vi.fn()}
        onRename={vi.fn()}
        onOptions={vi.fn()}
        onDelete={vi.fn()}
        onRebuild={vi.fn()}
        onEmpty={vi.fn()}
      />,
    );

    const expandBtn = screen.getByRole("button", { name: "Expand subdecks" });
    expect(expandBtn).toBeInTheDocument();
  });

  it("OT-04: aligns top-level decks identically regardless of children and indents only :: subdecks", () => {
    const defaultDeck: DeckSummary = { ...dummyDeck, id: 1, name: "Default" };
    const newTopLevel: DeckSummary = { ...dummyDeck, id: 2, name: "Spanish" };
    const parentDeck: DeckSummary = { ...dummyDeck, id: 3, name: "Medicine" };
    const subDeck: DeckSummary = {
      ...dummyDeck,
      id: 4,
      name: "Medicine::Cardiology",
      parent_id: 3,
    };

    const { container } = render(
      <div>
        <DeckRow
          deck={defaultDeck}
          hasChildren={false}
          onStudy={vi.fn()}
          onRename={vi.fn()}
          onOptions={vi.fn()}
          onDelete={vi.fn()}
          onRebuild={vi.fn()}
          onEmpty={vi.fn()}
        />
        <DeckRow
          deck={newTopLevel}
          hasChildren={false}
          onStudy={vi.fn()}
          onRename={vi.fn()}
          onOptions={vi.fn()}
          onDelete={vi.fn()}
          onRebuild={vi.fn()}
          onEmpty={vi.fn()}
        />
        <DeckRow
          deck={parentDeck}
          hasChildren={true}
          collapsed={false}
          onToggleCollapse={vi.fn()}
          onStudy={vi.fn()}
          onRename={vi.fn()}
          onOptions={vi.fn()}
          onDelete={vi.fn()}
          onRebuild={vi.fn()}
          onEmpty={vi.fn()}
        />
        <DeckRow
          deck={subDeck}
          hasChildren={false}
          onStudy={vi.fn()}
          onRename={vi.fn()}
          onOptions={vi.fn()}
          onDelete={vi.fn()}
          onRebuild={vi.fn()}
          onEmpty={vi.fn()}
        />
      </div>,
    );

    const rows = Array.from(
      container.querySelectorAll<HTMLDivElement>('div[style*="padding-inline-start"]'),
    );
    expect(rows).toHaveLength(4);
    expect(rows[0].style.paddingInlineStart).toBe("2rem");
    expect(rows[1].style.paddingInlineStart).toBe("2rem");
    expect(rows[2].style.paddingInlineStart).toBe("2rem");
    expect(rows[3].style.paddingInlineStart).toBe("3.25rem");

    // Leading slot width is 1.25rem (`w-5` spacer for leaf rows vs `size-5` button for parents).
    expect(rows[0].firstElementChild?.className).toContain("w-5");
    expect(rows[1].firstElementChild?.className).toContain("w-5");
    expect(rows[2].firstElementChild?.className).toContain("size-5");
  });

  it("OT-04: CreateDeckForm sends trimmed top-level deck name without nesting under Default", async () => {
    const user = userEvent.setup();
    const createSpy = vi.spyOn(ipc, "createDeck").mockResolvedValue({
      ...dummyDeck,
      id: 10,
      name: "Japanese",
    });
    const queryClient = new QueryClient();
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <CreateDeckForm onClose={onClose} />
      </QueryClientProvider>,
    );

    await user.type(screen.getByPlaceholderText(/Deck name/i), "  Japanese  ");
    await user.click(screen.getByRole("button", { name: /^Create$/i }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith("Japanese");
    });
    createSpy.mockRestore();
  });

  it("OT-09: an orphan subdeck with parent_id: null is not indented even if its name contains ::", () => {
    const orphanDeck: DeckSummary = {
      ...dummyDeck,
      id: 5,
      name: "Classical Music Themes::Part I",
      parent_id: null,
    };

    const { container } = render(
      <DeckRow
        deck={orphanDeck}
        hasChildren={false}
        onStudy={vi.fn()}
        onRename={vi.fn()}
        onOptions={vi.fn()}
        onDelete={vi.fn()}
        onRebuild={vi.fn()}
        onEmpty={vi.fn()}
      />,
    );

    const row = container.querySelector<HTMLDivElement>('div[style*="padding-inline-start"]');
    expect(row).not.toBeNull();
    // Real tree depth is 0 because parent_id is null; padding should be 2rem (not 3.25rem)
    expect(row!.style.paddingInlineStart).toBe("2rem");
  });

  it("LOGIC1: formats multi-digit deck counts with formatNumber and aligns inline-end padding and w-11 shrink-0 columns", () => {
    const bigDeck: DeckSummary = {
      ...dummyDeck,
      new_count: 1200,
      learning_count: 0,
      review_count: 1500,
    };

    const { container } = render(
      <DeckRow
        deck={bigDeck}
        hasChildren={false}
        onStudy={vi.fn()}
        onRename={vi.fn()}
        onOptions={vi.fn()}
        onDelete={vi.fn()}
        onRebuild={vi.fn()}
        onEmpty={vi.fn()}
      />,
    );

    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("1,500")).toBeInTheDocument();

    const row = container.querySelector<HTMLDivElement>('div[style*="padding-inline-start"]');
    expect(row?.className).toContain("pe-4");
    expect(row?.className).toContain("sm:pe-6");
    expect(row?.className).toContain("lg:pe-8");
    expect(screen.getByText("1,200").className).toContain("w-11");
    expect(screen.getByText("1,200").className).toContain("shrink-0");
  });
});

describe("DeckRow & DeckGridCard visibility and labels (A1-25 / A1-26)", () => {
  const parentDeck: DeckSummary = {
    id: 10,
    name: "Medicine",
    parent_id: null,
    new_count: 12,
    learning_count: 5,
    review_count: 30,
    is_filtered: false,
    collapsed: false,
  };
  const childDeck: DeckSummary = {
    id: 11,
    name: "Medicine::Cardiology",
    parent_id: 10,
    new_count: 4,
    learning_count: 2,
    review_count: 8,
    is_filtered: false,
    collapsed: false,
  };

  it("A1-25: keeps DeckRow action buttons visible without hover and labels rolled-up parent counts", () => {
    const { container } = render(
      <div>
        <DeckRow
          deck={parentDeck}
          hasChildren={true}
          onStudy={vi.fn()}
          onRename={vi.fn()}
          onOptions={vi.fn()}
          onDelete={vi.fn()}
          onRebuild={vi.fn()}
          onEmpty={vi.fn()}
        />
        <DeckRow
          deck={childDeck}
          hasChildren={false}
          onStudy={vi.fn()}
          onRename={vi.fn()}
          onOptions={vi.fn()}
          onDelete={vi.fn()}
          onRebuild={vi.fn()}
          onEmpty={vi.fn()}
        />
      </div>,
    );

    const studyParent = screen.getByRole("button", { name: /Study Medicine$/i });
    const actionsWrap = studyParent.parentElement!;
    expect(actionsWrap.className).not.toContain("opacity-0");

    expect(container.querySelectorAll('[data-testid="deck-includes-subdecks"]')).toHaveLength(1);
    expect(screen.getByTestId("deck-includes-subdecks")).toHaveTextContent(/incl\. subdecks/i);
  });

  it("A1-26: DeckGridCard renders parent path breadcrumb, count labels, Options button, and always-visible menu", () => {
    render(
      <DeckGridCard
        deck={childDeck}
        hasChildren={false}
        onStudy={vi.fn()}
        onRename={vi.fn()}
        onOptions={vi.fn()}
        onDelete={vi.fn()}
        onRebuild={vi.fn()}
        onEmpty={vi.fn()}
      />,
    );

    expect(screen.getByTestId("deck-grid-parent")).toHaveTextContent("Medicine");
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Learn")).toBeInTheDocument();
    expect(screen.getByText("Due")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Settings for Medicine::Cardiology/i }),
    ).toBeInTheDocument();
    const moreBtn = screen.getByRole("button", {
      name: /More actions for Medicine::Cardiology/i,
    });
    expect(moreBtn.parentElement?.className).not.toContain("opacity-0");
  });
});
