//! Pure Game depth domain types, 18 deterministic unlock rules, 9-species
//! pet roster, Level-10 cosmetic paths, 25 solo achievements, and bond math
//! (ADR-026, 15a-R4s).
//!
//! Zero IO, zero clock reads, zero UI/Tauri dependencies.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use ts_rs::TS;

use crate::error::{CoreError, CoreResult};
use crate::game::format_uuid_v5;

/// Current historical unlock/achievement backfill version (ADR-026 §2.2).
pub const CURRENT_BACKFILL_VERSION: u32 = 1;

/// Maximum bond growth points for a pet (`0..=50`, ADR-026 §2.2).
pub const MAX_PET_GROWTH: u32 = 50;

/// Minimum player level required to choose a Path (`02-game-depth-spec.md` §4).
pub const PATH_UNLOCK_LEVEL: u32 = 10;

/// Gold cost (`100` gold = `10,000` gold_cents) to switch paths after the
/// free initial pick.
pub const PATH_SWITCH_COST_CENTS: u64 = 10_000;

/// Bond points awarded per newly rewarded card review.
pub const PET_CREDIT_REVIEW_POINTS: u32 = 1;

/// Bond points awarded per newly rewarded task or habit completion.
pub const PET_CREDIT_PRODUCTIVITY_POINTS: u32 = 2;

/// Cosmetic Path IDs (`game_profile.chosen_path`, ADR-026 §2.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum GamePathId {
    Vanguard,
    Sage,
    Scout,
    Artisan,
}

impl GamePathId {
    pub const ALL: [Self; 4] = [Self::Vanguard, Self::Sage, Self::Scout, Self::Artisan];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Vanguard => "vanguard",
            Self::Sage => "sage",
            Self::Scout => "scout",
            Self::Artisan => "artisan",
        }
    }

    pub fn parse(s: &str) -> CoreResult<Self> {
        match s {
            "vanguard" => Ok(Self::Vanguard),
            "sage" => Ok(Self::Sage),
            "scout" => Ok(Self::Scout),
            "artisan" => Ok(Self::Artisan),
            other => Err(CoreError::Invalid(format!("unknown game path '{other}'"))),
        }
    }

    pub const fn frame_item_key(self) -> &'static str {
        match self {
            Self::Vanguard => "frame_path_vanguard",
            Self::Sage => "frame_path_sage",
            Self::Scout => "frame_path_scout",
            Self::Artisan => "frame_path_artisan",
        }
    }

    pub fn unlock_key(self) -> String {
        format!("unlock:path:{}", self.as_str())
    }
}

