import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "keepsake-week-start";

describe("useWeekStart store", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("defaults by locale ('mon' for English, 'sat' for Arabic) and updates on locale switch until overridden", async () => {
    const { setLocale } = await import("@/lib/i18n");
    setLocale("en");
    localStorage.removeItem("keepsake-locale");
    const { useWeekStart } = await import("./weekStart");
    expect(useWeekStart.getState().weekStart).toBe("mon");

    setLocale("ar");
    expect(useWeekStart.getState().weekStart).toBe("sat");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    setLocale("en");
    expect(useWeekStart.getState().weekStart).toBe("mon");
  });

  it("persists explicit choice to localStorage and ignores invalid stored values", async () => {
    const { setLocale } = await import("@/lib/i18n");
    setLocale("en");
    const { useWeekStart } = await import("./weekStart");
    useWeekStart.getState().setWeekStart("sun");

    expect(useWeekStart.getState().weekStart).toBe("sun");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("sun");

    setLocale("ar");
    expect(useWeekStart.getState().weekStart).toBe("sun");

    vi.resetModules();
    localStorage.setItem(STORAGE_KEY, "tue");
    const i18nReloaded = await import("@/lib/i18n");
    i18nReloaded.setLocale("ar");
    const reloaded = await import("./weekStart");
    expect(reloaded.useWeekStart.getState().weekStart).toBe("sat");
  });
});
