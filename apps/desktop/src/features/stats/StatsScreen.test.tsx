import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StatsDto } from "@bibalak/ipc-types";
import { StatsScreen } from "./StatsScreen";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as ipc from "@/lib/ipc";
import { useStyle } from "@/stores/style";

const navigateMock = vi.fn();

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({ deck: undefined, range: "all" }),
  useNavigate: () => navigateMock,
}));

function makeStats(overrides?: Partial<StatsDto>): StatsDto {
  return {
    today: 10,
    today_date: "2026-11-14",
    dates: {},
    total_reviews: 0,
    studied_days: 0,
    retention_pct: 0,
    retention_goal_pct: 90,
    total_time_ms: 0,
    new_count: 0,
    learning_count: 0,
    young_count: 0,
    mature_count: 0,
    suspended_count: 0,
    reviews: [],
    forecast: [],
    backlog_count: 0,
    day0_ms: 0,
    retention_weekly: [],
    answer_buttons: { learning: [0, 0, 0, 0], young: [0, 0, 0, 0], mature: [0, 0, 0, 0] },
    hourly: [],
    fsrs: {
      card_count: 0,
      stability_buckets: [],
      difficulty_buckets: [],
      avg_retrievability: null,
    },
    deck_stats: [],
    coach: {
      leech_count: 0,
      leech_card_ids: [],
      leech_weekly_minutes: 0,
      overdue_count: 0,
      suggested_daily_reviews: 0,
    },
    ...overrides,
  };
}

