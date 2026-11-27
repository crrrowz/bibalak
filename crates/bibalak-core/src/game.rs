//! Pure Game style domain types, catalog, rank math, deterministic v5 IDs,
//! balance helpers, and validation (ADR-025, 14a-R2s).
//!
//! Zero IO, zero clock reads, zero UI/Tauri dependencies.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use ts_rs::TS;

use crate::error::{CoreError, CoreResult};

/// Maximum streak freeze tokens a learner can hold at once.
pub const FREEZE_TOKEN_CAP: u32 = 3;

/// Shop price of one streak freeze token in gold cents (`25` gold).
pub const FREEZE_TOKEN_PRICE_CENTS: u64 = 2_500;

/// Special shop item key for buying a streak freeze token.
pub const STREAK_FREEZE_ITEM_KEY: &str = "streak_freeze";

/// Refund window for accidental shop / custom-reward purchases (`5` minutes).
pub const REFUND_WINDOW_MS: i64 = 300_000;

/// Consecutive active study days per free streak-freeze milestone.
pub const STREAK_FREEZE_MILESTONE_DAYS: u32 = 7;

/// Maximum number of active custom rewards per user.
pub const MAX_CUSTOM_REWARDS: usize = 50;

/// Minimum custom reward cost in gold cents (`1` gold).
pub const CUSTOM_REWARD_MIN_COST_CENTS: u64 = 100;

/// Maximum custom reward cost in gold cents (`100,000` gold).
pub const CUSTOM_REWARD_MAX_COST_CENTS: u64 = 10_000_000;

/// Maximum custom reward title length (chars).
pub const CUSTOM_REWARD_MAX_TITLE_CHARS: usize = 80;

/// Maximum custom reward notes length (chars).
pub const CUSTOM_REWARD_MAX_NOTES_CHARS: usize = 300;

/// Default spend history limit.
pub const DEFAULT_SPEND_HISTORY_LIMIT: u32 = 50;

/// Maximum spend history limit.
pub const MAX_SPEND_HISTORY_LIMIT: u32 = 500;

const VALID_BODY_TONES: [&str; 6] = ["tone_1", "tone_2", "tone_3", "tone_4", "tone_5", "tone_6"];
const VALID_HAIR_STYLES: [&str; 6] = ["hair_1", "hair_2", "hair_3", "hair_4", "hair_5", "hair_6"];
const VALID_HAIR_COLORS: [&str; 6] = ["black", "brown", "auburn", "blonde", "silver", "indigo"];
const VALID_STARTER_OUTFITS: [&str; 3] = ["tunic_slate", "tunic_forest", "tunic_ochre"];
const VALID_STARTER_ACCESSORIES: [&str; 4] =
    ["none", "acc_glasses", "acc_headband", "acc_kerchief"];
const VALID_REWARD_ICONS: [&str; 8] = [
    "gift", "coffee", "film", "gamepad", "music", "book", "sun", "sparkles",
];

/// Game rank brackets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum GameRank {
    Novice,
    Apprentice,
    Explorer,
    Champion,
    Legend,
}

impl GameRank {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Novice => "novice",
            Self::Apprentice => "apprentice",
            Self::Explorer => "explorer",
            Self::Champion => "champion",
            Self::Legend => "legend",
        }
    }
}

/// Map a 1-based player level to its Game rank (Novice 1-4, Apprentice 5-9,
/// Explorer 10-19, Champion 20-34, Legend 35+).
pub const fn rank_for_level(level: u32) -> GameRank {
    match level {
        0..=4 => GameRank::Novice,
        5..=9 => GameRank::Apprentice,
        10..=19 => GameRank::Explorer,
        20..=34 => GameRank::Champion,
        _ => GameRank::Legend,
    }
}

/// Cosmetic equipment slots (`avatar_equipped.slot`, ADR-025 §2.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum EquipmentSlot {
    Head,
    Outfit,
    MainHand,
    OffHand,
    Back,
    Accessory,
    Backdrop,
    Frame,
}

