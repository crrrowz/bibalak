import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DeckSummary,
  MatrixBoardDto,
  MatrixQuadrantDto,
  QuadrantKey,
  TaskDto,
  TaskListDto,
} from "@bibalak/ipc-types";
import { EisenhowerMatrixScreen } from "./EisenhowerMatrixScreen";
import * as ipcModule from "@/lib/ipc";
import { setLocale } from "@/lib/i18n";
import { useStyle } from "@/stores/style";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  Link: ({
    children,
    to,
    params,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
    params?: Record<string, string | number>;
  }) => {
    const href = params
      ? Object.entries(params).reduce((acc, [k, v]) => acc.replace(`$${k}`, String(v)), to)
      : to;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

function makeDefaultQuadrants(): MatrixQuadrantDto[] {
  return [
    {
      quadrant_key: "q1",
      title: "",
      color_token: "danger",
      group_by: "none",
      sort_by: "date",
      rule: {
        lists: { mode: "all" },
        date_filters: ["overdue", "today", "tomorrow"],
        priorities: ["high"],
        types: null,
        pinned_deck_ids: [],
        excluded_deck_ids: [],
      },
    },
    {
      quadrant_key: "q2",
      title: "",
      color_token: "warning",
      group_by: "none",
      sort_by: "date",
      rule: {
        lists: { mode: "all" },
        date_filters: null,
        priorities: ["high", "medium"],
        types: null,
        pinned_deck_ids: [],
        excluded_deck_ids: [],
      },
    },
    {
      quadrant_key: "q3",
      title: "",
      color_token: "info",
      group_by: "none",
      sort_by: "date",
      rule: {
        lists: { mode: "all" },
        date_filters: ["overdue", "today", "tomorrow"],
        priorities: ["low", "none"],
        types: null,
        pinned_deck_ids: [],
        excluded_deck_ids: [],
      },
    },
    {
      quadrant_key: "q4",
      title: "",
      color_token: "success",
      group_by: "none",
      sort_by: "date",
      rule: {
        lists: { mode: "all" },
        date_filters: null,
        priorities: ["low", "none"],
        types: null,
        pinned_deck_ids: [],
        excluded_deck_ids: [],
      },
    },
  ];
}

function makeTask(overrides: Partial<TaskDto> & { id: string; title: string }): TaskDto {
  return {
    list_id: null,
    list_name: null,
    notes: "",
    priority: "none",
    manual_quadrant: null,
    effective_quadrant: "q4",
    due_date: null,
    scheduled_start_ms: null,
    scheduled_end_ms: null,
    tags: [],
    deck_id: null,
    deck_name: null,
    completed_at: null,
    completed_day: null,
    sort_order: 0,
    ...overrides,
  };
}

function makeBoard(overrides?: Partial<MatrixBoardDto>): MatrixBoardDto {
  return {
    today_date: "2026-11-22",
    quadrants: makeDefaultQuadrants(),
    tasks: [
      makeTask({
        id: "t-1",
        title: "Review pharmacology notes",
        priority: "high",
        due_date: "2026-11-22",
        effective_quadrant: "q1",
      }),
      makeTask({
        id: "t-2",
        title: "Plan next week study blocks",
        priority: "medium",
        effective_quadrant: "q2",
      }),
      makeTask({
        id: "t-3",
        title: "Email lab partner",
        priority: "low",
        due_date: "2026-11-22",
        effective_quadrant: "q3",
      }),
      makeTask({
        id: "t-4",
        title: "Sort old PDFs",
        priority: "none",
        effective_quadrant: "q4",
      }),
    ],
    deck_due_items: [
      {
        deck_id: 2,
        deck_name: "Classical Music Themes",
        due_count: 14,
        quadrant_key: "q1",
      },
    ],
    ...overrides,
  };
}

const sampleDecks: DeckSummary[] = [
  {
    id: 2,
    name: "Classical Music Themes",
    parent_id: null,
    new_count: 5,
    learning_count: 2,
    review_count: 7,
    is_filtered: false,
    collapsed: false,
  },
];

const sampleLists: TaskListDto[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Study",
    color_token: "accent",
    icon_key: null,
    sort_order: 0,
  },
];

function renderMatrix() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EisenhowerMatrixScreen />
    </QueryClientProvider>,
  );
}

