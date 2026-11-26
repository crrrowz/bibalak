import type { KeyboardEvent } from "react";

/** Handles WAI-ARIA horizontal tablist keyboard navigation (ArrowLeft/Right RTL-aware, Home, End). */
export function handleTabListKeyDown<T extends string>(
  e: KeyboardEvent<HTMLElement>,
  tabs: readonly T[],
  activeTab: T,
  onSelect: (tab: T) => void,
): void {
  const index = tabs.indexOf(activeTab);
  if (index === -1 || tabs.length === 0) return;

  const isRtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  let nextIndex: number | null = null;

  if (e.key === "ArrowRight") {
    nextIndex = (index + (isRtl ? -1 : 1) + tabs.length) % tabs.length;
  } else if (e.key === "ArrowLeft") {
    nextIndex = (index + (isRtl ? 1 : -1) + tabs.length) % tabs.length;
  } else if (e.key === "Home") {
    nextIndex = 0;
  } else if (e.key === "End") {
    nextIndex = tabs.length - 1;
  }

  if (nextIndex === null) return;
  e.preventDefault();
  onSelect(tabs[nextIndex]);
  const tablist = e.currentTarget.closest('[role="tablist"]');
  const target = tablist?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex];
  target?.focus();
}
