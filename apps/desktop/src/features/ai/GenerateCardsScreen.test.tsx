import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { useAiSession } from "@/stores/aiSession";
import { GenerateCardsScreen } from "./GenerateCardsScreen";

const mockNavigate = vi.fn();

vi.mock("@/lib/useOptionalNavigate", () => ({
  useOptionalNavigate: () => mockNavigate,
}));

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

describe("GenerateCardsScreen (AI1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockReset();
    useAiSession.getState().reset();
    vi.spyOn(ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Default",
        parent_id: null,
        new_count: 0,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
      {
        id: 2,
        name: "Filtered",
        parent_id: null,
        new_count: 0,
        learning_count: 0,
        review_count: 0,
        is_filtered: true,
        collapsed: false,
      },
      {
        id: 3,
        name: "Cardiology",
        parent_id: null,
        new_count: 0,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc, "listNotetypes").mockResolvedValue([
      { id: 10, name: "Basic", kind: 0n, field_names: ["Front", "Back"], note_count: 1 },
    ]);
    vi.spyOn(ipc, "checkDuplicate").mockResolvedValue(null);
  });

  function renderScreen() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <GenerateCardsScreen />
      </QueryClientProvider>,
    );
  }

  it("opens setup explainer when AI is not configured instead of sending", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: false,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: false,
    });
    const runSpy = vi.spyOn(ipc, "aiRunAction");

    renderScreen();
    await screen.findByLabelText(/Target deck/i);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Study notes/i), "Short study paragraph");
    await user.click(screen.getByRole("button", { name: /^Generate cards$/i }));

    expect(await screen.findByText(/AI assistant is not set up yet/i)).toBeInTheDocument();
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("validates 50,000-character limit and adds stock Cloze when none exists", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "ollama",
      base_url: "http://localhost:11434",
      model: "llama3.1",
      has_api_key: false,
    });
    vi.spyOn(ipc, "listStockNotetypes").mockResolvedValue(["Basic", "Cloze"]);
    const addStockSpy = vi.spyOn(ipc, "addStockNotetype").mockResolvedValue({
      id: 22,
      name: "Cloze",
      kind: 1n,
      sort_field: 0n,
      fields: [],
      templates: [],
      css: "",
    });
    const listNtSpy = vi.spyOn(ipc, "listNotetypes");
    listNtSpy.mockResolvedValueOnce([
      { id: 10, name: "Basic", kind: 0n, field_names: ["Front", "Back"], note_count: 1 },
    ]);
    listNtSpy.mockResolvedValue([
      { id: 10, name: "Basic", kind: 0n, field_names: ["Front", "Back"], note_count: 1 },
      { id: 22, name: "Cloze", kind: 1n, field_names: ["Text", "Back Extra"], note_count: 0 },
    ]);

    renderScreen();
    const user = userEvent.setup();

    fireEvent.change(screen.getByLabelText(/Study notes/i), {
      target: { value: "x".repeat(50_001) },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/50,000-character limit/i);
    expect(screen.getByRole("button", { name: /^Generate cards$/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Cloze" }));
    expect(screen.getByText(/This collection has no Cloze note type yet/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Add stock Cloze note type/i }));
    await waitFor(() => {
      expect(addStockSpy).toHaveBeenCalledWith(1);
    });
  });

  it("shows multi-part consent preview, lets user edit/discard drafts, flags duplicates, and batch adds with toast + Browse link", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: true,
    });
    vi.spyOn(ipc, "aiSplitText").mockResolvedValue([
      "Part one study text.",
      "Part two longer study text.",
      "Part three conclusion.",
    ]);
    vi.spyOn(ipc, "aiPreviewAction").mockResolvedValue({
      provider: "open-ai-compatible",
      endpoint_origin: "https://api.openai.com",
      model: "gpt-4o-mini",
      system: "System rules",
      prompt: "Target cards: at most 5\n\nStudy notes:\nPart one study text.",
    });
    const runSpy = vi.spyOn(ipc, "aiRunAction");
    runSpy
      .mockResolvedValueOnce({
        prompt_id: "generate_cards@1",
        text: "{}",
        suggested_fields: null,
        generated_cards: [
          { kind: "basic", front: "Primary pacemaker?", back: "SA node" },
          { kind: "basic", front: "Check <tag>\nline2", back: "Ans" },
        ],
        quality_findings: null,
        input_tokens: 10,
        output_tokens: 10,
      })
      .mockResolvedValueOnce({
        prompt_id: "generate_cards@1",
        text: "{}",
        suggested_fields: null,
        generated_cards: [{ kind: "basic", front: "Third Q", back: "Third A" }],
        quality_findings: null,
        input_tokens: 10,
        output_tokens: 10,
      })
      .mockResolvedValueOnce({
        prompt_id: "generate_cards@1",
        text: "{}",
        suggested_fields: null,
        generated_cards: [{ kind: "basic", front: "Fourth Q", back: "Fourth A" }],
        quality_findings: null,
        input_tokens: 10,
        output_tokens: 10,
      });

    vi.spyOn(ipc, "checkDuplicate").mockImplementation(async (_nt, firstField) =>
      firstField.includes("Primary pacemaker?") ? 42 : null,
    );
    const batchSpy = vi.spyOn(ipc, "addNotesBatch").mockResolvedValue({
      note_ids: [101, 102, 103],
      cards_added: 3,
    });

    renderScreen();
    await screen.findByLabelText(/Target deck/i);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Study notes/i), "Long lecture input");
    await user.click(screen.getByRole("button", { name: /^Generate cards$/i }));

    // Consent preview explains chunk count, full Part 1, and Parts 2..N lengths
    expect(
      await screen.findByText(/3 parts will be sent to your AI provider/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Part one study text\./)).toBeInTheDocument();
    expect(screen.getByText(/Part 2 — 27 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/Part 3 — 22 characters/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Send to AI$/i }));

    // All 4 generated drafts arrive sequentially
    expect(await screen.findByDisplayValue("Fourth Q")).toBeInTheDocument();
    expect(await screen.findByText(/Possible duplicate/i)).toBeInTheDocument();

    // Discard #3 and keep #1, #2, #4
    const discardButtons = screen.getAllByRole("button", { name: /^Discard$/i });
    await user.click(discardButtons[2]);
    expect(screen.getAllByText("3 of 4 selected").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /Add 3 cards to Default/i }));

    await waitFor(() => {
      expect(batchSpy).toHaveBeenCalledWith(10, 1, [
        { fields: ["Primary pacemaker?", "SA node"], tags: ["ai-generated"] },
        { fields: ["Check &lt;tag&gt;<br>line2", "Ans"], tags: ["ai-generated"] },
        { fields: ["Fourth Q", "Fourth A"], tags: ["ai-generated"] },
      ]);
    });

    const openBrowseBtn = await screen.findByRole("button", { name: /Open in Browse/i });
    await user.click(openBrowseBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/browse", {
      q: 'tag:ai-generated deck:"Default"',
    });
  });

  it("recovers from mid-run part failure and renders Cloze preview inside sandboxed CardFace", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "ollama",
      base_url: "http://localhost:11434",
      model: "llama3.1",
      has_api_key: false,
    });
    vi.spyOn(ipc, "listNotetypes").mockResolvedValue([
      { id: 22, name: "Cloze", kind: 1n, field_names: ["Text", "Back Extra"], note_count: 1 },
    ]);
    vi.spyOn(ipc, "aiSplitText").mockResolvedValue(["Chunk 1", "Chunk 2"]);
    vi.spyOn(ipc, "aiPreviewAction").mockResolvedValue({
      provider: "ollama",
      endpoint_origin: "http://localhost:11434",
      model: "llama3.1",
      system: "Sys",
      prompt: "Chunk 1",
    });

    const runSpy = vi.spyOn(ipc, "aiRunAction");
    runSpy
      .mockResolvedValueOnce({
        prompt_id: "generate_cards@1",
        text: "{}",
        suggested_fields: null,
        generated_cards: [{ kind: "cloze", text: "The {{c1::mitral}} valve" }],
        quality_findings: null,
        input_tokens: 10,
        output_tokens: 10,
      })
      .mockRejectedValueOnce(new Error("AI request failed (HTTP 502): bad gateway"))
      .mockResolvedValueOnce({
        prompt_id: "generate_cards@1",
        text: "{}",
        suggested_fields: null,
        generated_cards: [{ kind: "cloze", text: "The {{c1::aortic}} valve" }],
        quality_findings: null,
        input_tokens: 10,
        output_tokens: 10,
      });

    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cloze" }));
    await user.type(screen.getByLabelText(/Study notes/i), "Valves text");
    await user.click(screen.getByRole("button", { name: /^Generate cards$/i }));
    await user.click(await screen.findByRole("button", { name: /^Send to AI$/i }));

    expect(await screen.findByText(/Part 2 of 2 failed/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("The {{c1::mitral}} valve")).toBeInTheDocument();

    // Retry failed part 2
    await user.click(screen.getByRole("button", { name: /Retry part/i }));
    expect(await screen.findByDisplayValue("The {{c1::aortic}} valve")).toBeInTheDocument();

    // Cloze drafts render sandboxed CardFace iframes (2 per draft -> 4 iframes)
    const frames = document.querySelectorAll("iframe[sandbox]");
    expect(frames.length).toBeGreaterThanOrEqual(2);
  });

  it("discards late replies when cancelled during multi-part run", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "ollama",
      base_url: "http://localhost:11434",
      model: "llama3.1",
      has_api_key: false,
    });
    vi.spyOn(ipc, "aiSplitText").mockResolvedValue(["Chunk 1", "Chunk 2"]);
    vi.spyOn(ipc, "aiPreviewAction").mockResolvedValue({
      provider: "ollama",
      endpoint_origin: "http://localhost:11434",
      model: "llama3.1",
      system: "Sys",
      prompt: "Chunk 1",
    });

    let resolveSecond!: (value: Awaited<ReturnType<typeof ipc.aiRunAction>>) => void;
    const secondPromise = new Promise<Awaited<ReturnType<typeof ipc.aiRunAction>>>((resolve) => {
      resolveSecond = resolve;
    });

    const runSpy = vi.spyOn(ipc, "aiRunAction");
    runSpy
      .mockResolvedValueOnce({
        prompt_id: "generate_cards@1",
        text: "{}",
        suggested_fields: null,
        generated_cards: [{ kind: "basic", front: "Kept Q", back: "Kept A" }],
        quality_findings: null,
        input_tokens: 10,
        output_tokens: 10,
      })
      .mockReturnValueOnce(secondPromise);

    renderScreen();
    await screen.findByLabelText(/Target deck/i);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Study notes/i), "Two chunks");
    await user.click(screen.getByRole("button", { name: /^Generate cards$/i }));
    await user.click(await screen.findByRole("button", { name: /^Send to AI$/i }));

    const progressBanner = (await screen.findByText(/Generating part 2 of 2/i)).closest("section")!;
    await user.click(within(progressBanner).getByRole("button", { name: /^Cancel$/i }));

    // Late resolution for part 2 must be discarded cleanly
    resolveSecond({
      prompt_id: "generate_cards@1",
      text: "{}",
      suggested_fields: null,
      generated_cards: [{ kind: "basic", front: "Late Discarded Q", back: "Late A" }],
      quality_findings: null,
      input_tokens: 10,
      output_tokens: 10,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByDisplayValue("Kept Q")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Late Discarded Q")).not.toBeInTheDocument();
  });

  it("OT-13: renders header breadcrumb 'Assistant › Generate cards from text' with back link and sets title and end-truncation on deck select", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "ollama",
      base_url: "http://localhost:11434",
      model: "llama3.1",
      has_api_key: false,
    });
    vi.spyOn(ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Classical Music Themes::Part I — Symphony Orchestra Repertoire",
        parent_id: null,
        new_count: 0,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
    ]);

    renderScreen();
    const deckSelect = await screen.findByLabelText(/Target deck/i);
    await waitFor(() => {
      expect(deckSelect).toHaveAttribute(
        "title",
        "Classical Music Themes::Part I — Symphony Orchestra Repertoire",
      );
    });
    expect(deckSelect).toHaveAttribute("dir", "auto");

    const breadcrumbNav = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(breadcrumbNav.textContent).not.toContain("›");
    expect(breadcrumbNav).toHaveTextContent(/Assistant/i);
    expect(breadcrumbNav).toHaveTextContent(/Generate cards/i);
    const chevron = breadcrumbNav.querySelector("svg");
    expect(chevron).not.toBeNull();
    expect(chevron).toHaveClass("rtl:-scale-x-100");

    // Only the breadcrumb back button exists; the old duplicate header button is gone.
    expect(screen.getAllByRole("button", { name: "Assistant" })).toHaveLength(1);

    const backBtn = within(breadcrumbNav).getByRole("button", { name: "Assistant" });
    const user = userEvent.setup();
    await user.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/assistant");
  });
});