// ── IPC DTOs (ts-rs) ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PetProgressDto {
    pub id: String,
    pub species_key: String,
    pub variant_key: String,
    pub growth_points: u32,
    pub mount_unlocked: bool,
    pub is_active: bool,
    pub is_mounted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AchievementStatusDto {
    pub achievement_key: String,
    pub category: String,
    pub tier: u8,
    pub unlocked: bool,
    #[ts(type = "number | null")]
    pub earned_at: Option<i64>,
    pub current_value: u32,
    pub target_value: u32,
    pub badge_ref: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UnlockEventDto {
    pub id: String,
    pub kind: String,
    pub key: String,
    pub reward_ref: String,
    #[ts(type = "number")]
    pub unlocked_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GameDepthStateDto {
    pub level: u32,
    pub chosen_path: Option<GamePathId>,
    #[ts(type = "number | null")]
    pub path_chosen_at: Option<i64>,
    #[ts(type = "number")]
    pub path_switch_gold_cents: u64,
    pub active_pet_id: Option<String>,
    pub mounted: bool,
    pub pets: Vec<PetProgressDto>,
    pub achievements: Vec<AchievementStatusDto>,
    pub unseen_unlocks: Vec<UnlockEventDto>,
    pub backfill_applied: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BackfillOutcomeDto {
    pub already_applied: bool,
    pub pets_granted: u32,
    pub cosmetics_granted: u32,
    pub achievements_granted: u32,
}

// ── Sync / Storage Entities (ADR-026) ────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameProfile {
    pub id: String,
    pub user_id: String,
    pub chosen_path: Option<String>,
    pub path_chosen_at: Option<i64>,
    pub backfill_version: u32,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameUnlock {
    pub id: String,
    pub user_id: String,
    pub unlock_key: String,
    pub reward_kind: String,
    pub reward_ref: String,
    pub unlocked_at: i64,
    pub seen_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GamePet {
    pub id: String,
    pub user_id: String,
    pub species_key: String,
    pub variant_key: String,
    pub mount_unlocked_at: Option<i64>,
    pub is_active: bool,
    pub is_mounted: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GamePetCredit {
    pub id: String,
    pub user_id: String,
    pub pet_id: String,
    pub ledger_id: String,
    pub points: u32,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameAchievement {
    pub id: String,
    pub user_id: String,
    pub achievement_key: String,
    pub tier: u8,
    pub earned_at: i64,
    pub seen_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

// ── Deterministic v5 IDs (ADR-026 §2.2) ──────────────────────────────────────

/// `sha1("keepsake:game_profile:v1:" + user_id)`.
pub fn game_profile_id(user_id: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(b"keepsake:game_profile:v1:");
    hasher.update(user_id.as_bytes());
    format_uuid_v5(&hasher.finalize())
}

/// `sha1("keepsake:game_unlock:v1:" + user_id + ":" + unlock_key)`.
pub fn game_unlock_id(user_id: &str, unlock_key: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(b"keepsake:game_unlock:v1:");
    hasher.update(user_id.as_bytes());
    hasher.update(b":");
    hasher.update(unlock_key.as_bytes());
    format_uuid_v5(&hasher.finalize())
}

/// `sha1("keepsake:game_pet:v1:" + user_id + ":" + species_key + ":" + variant_key)`.
pub fn game_pet_id(user_id: &str, species_key: &str, variant_key: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(b"keepsake:game_pet:v1:");
    hasher.update(user_id.as_bytes());
    hasher.update(b":");
    hasher.update(species_key.as_bytes());
    hasher.update(b":");
    hasher.update(variant_key.as_bytes());
    format_uuid_v5(&hasher.finalize())
}

/// `sha1("keepsake:game_pet_credit:v1:" + user_id + ":" + pet_id + ":" + ledger_id)`.
pub fn game_pet_credit_id(user_id: &str, pet_id: &str, ledger_id: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(b"keepsake:game_pet_credit:v1:");
    hasher.update(user_id.as_bytes());
    hasher.update(b":");
    hasher.update(pet_id.as_bytes());
    hasher.update(b":");
    hasher.update(ledger_id.as_bytes());
    format_uuid_v5(&hasher.finalize())
}

/// `sha1("keepsake:game_achievement:v1:" + user_id + ":" + achievement_key)`.
pub fn game_achievement_id(user_id: &str, achievement_key: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(b"keepsake:game_achievement:v1:");
    hasher.update(user_id.as_bytes());
    hasher.update(b":");
    hasher.update(achievement_key.as_bytes());
    format_uuid_v5(&hasher.finalize())
}

// ── Catalogs: Pets, Unlocks, Achievements ────────────────────────────────────

/// Pet species and variant entry (`02-game-depth-spec.md` §3.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PetRosterEntry {
    pub species_key: &'static str,
    pub variant_key: &'static str,
    pub unlock_key: &'static str,
}

/// 9 species across 14 `(species_key, variant_key)` entries (`02-game-depth-spec.md` §3.1).
pub static PET_ROSTER: [PetRosterEntry; 14] = [
    PetRosterEntry {
        species_key: "owl",
        variant_key: "classic",
        unlock_key: "unlock:reviews:1",
    },
    PetRosterEntry {
        species_key: "owl",
        variant_key: "gilded",
        unlock_key: "unlock:reviews:1000",
    },
    PetRosterEntry {
        species_key: "fox",
        variant_key: "classic",
        unlock_key: "unlock:reviews:50",
    },
    PetRosterEntry {
        species_key: "fox",
        variant_key: "verdant",
        unlock_key: "unlock:tasks:50",
    },
    PetRosterEntry {
        species_key: "falcon",
        variant_key: "classic",
        unlock_key: "unlock:reviews:250",
    },
    PetRosterEntry {
        species_key: "falcon",
        variant_key: "midnight",
        unlock_key: "unlock:reviews:5000",
    },
    PetRosterEntry {
        species_key: "lynx",
        variant_key: "classic",
        unlock_key: "unlock:level:5",
    },
    PetRosterEntry {
        species_key: "lynx",
        variant_key: "midnight",
        unlock_key: "unlock:habit_streak:21",
    },
    PetRosterEntry {
        species_key: "otter",
        variant_key: "classic",
        unlock_key: "unlock:tasks:10",
    },
    PetRosterEntry {
        species_key: "starling",
        variant_key: "classic",
        unlock_key: "unlock:habit_streak:7",
    },
    PetRosterEntry {
        species_key: "turtle",
        variant_key: "classic",
        unlock_key: "unlock:study_days:30",
    },
    PetRosterEntry {
        species_key: "turtle",
        variant_key: "verdant",
        unlock_key: "unlock:mature_cards:100",
    },
    PetRosterEntry {
        species_key: "stag",
        variant_key: "classic",
        unlock_key: "unlock:level:10",
    },
    PetRosterEntry {
        species_key: "stag",
        variant_key: "gilded",
        unlock_key: "unlock:level:20",
    },
];

/// Clockwork Owl (`automaton`, `gilded`) is the 9th species (Level 35).
pub const AUTOMATON_PET: PetRosterEntry = PetRosterEntry {
    species_key: "automaton",
    variant_key: "gilded",
    unlock_key: "unlock:level:35",
};

/// Metric family driving an unlock or achievement rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DepthMetric {
    Reviews,
    Level,
    CompletedTasks,
    CompletedHabitLogs,
    MaxHabitStreak,
    StudyDays,
    MatureCards,
    DecksStudied,
    UnlockedPets,
    HasMount,
}

/// Reward granted by one of the 17 threshold unlock rules (plus `unlock:path:<id>` = 18 total).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnlockGrant {
    Pet {
        species_key: &'static str,
        variant_key: &'static str,
        also_paths_unlocked: bool,
    },
    Cosmetic {
        item_key: &'static str,
    },
}

/// A deterministic milestone unlock rule (`02-game-depth-spec.md` §2.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnlockRule {
    pub unlock_key: &'static str,
    pub metric: DepthMetric,
    pub threshold: u32,
    pub grant: UnlockGrant,
}

impl UnlockRule {
    pub const fn reward_kind(&self) -> &'static str {
        match self.grant {
            UnlockGrant::Pet {
                also_paths_unlocked: true,
                ..
            } => "path_unlocked",
            UnlockGrant::Pet {
                also_paths_unlocked: false,
                ..
            } => "pet",
            UnlockGrant::Cosmetic { .. } => "cosmetic",
        }
    }

    pub fn reward_ref(&self) -> String {
        match self.grant {
            UnlockGrant::Pet {
                species_key,
                variant_key,
                ..
            } => format!("{species_key}:{variant_key}"),
            UnlockGrant::Cosmetic { item_key } => item_key.to_string(),
        }
    }
}

/// The 17 threshold-based unlock rules (`unlock:path:<path_id>` is the 18th, triggered on path pick).
pub static THRESHOLD_UNLOCK_RULES: [UnlockRule; 17] = [
    UnlockRule {
        unlock_key: "unlock:reviews:1",
        metric: DepthMetric::Reviews,
        threshold: 1,
        grant: UnlockGrant::Pet {
            species_key: "owl",
            variant_key: "classic",
            also_paths_unlocked: false,
        },
    },
    UnlockRule {
        unlock_key: "unlock:reviews:50",
        metric: DepthMetric::Reviews,
        threshold: 50,
        grant: UnlockGrant::Pet {
            species_key: "fox",
            variant_key: "classic",
            also_paths_unlocked: false,
        },
    },
    UnlockRule {
        unlock_key: "unlock:reviews:250",
        metric: DepthMetric::Reviews,
        threshold: 250,
        grant: UnlockGrant::Pet {
            species_key: "falcon",
            variant_key: "classic",
            also_paths_unlocked: false,
        },
    },
    UnlockRule {
        unlock_key: "unlock:reviews:1000",
        metric: DepthMetric::Reviews,
        threshold: 1_000,
        grant: UnlockGrant::Pet {
            species_key: "owl",
            variant_key: "gilded",
            also_paths_unlocked: false,
        },
    },
    UnlockRule {
        unlock_key: "unlock:reviews:5000",
        metric: DepthMetric::Reviews,
        threshold: 5_000,
        grant: UnlockGrant::Pet {
            species_key: "falcon",
            variant_key: "midnight",
            also_paths_unlocked: false,
        },
    },
    UnlockRule {
        unlock_key: "unlock:level:2",
        metric: DepthMetric::Level,
        threshold: 2,
        grant: UnlockGrant::Cosmetic {
            item_key: "frame_copper_ring",
        },
    },
    UnlockRule {
        unlock_key: "unlock:level:5",
        metric: DepthMetric::Level,
        threshold: 5,
        grant: UnlockGrant::Pet {
            species_key: "lynx",
            variant_key: "classic",
            also_paths_unlocked: false,
        },
    },
    UnlockRule {
        unlock_key: "unlock:level:10",
        metric: DepthMetric::Level,
        threshold: 10,
        grant: UnlockGrant::Pet {
            species_key: "stag",
            variant_key: "classic",
            also_paths_unlocked: true,
        },
    },
    UnlockRule {
        unlock_key: "unlock:level:20",
        metric: DepthMetric::Level,
        threshold: 20,
        grant: UnlockGrant::Pet {
            species_key: "stag",
            variant_key: "gilded",
            also_paths_unlocked: false,
        },
    },
    UnlockRule {
        unlock_key: "unlock:level:35",
        metric: DepthMetric::Level,
        threshold: 35,
        grant: UnlockGrant::Pet {
            species_key: "automaton",
            variant_key: "gilded",
            also_paths_unlocked: false,
        },
    },
    UnlockRule {
        unlock_key: "unlock:tasks:10",
        metric: DepthMetric::CompletedTasks,
        threshold: 10,
        grant: UnlockGrant::Pet {
            species_key: "otter",
            variant_key: "classic",
            also_paths_unlocked: false,
        },
    },
    UnlockRule {
        unlock_key: "unlock:tasks:50",
        metric: DepthMetric::CompletedTasks,
        threshold: 50,
        grant: UnlockGrant::Pet {
            species_key: "fox",
            variant_key: "verdant",
            also_paths_unlocked: false,
        },
    },
    UnlockRule {
        unlock_key: "unlock:habit_streak:7",
        metric: DepthMetric::MaxHabitStreak,
        threshold: 7,
        grant: UnlockGrant::Pet {
            species_key: "starling",
            variant_key: "classic",
            also_paths_unlocked: false,
        },
    },
    UnlockRule {
        unlock_key: "unlock:habit_streak:21",
        metric: DepthMetric::MaxHabitStreak,
        threshold: 21,
        grant: UnlockGrant::Pet {
            species_key: "lynx",
            variant_key: "midnight",
            also_paths_unlocked: false,
        },
    },
    UnlockRule {
        unlock_key: "unlock:study_days:30",
        metric: DepthMetric::StudyDays,
        threshold: 30,
        grant: UnlockGrant::Pet {
            species_key: "turtle",
            variant_key: "classic",
            also_paths_unlocked: false,
        },
    },
    UnlockRule {
        unlock_key: "unlock:mature_cards:100",
        metric: DepthMetric::MatureCards,
        threshold: 100,
        grant: UnlockGrant::Pet {
            species_key: "turtle",
            variant_key: "verdant",
            also_paths_unlocked: false,
        },
    },
    UnlockRule {
        unlock_key: "unlock:decks_studied:3",
        metric: DepthMetric::DecksStudied,
        threshold: 3,
        grant: UnlockGrant::Cosmetic {
            item_key: "backdrop_study_hearth",
        },
    },
];

/// Solo achievement definition (`02-game-depth-spec.md` §5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AchievementRule {
    pub achievement_key: &'static str,
    pub tier: u8,
    pub category: &'static str,
    pub metric: DepthMetric,
    pub threshold: u32,
    pub badge_ref: &'static str,
}

/// All 25 solo achievements (`02-game-depth-spec.md` §5).
pub static ACHIEVEMENT_CATALOG: [AchievementRule; 25] = [
    AchievementRule {
        achievement_key: "ach:first_review",
        tier: 1,
        category: "Onboarding",
        metric: DepthMetric::Reviews,
        threshold: 1,
        badge_ref: "badge_spark",
    },
    AchievementRule {
        achievement_key: "ach:first_task",
        tier: 1,
        category: "Onboarding",
        metric: DepthMetric::CompletedTasks,
        threshold: 1,
        badge_ref: "badge_check",
    },
    AchievementRule {
        achievement_key: "ach:first_habit",
        tier: 1,
        category: "Onboarding",
        metric: DepthMetric::CompletedHabitLogs,
        threshold: 1,
        badge_ref: "badge_sprout",
    },
    AchievementRule {
        achievement_key: "ach:first_pet",
        tier: 1,
        category: "Onboarding",
        metric: DepthMetric::UnlockedPets,
        threshold: 1,
        badge_ref: "badge_paw",
    },
    AchievementRule {
        achievement_key: "ach:reviews_50",
        tier: 1,
        category: "Memory",
        metric: DepthMetric::Reviews,
        threshold: 50,
        badge_ref: "badge_cards_bronze",
    },
    AchievementRule {
        achievement_key: "ach:reviews_250",
        tier: 2,
        category: "Memory",
        metric: DepthMetric::Reviews,
        threshold: 250,
        badge_ref: "badge_cards_silver",
    },
    AchievementRule {
        achievement_key: "ach:reviews_1000",
        tier: 2,
        category: "Memory",
        metric: DepthMetric::Reviews,
        threshold: 1_000,
        badge_ref: "badge_cards_gold",
    },
    AchievementRule {
        achievement_key: "ach:reviews_5000",
        tier: 3,
        category: "Memory",
        metric: DepthMetric::Reviews,
        threshold: 5_000,
        badge_ref: "badge_archive",
    },
    AchievementRule {
        achievement_key: "ach:reviews_10000",
        tier: 3,
        category: "Memory",
        metric: DepthMetric::Reviews,
        threshold: 10_000,
        badge_ref: "badge_crown_recall",
    },
    AchievementRule {
        achievement_key: "ach:mature_100",
        tier: 2,
        category: "Mastery",
        metric: DepthMetric::MatureCards,
        threshold: 100,
        badge_ref: "badge_tree_silver",
    },
    AchievementRule {
        achievement_key: "ach:mature_500",
        tier: 3,
        category: "Mastery",
        metric: DepthMetric::MatureCards,
        threshold: 500,
        badge_ref: "badge_tree_gold",
    },
    AchievementRule {
        achievement_key: "ach:decks_3",
        tier: 1,
        category: "Mastery",
        metric: DepthMetric::DecksStudied,
        threshold: 3,
        badge_ref: "badge_compass",
    },
    AchievementRule {
        achievement_key: "ach:decks_10",
        tier: 2,
        category: "Mastery",
        metric: DepthMetric::DecksStudied,
        threshold: 10,
        badge_ref: "badge_bookshelf",
    },
    AchievementRule {
        achievement_key: "ach:streak_3",
        tier: 1,
        category: "Consistency",
        metric: DepthMetric::MaxHabitStreak,
        threshold: 3,
        badge_ref: "badge_flame_1",
    },
    AchievementRule {
        achievement_key: "ach:streak_7",
        tier: 1,
        category: "Consistency",
        metric: DepthMetric::MaxHabitStreak,
        threshold: 7,
        badge_ref: "badge_flame_2",
    },
    AchievementRule {
        achievement_key: "ach:streak_21",
        tier: 2,
        category: "Consistency",
        metric: DepthMetric::MaxHabitStreak,
        threshold: 21,
        badge_ref: "badge_flame_3",
    },
    AchievementRule {
        achievement_key: "ach:streak_60",
        tier: 3,
        category: "Consistency",
        metric: DepthMetric::MaxHabitStreak,
        threshold: 60,
        badge_ref: "badge_sun",
    },
    AchievementRule {
        achievement_key: "ach:study_days_30",
        tier: 2,
        category: "Consistency",
        metric: DepthMetric::StudyDays,
        threshold: 30,
        badge_ref: "badge_calendar_gold",
    },
    AchievementRule {
        achievement_key: "ach:tasks_10",
        tier: 1,
        category: "Tasks",
        metric: DepthMetric::CompletedTasks,
        threshold: 10,
        badge_ref: "badge_scroll_1",
    },
    AchievementRule {
        achievement_key: "ach:tasks_50",
        tier: 2,
        category: "Tasks",
        metric: DepthMetric::CompletedTasks,
        threshold: 50,
        badge_ref: "badge_scroll_2",
    },
    AchievementRule {
        achievement_key: "ach:tasks_250",
        tier: 3,
        category: "Tasks",
        metric: DepthMetric::CompletedTasks,
        threshold: 250,
        badge_ref: "badge_scroll_3",
    },
    AchievementRule {
        achievement_key: "ach:level_5",
        tier: 1,
        category: "Milestones",
        metric: DepthMetric::Level,
        threshold: 5,
        badge_ref: "badge_star_bronze",
    },
    AchievementRule {
        achievement_key: "ach:level_10",
        tier: 2,
        category: "Milestones",
        metric: DepthMetric::Level,
        threshold: 10,
        badge_ref: "badge_crest",
    },
    AchievementRule {
        achievement_key: "ach:first_mount",
        tier: 2,
        category: "Collection",
        metric: DepthMetric::HasMount,
        threshold: 1,
        badge_ref: "badge_saddle",
    },
    AchievementRule {
        achievement_key: "ach:collect_5_pets",
        tier: 3,
        category: "Collection",
        metric: DepthMetric::UnlockedPets,
        threshold: 5,
        badge_ref: "badge_menagerie",
    },
];

/// Aggregate counts used for backfill and achievement status rendering.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DepthMetricSnapshot {
    pub reviews: u32,
    pub level: u32,
    pub completed_tasks: u32,
    pub completed_habit_logs: u32,
    pub max_habit_streak: u32,
    pub study_days: u32,
    pub mature_cards: u32,
    pub decks_studied: u32,
    pub unlocked_pets: u32,
    pub has_mount: bool,
    pub path_chosen: bool,
}

