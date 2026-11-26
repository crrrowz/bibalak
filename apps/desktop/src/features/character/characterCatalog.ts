import type { EquipmentSlot } from "@bibalak/ipc-types";
import type { LocaleKey } from "@/locales/en";

export const SKIN_TONES: ReadonlyArray<{ id: string; hex: string; n: number }> = [
  { id: "tone_1", hex: "#FCE0C8", n: 1 },
  { id: "tone_2", hex: "#F2C6A0", n: 2 },
  { id: "tone_3", hex: "#DDA576", n: 3 },
  { id: "tone_4", hex: "#B87A4F", n: 4 },
  { id: "tone_5", hex: "#8C5432", n: 5 },
  { id: "tone_6", hex: "#5C3520", n: 6 },
];

export const HAIR_STYLES: ReadonlyArray<string> = [
  "hair_1",
  "hair_2",
  "hair_3",
  "hair_4",
  "hair_5",
  "hair_6",
];

export const HAIR_COLORS: ReadonlyArray<{ id: string; hex: string; labelKey: LocaleKey }> = [
  { id: "black", hex: "#23202A", labelKey: "game.character.hairColor.black" },
  { id: "brown", hex: "#5B3B26", labelKey: "game.character.hairColor.brown" },
  { id: "auburn", hex: "#8E3A24", labelKey: "game.character.hairColor.auburn" },
  { id: "blonde", hex: "#D4A74A", labelKey: "game.character.hairColor.blonde" },
  { id: "silver", hex: "#9EA6B8", labelKey: "game.character.hairColor.silver" },
  { id: "indigo", hex: "#3E3F8C", labelKey: "game.character.hairColor.indigo" },
];

export const STARTER_OUTFITS: ReadonlyArray<{ id: string; hex: string; labelKey: LocaleKey }> = [
  { id: "tunic_slate", hex: "#4D556E", labelKey: "game.character.tunic.slate" },
  { id: "tunic_forest", hex: "#2E6A4E", labelKey: "game.character.tunic.forest" },
  { id: "tunic_ochre", hex: "#A66A2B", labelKey: "game.character.tunic.ochre" },
];

export const STARTER_ACCESSORIES: ReadonlyArray<{ id: string; labelKey: LocaleKey }> = [
  { id: "none", labelKey: "game.character.accessory.none" },
  { id: "acc_glasses", labelKey: "game.character.accessory.glasses" },
  { id: "acc_headband", labelKey: "game.character.accessory.headband" },
  { id: "acc_kerchief", labelKey: "game.character.accessory.kerchief" },
];

export const EQUIPMENT_SLOTS: ReadonlyArray<{ slot: EquipmentSlot; labelKey: LocaleKey }> = [
  { slot: "head", labelKey: "game.slot.head" },
  { slot: "outfit", labelKey: "game.slot.outfit" },
  { slot: "main_hand", labelKey: "game.slot.main_hand" },
  { slot: "off_hand", labelKey: "game.slot.off_hand" },
  { slot: "back", labelKey: "game.slot.back" },
  { slot: "accessory", labelKey: "game.slot.accessory" },
  { slot: "backdrop", labelKey: "game.slot.backdrop" },
  { slot: "frame", labelKey: "game.slot.frame" },
];

export const SLOT_LABEL_MAP: Record<EquipmentSlot, LocaleKey> = {
  head: "game.slot.head",
  outfit: "game.slot.outfit",
  main_hand: "game.slot.main_hand",
  off_hand: "game.slot.off_hand",
  back: "game.slot.back",
  accessory: "game.slot.accessory",
  backdrop: "game.slot.backdrop",
  frame: "game.slot.frame",
};

export const GAME_ITEM_LOCALE: Record<string, LocaleKey> = {
  head_hood_scholar: "game.item.head_hood_scholar",
  head_hat_adventurer: "game.item.head_hat_adventurer",
  head_circlet_brass: "game.item.head_circlet_brass",
  head_crown_star: "game.item.head_crown_star",
  outfit_cloak_green: "game.item.outfit_cloak_green",
  outfit_coat_guild: "game.item.outfit_coat_guild",
  outfit_robe_velvet: "game.item.outfit_robe_velvet",
  outfit_tunic_royal: "game.item.outfit_tunic_royal",
  hand_wand_oak: "game.item.hand_wand_oak",
  hand_compass_brass: "game.item.hand_compass_brass",
  hand_staff_quill: "game.item.hand_staff_quill",
  hand_sabre_guild: "game.item.hand_sabre_guild",
  off_lantern_warm: "game.item.off_lantern_warm",
  off_buckler_oak: "game.item.off_buckler_oak",
  off_tome_runed: "game.item.off_tome_runed",
  back_satchel_canvas: "game.item.back_satchel_canvas",
  back_cape_crimson: "game.item.back_cape_crimson",
  back_mantle_star: "game.item.back_mantle_star",
  acc_monocle_amber: "game.item.acc_monocle_amber",
  acc_scarf_stripe: "game.item.acc_scarf_stripe",
  acc_pin_laurel: "game.item.acc_pin_laurel",
  bg_night_library: "game.item.bg_night_library",
  bg_mountain_camp: "game.item.bg_mountain_camp",
  bg_observatory: "game.item.bg_observatory",
  frame_copper_ring: "game.item.frame_copper_ring",
  frame_path_vanguard: "game.item.frame_path_vanguard",
  frame_path_sage: "game.item.frame_path_sage",
  frame_path_scout: "game.item.frame_path_scout",
  frame_path_artisan: "game.item.frame_path_artisan",
  backdrop_study_hearth: "game.item.backdrop_study_hearth",
};

/** Infer equipment slot for unlockable cosmetics not listed in the shop catalog. */
export function inferSlotFromItemKey(itemKey: string): EquipmentSlot | null {
  if (itemKey.startsWith("head_")) return "head";
  if (itemKey.startsWith("outfit_")) return "outfit";
  if (itemKey.startsWith("hand_")) return "main_hand";
  if (itemKey.startsWith("off_")) return "off_hand";
  if (itemKey.startsWith("back_")) return "back";
  if (itemKey.startsWith("acc_")) return "accessory";
  if (itemKey.startsWith("bg_") || itemKey.startsWith("backdrop_")) return "backdrop";
  if (itemKey.startsWith("frame_")) return "frame";
  return null;
}
