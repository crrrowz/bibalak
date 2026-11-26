import { describe, expect, it } from "vitest";
import { isMac, modKeyLabel, modShortcut } from "./shortcuts";

describe("shortcuts helper (OT-10)", () => {
  it("detects macOS platform from platform string", () => {
    expect(isMac("MacIntel")).toBe(true);
    expect(isMac("MacPPC")).toBe(true);
    expect(isMac("Macintosh")).toBe(true);
    expect(isMac("Win32")).toBe(false);
    expect(isMac("Linux x86_64")).toBe(false);
  });

  it("returns ⌘ on macOS and Ctrl on other OSes", () => {
    expect(modKeyLabel(true)).toBe("⌘");
    expect(modKeyLabel(false)).toBe("Ctrl");
  });

  it("formats modifier shortcuts correctly per OS", () => {
    expect(modShortcut("K", true)).toBe("⌘K");
    expect(modShortcut("K", false)).toBe("Ctrl+K");
    expect(modShortcut("A", true)).toBe("⌘A");
    expect(modShortcut("A", false)).toBe("Ctrl+A");
  });
});
