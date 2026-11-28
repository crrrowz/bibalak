import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeckBrowserScreen } from "./DeckBrowserScreen";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as ipc from "@/lib/ipc";
import { useStyle } from "@/stores/style";

const { platformListeners } = vi.hoisted(() => ({
  platformListeners: new Map<string, (payload: unknown) => void>(),
}));

vi.mock("@/lib/platform", () => {
  const pickPath = vi.fn();
  const pickSavePath = vi.fn();
  return {
    platform: {
      isAvailable: () => true,
      invoke: vi.fn(),
      listen: vi.fn((event: string, handler: (payload: unknown) => void) => {
        platformListeners.set(event, handler);
        return () => {
          platformListeners.delete(event);
        };
      }),
      pickPath,
      pickSavePath,
    },
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({ create: false }),
}));

describe("DeckBrowserScreen Undo & Empty failures (F4)", () => {
  it("removes generic toolbar Undo button and supports Ctrl+Z undo", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "undoStatus").mockResolvedValue({ kind: "delete-deck", name: "Math" });
    const undoSpy = vi
      .spyOn(ipc.ipc, "undo")
      .mockResolvedValue({ kind: "delete-deck", name: "Math" });

    render(
      <QueryClientProvider client={queryClient}>
        <DeckBrowserScreen />
      </QueryClientProvider>,
    );

    await screen.findByRole("button", { name: /Import text/i });
    expect(screen.queryByRole("button", { name: /^Undo$/i })).not.toBeInTheDocument();

    await userEvent.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(undoSpy).toHaveBeenCalledTimes(1));
  });

  it("shows error message when Ctrl+Z undo fails", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "undoStatus").mockResolvedValue({ kind: "answer-card" });
    vi.spyOn(ipc.ipc, "undo").mockRejectedValue(new Error("Database locked"));

    render(
      <QueryClientProvider client={queryClient}>
        <DeckBrowserScreen />
      </QueryClientProvider>,
    );

    await screen.findByRole("button", { name: /Import text/i });
    await userEvent.keyboard("{Control>}z{/Control}");

    const errorMsg = await screen.findByText(/Undo failed: Database locked/i);
    expect(errorMsg).toBeInTheDocument();
  });

  it("shows error message when emptyFiltered fails", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Filtered 1",
        parent_id: null,
        new_count: 0,
        learning_count: 0,
        review_count: 0,
        is_filtered: true,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc.ipc, "undoStatus").mockResolvedValue(null);
    vi.spyOn(ipc.ipc, "emptyFiltered").mockRejectedValue(new Error("Deck busy"));

    render(
      <QueryClientProvider client={queryClient}>
        <DeckBrowserScreen />
      </QueryClientProvider>,
    );

    const emptyBtn = await screen.findByRole("button", { name: /empty/i });
    await userEvent.click(emptyBtn);

    const errorMsg = await screen.findByText(/Failed to empty filtered deck: Deck busy/i);
    expect(errorMsg).toBeInTheDocument();
  });

  it("UX2 A4: empty Home shows Create a deck, Import from Anki (.apkg), and Add a sample deck", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "undoStatus").mockResolvedValue(null);
    const starterSpy = vi.spyOn(ipc.ipc, "completeOnboarding").mockResolvedValue();

    render(
      <QueryClientProvider client={queryClient}>
        <DeckBrowserScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: /create a deck/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import from anki \(\.apkg\)/i }),
    ).toBeInTheDocument();
    const sampleBtn = screen.getByRole("button", { name: /add a sample deck/i });
    expect(sampleBtn).toBeInTheDocument();

    await userEvent.click(sampleBtn);
    await waitFor(() => expect(starterSpy).toHaveBeenCalledWith(false, true, "en"));
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("UX2 C2: renders import summary as a spaced dismissible card under the header, not glued under Level", async () => {
    useStyle.getState().setStyle("default");
    const { platform } = await import("@/lib/platform");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Biology",
        parent_id: null,
        new_count: 5,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc.ipc, "undoStatus").mockResolvedValue(null);
    vi.spyOn(ipc.ipc, "progressSummary").mockResolvedValue({
      level: 4,
      xp_into_level: 120,
      xp_to_next_level: 250,
      total_xp: 570,
      gold_cents: 4750,
      today_xp: 45,
      today_gold_cents: 375,
      tasks_rewarded_today: 0,
      task_reward_daily_cap: 10,
    });
    vi.mocked(platform.pickPath).mockResolvedValue("/path/to/deck.apkg");
    vi.spyOn(ipc.ipc, "importPackage").mockResolvedValue({
      notes_added: 3,
      cards_added: 6,
      decks_added: 1,
      media_imported: 0,
      notes_updated: 0,
      notetypes_added: 0,
      revlog_added: 0,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <DeckBrowserScreen />
      </QueryClientProvider>,
    );

    const importBtn = await screen.findByRole("button", { name: /^Import$/ });
    await userEvent.click(importBtn);

    const notice = await screen.findByTestId("import-summary-notice");
    expect(notice.className).toContain("rounded-xl");
    expect(notice.className).toContain("bg-card");

    const levelText = await screen.findByText("Level 4");
    expect(
      notice.compareDocumentPosition(levelText) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await userEvent.click(within(notice).getByRole("button", { name: /close/i }));
    expect(screen.queryByTestId("import-summary-notice")).not.toBeInTheDocument();
  });

  it("hides child subdecks when parent deck is collapsed", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Languages",
        parent_id: null,
        new_count: 5,
        learning_count: 2,
        review_count: 10,
        is_filtered: false,
        collapsed: true,
      },
      {
        id: 2,
        name: "Languages::Spanish",
        parent_id: 1,
        new_count: 3,
        learning_count: 1,
        review_count: 4,
        is_filtered: false,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc.ipc, "undoStatus").mockResolvedValue(null);

    render(
      <QueryClientProvider client={queryClient}>
        <DeckBrowserScreen />
      </QueryClientProvider>,
    );

    // Parent is visible
    expect(await screen.findByText("Languages")).toBeInTheDocument();
    // Child is hidden because parent is collapsed
    expect(screen.queryByText("Spanish")).not.toBeInTheDocument();
  });

  it("renders Arabic dual plurals with tn() in import summary", async () => {
    const { setLocale } = await import("@/lib/i18n");
    const { platform } = await import("@/lib/platform");
    setLocale("ar");

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "undoStatus").mockResolvedValue(null);
    vi.mocked(platform.pickPath).mockResolvedValue("/path/to/test.apkg");
    vi.spyOn(ipc.ipc, "importPackage").mockResolvedValue({
      notes_added: 2,
      cards_added: 2,
      decks_added: 1,
      media_imported: 0,
      notes_updated: 0,
      notetypes_added: 0,
      revlog_added: 0,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <DeckBrowserScreen />
      </QueryClientProvider>,
    );

    const importBtn = await screen.findByRole("button", { name: /^استيراد$/ });
    await userEvent.click(importBtn);

    // In Arabic dual form, notes_added: 2 must be "ملاحظتان", not "2 ملاحظة"
    const summary = await screen.findByText(/ملاحظتان/);
    expect(summary).toBeInTheDocument();

    setLocale("en");
  });

  it("OT-09: indents decks from real tree depth so an orphan subdeck without parent is not indented", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Default",
        parent_id: null,
        new_count: 0,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
      {
        id: 2,
        name: "Classical Music Themes::Part I",
        parent_id: null,
        new_count: 5,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
      {
        id: 3,
        name: "Languages",
        parent_id: null,
        new_count: 0,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
      {
        id: 4,
        name: "Languages::Spanish",
        parent_id: 3,
        new_count: 10,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc.ipc, "undoStatus").mockResolvedValue(null);

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <DeckBrowserScreen />
      </QueryClientProvider>,
    );

    await screen.findByText("Default");
    await screen.findByText("Part I");
    await screen.findByText("Spanish");

    const rows = Array.from(
      container.querySelectorAll<HTMLDivElement>('div[style*="padding-inline-start"]'),
    );
    expect(rows).toHaveLength(4);
    // Default: depth 0 -> 2rem
    expect(rows[0].style.paddingInlineStart).toBe("2rem");
    // Orphan "Classical Music Themes::Part I": depth 0 -> 2rem (not 3.25rem!)
    expect(rows[1].style.paddingInlineStart).toBe("2rem");
    // Languages: depth 0 -> 2rem
    expect(rows[2].style.paddingInlineStart).toBe("2rem");
    // Languages::Spanish: depth 1 -> 3.25rem
    expect(rows[3].style.paddingInlineStart).toBe("3.25rem");
  });

  it("renders ProgressPanel on Home above the deck list", async () => {
    useStyle.getState().setStyle("default");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "undoStatus").mockResolvedValue(null);
    vi.spyOn(ipc.ipc, "progressSummary").mockResolvedValue({
      level: 4,
      xp_into_level: 120,
      xp_to_next_level: 250,
      total_xp: 570,
      gold_cents: 4750,
      today_xp: 45,
      today_gold_cents: 375,
      tasks_rewarded_today: 0,
      task_reward_daily_cap: 10,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <DeckBrowserScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Level 4")).toBeInTheDocument();
    expect(screen.getByText("47.5 gold")).toBeInTheDocument();
  });

  it("hero_layout_removed_and_stored_hero_falls_back", async () => {
    localStorage.setItem("keepsake-home-layout", "hero");
    vi.resetModules();
    const { useUi } = await import("@/stores/ui");
    expect(useUi.getState().homeLayout).toBe("list");

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Biology",
        parent_id: null,
        new_count: 4,
        learning_count: 1,
        review_count: 6,
        is_filtered: false,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc.ipc, "undoStatus").mockResolvedValue(null);
    vi.spyOn(ipc.ipc, "getMotivationState").mockResolvedValue({
      daily_goal_xp: 20,
      today_xp: 10,
      goal_met_today: false,
      current_streak: 3,
      best_streak: 5,
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
        progress: 10,
        target: 150,
        completed: false,
        reward_gold_cents: 1000,
      },
      monthly_badge: {
        month_key: "2026-11",
        completed_daily_quests: 2,
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

    render(
      <QueryClientProvider client={queryClient}>
        <DeckBrowserScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("today-card")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /List \+ hero/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^List$/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Grid$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    localStorage.removeItem("keepsake-home-layout");
  });

  it("home_shows_caught_up_once_and_no_todays_loot_row", async () => {
    useStyle.getState().setStyle("game");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Biology",
        parent_id: null,
        new_count: 0,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc.ipc, "undoStatus").mockResolvedValue(null);
    vi.spyOn(ipc.ipc, "progressSummary").mockResolvedValue({
      level: 4,
      xp_into_level: 120,
      xp_to_next_level: 250,
      total_xp: 570,
      gold_cents: 4750,
      today_xp: 45,
      today_gold_cents: 375,
      tasks_rewarded_today: 2,
      task_reward_daily_cap: 10,
    });
    vi.spyOn(ipc.ipc, "yesterdaySummary").mockResolvedValue({
      day: 364,
      date: "2026-11-23",
      reviews: 12,
      tasks_completed: 3,
      habits_completed: 1,
      xp: 35,
      gold_cents: 300,
    });
    vi.spyOn(ipc.ipc, "getMotivationState").mockResolvedValue({
      daily_goal_xp: 20,
      today_xp: 20,
      goal_met_today: true,
      current_streak: 3,
      best_streak: 5,
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
        progress: 10,
        target: 150,
        completed: false,
        reward_gold_cents: 1000,
      },
      monthly_badge: {
        month_key: "2026-11",
        completed_daily_quests: 2,
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

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <DeckBrowserScreen />
        </QueryClientProvider>,
      );

      const todayCard = await screen.findByTestId("today-card");
      expect(screen.getAllByText(/All caught up for today/i)).toHaveLength(1);
      expect(screen.queryByText(/Today's Loot/i)).not.toBeInTheDocument();
      expect(todayCard).toHaveTextContent("3.75 gold");
      expect(todayCard).toHaveTextContent("Tasks 2 of 10");
      expect(await screen.findByTestId("yesterday-summary-card")).toHaveTextContent(
        "Yesterday's Loot",
      );
    } finally {
      useStyle.getState().setStyle("default");
    }
  });

  it("STUDY1 / BW2-22: saving deck options and undo invalidate decks, motivationState, progressSummary, and statsAll", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Biology",
        parent_id: null,
        new_count: 5,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc.ipc, "undoStatus").mockResolvedValue({ kind: "answer-card" });
    vi.spyOn(ipc.ipc, "undo").mockResolvedValue({ kind: "answer-card" });
    vi.spyOn(ipc.ipc, "getDeckConfig").mockResolvedValue({
      deck_id: 1,
      config_id: 1,
      algorithm: "sm2",
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
    });
    vi.spyOn(ipc.ipc, "setDeckConfig").mockResolvedValue();

    render(
      <QueryClientProvider client={queryClient}>
        <DeckBrowserScreen />
      </QueryClientProvider>,
    );

    const optionsBtn = await screen.findByRole("button", { name: /Settings for Biology/i });
    await user.click(optionsBtn);
    await user.click(await screen.findByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["decks"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["motivation-state"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["progress-summary"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["stats"] });
    });

    invalidateSpy.mockClear();
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["motivation-state"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["stats"] });
    });
  });

  it("F1 / BW2-23: Reset progress… opens confirm dialog listing wiped state, calls resetDeckProgress, and fires Undo toast", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Biology",
        parent_id: null,
        new_count: 5,
        learning_count: 2,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
      {
        id: 2,
        name: "Biology::Cells",
        parent_id: 1,
        new_count: 3,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc.ipc, "undoStatus").mockResolvedValue(null);
    const deckCardIdsSpy = vi
      .spyOn(
        ipc.ipc as { deckCardIds?: (id: number, inc: boolean) => Promise<number[]> },
        "deckCardIds",
      )
      .mockImplementation(async (_id, includeSubdecks) =>
        includeSubdecks ? [101, 102, 201] : [101, 102],
      );
    const resetSpy = vi
      .spyOn(
        ipc.ipc as {
          resetDeckProgress?: (deckId: number, includeSubdecks?: boolean) => Promise<number>;
        },
        "resetDeckProgress",
      )
      .mockResolvedValue(2);

    render(
      <QueryClientProvider client={queryClient}>
        <DeckBrowserScreen />
      </QueryClientProvider>,
    );

    const moreBtn = await screen.findByRole("button", { name: /More actions for Biology$/i });
    await user.click(moreBtn);
    const resetMenuItem = await screen.findByRole("menuitem", { name: /Reset progress/i });
    await user.click(resetMenuItem);

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/3 cards/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/review history/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Gold never drops below zero/i)).toBeInTheDocument();
    const includeSubdecksCb = within(dialog).getByRole("checkbox", { name: /Include subdecks/i });
    expect(includeSubdecksCb).toBeChecked();

    await user.click(includeSubdecksCb);
    expect(await within(dialog).findByText(/2 cards/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^Reset progress$/i }));

    await waitFor(() => {
      expect(deckCardIdsSpy).toHaveBeenCalledWith(1, true);
      expect(deckCardIdsSpy).toHaveBeenCalledWith(1, false);
      expect(resetSpy).toHaveBeenCalledWith(1, false);
    });
  });

  it("G1: explains in deck UI that Learn includes learning and relearning cards", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Biology",
        parent_id: null,
        new_count: 5,
        learning_count: 7,
        review_count: 3,
        is_filtered: false,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc.ipc, "undoStatus").mockResolvedValue(null);

    render(
      <QueryClientProvider client={queryClient}>
        <DeckBrowserScreen />
      </QueryClientProvider>,
    );

    const hint = await screen.findByTestId("decks-learn-hint");
    expect(hint).toHaveTextContent(/relearning/i);
  });

  it("EXP1: shows Export deck in menu for normal decks and hides it for filtered decks", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Biology",
        parent_id: null,
        new_count: 2,
        learning_count: 0,
        review_count: 3,
        is_filtered: false,
        collapsed: false,
      },
      {
        id: 2,
        name: "Cram",
        parent_id: null,
        new_count: 5,
        learning_count: 0,
        review_count: 0,
        is_filtered: true,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc.ipc, "undoStatus").mockResolvedValue(null);
    vi.spyOn(ipc.ipc, "getExportEstimate").mockResolvedValue({
      notes: 10,
      cards: 20,
      media_files: 2,
      media_bytes: 1024,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <DeckBrowserScreen />
      </QueryClientProvider>,
    );

    const cramMore = await screen.findByRole("button", { name: /More actions for Cram$/i });
    await user.click(cramMore);
    expect(screen.queryByRole("menuitem", { name: /Export deck/i })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    const bioMore = await screen.findByRole("button", { name: /More actions for Biology$/i });
    await user.click(bioMore);
    const exportItem = await screen.findByRole("menuitem", { name: /Export deck/i });
    await user.click(exportItem);

    expect(await screen.findByRole("heading", { name: "Export Biology" })).toBeInTheDocument();
  });

  it("BW2-25: shows staged ImportProgressDialog, supports cancel, and shows nothing-new message", async () => {
    vi.restoreAllMocks();
    const { platform } = await import("@/lib/platform");
    const { act } = await import("@testing-library/react");
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "undoStatus").mockResolvedValue(null);

    let rejectImport!: (err: unknown) => void;
    const importSpy = vi.spyOn(ipc.ipc, "importPackage").mockImplementation(
      () =>
        new Promise((_, rej) => {
          rejectImport = rej;
        }),
    );
    const cancelImportSpy = vi.spyOn(ipc.ipc, "cancelImport").mockResolvedValue(true);
    vi.mocked(platform.pickPath).mockResolvedValueOnce("/path/to/large.apkg");

    render(
      <QueryClientProvider client={queryClient}>
        <DeckBrowserScreen />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /^Import$/ }));
    await waitFor(() => expect(importSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: "Importing package" })).toBeInTheDocument();

    const emit = platformListeners.get("bibalak://import-progress");
    expect(emit).toBeDefined();

    act(() => {
      emit!({ stage: "reading-package", done: 0, total: 0 });
    });
    expect(await screen.findByText("Reading package…")).toBeInTheDocument();

    act(() => {
      emit!({ stage: "copying-media", done: 2, total: 5 });
    });
    expect(await screen.findByText("Copying media 2 of 5…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelImportSpy).toHaveBeenCalledTimes(1);

    act(() => {
      rejectImport({ kind: "cancelled", message: "cancelled" });
    });
    expect(
      await screen.findByText("Import cancelled. Your collection was not changed."),
    ).toBeInTheDocument();

    // Re-import that adds nothing shows "Already in your collection — nothing new"
    vi.mocked(platform.pickPath).mockResolvedValueOnce("/path/to/same.apkg");
    importSpy.mockResolvedValueOnce({
      decks_added: 0,
      notetypes_added: 0,
      notes_added: 0,
      notes_updated: 0,
      cards_added: 0,
      revlog_added: 0,
      media_imported: 2,
    });
    await user.click(screen.getByRole("button", { name: /^Import$/ }));
    expect(await screen.findByText("Already in your collection — nothing new")).toBeInTheDocument();
  });
});
