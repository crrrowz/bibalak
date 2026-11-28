import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MotivationStateDto } from "@bibalak/ipc-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ipcModule from "@/lib/ipc";
import { setLocale, t } from "@/lib/i18n";
import { ar } from "@/locales/ar";
import { en } from "@/locales/en";
import { useStyle } from "@/stores/style";
import { QuestsContent } from "./QuestsContent";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

function makeMotivationState(overrides?: Partial<MotivationStateDto>): MotivationStateDto {
  return {
    daily_goal_xp: 20,
    today_xp: 15,
    goal_met_today: false,
    current_streak: 5,
    best_streak: 12,
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
        progress: 15,
        target: 15,
        completed: true,
        reward_gold_cents: 200,
      },
      {
        id: "new_5",
        kind: "daily",
        metric: "new_cards",
        progress: 3,
        target: 5,
        completed: false,
        reward_gold_cents: 200,
      },
      {
        id: "tasks_2",
        kind: "daily",
        metric: "tasks",
        progress: 1,
        target: 2,
        completed: false,
        reward_gold_cents: 200,
      },
    ],
    weekly_quest: {
      id: "w_reviews_150",
      kind: "weekly",
      metric: "reviews",
      progress: 92,
      target: 150,
      completed: false,
      reward_gold_cents: 1000,
    },
    monthly_badge: {
      month_key: "2026-11",
      completed_daily_quests: 14,
      target_daily_quests: 20,
      earned: false,
      earned_at: null,
      seen: true,
      reward_gold_cents: 1000,
    },
    earned_monthly_badges: [
      {
        month_key: "2026-10",
        quest_count_at_earn: 21,
        earned_at: Date.UTC(2026, 9, 28, 12, 0, 0),
        seen: true,
      },
    ],
    comeback_offer: null,
    onboarding_completed: true,
    auto_frozen_day: null,
    ...overrides,
  };
}

function renderQuests() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <QuestsContent />
    </QueryClientProvider>,
  );
}

