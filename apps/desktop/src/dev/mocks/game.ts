import type {
  AvatarProfileDto,
  AvatarProfileInput,
  CustomRewardDto,
  CustomRewardInput,
  EquipmentSlot,
  GameStateDto,
  PurchaseResultDto,
  ShopItemDto,
  SpendHistoryEntryDto,
} from "@bibalak/ipc-types";

const BASE_CATALOG: Omit<ShopItemDto, "owned" | "equipped">[] = [
  {
    item_key: "streak_freeze",
    slot: null,
    kind: "freeze_token",
    price_cents: 2_500,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "head_hood_scholar",
    slot: "head",
    kind: "cosmetic",
    price_cents: 2_500,
    hide_hair: true,
    two_handed: false,
  },
  {
    item_key: "head_hat_adventurer",
    slot: "head",
    kind: "cosmetic",
    price_cents: 4_500,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "head_circlet_brass",
    slot: "head",
    kind: "cosmetic",
    price_cents: 7_500,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "head_crown_star",
    slot: "head",
    kind: "cosmetic",
    price_cents: 12_000,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "outfit_cloak_green",
    slot: "outfit",
    kind: "cosmetic",
    price_cents: 3_000,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "outfit_coat_guild",
    slot: "outfit",
    kind: "cosmetic",
    price_cents: 6_000,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "outfit_robe_velvet",
    slot: "outfit",
    kind: "cosmetic",
    price_cents: 9_500,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "outfit_tunic_royal",
    slot: "outfit",
    kind: "cosmetic",
    price_cents: 15_000,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "hand_wand_oak",
    slot: "main_hand",
    kind: "cosmetic",
    price_cents: 2_500,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "hand_compass_brass",
    slot: "main_hand",
    kind: "cosmetic",
    price_cents: 5_500,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "hand_staff_quill",
    slot: "main_hand",
    kind: "cosmetic",
    price_cents: 9_500,
    hide_hair: false,
    two_handed: true,
  },
  {
    item_key: "hand_sabre_guild",
    slot: "main_hand",
    kind: "cosmetic",
    price_cents: 16_000,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "off_lantern_warm",
    slot: "off_hand",
    kind: "cosmetic",
    price_cents: 2_000,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "off_buckler_oak",
    slot: "off_hand",
    kind: "cosmetic",
    price_cents: 5_000,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "off_tome_runed",
    slot: "off_hand",
    kind: "cosmetic",
    price_cents: 9_000,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "back_satchel_canvas",
    slot: "back",
    kind: "cosmetic",
    price_cents: 3_500,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "back_cape_crimson",
    slot: "back",
    kind: "cosmetic",
    price_cents: 7_500,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "back_mantle_star",
    slot: "back",
    kind: "cosmetic",
    price_cents: 14_000,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "acc_monocle_amber",
    slot: "accessory",
    kind: "cosmetic",
    price_cents: 1_500,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "acc_scarf_stripe",
    slot: "accessory",
    kind: "cosmetic",
    price_cents: 3_500,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "acc_pin_laurel",
    slot: "accessory",
    kind: "cosmetic",
    price_cents: 6_000,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "bg_night_library",
    slot: "backdrop",
    kind: "cosmetic",
    price_cents: 4_000,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "bg_mountain_camp",
    slot: "backdrop",
    kind: "cosmetic",
    price_cents: 8_000,
    hide_hair: false,
    two_handed: false,
  },
  {
    item_key: "bg_observatory",
    slot: "backdrop",
    kind: "cosmetic",
    price_cents: 12_000,
    hide_hair: false,
    two_handed: false,
  },
];

const ALL_SLOTS: EquipmentSlot[] = [
  "head",
  "outfit",
  "main_hand",
  "off_hand",
  "back",
  "accessory",
  "backdrop",
  "frame",
];

let avatar: AvatarProfileDto = {
  body_tone: "tone_2",
  hair_style: "hair_1",
  hair_color: "brown",
  starter_outfit: "tunic_slate",
  starter_accessory: "none",
};

const equippedMap = new Map<EquipmentSlot, string | null>(
  ALL_SLOTS.map((slot) => [slot, slot === "outfit" ? "outfit_cloak_green" : null]),
);

const ownedKeys = new Set<string>(["head_hood_scholar", "outfit_cloak_green", "off_lantern_warm"]);

