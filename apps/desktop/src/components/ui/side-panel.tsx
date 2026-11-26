import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui";

export interface SidePanelProps {
  open: boolean;
  title: string;
  onClose: () => void;
  width?: 360 | 420;
  className?: string;
  children: ReactNode;
}

/**
 * Non-modal `inline-end` inspector panel (spec §2.3): docked beside workspace
 * content on `lg:` (`>=1024px`) and slide-over drawer with scrim below `lg:`.
 * Traps nothing; restores focus to the opening element on `Esc` or close.
 */
export function SidePanel({
  open,
  title,
  onClose,
  width = 360,
  className,
  children,
}: SidePanelProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeBtnRef.current?.focus();

    const { openSidePanel, closeSidePanel } = useUi.getState();
    openSidePanel();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [data-popover-layer]',
        )
      ) {
        return;
      }
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      closeSidePanel();
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) {
        opener.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-background/50 lg:hidden"
      />
      <aside
        role="complementary"
        aria-label={title}
        className={cn(
          "flex h-full shrink-0 flex-col border-s border-border bg-card text-card-foreground",
          "max-lg:fixed max-lg:inset-y-0 max-lg:end-0 max-lg:z-40 max-lg:max-w-[92vw] max-lg:shadow-xl",
          width === 420 ? "w-[420px]" : "w-[360px]",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </>
  );
}
