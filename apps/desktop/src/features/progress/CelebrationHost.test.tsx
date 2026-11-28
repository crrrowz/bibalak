import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameStateDto, ProgressSummaryDto } from "@bibalak/ipc-types";
import { CelebrationHost, GOAL_CELEBRATED_DAY_KEY } from "./CelebrationHost";
import { Toaster } from "@/components/ui/toast";
import { NotificationToastHost } from "@/features/notifications/NotificationToastHost";
import {
  initNotificationsFromStorage,
  useNotificationStore,
} from "@/features/notifications/notificationStore";
import { setLocale } from "@/lib/i18n";
import * as ipcModule from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import * as styleAudio from "@/lib/styleAudio";
import { GAME_LEVEL_SEEN_KEY, GAME_RANK_SEEN_KEY } from "@/lib/styles/game";
import { SCHOLAR_TITLE_SEEN_KEY } from "@/lib/styles/scholar";
import { useStyle } from "@/stores/style";
import { useToastStore } from "@/stores/toast";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

function makeProgress(overrides?: Partial<ProgressSummaryDto>): ProgressSummaryDto {
  return {
    level: 4,
    xp_into_level: 100,
    xp_to_next_level: 250,
    total_xp: 550,
    gold_cents: 4750,
    today_xp: 30,
    today_gold_cents: 250,
    tasks_rewarded_today: 0,
    task_reward_daily_cap: 10,
    ...overrides,
  };
}

function makeGameState(level = 4): GameStateDto {
  return {
    level,
    xp_into_level: 100,
    xp_to_next_level: 250,
    total_xp: 550,
    earned_gold_cents: 4750,
    spent_gold_cents: 0,
    available_gold_cents: 4750,
    study_streak: 6,
    studied_today: true,
    freeze_tokens_held: 2,
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

function renderHost() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <CelebrationHost />
      <NotificationToastHost />
      <Toaster />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient: client };
}

