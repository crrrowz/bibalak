import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MotivationStateDto } from "@bibalak/ipc-types";
import { DailyGoalSetting } from "./DailyGoalSetting";
import { setLocale } from "@/lib/i18n";
import * as ipcModule from "@/lib/ipc";
import { useStyle } from "@/stores/style";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

function makeState(goal: number, todayXp = 15): MotivationStateDto {
  return {
    daily_goal_xp: goal,
    today_xp: todayXp,
    goal_met_today: todayXp >= goal,
    current_streak: 4,
    best_streak: 10,
    studied_today: true,
    next_milestone: 7,
    today_day_index: 365,
    today_date: "2026-11-24",
    days_remaining_in_week: 3,
    daily_quests: [],
    weekly_quest: {
      id: "w_reviews_150",
      kind: "weekly",
      metric: "reviews",
      progress: 15,
      target: 150,
      completed: false,
      reward_gold_cents: 1000,
    },
    monthly_badge: {
      month_key: "2026-11",
      completed_daily_quests: 5,
      target_daily_quests: 20,
      earned: false,
      earned_at: null,
      seen: false,
      reward_gold_cents: 1000,
    },
    earned_monthly_badges: [],
    comeback_offer: null,
    onboarding_completed: true,
    auto_frozen_day: null,
  };
}

describe("DailyGoalSetting (16e)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  afterEach(() => {
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it("goal_selector_updates_daily_goal_midday", async () => {
    vi.spyOn(ipcModule.ipc, "getMotivationState").mockResolvedValue(makeState(20, 15));
    const setGoalSpy = vi
      .spyOn(ipcModule.ipc, "setDailyGoal")
      .mockResolvedValueOnce(makeState(10, 15))
      .mockResolvedValueOnce(makeState(30, 15));

    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <DailyGoalSetting />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("15 / 20 XP")).toBeInTheDocument();
    const opt20 = screen.getByRole("radio", { name: /20 XP \/ day/i });
    expect(opt20).toHaveAttribute("aria-checked", "true");

    // Lower mid-day: 20 -> 10 when today_xp = 15 => 15 / 10 XP (goal met)
    await user.click(screen.getByRole("radio", { name: /10 XP \/ day/i }));
    await waitFor(() => expect(setGoalSpy).toHaveBeenCalledWith(10));
    expect(await screen.findByText("15 / 10 XP")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /10 XP \/ day/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Raise mid-day: 10 -> 30 when today_xp = 15 => 15 / 30 XP
    await user.click(screen.getByRole("radio", { name: /30 XP \/ day/i }));
    await waitFor(() => expect(setGoalSpy).toHaveBeenCalledWith(30));
    expect(await screen.findByText("15 / 30 XP")).toBeInTheDocument();
  });

  it("A5-04: defaults to 10 XP (matching core DEFAULT_DAILY_GOAL_XP and Onboarding) before state loads", () => {
    vi.spyOn(ipcModule.ipc, "getMotivationState").mockImplementation(() => new Promise(() => {}));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DailyGoalSetting />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("radio", { name: /10 XP/ })).toHaveAttribute("aria-checked", "true");
  });
});
