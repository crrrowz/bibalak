import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameDepthStateDto, GameStateDto, ProgressSummaryDto } from "@bibalak/ipc-types";
import { StyleHud } from "@/features/progress/StyleHud";
import { setLocale } from "@/lib/i18n";
import * as ipcModule from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { useStyle } from "@/stores/style";
import { useStudyFeedbackStore } from "./feedbackStore";

let mockReducedMotion = false;

vi.mock("@/lib/motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/motion")>();
  return {
    ...actual,
    useReducedMotion: () => mockReducedMotion,
  };
});

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

function makeGameState(overrides?: Partial<GameStateDto>): GameStateDto {
  return {
    level: 4,
    xp_into_level: 120,
    xp_to_next_level: 250,
    total_xp: 570,
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
    ...overrides,
  };
}

function makeDepthState(): GameDepthStateDto {
  return {
    level: 4,
    chosen_path: null,
    path_chosen_at: null,
    path_switch_gold_cents: 10000,
    active_pet_id: "owl",
    mounted: false,
    pets: [
      {
        id: "owl",
        species_key: "owl",
        variant_key: "classic",
        growth_points: 10,
        mount_unlocked: false,
        is_active: true,
        is_mounted: false,
      },
    ],
    achievements: [],
    unseen_unlocks: [],
    backfill_applied: false,
  };
}

function makeProgress(overrides?: Partial<ProgressSummaryDto>): ProgressSummaryDto {
  return {
    level: 4,
    xp_into_level: 120,
    xp_to_next_level: 250,
    total_xp: 570,
    gold_cents: 4750,
    today_xp: 30,
    today_gold_cents: 250,
    tasks_rewarded_today: 0,
    task_reward_daily_cap: 10,
    ...overrides,
  };
}

function renderHud() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <StyleHud inFocus={false} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient: client };
}

