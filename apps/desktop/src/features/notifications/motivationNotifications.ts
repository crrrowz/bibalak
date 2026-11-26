import type { MotivationStateDto } from "@bibalak/ipc-types";
import {
  formatMonthKey,
  formatQuestGold,
  formatQuestTitle,
} from "@/features/quests/questFormatting";
import { formatNumber, t } from "@/lib/i18n";
import { styleKey } from "@/lib/styles/styleKey";
import type { Style } from "@/stores/style";
import { pushNotification } from "./notificationStore";

/**
 * Compare previous and next `MotivationStateDto` snapshots and emit deduplicated
 * notifications for newly completed daily/weekly quests, earned monthly badges,
 * reached daily XP goals, and Game auto-freezes. Never fires for pre-existing
 * completion state on app start (`prev === null`).
 */
export function processMotivationSnapshot(
  prev: MotivationStateDto | null,
  next: MotivationStateDto,
  style: Style,
): { autoFrozeNow: boolean } {
  let autoFrozeNow = false;

  if (next.auto_frozen_day !== null) {
    pushNotification({
      kind: "freeze",
      title: t("notifications.kind.freeze"),
      body: t("motivation.notifications.autoFreezeBody"),
      link: "/streak",
      dedupeKey: `freeze:study:${next.auto_frozen_day}`,
    });
    autoFrozeNow = true;
  }

  if (prev === null) {
    return { autoFrozeNow };
  }

  const sameDay = prev.today_day_index === next.today_day_index;

  const goalJustMet = next.goal_met_today && (sameDay ? !prev.goal_met_today : true);
  if (goalJustMet) {
    pushNotification({
      kind: "goal",
      title: t(styleKey("motivation.notifications.goalReached", style)),
      body: t("motivation.goal.progress", {
        earned: formatNumber(next.today_xp),
        goal: formatNumber(next.daily_goal_xp),
      }),
      link: "/streak",
      dedupeKey: `goal:${next.today_day_index}`,
    });
  }

  const prevDailyById = new Map(prev.daily_quests.map((q) => [q.id, q]));
  for (const quest of next.daily_quests) {
    const prevQuest = prevDailyById.get(quest.id);
    const questJustDone =
      quest.completed && (sameDay ? prevQuest !== undefined && !prevQuest.completed : true);
    if (questJustDone) {
      pushNotification({
        kind: "quest",
        title: t(styleKey("motivation.notifications.questCompleted", style)),
        body: `${formatQuestTitle(quest)} · ${formatQuestGold(quest.reward_gold_cents, style)}`,
        link: "/quests",
        dedupeKey: `quest_daily:${next.today_day_index}:${quest.id}`,
      });
    }
  }

  const prevWeekEnd = prev.today_day_index + prev.days_remaining_in_week;
  const nextWeekEnd = next.today_day_index + next.days_remaining_in_week;
  const sameWeekAndQuest =
    prevWeekEnd === nextWeekEnd && prev.weekly_quest.id === next.weekly_quest.id;
  const weeklyJustDone =
    next.weekly_quest.completed && (sameWeekAndQuest ? !prev.weekly_quest.completed : true);
  if (weeklyJustDone) {
    pushNotification({
      kind: "quest",
      title: t(styleKey("motivation.notifications.weeklyQuestCompleted", style)),
      body: `${formatQuestTitle(next.weekly_quest)} · ${formatQuestGold(
        next.weekly_quest.reward_gold_cents,
        style,
      )}`,
      link: "/quests",
      dedupeKey: `quest_weekly:${nextWeekEnd}:${next.weekly_quest.id}`,
    });
  }

  const sameMonth = prev.monthly_badge.month_key === next.monthly_badge.month_key;
  const badgeJustEarned =
    next.monthly_badge.earned && (sameMonth ? !prev.monthly_badge.earned : true);
  if (badgeJustEarned) {
    pushNotification({
      kind: "quest",
      title: t(styleKey("motivation.notifications.monthlyBadge", style)),
      body: `${formatMonthKey(next.monthly_badge.month_key)} · ${formatQuestGold(
        next.monthly_badge.reward_gold_cents,
        style,
      )}`,
      link: "/quests",
      dedupeKey: `badge_monthly:${next.monthly_badge.month_key}`,
    });
  }

  return { autoFrozeNow };
}
