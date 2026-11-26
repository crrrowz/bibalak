import type { GamePathId } from "@bibalak/ipc-types";
import type { PetSpecies, PetVariant } from "@/components/avatar/layers/game/pets";
import type { LocaleKey } from "@/locales/en";

export const BACKFILL_BANNER_SEEN_KEY = "keepsake-game-backfill-seen";
export const MAX_PET_BOND = 50;
export const PATH_UNLOCK_LEVEL = 10;

export const PET_SPECIES_LOCALE: Record<PetSpecies, LocaleKey> = {
  owl: "game.depth.pets.owl",
  fox: "game.depth.pets.fox",
  falcon: "game.depth.pets.falcon",
  lynx: "game.depth.pets.lynx",
  otter: "game.depth.pets.otter",
  starling: "game.depth.pets.starling",
  turtle: "game.depth.pets.turtle",
  stag: "game.depth.pets.stag",
  automaton: "game.depth.pets.automaton",
};

export const PET_VARIANT_LOCALE: Record<PetVariant, LocaleKey> = {
  classic: "game.depth.variant.classic",
  gilded: "game.depth.variant.gilded",
  midnight: "game.depth.variant.midnight",
  verdant: "game.depth.variant.verdant",
};

export interface GamePathMeta {
  id: GamePathId;
  nameKey: LocaleKey;
  titleKey: LocaleKey;
  motifKey: LocaleKey;
  frameItemKey: LocaleKey;
  accentHex: string;
}

export const GAME_PATHS: ReadonlyArray<GamePathMeta> = [
  {
    id: "vanguard",
    nameKey: "game.depth.paths.vanguard.name",
    titleKey: "game.depth.paths.vanguard.title",
    motifKey: "game.depth.paths.vanguard.motif",
    frameItemKey: "game.item.frame_path_vanguard",
    accentHex: "#B91C1C",
  },
  {
    id: "sage",
    nameKey: "game.depth.paths.sage.name",
    titleKey: "game.depth.paths.sage.title",
    motifKey: "game.depth.paths.sage.motif",
    frameItemKey: "game.item.frame_path_sage",
    accentHex: "#6D28D9",
  },
  {
    id: "scout",
    nameKey: "game.depth.paths.scout.name",
    titleKey: "game.depth.paths.scout.title",
    motifKey: "game.depth.paths.scout.motif",
    frameItemKey: "game.item.frame_path_scout",
    accentHex: "#0F766E",
  },
  {
    id: "artisan",
    nameKey: "game.depth.paths.artisan.name",
    titleKey: "game.depth.paths.artisan.title",
    motifKey: "game.depth.paths.artisan.motif",
    frameItemKey: "game.item.frame_path_artisan",
    accentHex: "#D97706",
  },
];

export const ACHIEVEMENT_CATEGORIES: ReadonlyArray<{
  id: string;
  labelKey: LocaleKey;
}> = [
  { id: "Onboarding", labelKey: "game.depth.ach.cat.Onboarding" },
  { id: "Memory", labelKey: "game.depth.ach.cat.Memory" },
  { id: "Mastery", labelKey: "game.depth.ach.cat.Mastery" },
  { id: "Consistency", labelKey: "game.depth.ach.cat.Consistency" },
  { id: "Tasks", labelKey: "game.depth.ach.cat.Tasks" },
  { id: "Milestones", labelKey: "game.depth.ach.cat.Milestones" },
  { id: "Collection", labelKey: "game.depth.ach.cat.Collection" },
];

export interface AchievementLocaleEntry {
  titleKey: LocaleKey;
  descKey: LocaleKey;
  scholarTitleKey?: LocaleKey;
  scholarDescKey?: LocaleKey;
}

