import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddScreen } from "./AddScreen";
import { ipc } from "@/lib/ipc";
import { modShortcut } from "@/lib/shortcuts";

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

vi.mock("@/lib/ipc", () => ({
  isTauri: () => true,
  errorMessage: (e: unknown) =>
    e && typeof e === "object" && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e),
  ipc: {
    listNotetypes: vi
      .fn()
      .mockResolvedValue([{ id: 1, name: "Basic", kind: 0, field_names: ["Front", "Back"] }]),
    getNotetype: vi.fn().mockResolvedValue({
      id: 1,
      name: "Basic",
      kind: 0,
      sort_field: 0,
      fields: [
        {
          ord: 0,
          name: "Front",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
        {
          ord: 1,
          name: "Back",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
      ],
      templates: [],
      css: "",
    }),
    listDecks: vi.fn().mockResolvedValue([{ id: 1, name: "Default", is_filtered: false }]),
    addNote: vi.fn().mockResolvedValue({ note_id: 1, cards_added: 1 }),
    checkDuplicate: vi.fn().mockResolvedValue(null),
    listTags: vi.fn().mockResolvedValue(["spanish", "verbs"]),
    aiGetConfig: vi.fn().mockResolvedValue({
      enabled: false,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: false,
    }),
    aiPreviewAction: vi.fn(),
    aiRunAction: vi.fn(),
  },
}));

describe("AddScreen A1", () => {
  it("clears field editor display after Add and returns focus to first field", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <AddScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Basic")).toBeInTheDocument();
    });

    expect(screen.getByRole("textbox", { name: "Front" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Back" })).toBeInTheDocument();

    const frontInput = screen.getAllByRole("textbox")[0];
    await user.type(frontInput, "Front question");

    const addButton = screen.getByRole("button", { name: /add/i });
    await user.click(addButton);

    await waitFor(() => {
      expect(ipc.addNote).toHaveBeenCalled();
    });

    await waitFor(() => {
      const newFrontInput = screen.getAllByRole("textbox")[0];
      expect(newFrontInput.textContent).toBe("");
    });
  });

  it("submits the note on Ctrl+Enter", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <AddScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Basic")).toBeInTheDocument();
    });

    expect(screen.getByRole("textbox", { name: "Front" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Back" })).toBeInTheDocument();

    const frontInput = screen.getAllByRole("textbox")[0];
    await user.type(frontInput, "Front text");

    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => {
      expect(ipc.addNote).toHaveBeenCalled();
    });
  });

  it("does not show filtered decks in the deck selector", async () => {
    (ipc.listDecks as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      { id: 1, name: "Default", is_filtered: false },
      { id: 2, name: "Cram filtered", is_filtered: true },
    ]);
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <AddScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Default")).toBeInTheDocument();
    });

    expect(screen.queryByText("Cram filtered")).not.toBeInTheDocument();
  });

  it("warns about duplicate note when first field exists", async () => {
    (
      ipc.checkDuplicate as unknown as { mockResolvedValue: (v: unknown) => void }
    ).mockResolvedValue(42);
    const user = userEvent.setup();
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <AddScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Basic")).toBeInTheDocument();
    });

    expect(screen.getByRole("textbox", { name: "Front" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Back" })).toBeInTheDocument();

    const frontInput = screen.getAllByRole("textbox")[0];
    await user.type(frontInput, "Duplicate question");

    await waitFor(() => {
      expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    });
  });

  it("N10: applies field dir, font, size, and description placeholder in FieldEditor", async () => {
    (ipc.getNotetype as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 1,
      name: "Basic",
      kind: 0,
      sort_field: 0,
      fields: [
        {
          ord: 0,
          name: "Front",
          options: {
            direction: "rtl",
            font: "Amiri",
            size: 22,
            description: "Write Arabic word",
          },
        },
        {
          ord: 1,
          name: "Back",
          options: { direction: "ltr", font: "", size: 0, description: "" },
        },
      ],
      templates: [],
      css: "",
    });
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <AddScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Write Arabic word")).toBeInTheDocument();
    });

    const [frontEditor, backEditor] = screen.getAllByRole("textbox");
    expect(frontEditor).toHaveAttribute("dir", "rtl");
    expect(frontEditor).toHaveStyle({ fontFamily: "Amiri", fontSize: "22px" });
    expect(backEditor).toHaveAttribute("dir", "ltr");
  });

  it("E11: Suggest back previews plain text and inserts into Back only after Accept", async () => {
    (ipc.aiGetConfig as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      enabled: true,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: true,
    });
    (
      ipc.aiPreviewAction as unknown as { mockResolvedValue: (v: unknown) => void }
    ).mockResolvedValue({
      provider: "open-ai-compatible",
      endpoint_origin: "https://api.openai.com",
      model: "gpt-4o-mini",
      system: "Draft answer.",
      prompt: 'Draft the "Back" field for:\nFront question',
    });
    (ipc.aiRunAction as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      prompt_id: "suggest_back@1",
      text: "Accepted AI back",
      suggested_fields: null,
      generated_cards: null,
      quality_findings: null,
      input_tokens: 10,
      output_tokens: 4,
    });

    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AddScreen />
      </QueryClientProvider>,
    );

    const suggestBtn = await screen.findByRole("button", { name: /Suggest back/i });
    const frontEditor = screen.getAllByRole("textbox")[0];
    await user.type(frontEditor, "Front question");
    await user.click(suggestBtn);

    expect(await screen.findByText("https://api.openai.com")).toBeInTheDocument();
    expect(ipc.aiRunAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Send to AI/i }));
    expect(await screen.findByText("Accepted AI back")).toBeInTheDocument();

    // Still empty in editor until Accept is clicked
    expect(screen.getAllByRole("textbox")[1].textContent).toBe("");

    await user.click(screen.getByRole("button", { name: /Accept & insert/i }));
    await waitFor(() => {
      expect(screen.getAllByRole("textbox")[1].textContent).toContain("Accepted AI back");
    });
  });

  it("AI0: keeps Suggest back visible when AI is off and opens Set up AI explainer", async () => {
    vi.mocked(ipc.aiRunAction).mockClear();
    vi.mocked(ipc.aiPreviewAction).mockClear();
    (ipc.aiGetConfig as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      enabled: false,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: false,
    });

    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AddScreen />
      </QueryClientProvider>,
    );

    const suggestBtn = await screen.findByRole("button", { name: /Suggest back/i });
    await user.click(suggestBtn);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/Set up AI/i);
    expect(ipc.aiRunAction).not.toHaveBeenCalled();
  });

  it("AI1: shows Generate with AI button in Add header even when AI is off", async () => {
    (ipc.aiGetConfig as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      enabled: false,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: false,
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AddScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: /Generate with AI/i })).toBeInTheDocument();
  });
});

