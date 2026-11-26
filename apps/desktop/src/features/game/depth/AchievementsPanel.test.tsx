import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockGameDepthStarter } from "@/dev/mocks/gameDepth";
import { setLocale } from "@/lib/i18n";
import * as ipcModule from "@/lib/ipc";
import { AchievementsPanel } from "./AchievementsPanel";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

function renderAchievements(skinId: "game" | "scholar" = "game") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AchievementsPanel skinId={skinId} />
    </QueryClientProvider>,
  );
}

describe("achievements_panel_states (14e)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLocale("en");
  });

  afterEach(() => {
    setLocale("en");
  });

  it("renders earned dates and locked progress bars across all 25 achievements", async () => {
    vi.spyOn(ipcModule.ipc, "getGameDepthState").mockResolvedValue(
      structuredClone(mockGameDepthStarter),
    );

    renderAchievements("game");

    expect(await screen.findByText("4 / 25 Unlocked")).toBeInTheDocument();
    expect(screen.getByText("First Recall")).toBeInTheDocument();
    expect(screen.getByText("Grand Recall")).toBeInTheDocument();
    // Progress for locked items renders inline (no hover-only tooltip)
    expect(screen.getByText("4,000 / 10,000")).toBeInTheDocument();
    expect(screen.getAllByRole("progressbar").length).toBe(21);
  });

  it("uses academic wording in Scholar mode", async () => {
    vi.spyOn(ipcModule.ipc, "getGameDepthState").mockResolvedValue(
      structuredClone(mockGameDepthStarter),
    );

    renderAchievements("scholar");

    expect(await screen.findByText("Academic Milestones")).toBeInTheDocument();
    expect(screen.getByText("4 of 25 reached")).toBeInTheDocument();
    expect(screen.getByText("First Assignment Done")).toBeInTheDocument();
    expect(screen.getByText("First Milestone")).toBeInTheDocument();
    expect(screen.queryByText("Loyal Companion")).not.toBeInTheDocument();
  });

  it("renders empty and error states with retry", async () => {
    vi.spyOn(ipcModule.ipc, "getGameDepthState").mockResolvedValueOnce({
      ...structuredClone(mockGameDepthStarter),
      achievements: [],
    });

    const { unmount } = renderAchievements("scholar");
    expect(
      await screen.findByText("Complete reviews, tasks, or routines to record milestones."),
    ).toBeInTheDocument();
    unmount();

    vi.spyOn(ipcModule.ipc, "getGameDepthState")
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce(structuredClone(mockGameDepthStarter));

    renderAchievements("game");
    expect(await screen.findByText("Could not load companion and path data.")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("First Recall")).toBeInTheDocument();
  });
});
