import { forwardRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCheck, Trash2 } from "lucide-react";
import { formatDate, t } from "@/lib/i18n";
import { dur, ease, useReducedMotion } from "@/lib/motion";
import { useOptionalNavigate } from "@/lib/useOptionalNavigate";
import { cn } from "@/lib/utils";
import { useStyle, type Style } from "@/stores/style";
import { NotificationKindIcon } from "./notificationHelpers";
import { navigateToNotificationLink } from "./notificationLink";
import { useNotificationStore, type NotificationItem } from "./notificationStore";

interface NotificationPanelProps {
  open: boolean;
  pos: { top: number; left?: number; right?: number } | null;
  onClose: () => void;
}

function panelTitleKey(style: Style) {
  if (style === "game") return "notifications.panel.title.game" as const;
  if (style === "scholar") return "notifications.panel.title.scholar" as const;
  return "notifications.panel.title" as const;
}

function emptyStateKey(style: Style) {
  if (style === "game") return "notifications.panel.empty.game" as const;
  if (style === "scholar") return "notifications.panel.empty.scholar" as const;
  return "notifications.panel.empty.default" as const;
}

function formatNotificationTime(timeMs: number): string {
  const diff = Date.now() - timeMs;
  if (diff < 60_000) return t("notifications.time.justNow");
  return formatDate(timeMs, { dateStyle: "short", timeStyle: "short" });
}

export const NotificationPanel = forwardRef<HTMLDivElement, NotificationPanelProps>(
  function NotificationPanel({ open, pos, onClose }, ref) {
    const items = useNotificationStore((s) => s.items);
    const markRead = useNotificationStore((s) => s.markRead);
    const markAllRead = useNotificationStore((s) => s.markAllRead);
    const clear = useNotificationStore((s) => s.clear);
    const style = useStyle((s) => s.style);
    const reduced = useReducedMotion();
    const navigate = useOptionalNavigate();

    const unreadCount = items.reduce((sum, item) => sum + (item.read ? 0 : 1), 0);

    const handleItemClick = (item: NotificationItem) => {
      if (!item.read) markRead(item.id);
      if (item.link) {
        navigateToNotificationLink(item.link, navigate);
        onClose();
      }
    };

    return (
      <AnimatePresence>
        {open && pos && (
          <motion.div
            ref={ref}
            data-testid="notification-panel"
            role="dialog"
            aria-label={t(panelTitleKey(style))}
            initial={reduced ? { opacity: 1 } : { opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: reduced ? 0 : dur.fast, ease }}
            style={pos}
            onKeyDown={(e) => {
              if (!e.metaKey && !e.ctrlKey && e.key !== "Escape") {
                e.stopPropagation();
              }
            }}
            className="glass-panel fixed z-50 flex max-h-[min(28rem,calc(100vh-4rem))] w-[min(22rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl border border-border text-popover-foreground shadow-xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2.5">
              <h2 className="text-sm font-semibold text-foreground">{t(panelTitleKey(style))}</h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={unreadCount === 0}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                >
                  <CheckCheck className="size-3.5" aria-hidden="true" />
                  <span>{t("notifications.panel.markAllRead")}</span>
                </button>
                <button
                  type="button"
                  onClick={clear}
                  disabled={items.length === 0}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  <span>{t("notifications.panel.clear")}</span>
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {items.length === 0 ? (
                <p className="px-3 py-8 text-center text-xs leading-relaxed text-muted-foreground">
                  {t(emptyStateKey(style))}
                </p>
              ) : (
                <ul className="space-y-1">
                  {items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => handleItemClick(item)}
                        className={cn(
                          "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          !item.read && "bg-primary/5",
                        )}
                      >
                        <NotificationKindIcon
                          kind={item.kind}
                          className="mt-0.5 size-4 shrink-0 text-primary"
                        />
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              data-testid="notification-item-title"
                              className="truncate text-xs font-semibold text-foreground"
                            >
                              {item.title}
                            </span>
                            {!item.read && (
                              <span
                                aria-label={t("notifications.panel.unreadBadge")}
                                className="size-2 shrink-0 rounded-full bg-primary"
                              />
                            )}
                          </div>
                          <p className="break-words text-xs leading-snug text-muted-foreground">
                            {item.body}
                          </p>
                          <p className="text-[11px] tabular-nums text-muted-foreground/80">
                            {formatNotificationTime(item.time)}
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  },
);