impl DepthMetricSnapshot {
    pub fn value_for(&self, metric: DepthMetric) -> u32 {
        match metric {
            DepthMetric::Reviews => self.reviews,
            DepthMetric::Level => self.level,
            DepthMetric::CompletedTasks => self.completed_tasks,
            DepthMetric::CompletedHabitLogs => self.completed_habit_logs,
            DepthMetric::MaxHabitStreak => self.max_habit_streak,
            DepthMetric::StudyDays => self.study_days,
            DepthMetric::MatureCards => self.mature_cards,
            DepthMetric::DecksStudied => self.decks_studied,
            DepthMetric::UnlockedPets => self.unlocked_pets,
            DepthMetric::HasMount => u32::from(self.has_mount),
        }
    }
}

/// Cap active credit sum at `MAX_PET_GROWTH` (`50`).
pub const fn growth_points_from_sum(sum: u32) -> u32 {
    if sum > MAX_PET_GROWTH {
        MAX_PET_GROWTH
    } else {
        sum
    }
}

/// Return the smallest threshold for `metric` not yet present in `existing_keys`.
pub fn next_unearned_threshold(
    metric: DepthMetric,
    existing_unlocks: &HashSet<String>,
    existing_achievements: &HashSet<String>,
) -> Option<u32> {
    let unlock_min = THRESHOLD_UNLOCK_RULES
        .iter()
        .filter(|r| r.metric == metric && !existing_unlocks.contains(r.unlock_key))
        .map(|r| r.threshold)
        .min();
    let ach_min = ACHIEVEMENT_CATALOG
        .iter()
        .filter(|a| a.metric == metric && !existing_achievements.contains(a.achievement_key))
        .map(|a| a.threshold)
        .min();
    match (unlock_min, ach_min) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (Some(a), None) | (None, Some(a)) => Some(a),
        (None, None) => None,
    }
}