const earnedGoldCents = 4_750;
let spentGoldCents = 0;
let freezeTokensHeld = 2;
const FREEZE_TOKEN_CAP = 3;

let customRewards: CustomRewardDto[] = [
  {
    id: "reward-1",
    title: "Watch one episode",
    notes: "After finishing today's reviews",
    cost_cents: 2_500,
    icon_key: "film",
    sort_order: 1,
    claim_count: 1,
  },
  {
    id: "reward-2",
    title: "Specialty coffee",
    notes: "",
    cost_cents: 1_500,
    icon_key: "coffee",
    sort_order: 2,
    claim_count: 2,
  },
];

let spendHistory: SpendHistoryEntryDto[] = [
  {
    spend_id: "spend-seed-1",
    kind: "cosmetic",
    ref_key: "outfit_cloak_green",
    label: "outfit_cloak_green",
    amount_cents: 3_000,
    created_at: Date.now() - 86_400_000,
    refundable: false,
  },
];

const seenClientTx = new Map<string, string>();
let rewardCounter = 3;
let spendCounter = 2;

function buildGameState(): GameStateDto {
  const available = Math.max(0, earnedGoldCents - spentGoldCents);
  const equippedValues = new Set(
    Array.from(equippedMap.values()).filter((v): v is string => v !== null),
  );
  return {
    level: 4,
    xp_into_level: 120,
    xp_to_next_level: 250,
    total_xp: 570,
    earned_gold_cents: earnedGoldCents,
    spent_gold_cents: spentGoldCents,
    available_gold_cents: available,
    study_streak: 6,
    studied_today: true,
    freeze_tokens_held: freezeTokensHeld,
    freeze_token_cap: FREEZE_TOKEN_CAP,
    avatar: { ...avatar },
    equipped: ALL_SLOTS.map((slot) => ({ slot, item_key: equippedMap.get(slot) ?? null })),
    owned_item_keys: Array.from(ownedKeys),
    catalog: BASE_CATALOG.map((item) => ({
      ...item,
      owned: item.kind === "cosmetic" ? ownedKeys.has(item.item_key) : false,
      equipped: equippedValues.has(item.item_key),
    })),
  };
}

export const mockGameState: GameStateDto = buildGameState();

