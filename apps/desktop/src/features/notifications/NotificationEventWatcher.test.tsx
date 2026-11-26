import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import type { GameStateDto, MotivationStateDto, SpendHistoryEntryDto } from "@bibalak/ipc-types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { NotificationEventWatcher } from "./NotificationEventWatcher";
import { initNotificationsFromStorage, useNotificationStore } from "./notificationStore";

function makeSpend(id: string, label: string, cents: number): SpendHistoryEntryDto {
  return {
    spend_id: id,
    kind: "freeze_token",
    ref_key: "streak_freeze",
    label,
    amount_cents: cents,
    created_at: 1000,
    refundable: true,
  };
}

function makeMotivationState(overrides?: Partial<MotivationStateDto>): MotivationStateDto {
  return {
    daily_goal_xp: 20,
    today_xp: 10,
    goal_met_today: false,
    current_streak: 4,
    best_streak: 10,
    studied_today: true,
    next_milestone: 7,
    today_day_index: 365,
    today_date: "2026-11-24",
    days_remaining_in_week: 3,
    daily_quests: [
      {
        id: "reviews_15",
        kind: "daily",
        metric: "reviews",
        progress: 10,
        target: 15,
        completed: false,
        reward_gold_cents: 200,
      },
      {
        id: "new_5",
        kind: "daily",
        metric: "new_cards",
        progress: 2,
        target: 5,
        completed: false,
        reward_gold_cents: 200,
      },
      {
        id: "tasks_2",
        kind: "daily",
        metric: "tasks",
        progress: 0,
        target: 2,
        completed: false,
        reward_gold_cents: 200,
      },
    ],
    weekly_quest: {
      id: "w_reviews_150",
      kind: "weekly",
      metric: "reviews",
      progress: 80,
      target: 150,
      completed: false,
      reward_gold_cents: 1000,
    },
    monthly_badge: {
      month_key: "2026-11",
      completed_daily_quests: 19,
      target_daily_quests: 20,
      earned: false,
      earned_at: null,
      seen: true,
      reward_gold_cents: 1000,
    },
    earned_monthly_badges: [],
    comeback_offer: null,
    onboarding_completed: true,
    auto_frozen_day: null,
    ...overrides,
  };
}

function makeGameState(freezeTokensHeld: number): GameStateDto {
  return {
    level: 4,
    xp_into_level: 100,
    xp_to_next_level: 250,
    total_xp: 550,
    earned_gold_cents: 4750,
    spent_gold_cents: 0,
    available_gold_cents: 4750,
    study_streak: 6,
    studied_today: true,
    freeze_tokens_held: freezeTokensHeld,
    freeze_token_cap: 3,
    avatar: {
      body_tone: "tone_1",
      hair_style: "hair_1",
      hair_color: "black",
      starter_outfit: "tunic_slate",
      starter_accessory: "none",
    },
    equipped: [],
    owned_item_keys: [],
    catalog: [],
  };
}

