import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { QuickAddScreen } from "./QuickAddScreen";

beforeAll(() => {
  document.elementFromPoint = () => null;
  Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => ({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
});

const hideMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/platform", () => ({
  platform: {
    kind: "desktop",
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: () => () => {},
    pickPath: vi.fn(),
    pickSavePath: vi.fn(),
    globalShortcut: null,
    window: {
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      hide: (...args: unknown[]) => hideMock(...args),
      isMaximized: vi.fn().mockResolvedValue(false),
      label: () => "quick-add",
      onResized: () => () => {},
    },
  },
}));

describe("QuickAddScreen (E10)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    hideMock.mockReset().mockResolvedValue(undefined);
    vi.spyOn(ipc, "getQuickAddConfig").mockResolvedValue({
      enabled: true,
      shortcut: "Ctrl+Shift+K",
      last_deck_id: 2,
      last_notetype_id: 11,
    });
    vi.spyOn(ipc, "listNotetypes").mockResolvedValue([
      { id: 10, name: "Basic", kind: 0n, field_names: ["Front", "Back"], note_count: 1 },
      { id: 11, name: "Cloze", kind: 1n, field_names: ["Text", "Extra"], note_count: 1 },
    ]);
    vi.spyOn(ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Default",
        parent_id: null,
        is_filtered: false,
        collapsed: false,
        new_count: 0,
        learning_count: 0,
        review_count: 0,
      },
      {
        id: 2,
        name: "Biology",
        parent_id: null,
        is_filtered: false,
        collapsed: false,
        new_count: 0,
        learning_count: 0,
        review_count: 0,
      },
    ]);
    vi.spyOn(ipc, "listTags").mockResolvedValue([]);
    vi.spyOn(ipc, "getNotetype").mockResolvedValue({
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
      templates: [],
    });
    vi.spyOn(ipc, "checkDuplicate").mockResolvedValue(null);
    vi.spyOn(ipc, "rememberQuickAddTarget").mockResolvedValue({
      enabled: true,
      shortcut: "Ctrl+Shift+K",
      last_deck_id: 1,
      last_notetype_id: 10,
    });
  });

  function renderScreen() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <QuickAddScreen />
      </QueryClientProvider>,
    );
  }

  it("restores remembered deck/notetype, remembers changes, submits on Ctrl+Enter, and hides on Escape", async () => {
    const user = userEvent.setup();
    const addSpy = vi.spyOn(ipc, "addNote").mockResolvedValue({ note_id: 77, cards_added: 1 });
    const { container } = renderScreen();

    expect(container.querySelector(".h-dvh")).not.toBeNull();
    expect(container.querySelector("header.glass-chrome")).not.toBeNull();

    const deckSelect = (await screen.findByLabelText("Deck")) as HTMLSelectElement;
    const ntSelect = screen.getByLabelText("Note type") as HTMLSelectElement;
    await waitFor(() => {
      expect(deckSelect.value).toBe("2");
      expect(ntSelect.value).toBe("11");
    });

    expect(screen.getByRole("textbox", { name: "Text" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Extra" })).toBeInTheDocument();

    await user.selectOptions(deckSelect, "1");
    expect(ipc.rememberQuickAddTarget).toHaveBeenCalledWith(1, null);

    // Empty first field calls Rust validation (or addNote returns Invalid)
    addSpy.mockRejectedValueOnce({ kind: "invalid", message: "first field cannot be empty" });
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(await screen.findByRole("alert")).toHaveTextContent(/first field cannot be empty/i);
    expect(addSpy).toHaveBeenCalledWith(11, 1, ["", ""], []);

    // Type into first TipTap editor then submit via Ctrl+Enter
    const frontEditor = screen.getAllByRole("textbox")[0];
    await user.click(frontEditor);
    await user.type(frontEditor, "a");
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => {
      expect(addSpy).toHaveBeenCalledTimes(2);
      expect(addSpy).toHaveBeenLastCalledWith(11, 1, [expect.stringContaining("a"), ""], []);
    });

    // Escape hides the quick-add window via platform
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(hideMock).toHaveBeenCalled();
    });
  });

  it("BW2-7: folds non-template fields under More fields and shows field descriptions as hints", async () => {
    localStorage.clear();
    vi.spyOn(ipc, "getQuickAddConfig").mockResolvedValue({
      enabled: true,
      shortcut: "Ctrl+Shift+K",
      last_deck_id: 1,
      last_notetype_id: 22,
    });
    vi.spyOn(ipc, "listNotetypes").mockResolvedValue([
      {
        id: 22,
        name: "Vocab",
        kind: 0n,
        field_names: ["Word", "IPA", "Meaning"],
        note_count: 1,
      },
    ]);
    vi.spyOn(ipc, "getNotetype").mockResolvedValue({
      id: 22,
      name: "Vocab",
      kind: 0n,
      css: "",
      sort_field: 0n,
      fields: [
        {
          ord: 0n,
          name: "Word",
          options: { direction: "auto", font: "", size: 0, description: "Base word" },
        },
        {
          ord: 1n,
          name: "IPA",
          options: { direction: "auto", font: "", size: 0, description: "Phonetic spelling" },
        },
        {
          ord: 2n,
          name: "Meaning",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
      ],
      templates: [{ ord: 0n, name: "Card 1", qfmt: "{{Word}}", afmt: "{{Meaning}}" }],
    });

    const user = userEvent.setup();
    renderScreen();

    expect(await screen.findByText("Base word")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Word" })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Meaning" })).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "IPA" })).not.toBeInTheDocument();
    });

    expect(screen.getByText("Base word")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "IPA" })).not.toBeInTheDocument();

    const moreBtn = screen.getByRole("button", { name: /More fields/i });
    await user.click(moreBtn);
    expect(screen.getByRole("textbox", { name: "IPA" })).toBeInTheDocument();
    expect(screen.getByText("Phonetic spelling")).toBeInTheDocument();
  });
});
