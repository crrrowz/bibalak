import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocale, setLocale, t, tn } from "./i18n";
import { en } from "@/locales/en";
import { ar } from "@/locales/ar";

afterEach(() => setLocale("en"));

describe("locale switching", () => {
  it("switches <html> to Arabic right-to-left", () => {
    setLocale("ar");
    expect(getLocale()).toBe("ar");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(t("nav.decks")).toBe(ar["nav.decks"]);
    expect(t("nav.decks")).not.toBe(en["nav.decks"]);
  });

  it("switches back to English left-to-right", () => {
    setLocale("ar");
    setLocale("en");
    expect(document.documentElement.dir).toBe("ltr");
    expect(t("nav.decks")).toBe("Decks");
  });

  it("remembers the choice", () => {
    setLocale("ar");
    expect(localStorage.getItem("keepsake-locale")).toBe("ar");
  });

  it("interpolates variables", () => {
    expect(t("app.version", { version: "1.2" })).toBe("v1.2");
  });
});

describe("plurals", () => {
  it("picks the English plural form", () => {
    expect(tn("common.cards", 1)).toBe("1 card");
    expect(tn("common.cards", 5)).toBe("5 cards");
  });

  it("picks Arabic plural forms (one, two, few, many)", () => {
    setLocale("ar");
    const forms = [1, 2, 3, 11].map((n) => tn("common.cards", n));
    expect(new Set(forms).size).toBe(4);
  });

  it("pluralizes forecast summary cleanly in English and Arabic", () => {
    expect(tn("stats.forecast.summary", 1)).toBe("1 card due in the next 30 days");
    expect(tn("stats.forecast.summary", 5)).toBe("5 cards due in the next 30 days");

    setLocale("ar");
    const forms = [0, 1, 2, 3, 11].map((n) => tn("stats.forecast.summary", n));
    expect(new Set(forms).size).toBe(5);
  });

  it("14d: pluralizes Cycle 2 game/scholar streak and backfill keys across all 6 Arabic forms", () => {
    setLocale("ar");
    for (const base of [
      "game.hud.streak",
      "scholar.hud.streak",
      "game.depth.backfill.banner",
    ] as const) {
      const forms = [0, 1, 2, 3, 11, 100].map((n) => tn(base, n));
      expect(new Set(forms).size, base).toBe(6);
    }
  });

  it("16d: pluralizes Cycle 3 motivation keys across all 6 Arabic forms", () => {
    setLocale("ar");
    for (const base of [
      "motivation.streak.dayCount",
      "motivation.quests.daysRemaining",
      "motivation.quests.tpl.reviews",
      "motivation.quests.tpl.minutes",
      "motivation.quests.tpl.newCards",
      "motivation.quests.tpl.tasks",
      "motivation.quests.tpl.habits",
      "motivation.quests.tpl.activeDays",
      "motivation.quests.tpl.planItems",
    ] as const) {
      const forms = [0, 1, 2, 3, 11, 100].map((n) => tn(base, n));
      expect(new Set(forms).size, base).toBe(6);
    }
    const monthlyForms = [0, 1, 2, 3, 11, 100].map((n) =>
      tn("motivation.quests.monthlyCount", n, { target: 20 }),
    );
    expect(new Set(monthlyForms).size).toBe(6);
  });

  it("uses consistent feminine agreement and SRS domain terms in Arabic", () => {
    expect(ar["settings.perm.fs_read"]).toContain("يمكنها");
    expect(ar["palette.addNote"]).toBe("إضافة ملاحظة");
    expect(ar["palette.noteTypes"]).toBe("إدارة أنواع الملاحظات");
    expect(ar["decks.emptyFailed"]).toContain("المُصفّاة");
    expect(ar["media.usageCount_zero"]).toBe("لا ملاحظات");
    expect(ar["stats.coach.viewInBrowse"]).toBe("عرض في التصفّح");
    expect(ar["browse.findDuplicates.openInBrowse"]).toBe("فتح في التصفّح");
    expect(ar["browse.findDuplicates.defaultTag"]).not.toBe("duplicate");
    expect(ar["matrix.roman.q1"]).not.toBe("I");
    expect(ar["matrix.roman.q2"]).not.toBe("II");
    expect(ar["matrix.roman.q3"]).not.toBe("III");
    expect(ar["matrix.roman.q4"]).not.toBe("IV");
    expect(ar["textImport.format.markdown"]).not.toBe("Markdown");
  });
});

describe("Arabic locale completeness", () => {
  const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

  it("has every English key, translated, with the same placeholders", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(ar[key], key).toBeTruthy();
      // Arabic dual/singular plural forms ("بطاقتان") may spell the number out.
      const needed = placeholders(en[key]).filter(
        (p) => !(p === "count" && /_(one|two)$/.test(key)),
      );
      for (const p of needed) expect(placeholders(ar[key]), key).toContain(p);
      for (const p of placeholders(ar[key])) expect(placeholders(en[key]), key).toContain(p);
    }
  });
});

describe("initialLocale auto-detection (UX2 A1)", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("preselects Arabic when any entry in navigator.languages starts with 'ar'", async () => {
    localStorage.clear();
    vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US", "ar-IQ"] });
    vi.resetModules();
    const mod = await import("./i18n");
    expect(mod.getLocale()).toBe("ar");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("lets a saved choice win over navigator.languages", async () => {
    localStorage.setItem("keepsake-locale", "en");
    vi.stubGlobal("navigator", { language: "ar-IQ", languages: ["ar-IQ"] });
    vi.resetModules();
    const mod = await import("./i18n");
    expect(mod.getLocale()).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("A5-15: splits en/ar locales and non-default font subsets out of the static entry bundle", () => {
    const srcRoot = path.resolve(__dirname, "..");
    const i18nSrc = fs.readFileSync(path.join(srcRoot, "lib/i18n.ts"), "utf8");
    const mainSrc = fs.readFileSync(path.join(srcRoot, "main.tsx"), "utf8");
    const itemTitleSrc = fs.readFileSync(path.join(srcRoot, "features/game/itemTitle.ts"), "utf8");
    const styleKeySrc = fs.readFileSync(path.join(srcRoot, "lib/styles/styleKey.ts"), "utf8");

    expect(i18nSrc).not.toMatch(
      /^\s*import\s*\{[^}]*\bar\b[^}]*\}\s*from\s*["']@\/locales\/ar["']/m,
    );
    expect(i18nSrc).not.toMatch(
      /^\s*import\s*\{[^}]*\ben\b[^}]*\}\s*from\s*["']@\/locales\/en["']/m,
    );
    expect(itemTitleSrc).not.toMatch(
      /^\s*import\s*\{[^}]*\ben\b[^}]*\}\s*from\s*["']@\/locales\/en["']/m,
    );
    expect(styleKeySrc).not.toMatch(
      /^\s*import\s*\{[^}]*\ben\b[^}]*\}\s*from\s*["']@\/locales\/en["']/m,
    );
    expect(mainSrc).not.toContain("@fontsource-variable/literata");
    expect(mainSrc).not.toContain("@fontsource-variable/handjet");
    expect(mainSrc).not.toContain("katex/dist/katex.min.css");
  });
});
