import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteEditorPanel } from "./NoteEditorPanel";
import { QuickAddScreen } from "@/features/add/QuickAddScreen";
import { ipc } from "@/lib/ipc";

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

vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>();
  return {
    ...actual,
    isTauri: () => true,
  };
});

describe("16j shared toolbar in Browse NoteEditorPanel & QuickAddScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("browse_and_quick_add_use_shared_toolbar", async () => {
    vi.spyOn(ipc, "getNote").mockResolvedValue({
      note_id: 201,
      notetype_name: "Extended",
      fields: [
        {
          name: "Front",
          value: "",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
        {
          name: "Back",
          value: "",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
        {
          name: "Extra",
          value: "",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
      ],
      tags: [],
    });
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: false,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: false,
    });

    const user = userEvent.setup();
    const qc1 = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc1}>
        <NoteEditorPanel noteId={201} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const richEditors = () =>
      screen.getAllByRole("textbox").filter((el) => el.getAttribute("contenteditable") === "true");

    await waitFor(() => {
      expect(richEditors()).toHaveLength(3);
    });

    const browseToolbars = screen.getAllByRole("toolbar");
    expect(browseToolbars).toHaveLength(1);
    expect(browseToolbars[0].closest(".sticky")).not.toBeNull();
    // Before focusing any field in Browse NoteEditorPanel, toolbar is disabled
    expect(browseToolbars[0]).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTitle("Bold")).toBeDisabled();

    const browseBoxes = richEditors();
    await user.click(browseBoxes[2]);
    expect(screen.getByTitle("Bold")).toBeEnabled();
    await user.click(screen.getByTitle("Bold"));
    await user.type(browseBoxes[2], "note");
    expect(browseBoxes[2].querySelector("strong")?.textContent).toBe("note");
    expect(browseBoxes[0].querySelector("strong")).toBeNull();

    cleanup();

    vi.spyOn(ipc, "getQuickAddConfig").mockResolvedValue({
      enabled: true,
      shortcut: "Ctrl+Shift+K",
      last_deck_id: 1,
      last_notetype_id: 10,
    });
    vi.spyOn(ipc, "listNotetypes").mockResolvedValue([
      {
        id: 10,
        name: "Extended",
        kind: 0n,
        field_names: ["Front", "Back", "Extra"],
        note_count: 1,
      },
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
    ]);
    vi.spyOn(ipc, "listTags").mockResolvedValue([]);
    vi.spyOn(ipc, "getNotetype").mockResolvedValue({
      id: 10,
      name: "Extended",
      kind: 0n,
      css: "",
      sort_field: 0n,
      fields: ["Front", "Back", "Extra"].map((name, ord) => ({
        ord: BigInt(ord),
        name,
        options: { direction: "auto", font: "", size: 0, description: "" },
      })),
      templates: [],
      preset: null,
    });
    vi.spyOn(ipc, "checkDuplicate").mockResolvedValue(null);

    const qc2 = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc2}>
        <QuickAddScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(richEditors()).toHaveLength(3);
    });

    const qaToolbars = screen.getAllByRole("toolbar");
    expect(qaToolbars).toHaveLength(1);
    expect(qaToolbars[0].closest(".sticky")).not.toBeNull();

    const qaBoxes = richEditors();
    await user.click(qaBoxes[1]);
    await user.click(screen.getByTitle("Bold"));
    await user.type(qaBoxes[1], "quick");
    expect(qaBoxes[1].querySelector("strong")?.textContent).toBe("quick");
    expect(qaBoxes[0].querySelector("strong")).toBeNull();
  });
});