describe("EisenhowerMatrixScreen (M2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLocale("en");
    useStyle.getState().setStyle("default");
    navigateMock.mockReset();
    vi.spyOn(ipcModule.ipc, "listDecks").mockResolvedValue(sampleDecks);
    vi.spyOn(ipcModule.ipc, "listTaskLists").mockResolvedValue(sampleLists);
    vi.spyOn(ipcModule.ipc, "undoStatus").mockResolvedValue(null);
  });

  afterEach(() => {
    setLocale("en");
  });

  it("renders the four quadrants, localized default titles, tasks, counts, and DeckDue study link", async () => {
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockResolvedValue(makeBoard());

    renderMatrix();

    const q1 = await screen.findByTestId("quadrant-q1");
    const q2 = screen.getByTestId("quadrant-q2");
    const q3 = screen.getByTestId("quadrant-q3");
    const q4 = screen.getByTestId("quadrant-q4");

    expect(within(q1).getByText("Urgent & important")).toBeInTheDocument();
    expect(within(q1).getByText("Review pharmacology notes")).toBeInTheDocument();
    expect(within(q1).getByText("Classical Music Themes")).toBeInTheDocument();
    expect(within(q1).getByRole("link", { name: /Study/i })).toHaveAttribute("href", "/study/2");

    expect(within(q2).getByText("Important, not urgent")).toBeInTheDocument();
    expect(within(q2).getByText("Plan next week study blocks")).toBeInTheDocument();

    expect(within(q3).getByText("Urgent, not important")).toBeInTheDocument();
    expect(within(q3).getByText("Email lab partner")).toBeInTheDocument();

    expect(within(q4).getByText("Not urgent & not important")).toBeInTheDocument();
    expect(within(q4).getByText("Sort old PDFs")).toBeInTheDocument();
  });

  it("quick-adds a task into the chosen quadrant with manual_quadrant", async () => {
    const user = userEvent.setup();
    let board = makeBoard();
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockImplementation(async () => board);
    const createSpy = vi.spyOn(ipcModule.ipc, "createTask").mockImplementation(async (input) => {
      const created = makeTask({
        id: "t-new",
        title: input.title,
        priority: input.priority,
        manual_quadrant: input.manual_quadrant,
        effective_quadrant: input.manual_quadrant,
      });
      board = { ...board, tasks: [...board.tasks, created] };
      return created;
    });

    renderMatrix();

    const q2 = await screen.findByTestId("quadrant-q2");
    const addBtn = within(q2).getByRole("button", { name: /quick add/i });
    await user.click(addBtn);

    const input = within(q2).getByRole("textbox");
    await user.type(input, "Outline anatomy chapter{Enter}");

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Outline anatomy chapter",
          manual_quadrant: "q2",
        }),
      );
    });
    expect(await within(q2).findByText("Outline anatomy chapter")).toBeInTheDocument();
  });

  it("completes an active task, shows completed tasks when toggled, does not offer Complete on done tasks, and reopens", async () => {
    const user = userEvent.setup();
    let board = makeBoard();
    let undoState: { kind: "complete-task"; title: string } | null = null;
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockImplementation(async (includeCompleted) => ({
      ...board,
      tasks: includeCompleted ? board.tasks : board.tasks.filter((t) => t.completed_at === null),
    }));
    vi.spyOn(ipcModule.ipc, "undoStatus").mockImplementation(async () => undoState);
    const completeSpy = vi.spyOn(ipcModule.ipc, "completeTask").mockImplementation(async (id) => {
      board = {
        ...board,
        tasks: board.tasks.map((t) =>
          t.id === id
            ? { ...t, completed_at: 1_700_000_000_000, completed_day: 1, effective_quadrant: null }
            : t,
        ),
      };
      undoState = { kind: "complete-task", title: "Sort old PDFs" };
    });
    const reopenSpy = vi.spyOn(ipcModule.ipc, "reopenTask").mockImplementation(async (id) => {
      board = {
        ...board,
        tasks: board.tasks.map((t) =>
          t.id === id
            ? { ...t, completed_at: null, completed_day: null, effective_quadrant: "q4" }
            : t,
        ),
      };
    });

    renderMatrix();

    const q4 = await screen.findByTestId("quadrant-q4");
    const checkbox = within(q4).getByRole("checkbox", { name: /Sort old PDFs/i });
    await user.click(checkbox);

    await waitFor(() => expect(completeSpy).toHaveBeenCalledWith("t-4"));
    await waitFor(() => expect(within(q4).queryByText("Sort old PDFs")).not.toBeInTheDocument());

    const undoBtn = screen.getByRole("button", { name: /^Undo$/i });
    await waitFor(() => expect(undoBtn).not.toBeDisabled());
    expect(undoBtn).toHaveAttribute(
      "title",
      expect.stringContaining('Complete task "Sort old PDFs"'),
    );

    const showCompletedToggle = screen.getByRole("switch", { name: /show completed/i });
    await user.click(showCompletedToggle);

    const completedSection = await screen.findByTestId("matrix-completed");
    expect(within(completedSection).getByText("Sort old PDFs")).toBeInTheDocument();

    // Open row menu on completed task: must offer Reopen, never Complete
    const menuBtn = within(completedSection).getByRole("button", { name: /actions/i });
    await user.click(menuBtn);
    expect(screen.queryByRole("menuitem", { name: /^Complete$/i })).not.toBeInTheDocument();
    const reopenItem = screen.getByRole("menuitem", { name: /reopen/i });
    await user.click(reopenItem);

    await waitFor(() => expect(reopenSpy).toHaveBeenCalledWith("t-4"));
  });

  it("moves a task to another quadrant via the row action menu", async () => {
    const user = userEvent.setup();
    let board = makeBoard();
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockImplementation(async () => board);
    const moveSpy = vi
      .spyOn(ipcModule.ipc, "moveTaskToQuadrant")
      .mockImplementation(async (id, quadrant: QuadrantKey) => {
        let updated!: TaskDto;
        board = {
          ...board,
          tasks: board.tasks.map((t) => {
            if (t.id === id) {
              updated = { ...t, manual_quadrant: quadrant, effective_quadrant: quadrant };
              return updated;
            }
            return t;
          }),
        };
        return updated;
      });

    renderMatrix();

    const q4 = await screen.findByTestId("quadrant-q4");
    const rowMenuBtn = within(q4).getByRole("button", { name: /actions/i });
    await user.click(rowMenuBtn);

    const moveToBtn = screen.getByRole("menuitem", { name: /move to/i });
    await user.click(moveToBtn);

    const targetQ1 = await screen.findByRole("menuitem", { name: /Urgent & important/i });
    await user.click(targetQ1);

    await waitFor(() => expect(moveSpy).toHaveBeenCalledWith("t-4", "q1"));
    const q1 = screen.getByTestId("quadrant-q1");
    expect(await within(q1).findByText("Sort old PDFs")).toBeInTheDocument();
  });

  it("edits a quadrant rule, displays validation error calmly, and restores defaults", async () => {
    const user = userEvent.setup();
    let board = makeBoard();
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockImplementation(async () => board);
    const saveSpy = vi
      .spyOn(ipcModule.ipc, "saveMatrixQuadrant")
      .mockRejectedValueOnce({
        kind: "invalid",
        message: "priorities must be None or a non-empty list",
      })
      .mockImplementationOnce(async (q) => {
        board = {
          ...board,
          quadrants: board.quadrants.map((item) =>
            item.quadrant_key === q.quadrant_key ? q : item,
          ),
        };
        return q;
      });
    const restoreSpy = vi
      .spyOn(ipcModule.ipc, "restoreMatrixDefaults")
      .mockImplementation(async (key) => {
        const defaults = makeDefaultQuadrants();
        board = {
          ...board,
          quadrants: board.quadrants.map((item) =>
            !key || item.quadrant_key === key
              ? defaults.find((d) => d.quadrant_key === item.quadrant_key)!
              : item,
          ),
        };
        return board.quadrants;
      });

    renderMatrix();

    const q1 = await screen.findByTestId("quadrant-q1");
    await user.click(within(q1).getByRole("button", { name: /quadrant options/i }));
    await user.click(screen.getByRole("menuitem", { name: /edit/i }));

    const dialog = await screen.findByRole("dialog");
    const titleInput = within(dialog).getByLabelText(/title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Exam triage");

    // First save fails with validation error -> displayed calmly inside dialog
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));
    expect(
      await within(dialog).findByText(/priorities must be None or a non-empty list/i),
    ).toBeInTheDocument();

    // Second save succeeds
    await user.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(saveSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ quadrant_key: "q1", title: "Exam triage" }),
      ),
    );
    expect(await within(q1).findByText("Exam triage")).toBeInTheDocument();

    // Reopen and restore defaults
    await user.click(within(q1).getByRole("button", { name: /quadrant options/i }));
    await user.click(screen.getByRole("menuitem", { name: /edit/i }));
    const dialog2 = await screen.findByRole("dialog");
    await user.click(within(dialog2).getByRole("button", { name: /restore defaults/i }));
    await waitFor(() => expect(restoreSpy).toHaveBeenCalledWith("q1"));
    expect(await within(q1).findByText("Urgent & important")).toBeInTheDocument();
  });

  it("renders tasks with effective_quadrant === null in the Unsorted strip", async () => {
    const board = makeBoard({
      tasks: [
        ...makeBoard().tasks,
        makeTask({
          id: "t-unsorted",
          title: "Unmatched custom rule task",
          effective_quadrant: null,
        }),
      ],
    });
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockResolvedValue(board);

    renderMatrix();

    const strip = await screen.findByTestId("matrix-unsorted");
    expect(within(strip).getByText("Unmatched custom rule task")).toBeInTheDocument();
  });

  it("renders Arabic labels and logical grid layout without physical left/right classes in RTL", async () => {
    setLocale("ar");
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockResolvedValue(makeBoard());

    renderMatrix();

    expect(document.documentElement.dir).toBe("rtl");
    const grid = await screen.findByTestId("matrix-grid");
    expect(grid.className).toContain("grid");
    expect(grid.className).toContain("md:grid-cols-2");

    const children = Array.from(grid.children);
    expect(children[0]).toHaveAttribute("data-testid", "quadrant-q1");
    expect(children[1]).toHaveAttribute("data-testid", "quadrant-q2");
    expect(children[2]).toHaveAttribute("data-testid", "quadrant-q3");
    expect(children[3]).toHaveAttribute("data-testid", "quadrant-q4");

    expect(within(children[0] as HTMLElement).getByText("عاجل ومهم")).toBeInTheDocument();
    expect(within(children[1] as HTMLElement).getByText("مهم وغير عاجل")).toBeInTheDocument();
  });

  it("creates, renames, and deletes task lists via the list manager", async () => {
    const user = userEvent.setup();
    let lists: TaskListDto[] = [...sampleLists];
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockResolvedValue(makeBoard());
    vi.spyOn(ipcModule.ipc, "listTaskLists").mockImplementation(async () => lists);
    const createListSpy = vi
      .spyOn(ipcModule.ipc, "createTaskList")
      .mockImplementation(async (input) => {
        const created: TaskListDto = {
          id: "00000000-0000-4000-8000-000000000002",
          name: input.name,
          color_token: input.color_token,
          icon_key: input.icon_key,
          sort_order: input.sort_order,
        };
        lists = [...lists, created];
        return created;
      });
    const updateListSpy = vi
      .spyOn(ipcModule.ipc, "updateTaskList")
      .mockImplementation(async (id, input) => {
        let updated!: TaskListDto;
        lists = lists.map((l) => {
          if (l.id === id) {
            updated = { ...l, name: input.name };
            return updated;
          }
          return l;
        });
        return updated;
      });
    const deleteListSpy = vi
      .spyOn(ipcModule.ipc, "deleteTaskList")
      .mockImplementation(async (id) => {
        lists = lists.filter((l) => l.id !== id);
      });

    renderMatrix();

    const listsBtn = await screen.findByRole("button", { name: /manage lists/i });
    await user.click(listsBtn);

    const dialog = await screen.findByRole("dialog");
    const newListInput = within(dialog).getByLabelText(/new list name/i);
    await user.type(newListInput, "Clinical rotations{Enter}");

    await waitFor(() =>
      expect(createListSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Clinical rotations" }),
      ),
    );
    expect(await within(dialog).findByText("Clinical rotations")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /rename.*Clinical rotations/i }));
    const renameInput = within(dialog).getByLabelText(/rename list/i);
    await user.clear(renameInput);
    await user.type(renameInput, "Rotations{Enter}");
    await waitFor(() =>
      expect(updateListSpy).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000002",
        expect.objectContaining({ name: "Rotations" }),
      ),
    );

    await user.click(within(dialog).getByRole("button", { name: /delete.*Rotations/i }));
    await waitFor(() =>
      expect(deleteListSpy).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000002"),
    );
  });

  it("shows rewarded tasks today counter and calm cap notice when daily cap is reached (R3)", async () => {
    vi.spyOn(ipcModule.ipc, "listTaskLists").mockResolvedValue([]);
    vi.spyOn(ipcModule.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockResolvedValue(
      makeBoard({ tasks: [], deck_due_items: [] }),
    );
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue({
      level: 4,
      xp_into_level: 120,
      xp_to_next_level: 250,
      total_xp: 570,
      gold_cents: 4750,
      today_xp: 100,
      today_gold_cents: 1000,
      tasks_rewarded_today: 10,
      task_reward_daily_cap: 10,
    });

    renderMatrix();

    expect(await screen.findByText("Rewarded tasks today: 10 / 10")).toBeInTheDocument();
    expect(screen.getByTestId("matrix-reward-cap-notice")).toBeInTheDocument();
  });

  it("renders Arabic rewarded tasks counter with 'من' instead of reversed slash (A1)", async () => {
    setLocale("ar");
    vi.spyOn(ipcModule.ipc, "listTaskLists").mockResolvedValue([]);
    vi.spyOn(ipcModule.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockResolvedValue(
      makeBoard({ tasks: [], deck_due_items: [] }),
    );
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue({
      level: 4,
      xp_into_level: 120,
      xp_to_next_level: 250,
      total_xp: 570,
      gold_cents: 4750,
      today_xp: 100,
      today_gold_cents: 1000,
      tasks_rewarded_today: 10,
      task_reward_daily_cap: 10,
    });

    renderMatrix();

    expect(await screen.findByText(/10 من 10/)).toBeInTheDocument();
  });

  it("renders DeckDue card with Review badge, hint tooltip, no draggable attr, and Study/Browse/Edit menu (C2)", async () => {
    const user = userEvent.setup();
    const board = makeBoard({
      tasks: [
        makeTask({
          id: "t-linked",
          title: "Review harmony exercise",
          priority: "high",
          due_date: "2026-11-22",
          effective_quadrant: "q1",
          deck_id: 2,
          deck_name: "Classical Music Themes",
        }),
      ],
    });
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockResolvedValue(board);

    renderMatrix();

    const q1 = await screen.findByTestId("quadrant-q1");
    const deckCard = within(q1).getByTestId("deck-due-2");
    expect(deckCard).toHaveAttribute("draggable", "true");
    expect(deckCard).toHaveAttribute(
      "title",
      expect.stringContaining("Placed in I (Urgent & important)"),
    );
    expect(within(deckCard).getByText("Review")).toBeInTheDocument();

    // Linked-deck chip on a task has a distinct "Linked deck: <name>" title
    const taskChip = within(q1).getByTitle("Linked deck: Classical Music Themes");
    expect(taskChip).toHaveTextContent("Classical Music Themes");

    // Menu has Study, Open in Browse, Move to…, Edit this box's rule — no Delete
    const menuBtn = within(deckCard).getByRole("button", {
      name: /Actions for Classical Music Themes/i,
    });
    await user.click(menuBtn);

    const items = screen.getAllByRole("menuitem");
    expect(items.map((el) => el.textContent?.trim())).toEqual([
      "Study",
      "Open in Browse",
      "Move to…",
      "Edit this box's rule",
    ]);
    expect(screen.queryByRole("menuitem", { name: /delete/i })).not.toBeInTheDocument();

    // "Open in Browse" navigates with deck:"..." filter
    await user.click(screen.getByRole("menuitem", { name: "Open in Browse" }));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/browse",
      search: { q: 'deck:"Classical Music Themes"' },
    });

    // Reopen and click Study
    await user.click(menuBtn);
    await user.click(screen.getByRole("menuitem", { name: "Study" }));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/study/$deckId",
      params: { deckId: 2 },
    });

    // Reopen and click Edit rule -> opens EditMatrixDialog for Q1
    await user.click(menuBtn);
    await user.click(screen.getByRole("menuitem", { name: "Edit this box's rule" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Edit quadrant I")).toBeInTheDocument();
  });

  it("gives open tasks cursor-grab, keeps completed tasks non-draggable without grab, and supports keyboard Move to Q2 (C3)", async () => {
    const user = userEvent.setup();
    const completedTask = makeTask({
      id: "t-done",
      title: "Finished review",
      completed_at: 1_700_000_000_000,
      completed_day: 1,
      effective_quadrant: null,
    });
    let board = makeBoard({ tasks: [...makeBoard().tasks, completedTask] });
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockImplementation(async (includeCompleted) => ({
      ...board,
      tasks: includeCompleted ? board.tasks : board.tasks.filter((t) => t.completed_at === null),
    }));
    const moveSpy = vi
      .spyOn(ipcModule.ipc, "moveTaskToQuadrant")
      .mockImplementation(async (id, quadrant: QuadrantKey) => {
        let updated!: TaskDto;
        board = {
          ...board,
          tasks: board.tasks.map((t) => {
            if (t.id === id) {
              updated = { ...t, manual_quadrant: quadrant, effective_quadrant: quadrant };
              return updated;
            }
            return t;
          }),
        };
        return updated;
      });

    renderMatrix();

    const q4 = await screen.findByTestId("quadrant-q4");
    const openRow = within(q4).getByText("Sort old PDFs").closest("[draggable]") as HTMLElement;
    expect(openRow).toHaveAttribute("draggable", "true");
    expect(openRow).toHaveClass("cursor-grab", "active:cursor-grabbing");

    // Toggle completed tasks on and verify completed row is not draggable and lacks grab class
    await user.click(screen.getByRole("switch", { name: /show completed/i }));
    const completedSection = await screen.findByTestId("matrix-completed");
    const doneRow = within(completedSection)
      .getByText("Finished review")
      .closest("[draggable]") as HTMLElement;
    expect(doneRow).toHaveAttribute("draggable", "false");
    expect(doneRow).not.toHaveClass("cursor-grab");
    expect(doneRow).not.toHaveClass("active:cursor-grabbing");

    // Keyboard move: open task menu -> Move to… -> II (q2)
    const rowMenuBtn = within(screen.getByTestId("quadrant-q4")).getByRole("button", {
      name: /actions/i,
    });
    rowMenuBtn.focus();
    expect(rowMenuBtn).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    // Complete -> Edit -> Move to…
    await user.keyboard("{ArrowDown}{ArrowDown}");
    const moveToItem = screen.getByRole("menuitem", { name: /move to/i });
    expect(moveToItem).toHaveFocus();
    await user.keyboard("{Enter}");
    const q2Item = await screen.findByRole("menuitem", { name: /Important, not urgent/i });
    // Expand quadrant choices: I (q1) -> II (q2)
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(q2Item).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(moveSpy).toHaveBeenCalledWith("t-4", "q2"));
  });
});

