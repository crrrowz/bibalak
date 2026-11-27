import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "keepsake-style";

describe("useStyle store", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-style");
    vi.resetModules();
  });

  it("defaults to 'game' for a new user and sets data-style='game' on <html>", async () => {
    const { useStyle } = await import("./style");
    expect(useStyle.getState().style).toBe("game");
    expect(document.documentElement.getAttribute("data-style")).toBe("game");
  });

  it("never overwrites a stored 'default' style on initialization", async () => {
    localStorage.setItem(STORAGE_KEY, "default");
    const { useStyle } = await import("./style");

    expect(useStyle.getState().style).toBe("default");
    expect(document.documentElement.getAttribute("data-style")).toBe("default");
  });

  it("persists style to localStorage and updates data-style on <html>", async () => {
    const { useStyle } = await import("./style");
    useStyle.getState().setStyle("scholar");

    expect(useStyle.getState().style).toBe("scholar");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("scholar");
    expect(document.documentElement.getAttribute("data-style")).toBe("scholar");
  });

  it("restores a stored 'scholar' style on initialization", async () => {
    localStorage.setItem(STORAGE_KEY, "scholar");
    const { useStyle } = await import("./style");

    expect(useStyle.getState().style).toBe("scholar");
    expect(document.documentElement.getAttribute("data-style")).toBe("scholar");
  });

  it("restores a stored 'game' style on initialization", async () => {
    localStorage.setItem(STORAGE_KEY, "game");
    const { useStyle } = await import("./style");

    expect(useStyle.getState().style).toBe("game");
    expect(document.documentElement.getAttribute("data-style")).toBe("game");
  });

  it("falls back to 'game' when localStorage holds an unknown value", async () => {
    localStorage.setItem(STORAGE_KEY, "unknown-style");
    const { useStyle } = await import("./style");

    expect(useStyle.getState().style).toBe("game");
    expect(document.documentElement.getAttribute("data-style")).toBe("game");
  });
});