export const gameMocks: Record<string, unknown> = {
  get_game_state: (): GameStateDto => buildGameState(),

  update_avatar_profile: (args?: { input?: AvatarProfileInput }): AvatarProfileDto => {
    if (args?.input) {
      avatar = { ...args.input };
    }
    return { ...avatar };
  },

  equip_game_item: (args?: { slot?: EquipmentSlot; itemKey?: string }): GameStateDto => {
    if (args?.slot && args?.itemKey && ownedKeys.has(args.itemKey)) {
      equippedMap.set(args.slot, args.itemKey);
    }
    return buildGameState();
  },

  unequip_game_slot: (args?: { slot?: EquipmentSlot }): GameStateDto => {
    if (args?.slot) {
      equippedMap.set(args.slot, null);
    }
    return buildGameState();
  },

  buy_shop_item: (args?: { itemKey?: string; clientTxId?: string }): PurchaseResultDto => {
    const itemKey = args?.itemKey ?? "";
    const clientTxId = args?.clientTxId ?? `tx-${spendCounter}`;
    const existingSpendId = seenClientTx.get(clientTxId);
    if (existingSpendId) {
      return { spend_id: existingSpendId, state: buildGameState() };
    }
    const item = BASE_CATALOG.find((c) => c.item_key === itemKey);
    if (!item) {
      throw new Error(`Unknown shop item: ${itemKey}`);
    }
    const available = Math.max(0, earnedGoldCents - spentGoldCents);
    if (available < item.price_cents) {
      throw new Error("Insufficient gold");
    }
    if (item.kind === "freeze_token") {
      if (freezeTokensHeld >= FREEZE_TOKEN_CAP) {
        throw new Error("Freeze token cap reached");
      }
      freezeTokensHeld += 1;
    } else {
      if (ownedKeys.has(item.item_key)) {
        throw new Error("Item already owned");
      }
      ownedKeys.add(item.item_key);
    }
    spentGoldCents += item.price_cents;
    const spendId = `spend-${spendCounter++}`;
    seenClientTx.set(clientTxId, spendId);
    spendHistory = [
      {
        spend_id: spendId,
        kind: item.kind,
        ref_key: item.item_key,
        label: item.item_key,
        amount_cents: item.price_cents,
        created_at: Date.now(),
        refundable: true,
      },
      ...spendHistory,
    ];
    return { spend_id: spendId, state: buildGameState() };
  },

  refund_shop_purchase: (args?: { spendId?: string }): GameStateDto => {
    const entry = spendHistory.find((e) => e.spend_id === args?.spendId);
    if (!entry || !entry.refundable) {
      throw new Error("Purchase cannot be refunded");
    }
    spentGoldCents = Math.max(0, spentGoldCents - entry.amount_cents);
    if (entry.kind === "freeze_token") {
      freezeTokensHeld = Math.max(0, freezeTokensHeld - 1);
    } else if (entry.kind === "cosmetic") {
      ownedKeys.delete(entry.ref_key);
      for (const [slot, equippedKey] of equippedMap.entries()) {
        if (equippedKey === entry.ref_key) {
          equippedMap.set(slot, null);
        }
      }
    }
    spendHistory = spendHistory.filter((e) => e.spend_id !== entry.spend_id);
    return buildGameState();
  },

  list_custom_rewards: (): CustomRewardDto[] => customRewards.map((r) => ({ ...r })),

  create_custom_reward: (args?: { input?: CustomRewardInput }): CustomRewardDto => {
    const input = args?.input;
    if (!input) throw new Error("Missing custom reward input");
    const created: CustomRewardDto = {
      id: `reward-${rewardCounter++}`,
      title: input.title.trim(),
      notes: input.notes.trim(),
      cost_cents: input.cost_cents,
      icon_key: input.icon_key,
      sort_order: input.sort_order ?? customRewards.length + 1,
      claim_count: 0,
    };
    customRewards = [...customRewards, created];
    return { ...created };
  },

  update_custom_reward: (args?: { id?: string; input?: CustomRewardInput }): CustomRewardDto => {
    const idx = customRewards.findIndex((r) => r.id === args?.id);
    if (idx === -1 || !args?.input) throw new Error("Custom reward not found");
    const updated: CustomRewardDto = {
      ...customRewards[idx],
      title: args.input.title.trim(),
      notes: args.input.notes.trim(),
      cost_cents: args.input.cost_cents,
      icon_key: args.input.icon_key,
      sort_order: args.input.sort_order ?? customRewards[idx].sort_order,
    };
    customRewards = customRewards.map((r) => (r.id === updated.id ? updated : r));
    return { ...updated };
  },

  delete_custom_reward: (args?: { id?: string }): void => {
    customRewards = customRewards.filter((r) => r.id !== args?.id);
  },

  claim_custom_reward: (args?: { id?: string; clientTxId?: string }): PurchaseResultDto => {
    const reward = customRewards.find((r) => r.id === args?.id);
    if (!reward) throw new Error("Custom reward not found");
    const clientTxId = args?.clientTxId ?? `tx-${spendCounter}`;
    const existingSpendId = seenClientTx.get(clientTxId);
    if (existingSpendId) {
      return { spend_id: existingSpendId, state: buildGameState() };
    }
    const available = Math.max(0, earnedGoldCents - spentGoldCents);
    if (available < reward.cost_cents) {
      throw new Error("Insufficient gold");
    }
    spentGoldCents += reward.cost_cents;
    customRewards = customRewards.map((r) =>
      r.id === reward.id ? { ...r, claim_count: r.claim_count + 1 } : r,
    );
    const spendId = `spend-${spendCounter++}`;
    seenClientTx.set(clientTxId, spendId);
    spendHistory = [
      {
        spend_id: spendId,
        kind: "custom_reward",
        ref_key: reward.id,
        label: reward.title,
        amount_cents: reward.cost_cents,
        created_at: Date.now(),
        refundable: true,
      },
      ...spendHistory,
    ];
    return { spend_id: spendId, state: buildGameState() };
  },

  list_spend_history: (args?: { limit?: number | null }): SpendHistoryEntryDto[] => {
    const limit = typeof args?.limit === "number" ? Math.max(1, Math.min(500, args.limit)) : 50;
    return spendHistory.slice(0, limit).map((e) => ({ ...e }));
  },
};