describe("StyleHud feedback (16b)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockReducedMotion = false;
    setLocale("en");
    useStyle.getState().setStyle("game");
    vi.spyOn(ipcModule.ipc, "getGameDepthState").mockResolvedValue(makeDepthState());
  });

  afterEach(() => {
    vi.useRealTimers();
    mockReducedMotion = false;
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it("xp_float_and_count_up_respect_reduced_motion", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const gameSpy = vi
      .spyOn(ipcModule.ipc, "getGameState")
      .mockResolvedValueOnce(makeGameState())
      .mockResolvedValueOnce(
        makeGameState({
          xp_into_level: 123,
          total_xp: 573,
          available_gold_cents: 4775,
        }),
      );

    const { queryClient, unmount } = renderHud();
    expect(await screen.findByText("120 / 250 XP")).toBeInTheDocument();
    expect(screen.getByText("47.5 gold")).toBeInTheDocument();

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.gameState });
    });
    await vi.waitFor(() => expect(gameSpy).toHaveBeenCalledTimes(2));

    const floatBadge = await screen.findByTestId("hud-xp-float");
    expect(floatBadge).toHaveTextContent("+3 XP");
    expect(floatBadge).toHaveAttribute("data-reduced-motion", "false");

    // Advances rAF count-up smoothly to final values
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByText("123 / 250 XP")).toBeInTheDocument();
    expect(screen.getByText("47.75 gold")).toBeInTheDocument();
    unmount();
    gameSpy.mockClear();

    // Reduced motion: snaps immediately without rAF stepping and shows still float
    mockReducedMotion = true;
    gameSpy.mockResolvedValueOnce(makeGameState()).mockResolvedValueOnce(
      makeGameState({
        xp_into_level: 123,
        total_xp: 573,
        available_gold_cents: 4775,
      }),
    );

    const reducedRender = renderHud();
    expect(await screen.findByText("120 / 250 XP")).toBeInTheDocument();

    await act(async () => {
      await reducedRender.queryClient.invalidateQueries({ queryKey: queryKeys.gameState });
    });
    await vi.waitFor(() => expect(gameSpy).toHaveBeenCalledTimes(2));

    const reducedFloat = await screen.findByTestId("hud-xp-float");
    expect(reducedFloat).toHaveTextContent("+3 XP");
    expect(reducedFloat).toHaveAttribute("data-reduced-motion", "true");
    // Snaps immediately on update without advancing timers
    expect(screen.getByText("123 / 250 XP")).toBeInTheDocument();
    expect(screen.getByText("47.75 gold")).toBeInTheDocument();
  });

  it("avatar_reacts_on_streak_badge_not_on_again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const gameSpy = vi
      .spyOn(ipcModule.ipc, "getGameState")
      .mockResolvedValueOnce(makeGameState({ level: 4 }))
      .mockResolvedValueOnce(makeGameState({ level: 4, xp_into_level: 121, total_xp: 571 }))
      .mockResolvedValueOnce(makeGameState({ level: 5, xp_into_level: 1, total_xp: 701 }));

    const { queryClient, unmount } = renderHud();
    const wrapper = await screen.findByTestId("hud-avatar-reaction");
    expect(wrapper).toHaveAttribute("data-reacting", "false");
    expect(wrapper).toHaveAttribute("data-pet-hopping", "false");

    // Streak badge reaction -> avatar bounces & active pet hops
    act(() => {
      useStudyFeedbackStore.getState().triggerAvatarReaction("streak");
    });
    expect(wrapper).toHaveAttribute("data-reacting", "true");
    expect(wrapper).toHaveAttribute("data-pet-hopping", "true");

    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(wrapper).toHaveAttribute("data-reacting", "false");
    expect(wrapper).toHaveAttribute("data-pet-hopping", "false");

    // Small +1 XP (e.g. Again) without streak or level-up -> NO avatar reaction
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.gameState });
    });
    await vi.waitFor(() => expect(gameSpy).toHaveBeenCalledTimes(2));
    expect(wrapper).toHaveAttribute("data-reacting", "false");
    expect(wrapper).toHaveAttribute("data-pet-hopping", "false");

    // Level-up -> avatar bounces & pet hops
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.gameState });
    });
    await vi.waitFor(() => expect(gameSpy).toHaveBeenCalledTimes(3));
    // The reaction starts after the new game state renders; on a slow CI
    // machine that can come a moment after the request resolves.
    await vi.waitFor(() => {
      expect(wrapper).toHaveAttribute("data-reacting", "true");
      expect(wrapper).toHaveAttribute("data-pet-hopping", "true");
    });
    unmount();

    // Scholar style also reacts under normal motion, and stays still under reduced motion
    useStyle.getState().setStyle("scholar");
    mockReducedMotion = true;
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(makeProgress());
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue(makeGameState());

    renderHud();
    const scholarWrapper = await screen.findByTestId("hud-avatar-reaction");
    act(() => {
      useStudyFeedbackStore.getState().triggerAvatarReaction("streak");
    });
    expect(scholarWrapper).toHaveAttribute("data-still", "true");
    expect(scholarWrapper).toHaveAttribute("data-pet-hopping", "false");
  });

  it("hud_streak_pill_links_to_streak_and_respects_reduced_motion", async () => {
    useStyle.getState().setStyle("game");
    mockReducedMotion = true;
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue(makeGameState());
    vi.spyOn(ipcModule.ipc, "getMotivationState").mockResolvedValue({
      daily_goal_xp: 20,
      today_xp: 15,
      goal_met_today: false,
      current_streak: 6,
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
    });

    renderHud();

    const streakLink = await screen.findByRole("link", { name: /6d streak/i });
    expect(streakLink).toHaveAttribute("href", "/streak");

    const miniRing = await screen.findByTestId("goal-ring");
    expect(miniRing).toHaveAttribute("aria-valuenow", "15");
    expect(miniRing).toHaveAttribute("aria-valuemax", "20");
    expect(miniRing).toHaveAttribute("data-reduced-motion", "true");
    expect(miniRing.style.width).toBe("24px");
  });

  it("xp_float_not_clipped_by_hud_or_study_header", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const gameSpy = vi
      .spyOn(ipcModule.ipc, "getGameState")
      .mockResolvedValueOnce(makeGameState())
      .mockResolvedValueOnce(
        makeGameState({
          xp_into_level: 121,
          total_xp: 571,
        }),
      );

    const { queryClient } = renderHud();
    expect(await screen.findByText("120 / 250 XP")).toBeInTheDocument();

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.gameState });
    });
    await vi.waitFor(() => expect(gameSpy).toHaveBeenCalledTimes(2));

    const floatBadge = await screen.findByTestId("hud-xp-float");
    expect(floatBadge).toHaveTextContent("+1 XP");
    // Rendered in a document.body portal outside the HUD <header> so HUD overflow / study ScreenHeader cannot clip it
    expect(floatBadge.closest("header")).toBeNull();
    expect(floatBadge.parentElement).toBe(document.body);
    expect(floatBadge.className).toMatch(/\bfixed\b/);
    const zMatch = floatBadge.className.match(/\bz-(?:\[(\d+)\]|(\d+))\b/);
    const zIndex = zMatch ? Number(zMatch[1] ?? zMatch[2]) : 0;
    expect(zIndex).toBeGreaterThan(20);
  });
});
