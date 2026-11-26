import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { t } from "@/lib/i18n";

interface ScreenHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: {
    label: string;
    onBack: () => void;
  };
}

/** Slim sticky page header used at the top of each route. */
export function ScreenHeader({ title, description, actions, breadcrumb }: ScreenHeaderProps) {
  return (
    <div
      data-toast-anchor
      className="glass-panel sticky top-0 z-20 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2 sm:px-6"
    >
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        {breadcrumb ? (
          <nav
            aria-label={t("ai.breadcrumb.ariaLabel")}
            className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold tracking-tight"
          >
            <button
              type="button"
              onClick={breadcrumb.onBack}
              className="-mx-1 shrink-0 rounded px-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {breadcrumb.label}
            </button>
            <ChevronRight
              className="size-3.5 shrink-0 text-muted-foreground rtl:-scale-x-100"
              aria-hidden="true"
            />
            <h1 className="screen-title min-w-0 truncate text-foreground">{title}</h1>
          </nav>
        ) : (
          <h1 className="screen-title min-w-0 truncate text-[15px] font-semibold tracking-tight">
            {title}
          </h1>
        )}
        {description ? (
          <span className="hidden min-w-0 truncate text-[13px] text-muted-foreground md:inline">
            {description}
          </span>
        ) : null}
      </div>
      {actions ? (
        <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
