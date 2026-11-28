import { create } from "zustand";
import { playStyleCue, type StyleCue } from "@/lib/styleAudio";

export type NotificationKind =
  | "unlock"
  | "pet"
  | "achievement"
  | "level_up"
  | "title_up"
  | "purchase"
  | "refund"
  | "freeze"
  | "backfill"
  | "progress"
  | "goal"
  | "quest";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  time: number;
  read: boolean;
  link?: string;
  dedupeKey?: string;
}

export interface PopupNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string;
  durationMs: number;
  pet?: { speciesKey: string; variantKey: string } | null;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
}

export interface PushNotificationInput {
  kind: NotificationKind;
  title: string;
  body: string;
  time?: number;
  link?: string;
  dedupeKey?: string;
  showPopup?: boolean;
  durationMs?: number;
  pet?: { speciesKey: string; variantKey: string } | null;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  /** Optional style cue to play when queued, or `null` to skip audio. */
  soundCue?: StyleCue | null;
}

const STORAGE_KEY_ITEMS = "keepsake-notifications-v1";
const STORAGE_KEY_SEEN = "keepsake-notifications-seen-v1";
const STORAGE_KEY_DURABLE_SEEN = "keepsake-notifications-unlock-seen-v1";
export const MAX_NOTIFICATIONS = 100;
const MAX_SEEN_KEYS = 250;
const RECENT_BODY_DEDUPE_MS = 3000;

let nextSeq = 1;
let collectionScopeSuffix = "";
const recentBodyTimestamps = new Map<string, number>();

function hashScope(raw: string): string {
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function scopedKey(base: string): string {
  return collectionScopeSuffix ? `${base}:${collectionScopeSuffix}` : base;
}

function isDurableDedupeKey(key: string): boolean {
  return (
    key.startsWith("unlock:") ||
    key.startsWith("backfill:") ||
    key.startsWith("level_up:") ||
    key.startsWith("title_up:")
  );
}

function defaultDurationForKind(kind: NotificationKind): number {
  if (kind === "achievement") return 5000;
  if (
    kind === "unlock" ||
    kind === "purchase" ||
    kind === "refund" ||
    kind === "freeze" ||
    kind === "progress"
  ) {
    return 3000;
  }
  return 4000;
}

function defaultCueForKind(kind: NotificationKind): StyleCue | null {
  switch (kind) {
    case "achievement":
      return "achievement";
    case "level_up":
    case "title_up":
      return "level_up";
    case "purchase":
    case "refund":
      return "purchase";
    case "unlock":
    case "pet":
    case "freeze":
    case "goal":
    case "quest":
      return "unlock";
    default:
      return null;
  }
}

function isValidKind(v: unknown): v is NotificationKind {
  return (
    v === "unlock" ||
    v === "pet" ||
    v === "achievement" ||
    v === "level_up" ||
    v === "title_up" ||
    v === "purchase" ||
    v === "refund" ||
    v === "freeze" ||
    v === "backfill" ||
    v === "progress" ||
    v === "goal" ||
    v === "quest"
  );
}

function readStoredItems(): NotificationItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(scopedKey(STORAGE_KEY_ITEMS));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: NotificationItem[] = [];
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        isValidKind(entry.kind) &&
        typeof entry.title === "string" &&
        typeof entry.body === "string" &&
        typeof entry.time === "number" &&
        typeof entry.read === "boolean"
      ) {
        valid.push({
          id: entry.id,
          kind: entry.kind,
          title: entry.title,
          body: entry.body,
          time: entry.time,
          read: entry.read,
          ...(typeof entry.link === "string" ? { link: entry.link } : {}),
          ...(typeof entry.dedupeKey === "string" ? { dedupeKey: entry.dedupeKey } : {}),
        });
      }
      if (valid.length >= MAX_NOTIFICATIONS) break;
    }
    return valid;
  } catch {
    return [];
  }
}

function writeStoredItems(items: NotificationItem[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      scopedKey(STORAGE_KEY_ITEMS),
      JSON.stringify(items.slice(0, MAX_NOTIFICATIONS)),
    );
  } catch {
    // storage unavailable
  }
}

