import { useEffect, useRef, type KeyboardEventHandler, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { dur, scaleIn, useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface DialogProps {
  open?: boolean;
  onClose?: () => void;
  role?: "dialog" | "alertdialog";
  ariaLabel?: string;
  ariaLabelledBy?: string;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  animation?: "scale" | "fade";
  className?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  children: ReactNode;
}

const fadeOnly = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: dur.base } },
  exit: { opacity: 0, transition: { duration: dur.fast } },
};

const instant = {
  hidden: { opacity: 1 },
  show: { opacity: 1, transition: { duration: 0 } },
  exit: { opacity: 0, transition: { duration: 0 } },
};

/**
 * Shared accessible modal dialog primitive: traps focus, handles Escape and
 * backdrop clicks cleanly, and never places `role="dialog"` inside an
 * `aria-hidden="true"` backdrop element.
 */
export function Dialog({
  open = true,
  onClose,
  role = "dialog",
  ariaLabel,
  ariaLabelledBy,
  closeOnEscape = true,
  closeOnBackdrop = true,
  animation = "scale",
  className,
  onKeyDown,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open || !closeOnEscape || !onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, closeOnEscape, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            data-testid="dialog-backdrop"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : dur.fast }}
            className="fixed inset-0 bg-background/65 backdrop-blur-sm"
            onClick={() => {
              if (closeOnBackdrop) onClose?.();
            }}
          />
          <motion.div
            ref={panelRef}
            role={role}
            aria-modal="true"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            variants={reducedMotion ? instant : animation === "fade" ? fadeOnly : scaleIn}
            initial="hidden"
            animate="show"
            exit="exit"
            className={cn(
              "relative z-10 w-full max-w-md rounded-xl border border-border bg-card text-card-foreground shadow-xl",
              className,
            )}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onKeyDown}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
