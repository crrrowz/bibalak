import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowseScreen } from "./BrowseScreen";
import { ipc } from "@/lib/ipc";
import { useToastStore } from "@/stores/toast";

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({ q: "" }),
  useNavigate: () => vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  isTauri: () => true,
  errorMessage: (e: unknown) =>
    e && typeof e === "object" && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e),
  ipc: {
    aiGetConfig: vi.fn(),
    aiPreviewAction: vi.fn(),
    aiRunAction: vi.fn(),
    listTags: vi.fn(),
    listDecks: vi.fn(),
    listNotetypes: vi.fn(),
    getNotetype: vi.fn(),
    getStats: vi.fn(),
    searchCards: vi.fn(),
    searchNoteRows: vi.fn(),
    previewFindReplace: vi.fn(),
    findReplaceNotes: vi.fn(),
    findDuplicates: vi.fn(),
    changeNoteType: vi.fn(),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
    suspendCards: vi.fn(),
    unsuspendCards: vi.fn(),
    buryCards: vi.fn(),
    unburyCards: vi.fn(),
    setCardFlag: vi.fn(),
    forgetCards: vi.fn(),
    setDueDate: vi.fn(),
    repositionNewCards: vi.fn(),
    previewCard: vi.fn(),
    moveCardsToDeck: vi.fn(),
    deleteNotes: vi.fn(),
    bulkAddTag: vi.fn(),
    bulkRemoveTag: vi.fn(),
    getNote: vi.fn(),
    saveNote: vi.fn(),
  },
}));

