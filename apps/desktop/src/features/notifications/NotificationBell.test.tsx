import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale, tn } from "@/lib/i18n";
import { useStyle } from "@/stores/style";
import { NotificationBell } from "./NotificationBell";
import { initNotificationsFromStorage, pushNotification } from "./notificationStore";

describe("NotificationBell & NotificationPanel (16h)", () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale("en");
    useStyle.getState().setStyle("default");
    initNotificationsFromStorage();
  });

  afterEach(() => {
    localStorage.clear();
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it("bell_shows_unread_count_and_panel_lists_newest_first", async () => {
    const user = userEvent.setup();
    render(<NotificationBell />);

    const bell = screen.getByRole("button", { name: "Notifications" });
    expect(bell).toBeInTheDocument();
    expect(screen.queryByTestId("notification-unread-badge")).not.toBeInTheDocument();

    // Empty state per style
    await user.click(bell);
    const panel = await screen.findByTestId("notification-panel");
    expect(panel).toHaveTextContent("No notifications yet. Progress updates will appear here.");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("notification-panel")).not.toBeInTheDocument());
    expect(bell).toHaveFocus();

    // Scholar & Game empty states
    useStyle.getState().setStyle("scholar");
    await user.click(bell);
    expect(await screen.findByTestId("notification-panel")).toHaveTextContent(
      "No academic notices yet. Milestones and records will appear here.",
    );
    await user.keyboard("{Escape}");

    useStyle.getState().setStyle("game");
    await user.click(bell);
    expect(await screen.findByTestId("notification-panel")).toHaveTextContent(
      "No quest log updates yet. Loot, levels, and unlocks appear here.",
    );
    await user.keyboard("{Escape}");

    // Push 3 items oldest -> newest
    act(() => {
      pushNotification({
        kind: "purchase",
        title: "First item",
        body: "Bought item",
        time: 1000,
        showPopup: false,
      });
      pushNotification({
        kind: "level_up",
        title: "Second item",
        body: "Level 2",
        time: 2000,
        showPopup: false,
      });
      pushNotification({
        kind: "achievement",
        title: "Third item",
        body: "Achievement unlocked",
        time: 3000,
        link: "/character?tab=achievements",
        showPopup: false,
      });
    });

    const badge = await screen.findByTestId("notification-unread-badge");
    expect(badge).toHaveTextContent("3");
    expect(bell).toHaveAttribute("aria-label", "Notifications, 3 unread");

    await user.click(bell);
    const openPanel = await screen.findByTestId("notification-panel");
    const titles = Array.from(
      openPanel.querySelectorAll("[data-testid='notification-item-title']"),
    ).map((el) => el.textContent);
    expect(titles).toEqual(["Third item", "Second item", "First item"]);

    // Mark all read
    await user.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(screen.queryByTestId("notification-unread-badge")).not.toBeInTheDocument();

    // Clear
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(openPanel).toHaveTextContent(
      "No quest log updates yet. Loot, levels, and unlocks appear here.",
    );
  });

  it("uses all 6 Arabic plural forms on the bell unread label", () => {
    setLocale("ar");
    const allSix = [0, 1, 2, 3, 11, 100].map((n) => tn("notifications.bell.ariaUnread", n));
    expect(new Set(allSix).size).toBe(6);

    render(<NotificationBell />);

    const counts = [1, 2, 3, 11, 100];
    const labels = new Set<string>();
    for (const count of counts) {
      act(() => {
        localStorage.clear();
        initNotificationsFromStorage();
        for (let i = 0; i < count; i++) {
          pushNotification({
            kind: "progress",
            title: `Item ${i}`,
            body: "Body",
            showPopup: false,
          });
        }
      });
      const btn = screen.getByRole("button");
      labels.add(btn.getAttribute("aria-label") ?? "");
    }
    expect(labels.size).toBe(5);
  });
});