/// Build `AchievementStatusDto` list for all 25 catalog achievements.
pub fn build_achievement_statuses(
    metrics: &DepthMetricSnapshot,
    earned_map: &std::collections::HashMap<String, i64>,
) -> Vec<AchievementStatusDto> {
    ACHIEVEMENT_CATALOG
        .iter()
        .map(|rule| {
            let earned_at = earned_map.get(rule.achievement_key).copied();
            let unlocked = earned_at.is_some();
            let raw_val = metrics.value_for(rule.metric);
            let current_value = if unlocked {
                rule.threshold
            } else {
                raw_val.min(rule.threshold)
            };
            AchievementStatusDto {
                achievement_key: rule.achievement_key.to_string(),
                category: rule.category.to_string(),
                tier: rule.tier,
                unlocked,
                earned_at,
                current_value,
                target_value: rule.threshold,
                badge_ref: rule.badge_ref.to_string(),
            }
        })
        .collect()
}

/// Context passed into storage reward transactions so unlock evaluation and
/// pet growth credits run inside the same SQLite transaction.
#[derive(Debug, Clone)]
pub struct GameEvalContext {
    pub user_id: String,
    pub today: i32,
    pub awarded_day: i32,
    pub now_ms: i64,
    pub tz_offset_minutes: i32,
    pub rollover_hour: u8,
    pub created_ms: i64,
    pub card_is_mature: bool,
}

