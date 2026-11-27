import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AvatarProfileDto, EquippedSlotDto } from "@bibalak/ipc-types";
import { AvatarStage } from "./AvatarStage";
import { DEFAULT_AVATAR_PROFILE, resolveAvatarLayers } from "@/features/game/avatarLayers";

const SAMPLE_PROFILE: AvatarProfileDto = {
  body_tone: "tone_3",
  hair_style: "hair_2",
  hair_color: "indigo",
  starter_outfit: "tunic_slate",
  starter_accessory: "acc_glasses",
};

describe("AvatarStage & resolveAvatarLayers (14d)", () => {
  afterEach(() => {
    document.documentElement.dir = "ltr";
  });

  it("renders deterministic layer order on a 16x16 grid with integer sizes and no RTL flip", () => {
    document.documentElement.dir = "rtl";
    const equipped: EquippedSlotDto[] = [
      { slot: "back", item_key: "back_cape_crimson" },
      { slot: "outfit", item_key: "outfit_cloak_green" },
      { slot: "off_hand", item_key: "off_lantern_warm" },
      { slot: "main_hand", item_key: "hand_wand_oak" },
    ];

    for (const size of [32, 64, 128, 192] as const) {
      const { unmount } = render(
        <AvatarStage style="game" size={size} profile={SAMPLE_PROFILE} equipped={equipped} />,
      );
      const stage = screen.getByTestId("avatar-stage");
      expect(stage).toHaveAttribute("dir", "ltr");
      expect(stage.style.width).toBe(`${size}px`);
      expect(stage.style.height).toBe(`${size}px`);
      expect(stage.className).not.toContain("-scale-x-100");
      expect(stage.style.transform).not.toContain("scaleX(-1)");

      const svgs = stage.querySelectorAll("svg[data-layer]");
      const layerNames = Array.from(svgs).map((el) => el.getAttribute("data-layer"));
      expect(layerNames).toEqual([
        "backdrop",
        "back",
        "body",
        "outfit",
        "hair",
        "accessory",
        "off_hand",
        "main_hand",
      ]);
      for (const svg of svgs) {
        expect(svg).toHaveAttribute("viewBox", "0 0 16 16");
      }
      unmount();
    }
  });

  it("hides hair when hide_hair head item is equipped and hides off_hand when two-handed main_hand is equipped", () => {
    const equipped: EquippedSlotDto[] = [
      { slot: "head", item_key: "head_hood_scholar" },
      { slot: "main_hand", item_key: "hand_staff_quill" },
      { slot: "off_hand", item_key: "off_lantern_warm" },
    ];

    const layers = resolveAvatarLayers({
      style: "game",
      profile: DEFAULT_AVATAR_PROFILE,
      equipped,
    });
    const keys = layers.map((l) => l.slot);
    expect(keys).toContain("head");
    expect(keys).toContain("main_hand");
    expect(keys).not.toContain("hair");
    expect(keys).not.toContain("off_hand");
  });

  it("maps Scholar outfit layers by academic title while keeping body and hair from avatar_profile", () => {
    const student = resolveAvatarLayers({ style: "scholar", level: 1, profile: SAMPLE_PROFILE });
    expect(student.find((l) => l.slot === "body")?.itemKey).toBe("tone_3");
    expect(student.find((l) => l.slot === "hair")?.itemKey).toBe("hair_2");
    expect(student.find((l) => l.slot === "outfit")?.itemKey).toBe("scholar_gown_student");
    expect(student.find((l) => l.slot === "back")).toBeUndefined();
    expect(student.find((l) => l.slot === "head")).toBeUndefined();

    const researcher = resolveAvatarLayers({ style: "scholar", level: 5, profile: SAMPLE_PROFILE });
    expect(researcher.find((l) => l.slot === "back")?.itemKey).toBe("scholar_satchel");
    expect(researcher.find((l) => l.slot === "outfit")?.itemKey).toBe("scholar_gown_student");

    const lecturer = resolveAvatarLayers({ style: "scholar", level: 10, profile: SAMPLE_PROFILE });
    expect(lecturer.find((l) => l.slot === "outfit")?.itemKey).toBe("scholar_gown_lecturer");
    expect(lecturer.find((l) => l.slot === "head")).toBeUndefined();

    const assistantProf = resolveAvatarLayers({
      style: "scholar",
      level: 20,
      profile: SAMPLE_PROFILE,
    });
    expect(assistantProf.find((l) => l.slot === "head")?.itemKey).toBe("scholar_cap");

    const professor = resolveAvatarLayers({ style: "scholar", level: 35, profile: SAMPLE_PROFILE });
    expect(professor.find((l) => l.slot === "outfit")?.itemKey).toBe("scholar_robe_professor");
    expect(professor.find((l) => l.slot === "head")?.itemKey).toBe("scholar_cap");
  });

  it("draws the active pet or mount in the stage (review 14e)", () => {
    const { container, rerender } = render(
      <AvatarStage style="game" size={64} pet={{ speciesKey: "owl", variantKey: "classic" }} />,
    );
    expect(container.querySelector('[data-layer="pet"]')).not.toBeNull();

    rerender(
      <AvatarStage
        style="game"
        size={64}
        pet={{ speciesKey: "owl", variantKey: "classic" }}
        mounted
      />,
    );
    expect(container.querySelector('[data-layer="pet"]')).toBeNull();
    expect(screen.getByTestId("avatar-stage").querySelectorAll("svg").length).toBeGreaterThan(1);
  });

  it("GAME-AVATAR: DEFAULT_AVATAR_PROFILE matches Rust AvatarProfileDto::default()", () => {
    expect(DEFAULT_AVATAR_PROFILE).toEqual({
      body_tone: "tone_2",
      hair_style: "hair_1",
      hair_color: "brown",
      starter_outfit: "tunic_slate",
      starter_accessory: "none",
    });
  });
});
