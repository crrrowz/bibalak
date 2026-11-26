import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WCAG AA contrast for the theme tokens in globals.css (light `:root` and
 * `.dark`). Text pairs need 4.5:1; the review buttons render white labels on
 * their semantic fill, so those need 4.5:1 against white too.
 */
const css = readFileSync(resolve(process.cwd(), "src/styles/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return {};
  const end = css.indexOf("\n  }", start);
  const body = css.slice(start, end === -1 ? undefined : end);
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

function hslToRgb(triplet: string): [number, number, number] {
  const [h, s, l] = triplet
    .split("/")[0]
    .trim()
    .split(/\s+/)
    .map((v) => parseFloat(v));
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

function luminance([r, g, b]: [number, number, number]) {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string) {
  const [l1, l2] = [luminance(hslToRgb(a)), luminance(hslToRgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const light = block(":root");
const dark = { ...light, ...block(".dark") };
const scholarLightRaw = block('[data-style="scholar"]');
const scholarDarkRaw = block('[data-style="scholar"].dark');
const scholarLight = { ...light, ...scholarLightRaw };
const scholarDark = { ...dark, ...scholarLightRaw, ...scholarDarkRaw };
const gameLightRaw = block('[data-style="game"]');
const gameDarkRaw = block('[data-style="game"].dark');
const gameLight = { ...light, ...gameLightRaw };
const gameDark = { ...dark, ...gameLightRaw, ...gameDarkRaw };
const WHITE = "0 0% 100%";

const textPairs: Array<[string, string]> = [
  ["foreground", "background"],
  ["muted-foreground", "background"],
  ["card-foreground", "card"],
  ["muted-foreground", "card"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["sidebar-foreground", "sidebar"],
  ["destructive-foreground", "destructive"],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme", (_name, t) => {
  it.each(textPairs)("%s on %s meets 4.5:1", (fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["again", "hard", "good", "easy"])("white label on %s meets 4.5:1", (k) => {
    expect(contrast(WHITE, t[k])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Scholar presentation style tokens", () => {
  it("defines [data-style='scholar'] and [data-style='scholar'].dark overrides", () => {
    expect(css).toContain('[data-style="scholar"] {');
    expect(css).toContain('[data-style="scholar"].dark {');
    expect(scholarLightRaw.background).toBeTruthy();
    expect(scholarLightRaw.foreground).toBeTruthy();
    expect(scholarLightRaw.primary).toBeTruthy();
    expect(scholarLightRaw["scholar-accent"]).toBeTruthy();
    expect(scholarLightRaw.border).toBeTruthy();
    expect(scholarLightRaw.radius).toBe("0.5rem");
    expect(scholarDarkRaw.background).toBeTruthy();
    expect(scholarDarkRaw.card).toBeTruthy();
    expect(scholarDarkRaw.foreground).toBeTruthy();
    expect(scholarDarkRaw.primary).toBeTruthy();
    expect(scholarDarkRaw["scholar-accent"]).toBeTruthy();
  });

  it("does not override rating, destructive, or focus ring tokens", () => {
    for (const raw of [scholarLightRaw, scholarDarkRaw]) {
      for (const forbidden of [
        "again",
        "hard",
        "good",
        "easy",
        "destructive",
        "destructive-foreground",
        "ring",
      ]) {
        expect(raw[forbidden]).toBeUndefined();
      }
    }
  });

  it("configures Literata and Amiri serif fonts for Scholar headings only", () => {
    expect(css).toMatch(/\[data-style="scholar"\]\s+h1/);
    expect(css).toContain("Literata Variable");
    expect(css).toContain("Amiri");
  });

  describe.each([
    ["scholar light", scholarLight],
    ["scholar dark", scholarDark],
  ])("%s theme", (_name, t) => {
    it.each([
      ...textPairs,
      ["accent-foreground", "accent"] as [string, string],
      ["scholar-accent", "background"] as [string, string],
      ["scholar-accent", "card"] as [string, string],
      ["scholar-accent-foreground", "scholar-accent"] as [string, string],
    ])("%s on %s meets 4.5:1", (fg, bg) => {
      expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
    });

    it.each(["again", "hard", "good", "easy"])("white label on %s meets 4.5:1", (k) => {
      expect(contrast(WHITE, t[k])).toBeGreaterThanOrEqual(4.5);
    });
  });
});

describe("Game presentation style tokens", () => {
  it("defines [data-style='game'] and [data-style='game'].dark overrides", () => {
    expect(css).toContain('[data-style="game"] {');
    expect(css).toContain('[data-style="game"].dark {');
    expect(gameLightRaw.background).toBeTruthy();
    expect(gameLightRaw.foreground).toBeTruthy();
    expect(gameLightRaw.primary).toBeTruthy();
    expect(gameLightRaw["game-gold"]).toBeTruthy();
    expect(gameLightRaw["game-xp"]).toBeTruthy();
    expect(gameLightRaw["game-freeze"]).toBeTruthy();
    expect(gameLightRaw.border).toBeTruthy();
    expect(gameLightRaw.radius).toBe("0.625rem");
    expect(gameDarkRaw.background).toBeTruthy();
    expect(gameDarkRaw.card).toBeTruthy();
    expect(gameDarkRaw.foreground).toBeTruthy();
    expect(gameDarkRaw.primary).toBeTruthy();
    expect(gameDarkRaw["game-gold"]).toBeTruthy();
    expect(gameDarkRaw["game-xp"]).toBeTruthy();
    expect(gameDarkRaw["game-freeze"]).toBeTruthy();
  });

  it("does not override rating, destructive, or focus ring tokens", () => {
    for (const raw of [gameLightRaw, gameDarkRaw]) {
      for (const forbidden of [
        "again",
        "hard",
        "good",
        "easy",
        "destructive",
        "destructive-foreground",
        "ring",
      ]) {
        expect(raw[forbidden]).toBeUndefined();
      }
    }
  });

  it("configures Handjet Variable font for Game headings and .game-hud-level only", () => {
    expect(css).toMatch(/\[data-style="game"\]\s+h1/);
    expect(css).toMatch(/\[data-style="game"\]\s+\.game-hud-level/);
    expect(css).toContain("Handjet Variable");
  });

  describe.each([
    ["game light", gameLight],
    ["game dark", gameDark],
  ])("%s theme", (_name, t) => {
    it.each([
      ...textPairs,
      ["accent-foreground", "accent"] as [string, string],
      ["game-gold", "card"] as [string, string],
      ["game-gold-foreground", "game-gold"] as [string, string],
      ["game-xp", "card"] as [string, string],
      ["game-freeze", "card"] as [string, string],
      ["game-freeze-foreground", "game-freeze"] as [string, string],
    ])("%s on %s meets 4.5:1", (fg, bg) => {
      expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
    });

    it.each(["again", "hard", "good", "easy"])("white label on %s meets 4.5:1", (k) => {
      expect(contrast(WHITE, t[k])).toBeGreaterThanOrEqual(4.5);
    });
  });
});