impl EquipmentSlot {
    pub const ALL: [Self; 8] = [
        Self::Head,
        Self::Outfit,
        Self::MainHand,
        Self::OffHand,
        Self::Back,
        Self::Accessory,
        Self::Backdrop,
        Self::Frame,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Head => "head",
            Self::Outfit => "outfit",
            Self::MainHand => "main_hand",
            Self::OffHand => "off_hand",
            Self::Back => "back",
            Self::Accessory => "accessory",
            Self::Backdrop => "backdrop",
            Self::Frame => "frame",
        }
    }

    pub fn parse(s: &str) -> CoreResult<Self> {
        match s {
            "head" => Ok(Self::Head),
            "outfit" => Ok(Self::Outfit),
            "main_hand" => Ok(Self::MainHand),
            "off_hand" => Ok(Self::OffHand),
            "back" => Ok(Self::Back),
            "accessory" => Ok(Self::Accessory),
            "backdrop" => Ok(Self::Backdrop),
            "frame" => Ok(Self::Frame),
            other => Err(CoreError::Invalid(format!(
                "unknown equipment slot '{other}'"
            ))),
        }
    }
}

/// Gold spending categories (`gold_spend_ledger.kind`, ADR-025 §2.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SpendKind {
    Cosmetic,
    FreezeToken,
    CustomReward,
    PathChange,
}

impl SpendKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Cosmetic => "cosmetic",
            Self::FreezeToken => "freeze_token",
            Self::CustomReward => "custom_reward",
            Self::PathChange => "path_change",
        }
    }

    pub fn parse(s: &str) -> CoreResult<Self> {
        match s {
            "cosmetic" => Ok(Self::Cosmetic),
            "freeze_token" => Ok(Self::FreezeToken),
            "custom_reward" => Ok(Self::CustomReward),
            "path_change" => Ok(Self::PathChange),
            other => Err(CoreError::Invalid(format!("unknown spend kind '{other}'"))),
        }
    }
}

/// Static catalog entry for the Game shop (25 items, keys only — no UI names).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CatalogItem {
    pub item_key: &'static str,
    pub slot: Option<EquipmentSlot>,
    pub kind: SpendKind,
    pub price_cents: u64,
    pub hide_hair: bool,
    pub two_handed: bool,
}

