import type { PluralKey } from "@/lib/i18n";
import type { LocaleKey } from "@/locales/en";
import type { Style } from "@/stores/style";
import {
  GAME_LEVEL_SEEN_KEY,
  GAME_RANK_SEEN_KEY,
  GAME_RANK_TIERS,
  gameRankByIndex,
  gameRankIndex,
} from "./game";
import {
  SCHOLAR_TITLE_SEEN_KEY,
  SCHOLAR_TITLE_TIERS,
  scholarTitleByIndex,
  scholarTitleIndex,
} from "./scholar";

export type ActiveSkinId = "game" | "scholar";

export interface SkinRankInfo {
  index: number;
  labelKey: LocaleKey;
}

export interface StyleSkin {
  id: ActiveSkinId;
  rankForLevel: (level: number) => SkinRankInfo;
  rankByIndex: (index: number) => SkinRankInfo;
  hud: {
    ariaLabelKey: LocaleKey;
    rankLevelKey: LocaleKey;
    streakKeyBase: PluralKey;
    showFreezes: boolean;
    currencyUnit: "gold" | "knowledgePoints";
    avatarLinkTo: "/character";
    currencyLinkTo: "/shop" | "/transcript";
    freezeLinkTo: "/plan/habits" | null;
    levelFontClass?: string;
    containerClass: string;
    xpFillClass: string;
    currencyClass: string;
  };
  avatar: {
    backdropKey: string;
    outfitForLevel: (level: number) => {
      back?: string;
      outfit: string;
      head?: string;
    };
  };
  celebration: {
    levelSeenStorageKey: string;
    tierSeenStorageKey: string;
    levelUpTitleKey: LocaleKey;
    levelUpBodyKey: LocaleKey;
    tierUpMode: "game_rank" | "scholar_certificate";
    tierUpTitleKey: LocaleKey;
    closeKey: LocaleKey;
  };
  progressPanel: {
    todayHeadingKey?: LocaleKey;
    yesterdayHeadingKey: LocaleKey;
  };
}

const SCHOLAR_LEVEL_SEEN_KEY = "keepsake-scholar-level-seen";

const GAME_SKIN: StyleSkin = {
  id: "game",
  rankForLevel: (level) => {
    const idx = gameRankIndex(level);
    return { index: idx, labelKey: gameRankByIndex(idx) };
  },
  rankByIndex: (index) => ({
    index: Math.max(0, Math.min(GAME_RANK_TIERS.length - 1, index)),
    labelKey: gameRankByIndex(index),
  }),
  hud: {
    ariaLabelKey: "game.hud.aria",
    rankLevelKey: "game.hud.rankLevel",
    streakKeyBase: "game.hud.streak",
    showFreezes: true,
    currencyUnit: "gold",
    avatarLinkTo: "/character",
    currencyLinkTo: "/shop",
    freezeLinkTo: "/plan/habits",
    levelFontClass: "game-hud-level",
    containerClass: "glass-chrome border-b border-border px-4 py-2 sm:px-6",
    xpFillClass: "bg-[hsl(var(--game-xp))]",
    currencyClass: "text-[hsl(var(--game-gold))]",
  },
  avatar: {
    backdropKey: "backdrop_lamp",
    outfitForLevel: () => ({ outfit: "tunic_slate" }),
  },
  celebration: {
    levelSeenStorageKey: GAME_LEVEL_SEEN_KEY,
    tierSeenStorageKey: GAME_RANK_SEEN_KEY,
    levelUpTitleKey: "game.celebration.levelUp",
    levelUpBodyKey: "game.celebration.levelUpBody",
    tierUpMode: "game_rank",
    tierUpTitleKey: "game.celebration.rankUp",
    closeKey: "game.celebration.close",
  },
  progressPanel: {
    todayHeadingKey: "game.todayLoot",
    yesterdayHeadingKey: "progress.yesterday.heading.game",
  },
};

const SCHOLAR_SKIN: StyleSkin = {
  id: "scholar",
  rankForLevel: (level) => {
    const idx = scholarTitleIndex(level);
    return { index: idx, labelKey: scholarTitleByIndex(idx) };
  },
  rankByIndex: (index) => ({
    index: Math.max(0, Math.min(SCHOLAR_TITLE_TIERS.length - 1, index)),
    labelKey: scholarTitleByIndex(index),
  }),
  hud: {
    ariaLabelKey: "scholar.hud.aria",
    rankLevelKey: "progress.scholarLevel",
    streakKeyBase: "scholar.hud.streak",
    showFreezes: false,
    currencyUnit: "knowledgePoints",
    avatarLinkTo: "/character",
    currencyLinkTo: "/transcript",
    freezeLinkTo: null,
    containerClass: "glass-chrome border-b border-border px-4 py-2 sm:px-6",
    xpFillClass: "bg-primary",
    currencyClass: "text-foreground",
  },
  avatar: {
    backdropKey: "backdrop_scholar_library",
    outfitForLevel: (level) => {
      const idx = scholarTitleIndex(level);
      if (idx === 0) return { outfit: "scholar_gown_student" };
      if (idx === 1) return { back: "scholar_satchel", outfit: "scholar_gown_student" };
      if (idx === 2) return { back: "scholar_satchel", outfit: "scholar_gown_lecturer" };
      if (idx === 3) {
        return { back: "scholar_satchel", outfit: "scholar_gown_lecturer", head: "scholar_cap" };
      }
      return { back: "scholar_satchel", outfit: "scholar_robe_professor", head: "scholar_cap" };
    },
  },
  celebration: {
    levelSeenStorageKey: SCHOLAR_LEVEL_SEEN_KEY,
    tierSeenStorageKey: SCHOLAR_TITLE_SEEN_KEY,
    levelUpTitleKey: "scholar.celebration.levelUp",
    levelUpBodyKey: "scholar.celebration.levelUpBody",
    tierUpMode: "scholar_certificate",
    tierUpTitleKey: "scholar.certificate.heading",
    closeKey: "scholar.certificate.close",
  },
  progressPanel: {
    yesterdayHeadingKey: "progress.yesterday.heading",
  },
};

const SKINS: Record<ActiveSkinId, StyleSkin> = {
  game: GAME_SKIN,
  scholar: SCHOLAR_SKIN,
};

/**
 * Return the active presentation skin for "game" or "scholar", or `null` in "default".
 */
export function getStyleSkin(style: Style): StyleSkin | null {
  if (style === "game" || style === "scholar") {
    return SKINS[style];
  }
  return null;
}
