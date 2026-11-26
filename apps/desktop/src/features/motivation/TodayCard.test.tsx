import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckSummary, MotivationStateDto } from "@bibalak/ipc-types";
import { QuestCard } from "@/features/quests/QuestCard";
import { TodayCard } from "./TodayCard";
import { setLocale } from "@/lib/i18n";
import * as ipcModule from "@/lib/ipc";
import { useStyle } from "@/stores/style";

const mockNavigate = vi.fn();

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

vi.mock("@/lib/useOptionalNavigate", () => ({
  useOptionalNavigate: () => mockNavigate,
}));

function makeState(overrides?: Partial<MotivationStateDto>): MotivationStateDto {
  return {
    daily_goal_xp: 20,
    today_xp: 12,
    goal_met_today: false,
    current_streak: 5,
    best_streak: 14,
    studied_today: false,
    next_milestone: 7,
    today_day_index: 365,
    today_date: "2026-11-24",
    days_remaining_in_week: 3,
    daily_quests: [
      {
        id: "reviews_15",
        kind: "daily",
        metric: "reviews",
        progress: 9,
        target: 15,
        completed: false,
        reward_gold_cents: 200,
      },
      {
        id: "new_5",
        kind: "daily",
        metric: "new_cards",
        progress: 5,
        target: 5,
        completed: true,
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
      progress: 80,
      target: 150,
      completed: false,
      reward_gold_cents: 1000,
    },
    monthly_badge: {
      month_key: "2026-11",
      completed_daily_quests: 10,
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
    ...overrides,
  };
}

const SAMPLE_DECKS: DeckSummary[] = [
  {
    id: 1,
    name: "Languages",
    parent_id: null,
    new_count: 8,
    learning_count: 3,
    review_count: 14,
    is_filtered: false,
    collapsed: false,
  },
  {
    id: 2,
    name: "Languages::Arabic",
    parent_id: 1,
    new_count: 5,
    learning_count: 1,
    review_count: 4,
    is_filtered: false,
    collapsed: false,
  },
];

function renderTodayCard(decks: DeckSummary[] = SAMPLE_DECKS, onStudy = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TodayCard decks={decks} onStudy={onStudy} />
    </QueryClientProvider>,
  );
}

describe("TodayCard (16e)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockReset();
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  afterEach(() => {
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it("today_card_renders_start_cta_goal_ring_quests_and_due_counts", async () => {
    vi.spyOn(ipcModule.ipc, "getMotivationState").mockResolvedValue(makeState());
    const onStudy = vi.fn();
    const user = userEvent.setup();

    renderTodayCard(SAMPLE_DECKS, onStudy);

    const card = await screen.findByTestId("today-card");
    expect(card).toHaveTextContent("Today");

    // Goal ring shows today_xp / daily_goal_xp
    const ring = screen.getByRole("progressbar", { name: /12 \/ 20 XP/i });
    expect(ring).toHaveAttribute("aria-valuenow", "12");
    expect(ring).toHaveAttribute("aria-valuemax", "20");
    expect(card).toHaveTextContent("8 XP to daily goal");

    // Due counts sum top-level decks (8 new, 3 learning, 14 review — not double-counted)
    expect(card).toHaveTextContent("8 new · 3 learning · 14 review");

    // Compact 3 daily quests line linking to /quests
    const questsLink = screen.getByRole("link", { name: /Today's tasks|View all/i });
    expect(questsLink).toHaveAttribute("href", "/quests");
    expect(questsLink).toHaveTextContent("9 / 15");
    expect(questsLink).toHaveTextContent("5 / 5");
    expect(questsLink).toHaveTextContent("1 / 2");

    // Streak chip links to /streak
    const streakLink = screen.getByRole("link", { name: /Open streak calendar/i });
    expect(streakLink).toHaveAttribute("href", "/streak");
    expect(streakLink).toHaveTextContent("5 days");

    // Start studying CTA invokes onStudy with the next due deck
    const startBtn = screen.getByRole("button", { name: /Start studying/i });
    await user.click(startBtn);
    expect(onStudy).toHaveBeenCalledWith(SAMPLE_DECKS[0]);
  });

  it("quest_progress_display_capped_at_target", async () => {
    const overTargetQuest = {
      id: "reviews_40",
      kind: "daily" as const,
      metric: "reviews" as const,
      progress: 125,
      target: 40,
      completed: true,
      reward_gold_cents: 200,
    };
    vi.spyOn(ipcModule.ipc, "getMotivationState").mockResolvedValue(
      makeState({
        daily_quests: [overTargetQuest],
      }),
    );

    renderTodayCard(SAMPLE_DECKS);
    const card = await screen.findByTestId("today-card");
    expect(card).toHaveTextContent("40 / 40");
    expect(card).not.toHaveTextContent("125 / 40");

    // QuestCard on the quests screen also displays capped progress
    render(<QuestCard quest={overTargetQuest} style="default" reducedMotion={true} />);
    expect(screen.queryByText("125 / 40")).not.toBeInTheDocument();
  });

  it.each(["default", "scholar", "game"] as const)(
    "bw2_12_renders_clean_headline_with_cards_left_and_secondary_line ($style)",
    async (style) => {
      useStyle.getState().setStyle(style);
      vi.spyOn(ipcModule.ipc, "getMotivationState").mockResolvedValue(makeState());

      renderTodayCard(SAMPLE_DECKS);

      const card = await screen.findByTestId("today-card");
      const headline = card.querySelector("[data-testid='today-headline']");
      expect(headline).not.toBeNull();
      expect(headline).toHaveTextContent(/25 cards left today/i);

      const secondary = card.querySelector("[data-testid='today-secondary-line']");
      expect(secondary).not.toBeNull();
      expect(secondary).toHaveTextContent(/8 XP to daily goal/i);
      expect(secondary).toHaveTextContent(/8 new · 3 learning · 14 review/i);
    },
  );

  it("STUDY1: explains that the daily XP goal is separate from deck card limits", async () => {
    vi.spyOn(ipcModule.ipc, "getMotivationState").mockResolvedValue(makeState());

    renderTodayCard(SAMPLE_DECKS);

    const card = await screen.findByTestId("today-card");
    expect(card).toHaveTextContent(/XP goal.*separate from deck card limits/i);
  });
});
