import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const SELECT_SIZE_CLASSES = {
  xs: "h-7 ps-2 pe-7 text-xs",
  sm: "h-8 ps-2.5 pe-7 text-xs",
  default: "h-9 ps-3 pe-8 text-sm",
} as const;

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  selectSize?: keyof typeof SELECT_SIZE_CLASSES;
  containerClassName?: string;
}

/**
 * Shared styled wrapper around native `<select>` that preserves keyboard
 * navigation, native accessibility, and form test semantics while unifying
 * height, borders, focus rings, RTL-safe chevron padding, and popover styling.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, containerClassName, selectSize = "default", children, ...props }, ref) => (
    <div
      dir={props.dir}
      style={props.style?.direction ? { direction: props.style.direction } : undefined}
      className={cn("relative inline-flex w-full items-center", containerClassName)}
    >
      <select
        ref={ref}
        className={cn(
          "w-full truncate appearance-none rounded-md border border-input bg-background text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          SELECT_SIZE_CLASSES[selectSize],
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  ),
);
Select.displayName = "Select";