/// Static 25-item Game shop catalog (`01-game-style-spec.md` §6.1).
pub static GAME_CATALOG: [CatalogItem; 25] = [
    CatalogItem {
        item_key: STREAK_FREEZE_ITEM_KEY,
        slot: None,
        kind: SpendKind::FreezeToken,
        price_cents: FREEZE_TOKEN_PRICE_CENTS,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "head_hood_scholar",
        slot: Some(EquipmentSlot::Head),
        kind: SpendKind::Cosmetic,
        price_cents: 2_500,
        hide_hair: true,
        two_handed: false,
    },
    CatalogItem {
        item_key: "head_hat_adventurer",
        slot: Some(EquipmentSlot::Head),
        kind: SpendKind::Cosmetic,
        price_cents: 4_500,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "head_circlet_brass",
        slot: Some(EquipmentSlot::Head),
        kind: SpendKind::Cosmetic,
        price_cents: 7_500,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "head_crown_star",
        slot: Some(EquipmentSlot::Head),
        kind: SpendKind::Cosmetic,
        price_cents: 12_000,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "outfit_cloak_green",
        slot: Some(EquipmentSlot::Outfit),
        kind: SpendKind::Cosmetic,
        price_cents: 3_000,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "outfit_coat_guild",
        slot: Some(EquipmentSlot::Outfit),
        kind: SpendKind::Cosmetic,
        price_cents: 6_000,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "outfit_robe_velvet",
        slot: Some(EquipmentSlot::Outfit),
        kind: SpendKind::Cosmetic,
        price_cents: 9_500,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "outfit_tunic_royal",
        slot: Some(EquipmentSlot::Outfit),
        kind: SpendKind::Cosmetic,
        price_cents: 15_000,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "hand_wand_oak",
        slot: Some(EquipmentSlot::MainHand),
        kind: SpendKind::Cosmetic,
        price_cents: 2_500,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "hand_compass_brass",
        slot: Some(EquipmentSlot::MainHand),
        kind: SpendKind::Cosmetic,
        price_cents: 5_500,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "hand_staff_quill",
        slot: Some(EquipmentSlot::MainHand),
        kind: SpendKind::Cosmetic,
        price_cents: 9_500,
        hide_hair: false,
        two_handed: true,
    },
    CatalogItem {
        item_key: "hand_sabre_guild",
        slot: Some(EquipmentSlot::MainHand),
        kind: SpendKind::Cosmetic,
        price_cents: 16_000,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "off_lantern_warm",
        slot: Some(EquipmentSlot::OffHand),
        kind: SpendKind::Cosmetic,
        price_cents: 2_000,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "off_buckler_oak",
        slot: Some(EquipmentSlot::OffHand),
        kind: SpendKind::Cosmetic,
        price_cents: 5_000,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "off_tome_runed",
        slot: Some(EquipmentSlot::OffHand),
        kind: SpendKind::Cosmetic,
        price_cents: 9_000,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "back_satchel_canvas",
        slot: Some(EquipmentSlot::Back),
        kind: SpendKind::Cosmetic,
        price_cents: 3_500,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "back_cape_crimson",
        slot: Some(EquipmentSlot::Back),
        kind: SpendKind::Cosmetic,
        price_cents: 7_500,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "back_mantle_star",
        slot: Some(EquipmentSlot::Back),
        kind: SpendKind::Cosmetic,
        price_cents: 14_000,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "acc_monocle_amber",
        slot: Some(EquipmentSlot::Accessory),
        kind: SpendKind::Cosmetic,
        price_cents: 1_500,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "acc_scarf_stripe",
        slot: Some(EquipmentSlot::Accessory),
        kind: SpendKind::Cosmetic,
        price_cents: 3_500,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "acc_pin_laurel",
        slot: Some(EquipmentSlot::Accessory),
        kind: SpendKind::Cosmetic,
        price_cents: 6_000,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "bg_night_library",
        slot: Some(EquipmentSlot::Backdrop),
        kind: SpendKind::Cosmetic,
        price_cents: 4_000,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "bg_mountain_camp",
        slot: Some(EquipmentSlot::Backdrop),
        kind: SpendKind::Cosmetic,
        price_cents: 8_000,
        hide_hair: false,
        two_handed: false,
    },
    CatalogItem {
        item_key: "bg_observatory",
        slot: Some(EquipmentSlot::Backdrop),
        kind: SpendKind::Cosmetic,
        price_cents: 12_000,
        hide_hair: false,
        two_handed: false,
    },
];

/// Look up a purchasable item in `GAME_CATALOG`.
pub fn catalog_item(item_key: &str) -> Option<&'static CatalogItem> {
    GAME_CATALOG.iter().find(|entry| entry.item_key == item_key)
}

/// Slot for any valid cosmetic item (shop catalog or R4 unlocked cosmetic).
pub fn cosmetic_slot_for_item(item_key: &str) -> Option<EquipmentSlot> {
    if let Some(item) = catalog_item(item_key) {
        if item.kind == SpendKind::Cosmetic {
            return item.slot;
        }
        return None;
    }
    match item_key {
        "frame_copper_ring"
        | "frame_path_vanguard"
        | "frame_path_sage"
        | "frame_path_scout"
        | "frame_path_artisan" => Some(EquipmentSlot::Frame),
        "backdrop_study_hearth" => Some(EquipmentSlot::Backdrop),
        _ => None,
    }
}

/// Returns true for R4 unlocked cosmetics accepted by `grant_unlocked_cosmetic`.
pub fn is_valid_cosmetic_key(item_key: &str) -> bool {
    cosmetic_slot_for_item(item_key).is_some()
}