describe("EisenhowerMatrixScreen (PLN2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLocale("en");
    useStyle.getState().setStyle("default");
    navigateMock.mockReset();
    vi.spyOn(ipcModule.ipc, "listDecks").mockResolvedValue(sampleDecks);
    vi.spyOn(ipcModule.ipc, "listTaskLists").mockResolvedValue(sampleLists);
    vi.spyOn(ipcModule.ipc, "undoStatus").mockResolvedValue(null);
  });

  afterEach(() => {
    setLocale("en");
  });

  it("matrix_list_toggle_filters_today_inbox_lists", async () => {
    const user = userEvent.setup();
    const board = makeBoard({
      tasks: [
        makeTask({
          id: "t-today",
          title: "Today study task",
          priority: "high",
          due_date: "2026-11-22",
          list_id: sampleLists[0].id,
          list_name: sampleLists[0].name,
          effective_quadrant: "q1",
        }),
        makeTask({
          id: "t-inbox",
          title: "Inbox unscheduled task",
          priority: "medium",
          due_date: null,
          list_id: null,
          list_name: null,
          effective_quadrant: "q2",
        }),
        makeTask({
          id: "t-list-later",
          title: "Future list task",
          priority: "low",
          due_date: "2026-11-28",
          list_id: sampleLists[0].id,
          list_name: sampleLists[0].name,
          effective_quadrant: "q4",
        }),
      ],
    });
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockResolvedValue(board);

    renderMatrix();
    await screen.findByTestId("quadrant-q1");

    // Toggle to List view via header button
    await user.click(screen.getByRole("tab", { name: /^List$/i }));
    const listView = await screen.findByTestId("matrix-list-view");

    // Today smart view shows Today task + DeckDue card, hides Inbox/Future
    expect(within(listView).getByText("Today study task")).toBeInTheDocument();
    expect(within(listView).getByText("Classical Music Themes")).toBeInTheDocument();
    expect(within(listView).queryByText("Inbox unscheduled task")).not.toBeInTheDocument();

    // Switch to Inbox
    await user.click(within(listView).getByRole("button", { name: /^Inbox$/i }));
    expect(within(listView).getByText("Inbox unscheduled task")).toBeInTheDocument();
    expect(within(listView).queryByText("Today study task")).not.toBeInTheDocument();

    // Switch to custom list "Study"
    await user.click(within(listView).getByRole("button", { name: /^Study$/i }));
    expect(within(listView).getByText("Today study task")).toBeInTheDocument();
    expect(within(listView).getByText("Future list task")).toBeInTheDocument();
    expect(within(listView).queryByText("Inbox unscheduled task")).not.toBeInTheDocument();

    // Switch to All tasks
    await user.click(within(listView).getByRole("button", { name: /^All tasks$/i }));
    expect(within(listView).getByText("Today study task")).toBeInTheDocument();
    expect(within(listView).getByText("Inbox unscheduled task")).toBeInTheDocument();
    expect(within(listView).getByText("Future list task")).toBeInTheDocument();
  });

  it("task_detail_panel_saves_inline_without_modal", async () => {
    const user = userEvent.setup();
    let board = makeBoard();
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockImplementation(async () => board);
    const updateSpy = vi
      .spyOn(ipcModule.ipc, "updateTask")
      .mockImplementation(async (id, input) => {
        let updated!: TaskDto;
        board = {
          ...board,
          tasks: board.tasks.map((t) => {
            if (t.id === id) {
              updated = { ...t, ...input };
              return updated;
            }
            return t;
          }),
        };
        return updated;
      });

    renderMatrix();
    const q1 = await screen.findByTestId("quadrant-q1");

    // Clicking task body opens non-modal SidePanel (complementary), NOT modal dialog
    await user.click(within(q1).getByText("Review pharmacology notes"));
    const panel = await screen.findByRole("complementary", { name: /Task details/i });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Board remains clickable behind SidePanel (switching task commits or selects)
    const titleInput = within(panel).getByLabelText(/^Title$/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Review pharmacology flashcards");
    fireEvent.blur(titleInput);

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        "t-1",
        expect.objectContaining({ title: "Review pharmacology flashcards" }),
      ),
    );
  });

  it("intra_quadrant_drag_reorders_and_switches_to_manual_sort", async () => {
    let board = makeBoard({
      tasks: [
        makeTask({
          id: "t-a",
          title: "First task",
          priority: "high",
          due_date: "2026-11-22",
          effective_quadrant: "q1",
          sort_order: 0,
        }),
        makeTask({
          id: "t-b",
          title: "Second task",
          priority: "high",
          due_date: "2026-11-22",
          effective_quadrant: "q1",
          sort_order: 10,
        }),
      ],
    });
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockImplementation(async () => board);
    const saveQuadrantSpy = vi
      .spyOn(ipcModule.ipc, "saveMatrixQuadrant")
      .mockImplementation(async (q) => {
        board = {
          ...board,
          quadrants: board.quadrants.map((item) =>
            item.quadrant_key === q.quadrant_key ? q : item,
          ),
        };
        return q;
      });
    const reorderSpy = vi.spyOn(ipcModule.ipc, "reorderTasks").mockImplementation(async (items) => {
      const orderMap = new Map(items.map((i) => [i.id, i.sort_order]));
      board = {
        ...board,
        tasks: board.tasks.map((t) =>
          orderMap.has(t.id) ? { ...t, sort_order: orderMap.get(t.id)! } : t,
        ),
      };
    });

    renderMatrix();
    const q1 = await screen.findByTestId("quadrant-q1");
    const rowA = within(q1).getByText("First task").closest("[data-task-row-id]") as HTMLElement;
    const rowB = within(q1).getByText("Second task").closest("[data-task-row-id]") as HTMLElement;

    vi.spyOn(rowA, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 44,
      height: 44,
      left: 0,
      right: 300,
      width: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(rowB, "getBoundingClientRect").mockReturnValue({
      top: 50,
      bottom: 94,
      height: 44,
      left: 0,
      right: 300,
      width: 300,
      x: 0,
      y: 50,
      toJSON: () => ({}),
    });

    const handleA = within(rowA).getByRole("button", { name: /Reorder First task/i });
    fireEvent.pointerDown(handleA, { clientY: 20, button: 0, pointerId: 1 });
    fireEvent.pointerMove(document, { clientY: 85, pointerId: 1 });

    expect(within(q1).getByTestId("reorder-insertion-line")).toBeInTheDocument();

    fireEvent.pointerUp(document, { clientY: 85, pointerId: 1 });

    await waitFor(() => {
      expect(saveQuadrantSpy).toHaveBeenCalledWith(
        expect.objectContaining({ quadrant_key: "q1", sort_by: "manual" }),
      );
      expect(reorderSpy).toHaveBeenCalledTimes(1);
      expect(reorderSpy).toHaveBeenCalledWith([
        { id: "t-b", sort_order: 0 },
        { id: "t-a", sort_order: 10 },
      ]);
    });
    expect(await within(q1).findByText("Sorted manually")).toBeInTheDocument();
  });

  it("keyboard_reorder_calls_reorder_tasks_once", async () => {
    const user = userEvent.setup();
    const board = makeBoard({
      tasks: [
        makeTask({
          id: "t-a",
          title: "Alpha task",
          priority: "high",
          due_date: "2026-11-22",
          effective_quadrant: "q1",
          sort_order: 0,
        }),
        makeTask({
          id: "t-b",
          title: "Beta task",
          priority: "high",
          due_date: "2026-11-22",
          effective_quadrant: "q1",
          sort_order: 10,
        }),
      ],
    });
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockImplementation(async () => board);
    vi.spyOn(ipcModule.ipc, "saveMatrixQuadrant").mockImplementation(async (q) => q);
    const reorderSpy = vi.spyOn(ipcModule.ipc, "reorderTasks").mockResolvedValue(undefined);

    renderMatrix();
    const q1 = await screen.findByTestId("quadrant-q1");
    const rowA = within(q1).getByText("Alpha task").closest("[data-task-row-id]") as HTMLElement;
    rowA.focus();

    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");

    await waitFor(() => {
      expect(reorderSpy).toHaveBeenCalledTimes(1);
      expect(reorderSpy).toHaveBeenCalledWith([
        { id: "t-b", sort_order: 0 },
        { id: "t-a", sort_order: 10 },
      ]);
    });
  });

  it("move_overdue_to_today_bulk_updates_and_collapses_groups", async () => {
    const user = userEvent.setup();
    let board = makeBoard({
      quadrants: makeDefaultQuadrants().map((q) =>
        q.quadrant_key === "q1" ? { ...q, group_by: "priority" } : q,
      ),
      tasks: [
        makeTask({
          id: "t-overdue",
          title: "Overdue lab review",
          priority: "high",
          due_date: "2026-11-20",
          effective_quadrant: "q1",
        }),
        makeTask({
          id: "t-today",
          title: "Today seminar prep",
          priority: "high",
          due_date: "2026-11-22",
          effective_quadrant: "q1",
        }),
      ],
    });
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockImplementation(async () => board);
    const rescheduleSpy = vi
      .spyOn(ipcModule.ipc, "rescheduleOverdueTasks")
      .mockImplementation(async (targetDate) => {
        board = {
          ...board,
          tasks: board.tasks.map((t) =>
            t.due_date && t.due_date < board.today_date ? { ...t, due_date: targetDate } : t,
          ),
        };
        return 1;
      });

    renderMatrix();
    const q1 = await screen.findByTestId("quadrant-q1");

    // Collapsible group heading in Q1
    const groupToggle = within(q1).getByRole("button", { name: /Toggle group High/i });
    expect(groupToggle).toHaveAttribute("aria-expanded", "true");
    await user.click(groupToggle);
    expect(groupToggle).toHaveAttribute("aria-expanded", "false");
    expect(within(q1).queryByText("Overdue lab review")).not.toBeInTheDocument();

    // Expand back
    await user.click(groupToggle);
    expect(within(q1).getByText("Overdue lab review")).toBeInTheDocument();

    // Move 1 overdue to today button
    const moveOverdueBtn = screen.getByRole("button", { name: /Move 1 overdue to today/i });
    await user.click(moveOverdueBtn);

    await waitFor(() => expect(rescheduleSpy).toHaveBeenCalledWith("2026-11-22"));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /overdue to today/i })).not.toBeInTheDocument(),
    );
  });

  it("supports inline title edit, due-date popover, and priority dot popover on rows", async () => {
    const user = userEvent.setup();
    let board = makeBoard();
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockImplementation(async () => board);
    const updateSpy = vi
      .spyOn(ipcModule.ipc, "updateTask")
      .mockImplementation(async (id, input) => {
        let updated!: TaskDto;
        board = {
          ...board,
          tasks: board.tasks.map((t) => {
            if (t.id === id) {
              updated = { ...t, ...input };
              return updated;
            }
            return t;
          }),
        };
        return updated;
      });

    renderMatrix();
    const q4 = await screen.findByTestId("quadrant-q4");

    // Double-click title to inline edit
    await user.dblClick(within(q4).getByText("Sort old PDFs"));
    const titleInput = within(q4).getByLabelText(/Edit title for Sort old PDFs/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Sort anatomy PDFs{Enter}");

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        "t-4",
        expect.objectContaining({ title: "Sort anatomy PDFs" }),
      ),
    );

    // Click priority dot to change priority
    await user.click(
      within(q4).getByRole("button", { name: /Set priority for Sort anatomy PDFs/i }),
    );
    await user.click(within(q4).getByRole("option", { name: /^High$/i }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith("t-4", expect.objectContaining({ priority: "high" })),
    );

    // Click + Date button to set Today
    await user.click(
      within(q4).getByRole("button", { name: /Set due date for Sort anatomy PDFs/i }),
    );
    await user.click(within(q4).getByRole("button", { name: /^Today$/i }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        "t-4",
        expect.objectContaining({ due_date: "2026-11-22" }),
      ),
    );
  });

  it("supports Matrix keyboard shortcuts (V, J/K, 1-4, Shift+1..4, F2, Delete) and ignores inputs", async () => {
    const user = userEvent.setup();
    const board = makeBoard();
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockImplementation(async () => board);
    const updateSpy = vi.spyOn(ipcModule.ipc, "updateTask").mockResolvedValue(board.tasks[0]);
    const moveSpy = vi.spyOn(ipcModule.ipc, "moveTaskToQuadrant").mockResolvedValue(board.tasks[0]);
    const deleteSpy = vi.spyOn(ipcModule.ipc, "deleteTask").mockResolvedValue(undefined);

    renderMatrix();
    await screen.findByTestId("quadrant-q1");

    // V toggles to List view and back
    await user.keyboard("v");
    expect(await screen.findByTestId("matrix-list-view")).toBeInTheDocument();
    await user.keyboard("v");
    expect(await screen.findByTestId("quadrant-q1")).toBeInTheDocument();

    // J moves focus to first task row
    await user.keyboard("j");
    const firstRow = screen
      .getByText("Review pharmacology notes")
      .closest("[data-task-row-id]") as HTMLElement;
    expect(firstRow).toHaveFocus();

    // 2 sets priority to medium
    await user.keyboard("2");
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        "t-1",
        expect.objectContaining({ priority: "medium" }),
      ),
    );

    // Shift+2 moves to Q2
    await user.keyboard("{Shift>}2{/Shift}");
    await waitFor(() => expect(moveSpy).toHaveBeenCalledWith("t-1", "q2"));

    // Q opens quick-add input; typing "v" inside input must NOT toggle List view
    await user.keyboard("q");
    const quickInput = await within(screen.getByTestId("quadrant-q1")).findByRole("textbox");
    expect(quickInput).toHaveFocus();
    await user.type(quickInput, "vocab");
    expect(screen.queryByTestId("matrix-list-view")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    // Refocus row and Delete soft-deletes
    firstRow.focus();
    await user.keyboard("{Delete}");
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith("t-1"));
  });

  it("shows loading skeleton, error retry, and per-quadrant collapsible completed footer", async () => {
    const user = userEvent.setup();
    const getSpy = vi
      .spyOn(ipcModule.ipc, "getMatrixBoard")
      .mockRejectedValueOnce(new Error("db busy"))
      .mockResolvedValue(
        makeBoard({
          tasks: [
            ...makeBoard().tasks,
            makeTask({
              id: "t-q1-done",
              title: "Completed Q1 task",
              priority: "high",
              due_date: "2026-11-22",
              manual_quadrant: "q1",
              completed_at: 1_700_000_000_000,
              completed_day: 1,
              effective_quadrant: null,
            }),
          ],
        }),
      );

    renderMatrix();

    expect(await screen.findByText("Could not load Eisenhower matrix.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Retry/i }));

    const q1 = await screen.findByTestId("quadrant-q1");
    expect(getSpy).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("switch", { name: /show completed/i }));
    const footerBtn = await within(q1).findByTestId("quadrant-completed-q1");
    expect(footerBtn).toHaveAttribute("aria-expanded", "false");
    await user.click(footerBtn);
    expect(footerBtn).toHaveAttribute("aria-expanded", "true");
    expect(within(q1).getByText("Completed Q1 task")).toBeInTheDocument();
  });

  it("bw2_4_task_row_uses_full_height_handle_larger_checkbox_flag_icons_and_calendar_chip", async () => {
    const user = userEvent.setup();
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockResolvedValue(makeBoard());

    renderMatrix();
    const q1 = await screen.findByTestId("quadrant-q1");
    const q4 = screen.getByTestId("quadrant-q4");

    const row1 = within(q1)
      .getByText("Review pharmacology notes")
      .closest("[data-task-row-id]") as HTMLElement;
    const handle = within(row1).getByRole("button", { name: /Reorder Review pharmacology notes/i });
    expect(handle.className).toContain("self-stretch");

    const checkbox = within(row1).getByRole("checkbox", { name: "Review pharmacology notes" });
    expect(checkbox.className).toMatch(/size-5|size-\[18px\]|size-\[19px\]|size-\[20px\]/);
    expect(checkbox.className).toContain("rounded-md");

    // Priority uses a Flag SVG icon on row and inside picker (none = outline fill="none")
    const prioBtn = within(row1).getByRole("button", {
      name: /Set priority for Review pharmacology notes/i,
    });
    const rowFlag = prioBtn.querySelector("svg");
    expect(rowFlag).not.toBeNull();
    expect(rowFlag).toHaveAttribute("fill", "currentColor");

    await user.click(prioBtn);
    const highOpt = within(row1).getByRole("option", { name: /^High$/i });
    const noneOpt = within(row1).getByRole("option", { name: /^None$/i });
    expect(highOpt.querySelector("svg")).toHaveAttribute("fill", "currentColor");
    expect(noneOpt.querySelector("svg")).toHaveAttribute("fill", "none");

    // Unset date button has a Calendar SVG icon and chip border/background styling
    const row4 = within(q4).getByText("Sort old PDFs").closest("[data-task-row-id]") as HTMLElement;
    const addDateBtn = within(row4).getByRole("button", {
      name: /Set due date for Sort old PDFs/i,
    });
    expect(addDateBtn.querySelector("svg")).not.toBeNull();
    expect(addDateBtn.className).toContain("border");
  });

  it("bw2_3_moves_study_drill_to_Q2_via_Move_to_menu_persists_after_reload_and_keeps_inbox_tasks", async () => {
    const user = userEvent.setup();
    let board = makeBoard();
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockImplementation(async () => board);
    const saveSpy = vi
      .spyOn(ipcModule.ipc, "saveMatrixQuadrant")
      .mockImplementation(async (updated) => {
        const nextQuadrants = board.quadrants.map((q) =>
          q.quadrant_key === updated.quadrant_key ? updated : q,
        );
        // Recompute deck placement from saved rules (mirrors Rust 2-pass evaluation)
        const order: QuadrantKey[] = ["q1", "q2", "q3", "q4"];
        const placeDeck = (deckId: number): QuadrantKey | null => {
          for (const key of order) {
            const q = nextQuadrants.find((item) => item.quadrant_key === key);
            if (!q) continue;
            const rule = q.rule as typeof q.rule & {
              pinned_deck_ids?: number[];
              excluded_deck_ids?: number[];
            };
            const typeOk = !rule.types || rule.types.includes("deck_due");
            if (
              typeOk &&
              !(rule.excluded_deck_ids ?? []).includes(deckId) &&
              (rule.pinned_deck_ids ?? []).includes(deckId)
            ) {
              return key;
            }
          }
          for (const key of order) {
            const q = nextQuadrants.find((item) => item.quadrant_key === key);
            if (!q) continue;
            const rule = q.rule as typeof q.rule & {
              excluded_deck_ids?: number[];
            };
            const typeOk = !rule.types || rule.types.includes("deck_due");
            if (!typeOk || (rule.excluded_deck_ids ?? []).includes(deckId)) continue;
            const listOk =
              rule.lists.mode === "all" ||
              (rule.lists.mode === "custom" && rule.lists.deck_ids.includes(deckId));
            const dateOk = !rule.date_filters || rule.date_filters.includes("today");
            if (listOk && dateOk) return key;
          }
          return null;
        };
        board = {
          ...board,
          quadrants: nextQuadrants,
          deck_due_items: board.deck_due_items.map((item) => ({
            ...item,
            quadrant_key: placeDeck(item.deck_id) ?? item.quadrant_key,
          })),
        };
        return updated;
      });

    const first = renderMatrix();
    const q1 = await screen.findByTestId("quadrant-q1");
    const deckCard = within(q1).getByTestId("deck-due-2");
    expect(deckCard).toHaveAttribute("draggable", "true");
    expect(deckCard.getAttribute("title")).toMatch(/Urgent & important/i);

    // Keyboard path through "Move to…" menu -> Important, not urgent (II)
    const menuBtn = within(deckCard).getByRole("button", {
      name: /Actions for Classical Music Themes/i,
    });
    menuBtn.focus();
    await user.keyboard("{Enter}");
    const moveToItem = await screen.findByRole("menuitem", { name: /Move to/i });
    moveToItem.focus();
    await user.keyboard("{Enter}");
    const q2Option = await screen.findByRole("menuitem", { name: /Important, not urgent/i });
    q2Option.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());

    const q2After = screen.getByTestId("quadrant-q2");
    expect(within(q2After).getByTestId("deck-due-2")).toBeInTheDocument();
    // Inbox tasks (list_id: null) remain in Q1 and Q2
    expect(within(q1).getByText("Review pharmacology notes")).toBeInTheDocument();
    expect(within(q2After).getByText("Plan next week study blocks")).toBeInTheDocument();

    // Reload: unmount & re-render from persisted board state
    first.unmount();
    renderMatrix();
    const q2Reloaded = await screen.findByTestId("quadrant-q2");
    const reloadedDeckCard = within(q2Reloaded).getByTestId("deck-due-2");
    expect(reloadedDeckCard).toBeInTheDocument();
    expect(reloadedDeckCard.getAttribute("title")).toMatch(/Important, not urgent/i);
  });

  it("bw2_3_drag_and_drop_moves_study_drill_to_target_quadrant", async () => {
    let board = makeBoard();
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockImplementation(async () => board);
    const saveSpy = vi
      .spyOn(ipcModule.ipc, "saveMatrixQuadrant")
      .mockImplementation(async (updated) => {
        board = {
          ...board,
          quadrants: board.quadrants.map((q) =>
            q.quadrant_key === updated.quadrant_key ? updated : q,
          ),
          deck_due_items:
            updated.quadrant_key === "q4"
              ? board.deck_due_items.map((d) => ({ ...d, quadrant_key: "q4" }))
              : board.deck_due_items,
        };
        return updated;
      });

    renderMatrix();
    const q1 = await screen.findByTestId("quadrant-q1");
    const q4 = screen.getByTestId("quadrant-q4");
    const deckCard = within(q1).getByTestId("deck-due-2");

    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(type: string, val: string) {
        this.data[type] = val;
      },
      getData(type: string) {
        return this.data[type] ?? "";
      },
    };

    fireEvent.dragStart(deckCard, { dataTransfer });
    fireEvent.dragOver(q4, { dataTransfer });
    fireEvent.drop(q4, { dataTransfer });

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    expect(within(q4).getByTestId("deck-due-2")).toBeInTheDocument();
  });
});