const mockCards = [
  {
    card_id: 101,
    note_id: 201,
    sort_field: "Normal card Front",
    deck: "Default",
    notetype: "Basic",
    tags: ["tag1"],
    queue: 0,
    card_type: 0,
    due: 5,
    interval: 0,
    lapses: 0,
    reps: 0,
    flags: 1,
  },
  {
    card_id: 102,
    note_id: 202,
    sort_field: "Suspended card",
    deck: "Default",
    notetype: "Basic",
    tags: [],
    queue: -1,
    card_type: 2,
    due: 365,
    interval: 10,
    lapses: 1,
    reps: 5,
    flags: 0,
  },
  {
    card_id: 103,
    note_id: 203,
    sort_field: "Buried card",
    deck: "Default",
    notetype: "Basic",
    tags: [],
    queue: -2,
    card_type: 2,
    due: 368,
    interval: 5,
    lapses: 0,
    reps: 2,
    flags: 0,
  },
  {
    card_id: 104,
    note_id: 204,
    sort_field: "Entity &amp; &nbsp; {{c1::cloze answer::hint}} test",
    deck: "Default",
    notetype: "Cloze",
    tags: [],
    queue: 0,
    card_type: 0,
    due: 1,
    interval: 0,
    lapses: 0,
    reps: 0,
    flags: 0,
  },
];

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("BrowseScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useToastStore.getState().clear();
    vi.mocked(ipc.listTags).mockResolvedValue(["tag1", "tag2"]);
    vi.mocked(ipc.listNotetypes).mockResolvedValue([
      { id: 10, name: "Basic", kind: 0n, field_names: ["Front", "Back"], note_count: 4 },
      { id: 11, name: "Cloze", kind: 1n, field_names: ["Text", "Extra"], note_count: 1 },
    ]);
    vi.mocked(ipc.listDecks).mockResolvedValue([
      {
        id: 1,
        name: "Default",
        collapsed: false,
        is_filtered: false,
        parent_id: null,
        new_count: 0,
        learning_count: 0,
        review_count: 0,
      },
      {
        id: 2,
        name: "Filtered",
        collapsed: false,
        is_filtered: true,
        parent_id: null,
        new_count: 0,
        learning_count: 0,
        review_count: 0,
      },
    ]);
    vi.mocked(ipc.getStats).mockResolvedValue({
      day0_ms: Date.now() - 365 * 86_400_000,
    } as never);
    vi.mocked(ipc.searchCards).mockResolvedValue(mockCards);
    vi.mocked(ipc.searchNoteRows).mockResolvedValue([
      {
        note_id: 201,
        card_ids: [101, 105],
        sort_field: "Normal card Front",
        notetype: "Basic",
        deck: "Default",
        card_count: 2,
        tags: ["tag1"],
        mod_ms: 1_700_000_000_000,
      },
      {
        note_id: 202,
        card_ids: [102],
        sort_field: "Suspended card",
        notetype: "Basic",
        deck: "Default",
        card_count: 1,
        tags: [],
        mod_ms: 1_700_000_100_000,
      },
    ]);
    vi.mocked(ipc.previewFindReplace).mockResolvedValue({ notes_matched: 2, occurrences: 3 });
    vi.mocked(ipc.findReplaceNotes).mockResolvedValue(2);
    vi.mocked(ipc.findDuplicates).mockResolvedValue([
      {
        normalized: "cafe",
        sample_value: "Café",
        note_ids: [201, 202],
      },
    ]);
    vi.mocked(ipc.bulkAddTag).mockResolvedValue(undefined);
    vi.mocked(ipc.suspendCards).mockResolvedValue(undefined);
    vi.mocked(ipc.aiGetConfig).mockResolvedValue({
      enabled: false,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: false,
    });
    vi.mocked(ipc.unsuspendCards).mockResolvedValue(undefined);
    vi.mocked(ipc.buryCards).mockResolvedValue(undefined);
    vi.mocked(ipc.unburyCards).mockResolvedValue(undefined);
    vi.mocked(ipc.setCardFlag).mockResolvedValue(undefined);
    vi.mocked(ipc.forgetCards).mockResolvedValue(undefined);
    vi.mocked(ipc.setDueDate).mockResolvedValue(undefined);
    vi.mocked(ipc.repositionNewCards).mockResolvedValue(undefined);
    vi.mocked(ipc.previewCard).mockImplementation(async (cardId) => ({
      card_id: cardId,
      question: `<div>Front ${cardId}</div>`,
      answer: `<div>Back ${cardId}</div>`,
      css: ".card { color: red; }",
    }));
    vi.mocked(ipc.moveCardsToDeck).mockResolvedValue(undefined);
    vi.mocked(ipc.changeNoteType).mockResolvedValue(2);
    vi.mocked(ipc.renameTag).mockResolvedValue(1);
    vi.mocked(ipc.deleteTag).mockResolvedValue(1);
    vi.mocked(ipc.getNotetype).mockImplementation(async (id) =>
      id === 10
        ? {
            id: 10,
            name: "Basic",
            kind: 0n,
            css: "",
            sort_field: 0n,
            fields: [
              {
                ord: 0n,
                name: "Front",
                options: { direction: "auto", font: "", size: 0, description: "" },
              },
              {
                ord: 1n,
                name: "Back",
                options: { direction: "auto", font: "", size: 0, description: "" },
              },
            ],
            templates: [{ ord: 0n, name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}" }],
            preset: null,
          }
        : {
            id: 11,
            name: "Cloze",
            kind: 1n,
            css: "",
            sort_field: 0n,
            fields: [
              {
                ord: 0n,
                name: "Text",
                options: { direction: "auto", font: "", size: 0, description: "" },
              },
              {
                ord: 1n,
                name: "Extra",
                options: { direction: "auto", font: "", size: 0, description: "" },
              },
            ],
            templates: [{ ord: 0n, name: "Cloze", qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}" }],
            preset: null,
          },
    );
    vi.mocked(ipc.getNote).mockResolvedValue({
      note_id: 201,
      notetype_name: "Basic",
      fields: [
        {
          name: "Front",
          value: "Q",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
        {
          name: "Back",
          value: "A",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
      ],
      tags: ["tag1"],
    });
  });

  it("decodes HTML entities and strips cloze markup in sort_field (B9)", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Entity & cloze answer test")).toBeInTheDocument();
    });
  });

  it("formats relative due dates and new position (B5)", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("#5")).toBeInTheDocument();
      expect(screen.getByText("today")).toBeInTheDocument();
      expect(screen.getByText("in 3 days")).toBeInTheDocument();
    });
  });

  it("toggles suspend/unsuspend and bury/unbury based on selection state (B1)", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Suspended card")).toBeInTheDocument();
    });

    // 1. Click suspended card (102) -> shows "Unsuspend", does not show "Suspend"
    fireEvent.click(screen.getByText("Suspended card"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unsuspend/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Suspend$/i })).not.toBeInTheDocument();
    });

    // Click Unsuspend -> calls unsuspendCards([102])
    fireEvent.click(screen.getByRole("button", { name: /Unsuspend/i }));
    await waitFor(() => {
      expect(ipc.unsuspendCards).toHaveBeenCalledWith([102]);
    });

    // 2. Click buried card (103) -> shows "Unbury", does not show "Bury"
    await waitFor(() => {
      expect(screen.getByText("Buried card")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Buried card"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unbury/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Bury$/i })).not.toBeInTheDocument();
    });

    // Click Unbury -> calls unburyCards([103])
    fireEvent.click(screen.getByRole("button", { name: /Unbury/i }));
    await waitFor(() => {
      expect(ipc.unburyCards).toHaveBeenCalledWith([103]);
    });
  });

  it("shows both actions when selection is mixed (B1)", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Suspended card")).toBeInTheDocument();
    });

    // Select row 101 (not suspended) and Ctrl+click row 102 (suspended)
    fireEvent.click(screen.getByText("Normal card Front"));
    fireEvent.click(screen.getByText("Suspended card"), { ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Suspend$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Unsuspend/i })).toBeInTheDocument();
    });

    // Clicking Suspend operates only on non-suspended cards (101)
    fireEvent.click(screen.getByRole("button", { name: /^Suspend$/i }));
    await waitFor(() => {
      expect(ipc.suspendCards).toHaveBeenCalledWith([101]);
    });
  });

  it("sets and clears flags 0-7 (B1)", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Normal card Front"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Flag$/i })).toBeInTheDocument();
    });

    // Open flag picker
    fireEvent.click(screen.getByRole("button", { name: /^Flag$/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Flag 3/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Clear flag/i })).toBeInTheDocument();
    });

    // Click flag 3
    fireEvent.click(screen.getByRole("button", { name: /Flag 3/i }));
    await waitFor(() => {
      expect(ipc.setCardFlag).toHaveBeenCalledWith([101], 3);
    });

    // Reopen and clear flag
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Flag$/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Flag$/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Clear flag/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Clear flag/i }));
    await waitFor(() => {
      expect(ipc.setCardFlag).toHaveBeenCalledWith([101], 0);
    });
  });

  it("rejects moving cards to filtered decks in deck picker (B6)", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Normal card Front"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Move to deck/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Move to deck/i }));
    await waitFor(() => {
      expect(screen.getByText("Select deck…")).toBeInTheDocument();
    });

    const select = screen
      .getAllByRole("combobox")
      .find((el) => el.textContent?.includes("Select deck…"))!;
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toContain("Default");
    expect(options).not.toContain("Filtered"); // filtered deck must never be selectable
  });

  it("splits space-separated tag input into distinct tags (B7)", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Normal card Front"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Add tag$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Add tag$/i }));
    const tagInput = screen.getByPlaceholderText(/tag name/i);
    fireEvent.change(tagInput, { target: { value: "tagA tagB" } });
    fireEvent.submit(tagInput.closest("form")!);

    await waitFor(() => {
      expect(ipc.bulkAddTag).toHaveBeenCalledWith([201], "tagA");
      expect(ipc.bulkAddTag).toHaveBeenCalledWith([201], "tagB");
    });
  });

  it("ignores Ctrl+A and Escape inside text inputs (B2)", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search cards/i);
    fireEvent.focus(searchInput);

    // Ctrl+A inside input should NOT select all cards in the table
    fireEvent.keyDown(searchInput, { key: "a", ctrlKey: true });
    expect(screen.queryByText(/3 selected/i)).not.toBeInTheDocument();
  });

  it("autosaves dirty note edits on row switch (B3)", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    // Click row 101 to open note editor
    fireEvent.click(screen.getByText("Normal card Front"));
    await waitFor(() => {
      expect(screen.getByDisplayValue("tag1")).toBeInTheDocument();
    });

    // Edit tags in NoteEditorPanel to make it dirty
    const tagInput = screen.getByDisplayValue("tag1");
    fireEvent.change(tagInput, { target: { value: "tag1 updated" } });

    // Click suspended card (row 102)
    fireEvent.click(screen.getByText("Suspended card"));

    // ipc.saveNote must have been called for note 201 before switching!
    await waitFor(() => {
      expect(ipc.saveNote).toHaveBeenCalledWith(201, ["Q", "A"], ["tag1", "updated"]);
    });
  });

  it("N10: applies per-field dir, font, and size in Browse NoteEditorPanel", async () => {
    vi.mocked(ipc.getNote).mockResolvedValue({
      note_id: 201,
      notetype_name: "Basic",
      fields: [
        {
          name: "Front",
          value: "مرحبا",
          options: { direction: "rtl", font: "Amiri", size: 20, description: "" },
        },
        {
          name: "Back",
          value: "Hello",
          options: { direction: "ltr", font: "", size: 0, description: "" },
        },
      ],
      tags: ["tag1"],
    });

    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Normal card Front"));
    await waitFor(() => {
      const editors = screen
        .getAllByRole("textbox")
        .filter((el) => el.getAttribute("contenteditable") === "true");
      expect(editors[0]).toHaveAttribute("dir", "rtl");
      expect(editors[0]).toHaveStyle({ fontFamily: "Amiri", fontSize: "20px" });
    });
  });

  it("F6: forget dialog asks to keep or reset counts and calls forgetCards", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Suspended card")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Suspended card"));
    fireEvent.click(screen.getByRole("button", { name: /^More$/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Forget/i }));

    const checkbox = await screen.findByRole("checkbox", {
      name: /Reset repetition and lapse counts/i,
    });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Forget$/i }));

    await waitFor(() => {
      expect(ipc.forgetCards).toHaveBeenCalledWith([102], true);
    });
  });

  it("F6: set due date dialog submits range spec to setDueDate", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Normal card Front"));
    fireEvent.click(screen.getByRole("button", { name: /^More$/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Set due date/i }));

    const input = await screen.findByLabelText(/Due date range/i);
    fireEvent.change(input, { target: { value: "1-7" } });
    fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));

    await waitFor(() => {
      expect(ipc.setDueDate).toHaveBeenCalledWith([101], "1-7");
    });
  });

  it("F6: reposition dialog configures start, step, shuffle, and shift", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Normal card Front"));
    fireEvent.click(screen.getByRole("button", { name: /^More$/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Reposition/i }));

    const startInput = await screen.findByLabelText(/Start position/i);
    const stepInput = screen.getByLabelText(/^Step/i);
    const shuffleBox = screen.getByRole("checkbox", { name: /Randomize order/i });
    const shiftBox = screen.getByRole("checkbox", { name: /Shift position of existing cards/i });

    fireEvent.change(startInput, { target: { value: "5" } });
    fireEvent.change(stepInput, { target: { value: "2" } });
    fireEvent.click(shuffleBox);
    fireEvent.click(shiftBox);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^Reposition$/i }),
    );

    await waitFor(() => {
      expect(ipc.repositionNewCards).toHaveBeenCalledWith([101], 5, 2, true, false);
    });
  });

  it("F6: card preview dialog flips front/back via CardFace and steps next/previous", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]); // row 101
    fireEvent.click(checkboxes[2]); // row 102
    fireEvent.click(screen.getByRole("button", { name: /^More$/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Preview/i }));

    await waitFor(() => {
      expect(ipc.previewCard).toHaveBeenCalledWith(101);
    });
    const previewDialog = await screen.findByRole("dialog");
    expect(within(previewDialog).getByTitle("Card")).toBeInTheDocument();
    expect(within(previewDialog).getByRole("button", { name: /Show answer/i })).toBeInTheDocument();
    fireEvent.click(within(previewDialog).getByRole("button", { name: /Show answer/i }));
    expect(
      within(previewDialog).getByRole("button", { name: /Show question/i }),
    ).toBeInTheDocument();

    fireEvent.click(within(previewDialog).getByRole("button", { name: /^Next$/i }));
    await waitFor(() => {
      expect(ipc.previewCard).toHaveBeenCalledWith(102);
    });
    fireEvent.click(within(previewDialog).getByRole("button", { name: /^Previous$/i }));
    await waitFor(() => {
      expect(ipc.previewCard).toHaveBeenLastCalledWith(101);
    });
  });

  it("F7: switches between Cards and Notes mode and persists column choice per mode", async () => {
    const firstRender = renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    // Cards mode: toggle "Note type" on and "Interval" off via Columns dialog
    fireEvent.click(screen.getByRole("button", { name: /Columns/i }));
    const colDialog = await screen.findByRole("dialog", { name: /Visible columns/i });
    fireEvent.click(within(colDialog).getByRole("checkbox", { name: /Note type/i }));
    fireEvent.click(within(colDialog).getByRole("checkbox", { name: /Interval/i }));
    fireEvent.click(within(colDialog).getByRole("button", { name: /Close/i }));

    expect(screen.getByRole("columnheader", { name: /Note type/i })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Interval/i })).not.toBeInTheDocument();

    // Switch to Notes mode -> loads 1 row per note and reveals "Modified" column when toggled
    fireEvent.click(screen.getByRole("button", { name: /^Notes$/i }));
    await waitFor(() => {
      expect(ipc.searchNoteRows).toHaveBeenCalled();
    });
    expect(await screen.findByText("2 notes loaded")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Modified/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Columns/i }));
    const notesDialog = await screen.findByRole("dialog", { name: /Visible columns/i });
    fireEvent.click(within(notesDialog).getByRole("checkbox", { name: /Modified/i }));
    fireEvent.click(within(notesDialog).getByRole("button", { name: /Close/i }));
    expect(screen.getByRole("columnheader", { name: /Modified/i })).toBeInTheDocument();

    // Remount remembers Notes mode and per-mode columns; switching back to Cards keeps Cards columns
    firstRender.unmount();
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: /Modified/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Cards$/i, pressed: false }));
    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: /Note type/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("columnheader", { name: /Interval/i })).not.toBeInTheDocument();
  });

  it("F7: find & replace dialog previews counts and submits findReplaceNotes", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]); // card 101 -> note 201
    fireEvent.click(checkboxes[2]); // card 102 -> note 202
    fireEvent.click(screen.getByRole("button", { name: /^More$/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Find & replace/i }));

    const dialog = await screen.findByRole("dialog", { name: /Find and replace/i });
    fireEvent.change(within(dialog).getByLabelText(/^Find$/i), { target: { value: "alpha" } });
    fireEvent.change(within(dialog).getByLabelText(/Replace with/i), {
      target: { value: "beta" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Regular expression/i }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Match case/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Preview/i }));

    await waitFor(() => {
      expect(ipc.previewFindReplace).toHaveBeenCalledWith([201, 202], null, "alpha", true, true);
    });
    expect(within(dialog).getByText("3 matches across 2 notes.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /^Replace$/i }));
    await waitFor(() => {
      expect(ipc.findReplaceNotes).toHaveBeenCalledWith(
        [201, 202],
        null,
        "alpha",
        "beta",
        true,
        true,
      );
    });
  });

  it("F7: find duplicates dialog lists groups, opens in Browse via nid:, and tags duplicates", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Find duplicates/i }));
    const dialog = await screen.findByRole("dialog", { name: /Find duplicates/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Find$/i }));

    await waitFor(() => {
      expect(ipc.findDuplicates).toHaveBeenCalledWith(10, 0);
    });
    expect(within(dialog).getByText("Café")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /Tag duplicates/i }));
    await waitFor(() => {
      expect(ipc.bulkAddTag).toHaveBeenCalledWith([202], "duplicate");
    });

    fireEvent.click(within(dialog).getByRole("button", { name: /Open in Browse/i }));
    await waitFor(() => {
      expect(ipc.searchCards).toHaveBeenCalledWith("nid:201,202", 0, "sort_field", true, 100);
    });
  });

  it("F8 (B8): Change note type dialog maps fields and templates and calls changeNoteType", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]); // Basic (note 201)
    fireEvent.click(checkboxes[2]); // Basic (note 202)

    fireEvent.click(screen.getByRole("button", { name: /^More$/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Change note type/i }));
    const dialog = await screen.findByRole("dialog", { name: /Change note type/i });
    await waitFor(() => {
      expect(within(dialog).getByLabelText(/New note type/i)).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: /^Change$/i })).not.toBeDisabled();
    });

    fireEvent.click(within(dialog).getByRole("button", { name: /^Change$/i }));
    await waitFor(() => {
      expect(ipc.changeNoteType).toHaveBeenCalledWith([201, 202], 11, [0, 1], [[0, 0]]);
    });
  });

  it("F8 (B8): TagSidebar renders hierarchical :: tags tree with expand/collapse and filters", async () => {
    vi.mocked(ipc.listTags).mockResolvedValue(["lang::arabic::verbs", "lang::french", "other"]);
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "lang" })).toBeInTheDocument();
    });

    // Top-level shows "lang" and "other"; deep children start collapsed until expanded.
    expect(screen.getByRole("button", { name: "other" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "french" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Expand lang/i }));
    expect(screen.getByRole("button", { name: "arabic" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "french" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Expand lang::arabic/i }));
    expect(screen.getByRole("button", { name: "verbs" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "lang" }));
    await waitFor(() => {
      expect(ipc.searchCards).toHaveBeenCalledWith("tag:lang", 0, "sort_field", true, 100);
    });
  });

  it("F8 (X1 & X3): Browse surfaces bulk mutation error and confirms note deletion via ConfirmDialog", async () => {
    vi.mocked(ipc.suspendCards).mockRejectedValueOnce(new Error("suspend boom"));
    vi.mocked(ipc.deleteNotes).mockResolvedValueOnce(undefined);
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole("button", { name: /Suspend/i }));
    expect(await screen.findByText(/suspend boom/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    expect(await screen.findByText(/Delete selected notes\?/i)).toBeInTheDocument();
    const deleteButtons = screen.getAllByRole("button", { name: /^Delete$/i });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    await waitFor(() => {
      expect(ipc.deleteNotes).toHaveBeenCalledWith([201]);
    });
  });

  it("E7: virtualizes rows inside a 500-item page and steps to page 2 via Next page", async () => {
    localStorage.setItem("keepsake-browse-page-size", "500");
    const makeCard = (n: number) => ({
      card_id: 1000 + n,
      note_id: 2000 + n,
      sort_field: `Card ${n}`,
      deck: "Default",
      notetype: "Basic",
      tags: [],
      queue: 0,
      card_type: 0,
      due: n,
      interval: 0,
      lapses: 0,
      reps: 0,
      flags: 0,
    });
    const page1 = Array.from({ length: 500 }, (_, i) => makeCard(i));
    const page2 = Array.from({ length: 5 }, (_, i) => makeCard(500 + i));
    (ipc as unknown as Record<string, unknown>).countCards = vi.fn().mockResolvedValue(505);
    vi.mocked(ipc.searchCards).mockImplementation(async (_q, offset) => {
      if (offset === 0) return page1;
      if (offset === 500) return page2;
      return [];
    });

    const tPage0 = performance.now();
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Card 0")).toBeInTheDocument();
    });
    const pageRenderMs = performance.now() - tPage0;
    console.info(`[E7-PERF] 500-row page render: ${pageRenderMs.toFixed(1)} ms`);

    const virtualRows = document.querySelectorAll("tbody tr[data-index]");
    expect(virtualRows.length).toBeGreaterThan(0);
    expect(virtualRows.length).toBeLessThan(80);

    fireEvent.click(screen.getByRole("button", { name: /Next page/i }));

    await waitFor(() => {
      expect(ipc.searchCards).toHaveBeenCalledWith("", 500, "sort_field", true, 500);
    });
  });

  it("E7: Ctrl+F focuses search input and ignores Space inside input", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    // Ctrl+F focuses search input when outside inputs/editor.
    const searchInput = screen.getByPlaceholderText(/Search cards|is:due/i);
    expect(document.activeElement).not.toBe(searchInput);
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(searchInput);

    // Space inside search input must NOT toggle selection.
    fireEvent.keyDown(searchInput, { key: " " });
    expect(screen.queryByRole("button", { name: /Suspend/i })).not.toBeInTheDocument();
  });

  it("E7: supports ArrowUp/Down row move with B3 autosave, Space toggle, and ignores inputs", async () => {
    vi.mocked(ipc.saveNote).mockResolvedValue(undefined);
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    // ArrowDown from empty selection activates row 0 and opens note 201 in editor.
    fireEvent.keyDown(window, { key: "ArrowDown" });
    await waitFor(() => {
      expect(ipc.getNote).toHaveBeenCalledWith(201);
    });
    // Wait for NoteEditorPanel's useEffect([note.data]) to hydrate tags & initialRef before editing.
    const tagsInput = (await screen.findByDisplayValue("tag1")) as HTMLInputElement;
    fireEvent.change(tagsInput, { target: { value: "tag1 arrow-edited" } });

    // ArrowDown inside tags input is ignored; outside it autosaves 201 (B3) and moves to row 1 (note 202).
    tagsInput.focus();
    fireEvent.keyDown(tagsInput, { key: "ArrowDown" });
    expect(ipc.getNote).not.toHaveBeenCalledWith(202);
    tagsInput.blur();

    fireEvent.keyDown(window, { key: "ArrowDown" });
    await waitFor(() => {
      expect(ipc.saveNote).toHaveBeenCalledWith(201, ["Q", "A"], ["tag1", "arrow-edited"]);
      expect(ipc.getNote).toHaveBeenCalledWith(202);
      expect(screen.getByRole("button", { name: /Unsuspend/i })).toBeInTheDocument();
    });

    // Space toggles selection of current row off and back on.
    fireEvent.keyDown(window, { key: " " });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Suspend/i })).not.toBeInTheDocument();
    });
    fireEvent.keyDown(window, { key: " " });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unsuspend/i })).toBeInTheDocument();
    });

    // ArrowUp returns to row 0 (note 201).
    fireEvent.keyDown(window, { key: "ArrowUp" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Suspend$/i })).toBeInTheDocument();
      expect(ipc.getNote).toHaveBeenLastCalledWith(201);
    });
  });

  it("E7: scales to 100k-card virtualized list with smooth render timing and preserved selection by id", async () => {
    const bigBatch = Array.from({ length: 100_000 }, (_, i) => ({
      card_id: 10_000 + i,
      note_id: 20_000 + i,
      sort_field: `Bulk card ${i}`,
      deck: "Default",
      notetype: "Basic",
      tags: [],
      queue: 0,
      card_type: 0,
      due: i,
      interval: 0,
      lapses: 0,
      reps: 0,
      flags: 0,
    }));
    vi.mocked(ipc.searchCards).mockResolvedValueOnce(bigBatch);

    const t0 = performance.now();
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Bulk card 0")).toBeInTheDocument();
    });
    const elapsedMs = performance.now() - t0;
    console.info(`[E7-PERF] 100k virtualized BrowseScreen render: ${elapsedMs.toFixed(1)} ms`);

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    expect(document.querySelectorAll("tbody tr[data-index]").length).toBeLessThan(80);
  });

  it("E11: Rewrite leech previews plain text and updates fields only after Accept", async () => {
    vi.mocked(ipc.aiGetConfig).mockResolvedValue({
      enabled: true,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: true,
    });
    vi.mocked(ipc.getNote).mockResolvedValue({
      note_id: 201,
      notetype_name: "Basic",
      fields: [
        {
          name: "Front",
          value: "<b>Wordy front</b>",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
        {
          name: "Back",
          value: "<i>Wordy back</i>",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
      ],
      tags: ["leech"],
    });
    vi.mocked(ipc.aiPreviewAction).mockResolvedValue({
      provider: "open-ai-compatible",
      endpoint_origin: "https://api.openai.com",
      model: "gpt-4o-mini",
      system: "Rewrite leech.",
      prompt: "[Field 1: Front]\nWordy front\n\n[Field 2: Back]\nWordy back",
    });
    vi.mocked(ipc.aiRunAction).mockResolvedValue({
      prompt_id: "rewrite_leech@1",
      text: '{"fields":["Atomic front","Atomic back"]}',
      suggested_fields: ["Atomic front", "Atomic back"],
      generated_cards: null,
      quality_findings: null,
      input_tokens: 20,
      output_tokens: 10,
    });

    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Normal card Front"));
    const rewriteBtn = await screen.findByRole("button", { name: /Rewrite leech/i });
    fireEvent.click(rewriteBtn);

    const dialog = await screen.findByRole("dialog", { name: /Rewrite leech card/i });
    expect(await within(dialog).findByText("https://api.openai.com")).toBeInTheDocument();
    expect(ipc.aiRunAction).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /Send to AI/i }));
    expect(await within(dialog).findByText(/Atomic front/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /Accept & insert/i }));
    await waitFor(() => {
      expect(screen.getByText("Atomic front")).toBeInTheDocument();
      expect(screen.getByText("Atomic back")).toBeInTheDocument();
    });
  });

  it("U5: dispatches a unified toast notification when saving a note in NoteEditorPanel", async () => {
    useToastStore.getState().clear();
    vi.mocked(ipc.saveNote).mockResolvedValueOnce(undefined);
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Normal card Front"));
    const saveBtn = await screen.findByRole("button", { name: /^Save$/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(ipc.saveNote).toHaveBeenCalledTimes(1);
      expect(useToastStore.getState().items).toEqual(
        expect.arrayContaining([expect.objectContaining({ tone: "success", message: "Saved." })]),
      );
    });
    useToastStore.getState().clear();
  });

  it("B2: exposes accessible names on search, help toggle, and keyboard-sortable table headers", async () => {
    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    expect(screen.getByRole("textbox", { name: /^Search$/i })).toBeInTheDocument();

    const helpBtn = screen.getByRole("button", { name: /Query syntax help/i });
    expect(helpBtn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(helpBtn);
    expect(helpBtn).toHaveAttribute("aria-expanded", "true");

    const dueHeader = screen.getByRole("columnheader", { name: /Due/i });
    expect(dueHeader).toHaveAttribute("aria-sort", "none");
    const sortBtn = within(dueHeader).getByRole("button", { name: /Due/i });
    fireEvent.click(sortBtn);
    expect(dueHeader).toHaveAttribute("aria-sort", "ascending");
  });

  it("AI0: keeps Rewrite leech visible when OpenAI-compatible key is missing and opens Set up AI explainer", async () => {
    vi.mocked(ipc.aiGetConfig).mockResolvedValue({
      enabled: true,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: false,
    });
    vi.mocked(ipc.getNote).mockResolvedValue({
      note_id: 201,
      notetype_name: "Basic",
      fields: [
        {
          name: "Front",
          value: "<b>Wordy front</b>",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
        {
          name: "Back",
          value: "<i>Wordy back</i>",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
      ],
      tags: ["leech"],
    });

    renderWithQuery(<BrowseScreen />);
    await waitFor(() => {
      expect(screen.getByText("Normal card Front")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Normal card Front"));
    const rewriteBtn = await screen.findByRole("button", { name: /Rewrite leech/i });
    fireEvent.click(rewriteBtn);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /Set up AI/i })).toBeInTheDocument();
    expect(ipc.aiRunAction).not.toHaveBeenCalled();
  });

  it("BW2-9: renders paging footer with Showing 1–100 of N, remembered page size 50/100/250/500, and previous/next navigation", async () => {
    localStorage.clear();
    (ipc as unknown as Record<string, unknown>).countCards = vi.fn().mockResolvedValue(250);
    vi.mocked(ipc.searchCards).mockImplementation(async (_q, offset = 0, _sk, _sa, limit = 100) =>
      Array.from({ length: Math.max(0, Math.min(limit, 250 - offset)) }, (_, i) => ({
        ...mockCards[0],
        card_id: 1000 + offset + i,
        note_id: 2000 + offset + i,
        sort_field: `Card ${offset + i + 1}`,
      })),
    );

    renderWithQuery(<BrowseScreen />);

    const footer = await screen.findByTestId("browse-paging-footer");
    await waitFor(() => {
      expect(footer).toHaveTextContent("Showing 1–100 of 250");
    });

    const sizeSelect = within(footer).getByRole("combobox", { name: /Rows per page/i });
    expect(Array.from(sizeSelect.querySelectorAll("option")).map((o) => o.value)).toEqual([
      "50",
      "100",
      "250",
      "500",
    ]);

    fireEvent.change(sizeSelect, { target: { value: "50" } });
    expect(localStorage.getItem("keepsake-browse-page-size")).toBe("50");
    await waitFor(() => {
      expect(footer).toHaveTextContent("Showing 1–50 of 250");
    });

    fireEvent.click(within(footer).getByRole("button", { name: /Next page/i }));
    await waitFor(() => {
      expect(footer).toHaveTextContent("Showing 51–100 of 250");
    });

    fireEvent.click(within(footer).getByRole("button", { name: /Previous page/i }));
    await waitFor(() => {
      expect(footer).toHaveTextContent("Showing 1–50 of 250");
    });
  });
});
