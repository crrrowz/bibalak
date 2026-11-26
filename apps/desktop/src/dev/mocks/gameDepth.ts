import type {
  AchievementStatusDto,
  BackfillOutcomeDto,
  GameDepthStateDto,
  GamePathId,
  PetProgressDto,
} from "@bibalak/ipc-types";

const ACHIEVEMENT_DEFINITIONS: ReadonlyArray<{
  key: string;
  category: string;
  tier: number;
  target: number;
  badge: string;
}> = [
  { key: "ach:first_review", category: "Onboarding", tier: 1, target: 1, badge: "badge_spark" },
  { key: "ach:first_task", category: "Onboarding", tier: 1, target: 1, badge: "badge_check" },
  { key: "ach:first_habit", category: "Onboarding", tier: 1, target: 1, badge: "badge_sprout" },
  { key: "ach:first_pet", category: "Onboarding", tier: 1, target: 1, badge: "badge_paw" },
  { key: "ach:reviews_50", category: "Memory", tier: 1, target: 50, badge: "badge_cards_bronze" },
  {
    key: "ach:reviews_250",
    category: "Memory",
    tier: 2,
    target: 250,
    badge: "badge_cards_silver",
  },
  {
    key: "ach:reviews_1000",
    category: "Memory",
    tier: 2,
    target: 1000,
    badge: "badge_cards_gold",
  },
  { key: "ach:reviews_5000", category: "Memory", tier: 3, target: 5000, badge: "badge_archive" },
  {
    key: "ach:reviews_10000",
    category: "Memory",
    tier: 3,
    target: 10000,
    badge: "badge_crown_recall",
  },
  { key: "ach:mature_100", category: "Mastery", tier: 2, target: 100, badge: "badge_tree_silver" },
  { key: "ach:mature_500", category: "Mastery", tier: 3, target: 500, badge: "badge_tree_gold" },
  { key: "ach:decks_3", category: "Mastery", tier: 1, target: 3, badge: "badge_compass" },
  { key: "ach:decks_10", category: "Mastery", tier: 2, target: 10, badge: "badge_bookshelf" },
  { key: "ach:streak_3", category: "Consistency", tier: 1, target: 3, badge: "badge_flame_1" },
  { key: "ach:streak_7", category: "Consistency", tier: 1, target: 7, badge: "badge_flame_2" },
  { key: "ach:streak_21", category: "Consistency", tier: 2, target: 21, badge: "badge_flame_3" },
  { key: "ach:streak_60", category: "Consistency", tier: 3, target: 60, badge: "badge_sun" },
  {
    key: "ach:study_days_30",
    category: "Consistency",
    tier: 2,
    target: 30,
    badge: "badge_calendar_gold",
  },
  { key: "ach:tasks_10", category: "Tasks", tier: 1, target: 10, badge: "badge_scroll_1" },
  { key: "ach:tasks_50", category: "Tasks", tier: 2, target: 50, badge: "badge_scroll_2" },
  { key: "ach:tasks_250", category: "Tasks", tier: 3, target: 250, badge: "badge_scroll_3" },
  { key: "ach:level_5", category: "Milestones", tier: 1, target: 5, badge: "badge_star_bronze" },
  { key: "ach:level_10", category: "Milestones", tier: 2, target: 10, badge: "badge_crest" },
  { key: "ach:first_mount", category: "Collection", tier: 2, target: 1, badge: "badge_saddle" },
  {
    key: "ach:collect_5_pets",
    category: "Collection",
    tier: 3,
    target: 5,
    badge: "badge_menagerie",
  },
];

function buildAchievements(earnedCount: number): AchievementStatusDto[] {
  const now = Date.now() - 86_400_000;
  return ACHIEVEMENT_DEFINITIONS.map((def, idx) => {
    const unlocked = idx < earnedCount;
    return {
      achievement_key: def.key,
      category: def.category,
      tier: def.tier,
      unlocked,
      earned_at: unlocked ? now - (earnedCount - idx) * 3_600_000 : null,
      current_value: unlocked ? def.target : Math.max(0, Math.floor(def.target * 0.4)),
      target_value: def.target,
      badge_ref: def.badge,
    };
  });
}

function makePet(
  id: string,
  species_key: string,
  variant_key: string,
  growth_points: number,
  is_active = false,
  is_mounted = false,
): PetProgressDto {
  return {
    id,
    species_key,
    variant_key,
    growth_points,
    mount_unlocked: growth_points >= 50,
    is_active,
    is_mounted,
  };
}

