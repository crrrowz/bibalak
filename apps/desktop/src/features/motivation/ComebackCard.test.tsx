import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MotivationStateDto } from "@bibalak/ipc-types";
import { ComebackCard } from "./ComebackCard";
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

function makeState(hasComeback: boolean): MotivationStateDto {
  return {
    daily_goal_xp: 20,
    today_xp: 0,
    goal_met_today: false,
    current_streak: 0,
    best_streak: 14,
    studied_today: false,
    next_milestone: 7,
    today_day_index: 365,
    today_date: "2026-11-24",
    days_remaining_in_week: 3,
    daily_quests: [],
    weekly_quest: {
      id: "w_reviews_150",
      kind: "weekly",
      metric: "reviews",
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
    comeback_offer: hasComeback
      ? {
          return_day: 365,
          away_days: 9,
          reward_gold_cents: 500,
        }
      : null,
    onboarding_completed: true,
    auto_frozen_day: null,
  };
}

describe("ComebackCard (16e)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  afterEach(() => {
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it("comeback_card_shows_and_dismisses", async () => {
    vi.spyOn(ipcModule.ipc, "getMotivationState")
      .mockResolvedValueOnce(makeState(true))
      .mockResolvedValue(makeState(false));
    const dismissSpy = vi.spyOn(ipcModule.ipc, "dismissComebackOffer").mockResolvedValue(undefined);
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <ComebackCard />
      </QueryClientProvider>,
    );

    const card = await screen.findByTestId("comeback-card");
    expect(card).toHaveTextContent("Welcome back");
    expect(card).toHaveTextContent("+5 gold");
    expect(card.textContent).not.toMatch(/missed|broke|lost|penalty/i);

    await user.click(screen.getByRole("button", { name: /Dismiss/i }));

    await waitFor(() => expect(dismissSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("comeback-card")).not.toBeInTheDocument());
  });
});