function readSeenKeys(storageKey: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(scopedKey(storageKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function recordSeenKey(key: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (isDurableDedupeKey(key)) {
      const durable = readSeenKeys(STORAGE_KEY_DURABLE_SEEN);
      if (!durable.includes(key)) {
        durable.unshift(key);
        localStorage.setItem(scopedKey(STORAGE_KEY_DURABLE_SEEN), JSON.stringify(durable));
      }
      return;
    }
    const existing = readSeenKeys(STORAGE_KEY_SEEN).filter((k) => k !== key);
    existing.unshift(key);
    localStorage.setItem(
      scopedKey(STORAGE_KEY_SEEN),
      JSON.stringify(existing.slice(0, MAX_SEEN_KEYS)),
    );
  } catch {
    // storage unavailable
  }
}

function hasSeenKey(key: string, items: NotificationItem[]): boolean {
  if (items.some((item) => item.dedupeKey === key)) return true;
  if (isDurableDedupeKey(key) && readSeenKeys(STORAGE_KEY_DURABLE_SEEN).includes(key)) return true;
  return readSeenKeys(STORAGE_KEY_SEEN).includes(key);
}

interface NotificationState {
  items: NotificationItem[];
  popupQueue: PopupNotification[];
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  push: (input: PushNotificationInput) => NotificationItem | null;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
  dismissPopup: (id: string) => void;
  dismissVisiblePopups: (ids: string[]) => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: readStoredItems(),
  popupQueue: [],
  panelOpen: false,

  setPanelOpen: (open) => set({ panelOpen: open }),

  push: (input) => {
    const state = get();
    if (input.dedupeKey && hasSeenKey(input.dedupeKey, state.items)) {
      return null;
    }

    const now = input.time ?? Date.now();
    // Guard against duplicate events from both toast and cache watcher firing back-to-back.
    if (input.kind === "purchase" || input.kind === "refund" || input.kind === "freeze") {
      const sig = `${input.kind}:${input.body}`;
      const prevAt = recentBodyTimestamps.get(sig);
      if (prevAt !== undefined && Math.abs(now - prevAt) < RECENT_BODY_DEDUPE_MS) {
        return null;
      }
      recentBodyTimestamps.set(sig, now);
    }

    const id = `notif-${now}-${nextSeq++}`;
    const item: NotificationItem = {
      id,
      kind: input.kind,
      title: input.title.trim(),
      body: input.body.trim(),
      time: now,
      read: false,
      ...(input.link ? { link: input.link } : {}),
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
    };

    if (input.dedupeKey) {
      recordSeenKey(input.dedupeKey);
    }

    const nextItems = [item, ...state.items].slice(0, MAX_NOTIFICATIONS);
    writeStoredItems(nextItems);

    const shouldPopup = input.showPopup !== false;
    const nextQueue = shouldPopup
      ? [
          ...state.popupQueue,
          {
            id,
            kind: item.kind,
            title: item.title,
            body: item.body,
            ...(item.link ? { link: item.link } : {}),
            durationMs: input.durationMs ?? defaultDurationForKind(item.kind),
            ...(input.pet !== undefined ? { pet: input.pet } : {}),
            ...(input.action ? { action: input.action } : {}),
            ...(input.onDismiss ? { onDismiss: input.onDismiss } : {}),
          },
        ]
      : state.popupQueue;

    set({ items: nextItems, popupQueue: nextQueue });

    if (shouldPopup) {
      const cue = input.soundCue === undefined ? defaultCueForKind(item.kind) : input.soundCue;
      if (cue) {
        playStyleCue(cue);
      }
    }

    return item;
  },

  markRead: (id) => {
    const next = get().items.map((item) => (item.id === id ? { ...item, read: true } : item));
    writeStoredItems(next);
    set({ items: next });
  },

  markAllRead: () => {
    const next = get().items.map((item) => (item.read ? item : { ...item, read: true }));
    writeStoredItems(next);
    set({ items: next });
  },

  clear: () => {
    writeStoredItems([]);
    set({ items: [] });
  },

  dismissPopup: (id) => {
    const target = get().popupQueue.find((p) => p.id === id);
    set((s) => ({ popupQueue: s.popupQueue.filter((p) => p.id !== id) }));
    target?.onDismiss?.();
  },

  dismissVisiblePopups: (ids) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const targets = get().popupQueue.filter((p) => idSet.has(p.id));
    set((s) => ({ popupQueue: s.popupQueue.filter((p) => !idSet.has(p.id)) }));
    for (const target of targets) {
      target.onDismiss?.();
    }
  },
}));

export function pushNotification(input: PushNotificationInput): NotificationItem | null {
  return useNotificationStore.getState().push(input);
}

/** Scope notification storage keys to the active collection (empty for default/unscoped). */
export function setNotificationCollectionScope(scope: string | null): void {
  const nextSuffix = scope ? hashScope(scope) : "";
  if (nextSuffix === collectionScopeSuffix) return;
  collectionScopeSuffix = nextSuffix;
  recentBodyTimestamps.clear();
  useNotificationStore.setState({
    items: readStoredItems(),
    popupQueue: [],
    panelOpen: false,
  });
}

/** Reload notification state from localStorage and reset transient queue (tests). */
export function initNotificationsFromStorage(scope: string | null = null): void {
  collectionScopeSuffix = scope ? hashScope(scope) : "";
  recentBodyTimestamps.clear();
  useNotificationStore.setState({
    items: readStoredItems(),
    popupQueue: [],
    panelOpen: false,
  });
}
