import { beforeEach, describe, expect, it } from "vitest";
import { toast, useToastStore } from "@/stores/toast";
import {
  initNotificationsFromStorage,
  pushNotification,
  setNotificationCollectionScope,
  useNotificationStore,
} from "./notificationStore";

describe("notificationStore (16h)", () => {
  beforeEach(() => {
    localStorage.clear();
    useToastStore.getState().clear();
    initNotificationsFromStorage();
  });

  it("notification_store_caps_100_and_marks_read", () => {
    for (let i = 1; i <= 105; i++) {
      pushNotification({
        kind: "unlock",
        title: `Unlock ${i}`,
        body: `Body ${i}`,
        time: 1000 + i,
        link: "/character?tab=achievements",
        showPopup: false,
      });
    }

    const state = useNotificationStore.getState();
    expect(state.items).toHaveLength(100);
    // Newest first, oldest 5 (1..5) dropped.
    expect(state.items[0]?.title).toBe("Unlock 105");
    expect(state.items[99]?.title).toBe("Unlock 6");
    expect(state.items.every((item) => item.read === false)).toBe(true);
    expect(state.items[0]?.link).toBe("/character?tab=achievements");

    // Reload from localStorage preserves capped 100 items.
    initNotificationsFromStorage();
    expect(useNotificationStore.getState().items).toHaveLength(100);
    expect(useNotificationStore.getState().items[0]?.title).toBe("Unlock 105");

    // Mark single item read.
    const firstId = useNotificationStore.getState().items[0]!.id;
    useNotificationStore.getState().markRead(firstId);
    expect(useNotificationStore.getState().items[0]?.read).toBe(true);
    expect(useNotificationStore.getState().items[1]?.read).toBe(false);

    // Mark all read.
    useNotificationStore.getState().markAllRead();
    expect(useNotificationStore.getState().items.every((item) => item.read)).toBe(true);

    // Persists read flags across reloads.
    initNotificationsFromStorage();
    expect(useNotificationStore.getState().items.every((item) => item.read)).toBe(true);

    // Clear removes all items and persists.
    useNotificationStore.getState().clear();
    expect(useNotificationStore.getState().items).toHaveLength(0);
    initNotificationsFromStorage();
    expect(useNotificationStore.getState().items).toHaveLength(0);
  });

  it("deduplicates by dedupeKey and records progress toasts while excluding error/confirm toasts", () => {
    pushNotification({
      kind: "backfill",
      title: "Backfill",
      body: "Granted 3 unlocks",
      dedupeKey: "backfill:summary",
      showPopup: false,
    });
    pushNotification({
      kind: "backfill",
      title: "Backfill",
      body: "Granted 3 unlocks",
      dedupeKey: "backfill:summary",
      showPopup: false,
    });
    expect(useNotificationStore.getState().items).toHaveLength(1);

    // Error and generic confirm toasts stay in Toaster only, not notification history.
    toast.error("Sync failed");
    toast.success("Saved");
    toast.info("Copied to clipboard");
    expect(useNotificationStore.getState().items).toHaveLength(1);
    expect(useToastStore.getState().items).toHaveLength(3);

    // Progress toasts route into the notification store (and pop-up queue), not Toaster.
    toast.success("Purchased Streak Freeze · -25 gold", { progress: true });
    expect(useNotificationStore.getState().items).toHaveLength(2);
    expect(useNotificationStore.getState().items[0]?.kind).toBe("purchase");
    expect(useToastStore.getState().items).toHaveLength(3);
  });

  it("A3-12: durable unlock dedupe keys are never evicted by >250 transient notifications and scope isolates collections", () => {
    pushNotification({
      kind: "unlock",
      title: "Pet",
      body: "Unlocked Barn Owl",
      dedupeKey: "unlock:pet:owl",
      showPopup: false,
    });
    for (let i = 0; i < 300; i++) {
      pushNotification({
        kind: "goal",
        title: `Goal ${i}`,
        body: `Met day ${i}`,
        dedupeKey: `goal:${i}`,
        showPopup: false,
      });
    }
    const replay = pushNotification({
      kind: "unlock",
      title: "Pet",
      body: "Unlocked Barn Owl",
      dedupeKey: "unlock:pet:owl",
      showPopup: false,
    });
    expect(replay).toBeNull();

    setNotificationCollectionScope("C:/profiles/second/collection.media");
    expect(useNotificationStore.getState().items).toHaveLength(0);
    const secondColUnlock = pushNotification({
      kind: "unlock",
      title: "Pet",
      body: "Unlocked Barn Owl",
      dedupeKey: "unlock:pet:owl",
      showPopup: false,
    });
    expect(secondColUnlock).not.toBeNull();
  });
});
