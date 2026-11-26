import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell } from "lucide-react";
import { formatNumber, t, tn, useLocale } from "@/lib/i18n";
import { NotificationPanel } from "./NotificationPanel";
import { useNotificationStore } from "./notificationStore";

/**
 * Top-bar notification bell button with unread badge and portal popover panel.
 * Placed by AppShell beside the search button in the exact same spot in every style.
 */
export function NotificationBell() {
  const { locale } = useLocale();
  const items = useNotificationStore((s) => s.items);
  const open = useNotificationStore((s) => s.panelOpen);
  const setOpen = useNotificationStore((s) => s.setPanelOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{
    top: number;
    left?: number;
    right?: number;
  } | null>(null);

  const unreadCount = items.reduce((sum, item) => sum + (item.read ? 0 : 1), 0);

  const updatePos = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const isRtl = document.documentElement.dir === "rtl";
    const gap = 6;
    setPanelPos({
      top: rect.bottom + gap,
      ...(isRtl
        ? { left: Math.max(8, rect.left) }
        : { right: Math.max(8, window.innerWidth - rect.right) }),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open, updatePos, locale]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!panelRef.current || !panelRef.current.contains(target))
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, { capture: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [open, setOpen]);

  const ariaLabel =
    unreadCount > 0
      ? tn("notifications.bell.ariaUnread", unreadCount, { count: formatNumber(unreadCount) })
      : t("notifications.bell.ariaEmpty");

  const badgeText = unreadCount > 99 ? `${formatNumber(99)}+` : formatNumber(unreadCount);

  return (
    <div ref={containerRef} className="relative flex items-center">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={ariaLabel}
        title={t("notifications.bell.tooltip")}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative flex h-7 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="h-3.5 w-3.5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            data-testid="notification-unread-badge"
            aria-hidden="true"
            className="pointer-events-none absolute -top-0.5 end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums"
          >
            {badgeText}
          </span>
        )}
      </button>

      {typeof document !== "undefined" &&
        createPortal(
          <NotificationPanel
            ref={panelRef}
            open={open}
            pos={panelPos}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </div>
  );
}
