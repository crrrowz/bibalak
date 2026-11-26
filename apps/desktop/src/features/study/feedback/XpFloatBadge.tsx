import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { formatNumber, t } from "@/lib/i18n";
import { useReducedMotion, xpFloat } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useStyle } from "@/stores/style";

export interface XpFloatBadgeProps {
  totalXp: number | null;
}

/**
 * Floating "+N XP" indicator anchored near the HUD XP bar whenever total XP
 * increases after initial load. Portaled to `document.body` above screen
 * headers so HUD overflow or study header bars never clip it.
 */
export function XpFloatBadge({ totalXp }: XpFloatBadgeProps) {
  const style = useStyle((s) => s.style);
  const reducedMotion = useReducedMotion();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const prevTotalXpRef = useRef<number | null>(null);
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [badge, setBadge] = useState<{ id: number; xp: number } | null>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);

  const updatePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const isRtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
    setPos({
      top: Math.round(rect.bottom) + 2,
      ...(isRtl
        ? { left: Math.max(8, Math.round(rect.left)) }
        : { right: Math.max(8, Math.round(window.innerWidth - rect.right)) }),
    });
  }, []);

  useEffect(() => {
    if (totalXp === null) {
      prevTotalXpRef.current = null;
      return;
    }
    const prev = prevTotalXpRef.current;
    prevTotalXpRef.current = totalXp;
    if (prev !== null && totalXp > prev) {
      const delta = totalXp - prev;
      clearTimeout(timerRef.current);
      seqRef.current += 1;
      setBadge({ id: seqRef.current, xp: delta });
      timerRef.current = setTimeout(() => setBadge(null), 1050);
    }
  }, [totalXp]);

  useLayoutEffect(() => {
    if (!badge) {
      setPos(null);
      return;
    }
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [badge, updatePos]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const badgeNode = (
    <AnimatePresence>
      {badge && (
        <motion.span
          key={badge.id}
          data-testid="hud-xp-float"
          data-reduced-motion={reducedMotion ? "true" : "false"}
          initial={reducedMotion ? xpFloat.stillInitial : xpFloat.initial}
          animate={reducedMotion ? xpFloat.stillAnimate : xpFloat.animate}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          style={pos ?? undefined}
          className={cn(
            "tnum pointer-events-none fixed z-30 rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] font-semibold shadow-sm",
            style === "game" ? "text-[hsl(var(--game-xp))]" : "text-primary",
          )}
        >
          {t("study.feedback.xpGain", { xp: formatNumber(badge.xp) })}
        </motion.span>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <span
        ref={anchorRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-full h-0"
      />
      {typeof document !== "undefined" ? createPortal(badgeNode, document.body) : badgeNode}
    </>
  );
}
