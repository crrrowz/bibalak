/**
 * Shortcut helpers providing OS-appropriate modifier key labels (OT-10).
 *
 * macOS uses symbols like ⌘ without "+", e.g. "⌘K", "⌘A".
 * Windows and Linux use "Ctrl+", e.g. "Ctrl+K", "Ctrl+A".
 */

export function isMac(platformOverride?: string): boolean {
  if (typeof platformOverride === "string") {
    return /Mac/i.test(platformOverride);
  }
  return (
    typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent || "")
  );
}

export function modKeyLabel(mac: boolean = isMac()): string {
  return mac ? "⌘" : "Ctrl";
}

export function modShortcut(key: string, mac: boolean = isMac()): string {
  return mac ? `⌘${key}` : `Ctrl+${key}`;
}