/// Result of a rewarding write (`apply_answer`, `complete_task`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct GameWriteOutcome {
    pub reward_granted: bool,
    pub game_changed: bool,
}

/// Result of `Storage::apply_answer_with_game`, including the actual `revlog_id`
/// inserted after any same-millisecond collision bump (F13).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ApplyAnswerOutcome {
    pub reward_granted: bool,
    pub game_changed: bool,
    pub revlog_id: i64,
}

/// Result of `upsert_habit_log_with_game`.
#[derive(Debug, Clone)]
pub struct HabitLogGameOutcome {
    pub habit_outcome: crate::productivity::HabitLogWriteOutcome,
    pub game_changed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::progress::NIL_USER_ID;

    #[test]
    fn catalogs_match_spec_counts_and_unique_keys() {
        assert_eq!(THRESHOLD_UNLOCK_RULES.len(), 17);
        assert_eq!(ACHIEVEMENT_CATALOG.len(), 25);

        let unlock_keys: HashSet<&str> = THRESHOLD_UNLOCK_RULES
            .iter()
            .map(|r| r.unlock_key)
            .collect();
        assert_eq!(unlock_keys.len(), 17);

        let ach_keys: HashSet<&str> = ACHIEVEMENT_CATALOG
            .iter()
            .map(|a| a.achievement_key)
            .collect();
        assert_eq!(ach_keys.len(), 25);

        let mut species: HashSet<&str> = PET_ROSTER.iter().map(|p| p.species_key).collect();
        species.insert(AUTOMATON_PET.species_key);
        assert_eq!(species.len(), 9);
    }

