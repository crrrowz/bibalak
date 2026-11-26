import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { platform } from "@/lib/platform";
import { Copy, Minus, PanelLeft, Search, Square, X } from "lucide-react";
import { Logo } from "./Logo";
import { t } from "@/lib/i18n";
import { isMac, modShortcut } from "@/lib/shortcuts";

interface TitleBarProps {
  /** Extra controls shown before the search button (for example the notification bell). */
  trailing?: ReactNode;
  onToggleSidebar?: () => void;
  /** Show the "dock sidebar" affordance — true when in hover mode with no visible sidebar. */
  showSidebarDock?: boolean;
  onOpenPalette?: () => void;
}

export function TitleBar({
  onToggleSidebar,
  showSidebarDock,
  onOpenPalette,
  trailing,
}: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const mac = isMac();

  useEffect(() => {
    const win = platform.window;
    if (mac || !win) return;
    void win.isMaximized().then(setIsMaximized);
    return win.onResized(() => void win.isMaximized().then(setIsMaximized));
  }, [mac]);

  return (
    <div
      data-tauri-drag-region
      className={`glass-chrome flex h-9 shrink-0 items-center justify-between border-b select-none pe-1 ${mac ? "ps-[78px]" : "ps-3"}`}
    >
      <div className="flex items-center gap-1">
        <div className="pointer-events-none">
          <Logo size={16} />
        </div>
        {showSidebarDock && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={t("titlebar.dockSidebar")}
            title={t("titlebar.dockSidebarHint")}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelLeft className="h-3.5 w-3.5 rtl:-scale-x-100" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        {trailing && (
          <div data-testid="topbar-bell-slot" className="flex items-center">
            {trailing}
          </div>
        )}
        {onOpenPalette && (
          <button
            type="button"
            onClick={onOpenPalette}
            aria-label={t("titlebar.openPalette")}
            title={t("titlebar.paletteHint", { shortcut: modShortcut("K") })}
            className="flex h-7 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        )}
        {!mac && (
          <>
            <button
              type="button"
              onClick={() => void platform.window?.minimize()}
              aria-label={t("titlebar.minimize")}
              className="flex h-7 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void platform.window?.toggleMaximize()}
              aria-label={isMaximized ? t("titlebar.restore") : t("titlebar.maximize")}
              className="flex h-7 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {isMaximized ? (
                <Copy className="h-3.5 w-3.5 -scale-x-100" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void platform.window?.close()}
              aria-label={t("common.close")}
              className="flex h-7 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