// ── IPC DTOs (ts-rs) ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AvatarProfileDto {
    pub body_tone: String,
    pub hair_style: String,
    pub hair_color: String,
    pub starter_outfit: String,
    pub starter_accessory: String,
}

impl Default for AvatarProfileDto {
    fn default() -> Self {
        Self {
            body_tone: "tone_2".to_string(),
            hair_style: "hair_1".to_string(),
            hair_color: "brown".to_string(),
            starter_outfit: "tunic_slate".to_string(),
            starter_accessory: "none".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AvatarProfileInput {
    pub body_tone: String,
    pub hair_style: String,
    pub hair_color: String,
    pub starter_outfit: String,
    pub starter_accessory: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EquippedSlotDto {
    pub slot: EquipmentSlot,
    pub item_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ShopItemDto {
    pub item_key: String,
    pub slot: Option<EquipmentSlot>,
    pub kind: SpendKind,
    #[ts(type = "number")]
    pub price_cents: u64,
    pub hide_hair: bool,
    pub two_handed: bool,
    pub owned: bool,
    pub equipped: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GameStateDto {
    pub level: u32,
    #[ts(type = "number")]
    pub xp_into_level: u64,
    #[ts(type = "number")]
    pub xp_to_next_level: u64,
    #[ts(type = "number")]
    pub total_xp: u64,
    #[ts(type = "number")]
    pub earned_gold_cents: u64,
    #[ts(type = "number")]
    pub spent_gold_cents: u64,
    #[ts(type = "number")]
    pub available_gold_cents: u64,
    pub study_streak: u32,
    pub studied_today: bool,
    pub freeze_tokens_held: u32,
    pub freeze_token_cap: u32,
    pub avatar: AvatarProfileDto,
    pub equipped: Vec<EquippedSlotDto>,
    pub owned_item_keys: Vec<String>,
    pub catalog: Vec<ShopItemDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PurchaseResultDto {
    pub spend_id: String,
    pub state: GameStateDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CustomRewardDto {
    pub id: String,
    pub title: String,
    pub notes: String,
    #[ts(type = "number")]
    pub cost_cents: u64,
    pub icon_key: String,
    pub sort_order: i32,
    pub claim_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CustomRewardInput {
    pub title: String,
    pub notes: String,
    #[ts(type = "number")]
    pub cost_cents: u64,
    pub icon_key: String,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SpendHistoryEntryDto {
    pub spend_id: String,
    pub kind: SpendKind,
    pub ref_key: String,
    pub label: String,
    #[ts(type = "number")]
    pub amount_cents: u64,
    #[ts(type = "number")]
    pub created_at: i64,
    pub refundable: bool,
}

// ── Sync / Storage Entities (ADR-025) ────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AvatarProfile {
    pub id: String,
    pub user_id: String,
    pub body_tone: String,
    pub hair_style: String,
    pub hair_color: String,
    pub starter_outfit: String,
    pub starter_accessory: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InventoryItem {
    pub id: String,
    pub user_id: String,
    pub item_key: String,
    pub kind: String,
    pub source: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AvatarEquippedSlot {
    pub id: String,
    pub user_id: String,
    pub slot: String,
    pub item_key: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomReward {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub notes: String,
    pub cost_cents: i64,
    pub icon_key: String,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoldSpendEntry {
    pub id: String,
    pub user_id: String,
    pub idempotency_key: String,
    pub kind: String,
    pub ref_key: String,
    pub amount_cents: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FreezeTokenEntry {
    pub id: String,
    pub user_id: String,
    pub source_key: String,
    pub delta: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

/// Snapshot loaded from storage to build `GameStateDto`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GameSnapshot {
    pub total_xp: u64,
    pub earned_gold_cents: u64,
    pub spent_gold_cents: u64,
    pub study_streak: u32,
    pub studied_today: bool,
    pub freeze_tokens_held: u32,
    pub avatar: AvatarProfileDto,
    pub equipped: Vec<EquippedSlotDto>,
    pub owned_item_keys: Vec<String>,
}

// ── Deterministic v5 IDs & Pure Math ─────────────────────────────────────────

/// Format a 20-byte SHA-1 digest into a lowercase RFC 4122 v5 UUID string,
/// matching `progress::ledger_id`.
pub fn format_uuid_v5(digest: &[u8]) -> String {
    let mut b = [0_u8; 16];
    b.copy_from_slice(&digest[..16]);
    b[6] = (b[6] & 0x0f) | 0x50;
    b[8] = (b[8] & 0x3f) | 0x80;

    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3],
        b[4], b[5],
        b[6], b[7],
        b[8], b[9],
        b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

/// Deterministic RFC 4122 v5 UUID for keyed ADR-025/026 game entities:
/// `sha1("keepsake:<domain>:v1:<user_id>:<natural_key>")`.
pub fn game_entity_id(domain: &str, user_id: &str, natural_key: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(b"keepsake:");
    hasher.update(domain.as_bytes());
    hasher.update(b":v1:");
    hasher.update(user_id.as_bytes());
    hasher.update(b":");
    hasher.update(natural_key.as_bytes());
    let digest = hasher.finalize();
    format_uuid_v5(&digest)
}

/// Available gold (`earned - spent`), floored at 0 via `saturating_sub`.
pub const fn available_gold_cents(earned_gold_cents: u64, spent_gold_cents: u64) -> u64 {
    earned_gold_cents.saturating_sub(spent_gold_cents)
}

/// Consecutive active days ending at `day` (inclusive), bridged by `frozen_days`.
pub fn streak_ending_at_with_freezes(
    active_days: &HashSet<i32>,
    frozen_days: &HashSet<i32>,
    day: i32,
) -> u32 {
    let mut streak = 0_u32;
    let mut cursor = day;
    while active_days.contains(&cursor) || frozen_days.contains(&cursor) {
        if active_days.contains(&cursor) {
            streak = streak.saturating_add(1);
        }
        match cursor.checked_sub(1) {
            Some(prev) => cursor = prev,
            None => break,
        }
    }
    streak
}

/// Consecutive active days ending at `day` (inclusive).
pub fn streak_ending_at(active_days: &HashSet<i32>, day: i32) -> u32 {
    streak_ending_at_with_freezes(active_days, &HashSet::new(), day)
}

/// Current study streak from active `progress_ledger` days + frozen study days, with today-in-progress grace.
pub fn study_streak_with_freezes(
    active_days: &HashSet<i32>,
    frozen_days: &HashSet<i32>,
    today: i32,
) -> (u32, bool) {
    let studied_today = active_days.contains(&today);
    let streak = if studied_today {
        streak_ending_at_with_freezes(active_days, frozen_days, today)
    } else if let Some(yesterday) = today.checked_sub(1) {
        streak_ending_at_with_freezes(active_days, frozen_days, yesterday)
    } else {
        0
    };
    (streak, studied_today)
}

/// Current study streak from active `progress_ledger` days with today-in-progress grace.
pub fn study_streak_from_days(active_days: &HashSet<i32>, today: i32) -> (u32, bool) {
    study_streak_with_freezes(active_days, &HashSet::new(), today)
}

/// Build `GameStateDto` from a `GameSnapshot`.
pub fn build_game_state_dto(snap: GameSnapshot) -> GameStateDto {
    let lvl = crate::progress::level_from_xp(snap.total_xp);
    let available = available_gold_cents(snap.earned_gold_cents, snap.spent_gold_cents);
    let owned_set: HashSet<&str> = snap.owned_item_keys.iter().map(String::as_str).collect();
    let equipped_set: HashSet<&str> = snap
        .equipped
        .iter()
        .filter_map(|e| e.item_key.as_deref())
        .collect();

    let mut equipped = Vec::with_capacity(EquipmentSlot::ALL.len());
    for slot in EquipmentSlot::ALL {
        let item_key = snap
            .equipped
            .iter()
            .find(|e| e.slot == slot)
            .and_then(|e| e.item_key.clone());
        equipped.push(EquippedSlotDto { slot, item_key });
    }

    let catalog = GAME_CATALOG
        .iter()
        .map(|item| {
            let owned = item.kind == SpendKind::Cosmetic && owned_set.contains(item.item_key);
            let equipped = owned && equipped_set.contains(item.item_key);
            ShopItemDto {
                item_key: item.item_key.to_string(),
                slot: item.slot,
                kind: item.kind,
                price_cents: item.price_cents,
                hide_hair: item.hide_hair,
                two_handed: item.two_handed,
                owned,
                equipped,
            }
        })
        .collect();

    GameStateDto {
        level: lvl.level,
        xp_into_level: lvl.xp_into_level,
        xp_to_next_level: lvl.xp_to_next_level,
        total_xp: snap.total_xp,
        earned_gold_cents: snap.earned_gold_cents,
        spent_gold_cents: snap.spent_gold_cents,
        available_gold_cents: available,
        study_streak: snap.study_streak,
        studied_today: snap.studied_today,
        freeze_tokens_held: snap.freeze_tokens_held.min(FREEZE_TOKEN_CAP),
        freeze_token_cap: FREEZE_TOKEN_CAP,
        avatar: snap.avatar,
        equipped,
        owned_item_keys: snap.owned_item_keys,
        catalog,
    }
}

// ── Input Validation ─────────────────────────────────────────────────────────

pub fn validate_avatar_profile_input(input: &AvatarProfileInput) -> CoreResult<()> {
    if !VALID_BODY_TONES.contains(&input.body_tone.as_str()) {
        return Err(CoreError::Invalid(format!(
            "invalid body_tone '{}'",
            input.body_tone
        )));
    }
    if !VALID_HAIR_STYLES.contains(&input.hair_style.as_str()) {
        return Err(CoreError::Invalid(format!(
            "invalid hair_style '{}'",
            input.hair_style
        )));
    }
    if !VALID_HAIR_COLORS.contains(&input.hair_color.as_str()) {
        return Err(CoreError::Invalid(format!(
            "invalid hair_color '{}'",
            input.hair_color
        )));
    }
    if !VALID_STARTER_OUTFITS.contains(&input.starter_outfit.as_str()) {
        return Err(CoreError::Invalid(format!(
            "invalid starter_outfit '{}'",
            input.starter_outfit
        )));
    }
    if !VALID_STARTER_ACCESSORIES.contains(&input.starter_accessory.as_str()) {
        return Err(CoreError::Invalid(format!(
            "invalid starter_accessory '{}'",
            input.starter_accessory
        )));
    }
    Ok(())
}

pub fn validate_custom_reward_input(mut input: CustomRewardInput) -> CoreResult<CustomRewardInput> {
    input.title = input.title.trim().to_string();
    let title_chars = input.title.chars().count();
    if title_chars == 0 || title_chars > CUSTOM_REWARD_MAX_TITLE_CHARS {
        return Err(CoreError::Invalid(format!(
            "custom reward title must be 1..={CUSTOM_REWARD_MAX_TITLE_CHARS} characters"
        )));
    }
    if input.notes.chars().count() > CUSTOM_REWARD_MAX_NOTES_CHARS {
        return Err(CoreError::Invalid(format!(
            "custom reward notes must be <= {CUSTOM_REWARD_MAX_NOTES_CHARS} characters"
        )));
    }
    if !(CUSTOM_REWARD_MIN_COST_CENTS..=CUSTOM_REWARD_MAX_COST_CENTS).contains(&input.cost_cents) {
        return Err(CoreError::Invalid(format!(
            "custom reward cost_cents must be {CUSTOM_REWARD_MIN_COST_CENTS}..={CUSTOM_REWARD_MAX_COST_CENTS}"
        )));
    }
    if !VALID_REWARD_ICONS.contains(&input.icon_key.as_str()) {
        return Err(CoreError::Invalid(format!(
            "invalid custom reward icon_key '{}'",
            input.icon_key
        )));
    }
    Ok(input)
}

pub fn validate_client_tx_id(client_tx_id: &str) -> CoreResult<&str> {
    let trimmed = client_tx_id.trim();
    if trimmed.is_empty()
        || trimmed.len() > 128
        || trimmed.contains(':')
        || trimmed.chars().any(char::is_whitespace)
    {
        return Err(CoreError::Invalid(
            "client_tx_id must be 1..=128 non-whitespace chars without ':'".into(),
        ));
    }
    Ok(trimmed)
}

pub fn validate_spend_history_limit(limit: Option<u32>) -> CoreResult<u32> {
    let lim = limit.unwrap_or(DEFAULT_SPEND_HISTORY_LIMIT);
    if lim == 0 || lim > MAX_SPEND_HISTORY_LIMIT {
        return Err(CoreError::Invalid(format!(
            "spend history limit must be 1..={MAX_SPEND_HISTORY_LIMIT}"
        )));
    }
    Ok(lim)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::progress::NIL_USER_ID;

    #[test]
    fn catalog_has_25_unique_items_with_valid_prices() {
        assert_eq!(GAME_CATALOG.len(), 25);
        let keys: HashSet<&str> = GAME_CATALOG.iter().map(|i| i.item_key).collect();
        assert_eq!(keys.len(), 25);
        assert!(GAME_CATALOG.iter().all(|i| i.price_cents > 0));
        let freeze = catalog_item(STREAK_FREEZE_ITEM_KEY).unwrap();
        assert_eq!(freeze.kind, SpendKind::FreezeToken);
        assert_eq!(freeze.price_cents, 2_500);
        assert!(catalog_item("head_hood_scholar").unwrap().hide_hair);
        assert!(catalog_item("hand_staff_quill").unwrap().two_handed);
    }

    #[test]
    fn rank_brackets_match_d41() {
        assert_eq!(rank_for_level(1), GameRank::Novice);
        assert_eq!(rank_for_level(4), GameRank::Novice);
        assert_eq!(rank_for_level(5), GameRank::Apprentice);
        assert_eq!(rank_for_level(9), GameRank::Apprentice);
        assert_eq!(rank_for_level(10), GameRank::Explorer);
        assert_eq!(rank_for_level(19), GameRank::Explorer);
        assert_eq!(rank_for_level(20), GameRank::Champion);
        assert_eq!(rank_for_level(34), GameRank::Champion);
        assert_eq!(rank_for_level(35), GameRank::Legend);
        assert_eq!(rank_for_level(99), GameRank::Legend);
    }

    #[test]
    fn available_gold_uses_saturating_floor() {
        assert_eq!(available_gold_cents(5_000, 2_500), 2_500);
        assert_eq!(available_gold_cents(1_000, 2_500), 0);
        assert_eq!(available_gold_cents(0, 0), 0);
    }

    #[test]
    fn deterministic_v5_ids_have_valid_uuid_layout() {
        let a = game_entity_id("inventory_item", NIL_USER_ID, "head_hood_scholar");
        let b = game_entity_id("inventory_item", NIL_USER_ID, "head_hood_scholar");
        let c = game_entity_id("inventory_item", NIL_USER_ID, "head_hat_adventurer");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(crate::productivity::is_valid_uuid(&a));
        assert_eq!(&a[14..15], "5");
    }

    #[test]
    fn study_streak_respects_today_in_progress_grace() {
        let days: HashSet<i32> = [1, 2, 3].into_iter().collect();
        assert_eq!(study_streak_from_days(&days, 3), (3, true));
        assert_eq!(study_streak_from_days(&days, 4), (3, false));
        assert_eq!(study_streak_from_days(&days, 5), (0, false));
    }

    #[test]
    fn default_avatar_profile_matches_canonical_defaults() {
        let profile = AvatarProfileDto::default();
        assert_eq!(profile.body_tone, "tone_2");
        assert_eq!(profile.hair_style, "hair_1");
        assert_eq!(profile.hair_color, "brown");
        assert_eq!(profile.starter_outfit, "tunic_slate");
        assert_eq!(profile.starter_accessory, "none");
    }
}