describe("AddScreen 16j shared toolbar", () => {
  it("add_screen_renders_one_toolbar_for_many_fields", async () => {
    const eightNames = Array.from({ length: 8 }, (_, i) => `Field ${i + 1}`);
    (
      ipc.listNotetypes as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce([{ id: 9, name: "EightFields", kind: 0, field_names: eightNames }]);
    (
      ipc.getNotetype as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      id: 9,
      name: "EightFields",
      kind: 0,
      sort_field: 0,
      fields: eightNames.map((name, ord) => ({
        ord,
        name,
        options: { direction: "auto", font: "", size: 0, description: "" },
      })),
      templates: [],
      css: "",
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AddScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("textbox")).toHaveLength(8);
    });

    const toolbars = screen.getAllByRole("toolbar");
    expect(toolbars).toHaveLength(1);
    expect(screen.getAllByTitle("Bold")).toHaveLength(1);
    expect(toolbars[0].closest(".sticky")).not.toBeNull();
  });

  it("toolbar_formats_the_focused_field_only", async () => {
    (
      ipc.listNotetypes as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce([{ id: 1, name: "Basic", kind: 0, field_names: ["Front", "Back"] }]);
    (
      ipc.getNotetype as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      id: 1,
      name: "Basic",
      kind: 0,
      sort_field: 0,
      fields: [
        {
          ord: 0,
          name: "Front",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
        {
          ord: 1,
          name: "Back",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
      ],
      templates: [],
      css: "",
    });

    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AddScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("textbox")).toHaveLength(2);
    });

    const [frontBox, backBox] = screen.getAllByRole("textbox");
    // Wait for frontBox's autoFocus rAF to settle before switching focus to backBox.
    await waitFor(() => {
      expect(frontBox).toHaveFocus();
      expect(screen.getByTitle("Bold")).toBeEnabled();
    });

    await user.click(backBox);
    await waitFor(() => {
      expect(backBox).toHaveFocus();
    });

    await user.click(screen.getByTitle("Bold"));
    await waitFor(() => {
      expect(screen.getByTitle("Bold").className).toContain("bg-primary/15");
    });
    await user.keyboard("answer");

    await waitFor(() => {
      expect(backBox.querySelector("strong")?.textContent).toBe("answer");
    });
    expect(frontBox.querySelector("strong")).toBeNull();

    // Blurring backBox keeps it as the last-focused target until another field is focused.
    act(() => {
      backBox.blur();
    });
    await waitFor(() => {
      expect(backBox).not.toHaveFocus();
    });
    await user.click(screen.getByTitle("Italic"));
    // Clicking Italic runs editor.chain().focus().toggleItalic().run(), which refocuses backBox via rAF.
    await waitFor(() => {
      expect(backBox).toHaveFocus();
      expect(screen.getByTitle("Italic").className).toContain("bg-primary/15");
    });
    await user.keyboard("more");
    await waitFor(() => {
      expect(backBox.querySelector("em")?.textContent).toBe("more");
    });
    expect(frontBox.querySelector("em")).toBeNull();
  });

  it("cloze_numbering_unchanged_with_shared_toolbar", async () => {
    (
      ipc.listNotetypes as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce([{ id: 2, name: "Cloze", kind: 1, field_names: ["Text", "Extra"] }]);
    (
      ipc.getNotetype as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      id: 2,
      name: "Cloze",
      kind: 1,
      sort_field: 0,
      fields: [
        {
          ord: 0,
          name: "Text",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
        {
          ord: 1,
          name: "Extra",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
      ],
      templates: [],
      css: "",
    });

    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AddScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("textbox")).toHaveLength(2);
    });

    const [textBox, extraBox] = screen.getAllByRole("textbox");
    await user.click(textBox);
    await user.click(screen.getByTitle("Cloze (c1)"));
    expect(textBox.textContent).toContain("{{c1::…}}");

    await waitFor(() => {
      expect(screen.getByTitle("Cloze (c2)")).toBeInTheDocument();
    });

    await user.click(extraBox);
    await user.click(screen.getByTitle("Cloze (c2)"));
    expect(extraBox.textContent).toContain("{{c2::…}}");
    await waitFor(() => {
      expect(screen.getByTitle("Cloze (c3)")).toBeInTheDocument();
    });
  });

  it("keeps field label, Suggest back, and compact field padding", async () => {
    (
      ipc.listNotetypes as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce([{ id: 1, name: "Basic", kind: 0, field_names: ["Front", "Back"] }]);
    (
      ipc.getNotetype as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      id: 1,
      name: "Basic",
      kind: 0,
      sort_field: 0,
      fields: [
        {
          ord: 0,
          name: "Front",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
        {
          ord: 1,
          name: "Back",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
      ],
      templates: [],
      css: "",
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AddScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("textbox")).toHaveLength(2);
    });

    expect(screen.getByLabelText("Front")).toBeInTheDocument();
    expect(screen.getByLabelText("Back")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Suggest back/i })).toBeInTheDocument();
    for (const box of screen.getAllByRole("textbox")) {
      expect(box.className).toContain("py-1.5");
      expect(box.className).toContain("min-h-[2.5rem]");
    }
  });

  it("add_button_stays_visible_when_scrolled", async () => {
    const eightNames = Array.from({ length: 8 }, (_, i) => `Field ${i + 1}`);
    (
      ipc.listNotetypes as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce([{ id: 9, name: "EightFields", kind: 0, field_names: eightNames }]);
    (
      ipc.getNotetype as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      id: 9,
      name: "EightFields",
      kind: 0,
      sort_field: 0,
      fields: eightNames.map((name, ord) => ({
        ord,
        name,
        options: { direction: "auto", font: "", size: 0, description: "" },
      })),
      templates: [],
      css: "",
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AddScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("textbox")).toHaveLength(8);
    });

    const addButton = screen.getByRole("button", { name: /Add Note/i });
    const footer = addButton.closest("footer");
    expect(footer).not.toBeNull();
    expect(footer!.className).toContain("sticky");
    expect(footer!.className).toContain("bottom-0");
    expect(footer!.className).toContain("shrink-0");
    expect(footer).toHaveTextContent(modShortcut("Enter"));

    // Last field lives inside an overflow-auto scroll container separate from the footer,
    // so the sticky footer never overlaps or covers the last field.
    const lastField = screen.getAllByRole("textbox")[7];
    const scrollRegion = lastField.closest(".overflow-auto");
    expect(scrollRegion).not.toBeNull();
    expect(scrollRegion!.contains(footer)).toBe(false);
  });
});

