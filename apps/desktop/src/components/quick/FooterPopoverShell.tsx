import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useLocale } from "@/lib/i18n";
import { ease, useReducedMotion } from "@/lib/motion";

export interface FooterPopoverShellProps {
  open: boolean;
  compact: boolean;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  testId: string;
  ariaLabel: string;
  widthClass?: string;
  estimatedWidth?: number;
  children: ReactNode;
}

/**
 * Shared portal shell for sidebar footer pop-overs: anchors beside the compact
 * sidebar or above the wide sidebar, closes on outside pointer-down or Esc
 * (returning focus to the trigger), and stops key leakage.
 */
export function FooterPopoverShell({
  open,
  compact,
  anchorRef,
  onClose,
  testId,
  ariaLabel,
  widthClass,
  estimatedWidth = 240,
  children,
}: FooterPopoverShellProps) {
  const { locale } = useLocale();
  const reducedMotion = Boolean(useReducedMotion());
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{
    bottom: number;
    left?: number;
    right?: number;
  } | null>(null);

  const updatePos = useCallback(() => {
    const btn = anchorRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const isRtl = document.documentElement.dir === "rtl";
    const gap = 8;
    const maxEdge = Math.max(8, window.innerWidth - estimatedWidth - 8);
    if (compact) {
      setPopoverPos({
        bottom: Math.max(8, window.innerHeight - rect.bottom),
        ...(isRtl
          ? { right: Math.min(maxEdge, Math.max(8, window.innerWidth - rect.left + gap)) }
          : { left: Math.min(maxEdge, Math.max(8, rect.right + gap)) }),
      });
    } else {
      setPopoverPos({
        bottom: Math.max(8, window.innerHeight - rect.top + gap),
        ...(isRtl
          ? { right: Math.min(maxEdge, Math.max(8, window.innerWidth - rect.right)) }
          : { left: Math.min(maxEdge, Math.max(8, rect.left)) }),
      });
    }
  }, [anchorRef, compact, estimatedWidth]);

  useLayoutEffect(() => {
    if (!open) {
      setPopoverPos(null);
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
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        anchorRef.current &&
        !anchorRef.current.contains(target) &&
        (!popoverRef.current || !popoverRef.current.contains(target))
      ) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        anchorRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [open, onClose, anchorRef]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && popoverPos && (
        <motion.div
          ref={popoverRef}
          data-testid={testId}
          role="dialog"
          aria-label={ariaLabel}
          initial={reducedMotion ? false : { opacity: 0, scale: 0.95, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 4 }}
          transition={{ duration: reducedMotion ? 0 : 0.15, ease }}
          style={popoverPos}
          onKeyDown={(e) => {
            if (!e.metaKey && !e.ctrlKey && e.key !== "Escape") {
              e.stopPropagation();
            }
          }}
          className={`fixed z-50 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg ${
            widthClass ?? (compact ? "w-56" : "w-60")
          }`}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