describe("CelebrationHost (14d / 16h)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    initNotificationsFromStorage();
    useToastStore.getState().clear();
    setLocale("en");
    useStyle.getState().setStyle("default");
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue(makeGameState(4));
  });

  afterEach(() => {
    localStorage.clear();
    useToastStore.getState().clear();
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it("initializes high-water marks silently on first run without toast or dialog", async () => {
    useStyle.getState().setStyle("game");
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(makeProgress({ level: 6 }));

    renderHost();

    await vi.waitFor(() => {
      expect(localStorage.getItem(GAME_LEVEL_SEEN_KEY)).toBe("6");
      expect(localStorage.getItem(GAME_RANK_SEEN_KEY)).toBe("1");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useToastStore.getState().items).toHaveLength(0);
  });

  it("shows level-up toast and GameRankDialog once on rank increase in Game, calling playStyleCue('level_up')", async () => {
    useStyle.getState().setStyle("game");
    localStorage.setItem(GAME_LEVEL_SEEN_KEY, "4");
    localStorage.setItem(GAME_RANK_SEEN_KEY, "0");
    localStorage.setItem(SCHOLAR_TITLE_SEEN_KEY, "0");

    const cueSpy = vi.spyOn(styleAudio, "playStyleCue");
    const spy = vi
      .spyOn(ipcModule.ipc, "progressSummary")
      .mockResolvedValueOnce(makeProgress({ level: 4 }))
      .mockResolvedValueOnce(makeProgress({ level: 5, total_xp: 700 }));

    const { queryClient } = renderHost();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.progressSummary });
    });
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("New Rank Unlocked!");
    expect(dialog).toHaveTextContent("Apprentice");
    expect(screen.getByTestId("avatar-stage").style.width).toBe("128px");
    // Level-up pop-up waits in the queue while GameRankDialog is open.
    expect(screen.queryByTestId("notification-popup-card")).not.toBeInTheDocument();
    expect(cueSpy).toHaveBeenCalledWith("level_up");
    expect(localStorage.getItem(GAME_LEVEL_SEEN_KEY)).toBe("5");
    expect(localStorage.getItem(GAME_RANK_SEEN_KEY)).toBe("1");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/Reached Level 5/i)).toBeInTheDocument();
    expect(useNotificationStore.getState().items.some((i) => i.kind === "level_up")).toBe(true);
    expect(useNotificationStore.getState().items.some((i) => i.kind === "title_up")).toBe(true);
  });

  it("opens CertificateDialog with Scholar avatar on title-up in Scholar", async () => {
    useStyle.getState().setStyle("scholar");
    localStorage.setItem("keepsake-scholar-level-seen", "4");
    localStorage.setItem(SCHOLAR_TITLE_SEEN_KEY, "0");

    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(
      makeProgress({ level: 5, total_xp: 780 }),
    );
    const cueSpy = vi.spyOn(styleAudio, "playStyleCue");

    renderHost();

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Researcher");
    expect(screen.getByTestId("avatar-stage")).toBeInTheDocument();
    expect(cueSpy).toHaveBeenCalledWith("level_up");
  });

  it("updates high-water marks silently in Default style without celebrations or sound", async () => {
    useStyle.getState().setStyle("default");
    localStorage.setItem(GAME_LEVEL_SEEN_KEY, "4");
    localStorage.setItem(GAME_RANK_SEEN_KEY, "0");
    localStorage.setItem(SCHOLAR_TITLE_SEEN_KEY, "0");

    const cueSpy = vi.spyOn(styleAudio, "playStyleCue");
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(makeProgress({ level: 5 }));

    renderHost();

    await vi.waitFor(() => {
      expect(localStorage.getItem(GAME_LEVEL_SEEN_KEY)).toBe("5");
      expect(localStorage.getItem(GAME_RANK_SEEN_KEY)).toBe("1");
      expect(localStorage.getItem(SCHOLAR_TITLE_SEEN_KEY)).toBe("1");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useToastStore.getState().items).toHaveLength(0);
    expect(cueSpy).not.toHaveBeenCalled();
  });

  it("goal_reached_celebrates_once_per_day_per_style_and_respects_reduced_motion", async () => {
    useStyle.getState().setStyle("scholar");
    localStorage.setItem(GAME_LEVEL_SEEN_KEY, "4");
    localStorage.setItem(GAME_RANK_SEEN_KEY, "0");
    localStorage.setItem(SCHOLAR_TITLE_SEEN_KEY, "0");
    localStorage.setItem("keepsake-scholar-level-seen", "4");

    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(makeProgress({ level: 4 }));
    const cueSpy = vi.spyOn(styleAudio, "playStyleCue");
    const baseMotivation = {
      daily_goal_xp: 20,
      today_xp: 12,
      goal_met_today: false,
      current_streak: 4,
      best_streak: 7,
      studied_today: true,
      next_milestone: 7,
      today_day_index: 365,
      today_date: "2026-11-24",
      days_remaining_in_week: 3,
      daily_quests: [],
      weekly_quest: {
        id: "w_reviews_150",
        kind: "weekly" as const,
        metric: "reviews" as const,
        progress: 12,
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

    const motSpy = vi
      .spyOn(ipcModule.ipc, "getMotivationState")
      .mockResolvedValueOnce(baseMotivation)
      .mockResolvedValueOnce({ ...baseMotivation, today_xp: 22, goal_met_today: true })
      .mockResolvedValueOnce({ ...baseMotivation, today_xp: 35, goal_met_today: true });

    const { queryClient } = renderHost();
    await vi.waitFor(() => {
      expect(motSpy).toHaveBeenCalledTimes(1);
      expect(queryClient.getQueryState(queryKeys.motivationState)?.dataUpdatedAt).toBeGreaterThan(
        0,
      );
    });
    await act(async () => {});
    expect(screen.queryByTestId("goal-reached-celebration")).not.toBeInTheDocument();

    // Reach goal for day 365 -> celebrates once in Scholar with unlock cue
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.motivationState });
    });
    await vi.waitFor(() => expect(motSpy).toHaveBeenCalledTimes(2));

    const banner = await screen.findByTestId("goal-reached-celebration");
    expect(banner).toHaveTextContent("Daily study target met");
    expect(banner).toHaveAttribute("data-style", "scholar");
    expect(cueSpy).toHaveBeenCalledWith("unlock");
    expect(localStorage.getItem("keepsake-goal-celebrated-day")).toBe("365");

    // Re-reaching / more XP on the same day does not celebrate a second time
    cueSpy.mockClear();
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.motivationState });
    });
    await vi.waitFor(() => expect(motSpy).toHaveBeenCalledTimes(3));
    expect(cueSpy).not.toHaveBeenCalled();

    // Next day in Default style: celebrates calmly without calling playStyleCue
    cueSpy.mockClear();
    motSpy.mockResolvedValue({
      ...baseMotivation,
      today_day_index: 366,
      today_xp: 20,
      goal_met_today: true,
    });
    await act(async () => {
      useStyle.getState().setStyle("default");
      await queryClient.invalidateQueries({ queryKey: queryKeys.motivationState });
    });
    await vi.waitFor(() => {
      expect(localStorage.getItem("keepsake-goal-celebrated-day")).toBe("366");
    });
    const defaultBanner = await screen.findByTestId("goal-reached-celebration");
    expect(defaultBanner).toHaveTextContent("Daily goal reached");
    expect(defaultBanner).toHaveAttribute("data-style", "default");
    expect(defaultBanner).toHaveAttribute("data-reduced-motion", "false");
    expect(cueSpy).not.toHaveBeenCalled();
  });

  it("A3-12: higher seenDay from an earlier collection does not suppress goal celebration on day 2", async () => {
    useStyle.getState().setStyle("game");
    localStorage.setItem(GOAL_CELEBRATED_DAY_KEY, "50");
    localStorage.setItem(GAME_LEVEL_SEEN_KEY, "1");
    localStorage.setItem(GAME_RANK_SEEN_KEY, "0");

    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(makeProgress({ level: 1 }));
    vi.spyOn(styleAudio, "playStyleCue").mockImplementation(() => {});
    const day2Motivation = {
      daily_goal_xp: 10,
      today_xp: 0,
      goal_met_today: false,
      current_streak: 0,
      best_streak: 1,
      studied_today: false,
      next_milestone: 7,
      today_day_index: 2,
      today_date: "2026-11-28",
      days_remaining_in_week: 3,
      daily_quests: [],
      weekly_quest: {
        id: "w",
        kind: "weekly" as const,
        metric: "reviews" as const,
        progress: 0,
        target: 150,
        completed: false,
        reward_gold_cents: 1000,
      },
      monthly_badge: {
        month_key: "2026-11",
        completed_daily_quests: 0,
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

    const motSpy = vi
      .spyOn(ipcModule.ipc, "getMotivationState")
      .mockResolvedValueOnce(day2Motivation)
      .mockResolvedValueOnce({ ...day2Motivation, today_xp: 15, goal_met_today: true });

    const { queryClient } = renderHost();
    await vi.waitFor(() => {
      expect(motSpy).toHaveBeenCalledTimes(1);
      expect(queryClient.getQueryState(queryKeys.motivationState)?.dataUpdatedAt).toBeGreaterThan(
        0,
      );
    });
    await act(async () => {});

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.motivationState });
    });
    await vi.waitFor(() => expect(motSpy).toHaveBeenCalledTimes(2));

    const banner = await screen.findByTestId("goal-reached-celebration");
    expect(banner).toHaveAttribute("data-style", "game");
    expect(localStorage.getItem(GOAL_CELEBRATED_DAY_KEY)).toBe("2");
  });
});
