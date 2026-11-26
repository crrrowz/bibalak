import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockGameDepthLv10, mockGameDepthStarter } from "@/dev/mocks/gameDepth";
import { setLocale } from "@/lib/i18n";
import * as ipcModule from "@/lib/ipc";
import * as styleAudio from "@/lib/styleAudio";
import { StablePanel } from "./StablePanel";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

function renderStable() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StablePanel />
    </QueryClientProvider>,
  );
}

describe("stable_panel_bond_and_mount (14e)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLocale("en");
  });

  afterEach(() => {
    setLocale("en");
  });

  it("renders bond progress, blocks mount below 50, and toggles companion/mount at 50 in EN and AR", async () => {
    vi.spyOn(ipcModule.ipc, "getGameDepthState").mockResolvedValue(
      structuredClone(mockGameDepthStarter),
    );
    const setActiveSpy = vi
      .spyOn(ipcModule.ipc, "setActivePet")
      .mockResolvedValue(structuredClone(mockGameDepthStarter));

    const { unmount } = renderStable();

    expect(await screen.findByText("Barn Owl")).toBeInTheDocument();
    expect(screen.getByText("Bond 18 / 50")).toBeInTheDocument();
    const bars = screen.getAllByRole("progressbar");
    expect(bars[0]).toHaveAttribute("aria-valuenow", "18");
    expect(bars[0]).toHaveAttribute("aria-valuemax", "50");
    // Mount toggle must not be available when growth < 50
    expect(screen.queryByRole("button", { name: "Ride as Mount" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Mount unlocks at 50 bond")).toHaveLength(2);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Set as Companion" }));
    expect(setActiveSpy).toHaveBeenCalledWith("pet-fox-classic", false);

    unmount();

    // Arabic RTL fraction uses "من" and mount toggle works at 50
    setLocale("ar");
    vi.spyOn(ipcModule.ipc, "getGameDepthState").mockResolvedValue(
      structuredClone(mockGameDepthLv10),
    );
    const cueSpy = vi.spyOn(styleAudio, "playStyleCue");
    const mountSpy = vi
      .spyOn(ipcModule.ipc, "setActivePet")
      .mockResolvedValue(structuredClone(mockGameDepthLv10));

    renderStable();

    expect(await screen.findByText("البومة البيضاء")).toBeInTheDocument();
    expect(screen.getByText("الصلة 50 من 50")).toBeInTheDocument();
    expect(screen.getByText("جاهز للركوب")).toBeInTheDocument();
    // Clicking "تعيين كرفيق" on the mounted owl switches to companion mode
    await user.click(screen.getAllByRole("button", { name: "تعيين كرفيق" })[0]);
    expect(mountSpy).toHaveBeenCalledWith("pet-owl-classic", false);
    expect(cueSpy).toHaveBeenCalledWith("unlock");
  });

  it("renders empty and error states with retry", async () => {
    vi.spyOn(ipcModule.ipc, "getGameDepthState").mockResolvedValueOnce({
      ...structuredClone(mockGameDepthStarter),
      active_pet_id: null,
      pets: [],
    });

    const { unmount } = renderStable();
    expect(
      await screen.findByText("Study cards or finish tasks to unlock your first companion."),
    ).toBeInTheDocument();
    unmount();

    vi.spyOn(ipcModule.ipc, "getGameDepthState")
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(structuredClone(mockGameDepthStarter));

    renderStable();
    expect(await screen.findByText("Could not load companion and path data.")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Barn Owl")).toBeInTheDocument();
  });
});
