import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QualityFinding, QualityScanNote } from "@bibalak/ipc-types";
import { ipc } from "@/lib/ipc";
import { useAiSession } from "@/stores/aiSession";
import { QualityReviewScreen } from "./QualityReviewScreen";

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

function makeNote(id: number): QualityScanNote {
  return {
    note_id: id,
    deck_id: 3,
    notetype_id: 10,
    notetype_kind: 0,
    notetype_css: "",
    fields: [
      { name: "Front", value_html: `Front question ${id}` },
      { name: "Back", value_html: `Back answer ${id}` },
    ],
    tags: id === 1 ? ["leech"] : ["cardiology"],
    lapses: id === 1 ? 6 : 0,
    card_ids: [id * 100],
  };
}

describe("QualityReviewScreen (AI3)", () => {
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
        id: 3,
        name: "Cardiology",
        parent_id: null,
        new_count: 2,
        learning_count: 0,
        review_count: 5,
        is_filtered: false,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc, "listNotetypes").mockResolvedValue([
      { id: 10, name: "Basic", kind: 0n, field_names: ["Front", "Back"], note_count: 5 },
      { id: 22, name: "Cloze", kind: 1n, field_names: ["Text", "Back Extra"], note_count: 0 },
    ]);
    vi.spyOn(ipc, "undoStatus").mockResolvedValue({ kind: "quality-fixes", count: 1 });
  });

  function renderScreen(props?: { initialDeckId?: number; initialNoteIds?: number[] }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <QualityReviewScreen {...props} />
      </QueryClientProvider>,
    );
  }

  it("blocks unconfigured AI and guides to setup without calling load or run", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: false,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: false,
    });
    const loadSpy = vi.spyOn(ipc, "loadQualityNotes");
    const runSpy = vi.spyOn(ipc, "aiRunAction");

    renderScreen({ initialDeckId: 3 });
    await screen.findByLabelText(/Target deck/i);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Scan notes$/i }));

    expect(await screen.findByText(/AI assistant is not set up yet/i)).toBeInTheDocument();
    expect(loadSpy).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("chunks into 20-note batches, shows consent preview, retries failed batch, groups findings, applies with Undo, and keeps Cloze split non-destructive by default", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: true,
    });
    const loadedNotes = Array.from({ length: 25 }, (_, i) => makeNote(i + 1));
    vi.spyOn(ipc, "loadQualityNotes").mockResolvedValue(loadedNotes);
    vi.spyOn(ipc, "aiPreviewAction").mockResolvedValue({
      provider: "open-ai-compatible",
      endpoint_origin: "https://api.openai.com",
      model: "gpt-4o-mini",
      system: "Quality reviewer",
      prompt: "Batch 1 plain text preview",
    });

    const batch1Findings: QualityFinding[] = [
      { kind: "unclear", note_id: 1, reason: "Vague question cue" },
      { kind: "rewrite", note_id: 1, fields: ["Clear Q <1>", "Clear A"], reason: "Atomic prompt" },
      {
        kind: "suggested-tags",
        note_id: 2,
        tags: ["cardiology", "ecg"],
        reason: "Add topic tags",
      },
    ];
    const batch2Findings: QualityFinding[] = [
      {
        kind: "cloze-split",
        note_id: 21,
        clozes: ["Systole is {{c1::contraction}}.", "Diastole is {{c1::relaxation}}."],
        reason: "Split two phases",
      },
    ];

    const runSpy = vi.spyOn(ipc, "aiRunAction");
    runSpy
      .mockResolvedValueOnce({
        prompt_id: "review_quality@1",
        text: "{}",
        suggested_fields: null,
        generated_cards: null,
        quality_findings: batch1Findings,
        input_tokens: 100,
        output_tokens: 50,
      })
      .mockRejectedValueOnce(new Error("AI request failed (HTTP 502): bad gateway"))
      .mockResolvedValueOnce({
        prompt_id: "review_quality@1",
        text: "{}",
        suggested_fields: null,
        generated_cards: null,
        quality_findings: batch2Findings,
        input_tokens: 40,
        output_tokens: 20,
      });

    const applySpy = vi.spyOn(ipc, "applyQualityFixes").mockResolvedValue({
      notes_updated: 2,
      note_ids: [1, 2],
    });
    const addBatchSpy = vi.spyOn(ipc, "addNotesBatch").mockResolvedValue({
      note_ids: [501, 502],
      cards_added: 2,
    });
    const suspendSpy = vi.spyOn(ipc, "suspendCards").mockResolvedValue(undefined);
    const undoSpy = vi.spyOn(ipc, "undo").mockResolvedValue({ kind: "quality-fixes", count: 2 });

    const onUnappliedChange = vi.fn();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <QualityReviewScreen initialDeckId={3} onUnappliedChange={onUnappliedChange} />
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Scan notes$/i }));

    expect(
      await screen.findByText(/2 batches of plain card text will be sent to your AI provider/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Batch 2 — 5 notes/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Send to AI$/i }));

    // Batch 1 succeeded, Batch 2 failed cleanly with Retry option
    expect(await screen.findByText(/Batch 2 of 2 failed/i)).toBeInTheDocument();
    expect(screen.getByText("Vague question cue")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Retry batch/i }));
    expect(await screen.findByText("Split two phases")).toBeInTheDocument();

    // Accept rewrite, suggested-tags, and cloze-split
    const acceptButtons = screen.getAllByRole("button", { name: /^Accept$/i });
    for (const btn of acceptButtons) {
      await user.click(btn);
    }

    await waitFor(() => {
      expect(onUnappliedChange).toHaveBeenLastCalledWith(3);
    });

    await user.click(screen.getByRole("button", { name: /Apply accepted changes/i }));

    await waitFor(() => {
      expect(applySpy).toHaveBeenCalledWith([
        { note_id: 1, fields: ["Clear Q &lt;1&gt;", "Clear A"], add_tags: [] },
        { note_id: 2, fields: null, add_tags: ["cardiology", "ecg"] },
      ]);
      expect(addBatchSpy).toHaveBeenCalledWith(22, 3, [
        { fields: ["Systole is {{c1::contraction}}.", ""], tags: ["ai-generated"] },
        { fields: ["Diastole is {{c1::relaxation}}.", ""], tags: ["ai-generated"] },
      ]);
    });
    // Original note stays unsuspended because user did not check the optional checkbox
    expect(suspendSpy).not.toHaveBeenCalled();

    vi.spyOn(ipc, "undoStatus").mockResolvedValue({ kind: "quality-fixes", count: 2 });
    const undoBtn = await screen.findByRole("button", { name: /^Undo$/i });
    await user.click(undoBtn);
    await waitFor(() => {
      expect(undoSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("discards late batch replies on cancel and respects Browse selection scope", async () => {
    const getCfgSpy = vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "ollama",
      base_url: "http://localhost:11434",
      model: "llama3.1",
      has_api_key: false,
    });
    const loadSpy = vi.spyOn(ipc, "loadQualityNotes").mockResolvedValue([makeNote(7)]);
    vi.spyOn(ipc, "aiPreviewAction").mockResolvedValue({
      provider: "ollama",
      endpoint_origin: "http://localhost:11434",
      model: "llama3.1",
      system: "Sys",
      prompt: "Note 7 preview",
    });

    let resolveRun!: (v: Awaited<ReturnType<typeof ipc.aiRunAction>>) => void;
    vi.spyOn(ipc, "aiRunAction").mockReturnValue(
      new Promise((resolve) => {
        resolveRun = resolve;
      }),
    );

    renderScreen({ initialNoteIds: [7] });
    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: /Browse selection \(1\)/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(getCfgSpy).toHaveBeenCalled();
    });
    await Promise.resolve();

    await user.click(screen.getByRole("button", { name: /^Scan notes$/i }));
    await user.click(await screen.findByRole("button", { name: /^Send to AI$/i }));

    await waitFor(() => {
      expect(loadSpy).toHaveBeenCalledWith(null, [7], false);
    });

    await user.click(await screen.findByRole("button", { name: /Cancel scan/i }));
    resolveRun({
      prompt_id: "review_quality@1",
      text: "{}",
      suggested_fields: null,
      generated_cards: null,
      quality_findings: [{ kind: "unclear", note_id: 7, reason: "Late cancelled finding" }],
      input_tokens: 10,
      output_tokens: 5,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByText("Late cancelled finding")).not.toBeInTheDocument();
  });

  it("checks undoStatus is quality-fixes before undoing and warns split notes are kept", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "ollama",
      base_url: "http://localhost:11434",
      model: "llama3.1",
      has_api_key: false,
    });
    vi.spyOn(ipc, "loadQualityNotes").mockResolvedValue([makeNote(1)]);
    vi.spyOn(ipc, "aiPreviewAction").mockResolvedValue({
      provider: "ollama",
      endpoint_origin: "http://localhost:11434",
      model: "llama3.1",
      system: "Sys",
      prompt: "Prompt",
    });
    vi.spyOn(ipc, "aiRunAction").mockResolvedValue({
      prompt_id: "review_quality@1",
      text: "{}",
      suggested_fields: null,
      generated_cards: null,
      quality_findings: [
        {
          kind: "rewrite",
          note_id: 1,
          fields: ["Q rewrite", "A rewrite"],
          reason: "Clearer",
        },
        {
          kind: "cloze-split",
          note_id: 1,
          clozes: ["Cloze {{c1::A}}", "Cloze {{c1::B}}"],
          reason: "Split into two",
        },
      ],
      input_tokens: 10,
      output_tokens: 10,
    });
    vi.spyOn(ipc, "applyQualityFixes").mockResolvedValue({
      note_ids: [1],
      notes_updated: 1,
    });
    vi.spyOn(ipc, "addNotesBatch").mockResolvedValue({ note_ids: [101, 102], cards_added: 2 });
    const undoSpy = vi.spyOn(ipc, "undo").mockResolvedValue({ kind: "quality-fixes", count: 1 });
    // Simulate undoStatus returning a non-quality-fixes action (e.g. answer-card)
    const undoStatusSpy = vi.spyOn(ipc, "undoStatus").mockResolvedValue({ kind: "answer-card" });

    renderScreen({ initialDeckId: 3 });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Scan notes$/i }));
    await user.click(await screen.findByRole("button", { name: /^Send to AI$/i }));

    const acceptButtons = await screen.findAllByRole("button", { name: /^Accept$/i });
    for (const btn of acceptButtons) {
      await user.click(btn);
    }
    await user.click(screen.getByRole("button", { name: /Apply accepted changes/i }));

    // Banner must display that split notes are not removed by Undo
    expect(
      await screen.findByText(/New Cloze notes created from splits are not removed by Undo/i),
    ).toBeInTheDocument();

    const undoBtn = await screen.findByRole("button", { name: /^Undo$/i });
    await user.click(undoBtn);
    // Since undoStatus was answer-card, undo must not have been invoked and a notice explains why
    expect(undoStatusSpy).toHaveBeenCalled();
    expect(undoSpy).not.toHaveBeenCalled();
    expect(await screen.findByText(/Undo is no longer available/i)).toBeInTheDocument();
  });

  it("OT-13: renders header breadcrumb with chevron icon and single back link to /assistant", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "ollama",
      base_url: "http://localhost:11434",
      model: "llama3.1",
      has_api_key: false,
    });

    renderScreen({ initialDeckId: 3 });
    await screen.findByLabelText(/Target deck/i);

    const breadcrumbNav = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(breadcrumbNav.textContent).not.toContain("›");
    expect(breadcrumbNav).toHaveTextContent(/Assistant/i);
    expect(breadcrumbNav).toHaveTextContent(/Deck quality/i);
    const chevron = breadcrumbNav.querySelector("svg");
    expect(chevron).not.toBeNull();
    expect(chevron).toHaveClass("rtl:-scale-x-100");
    expect(screen.getAllByRole("button", { name: "Assistant" })).toHaveLength(1);

    const backBtn = rowOrButtonIn(breadcrumbNav);
    const user = userEvent.setup();
    await user.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/assistant");
  });
});

function rowOrButtonIn(el: HTMLElement): HTMLElement {
  return screen.getByRole("button", { name: "Assistant" }) || el;
}
