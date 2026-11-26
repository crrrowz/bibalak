import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudyCardDto } from "@bibalak/ipc-types";
import { buildAppendedFieldHtml } from "@/lib/aiFormat";
import { ipc } from "@/lib/ipc";
import { useAiSession } from "@/stores/aiSession";
import { TutorPanel } from "./TutorPanel";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

const BASE_CARD: StudyCardDto = {
  card_id: 50,
  note_id: 100,
  deck_id: 1,
  question: "<div>First-line drug for chronic stable angina?</div>",
  answer: "<div>Beta-blockers</div>",
  again: "1m",
  hard: "6m",
  good: "10m",
  easy: "4d",
  new_count: 1,
  learning_count: 0,
  review_count: 0,
  card_phase: "review",
  algorithm: "fsrs",
  css: "",
};

describe("TutorPanel (AI2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAiSession.getState().reset();
  });

  function renderPanel(typedAnswer = "") {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <TutorPanel
          card={BASE_CARD}
          deckName="Cardiology"
          typedAnswer={typedAnswer}
          configured={true}
          tauri={true}
          night={false}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );
  }

  it("sends trimmed typedAnswer on Why was I wrong? and replaces previous result on next action", async () => {
    const previewSpy = vi.spyOn(ipc, "aiPreviewAction").mockResolvedValue({
      provider: "ollama",
      endpoint_origin: "http://localhost:11434",
      model: "llama3.1",
      system: "Sys",
      prompt: "Prompt",
    });
    const runSpy = vi
      .spyOn(ipc, "aiRunAction")
      .mockResolvedValueOnce({
        prompt_id: "tutor_why_wrong@1",
        text: "Verapamil is second-line when beta-blockers are contraindicated.",
        suggested_fields: null,
        generated_cards: null,
        quality_findings: null,
        input_tokens: 20,
        output_tokens: 15,
      })
      .mockResolvedValueOnce({
        prompt_id: "tutor_mnemonic@1",
        text: "B = Beta-blockers Beat angina",
        suggested_fields: null,
        generated_cards: null,
        quality_findings: null,
        input_tokens: 18,
        output_tokens: 10,
      });

    renderPanel("  Verapamil  ");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Why was I wrong\?/i }));
    expect(previewSpy).toHaveBeenCalledWith({
      kind: "tutor-why-wrong",
      front_html: BASE_CARD.question,
      back_html: BASE_CARD.answer,
      typed_answer: "Verapamil",
      deck_name: "Cardiology",
    });
    await user.click(await screen.findByRole("button", { name: /^Send to AI$/i }));
    expect(await screen.findByText(/Verapamil is second-line/i)).toBeInTheDocument();

    // Triggering Mnemonic replaces the displayed result after Send
    await user.click(screen.getByRole("button", { name: /Mnemonic/i }));
    await user.click(await screen.findByRole("button", { name: /^Send to AI$/i }));
    expect(await screen.findByText("B = Beta-blockers Beat angina")).toBeInTheDocument();
    expect(screen.queryByText(/Verapamil is second-line/i)).not.toBeInTheDocument();
    expect(runSpy).toHaveBeenCalledTimes(2);
  });

  it("buildAppendedFieldHtml appends escaped plain text after <br><br> without dropping existing field", () => {
    expect(buildAppendedFieldHtml("Original", "A & B < C\nNext line")).toBe(
      "Original<br><br>A &amp; B &lt; C<br>Next line",
    );
    expect(buildAppendedFieldHtml("   ", "Only note")).toBe("Only note");
  });
});