export const ACHIEVEMENT_LOCALE_MAP: Record<string, AchievementLocaleEntry> = {
  "ach:first_review": {
    titleKey: "game.depth.ach.firstReview.title",
    descKey: "game.depth.ach.firstReview.desc",
  },
  "ach:first_task": {
    titleKey: "game.depth.ach.firstTask.title",
    descKey: "game.depth.ach.firstTask.desc",
    scholarTitleKey: "scholar.ach.firstTask.title",
  },
  "ach:first_habit": {
    titleKey: "game.depth.ach.firstHabit.title",
    descKey: "game.depth.ach.firstHabit.desc",
  },
  "ach:first_pet": {
    titleKey: "game.depth.ach.firstPet.title",
    descKey: "game.depth.ach.firstPet.desc",
    scholarTitleKey: "scholar.ach.firstPet.title",
    scholarDescKey: "scholar.ach.firstPet.desc",
  },
  "ach:reviews_50": {
    titleKey: "game.depth.ach.reviews50.title",
    descKey: "game.depth.ach.reviews50.desc",
  },
  "ach:reviews_250": {
    titleKey: "game.depth.ach.reviews250.title",
    descKey: "game.depth.ach.reviews250.desc",
  },
  "ach:reviews_1000": {
    titleKey: "game.depth.ach.reviews1000.title",
    descKey: "game.depth.ach.reviews1000.desc",
  },
  "ach:reviews_5000": {
    titleKey: "game.depth.ach.reviews5000.title",
    descKey: "game.depth.ach.reviews5000.desc",
  },
  "ach:reviews_10000": {
    titleKey: "game.depth.ach.reviews10000.title",
    descKey: "game.depth.ach.reviews10000.desc",
  },
  "ach:mature_100": {
    titleKey: "game.depth.ach.mature100.title",
    descKey: "game.depth.ach.mature100.desc",
  },
  "ach:mature_500": {
    titleKey: "game.depth.ach.mature500.title",
    descKey: "game.depth.ach.mature500.desc",
  },
  "ach:decks_3": {
    titleKey: "game.depth.ach.decks3.title",
    descKey: "game.depth.ach.decks3.desc",
  },
  "ach:decks_10": {
    titleKey: "game.depth.ach.decks10.title",
    descKey: "game.depth.ach.decks10.desc",
  },
  "ach:streak_3": {
    titleKey: "game.depth.ach.streak3.title",
    descKey: "game.depth.ach.streak3.desc",
  },
  "ach:streak_7": {
    titleKey: "game.depth.ach.streak7.title",
    descKey: "game.depth.ach.streak7.desc",
  },
  "ach:streak_21": {
    titleKey: "game.depth.ach.streak21.title",
    descKey: "game.depth.ach.streak21.desc",
  },
  "ach:streak_60": {
    titleKey: "game.depth.ach.streak60.title",
    descKey: "game.depth.ach.streak60.desc",
  },
  "ach:study_days_30": {
    titleKey: "game.depth.ach.studyDays30.title",
    descKey: "game.depth.ach.studyDays30.desc",
  },
  "ach:tasks_10": {
    titleKey: "game.depth.ach.tasks10.title",
    descKey: "game.depth.ach.tasks10.desc",
  },
  "ach:tasks_50": {
    titleKey: "game.depth.ach.tasks50.title",
    descKey: "game.depth.ach.tasks50.desc",
  },
  "ach:tasks_250": {
    titleKey: "game.depth.ach.tasks250.title",
    descKey: "game.depth.ach.tasks250.desc",
  },
  "ach:level_5": {
    titleKey: "game.depth.ach.level5.title",
    descKey: "game.depth.ach.level5.desc",
    scholarTitleKey: "scholar.ach.level5.title",
  },
  "ach:level_10": {
    titleKey: "game.depth.ach.level10.title",
    descKey: "game.depth.ach.level10.desc",
    scholarTitleKey: "scholar.ach.level10.title",
    scholarDescKey: "scholar.ach.level10.desc",
  },
  "ach:first_mount": {
    titleKey: "game.depth.ach.firstMount.title",
    descKey: "game.depth.ach.firstMount.desc",
    scholarTitleKey: "scholar.ach.firstMount.title",
    scholarDescKey: "scholar.ach.firstMount.desc",
  },
  "ach:collect_5_pets": {
    titleKey: "game.depth.ach.collect5Pets.title",
    descKey: "game.depth.ach.collect5Pets.desc",
    scholarTitleKey: "scholar.ach.collect5Pets.title",
    scholarDescKey: "scholar.ach.collect5Pets.desc",
  },
};

export const COSMETIC_ITEM_LOCALE: Record<string, LocaleKey> = {
  frame_copper_ring: "game.item.frame_copper_ring",
  frame_path_vanguard: "game.item.frame_path_vanguard",
  frame_path_sage: "game.item.frame_path_sage",
  frame_path_scout: "game.item.frame_path_scout",
  frame_path_artisan: "game.item.frame_path_artisan",
  backdrop_study_hearth: "game.item.backdrop_study_hearth",
};
