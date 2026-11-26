import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockGameState } from "@/dev/mocks/game";
import { mockGameDepthLv10, mockGameDepthStarter } from "@/dev/mocks/gameDepth";
import { setLocale } from "@/lib/i18n";
import * as ipcModule from "@/lib/ipc";
import { PathSelector } from "./PathSelector";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

function renderPaths() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PathSelector />
    </QueryClientProvider>,
  );
}

describe("path_selector_locks_below_10_and_switch_cost (14e)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLocale("en");
  });

  afterEach(() => {
    setLocale("en");
  });

  it("locks all path choices below Level 10 with progress hint", async () => {
    vi.spyOn(ipcModule.ipc, "getGameDepthState").mockResolvedValue(
      structuredClone(mockGameDepthStarter),
    );
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue(structuredClone(mockGameState));

    renderPaths();

    expect(await screen.findByText("Unlocks at Level 10 (4 / 10)")).toBeInTheDocument();
    expect(screen.getByText("Vanguard")).toBeInTheDocument();
    expect(screen.getByText("Sage")).toBeInTheDocument();
    expect(screen.getByText("Pathfinder")).toBeInTheDocument();
    expect(screen.getByText("Artisan")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cosmetic crest, avatar frame, and title only — no combat stats or abilities.",
      ),
    ).toBeInTheDocument();
    for (const btn of screen.getAllByRole("button", { name: "Choose Path (Free)" })) {
      expect(btn).toBeDisabled();
    }
  });

  it("allows free first pick at Level 10+ and shows 100 Gold switch cost / insufficient gold guard", async () => {
    const lv10Unpicked = {
      ...structuredClone(mockGameDepthLv10),
      chosen_path: null,
      path_chosen_at: null,
    };
    const lv10Picked = structuredClone(mockGameDepthLv10);

    vi.spyOn(ipcModule.ipc, "getGameDepthState").mockResolvedValue(lv10Unpicked);
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue({
      ...structuredClone(mockGameState),
      level: 12,
      available_gold_cents: 12_000,
    });
    const chooseSpy = vi.spyOn(ipcModule.ipc, "chooseGamePath").mockResolvedValue(lv10Picked);

    const { unmount } = renderPaths();
    const user = userEvent.setup();
    const freeButtons = await screen.findAllByRole("button", { name: "Choose Path (Free)" });
    freeButtons[1].focus();
    expect(freeButtons[1]).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(chooseSpy).toHaveBeenCalledWith("sage");
    unmount();

    // When a path is already chosen and gold < 100 (10,000 cents), switch is blocked calmly
    vi.spyOn(ipcModule.ipc, "getGameDepthState").mockResolvedValue(lv10Picked);
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue({
      ...structuredClone(mockGameState),
      level: 12,
      available_gold_cents: 4_750,
    });

    renderPaths();
    expect(await screen.findByText("Level 12 Sage")).toBeInTheDocument();
    expect(screen.getByText("Need 100 Gold to switch path.")).toBeInTheDocument();
    const switchButtons = screen.getAllByRole("button", { name: "Switch Path (100 Gold)" });
    for (const btn of switchButtons) {
      expect(btn).toBeDisabled();
    }
  });
});
