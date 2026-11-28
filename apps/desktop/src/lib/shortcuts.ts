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

/**
 * Match a keyboard event by its physical key `code` (so shortcuts work under
 * non-Latin keyboard layouts such as Arabic), falling back to `e.key` only
 * when a synthetic event omits `code`.
 */
export function matchesKey(
  e: Pick<KeyboardEvent, "code" | "key">,
  code: string,
  fallbackKey?: string,
): boolean {
  if (e.code) return e.code === code;
  if (fallbackKey !== undefined) {
    return e.key.toLowerCase() === fallbackKey.toLowerCase();
  }
  return false;
}

/** Alias used by Browse/Notes shortcuts; delegates to {@link matchesKey}. */
export function matchesShortcutCode(
  e: { code?: string; key: string },
  code: string,
  fallbackKey: string,
): boolean {
  return matchesKey({ code: e.code ?? "", key: e.key }, code, fallbackKey);
}

const DIGIT_CODE_MAP: Record<string, string> = {
  Digit1: "1",
  Numpad1: "1",
  Digit2: "2",
  Numpad2: "2",
  Digit3: "3",
  Numpad3: "3",
  Digit4: "4",
  Numpad4: "4",
};

/**
 * Resolve a rating hotkey ("1"-"4") using physical `code` first, falling back
 * to `e.key` when synthetic events omit `code`.
 */
export function digitHotkey(e: Pick<KeyboardEvent, "code" | "key">): string | null {
  if (e.code) return DIGIT_CODE_MAP[e.code] ?? null;
  return ["1", "2", "3", "4"].includes(e.key) ? e.key : null;
}

/**
 * Match the help shortcut (`?` / Arabic `؟` / physical `Shift+Slash`).
 */
export function matchesQuestionMark(e: Pick<KeyboardEvent, "code" | "key" | "shiftKey">): boolean {
  if (e.key === "?" || e.key === "؟") return true;
  return e.code === "Slash" && e.shiftKey;
}
