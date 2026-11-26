import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DESKTOP_ROOT = path.resolve(__dirname, "../..");

const LAZY_SCREEN_NAMES = [
  "AddScreen",
  "BrowseScreen",
  "StatsScreen",
  "SettingsScreen",
  "NotetypeScreen",
  "MediaLibraryScreen",
  "QuickAddScreen",
  "AssistantScreen",
  "GenerateCardsScreen",
  "QualityReviewScreen",
  "TranscriptScreen",
  "CharacterScreen",
  "ShopScreen",
  "StreakScreen",
  "QuestsScreen",
  "EisenhowerMatrixScreen",
  "HabitTrackerScreen",
  "CalendarScreen",
];

describe("JS code splitting guard (H3)", () => {
  it("lazy-loads secondary routes in src/app/router.tsx instead of eager static imports", () => {
    const routerSrc = fs.readFileSync(path.join(DESKTOP_ROOT, "src/app/router.tsx"), "utf8");

    for (const screen of LAZY_SCREEN_NAMES) {
      const staticImport = new RegExp(
        `^import\\s+\\{[^}]*\\b${screen}\\b[^}]*\\}\\s+from\\s+`,
        "m",
      );
      expect(
        staticImport.test(routerSrc),
        `${screen} must be lazy-loaded in router.tsx, not statically imported`,
      ).toBe(false);
    }

    expect(routerSrc).toContain("lazy(");
  });

  it("configures manualChunks in vite.config.ts", () => {
    const viteSrc = fs.readFileSync(path.join(DESKTOP_ROOT, "vite.config.ts"), "utf8");
    expect(viteSrc).toContain("manualChunks");
  });
});
