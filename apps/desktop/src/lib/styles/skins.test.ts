import { describe, expect, it } from "vitest";
import { getStyleSkin } from "./skins";

describe("style skin registry (14d)", () => {
  it("returns null for Default style", () => {
    expect(getStyleSkin("default")).toBeNull();
  });

  it("provides Game rank brackets, HUD config, and celebration config", () => {
    const skin = getStyleSkin("game");
    expect(skin).not.toBeNull();
    expect(skin!.rankForLevel(1).labelKey).toBe("game.rank.novice");
    expect(skin!.rankForLevel(4).labelKey).toBe("game.rank.novice");
    expect(skin!.rankForLevel(5).labelKey).toBe("game.rank.apprentice");
    expect(skin!.rankForLevel(10).labelKey).toBe("game.rank.explorer");
    expect(skin!.rankForLevel(20).labelKey).toBe("game.rank.champion");
    expect(skin!.rankForLevel(35).labelKey).toBe("game.rank.legend");

    expect(skin!.hud.showFreezes).toBe(true);
    expect(skin!.hud.currencyUnit).toBe("gold");
    expect(skin!.hud.currencyLinkTo).toBe("/shop");
    expect(skin!.hud.freezeLinkTo).toBe("/plan/habits");
    expect(skin!.hud.avatarLinkTo).toBe("/character");
    expect(skin!.hud.levelFontClass).toBe("game-hud-level");
    expect(skin!.celebration.tierUpMode).toBe("game_rank");
  });

  it("provides Scholar academic titles, HUD config, and celebration config", () => {
    const skin = getStyleSkin("scholar");
    expect(skin).not.toBeNull();
    expect(skin!.rankForLevel(1).labelKey).toBe("progress.title.student");
    expect(skin!.rankForLevel(5).labelKey).toBe("progress.title.researcher");
    expect(skin!.rankForLevel(10).labelKey).toBe("progress.title.lecturer");
    expect(skin!.rankForLevel(20).labelKey).toBe("progress.title.assistantProfessor");
    expect(skin!.rankForLevel(35).labelKey).toBe("progress.title.professor");

    expect(skin!.hud.showFreezes).toBe(false);
    expect(skin!.hud.currencyUnit).toBe("knowledgePoints");
    expect(skin!.hud.avatarLinkTo).toBe("/character");
    expect(skin!.celebration.tierUpMode).toBe("scholar_certificate");
  });
});
