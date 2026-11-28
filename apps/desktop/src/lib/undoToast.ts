import { useEffect } from "react";
import { t } from "@/lib/i18n";
import { matchesKey } from "@/lib/shortcuts";
import { toast } from "@/stores/toast";

/**
 * Show a non-blocking 8-second action toast with an inline "Undo" button.
 */
export function pushUndoToast(message: string, onUndo: () => void | Promise<unknown>) {
  toast.info(message, {
    durationMs: 8000,
    progress: false,
    action: {
      label: t("decks.undo"),
      onClick: () => {
        void onUndo();
      },
    },
  });
}

/**
 * Bind Ctrl+Z / Cmd+Z to undo while focus is outside text inputs, setting
 * `defaultPrevented` so shell-level listeners do not double-fire.
 */
export function useUndoShortcut(onUndo: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (!matchesKey(e, "KeyZ", "z")) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      onUndo();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, onUndo]);
}
