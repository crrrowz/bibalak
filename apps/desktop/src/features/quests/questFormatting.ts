import type { QuestDto, QuestMetric } from "@bibalak/ipc-types";
import { formatDate, formatNumber, t, tn, type PluralKey } from "@/lib/i18n";
import { formatPoints } from "@/lib/styles/scholar";
import { styleKey } from "@/lib/styles/styleKey";
import type { Style } from "@/stores/style";

const METRIC_PLURAL_KEYS: Partial<Record<QuestMetric, PluralKey>> = {
  reviews: "motivation.quests.tpl.reviews",
  minutes: "motivation.quests.tpl.minutes",
  new_cards: "motivation.quests.tpl.newCards",
  tasks: "motivation.quests.tpl.tasks",
  habits: "motivation.quests.tpl.habits",
  active_days: "motivation.quests.tpl.activeDays",
  tasks_or_habits: "motivation.quests.tpl.planItems",
};

/** Format a quest's localized objective label using six-form Arabic plurals. */
export function formatQuestTitle(quest: Pick<QuestDto, "metric" | "target">): string {
  if (quest.metric === "xp") {
    return t("motivation.quests.tpl.xp", { count: formatNumber(quest.target) });
  }
  const key = METRIC_PLURAL_KEYS[quest.metric];
  if (!key) return String(quest.target);
  return tn(key, quest.target);
}

/** Format a gold reward chip in the active style's currency wording. */
export function formatQuestGold(goldCents: number, style: Style): string {
  return t(styleKey("motivation.quests.goldReward", style), {
    gold: formatPoints(goldCents),
  });
}

/** Format a backend `YYYY-MM` month key in the active locale without UTC shift. */
export function formatMonthKey(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  return formatDate(new Date(Number(match[1]), Number(match[2]) - 1, 1), {
    month: "long",
    year: "numeric",
  });
}
