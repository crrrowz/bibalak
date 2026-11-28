import { afterEach, describe, expect, it, vi } from "vitest";

describe("useTheme (A5-01)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("updates document dark class when OS color scheme changes while theme is system", async () => {
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    let matches = false;

    const removeEventListener = vi.fn((_type: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners.delete(fn);
    });

    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return matches;
      },
      media: "(prefers-color-scheme: dark)",
      addEventListener: (_type: string, fn: (e: MediaQueryListEvent) => void) => {
        listeners.add(fn);
      },
      removeEventListener,
    }));

    vi.resetModules();
    const { useTheme } = await import("./theme");
    useTheme.getState().setTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    // Simulate OS switching to dark mode.
    matches = true;
    for (const fn of listeners) {
      fn({ matches: true } as MediaQueryListEvent);
    }

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(useTheme.getState().resolved).toBe("dark");

    // Switching away from system unsubscribes/ignores OS changes.
    useTheme.getState().setTheme("light");
    matches = false;
    for (const fn of listeners) {
      fn({ matches: false } as MediaQueryListEvent);
    }
    expect(useTheme.getState().resolved).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("guards localStorage read and write failures", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    vi.resetModules();
    const { useTheme } = await import("./theme");
    expect(useTheme.getState().theme).toBe("system");
    expect(() => useTheme.getState().setTheme("dark")).not.toThrow();
    expect(useTheme.getState().theme).toBe("dark");
    expect(useTheme.getState().resolved).toBe("dark");
  });
});
