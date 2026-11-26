import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { AssistantScreen } from "./AssistantScreen";

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

describe("AssistantScreen (AI0 / OT-13 / U8)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockReset();
    sessionStorage.clear();
  });

  function renderHub() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <AssistantScreen />
      </QueryClientProvider>,
    );
  }

  it("OT-13: removes privacy section and setup form from hub, shows compact status with Change in Settings link, and disables tool cards when AI is off", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: false,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: false,
    });

    const { container } = renderHub();

    expect(await screen.findByRole("heading", { name: "AI assistant" })).toBeInTheDocument();

    // Privacy section and setup form are gone from the hub
    expect(screen.queryByText(/What leaves your device/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Model$/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Use local Ollama preset/i }),
    ).not.toBeInTheDocument();

    // Compact status shows provider, model, key status, and Change in Settings link
    expect(await screen.findByText("gpt-4o-mini")).toBeInTheDocument();
    expect(container.textContent).toContain("gpt-4o-mini");
    expect(screen.getByText(/API key stored/i)).toBeInTheDocument();
    const changeBtn = screen.getByRole("button", { name: /Change in Settings/i });
    expect(changeBtn).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(changeBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/settings");
    expect(sessionStorage.getItem("keepsake-settings-category")).toBe("ai");

    // When AI is off: tool cards stay visible but their Open buttons are disabled, with Set up AI in Settings link
    expect(screen.getByText("Deck quality")).toBeInTheDocument();
    expect(screen.getByText(/Generate cards/i)).toBeInTheDocument();
    expect(screen.getByText("Study coach")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /Review deck quality/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Open generator/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Open coach|Ask the coach/i })).toBeDisabled();

    const setupLink = screen.getByRole("button", { name: /Set up AI in Settings/i });
    expect(setupLink).toBeInTheDocument();
  });

  it("OT-13: enables the three tool cards when AI is on and opens their routes", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "ollama",
      base_url: "http://localhost:11434",
      model: "llama3.1",
      has_api_key: false,
    });

    renderHub();

    const qualityBtn = await screen.findByRole("button", { name: /Review deck quality/i });
    const generateBtn = screen.getByRole("button", { name: /Open generator/i });
    const coachBtn = screen.getByRole("button", { name: /Open coach|Ask the coach/i });

    await waitFor(() => {
      expect(qualityBtn).not.toBeDisabled();
    });
    expect(generateBtn).not.toBeDisabled();
    expect(coachBtn).not.toBeDisabled();

    const user = userEvent.setup();
    await user.click(qualityBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/assistant/quality");

    await user.click(generateBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/assistant/generate");

    await user.click(coachBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/stats");
  });

  it("OT-13: lists 'Also available while you study' in-screen helpers", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "ollama",
      base_url: "http://localhost:11434",
      model: "llama3.1",
      has_api_key: false,
    });

    renderHub();

    expect(await screen.findByText(/Also available while you study/i)).toBeInTheDocument();
    expect(screen.getByText("Study tutor")).toBeInTheDocument();
    expect(screen.getByText("Why was I wrong?")).toBeInTheDocument();
    expect(screen.getByText(/Explain this card/i)).toBeInTheDocument();
    expect(screen.getByText("Rewrite leech")).toBeInTheDocument();
    expect(screen.getByText("Suggest back")).toBeInTheDocument();
  });
});
