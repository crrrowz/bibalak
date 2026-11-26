import { create } from "zustand";
import {
  pushNotification,
  type NotificationKind,
} from "@/features/notifications/notificationStore";
import { t } from "@/lib/i18n";
import { useStyle } from "@/stores/style";

export type ToastTone = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  action?: ToastAction;
}

export interface ToastPushOptions {
  durationMs?: number;
  action?: ToastAction;
  /** Explicitly mark whether this toast is a progress event (routed to notification centre). */
  progress?: boolean;
  /** Optional metadata when routed to the notification centre. */
  notification?: {
    kind?: NotificationKind;
    title?: string;
    link?: string;
    dedupeKey?: string;
  };
}

const MAX_TOASTS = 4;
const DEFAULT_DURATION_MS: Record<ToastTone, number> = {
  info: 4000,
  success: 4000,
  error: 6000,
};

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function cancelTimer(id: number) {
  const handle = timers.get(id);
  if (handle !== undefined) {
    clearTimeout(handle);
    timers.delete(id);
  }
}

function classifyProgressToast(
  tone: ToastTone,
  message: string,
  opts: ToastPushOptions,
): { kind: NotificationKind; title?: string; link?: string } | null {
  if (tone === "error" || opts.progress === false) return null;

  if (opts.notification) {
    return {
      kind: opts.notification.kind ?? "progress",
      title: opts.notification.title,
      link: opts.notification.link,
    };
  }

  if (opts.progress === true) {
    if (/^(Purchased|تم شراء)\b/i.test(message)) {
      return { kind: "purchase", link: "/shop" };
    }
    if (/^(Refunded|تم استرجاع)\b/i.test(message)) {
      return { kind: "refund", link: "/shop" };
    }
    if (/^(Streak frozen|تم تجميد السلسلة)/i.test(message)) {
      return { kind: "freeze", link: "/plan/habits" };
    }
    return { kind: "progress" };
  }

  // Known progress toast patterns across existing & parallel screens.
  if (/^(Purchased|تم شراء)\b/i.test(message)) {
    return { kind: "purchase", link: "/shop" };
  }
  if (/^(Refunded|تم استرجاع)\b/i.test(message)) {
    return { kind: "refund", link: "/shop" };
  }
  if (/^(Streak frozen|تم تجميد السلسلة)/i.test(message)) {
    return { kind: "freeze", link: "/plan/habits" };
  }
  if (
    /^(Added \d+ card|أُضيفت|تمت إضافة \d+ بطاق|Applied \d+|تم تطبيق|Moved \d+ overdue|نُقلت)/i.test(
      message,
    )
  ) {
    return { kind: "progress" };
  }

  return null;
}

function defaultTitleForToastKind(kind: NotificationKind): string {
  const style = useStyle.getState().style;
  if (kind === "purchase") return t("notifications.kind.purchase");
  if (kind === "refund") return t("notifications.kind.refund");
  if (kind === "freeze") return t("notifications.kind.freeze");
  if (style === "game") return t("notifications.kind.progress.game");
  if (style === "scholar") return t("notifications.kind.progress.scholar");
  return t("notifications.kind.progress");
}

interface ToastState {
  items: ToastItem[];
  push: (tone: ToastTone, message: string, durationOrOptions?: number | ToastPushOptions) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

/** Shared non-blocking toast notification store capped at 4 items. */
export const useToastStore = create<ToastState>((set, get) => ({
  items: [],

  push: (tone, message, durationOrOptions) => {
    const clean = message.trim();
    const id = nextId++;
    const opts =
      typeof durationOrOptions === "number"
        ? { durationMs: durationOrOptions }
        : (durationOrOptions ?? {});

    const progressMeta = classifyProgressToast(tone, clean, opts);
    if (progressMeta) {
      pushNotification({
        kind: progressMeta.kind,
        title: progressMeta.title ?? defaultTitleForToastKind(progressMeta.kind),
        body: clean,
        link: progressMeta.link,
        dedupeKey: opts.notification?.dedupeKey,
        durationMs: opts.durationMs,
        action: opts.action,
      });
      return id;
    }

    set((state) => {
      const next = [...state.items, { id, tone, message: clean, action: opts.action }];
      if (next.length > MAX_TOASTS) {
        const dropped = next.slice(0, next.length - MAX_TOASTS);
        for (const item of dropped) cancelTimer(item.id);
        return { items: next.slice(next.length - MAX_TOASTS) };
      }
      return { items: next };
    });

    const timeout = opts.durationMs ?? DEFAULT_DURATION_MS[tone];
    if (timeout > 0) {
      const handle = setTimeout(() => {
        timers.delete(id);
        get().dismiss(id);
      }, timeout);
      timers.set(id, handle);
    }

    return id;
  },

  dismiss: (id) => {
    cancelTimer(id);
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
    }));
  },

  clear: () => {
    for (const handle of timers.values()) clearTimeout(handle);
    timers.clear();
    set({ items: [] });
  },
}));

/** Imperative helper for firing transient status or error notifications anywhere. */
export const toast = {
  success: (message: string, durationOrOptions?: number | ToastPushOptions) =>
    useToastStore.getState().push("success", message, durationOrOptions),
  error: (message: string, durationOrOptions?: number | ToastPushOptions) =>
    useToastStore.getState().push("error", message, durationOrOptions),
  info: (message: string, durationOrOptions?: number | ToastPushOptions) =>
    useToastStore.getState().push("info", message, durationOrOptions),
};
