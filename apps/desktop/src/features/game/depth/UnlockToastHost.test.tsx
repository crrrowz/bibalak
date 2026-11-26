import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockGameDepthLv10, mockGameDepthStarter } from "@/dev/mocks/gameDepth";
import { NotificationToastHost } from "@/features/notifications/NotificationToastHost";
import { initNotificationsFromStorage } from "@/features/notifications/notificationStore";
import { setLocale } from "@/lib/i18n";
import * as ipcModule from "@/lib/ipc";
import * as styleAudio from "@/lib/styleAudio";
import { useStyle } from "@/stores/style";
import { BackfillBanner } from "./BackfillBanner";
import { UnlockToastHost } from "./UnlockToastHost";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

function renderUnlocks() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BackfillBanner />
      <UnlockToastHost />
      <NotificationToastHost />
    </QueryClientProvider>,
  );
}

describe("unlock_toast_acknowledges_and_banner_once (14e / 16h)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    initNotificationsFromStorage();
    setLocale("en");
    useStyle.getState().setStyle("game");
  });

  afterEach(() => {
    localStorage.clear();
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it("shows top-end unlock toast, plays style cue, acknowledges on Esc, and displays backfill banner once", async () => {
    const stateWithBoth = {
      ...structuredClone(mockGameDepthLv10),
      unseen_unlocks: [
        {
          id: "unlock-pet-1",
          kind: "pet",
          key: "unlock:reviews:1",
          reward_ref: "owl:classic",
          unlocked_at: Date.now(),
        },
        {
          id: "unlock-ach-1",
          kind: "achievement",
          key: "ach:level_10",
          reward_ref: "badge_crest",
          unlocked_at: Date.now(),
        },
      ],
      backfill_applied: true,
    };

    vi.spyOn(ipcModule.ipc, "getGameDepthState").mockResolvedValue(stateWithBoth);
    const ackSpy = vi.spyOn(ipcModule.ipc, "acknowledgeUnlocks").mockResolvedValue();
    const cueSpy = vi.spyOn(styleAudio, "playStyleCue");

    const { unmount } = renderUnlocks();

    const host = await screen.findByTestId("notification-toast-host");
    expect(parseFloat(host.style.top)).toBeGreaterThanOrEqual(48);
    expect(host.className).toContain("end-4");
    expect(screen.getByText("Unlocked companion: Barn Owl")).toBeInTheDocument();
    expect(screen.getByText("Achievement Unlocked!")).toBeInTheDocument();
    expect(cueSpy).toHaveBeenCalledWith("unlock");
    expect(cueSpy).toHaveBeenCalledWith("achievement");

    // Summary banner for past-work unlocks shows once
    expect(screen.getAllByText("Granted 15 unlocks from past study").length).toBeGreaterThanOrEqual(
      1,
    );

    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(ackSpy).toHaveBeenCalledWith(["unlock-pet-1", "unlock-ach-1"]);
    });

    await user.click(screen.getByRole("button", { name: "Dismiss notice" }));
    expect(screen.queryByText(/past study/i)).not.toBeInTheDocument();
    unmount();

    // Banner stays dismissed on remount (one-time)
    vi.spyOn(ipcModule.ipc, "getGameDepthState").mockResolvedValue(
      structuredClone(mockGameDepthStarter),
    );
    renderUnlocks();
    await vi.waitFor(() => expect(ipcModule.ipc.getGameDepthState).toHaveBeenCalled());
    expect(screen.queryByText(/past study/i)).not.toBeInTheDocument();
  });
});
