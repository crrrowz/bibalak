import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIActionResult } from "@bibalak/ipc-types";
import { ipc } from "@/lib/ipc";
import { useAiSession } from "@/stores/aiSession";
import { AIActionDialog } from "./AIActionDialog";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

describe("AIActionDialog (E11 / AI0)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAiSession.getState().reset();
  });

  it("previews plain text without sending, runs only on Send click, and inserts only on Accept click", async () => {
    const previewSpy = vi.spyOn(ipc, "aiPreviewAction").mockResolvedValue({
      provider: "open-ai-compatible",
      endpoint_origin: "https://api.openai.com",
      model: "gpt-4o-mini",
      system: "Draft a concise answer.",
      prompt: 'Draft the "Back" field for:\nPowerhouse of the cell?',
    });
    const runSpy = vi.spyOn(ipc, "aiRunAction").mockResolvedValue({
      prompt_id: "suggest_back@1",
      text: "Mitochondrion <ATP producer>",
      suggested_fields: null,
      generated_cards: null,
      quality_findings: null,
      input_tokens: 14,
      output_tokens: 5,
    });
    const onAccept = vi.fn();
    const onClose = vi.fn();

    render(
      <AIActionDialog
        open
        title="Suggest Back field"
        action={{
          kind: "suggest-back",
          front_html: "<b>Powerhouse</b> of the cell?",
          notetype_name: "Basic",
          back_field_name: "Back",
        }}
        onAccept={onAccept}
        onClose={onClose}
      />,
    );

    await waitFor(() => {
      expect(previewSpy).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("https://api.openai.com")).toBeInTheDocument();
    expect(screen.getByText(/Powerhouse of the cell\?/)).toBeInTheDocument();
    expect(runSpy).not.toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Send to AI/i }));

    await waitFor(() => {
      expect(runSpy).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Mitochondrion <ATP producer>")).toBeInTheDocument();
    expect(screen.getByText("suggest_back@1")).toBeInTheDocument();
    expect(screen.getByText(/14 in \/ 5 out/)).toBeInTheDocument();
    expect(onAccept).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Accept & insert/i }));
    expect(onAccept).toHaveBeenCalledWith({
      prompt_id: "suggest_back@1",
      text: "Mitochondrion <ATP producer>",
      suggested_fields: null,
      generated_cards: null,
      quality_findings: null,
      input_tokens: 14,
      output_tokens: 5,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("discards late reply when cancelled while sending", async () => {
    vi.spyOn(ipc, "aiPreviewAction").mockResolvedValue({
      provider: "open-ai-compatible",
      endpoint_origin: "https://api.openai.com",
      model: "gpt-4o-mini",
      system: "Tutor",
      prompt: "Front:\nQ\n\nBack:\nA",
    });

    let resolveRun!: (v: AIActionResult) => void;
    vi.spyOn(ipc, "aiRunAction").mockImplementation(
      () =>
        new Promise((res) => {
          resolveRun = res;
        }),
    );

    const onAccept = vi.fn();
    const onClose = vi.fn();

    render(
      <AIActionDialog
        open
        title="Explain card with AI"
        action={{
          kind: "explain-card",
          front_html: "Q",
          back_html: "A",
          deck_name: null,
        }}
        onAccept={onAccept}
        onClose={onClose}
      />,
    );

    const user = userEvent.setup();
    await screen.findByText("https://api.openai.com");
    await user.click(screen.getByRole("button", { name: /Send to AI/i }));
    await screen.findByText("Sending…");

    await user.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    resolveRun({
      prompt_id: "explain_card@1",
      text: "Late result that must be discarded",
      suggested_fields: null,
      generated_cards: null,
      quality_findings: null,
      input_tokens: 10,
      output_tokens: 5,
    });

    await waitFor(() => {
      expect(screen.queryByText("Late result that must be discarded")).not.toBeInTheDocument();
    });
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("maps provider, key, invalid-reply, and network errors cleanly and returns focus on Escape", async () => {
    vi.spyOn(ipc, "aiPreviewAction").mockResolvedValue({
      provider: "open-ai-compatible",
      endpoint_origin: "https://api.openai.com",
      model: "gpt-4o-mini",
      system: "Tutor",
      prompt: "Front:\nQ\n\nBack:\nA",
    });
    vi.spyOn(ipc, "aiRunAction")
      .mockRejectedValueOnce({
        kind: "internal",
        message: "AI request timed out after 10s waiting for provider response",
      })
      .mockRejectedValueOnce({
        kind: "internal",
        message: "AI provider returned HTTP 401: bad key sk-secret",
      })
      .mockRejectedValueOnce({
        kind: "format",
        message: "AI returned an invalid rewrite reply",
      })
      .mockRejectedValueOnce({
        kind: "internal",
        message: "AI provider returned HTTP 503: overloaded",
      });

    const onClose = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "Explain";
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(
      <AIActionDialog
        open
        title="Explain card with AI"
        action={{
          kind: "explain-card",
          front_html: "Q",
          back_html: "A",
          deck_name: null,
        }}
        onClose={onClose}
      />,
    );

    const user = userEvent.setup();
    await screen.findByText("https://api.openai.com");
    await user.click(screen.getByRole("button", { name: /Send to AI/i }));

    let alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("AI request timed out after 10s");
    expect(alert.textContent).toMatch(/Could not reach the AI provider/i);

    await user.click(screen.getByRole("button", { name: /Retry/i }));
    alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("sk-secret");
    expect(alert.textContent).toMatch(/API key/i);

    await user.click(screen.getByRole("button", { name: /Retry/i }));
    alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/unexpected reply format/i);

    await user.click(screen.getByRole("button", { name: /Retry/i }));
    alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/HTTP 503/);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();

    rerender(
      <AIActionDialog open={false} title="Explain card with AI" action={null} onClose={onClose} />,
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("remembers 'Don't ask again this session' per action kind and skips preview on subsequent opens", async () => {
    const previewSpy = vi.spyOn(ipc, "aiPreviewAction").mockResolvedValue({
      provider: "open-ai-compatible",
      endpoint_origin: "https://api.openai.com",
      model: "gpt-4o-mini",
      system: "Tutor",
      prompt: "Front:\nQ\n\nBack:\nA",
    });
    const runSpy = vi.spyOn(ipc, "aiRunAction").mockResolvedValue({
      prompt_id: "explain_card@1",
      text: "First answer",
      suggested_fields: null,
      generated_cards: null,
      quality_findings: null,
      input_tokens: 12,
      output_tokens: 6,
    });

    const onClose = vi.fn();
    const { rerender } = render(
      <AIActionDialog
        open
        title="Explain card with AI"
        action={{ kind: "explain-card", front_html: "Q", back_html: "A", deck_name: null }}
        onClose={onClose}
      />,
    );

    const user = userEvent.setup();
    const checkbox = await screen.findByLabelText(/Don't ask again for this action this session/i);
    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: /Send to AI/i }));
    expect(await screen.findByText("First answer")).toBeInTheDocument();
    expect(previewSpy).toHaveBeenCalledTimes(1);

    // Close and re-open same action kind -> skips preview, sends immediately
    runSpy.mockResolvedValueOnce({
      prompt_id: "explain_card@1",
      text: "Second direct answer",
      suggested_fields: null,
      generated_cards: null,
      quality_findings: null,
      input_tokens: 8,
      output_tokens: 4,
    });
    rerender(
      <AIActionDialog open={false} title="Explain card with AI" action={null} onClose={onClose} />,
    );
    rerender(
      <AIActionDialog
        open
        title="Explain card with AI"
        action={{ kind: "explain-card", front_html: "Q2", back_html: "A2", deck_name: null }}
        onClose={onClose}
      />,
    );

    expect(await screen.findByText("Second direct answer")).toBeInTheDocument();
    expect(previewSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledTimes(2);

    // Different action kind still asks for preview
    rerender(
      <AIActionDialog open={false} title="Suggest Back field" action={null} onClose={onClose} />,
    );
    rerender(
      <AIActionDialog
        open
        title="Suggest Back field"
        action={{
          kind: "suggest-back",
          front_html: "Q3",
          notetype_name: "Basic",
          back_field_name: "Back",
        }}
        onClose={onClose}
      />,
    );
    await waitFor(() => {
      expect(previewSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("shows Set up AI explainer when not configured without calling preview or run", async () => {
    const previewSpy = vi.spyOn(ipc, "aiPreviewAction");
    const runSpy = vi.spyOn(ipc, "aiRunAction");
    const onSetupAI = vi.fn();
    const onClose = vi.fn();

    render(
      <AIActionDialog
        open
        configured={false}
        title="Explain card with AI"
        action={{ kind: "explain-card", front_html: "Q", back_html: "A", deck_name: null }}
        onSetupAI={onSetupAI}
        onClose={onClose}
      />,
    );

    expect(screen.getByText(/AI assistant is not set up yet/i)).toBeInTheDocument();
    expect(previewSpy).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Set up AI/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSetupAI).toHaveBeenCalledTimes(1);
  });
});
