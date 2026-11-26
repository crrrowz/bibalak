import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MotionGlobalConfig } from "framer-motion";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { useStyle } from "@/stores/style";
import { NotificationToastHost } from "./NotificationToastHost";
import { initNotificationsFromStorage, pushNotification } from "./notificationStore";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => false,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

function renderToastHost() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NotificationToastHost />
    </QueryClientProvider>,
  );
}

describe("NotificationToastHost (16h)", () => {
  beforeEach(() => {
    MotionGlobalConfig.skipAnimations = true;
    vi.useFakeTimers();
    localStorage.clear();
    setLocale("en");
    useStyle.getState().setStyle("default");
    initNotificationsFromStorage();
  });

  afterEach(() => {
    MotionGlobalConfig.skipAnimations = false;
    vi.useRealTimers();
    localStorage.clear();
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it("popups_hide_after_timeout_and_pause_on_hover", async () => {
    renderToastHost();

    // Small item: 3s, level-up: 4s, achievement: 5s
    act(() => {
      pushNotification({ kind: "unlock", title: "Small Unlock", body: "3s item" });
      pushNotification({ kind: "level_up", title: "Level 2", body: "4s item" });
      pushNotification({ kind: "achievement", title: "Mastery", body: "5s item" });
    });

    const cards = screen.getAllByTestId("notification-popup-card");
    expect(cards).toHaveLength(3);

    // Hover the first (3s) card -> pauses its timer
    fireEvent.mouseEnter(cards[0]!);
    await act(async () => {
      vi.advanceTimersByTime(3500);
      await Promise.resolve();
    });
    // First card stayed visible because hovered!
    expect(screen.getByText("Small Unlock")).toBeInTheDocument();
    // Level 2 (4s) still visible at 3.5s
    expect(screen.getByText("Level 2")).toBeInTheDocument();

    // Leave hover -> resumes remaining ~3000ms; advance 1000ms so Level 2 (at 4.0s) hides, Small Unlock stays
    fireEvent.mouseLeave(cards[0]!);
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(screen.queryByText("Level 2")).not.toBeInTheDocument();
    expect(screen.getByText("Small Unlock")).toBeInTheDocument();
    expect(screen.getByText("Mastery")).toBeInTheDocument();

    // Advance 600ms -> Mastery (at 5.0s) hides, Small Unlock still has ~1.4s
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });
    expect(screen.queryByText("Mastery")).not.toBeInTheDocument();
    expect(screen.getByText("Small Unlock")).toBeInTheDocument();

    // Advance 2500ms -> Small Unlock hides
    await act(async () => {
      vi.advanceTimersByTime(2500);
      await Promise.resolve();
    });
    expect(screen.queryByText("Small Unlock")).not.toBeInTheDocument();
  });

  it("popups_wait_while_dialog_open_and_max_three", async () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);

    try {
      renderToastHost();

      act(() => {
        for (let i = 1; i <= 5; i++) {
          pushNotification({ kind: "progress", title: `Event ${i}`, body: `Body ${i}` });
        }
      });

      // Dialog is open: all 5 wait in the queue
      expect(screen.queryAllByTestId("notification-popup-card")).toHaveLength(0);

      // Even advancing time while dialog is open does not expire queued pop-ups
      await act(async () => {
        vi.advanceTimersByTime(5000);
        await Promise.resolve();
      });
      expect(screen.queryAllByTestId("notification-popup-card")).toHaveLength(0);

      // Remove dialog -> max 3 pop-ups appear from the queue
      await act(async () => {
        dialog.remove();
        await Promise.resolve();
      });

      const visible = screen.getAllByTestId("notification-popup-card");
      expect(visible).toHaveLength(3);
      expect(screen.getByText("Event 1")).toBeInTheDocument();
      expect(screen.getByText("Event 3")).toBeInTheDocument();
      expect(screen.queryByText("Event 4")).not.toBeInTheDocument();

      // Dismissing via Esc clears the visible 3 and lets the remaining 2 appear
      await act(async () => {
        fireEvent.keyDown(window, { key: "Escape" });
        await Promise.resolve();
      });
      expect(screen.getAllByTestId("notification-popup-card")).toHaveLength(2);
      expect(screen.getByText("Event 4")).toBeInTheDocument();
      expect(screen.getByText("Event 5")).toBeInTheDocument();
    } finally {
      dialog.remove();
    }
  });

  it("popup_shows_avatar_in_game_and_scholar_icon_in_default", () => {
    const { unmount } = renderToastHost();

    // Default style: event icon, no AvatarStage
    useStyle.getState().setStyle("default");
    act(() => {
      pushNotification({ kind: "progress", title: "Default Update", body: "Added 5 cards" });
    });
    expect(screen.queryByTestId("avatar-stage")).not.toBeInTheDocument();
    expect(screen.getByTestId("notification-popup-icon")).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    // Game style: 32px AvatarStage
    useStyle.getState().setStyle("game");
    act(() => {
      pushNotification({ kind: "level_up", title: "Level Up!", body: "Reached Level 5" });
    });
    const gameAvatar = screen.getByTestId("avatar-stage");
    expect(gameAvatar).toHaveAttribute("data-style-skin", "game");
    expect(gameAvatar.style.width).toBe("32px");

    // Game pet event: renders PetLayer
    act(() => {
      pushNotification({
        kind: "pet",
        title: "New Unlock!",
        body: "Unlocked companion: Barn Owl",
        pet: { speciesKey: "owl", variantKey: "classic" },
      });
    });
    expect(document.querySelector('[data-layer="pet"][data-species="owl"]')).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    // Scholar style: 32px Scholar AvatarStage
    useStyle.getState().setStyle("scholar");
    act(() => {
      pushNotification({ kind: "achievement", title: "Milestone", body: "Researcher Rank" });
    });
    const scholarAvatar = screen.getByTestId("avatar-stage");
    expect(scholarAvatar).toHaveAttribute("data-style-skin", "scholar");
    expect(scholarAvatar.style.width).toBe("32px");

    unmount();
  });

  it("pauses auto-hide on focus and waits while an overlapping study card is visible", async () => {
    const studyCard = document.createElement("div");
    studyCard.className = "keepsake-card";
    studyCard.getBoundingClientRect = () =>
      ({
        left: 200,
        right: 1180,
        top: 60,
        bottom: 500,
        width: 980,
        height: 440,
        x: 200,
        y: 60,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(studyCard);

    try {
      renderToastHost();

      act(() => {
        pushNotification({ kind: "unlock", title: "Focus Test", body: "Pauses when focused" });
      });

      // Overlapping study card keeps pop-up in queue
      expect(screen.queryByText("Focus Test")).not.toBeInTheDocument();

      await act(async () => {
        studyCard.remove();
        await Promise.resolve();
      });

      expect(screen.getByText("Focus Test")).toBeInTheDocument();
      const dismissBtn = screen.getByRole("button", { name: "Dismiss notification" });
      fireEvent.focus(dismissBtn);

      await act(async () => {
        vi.advanceTimersByTime(3500);
        await Promise.resolve();
      });
      // Still visible while focused
      expect(screen.getByText("Focus Test")).toBeInTheDocument();

      fireEvent.blur(dismissBtn);
      await act(async () => {
        vi.advanceTimersByTime(3100);
        await Promise.resolve();
      });
      expect(screen.queryByText("Focus Test")).not.toBeInTheDocument();
    } finally {
      studyCard.remove();
    }
  });

  it("popup_not_clipped_by_study_header", async () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 1200,
        top: 90,
        bottom: 800,
        width: 1200,
        height: 710,
        x: 0,
        y: 90,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(main);

    try {
      renderToastHost();

      act(() => {
        pushNotification({
          kind: "achievement",
          title: "Quest completed!",
          body: "Review 15 cards",
        });
      });

      const host = screen.getByTestId("notification-toast-host");
      // Sits in a document.body portal (not clipped by main/screen overflow)
      expect(host.parentElement).toBe(document.body);
      expect(host.className).toMatch(/\bfixed\b/);

      // Z-index sits strictly above ScreenHeader (z-20)
      const zMatch = host.className.match(/(?:^|\s)z-(?:\[(\d+)\]|(\d+))(?=\s|$)/);
      const zIndex = zMatch ? Number(zMatch[1] ?? zMatch[2]) : 0;
      expect(zIndex).toBeGreaterThan(20);

      // Top offset sits below TitleBar (36px) and below HUD / #main-content top (90px)
      const topPx = parseFloat(host.style.top);
      expect(Number.isFinite(topPx)).toBe(true);
      expect(topPx).toBeGreaterThanOrEqual(48);
      expect(topPx).toBeGreaterThan(90);
    } finally {
      main.remove();
    }
  });

  it("BW2-20: popup_sits_below_screen_header_and_study_progress_strip", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 1200,
        top: 90,
        bottom: 800,
        width: 1200,
        height: 710,
        x: 0,
        y: 90,
        toJSON: () => ({}),
      }) as DOMRect;

    const screenHeader = document.createElement("div");
    screenHeader.className = "glass-panel sticky top-0 z-20";
    screenHeader.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 1200,
        top: 90,
        bottom: 138,
        width: 1200,
        height: 48,
        x: 0,
        y: 90,
        toJSON: () => ({}),
      }) as DOMRect;

    const progressStrip = document.createElement("div");
    progressStrip.setAttribute("data-testid", "study-progress-strip");
    progressStrip.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 1200,
        top: 138,
        bottom: 168,
        width: 1200,
        height: 30,
        x: 0,
        y: 138,
        toJSON: () => ({}),
      }) as DOMRect;

    main.appendChild(screenHeader);
    main.appendChild(progressStrip);
    document.body.appendChild(main);

    try {
      renderToastHost();

      act(() => {
        pushNotification({
          kind: "achievement",
          title: "Achievement Unlocked!",
          body: "Reviewed 15 cards",
        });
      });

      const host = screen.getByTestId("notification-toast-host");
      expect(host.className).toMatch(/\bfixed\b/);
      expect(host.className).toContain("end-4");
      expect(host.className).not.toMatch(/\b(left|right)-/);

      const topPx = parseFloat(host.style.top);
      expect(Number.isFinite(topPx)).toBe(true);
      expect(topPx).toBeGreaterThanOrEqual(180);
    } finally {
      main.remove();
    }
  });

  it("BW2-20: popup_mirrors_in_rtl_and_caps_at_three", () => {
    document.documentElement.dir = "rtl";
    try {
      renderToastHost();
      act(() => {
        for (let i = 1; i <= 4; i++) {
          pushNotification({ kind: "unlock", title: `Unlock ${i}`, body: `Item ${i}` });
        }
      });

      const host = screen.getByTestId("notification-toast-host");
      expect(host.className).toContain("end-4");
      expect(host.className).not.toMatch(/\b(left|right)-/);
      expect(screen.getAllByTestId("notification-popup-card")).toHaveLength(3);
    } finally {
      document.documentElement.dir = "ltr";
    }
  });
});
