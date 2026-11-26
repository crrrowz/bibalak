import { useContext, useEffect, useRef } from "react";
import {
  QueryClient,
  QueryClientContext,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { MotivationStateDto, QuestDto } from "@bibalak/ipc-types";
import { formatNumber, t, tn } from "@/lib/i18n";
import { ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { useStyle } from "@/stores/style";

const FALLBACK_QUERY_CLIENT = new QueryClient({ defaultOptions: { queries: { retry: false } } });

export const DAILY_GOAL_XP_CHOICES = [10, 20, 30, 50] as const;
export type DailyGoalChoice = (typeof DAILY_GOAL_XP_CHOICES)[number];

/** Format a quest's localized template string from its metric and target. */
export function questTitle(quest: Pick<QuestDto, "metric" | "target">): string {
  const count = formatNumber(quest.target);
  switch (quest.metric) {
    case "reviews":
      return tn("motivation.quests.tpl.reviews", quest.target, { count });
    case "minutes":
      return tn("motivation.quests.tpl.minutes", quest.target, { count });
    case "new_cards":
      return tn("motivation.quests.tpl.newCards", quest.target, { count });
    case "tasks":
      return tn("motivation.quests.tpl.tasks", quest.target, { count });
    case "habits":
      return tn("motivation.quests.tpl.habits", quest.target, { count });
    case "xp":
      return t("motivation.quests.tpl.xp", { count });
    case "active_days":
      return tn("motivation.quests.tpl.activeDays", quest.target, { count });
    case "tasks_or_habits":
      return tn("motivation.quests.tpl.planItems", quest.target, { count });
  }
}

/** Parse `{ year, month }` from a backend `YYYY-MM-DD` date string. */
export function splitIsoDate(iso: string | undefined): { year: number; month: number } {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (match) {
    return { year: Number(match[1]), month: Number(match[2]) };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** Read-only query for the daily motivation state (goal, quests, streak, comeback). */
export function useMotivationState(enabled = true) {
  const style = useStyle((s) => s.style);
  const ctxClient = useContext(QueryClientContext);
  const prevStyleRef = useRef(style);

  useEffect(() => {
    if (prevStyleRef.current !== style) {
      prevStyleRef.current = style;
      if (ctxClient && isTauri() && enabled) {
        void ctxClient.invalidateQueries({ queryKey: queryKeys.motivationState });
      }
    }
  }, [style, enabled, ctxClient]);

  return useQuery(
    {
      queryKey: queryKeys.motivationState,
      queryFn: () => ipc.getMotivationState(style),
      enabled: Boolean(ctxClient) && isTauri() && enabled,
    },
    ctxClient ?? FALLBACK_QUERY_CLIENT,
  );
}

/** Update the synced daily XP goal (`10 / 20 / 30 / 50`) and refresh dependent caches. */
export function useSetDailyGoal() {
  const ctxClient = useContext(QueryClientContext);
  const client = ctxClient ?? FALLBACK_QUERY_CLIENT;
  return useMutation(
    {
      mutationFn: (goalXp: number) => ipc.setDailyGoal(goalXp),
      onSuccess: (data) => {
        client.setQueryData(queryKeys.motivationState, data);
        void client.invalidateQueries({ queryKey: queryKeys.streakCalendarAll });
      },
    },
    client,
  );
}

/** Read-only query for a month of the `/streak` calendar. */
export function useStreakCalendar(year: number, month: number, enabled = true) {
  const ctxClient = useContext(QueryClientContext);
  return useQuery(
    {
      queryKey: queryKeys.streakCalendar(year, month),
      queryFn: () => ipc.getStreakCalendar(year, month),
      enabled: Boolean(ctxClient) && isTauri() && enabled,
    },
    ctxClient ?? FALLBACK_QUERY_CLIENT,
  );
}

/** Apply a manual Streak Freeze to an eligible grace day (`today - 1` or `today - 2`). */
export function useFreezeStudyDay() {
  const ctxClient = useContext(QueryClientContext);
  const client = ctxClient ?? FALLBACK_QUERY_CLIENT;
  return useMutation(
    {
      mutationFn: (dayIndex: number) => ipc.freezeStudyDay(dayIndex),
      onSuccess: (data) => {
        client.setQueryData(queryKeys.streakCalendar(data.year, data.month), data);
        void client.invalidateQueries({ queryKey: queryKeys.motivationState });
        void client.invalidateQueries({ queryKey: queryKeys.streakCalendarAll });
        void client.invalidateQueries({ queryKey: queryKeys.gameState });
      },
    },
    client,
  );
}

/** Dismiss the active comeback offer for the current return window. */
export function useDismissComebackOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => ipc.dismissComebackOffer(),
    onSuccess: () => {
      queryClient.setQueryData<MotivationStateDto | undefined>(queryKeys.motivationState, (prev) =>
        prev ? { ...prev, comeback_offer: null } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.motivationState });
    },
  });
}
