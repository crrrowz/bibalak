import type { GameRank } from "@bibalak/ipc-types";
import type { LocaleKey } from "@/locales/en";

export const GAME_LEVEL_SEEN_KEY = "keepsake-game-level-seen";
export const GAME_RANK_SEEN_KEY = "keepsake-game-rank-seen";

export const GAME_RANK_TIERS: ReadonlyArray<{
  index: number;
  minLevel: number;
  rank: GameRank;
  key: LocaleKey;
}> = [
  { index: 0, minLevel: 1, rank: "novice", key: "game.rank.novice" },
  { index: 1, minLevel: 5, rank: "apprentice", key: "game.rank.apprentice" },
  { index: 2, minLevel: 10, rank: "explorer", key: "game.rank.explorer" },
  { index: 3, minLevel: 20, rank: "champion", key: "game.rank.champion" },
  { index: 4, minLevel: 35, rank: "legend", key: "game.rank.legend" },
];

/** Map an engine level (1+) to its Game rank locale key. */
export function gameRank(level: number): LocaleKey {
  for (let i = GAME_RANK_TIERS.length - 1; i >= 0; i -= 1) {
    if (level >= GAME_RANK_TIERS[i].minLevel) return GAME_RANK_TIERS[i].key;
  }
  return "game.rank.novice";
}

/** Map an engine level (1+) to its 0-based Game rank index (0..4). */
export function gameRankIndex(level: number): number {
  for (let i = GAME_RANK_TIERS.length - 1; i >= 0; i -= 1) {
    if (level >= GAME_RANK_TIERS[i].minLevel) return GAME_RANK_TIERS[i].index;
  }
  return 0;
}

/** Map a 0-based Game rank index back to its locale key. */
export function gameRankByIndex(index: number): LocaleKey {
  return GAME_RANK_TIERS[index]?.key ?? "game.rank.novice";
}
