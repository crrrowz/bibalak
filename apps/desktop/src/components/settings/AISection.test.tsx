import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { AISection } from "./AISection";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

describe("AISection (AI0)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("summarizes current AI status, links to the Assistant hub, and renders the guided AISetupForm in Settings (OT-13 / U8)", async () => {
    vi.spyOn(ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "ollama",
      base_url: "http://localhost:11434",
      model: "llama3.1",
      has_api_key: false,
    });
    const onOpenHub = vi.fn();

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AISection onOpenHub={onOpenHub} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("llama3.1")).toBeInTheDocument();
    expect(screen.getByText(/API key stored: No/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/^Model$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Use local Ollama preset/i })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Open AI assistant/i }));
    expect(onOpenHub).toHaveBeenCalledTimes(1);
  });
});