    #[test]
    fn deterministic_ids_match_adr_026_prefixes() {
        let p = game_profile_id(NIL_USER_ID);
        let u = game_unlock_id(NIL_USER_ID, "unlock:reviews:1");
        let pet = game_pet_id(NIL_USER_ID, "owl", "classic");
        let cred = game_pet_credit_id(NIL_USER_ID, &pet, "ledger-1");
        let ach = game_achievement_id(NIL_USER_ID, "ach:first_review");
        for id in [&p, &u, &pet, &cred, &ach] {
            assert!(crate::productivity::is_valid_uuid(id), "bad uuid: {id}");
            assert_eq!(&id[14..15], "5");
        }
        assert_ne!(p, u);
        assert_ne!(u, pet);
        assert_ne!(pet, cred);
        assert_ne!(cred, ach);
    }

    #[test]
    fn pet_growth_caps_at_50() {
        assert_eq!(growth_points_from_sum(0), 0);
        assert_eq!(growth_points_from_sum(49), 49);
        assert_eq!(growth_points_from_sum(50), 50);
        assert_eq!(growth_points_from_sum(123), 50);
    }

    #[test]
    fn next_unearned_threshold_returns_smallest_remaining() {
        let mut unlocks = HashSet::new();
        let mut achs = HashSet::new();
        assert_eq!(
            next_unearned_threshold(DepthMetric::Reviews, &unlocks, &achs),
            Some(1)
        );
        unlocks.insert("unlock:reviews:1".to_string());
        achs.insert("ach:first_review".to_string());
        assert_eq!(
            next_unearned_threshold(DepthMetric::Reviews, &unlocks, &achs),
            Some(50)
        );
        for k in [
            "unlock:reviews:50",
            "unlock:reviews:250",
            "unlock:reviews:1000",
            "unlock:reviews:5000",
        ] {
            unlocks.insert(k.to_string());
        }
        for k in [
            "ach:reviews_50",
            "ach:reviews_250",
            "ach:reviews_1000",
            "ach:reviews_5000",
        ] {
            achs.insert(k.to_string());
        }
        assert_eq!(
            next_unearned_threshold(DepthMetric::Reviews, &unlocks, &achs),
            Some(10_000)
        );
        achs.insert("ach:reviews_10000".to_string());
        assert_eq!(
            next_unearned_threshold(DepthMetric::Reviews, &unlocks, &achs),
            None
        );
    }
}
