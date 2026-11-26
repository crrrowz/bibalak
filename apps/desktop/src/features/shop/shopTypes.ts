import type { CustomRewardInput } from "@bibalak/ipc-types";

export type RewardSubmitHandler = (input: CustomRewardInput) => Promise<void>;

export const REWARD_ICON_KEYS = [
  "gift",
  "coffee",
  "film",
  "gamepad",
  "music",
  "book",
  "sun",
  "sparkles",
] as const;

export type RewardIconKey = (typeof REWARD_ICON_KEYS)[number];