export const mockGameDepthStarter: GameDepthStateDto = {
  level: 4,
  chosen_path: null,
  path_chosen_at: null,
  path_switch_gold_cents: 10_000,
  active_pet_id: "pet-owl-classic",
  mounted: false,
  pets: [
    makePet("pet-owl-classic", "owl", "classic", 18, true, false),
    makePet("pet-fox-classic", "fox", "classic", 0, false, false),
  ],
  achievements: buildAchievements(4),
  unseen_unlocks: [],
  backfill_applied: true,
};

export const mockGameDepthLv10: GameDepthStateDto = {
  level: 12,
  chosen_path: "sage",
  path_chosen_at: Date.now() - 172_800_000,
  path_switch_gold_cents: 10_000,
  active_pet_id: "pet-owl-classic",
  mounted: true,
  pets: [
    makePet("pet-owl-classic", "owl", "classic", 50, true, true),
    makePet("pet-fox-classic", "fox", "classic", 22, false, false),
    makePet("pet-lynx-classic", "lynx", "classic", 10, false, false),
    makePet("pet-stag-classic", "stag", "classic", 4, false, false),
  ],
  achievements: buildAchievements(11),
  unseen_unlocks: [
    {
      id: "unlock-preview-1",
      kind: "achievement",
      key: "ach:level_10",
      reward_ref: "badge_crest",
      unlocked_at: Date.now() - 60_000,
    },
  ],
  backfill_applied: true,
};

export const mockGameDepthCollector: GameDepthStateDto = {
  level: 36,
  chosen_path: "artisan",
  path_chosen_at: Date.now() - 864_000_000,
  path_switch_gold_cents: 10_000,
  active_pet_id: "pet-automaton-gilded",
  mounted: true,
  pets: [
    makePet("pet-owl-classic", "owl", "classic", 50, false, false),
    makePet("pet-fox-classic", "fox", "classic", 50, false, false),
    makePet("pet-falcon-classic", "falcon", "classic", 40, false, false),
    makePet("pet-lynx-classic", "lynx", "classic", 30, false, false),
    makePet("pet-otter-classic", "otter", "classic", 25, false, false),
    makePet("pet-starling-classic", "starling", "classic", 20, false, false),
    makePet("pet-turtle-classic", "turtle", "classic", 15, false, false),
    makePet("pet-stag-classic", "stag", "classic", 50, false, false),
    makePet("pet-automaton-gilded", "automaton", "gilded", 50, true, true),
  ],
  achievements: buildAchievements(22),
  unseen_unlocks: [],
  backfill_applied: true,
};

function initialPreset(): GameDepthStateDto {
  const param =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("gameDepth")
      : null;
  if (param === "lv10") return structuredClone(mockGameDepthLv10);
  if (param === "collector") return structuredClone(mockGameDepthCollector);
  return structuredClone(mockGameDepthStarter);
}

let previewState: GameDepthStateDto = initialPreset();

export const gameDepthMocks: Record<string, unknown> = {
  get_game_depth_state: (): GameDepthStateDto => structuredClone(previewState),

  choose_game_path: (args?: { pathId?: GamePathId }): GameDepthStateDto => {
    if (previewState.level < 10) {
      throw new Error("Paths unlock at Level 10");
    }
    if (args?.pathId) {
      previewState = {
        ...previewState,
        chosen_path: args.pathId,
        path_chosen_at: Date.now(),
      };
    }
    return structuredClone(previewState);
  },

  set_active_pet: (args?: { petId?: string | null; mounted?: boolean }): GameDepthStateDto => {
    const petId = args?.petId ?? null;
    const wantMount = Boolean(args?.mounted);
    const target = petId ? previewState.pets.find((p) => p.id === petId) : null;
    if (petId && !target) {
      throw new Error("Pet not found");
    }
    if (wantMount && (!target || !target.mount_unlocked)) {
      throw new Error("Mount unlocks at 50 bond points");
    }
    previewState = {
      ...previewState,
      active_pet_id: petId,
      mounted: Boolean(petId && wantMount),
      pets: previewState.pets.map((p) => ({
        ...p,
        is_active: p.id === petId,
        is_mounted: p.id === petId && wantMount,
      })),
    };
    return structuredClone(previewState);
  },

  acknowledge_unlocks: (args?: { unlockIds?: string[] }): void => {
    const ids = new Set(args?.unlockIds ?? []);
    previewState = {
      ...previewState,
      unseen_unlocks: previewState.unseen_unlocks.filter((u) => !ids.has(u.id)),
    };
  },

  run_unlock_backfill: (): BackfillOutcomeDto => ({
    already_applied: true,
    pets_granted: 0,
    cosmetics_granted: 0,
    achievements_granted: 0,
  }),
};