describe("NotificationEventWatcher (16h)", () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale("en");
    initNotificationsFromStorage();
  });

  afterEach(() => {
    localStorage.clear();
    setLocale("en");
  });

  it("records purchases, refunds, and freeze usage from query updates", () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.spendHistory, [makeSpend("s-1", "Forest Cloak", 5000)]);
    client.setQueryData(queryKeys.gameState, makeGameState(2));

    render(
      <QueryClientProvider client={client}>
        <NotificationEventWatcher />
      </QueryClientProvider>,
    );

    // Initial seed should not notify retroactively.
    expect(useNotificationStore.getState().items).toHaveLength(0);

    // Purchase added
    act(() => {
      client.setQueryData(queryKeys.spendHistory, [
        makeSpend("s-2", "Streak Freeze", 2500),
        makeSpend("s-1", "Forest Cloak", 5000),
      ]);
    });
    expect(useNotificationStore.getState().items[0]).toMatchObject({
      kind: "purchase",
      body: "Purchased Streak Freeze · -25 gold",
      link: "/shop",
    });

    // Refund (s-2 removed)
    act(() => {
      client.setQueryData(queryKeys.spendHistory, [makeSpend("s-1", "Forest Cloak", 5000)]);
    });
    expect(useNotificationStore.getState().items[0]).toMatchObject({
      kind: "refund",
      body: "Refunded Streak Freeze · +25 gold",
      link: "/shop",
    });
  });

  it("bw2_1_resolves_cosmetic_display_name_instead_of_raw_item_key", () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.spendHistory, []);

    render(
      <QueryClientProvider client={client}>
        <NotificationEventWatcher />
      </QueryClientProvider>,
    );

    act(() => {
      client.setQueryData(queryKeys.spendHistory, [
        {
          spend_id: "s-hood",
          kind: "cosmetic",
          ref_key: "head_hood_scholar",
          label: "head_hood_scholar",
          amount_cents: 2500,
          created_at: 2000,
          refundable: true,
        } satisfies SpendHistoryEntryDto,
      ]);
    });

    const latest = useNotificationStore.getState().items[0];
    expect(latest?.body).toContain("Traveller Hood");
    expect(latest?.body).not.toContain("head_hood_scholar");
  });

  it("records streak freeze usage when freeze_tokens_held decreases", () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.gameState, makeGameState(2));

    render(
      <QueryClientProvider client={client}>
        <NotificationEventWatcher />
      </QueryClientProvider>,
    );

    act(() => {
      client.setQueryData(queryKeys.gameState, makeGameState(2));
    });
    expect(useNotificationStore.getState().items).toHaveLength(0);

    act(() => {
      client.setQueryData(queryKeys.gameState, makeGameState(1));
    });
    expect(useNotificationStore.getState().items[0]).toMatchObject({
      kind: "freeze",
      title: "Streak freeze used",
      link: "/plan/habits",
    });
  });

  it("completed_quest_and_monthly_badge_emit_notification_once", () => {
    const client = new QueryClient();
    const initial = makeMotivationState();
    client.setQueryData(queryKeys.motivationState, initial);

    render(
      <QueryClientProvider client={client}>
        <NotificationEventWatcher />
      </QueryClientProvider>,
    );
    expect(useNotificationStore.getState().items).toHaveLength(0);

    const completedSnapshot = makeMotivationState({
      daily_quests: [
        { ...initial.daily_quests[0]!, progress: 15, completed: true },
        initial.daily_quests[1]!,
        initial.daily_quests[2]!,
      ],
      weekly_quest: { ...initial.weekly_quest, progress: 150, completed: true },
      monthly_badge: {
        ...initial.monthly_badge,
        completed_daily_quests: 20,
        earned: true,
        earned_at: 1000,
        seen: false,
      },
    });

    act(() => {
      client.setQueryData(queryKeys.motivationState, completedSnapshot);
    });

    const itemsAfterFirst = useNotificationStore.getState().items;
    expect(itemsAfterFirst.filter((i) => i.kind === "quest")).toHaveLength(3);
    for (const item of itemsAfterFirst) {
      expect(item.link).toBe("/quests");
    }

    // Re-emitting the same completed snapshot (or after undo + redo on the same day) deduplicates cleanly.
    act(() => {
      client.setQueryData(queryKeys.motivationState, initial);
    });
    act(() => {
      client.setQueryData(queryKeys.motivationState, completedSnapshot);
    });

    expect(useNotificationStore.getState().items.filter((i) => i.kind === "quest")).toHaveLength(3);
  });

  it("goal_reached_and_auto_freeze_notify_once_not_on_app_start", () => {
    const client = new QueryClient();
    const alreadyDoneAtStart = makeMotivationState({
      today_xp: 30,
      goal_met_today: true,
      daily_quests: [
        {
          id: "reviews_15",
          kind: "daily",
          metric: "reviews",
          progress: 20,
          target: 15,
          completed: true,
          reward_gold_cents: 200,
        },
        makeMotivationState().daily_quests[1]!,
        makeMotivationState().daily_quests[2]!,
      ],
      weekly_quest: { ...makeMotivationState().weekly_quest, progress: 150, completed: true },
      monthly_badge: {
        ...makeMotivationState().monthly_badge,
        completed_daily_quests: 20,
        earned: true,
        earned_at: 1000,
        seen: true,
      },
      auto_frozen_day: null,
    });

    render(
      <QueryClientProvider client={client}>
        <NotificationEventWatcher />
      </QueryClientProvider>,
    );

    // First query arrival on app start: already-true states must NOT notify.
    act(() => {
      client.setQueryData(queryKeys.motivationState, alreadyDoneAtStart);
    });
    expect(useNotificationStore.getState().items).toHaveLength(0);

    // Next day / fresh state -> goal reached + auto_frozen_day fires once each, linked to /streak.
    const nextDayBeforeGoal = makeMotivationState({
      today_day_index: 366,
      today_date: "2026-11-25",
      today_xp: 5,
      goal_met_today: false,
      auto_frozen_day: null,
    });
    act(() => {
      client.setQueryData(queryKeys.motivationState, nextDayBeforeGoal);
    });
    expect(useNotificationStore.getState().items).toHaveLength(0);

    const nextDayGoalAndFreeze = makeMotivationState({
      today_day_index: 366,
      today_date: "2026-11-25",
      today_xp: 20,
      goal_met_today: true,
      auto_frozen_day: 365,
    });
    act(() => {
      client.setQueryData(queryKeys.motivationState, nextDayGoalAndFreeze);
    });

    const items = useNotificationStore.getState().items;
    expect(items.filter((i) => i.kind === "goal")).toHaveLength(1);
    expect(items.filter((i) => i.kind === "freeze")).toHaveLength(1);
    expect(items.find((i) => i.kind === "goal")?.link).toBe("/streak");
    expect(items.find((i) => i.kind === "freeze")?.link).toBe("/streak");

    // Repeating same day goal / auto_frozen_day does not notify a second time.
    act(() => {
      client.setQueryData(queryKeys.motivationState, nextDayBeforeGoal);
    });
    act(() => {
      client.setQueryData(queryKeys.motivationState, nextDayGoalAndFreeze);
    });

    const finalItems = useNotificationStore.getState().items;
    expect(finalItems.filter((i) => i.kind === "goal")).toHaveLength(1);
    expect(finalItems.filter((i) => i.kind === "freeze")).toHaveLength(1);
  });
});
