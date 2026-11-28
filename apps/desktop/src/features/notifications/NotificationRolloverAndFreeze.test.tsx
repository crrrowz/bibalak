import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { MotionGlobalConfig } from "framer-motion";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameStateDto } from "@bibalak/ipc-types";
import { NotificationEventWatcher } from "@/features/notifications/NotificationEventWatcher";
import { NotificationToastHost } from "@/features/notifications/NotificationToastHost";
import {
  initNotificationsFromStorage,
  pushNotification,
  useNotificationStore,
} from "@/features/notifications/notificationStore";
import * as ipc from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { useCoreEvents } from "@/lib/useCoreEvents";
import { useStyle } from "@/stores/style";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: () => () => {},
  },
}));

function CoreEventsHarness() {
  useCoreEvents();
  return null;
}

describe("A3-13: Rollover refresh, freeze dedupeKey, and toast timer preservation", () => {
  beforeEach(() => {
    MotionGlobalConfig.skipAnimations = true;
    vi.restoreAllMocks();
    vi.useFakeTimers();
    localStorage.clear();
    initNotificationsFromStorage();
    useStyle.getState().setStyle("game");
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    MotionGlobalConfig.skipAnimations = false;
    vi.useRealTimers();
  });

  it("schedules a day-boundary refresh when crossing 24 hours without user events", async () => {
    vi.spyOn(ipc.ipc, "setLocalOffset").mockResolvedValue(undefined);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invSpy = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <QueryClientProvider client={queryClient}>
        <CoreEventsHarness />
      </QueryClientProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    const mountInvCount = invSpy.mock.calls.length;
    expect(mountInvCount).toBeGreaterThan(0);

    await act(async () => {
      vi.advanceTimersByTime(24 * 3_600_000 + 5_000);
      await Promise.resolve();
    });

    expect(invSpy.mock.calls.length).toBeGreaterThan(mountInvCount);
  });

  it("assigns a dedupeKey and contextual link to manual streak freeze notifications", () => {
    window.history.replaceState(null, "", "/streak");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <NotificationEventWatcher />
      </QueryClientProvider>,
    );

    const baseGame = (tokens: number): GameStateDto => ({
      level: 1,
      xp_into_level: 0,
      xp_to_next_level: 100,
      total_xp: 0,
      earned_gold_cents: 0,
      spent_gold_cents: 0,
      available_gold_cents: 0,
      study_streak: 0,
      studied_today: false,
      freeze_tokens_held: tokens,
      freeze_token_cap: 3,
      avatar: {
        body_tone: "tone_1",
        hair_style: "hair_short",
        hair_color: "dark",
        starter_outfit: "tunic_slate",
        starter_accessory: "none",
      },
      equipped: [],
      owned_item_keys: [],
      catalog: [],
    });

    act(() => {
      queryClient.setQueryData(queryKeys.gameState, baseGame(2));
      queryClient.setQueryData(queryKeys.gameState, baseGame(1));
    });

    const freezeNotif = useNotificationStore.getState().items.find((n) => n.kind === "freeze");
    expect(freezeNotif).toBeDefined();
    expect(freezeNotif?.dedupeKey).toBeTruthy();
    expect(freezeNotif?.link).toBe("/streak");
  });

  it("preserves remaining toast dismiss duration across blocking modals", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <NotificationToastHost />
      </QueryClientProvider>,
    );

    act(() => {
      // unlock -> 3000ms
      pushNotification({ kind: "unlock", title: "Short Toast", body: "Body" });
    });
    expect(screen.getByText("Short Toast")).toBeInTheDocument();

    // Advance 2000ms -> 1000ms remaining
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(screen.getByText("Short Toast")).toBeInTheDocument();

    // Open a blocking modal for 5000ms
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    await act(async () => {
      document.body.appendChild(dialog);
      await Promise.resolve();
    });
    expect(screen.queryByText("Short Toast")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    // Close modal -> toast reappears with ~1000ms remaining (NOT reset to 3000ms)
    await act(async () => {
      dialog.remove();
      await Promise.resolve();
    });
    expect(screen.getByText("Short Toast")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1100);
      await Promise.resolve();
    });
    expect(screen.queryByText("Short Toast")).not.toBeInTheDocument();
  });
});
