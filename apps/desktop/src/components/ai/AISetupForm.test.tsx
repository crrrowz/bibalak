import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { AISetupForm } from "./AISetupForm";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

describe("AISetupForm (E11 / AI0)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function renderForm() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <AISetupForm />
      </QueryClientProvider>,
    );
  }

  it("shows test request preview with Ollama defaults and runs test-connection only on click", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: false,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: false,
    });
    const setSpy = vi.spyOn(ipc, "aiSetConfig").mockResolvedValue({
      enabled: true,
      provider: "ollama",
      base_url: "http://localhost:11434",
      model: "llama3.1",
      has_api_key: false,
    });
    const runSpy = vi.spyOn(ipc, "aiRunAction").mockResolvedValue({
      prompt_id: "test_connection@1",
      text: "OK",
      suggested_fields: null,
      generated_cards: null,
      quality_findings: null,
      input_tokens: 6,
      output_tokens: 1,
    });

    renderForm();
    await waitFor(() => {
      expect(screen.getByText(/Connection check from Bibalak\./)).toBeInTheDocument();
    });
    expect(runSpy).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Enable AI assistant/i));
    await user.selectOptions(screen.getByLabelText(/^Provider$/i), "ollama");

    expect(screen.getByText(/http:\/\/localhost:11434 · llama3\.1/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Test connection/i }));

    await waitFor(() => {
      expect(setSpy).toHaveBeenCalledWith({
        enabled: true,
        provider: "ollama",
        base_url: "http://localhost:11434",
        model: "llama3.1",
        api_key: null,
      });
      expect(runSpy).toHaveBeenCalledWith({ kind: "test-connection" });
    });
    expect(await screen.findByText("Connected (OK).")).toBeInTheDocument();
  });

  it("stores API key via aiSetConfig without echoing it and maps connection errors cleanly", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: true,
    });
    const setSpy = vi.spyOn(ipc, "aiSetConfig").mockResolvedValue({
      enabled: true,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: true,
    });
    vi.spyOn(ipc, "aiRunAction").mockRejectedValueOnce({
      kind: "internal",
      message: "AI request failed: connection refused",
    });

    renderForm();
    expect(await screen.findByText(/API key saved in OS credential store\./i)).toBeInTheDocument();

    const user = userEvent.setup();
    const keyInput = screen.getByLabelText(/API key/i) as HTMLInputElement;
    await user.type(keyInput, "sk-new-secret");
    await user.click(screen.getByRole("button", { name: /Save AI settings/i }));

    await waitFor(() => {
      expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ api_key: "sk-new-secret" }));
    });
    expect(keyInput.value).toBe("");

    await user.click(screen.getByRole("button", { name: /Test connection/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Could not reach the AI provider/i);

    setSpy.mockResolvedValueOnce({
      enabled: true,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: false,
    });
    await user.click(screen.getByRole("button", { name: /Remove saved key/i }));
    await waitFor(() => {
      expect(setSpy).toHaveBeenLastCalledWith(expect.objectContaining({ api_key: "" }));
    });
  });

  it("BW2-15: renders AI setup as four numbered steps (provider, key, test connection, consent)", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: false,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: false,
    });

    renderForm();

    expect(await screen.findByTestId("ai-step-provider")).toBeInTheDocument();
    expect(screen.getByTestId("ai-step-key")).toBeInTheDocument();
    expect(screen.getByTestId("ai-step-test")).toBeInTheDocument();
    expect(screen.getByTestId("ai-step-consent")).toBeInTheDocument();
  });
});