describe("AddScreen BW2-7 template field grouping and hints", () => {
  it("puts front/back template fields first, folds extra fields under More fields (remembered per notetype), and shows field descriptions as hints", async () => {
    localStorage.clear();
    const fieldNames = ["Word", "IPA", "Sound", "Meaning", "Arti"];
    (
      ipc.listNotetypes as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce([{ id: 77, name: "ImportedVocab", kind: 0, field_names: fieldNames }]);
    (
      ipc.getNotetype as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      id: 77,
      name: "ImportedVocab",
      kind: 0,
      sort_field: 0,
      fields: [
        {
          ord: 0,
          name: "Word",
          options: { direction: "auto", font: "", size: 0, description: "Target vocabulary word" },
        },
        {
          ord: 1,
          name: "IPA",
          options: { direction: "auto", font: "", size: 0, description: "Pronunciation guide" },
        },
        {
          ord: 2,
          name: "Sound",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
        {
          ord: 3,
          name: "Meaning",
          options: { direction: "auto", font: "", size: 0, description: "Primary definition" },
        },
        {
          ord: 4,
          name: "Arti",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
      ],
      templates: [
        {
          ord: 0,
          name: "Card 1",
          qfmt: "{{Word}}",
          afmt: "{{FrontSide}}\n<hr id=answer>\n{{Meaning}}",
        },
      ],
      css: "",
    });

    const user = userEvent.setup();
    const queryClient = new QueryClient();
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <AddScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Target vocabulary word")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Word" })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Meaning" })).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "IPA" })).not.toBeInTheDocument();
    });

    // Extra fields (IPA, Sound, Arti) start folded under "More fields (3)"
    expect(screen.queryByRole("textbox", { name: "IPA" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Sound" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Arti" })).not.toBeInTheDocument();
    expect(screen.getByText("Target vocabulary word")).toBeInTheDocument();
    expect(screen.getByText("Primary definition")).toBeInTheDocument();

    const moreBtn = screen.getByRole("button", { name: /More fields/i });
    expect(moreBtn).toHaveAttribute("aria-expanded", "false");
    await user.click(moreBtn);

    expect(moreBtn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: "IPA" })).toBeInTheDocument();
    expect(screen.getByText("Pronunciation guide")).toBeInTheDocument();

    // Unmount and remount: expanded state is remembered for notetype 77
    unmount();
    (
      ipc.listNotetypes as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce([{ id: 77, name: "ImportedVocab", kind: 0, field_names: fieldNames }]);
    (
      ipc.getNotetype as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      id: 77,
      name: "ImportedVocab",
      kind: 0,
      sort_field: 0,
      fields: fieldNames.map((name, ord) => ({
        ord,
        name,
        options: { direction: "auto", font: "", size: 0, description: "" },
      })),
      templates: [{ ord: 0, name: "Card 1", qfmt: "{{Word}}", afmt: "{{Meaning}}" }],
      css: "",
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AddScreen />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "IPA" })).toBeInTheDocument();
    });
  });
});
