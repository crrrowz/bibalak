import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button, type ButtonProps } from "@/components/ui/button";
import { dur, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface ActionMenuContextValue {
  close: () => void;
}

const ActionMenuContext = createContext<ActionMenuContextValue | null>(null);

interface ActionMenuProps {
  menuLabel: string;
  triggerLabel?: string;
  triggerAriaLabel?: string;
  triggerClassName?: string;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
  triggerContent: ReactNode;
  placement?: "top" | "bottom";
  align?: "start" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  stopContainerClickPropagation?: boolean;
  children: ReactNode;
}

/** Accessible dropdown / pop-up menu with keyboard navigation and click-outside dismissal. */
export function ActionMenu({
  menuLabel,
  triggerAriaLabel,
  triggerClassName,
  triggerVariant,
  triggerSize = "sm",
  triggerContent,
  placement = "bottom",
  align = "end",
  open: controlledOpen,
  onOpenChange,
  stopContainerClickPropagation = false,
  children,
}: ActionMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef<"first" | "last" | null>(null);
  const menuId = useId();

  function enabledItems(): HTMLButtonElement[] {
    if (!menuRef.current) return [];
    return Array.from(
      menuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
    );
  }

  useEffect(() => {
    if (!isOpen) return;
    if (pendingFocusRef.current) {
      const items = enabledItems();
      const target = pendingFocusRef.current === "last" ? items[items.length - 1] : items[0];
      target?.focus();
      pendingFocusRef.current = null;
    }

    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onCaptureKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onCaptureKeyDown, { capture: true });
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onCaptureKeyDown, { capture: true });
    };
  });

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      pendingFocusRef.current = "first";
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      pendingFocusRef.current = "last";
      setOpen(true);
    } else if ((e.key === "Enter" || e.key === " ") && !isOpen) {
      pendingFocusRef.current = "first";
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = enabledItems();
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = currentIndex >= 0 ? (currentIndex + 1) % items.length : 0;
      items[next]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev =
        currentIndex >= 0 ? (currentIndex - 1 + items.length) % items.length : items.length - 1;
      items[prev]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const triggerProps = {
    ref: triggerRef,
    type: "button" as const,
    "aria-label": triggerAriaLabel,
    "aria-haspopup": "menu" as const,
    "aria-expanded": isOpen,
    "aria-controls": isOpen ? menuId : undefined,
    onClick: () => setOpen(!isOpen),
    onKeyDown: onTriggerKeyDown,
  };

  const yOffset = placement === "top" ? 4 : -4;

  return (
    <div
      className="relative"
      ref={containerRef}
      onClick={stopContainerClickPropagation ? (e) => e.stopPropagation() : undefined}
    >
      {triggerVariant ? (
        <Button
          {...triggerProps}
          variant={triggerVariant}
          size={triggerSize}
          className={triggerClassName}
        >
          {triggerContent}
        </Button>
      ) : (
        <button {...triggerProps} className={triggerClassName}>
          {triggerContent}
        </button>
      )}
      <ActionMenuContext.Provider value={{ close: () => setOpen(false) }}>
        <AnimatePresence>
          {isOpen && (
            <motion.div
              ref={menuRef}
              id={menuId}
              initial={{ opacity: 0, scale: 0.95, y: yOffset }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: yOffset }}
              transition={{ duration: dur.fast, ease }}
              role="menu"
              aria-label={menuLabel}
              onKeyDown={onMenuKeyDown}
              className={cn(
                "glass-panel absolute z-20 min-w-52 w-max max-w-xs overflow-hidden rounded-lg border py-1 shadow-md",
                placement === "top" ? "bottom-full mb-1" : "top-full mt-1",
                align === "start" ? "start-0" : "end-0",
              )}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </ActionMenuContext.Provider>
    </div>
  );
}

interface ActionMenuItemProps {
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Single row inside an [`ActionMenu`]. */
export function ActionMenuItem({ icon, label, onSelect, danger, disabled }: ActionMenuItemProps) {
  const ctx = useContext(ActionMenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-start text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        danger ? "text-destructive [&_svg]:text-destructive" : "[&_svg]:text-muted-foreground",
      )}
      onClick={() => {
        ctx?.close();
        onSelect();
      }}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

/** Visual divider between menu sections. */
export function ActionMenuSeparator() {
  return <div role="separator" className="my-1 border-t border-border" />;
}