describe("QuestsView / QuestsContent (16g)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  afterEach(() => {
    cleanup();
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it.each([
    {
      style: "default" as const,
      dailyHeading: "Daily challenges",
      weeklyHeading: "Weekly goal",
      monthlyHeading: "Monthly milestone",
      dailyReward: "+2 gold",
      weeklyReward: "+10 gold",
    },
    {
      style: "scholar" as const,
      dailyHeading: "Daily assignments",
      weeklyHeading: "Weekly seminar target",
      monthlyHeading: "Monthly distinction",
      dailyReward: "+2 knowledge points",
      weeklyReward: "+10 knowledge points",
    },
    {
      style: "game" as const,
      dailyHeading: "Daily Quests",
      weeklyHeading: "Weekly Quest",
      monthlyHeading: "Monthly Badge",
      dailyReward: "+2 Gold",
      weeklyReward: "+10 Gold",
    },
  ])(
    "quests_screen_displays_three_daily_weekly_and_monthly_badge_per_style ($style)",
    async ({ style, dailyHeading, weeklyHeading, monthlyHeading, dailyReward, weeklyReward }) => {
      useStyle.getState().setStyle(style);
      vi.spyOn(ipcModule.ipc, "getMotivationState").mockResolvedValue(makeMotivationState());
      vi.spyOn(ipcModule.ipc, "markMonthlyBadgeSeen").mockResolvedValue();

      renderQuests();

      expect(await screen.findByText(dailyHeading)).toBeInTheDocument();
      expect(screen.getByText(weeklyHeading)).toBeInTheDocument();
      expect(screen.getByText(monthlyHeading)).toBeInTheDocument();

      // 3 daily quests + 1 weekly quest
      expect(screen.getByText("Review 15 cards")).toBeInTheDocument();
      expect(screen.getByText("Learn 5 new cards")).toBeInTheDocument();
      expect(screen.getByText("Complete 2 tasks")).toBeInTheDocument();
      expect(screen.getByText("Review 150 cards")).toBeInTheDocument();
      expect(screen.getByText("3 days remaining")).toBeInTheDocument();
      expect(screen.getByText("Completed")).toBeInTheDocument();
      expect(screen.getAllByText(dailyReward).length).toBe(3);
      expect(screen.getAllByText(weeklyReward).length).toBeGreaterThanOrEqual(1);

      // Monthly badge progress + earned gallery
      expect(screen.getByText("14 of 20 daily tasks")).toBeInTheDocument();
      expect(screen.getByText("Earned monthly milestones")).toBeInTheDocument();
      expect(screen.getByText("October 2026")).toBeInTheDocument();

      // Progress bars for 3 daily + 1 weekly + 1 monthly badge
      expect(screen.getAllByRole("progressbar")).toHaveLength(5);
      // Per-style icon markers
      expect(screen.getAllByTestId(`quest-icon-${style}`).length).toBeGreaterThanOrEqual(4);
      expect(screen.getByTestId(`monthly-badge-icon-${style}`)).toBeInTheDocument();
    },
  );

  it("quests_use_arabic_plurals_and_min_fractions", async () => {
    setLocale("ar");
    useStyle.getState().setStyle("default");
    vi.spyOn(ipcModule.ipc, "getMotivationState").mockResolvedValue(
      makeMotivationState({
        days_remaining_in_week: 2,
        daily_quests: [
          {
            id: "reviews_15",
            kind: "daily",
            metric: "reviews",
            progress: 5,
            target: 15,
            completed: false,
            reward_gold_cents: 200,
          },
          {
            id: "tasks_2",
            kind: "daily",
            metric: "tasks",
            progress: 1,
            target: 2,
            completed: false,
            reward_gold_cents: 200,
          },
          {
            id: "habit_1",
            kind: "daily",
            metric: "habits",
            progress: 0,
            target: 1,
            completed: false,
            reward_gold_cents: 200,
          },
        ],
        monthly_badge: {
          month_key: "2026-11",
          completed_daily_quests: 2,
          target_daily_quests: 20,
          earned: false,
          earned_at: null,
          seen: true,
          reward_gold_cents: 1000,
        },
        earned_monthly_badges: [],
      }),
    );

    renderQuests();

    expect(await screen.findByText("التحديات اليومية")).toBeInTheDocument();
    expect(screen.getByText("راجع 15 بطاقةً")).toBeInTheDocument();
    expect(screen.getByText("أنجز مهمتين")).toBeInTheDocument();
    expect(screen.getByText("أتمم عادة واحدة")).toBeInTheDocument();
    expect(screen.getByText("5 من 15")).toBeInTheDocument();
    expect(screen.getByText("1 من 2")).toBeInTheDocument();
    expect(screen.getByText("يومان متبقيان")).toBeInTheDocument();
    expect(screen.getByText("مهمتان من 20")).toBeInTheDocument();
    expect(
      screen.getByText("أكمل 20 مهمة يومية خلال شهر واحد لتحصل على أول إنجاز شهري."),
    ).toBeInTheDocument();
  });

  it("monthly_badge_marked_seen_on_open", async () => {
    const markSeenSpy = vi.spyOn(ipcModule.ipc, "markMonthlyBadgeSeen").mockResolvedValue();
    vi.spyOn(ipcModule.ipc, "getMotivationState").mockResolvedValue(
      makeMotivationState({
        monthly_badge: {
          month_key: "2026-11",
          completed_daily_quests: 20,
          target_daily_quests: 20,
          earned: true,
          earned_at: Date.UTC(2026, 10, 24, 10, 0, 0),
          seen: false,
          reward_gold_cents: 1000,
        },
        earned_monthly_badges: [
          {
            month_key: "2026-10",
            quest_count_at_earn: 21,
            earned_at: Date.UTC(2026, 9, 28, 12, 0, 0),
            seen: false,
          },
          {
            month_key: "2026-11",
            quest_count_at_earn: 20,
            earned_at: Date.UTC(2026, 10, 24, 10, 0, 0),
            seen: false,
          },
        ],
      }),
    );

    renderQuests();

    await waitFor(() => {
      expect(markSeenSpy).toHaveBeenCalledWith("2026-11");
      expect(markSeenSpy).toHaveBeenCalledWith("2026-10");
    });
    expect(markSeenSpy).toHaveBeenCalledTimes(2);
  });

  it("quests_nav_label_no_longer_clashes_with_tasks", () => {
    expect(en["motivation.quests.title.default"]).toBe("Daily challenges");
    expect(en["motivation.quests.title.default"]).not.toMatch(/tasks/i);
    expect(ar["motivation.quests.title.default"]).toBe("تحديات اليوم");
    expect(ar["motivation.quests.title.default"]).not.toContain("المهام");

    expect(en["motivation.quests.title.game"]).toBe("Quests");
    expect(ar["motivation.quests.title.game"]).toBe("تحديات المغامر");
    expect(ar["motivation.quests.title.game"]).not.toContain("المهام");

    expect(en["motivation.quests.title.scholar"]).toBe("Assignments & honors");
    expect(ar["motivation.quests.title.scholar"]).toBe("الواجبات والأوسمة");

    setLocale("ar");
    expect(t("motivation.quests.title.default")).toBe("تحديات اليوم");
    expect(t("motivation.quests.title.game")).toBe("تحديات المغامر");
  });

  it("renders loading and error states with retry action", async () => {
    vi.spyOn(ipcModule.ipc, "getMotivationState").mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = renderQuests();
    expect(screen.getByTestId("quests-loading")).toBeInTheDocument();
    unmount();

    vi.restoreAllMocks();
    const retrySpy = vi
      .spyOn(ipcModule.ipc, "getMotivationState")
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce(makeMotivationState());
    renderQuests();

    expect(await screen.findByTestId("quests-error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Daily challenges")).toBeInTheDocument();
    expect(retrySpy).toHaveBeenCalledTimes(2);
  });

  it("bw2_14_quests_and_monthly_badge_use_reward_chips_completed_badge_and_badge_row", async () => {
    useStyle.getState().setStyle("game");
    vi.spyOn(ipcModule.ipc, "getMotivationState").mockResolvedValue(makeMotivationState());
    vi.spyOn(ipcModule.ipc, "markMonthlyBadgeSeen").mockResolvedValue();

    renderQuests();
    await screen.findByText("Daily Quests");

    const rewardChips = screen.getAllByTestId("quest-reward-chip");
    expect(rewardChips).toHaveLength(4);
    for (const chip of rewardChips) {
      expect(chip.className).toContain("border");
      expect(chip.className).toContain("rounded-md");
    }

    const completedCards = document.querySelectorAll("[data-completed='true']");
    expect(completedCards).toHaveLength(1);
    expect(
      completedCards[0]?.querySelector("[data-testid='quest-completed-badge']"),
    ).not.toBeNull();

    const monthlyRewardChip = screen.getByTestId("monthly-reward-chip");
    expect(monthlyRewardChip.className).toContain("border");
    expect(monthlyRewardChip.className).toContain("rounded-md");
    expect(screen.getByTestId("monthly-badge-row")).toBeInTheDocument();
  });
});
