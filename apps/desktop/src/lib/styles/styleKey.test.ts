import { describe, expect, it } from "vitest";
import { styleKey } from "./styleKey";

describe("styleKey", () => {
  it("resolves per-style variants and falls back to the base key when no variant exists", () => {
    expect(styleKey("calendar.event.label", "default")).toBe("calendar.event.label.default");
    expect(styleKey("calendar.event.label", "scholar")).toBe("calendar.event.label.scholar");
    expect(styleKey("calendar.event.label", "game")).toBe("calendar.event.label.game");

    // Existing Default keys stay intact while Scholar/Game variants sit beside them.
    expect(styleKey("matrix.deckDue.badge", "default")).toBe("matrix.deckDue.badge");
    expect(styleKey("matrix.deckDue.badge", "scholar")).toBe("matrix.deckDue.badge.scholar");
    expect(styleKey("matrix.deckDue.badge", "game")).toBe("matrix.deckDue.badge.game");

    // Single-style keys fall back cleanly to the base key.
    expect(styleKey("matrix.view.matrix", "default")).toBe("matrix.view.matrix");
    expect(styleKey("matrix.view.matrix", "scholar")).toBe("matrix.view.matrix");
    expect(styleKey("matrix.view.matrix", "game")).toBe("matrix.view.matrix");
  });
});
