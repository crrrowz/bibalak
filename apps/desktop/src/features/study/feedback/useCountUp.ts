import { useEffect, useRef, useState } from "react";

export interface UseCountUpOptions {
  durationMs?: number;
  reducedMotion?: boolean;
}

/**
 * Smoothly counts an integer value upward on increases after initial load.
 * Snaps immediately on initial load, on decreases, or under reduced motion.
 */
export function useCountUp(
  target: number | null,
  { durationMs = 360, reducedMotion = false }: UseCountUpOptions = {},
): number {
  const prevTargetRef = useRef<number | null>(null);
  const displayRef = useRef<number>(target ?? 0);
  const [displayValue, setDisplayValue] = useState<number>(target ?? 0);

  useEffect(() => {
    if (target === null) {
      prevTargetRef.current = null;
      return;
    }

    const prev = prevTargetRef.current;
    prevTargetRef.current = target;

    if (prev === null || reducedMotion || target <= prev) {
      displayRef.current = target;
      setDisplayValue(target);
      return;
    }

    const from = displayRef.current;
    if (from >= target) {
      displayRef.current = target;
      setDisplayValue(target);
      return;
    }

    let rafId = 0;
    const start = performance.now();

    const step = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (target - from) * eased);
      displayRef.current = next;
      setDisplayValue(next);
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [target, durationMs, reducedMotion]);

  if (target === null) return 0;
  if (reducedMotion || prevTargetRef.current === null || target <= prevTargetRef.current) {
    return target;
  }
  return displayValue;
}
