import type { AvatarProfileDto, EquipmentSlot, EquippedSlotDto } from "@bibalak/ipc-types";
import { getStyleSkin, type ActiveSkinId } from "@/lib/styles/skins";

export type AvatarLayerSlot =
  | "backdrop"
  | "back"
  | "body"
  | "outfit"
  | "hair"
  | "accessory"
  | "head"
  | "off_hand"
  | "main_hand"
  | "pet"
  | "mount"
  | "frame";

export interface ResolvedAvatarLayer {
  slot: AvatarLayerSlot;
  zIndex: number;
  source: "common" | "game" | "scholar";
  itemKey: string;
  hairColor?: string;
}

export const AVATAR_LAYER_ORDER: ReadonlyArray<AvatarLayerSlot> = [
  "backdrop",
  "back",
  "body",
  "outfit",
  "hair",
  "accessory",
  "head",
  "off_hand",
  "main_hand",
  "pet",
  "mount",
  "frame",
];

export const DEFAULT_AVATAR_PROFILE: AvatarProfileDto = {
  body_tone: "tone_2",
  hair_style: "hair_1",
  hair_color: "brown",
  starter_outfit: "tunic_slate",
  starter_accessory: "none",
};

export const HIDE_HAIR_ITEM_KEYS = new Set<string>(["head_hood_scholar"]);
export const TWO_HANDED_ITEM_KEYS = new Set<string>(["hand_staff_quill"]);

export interface ResolveAvatarLayersInput {
  style: ActiveSkinId;
  level?: number;
  profile?: AvatarProfileDto | null;
  equipped?: EquippedSlotDto[] | null;
  /** Reserved for 14e (R4-3) pets & mounts */
  pet?: { speciesKey: string; variantKey: string } | null;
  mounted?: boolean;
  /** Optional explicit frame key override (falls back to equipped `frame` slot) */
  frameKey?: string | null;
}

function equippedMapFrom(equipped?: EquippedSlotDto[] | null): Map<EquipmentSlot, string> {
  const map = new Map<EquipmentSlot, string>();
  if (!equipped) return map;
  for (const entry of equipped) {
    if (entry.item_key) {
      map.set(entry.slot, entry.item_key);
    }
  }
  return map;
}

/**
 * Deterministically resolve the ordered SVG paper-doll layers for `<AvatarStage />`
 * (spec 14a §4.2, and reserved 15a pet/mount/frame slots).
 */
export function resolveAvatarLayers({
  style,
  level = 1,
  profile: rawProfile,
  equipped,
  pet,
  mounted = false,
  frameKey,
}: ResolveAvatarLayersInput): ResolvedAvatarLayer[] {
  const profile = rawProfile ?? DEFAULT_AVATAR_PROFILE;
  const skin = getStyleSkin(style);
  const layers: ResolvedAvatarLayer[] = [];

  if (style === "scholar") {
    const regalia = skin?.avatar.outfitForLevel(level) ?? { outfit: "scholar_gown_student" };
    layers.push({
      slot: "backdrop",
      zIndex: 1,
      source: "common",
      itemKey: skin?.avatar.backdropKey ?? "backdrop_scholar_library",
    });
    if (regalia.back) {
      layers.push({
        slot: "back",
        zIndex: 2,
        source: "scholar",
        itemKey: regalia.back,
      });
    }
    layers.push({
      slot: "body",
      zIndex: 3,
      source: "common",
      itemKey: profile.body_tone,
    });
    layers.push({
      slot: "outfit",
      zIndex: 4,
      source: "scholar",
      itemKey: regalia.outfit,
    });
    layers.push({
      slot: "hair",
      zIndex: 5,
      source: "common",
      itemKey: profile.hair_style,
      hairColor: profile.hair_color,
    });
    if (profile.starter_accessory && profile.starter_accessory !== "none") {
      layers.push({
        slot: "accessory",
        zIndex: 6,
        source: "common",
        itemKey: profile.starter_accessory,
      });
    }
    if (regalia.head) {
      layers.push({
        slot: "head",
        zIndex: 7,
        source: "scholar",
        itemKey: regalia.head,
      });
    }
    return layers;
  }

  // Game style: equipment overrides starter appearance
  const eq = equippedMapFrom(equipped);
  const backdrop = eq.get("backdrop") ?? skin?.avatar.backdropKey ?? "backdrop_lamp";
  const back = eq.get("back");
  const outfit = eq.get("outfit");
  const accessory = eq.get("accessory") ?? profile.starter_accessory;
  const head = eq.get("head");
  const mainHand = eq.get("main_hand");
  const offHand = eq.get("off_hand");
  const frame = frameKey ?? eq.get("frame");

  const hideHair = Boolean(head && HIDE_HAIR_ITEM_KEYS.has(head));
  const twoHanded = Boolean(mainHand && TWO_HANDED_ITEM_KEYS.has(mainHand));

  layers.push({
    slot: "backdrop",
    zIndex: 1,
    source: "common",
    itemKey: backdrop,
  });

  if (back) {
    layers.push({
      slot: "back",
      zIndex: 2,
      source: "game",
      itemKey: back,
    });
  }

  layers.push({
    slot: "body",
    zIndex: 3,
    source: "common",
    itemKey: profile.body_tone,
  });

  layers.push({
    slot: "outfit",
    zIndex: 4,
    source: outfit ? "game" : "common",
    itemKey: outfit ?? profile.starter_outfit,
  });

  if (!hideHair) {
    layers.push({
      slot: "hair",
      zIndex: 5,
      source: "common",
      itemKey: profile.hair_style,
      hairColor: profile.hair_color,
    });
  }

  if (accessory && accessory !== "none") {
    layers.push({
      slot: "accessory",
      zIndex: 6,
      source: eq.has("accessory") ? "game" : "common",
      itemKey: accessory,
    });
  }

  if (head) {
    layers.push({
      slot: "head",
      zIndex: 7,
      source: "game",
      itemKey: head,
    });
  }

  if (offHand && !twoHanded) {
    layers.push({
      slot: "off_hand",
      zIndex: 8,
      source: "game",
      itemKey: offHand,
    });
  }

  if (mainHand) {
    layers.push({
      slot: "main_hand",
      zIndex: 9,
      source: "game",
      itemKey: mainHand,
    });
  }

  // Reserved slots for 14e (R4-3): pet / mount / frame
  if (pet) {
    layers.push({
      slot: mounted ? "mount" : "pet",
      zIndex: mounted ? 11 : 10,
      source: "game",
      itemKey: `${pet.speciesKey}:${pet.variantKey}`,
    });
  }

  if (frame) {
    layers.push({
      slot: "frame",
      zIndex: 12,
      source: "game",
      itemKey: frame,
    });
  }

  return layers;
}