describe("StatsScreen error state, retry, and coach cards", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useStyle.getState().setStyle("default");
    navigateMock.mockReset();
  });

  it("renders error state with retry button when stats query fails", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    const getStatsMock = vi
      .spyOn(ipc.ipc, "getStats")
      .mockRejectedValue(new Error("Failed to load"));

    render(
      <QueryClientProvider client={queryClient}>
        <StatsScreen />
      </QueryClientProvider>,
    );

    const errorTitle = await screen.findByText("Couldn't load statistics");
    expect(errorTitle).toBeInTheDocument();

    const retryBtn = screen.getByRole("button", { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    getStatsMock.mockResolvedValueOnce(makeStats());

    await userEvent.click(retryBtn);
    expect(getStatsMock).toHaveBeenCalledTimes(2);
  });

  it("STATS-FILT: excludes filtered decks from the StatsFilters deck selector", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Anatomy",
        parent_id: null,
        new_count: 3,
        learning_count: 0,
        review_count: 2,
        is_filtered: false,
        collapsed: false,
      },
      {
        id: 2,
        name: "Filtered Cram",
        parent_id: null,
        new_count: 0,
        learning_count: 0,
        review_count: 5,
        is_filtered: true,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc.ipc, "getStats").mockResolvedValue(makeStats());

    render(
      <QueryClientProvider client={queryClient}>
        <StatsScreen />
      </QueryClientProvider>,
    );

    const select = await screen.findByRole("combobox", { name: /All decks/i });
    await screen.findByText("Anatomy");
    expect(select).toHaveTextContent("Anatomy");
    expect(select).not.toHaveTextContent("Filtered Cram");
  });

  it("stays quiet when leech_count and overdue_count are zero", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "getStats").mockResolvedValue(makeStats());

    render(
      <QueryClientProvider client={queryClient}>
        <StatsScreen />
      </QueryClientProvider>,
    );

    await screen.findByText("Review activity");
    expect(screen.queryByTestId("coach-leech-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("coach-backlog-card")).not.toBeInTheDocument();
  });

  it("renders actionable leech and overdue backlog coach cards from Rust metrics", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "getStats").mockResolvedValue(
      makeStats({
        today: 25,
        coach: {
          leech_count: 3,
          leech_card_ids: [101, 102, 103],
          leech_weekly_minutes: 14,
          overdue_count: 21,
          suggested_daily_reviews: 45,
        },
      }),
    );
    const suspendSpy = vi.spyOn(ipc.ipc, "suspendCards").mockResolvedValue();

    render(
      <QueryClientProvider client={queryClient}>
        <StatsScreen />
      </QueryClientProvider>,
    );

    const leechCard = await screen.findByTestId("coach-leech-card");
    const backlogCard = screen.getByTestId("coach-backlog-card");
    expect(leechCard).toHaveTextContent(/14/);
    expect(backlogCard).toHaveTextContent(/45/);

    const suspendBtn = screen.getByRole("button", { name: /Suspend leeches/i });
    await user.click(suspendBtn);
    await waitFor(() => {
      expect(suspendSpy).toHaveBeenCalledWith([101, 102, 103]);
    });

    const browseButtons = screen.getAllByRole("button", { name: /View in Browse/i });
    await user.click(browseButtons[0]);
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/browse",
        search: expect.objectContaining({ q: "tag:leech -is:suspended" }),
      }),
    );

    await user.click(browseButtons[1]);
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/browse",
        search: expect.objectContaining({ q: "is:review prop:due<25" }),
      }),
    );
  });

  it("B2: exposes aria-pressed on active and inactive range filter buttons", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "getStats").mockResolvedValue(makeStats());

    render(
      <QueryClientProvider client={queryClient}>
        <StatsScreen />
      </QueryClientProvider>,
    );

    await screen.findByText("Review activity");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the underlying error reason under the generic description when stats fail", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "getStats").mockRejectedValue({
      kind: "Storage",
      message: "storage error: broken config",
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StatsScreen />
      </QueryClientProvider>,
    );

    await screen.findByText("Couldn't load statistics");
    expect(screen.getByText(/Failed to calculate statistics/)).toBeInTheDocument();
    expect(screen.getByText(/storage error: broken config/)).toBeInTheDocument();
  });

  it("AI4: renders Ask the coach button next to coach cards", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "getStats").mockResolvedValue(makeStats());

    render(
      <QueryClientProvider client={queryClient}>
        <StatsScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: /Ask the coach/i })).toBeInTheDocument();
  });

  it("AI4: clicking Ask the coach shows preview, then renders CoachPanel with 7-day plan and advice", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Default",
        parent_id: null,
        new_count: 10,
        learning_count: 5,
        review_count: 20,
        is_filtered: false,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc.ipc, "getStats").mockResolvedValue(makeStats());
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "ollama",
      base_url: "http://localhost:11434",
      model: "llama3.1",
      has_api_key: false,
    });
    vi.spyOn(ipc.ipc, "getCoachInput").mockResolvedValue({
      selected_deck: "Default",
      selected_deck_id: 1,
      reviews_30d: 300,
      retention_pct: 88.0,
      retention_goal_pct: 90.0,
      backlog_count: 15,
      forecast_7d: 120,
      forecast_30d: 400,
      studied_days: 25,
      avg_minutes_per_day: 15.0,
      leech_count: 3,
      peak_hours: [9, 14],
      top_decks: [{ deck_id: 1, name: "Default", due_today: 15, retention_pct: 88.0 }],
    });
    vi.spyOn(ipc.ipc, "aiPreviewAction").mockResolvedValue({
      provider: "ollama",
      endpoint_origin: "http://localhost:11434",
      model: "llama3.1",
      system: "Study coach system",
      prompt:
        'Study stats for deck "Default":\nReviews in last 30 days: 300\nOverdue backlog: 15 cards',
    });
    vi.spyOn(ipc.ipc, "aiRunAction").mockResolvedValue({
      prompt_id: "study_coach@1",
      text: "{}",
      suggested_fields: null,
      generated_cards: null,
      quality_findings: null,
      coach_report: {
        summary: "Pacing your overdue reviews over 5 days will stabilize retention.",
        advice: [
          {
            title: "Clear backlog early",
            detail: "Do 30 reviews each morning.",
            deck_id: 1,
          },
        ],
        plan: [
          { day: 1, reviews: 30, new_cards: 5, focus: "Morning backlog" },
          { day: 2, reviews: 30, new_cards: 5, focus: "Morning backlog" },
          { day: 3, reviews: 25, new_cards: 5, focus: "Morning backlog" },
          { day: 4, reviews: 20, new_cards: 10, focus: "Regular reviews" },
          { day: 5, reviews: 20, new_cards: 10, focus: "Regular reviews" },
          { day: 6, reviews: 15, new_cards: 15, focus: "Weekend review" },
          { day: 7, reviews: 15, new_cards: 10, focus: "Weekly audit" },
        ],
      },
      input_tokens: 150,
      output_tokens: 200,
    });

    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <StatsScreen />
      </QueryClientProvider>,
    );

    const askButton = await screen.findByRole("button", { name: /Ask the coach/i });
    await user.click(askButton);

    // Consent preview appears showing prompt numbers and Send button
    expect(await screen.findByText(/Study stats for deck "Default"/i)).toBeInTheDocument();
    expect(screen.getByText(/Overdue backlog: 15 cards/i)).toBeInTheDocument();
    const sendButton = screen.getByRole("button", { name: /Send to AI/i });
    await user.click(sendButton);

    // Coach panel appears with summary, advice, 7-day plan table, and copy plan
    expect(await screen.findByTestId("study-coach-panel")).toBeInTheDocument();
    expect(
      screen.getByText("Pacing your overdue reviews over 5 days will stabilize retention."),
    ).toBeInTheDocument();
    expect(screen.getByText("Clear backlog early")).toBeInTheDocument();
    expect(screen.getAllByText("Morning backlog").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /Copy plan/i })).toBeInTheDocument();

    // Clipboard copy
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await user.click(screen.getByRole("button", { name: /Copy plan/i }));
    expect(writeTextSpy).toHaveBeenCalledWith(
      expect.stringContaining("Pacing your overdue reviews"),
    );
  });

  it("renders ProgressPanel as a section on Stats", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "getStats").mockResolvedValue(makeStats());
    vi.spyOn(ipc.ipc, "progressSummary").mockResolvedValue({
      level: 5,
      xp_into_level: 80,
      xp_to_next_level: 300,
      total_xp: 780,
      gold_cents: 4750,
      today_xp: 30,
      today_gold_cents: 250,
      tasks_rewarded_today: 0,
      task_reward_daily_cap: 10,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StatsScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Level 5")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "80");
  });

  it("BW2-24: Stats FSRS panel names covered FSRS decks and explains itself when none use FSRS", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Anatomy",
        parent_id: null,
        new_count: 5,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
      {
        id: 2,
        name: "History",
        parent_id: null,
        new_count: 5,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc.ipc, "getStats").mockResolvedValue(
      makeStats({
        fsrs: {
          card_count: 10,
          stability_buckets: [2, 3, 2, 1, 1, 1, 0],
          difficulty_buckets: [1, 2, 2, 2, 1, 1, 1, 0, 0, 0],
          avg_retrievability: 92,
        },
      }),
    );
    const baseCfg = {
      config_id: 1,
      new_per_day: 20,
      review_per_day: 200,
      learning_steps_min: [1, 10],
      graduating_interval_days: 1,
      easy_interval_days: 4,
      starting_ease_milli: 2500,
      easy_bonus: 1.3,
      hard_interval_factor: 1.2,
      interval_modifier: 1.0,
      maximum_interval_days: 36500,
      relearning_steps_min: [10],
      lapse_interval_factor: 0.0,
      minimum_interval_days: 1,
      leech_threshold: 8,
      fsrs_weights: Array.from({ length: 21 }, () => 0.5),
      desired_retention: 0.9,
    };
    const cfgSpy = vi.spyOn(ipc.ipc, "getDeckConfig").mockImplementation(async (deckId) => ({
      ...baseCfg,
      deck_id: deckId,
      config_id: deckId,
      algorithm: deckId === 1 ? "fsrs" : "sm2",
    }));

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <StatsScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Covers FSRS decks:.*Anatomy/i)).toBeInTheDocument();
    expect(screen.queryByText(/Covers FSRS decks:.*History/i)).not.toBeInTheDocument();
    unmount();

    const qc2 = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "getStats").mockResolvedValue(makeStats());
    cfgSpy.mockImplementation(async (deckId) => ({
      ...baseCfg,
      deck_id: deckId,
      config_id: deckId,
      algorithm: "sm2",
    }));

    render(
      <QueryClientProvider client={qc2}>
        <StatsScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/No decks currently use FSRS/i)).toBeInTheDocument();
  });
});
