import type { KeyboardEvent } from "react";
import { textDirection } from "@/lib/i18n";

/**
 * Compute the next enabled option index for an ARIA radiogroup key press.
 * Right/Down move forward, Left/Up move backward (wrapping), Home/End jump
 * to first/last, and Left/Right swap in RTL. Returns `null` for other keys.
 */
export function nextRadioIndex(
  key: string,
  currentIndex: number,
  count: number,
  dir: "ltr" | "rtl" = textDirection(),
): number | null {
  if (count <= 0 || currentIndex < 0 || currentIndex >= count) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;

  const isRtl = dir === "rtl";
  const nextKey = isRtl ? "ArrowLeft" : "ArrowRight";
  const prevKey = isRtl ? "ArrowRight" : "ArrowLeft";

  if (key === nextKey || key === "ArrowDown") {
    return (currentIndex + 1) % count;
  }
  if (key === prevKey || key === "ArrowUp") {
    return (currentIndex - 1 + count) % count;
  }
  return null;
}

/**
 * Shared `onKeyDown` handler for ARIA radiogroups where selection follows focus.
 */
export function handleRadioGroupKeyDown<T>(
  e: KeyboardEvent<HTMLElement>,
  options: readonly T[],
  currentIndex: number,
  onSelect: (value: T) => void,
  dir: "ltr" | "rtl" = textDirection(),
): void {
  const nextIndex = nextRadioIndex(e.key, currentIndex, options.length, dir);
  if (nextIndex === null) return;

  e.preventDefault();
  const group = e.currentTarget.closest('[role="radiogroup"]') ?? e.currentTarget.parentElement;
  onSelect(options[nextIndex]);
  const radios = group?.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled)');
  radios?.[nextIndex]?.focus();
}
