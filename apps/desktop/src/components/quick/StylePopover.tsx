import type { ComponentType, RefObject } from "react";
import { Check } from "lucide-react";
import { StyleDefaultIcon, StyleGameIcon, StyleScholarIcon } from "@/components/icons/progress";
import { t } from "@/lib/i18n";
import { handleRadioGroupKeyDown } from "@/lib/radioGroupKeys";
import { cn } from "@/lib/utils";
import type { LocaleKey } from "@/locales/en";
import { useStyle, type Style } from "@/stores/style";
import { FooterPopoverShell } from "./FooterPopoverShell";

export interface StylePopoverProps {
  open: boolean;
  compact: boolean;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

const STYLE_OPTIONS: ReadonlyArray<{
  value: Style;
  labelKey: LocaleKey;
  icon: ComponentType<{ className?: string }>;
}> = [
  { value: "default", labelKey: "settings.style.default", icon: StyleDefaultIcon },
  { value: "scholar", labelKey: "settings.style.scholar", icon: StyleScholarIcon },
  { value: "game", labelKey: "settings.style.game", icon: StyleGameIcon },
];

const STYLE_VALUES = STYLE_OPTIONS.map((o) => o.value);

/**
 * Presentation style switcher pop-over in the sidebar footer (Default, Scholar,
 * Game — per device via `useStyle`), matching Settings → Appearance → Style.
 */
export function StylePopover({ open, compact, anchorRef, onClose }: StylePopoverProps) {
  const style = useStyle((s) => s.style);
  const setStyle = useStyle((s) => s.setStyle);

  return (
    <FooterPopoverShell
      open={open}
      compact={compact}
      anchorRef={anchorRef}
      onClose={onClose}
      testId="style-popover"
      ariaLabel={t("settings.style.label")}
      widthClass="w-44"
      estimatedWidth={176}
    >
      <div className="space-y-1">
        <p className="px-1.5 pb-1 text-[11px] font-medium text-muted-foreground">
          {t("settings.style.label")}
        </p>
        <div role="radiogroup" aria-label={t("settings.style.label")} className="space-y-0.5">
          {STYLE_OPTIONS.map((option, idx) => {
            const Icon = option.icon;
            const selected = style === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  setStyle(option.value);
                  onClose();
                }}
                onKeyDown={(e) => handleRadioGroupKeyDown(e, STYLE_VALUES, idx, setStyle)}
                className={cn(
                  "flex min-h-[36px] w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-start text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "bg-accent text-foreground" : "text-foreground hover:bg-accent/60",
                )}
              >
                <span className="flex items-center gap-2">
                  <Icon className="size-3.5 shrink-0" />
                  <span>{t(option.labelKey)}</span>
                </span>
                {selected && (
                  <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </FooterPopoverShell>
  );
}
