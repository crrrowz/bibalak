import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DeckSummary,
  HabitBoardDto,
  HabitDto,
  HabitHistoryDto,
  HabitLogDto,
} from "@bibalak/ipc-types";
import { HabitTrackerScreen } from "./HabitTrackerScreen";
import * as ipcModule from "@/lib/ipc";
import { setLocale } from "@/lib/i18n";
import { useStyle } from "@/stores/style";
import { useWeekStart } from "@/stores/weekStart";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

function makeHabit(overrides: Partial<HabitDto> & { id: string; title: string }): HabitDto {
  return {
    notes: "",
    icon_key: "check-circle",
    color_token: "accent",
    frequency_kind: "daily",
    weekdays: [],
    weekly_target: null,
    interval_days: null,
    goal_mode: "achieve_all",
    goal_target: 1,
    goal_unit: "",
    start_day_index: 100,
    start_date: "2026-11-18",
    target_days: null,
    section: "morning",
    reminders: [],
    auto_popup_log: false,
    deck_id: null,
    deck_name: null,
    archived_at: null,
    sort_order: 0,
    current_streak: 3,
    ...overrides,
  };
}

function makeBoard(overrides?: Partial<HabitBoardDto>): HabitBoardDto {
  return {
    today_day_index: 103,
    today_date: "2026-11-21",
    week_days: [
      {
        day_index: 100,
        date: "2026-11-18",
        scheduled_count: 2,
        completed_count: 2,
        excused_count: 0,
        completion_ratio: 1.0,
      },
      {
        day_index: 101,
        date: "2026-11-19",
        scheduled_count: 2,
        completed_count: 1,
        excused_count: 0,
        completion_ratio: 0.5,
      },
      {
        day_index: 102,
        date: "2026-11-20",
        scheduled_count: 2,
        completed_count: 0,
        excused_count: 0,
        completion_ratio: 0.25,
      },
      {
        day_index: 103,
        date: "2026-11-21",
        scheduled_count: 2,
        completed_count: 0,
        excused_count: 0,
        completion_ratio: 0.0,
      },
      {
        day_index: 104,
        date: "2026-11-22",
        scheduled_count: 2,
        completed_count: 0,
        excused_count: 0,
        completion_ratio: 0.0,
      },
      {
        day_index: 105,
        date: "2026-11-23",
        scheduled_count: 2,
        completed_count: 0,
        excused_count: 0,
        completion_ratio: 0.0,
      },
      {
        day_index: 106,
        date: "2026-11-24",
        scheduled_count: 2,
        completed_count: 0,
        excused_count: 0,
        completion_ratio: 0.0,
      },
    ],
    habits: [
      makeHabit({
        id: "h-1",
        title: "Morning meditation",
        goal_mode: "achieve_all",
        goal_target: 1,
        section: "morning",
        current_streak: 5,
      }),
      makeHabit({
        id: "h-2",
        title: "Drink water",
        goal_mode: "reach_amount",
        goal_target: 2000,
        goal_unit: "ml",
        section: "afternoon",
        current_streak: 2,
      }),
      makeHabit({
        id: "h-3",
        title: "Reflect before sleep",
        goal_mode: "achieve_all",
        goal_target: 1,
        section: "night",
        auto_popup_log: true,
        current_streak: 1,
      }),
    ],
    logs: [
      {
        habit_id: "h-2",
        day_index: 103,
        date: "2026-11-21",
        logged_value: 500,
        goal_target: 2000,
        completed: false,
        status: "logged",
        mood: null,
        note: "",
      },
    ],
    ...overrides,
  };
}

const sampleDecks: DeckSummary[] = [
  {
    id: 2,
    name: "Classical Music Themes",
    parent_id: null,
    new_count: 5,
    learning_count: 2,
    review_count: 7,
    is_filtered: false,
    collapsed: false,
  },
];

function renderHabits() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HabitTrackerScreen />
    </QueryClientProvider>,
  );
}

describe("HabitTrackerScreen (M3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLocale("en");
    vi.spyOn(ipcModule.ipc, "listDecks").mockResolvedValue(sampleDecks);
    vi.spyOn(ipcModule.ipc, "undoStatus").mockResolvedValue(null);
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue({
      level: 1,
      xp_into_level: 0,
      xp_to_next_level: 100,
      total_xp: 0,
      earned_gold_cents: 0,
      spent_gold_cents: 0,
      available_gold_cents: 0,
      study_streak: 0,
      studied_today: false,
      freeze_tokens_held: 0,
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
    });
  });

  afterEach(() => {
    cleanup();
    setLocale("en");
  });

  it("renders 7-day strip with SVG rings reflecting completion_ratio and groups habits by section", async () => {
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(makeBoard());

    renderHabits();

    const strip = await screen.findByTestId("habit-week-strip");
    const dayButtons = within(strip).getAllByRole("button");
    expect(dayButtons).toHaveLength(7);

    const ring100 = within(strip).getByTestId("habit-ring-100");
    const ring101 = within(strip).getByTestId("habit-ring-101");
    expect(ring100).toHaveAttribute("data-ratio", "1");
    expect(ring101).toHaveAttribute("data-ratio", "0.5");

    expect(screen.getByText("Morning")).toBeInTheDocument();
    expect(screen.getByText("Afternoon")).toBeInTheDocument();
    expect(screen.getByText("Night")).toBeInTheDocument();
    expect(screen.getByText("Morning meditation")).toBeInTheDocument();
    expect(screen.getByText("Drink water")).toBeInTheDocument();
  });

  it("toggles yes/no habit check-in to 1 and clears to 0", async () => {
    const user = userEvent.setup();
    let board = makeBoard();
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockImplementation(async () => board);
    const logSpy = vi.spyOn(ipcModule.ipc, "logHabit").mockImplementation(async (input) => {
      const log: HabitLogDto = {
        habit_id: input.habit_id,
        day_index: input.day_index ?? board.today_day_index,
        date: "2026-11-21",
        logged_value: input.logged_value,
        goal_target: 1,
        completed: input.logged_value >= 1,
        status: "logged",
        mood: input.mood,
        note: input.note,
      };
      board = {
        ...board,
        logs: [
          ...board.logs.filter(
            (l) => !(l.habit_id === input.habit_id && l.day_index === log.day_index),
          ),
          log,
        ],
      };
      return log;
    });

    renderHabits();

    const toggleBtn = await screen.findByRole("button", { name: /Check in Morning meditation/i });
    await user.click(toggleBtn);
    await waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ habit_id: "h-1", day_index: 103, logged_value: 1 }),
      ),
    );

    const clearBtn = await screen.findByRole("button", {
      name: /Clear check-in for Morning meditation/i,
    });
    await user.click(clearBtn);
    await waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ habit_id: "h-1", day_index: 103, logged_value: 0 }),
      ),
    );
  });

  it("updates amount habits via numeric input", async () => {
    const user = userEvent.setup();
    let board = makeBoard();
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockImplementation(async () => board);
    const logSpy = vi.spyOn(ipcModule.ipc, "logHabit").mockImplementation(async (input) => {
      const log: HabitLogDto = {
        habit_id: input.habit_id,
        day_index: input.day_index ?? board.today_day_index,
        date: "2026-11-21",
        logged_value: input.logged_value,
        goal_target: 2000,
        completed: input.logged_value >= 2000,
        status: "logged",
        mood: input.mood,
        note: input.note,
      };
      board = {
        ...board,
        logs: [
          ...board.logs.filter(
            (l) => !(l.habit_id === input.habit_id && l.day_index === log.day_index),
          ),
          log,
        ],
      };
      return log;
    });

    renderHabits();

    const row = await screen.findByTestId("habit-row-h-2");
    const amountInput = within(row).getByRole("spinbutton", { name: /Drink water/i });
    await user.clear(amountInput);
    await user.type(amountInput, "1500");
    await user.click(within(row).getByRole("button", { name: /Save amount/i }));

    await waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ habit_id: "h-2", logged_value: 1500 }),
      ),
    );
  });

  function mockHabitCreate() {
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(makeBoard());
    return vi.spyOn(ipcModule.ipc, "createHabit").mockImplementation(async (input) =>
      makeHabit({
        id: `h-new-${input.frequency_kind}`,
        title: input.title,
        frequency_kind: input.frequency_kind,
        weekdays: input.weekdays,
        weekly_target: input.weekly_target,
        interval_days: input.interval_days,
      }),
    );
  }

  async function submitCreateHabitDialog(
    user: ReturnType<typeof userEvent.setup>,
    title: string,
    frequency?: "daily" | "weekdays" | "weekly_count" | "every_n_days",
    assertDialog?: (dialog: HTMLElement) => void,
  ) {
    await user.click(screen.getByRole("button", { name: /New habit/i }));
    const dialog = await screen.findByRole("dialog");
    assertDialog?.(dialog);
    await user.type(within(dialog).getByLabelText(/Title/i), title);
    if (frequency && frequency !== "daily") {
      await user.selectOptions(within(dialog).getByLabelText(/Frequency/i), frequency);
    }
    await user.click(within(dialog).getByRole("button", { name: /^Create$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }

  it("creates a daily habit and states reminders do not fire notifications", async () => {
    const user = userEvent.setup();
    const createSpy = mockHabitCreate();

    renderHabits();
    await screen.findByTestId("habit-week-strip");

    await submitCreateHabitDialog(user, "Daily reading", "daily", (dialog) => {
      expect(within(dialog).getByText(/notifications are not sent/i)).toBeInTheDocument();
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Daily reading", frequency_kind: "daily" }),
    );
  });

  it("creates a weekdays habit", async () => {
    const user = userEvent.setup();
    const createSpy = mockHabitCreate();

    renderHabits();
    await screen.findByTestId("habit-week-strip");

    await submitCreateHabitDialog(user, "Weekday gym", "weekdays");
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Weekday gym", frequency_kind: "weekdays" }),
    );
  });

  it("creates a weekly_count habit with default target 3", async () => {
    const user = userEvent.setup();
    const createSpy = mockHabitCreate();

    renderHabits();
    await screen.findByTestId("habit-week-strip");

    await submitCreateHabitDialog(user, "Run 3x week", "weekly_count");
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Run 3x week",
        frequency_kind: "weekly_count",
        weekly_target: 3,
      }),
    );
  });

  it("creates an every_n_days habit with default interval 2", async () => {
    const user = userEvent.setup();
    const createSpy = mockHabitCreate();

    renderHabits();
    await screen.findByTestId("habit-week-strip");

    await submitCreateHabitDialog(user, "Water plants", "every_n_days");
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Water plants",
        frequency_kind: "every_n_days",
        interval_days: 2,
      }),
    );
  });

  it("auto-opens the habit log dialog after check-in when auto_popup_log is enabled", async () => {
    const user = userEvent.setup();
    const board = makeBoard();
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(board);
    const logSpy = vi.spyOn(ipcModule.ipc, "logHabit").mockImplementation(async (input) => ({
      habit_id: input.habit_id,
      day_index: input.day_index ?? 103,
      date: "2026-11-21",
      logged_value: input.logged_value,
      goal_target: 1,
      completed: input.logged_value >= 1,
      status: "logged",
      mood: input.mood,
      note: input.note,
    }));

    renderHabits();

    const toggleBtn = await screen.findByRole("button", { name: /Check in Reflect before sleep/i });
    await user.click(toggleBtn);

    const logDialog = await screen.findByRole("dialog");
    await user.click(within(logDialog).getByRole("button", { name: /Mood 4/i }));
    await user.type(within(logDialog).getByLabelText(/Reflection note/i), "Felt rested");
    await user.click(within(logDialog).getByRole("button", { name: /Save log/i }));

    await waitFor(() =>
      expect(logSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          habit_id: "h-3",
          mood: 4,
          note: "Felt rested",
        }),
      ),
    );
  });

  it("hides archived habits when archived and blocks logging on future days", async () => {
    const user = userEvent.setup();
    let board = makeBoard();
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockImplementation(async () => board);
    const archiveSpy = vi
      .spyOn(ipcModule.ipc, "archiveHabit")
      .mockImplementation(async (id, archived) => {
        board = {
          ...board,
          habits: archived ? board.habits.filter((h) => h.id !== id) : board.habits,
        };
      });
    const logSpy = vi.spyOn(ipcModule.ipc, "logHabit");

    renderHabits();

    const row = await screen.findByTestId("habit-row-h-1");
    await user.click(within(row).getByRole("button", { name: /Actions for Morning meditation/i }));
    await user.click(screen.getByRole("menuitem", { name: /Archive/i }));

    await waitFor(() => expect(archiveSpy).toHaveBeenCalledWith("h-1", true));
    await waitFor(() => expect(screen.queryByText("Morning meditation")).not.toBeInTheDocument());

    // Select a future day (day_index 105 > today_day_index 103)
    const strip = screen.getByTestId("habit-week-strip");
    await user.click(within(strip).getByTestId("habit-day-105"));

    expect(await screen.findByTestId("habit-future-notice")).toBeInTheDocument();
    const amountRow = screen.getByTestId("habit-row-h-2");
    expect(within(amountRow).getByRole("spinbutton")).toBeDisabled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("orders the 7-day strip logically in RTL Arabic", async () => {
    setLocale("ar");
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(makeBoard());

    renderHabits();

    expect(document.documentElement.dir).toBe("rtl");
    const strip = await screen.findByTestId("habit-week-strip");
    const dayButtons = within(strip).getAllByRole("button");
    expect(dayButtons[0]).toHaveAttribute("data-testid", "habit-day-100");
    expect(dayButtons[6]).toHaveAttribute("data-testid", "habit-day-106");
  });

  it("renders deck-linked habit count as read-only from reviews while keeping note/mood log (R3)", async () => {
    const linkedHabit = makeHabit({
      id: "h-deck",
      title: "Review 30 Classical Music cards",
      goal_mode: "reach_amount",
      goal_target: 30,
      goal_unit: "cards",
      deck_id: 2,
      deck_name: "Classical Music Themes",
    });
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(
      makeBoard({
        habits: [linkedHabit],
        logs: [
          {
            habit_id: "h-deck",
            day_index: 103,
            date: "2026-11-21",
            logged_value: 18,
            goal_target: 30,
            completed: false,
            status: "logged",
            mood: null,
            note: "",
          },
        ],
      }),
    );

    renderHabits();

    const row = await screen.findByTestId("habit-row-h-deck");
    expect(within(row).getByText("from your reviews")).toBeInTheDocument();
    expect(within(row).queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /Actions for Review 30/i })).toBeInTheDocument();
  });

  it("renders Arabic progress fraction with 'من' instead of reversed slash (A1)", async () => {
    setLocale("ar");
    const habit = makeHabit({
      id: "h-ar",
      title: "مراجعة سريعة",
      goal_mode: "reach_amount",
      goal_target: 2,
      goal_unit: "مرات",
    });
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(
      makeBoard({
        habits: [habit],
        logs: [
          {
            habit_id: "h-ar",
            day_index: 103,
            date: "2026-11-21",
            logged_value: 1,
            goal_target: 2,
            completed: false,
            status: "logged",
            mood: null,
            note: "",
          },
        ],
      }),
    );

    renderHabits();

    const row = await screen.findByTestId("habit-row-h-ar");
    expect(within(row).getByText(/1 من 2/)).toBeInTheDocument();
  });
});

describe("HabitTrackerScreen (PLN3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    setLocale("en");
    useStyle.getState().setStyle("default");
    useWeekStart.getState().setWeekStart("mon");
    vi.spyOn(ipcModule.ipc, "listDecks").mockResolvedValue(sampleDecks);
    vi.spyOn(ipcModule.ipc, "undoStatus").mockResolvedValue(null);
    vi.spyOn(ipcModule.ipc, "listArchivedHabits").mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    setLocale("en");
    useStyle.getState().setStyle("default");
    useWeekStart.getState().setWeekStart("mon");
  });

  it("habit_detail_drawer_renders_month_grid_heatmap_stats_notes", async () => {
    const user = userEvent.setup();
    const board = makeBoard();
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(board);

    const history: HabitHistoryDto = {
      habit: board.habits[1],
      today_day_index: 103,
      today_date: "2026-11-21",
      current_streak: 6,
      longest_streak: 14,
      completed_days: 22,
      skipped_days: 2,
      frozen_days: 0,
      completion_rate_pct: 91.7,
      logs: [
        {
          habit_id: "h-2",
          day_index: 101,
          date: "2026-11-19",
          logged_value: 2000,
          goal_target: 2000,
          completed: true,
          status: "logged",
          mood: 5,
          note: "Hydrated early",
        },
        {
          habit_id: "h-2",
          day_index: 102,
          date: "2026-11-20",
          logged_value: 0,
          goal_target: 2000,
          completed: false,
          status: "skipped",
          mood: null,
          note: "Travel day",
        },
      ],
    };
    const historySpy = vi.spyOn(ipcModule.ipc, "getHabitHistory").mockResolvedValue(history);

    renderHabits();

    await user.click(await screen.findByRole("button", { name: /Open history for Drink water/i }));

    await waitFor(() => expect(historySpy).toHaveBeenCalledWith("h-2", 12, "mon"));
    const panel = await screen.findByRole("complementary", { name: /Habit history/i });
    expect(within(panel).getByText(/6 day streak/i)).toBeInTheDocument();
    expect(within(panel).getByText(/14 day streak/i)).toBeInTheDocument();
    expect(within(panel).getByText(/92%/)).toBeInTheDocument();
    expect(within(panel).getByTestId("habit-month-grid")).toBeInTheDocument();
    expect(within(panel).getByTestId("habit-year-heatmap")).toBeInTheDocument();
    expect(within(panel).getByText("Hydrated early")).toBeInTheDocument();
    expect(within(panel).getByText("Travel day")).toBeInTheDocument();
  });

  it("amount_ring_and_preset_buttons_save_progress_and_keep_deck_readonly", async () => {
    const user = userEvent.setup();
    const deckHabit = makeHabit({
      id: "h-deck",
      title: "Review 30 Classical Music cards",
      goal_mode: "reach_amount",
      goal_target: 30,
      goal_unit: "cards",
      deck_id: 2,
      deck_name: "Classical Music Themes",
    });
    const smallHabit = makeHabit({
      id: "h-small",
      title: "Read chapters",
      goal_mode: "reach_amount",
      goal_target: 8,
      goal_unit: "ch",
    });
    const medHabit = makeHabit({
      id: "h-med",
      title: "Read pages",
      goal_mode: "reach_amount",
      goal_target: 50,
      goal_unit: "pages",
    });
    const largeHabit = makeHabit({
      id: "h-large",
      title: "Drink water",
      goal_mode: "reach_amount",
      goal_target: 2000,
      goal_unit: "ml",
    });
    const board = makeBoard({
      habits: [smallHabit, medHabit, largeHabit, deckHabit],
      logs: [
        {
          habit_id: "h-large",
          day_index: 103,
          date: "2026-11-21",
          logged_value: 500,
          goal_target: 2000,
          completed: false,
          status: "logged",
          mood: null,
          note: "",
        },
        {
          habit_id: "h-deck",
          day_index: 103,
          date: "2026-11-21",
          logged_value: 15,
          goal_target: 30,
          completed: false,
          status: "logged",
          mood: null,
          note: "",
        },
      ],
    });
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(board);
    const logSpy = vi.spyOn(ipcModule.ipc, "logHabit").mockImplementation(async (input) => ({
      habit_id: input.habit_id,
      day_index: input.day_index ?? 103,
      date: "2026-11-21",
      logged_value: input.logged_value,
      goal_target: 2000,
      completed: input.logged_value >= 2000,
      status: input.status ?? "logged",
      mood: input.mood,
      note: input.note,
    }));

    renderHabits();

    const largeRow = await screen.findByTestId("habit-row-h-large");
    expect(within(largeRow).getByTestId("habit-amount-ring-h-large")).toBeInTheDocument();
    expect(
      within(largeRow).getByRole("button", { name: /Add 50 to Drink water/i }),
    ).toBeInTheDocument();
    expect(
      within(largeRow).getByRole("button", { name: /Add 250 to Drink water/i }),
    ).toBeInTheDocument();

    await user.click(within(largeRow).getByRole("button", { name: /Add 250 to Drink water/i }));
    await waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ habit_id: "h-large", logged_value: 750 }),
      ),
    );

    await user.click(within(largeRow).getByRole("button", { name: /^Complete$/i }));
    await waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ habit_id: "h-large", logged_value: 2000 }),
      ),
    );

    const smallRow = screen.getByTestId("habit-row-h-small");
    expect(
      within(smallRow).getByRole("button", { name: /Add 1 to Read chapters/i }),
    ).toBeInTheDocument();
    expect(
      within(smallRow).queryByRole("button", { name: /Add 5 to Read chapters/i }),
    ).not.toBeInTheDocument();

    const medRow = screen.getByTestId("habit-row-h-med");
    expect(
      within(medRow).getByRole("button", { name: /Add 1 to Read pages/i }),
    ).toBeInTheDocument();
    expect(
      within(medRow).getByRole("button", { name: /Add 5 to Read pages/i }),
    ).toBeInTheDocument();
    expect(
      within(medRow).getByRole("button", { name: /Add 10 to Read pages/i }),
    ).toBeInTheDocument();

    const deckRow = screen.getByTestId("habit-row-h-deck");
    expect(within(deckRow).getByTestId("habit-amount-ring-h-deck")).toBeInTheDocument();
    expect(within(deckRow).getByText("from your reviews")).toBeInTheDocument();
    expect(within(deckRow).queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(within(deckRow).queryByRole("button", { name: /Complete/i })).not.toBeInTheDocument();
  });

  it("archived_drawer_lists_and_restores_habits", async () => {
    const user = userEvent.setup();
    const archivedHabit = makeHabit({
      id: "h-arch",
      title: "Cold shower",
      archived_at: 1_763_600_000_000,
    });
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(makeBoard());
    vi.spyOn(ipcModule.ipc, "listArchivedHabits").mockResolvedValue([archivedHabit]);
    const archiveSpy = vi.spyOn(ipcModule.ipc, "archiveHabit").mockResolvedValue(undefined);

    renderHabits();

    await user.click(await screen.findByRole("button", { name: /Archived/i }));

    const drawer = await screen.findByRole("complementary", { name: /Archived habits/i });
    expect(within(drawer).getByText("Cold shower")).toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: /Restore/i }));

    await waitFor(() => expect(archiveSpy).toHaveBeenCalledWith("h-arch", false));
  });

  it("skip_day_renders_neutral_state_and_bridges_streak", async () => {
    const user = userEvent.setup();
    let board = makeBoard({
      week_days: makeBoard().week_days.map((d) =>
        d.day_index === 102
          ? { ...d, scheduled_count: 0, excused_count: 1, completion_ratio: 0 }
          : d,
      ),
    });
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockImplementation(async () => board);
    const logSpy = vi.spyOn(ipcModule.ipc, "logHabit").mockImplementation(async (input) => {
      const log: HabitLogDto = {
        habit_id: input.habit_id,
        day_index: input.day_index ?? 103,
        date: "2026-11-21",
        logged_value: 0,
        goal_target: 1,
        completed: false,
        status: input.status ?? "logged",
        mood: input.mood,
        note: input.note,
      };
      board = {
        ...board,
        logs: [
          ...board.logs.filter(
            (l) => !(l.habit_id === input.habit_id && l.day_index === log.day_index),
          ),
          log,
        ],
      };
      return log;
    });

    renderHabits();

    const strip = await screen.findByTestId("habit-week-strip");
    expect(within(strip).getByTestId("habit-ring-102")).toHaveAttribute("data-excused", "1");

    const row = screen.getByTestId("habit-row-h-1");
    await user.click(within(row).getByRole("button", { name: /Skip day/i }));

    await waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          habit_id: "h-1",
          day_index: 103,
          logged_value: 0,
          status: "skipped",
        }),
      ),
    );

    expect(await within(row).findByText("Skipped")).toBeInTheDocument();
    expect(within(row).getByText("5 day streak")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /Undo skip/i })).toBeInTheDocument();
  });

  it("game_freeze_hook_hidden_in_default_and_scholar", async () => {
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(makeBoard());

    const { rerender } = renderHabits();
    await screen.findByTestId("habit-week-strip");
    expect(document.querySelector('[data-slot="game-freeze"]')).toBeNull();

    act(() => {
      useStyle.getState().setStyle("scholar");
    });
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <HabitTrackerScreen />
      </QueryClientProvider>,
    );
    await screen.findByTestId("habit-week-strip");
    expect(document.querySelector('[data-slot="game-freeze"]')).toBeNull();

    act(() => {
      useStyle.setState({ style: "game" as never });
    });
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <HabitTrackerScreen />
      </QueryClientProvider>,
    );
    await screen.findByTestId("habit-week-strip");
    expect(document.querySelector('[data-slot="game-freeze"]')).not.toBeNull();
  });

  it("habit_board_requested_with_week_start_sat", async () => {
    useWeekStart.getState().setWeekStart("sat");
    const boardSpy = vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(makeBoard());

    renderHabits();

    await waitFor(() => expect(boardSpy).toHaveBeenCalledWith(null, "sat"));
  });

  it("supports keyboard shortcuts (Q, J/K, T, A, S, Enter, Esc) and Scholar excused wording", async () => {
    const user = userEvent.setup();
    useStyle.getState().setStyle("scholar");
    const board = makeBoard();
    const boardSpy = vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(board);
    vi.spyOn(ipcModule.ipc, "getHabitHistory").mockResolvedValue({
      habit: board.habits[0],
      today_day_index: 103,
      today_date: "2026-11-21",
      current_streak: 5,
      longest_streak: 5,
      completed_days: 5,
      skipped_days: 0,
      frozen_days: 0,
      completion_rate_pct: 100,
      logs: [],
    });
    const logSpy = vi.spyOn(ipcModule.ipc, "logHabit").mockResolvedValue({
      habit_id: "h-1",
      day_index: 103,
      date: "2026-11-21",
      logged_value: 0,
      goal_target: 1,
      completed: false,
      status: "skipped",
      mood: null,
      note: "",
    });

    renderHabits();
    await screen.findByTestId("habit-week-strip");

    // Scholar wording on row Skip button
    expect(
      within(screen.getByTestId("habit-row-h-1")).getByRole("button", { name: /Excuse day/i }),
    ).toBeInTheDocument();

    // J / K / T navigate weeks
    await user.keyboard("j");
    await waitFor(() => expect(boardSpy).toHaveBeenCalledWith(107, "mon"));
    await user.keyboard("t");
    await waitFor(() => expect(boardSpy).toHaveBeenLastCalledWith(null, "mon"));

    // Focus row + Enter opens detail panel; Esc closes it; S excuses day
    const row1 = screen.getByTestId("habit-row-h-1");
    row1.focus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("complementary", { name: /Study routine log/i }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: /Study routine log/i }),
      ).not.toBeInTheDocument(),
    );

    row1.focus();
    await user.keyboard("s");
    await waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ habit_id: "h-1", status: "skipped" }),
      ),
    );

    // A toggles Archived drawer; Q opens New habit dialog
    await user.keyboard("a");
    expect(
      await screen.findByRole("complementary", { name: /Archived habits/i }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.keyboard("q");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("confirms deletion in ArchivedHabitsDrawer and allows past-day actions in HabitDetailPanel", async () => {
    const user = userEvent.setup();
    const board = makeBoard();
    const archivedHabit = makeHabit({
      id: "h-arch-2",
      title: "Stretch at noon",
      archived_at: 1_763_600_000_000,
    });
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(board);
    vi.spyOn(ipcModule.ipc, "listArchivedHabits").mockResolvedValue([archivedHabit]);
    const deleteSpy = vi.spyOn(ipcModule.ipc, "deleteHabit").mockResolvedValue(undefined);
    vi.spyOn(ipcModule.ipc, "getHabitHistory").mockResolvedValue({
      habit: board.habits[0],
      today_day_index: 103,
      today_date: "2026-11-21",
      current_streak: 5,
      longest_streak: 5,
      completed_days: 5,
      skipped_days: 0,
      frozen_days: 0,
      completion_rate_pct: 100,
      logs: [],
    });
    const logSpy = vi.spyOn(ipcModule.ipc, "logHabit").mockResolvedValue({
      habit_id: "h-1",
      day_index: 102,
      date: "2026-11-20",
      logged_value: 0,
      goal_target: 1,
      completed: false,
      status: "skipped",
      mood: null,
      note: "",
    });

    renderHabits();

    await user.click(await screen.findByRole("button", { name: /Archived/i }));
    const drawer = await screen.findByRole("complementary", { name: /Archived habits/i });
    await user.click(within(drawer).getByRole("button", { name: /Delete/i }));
    const confirmDialog = await screen.findByRole("alertdialog");
    await user.click(within(confirmDialog).getByRole("button", { name: /^Delete$/i }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith("h-arch-2"));

    await user.click(screen.getByRole("button", { name: /Open history for Morning meditation/i }));
    const monthGrid = await screen.findByTestId("habit-month-grid");
    const pastCell = monthGrid.querySelector('button[data-date="2026-11-20"]') as HTMLButtonElement;
    await user.click(pastCell);
    const dayActions = await screen.findByTestId("habit-detail-day-actions");
    await user.click(within(dayActions).getByRole("button", { name: /Skip day/i }));
    await waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ habit_id: "h-1", day_index: 102, status: "skipped" }),
      ),
    );
  });

  it("game_freeze_controls_enforce_disabled_reasons_and_toggle_frozen", async () => {
    const user = userEvent.setup();
    useStyle.setState({ style: "game" as never });

    let freezeTokensHeld = 0;
    let board = makeBoard({
      logs: [
        {
          habit_id: "h-2",
          day_index: 103,
          date: "2026-11-21",
          logged_value: 2000,
          goal_target: 2000,
          completed: true,
          status: "logged",
          mood: null,
          note: "",
        },
      ],
    });

    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockImplementation(async () => board);
    vi.spyOn(ipcModule.ipc, "getGameState").mockImplementation(async () => ({
      level: 4,
      xp_into_level: 120,
      xp_to_next_level: 250,
      total_xp: 570,
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
    }));
    const logSpy = vi.spyOn(ipcModule.ipc, "logHabit").mockImplementation(async (input) => {
      const status = input.status ?? "logged";
      const dayIdx = input.day_index ?? board.today_day_index;
      if (status === "frozen") {
        freezeTokensHeld = Math.max(0, freezeTokensHeld - 1);
      } else {
        const prev = board.logs.find(
          (l) => l.habit_id === input.habit_id && l.day_index === dayIdx,
        );
        if (prev?.status === "frozen") freezeTokensHeld += 1;
      }
      const log: HabitLogDto = {
        habit_id: input.habit_id,
        day_index: dayIdx,
        date: dayIdx === 102 ? "2026-11-20" : "2026-11-21",
        logged_value: status === "logged" ? input.logged_value : 0,
        goal_target: 1,
        completed: status === "logged" && input.logged_value >= 1,
        status,
        mood: input.mood,
        note: input.note,
      };
      board = {
        ...board,
        logs: [
          ...board.logs.filter((l) => !(l.habit_id === input.habit_id && l.day_index === dayIdx)),
          log,
        ],
      };
      return log;
    });

    renderHabits();

    const row1 = await screen.findByTestId("habit-row-h-1");
    const freezeBtn0 = within(row1).getByRole("button", { name: /Streak Freeze/i });
    expect(freezeBtn0).toBeDisabled();
    expect(freezeBtn0).toHaveAttribute("title", "No freeze tokens — buy in Shop");

    // Completed habit on today has disabled freeze with "Already completed"
    const row2 = screen.getByTestId("habit-row-h-2");
    const freezeBtnDone = within(row2).getByRole("button", { name: /Streak Freeze/i });
    expect(freezeBtnDone).toBeDisabled();
    expect(freezeBtnDone).toHaveAttribute("title", "Already completed");

    // Grant 2 tokens and remount cleanly so query refreshes
    freezeTokensHeld = 2;
    cleanup();
    renderHabits();

    const row1Fresh = await screen.findByTestId("habit-row-h-1");
    const freezeBtnReady = await within(row1Fresh).findByRole("button", {
      name: /Streak Freeze/i,
    });
    await waitFor(() => expect(freezeBtnReady).toBeEnabled());
    await user.click(freezeBtnReady);

    await waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ habit_id: "h-1", day_index: 103, status: "frozen" }),
      ),
    );

    const unfreezeBtn = await within(row1Fresh).findByRole("button", { name: /Unfreeze/i });
    expect(unfreezeBtn).toHaveAttribute("aria-pressed", "true");
    await user.click(unfreezeBtn);

    await waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          habit_id: "h-1",
          day_index: 103,
          logged_value: 0,
          status: "logged",
        }),
      ),
    );

    // Selecting 2 days ago (101) disables freeze with window hint
    await user.click(screen.getByTestId("habit-day-101"));
    const olderBtn = within(screen.getByTestId("habit-row-h-1")).getByRole("button", {
      name: /Streak Freeze/i,
    });
    expect(olderBtn).toBeDisabled();
    expect(olderBtn).toHaveAttribute("title", "Only today and yesterday can be frozen");
  });

  it("habit_detail_panel_renders_streak_protection_card_and_freezes_yesterday", async () => {
    const user = userEvent.setup();
    useStyle.setState({ style: "game" as never });
    const board = makeBoard();
    let tokensHeld = 0;

    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(board);
    vi.spyOn(ipcModule.ipc, "getGameState").mockImplementation(async () => ({
      level: 4,
      xp_into_level: 120,
      xp_to_next_level: 250,
      total_xp: 570,
      earned_gold_cents: 4750,
      spent_gold_cents: 0,
      available_gold_cents: 4750,
      study_streak: 6,
      studied_today: true,
      freeze_tokens_held: tokensHeld,
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
    }));
    vi.spyOn(ipcModule.ipc, "getHabitHistory").mockResolvedValue({
      habit: board.habits[0],
      today_day_index: 103,
      today_date: "2026-11-21",
      current_streak: 5,
      longest_streak: 5,
      completed_days: 5,
      skipped_days: 0,
      frozen_days: 0,
      completion_rate_pct: 100,
      logs: [],
    });
    const logSpy = vi.spyOn(ipcModule.ipc, "logHabit").mockResolvedValue({
      habit_id: "h-1",
      day_index: 102,
      date: "2026-11-20",
      logged_value: 0,
      goal_target: 1,
      completed: false,
      status: "frozen",
      mood: null,
      note: "",
    });

    renderHabits();

    await user.click(
      await screen.findByRole("button", { name: /Open history for Morning meditation/i }),
    );
    const detailPanel = await screen.findByRole("complementary", { name: /Habit stats/i });
    expect(within(detailPanel).getByText("Streak protection")).toBeInTheDocument();
    expect(within(detailPanel).getByText("0 of 3 held")).toBeInTheDocument();
    expect(within(detailPanel).getByText("No freeze tokens — buy in Shop")).toBeInTheDocument();
    expect(within(detailPanel).getByRole("link", { name: /Buy in Shop/i })).toHaveAttribute(
      "href",
      "/shop",
    );

    // With 2 tokens held, Freeze yesterday sends status: "frozen" for today_day_index - 1
    tokensHeld = 2;
    cleanup();
    renderHabits();
    await user.click(
      await screen.findByRole("button", { name: /Open history for Morning meditation/i }),
    );
    const panelWithTokens = await screen.findByRole("complementary", { name: /Habit stats/i });
    const freezeYesterdayBtn = await within(panelWithTokens).findByRole("button", {
      name: /Freeze yesterday/i,
    });
    await waitFor(() => expect(freezeYesterdayBtn).toBeEnabled());
    await user.click(freezeYesterdayBtn);
    await waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ habit_id: "h-1", day_index: 102, status: "frozen" }),
      ),
    );
  });

  it("week_strip_tooltip_separates_frozen_from_skipped_and_uses_excused_in_scholar", async () => {
    useStyle.getState().setStyle("scholar");
    const scholarBoard = makeBoard({
      week_days: makeBoard().week_days.map((d) =>
        d.day_index === 102
          ? { ...d, scheduled_count: 1, excused_count: 1, completion_ratio: 0 }
          : d,
      ),
      logs: [
        {
          habit_id: "h-1",
          day_index: 102,
          date: "2026-11-20",
          logged_value: 0,
          goal_target: 1,
          completed: false,
          status: "skipped",
          mood: null,
          note: "",
        },
      ],
    });
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(scholarBoard);

    renderHabits();
    const scholarDay102 = await screen.findByTestId("habit-day-102");
    expect(scholarDay102.getAttribute("title")).toMatch(/excused/i);
    expect(scholarDay102.getAttribute("title")).not.toMatch(/skipped/i);

    cleanup();
    useStyle.setState({ style: "game" as never });
    const gameBoard = makeBoard({
      week_days: makeBoard().week_days.map((d) =>
        d.day_index === 101 || d.day_index === 102
          ? { ...d, scheduled_count: 1, excused_count: 1, completion_ratio: 0 }
          : d,
      ),
      logs: [
        {
          habit_id: "h-1",
          day_index: 101,
          date: "2026-11-19",
          logged_value: 0,
          goal_target: 1,
          completed: false,
          status: "skipped",
          mood: null,
          note: "",
        },
        {
          habit_id: "h-1",
          day_index: 102,
          date: "2026-11-20",
          logged_value: 0,
          goal_target: 1,
          completed: false,
          status: "frozen",
          mood: null,
          note: "",
        },
      ],
    });
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(gameBoard);
    renderHabits();

    await waitFor(() => {
      const day101 = screen.getByTestId("habit-day-101");
      const day102 = screen.getByTestId("habit-day-102");
      expect(day101.getAttribute("title")).toMatch(/skipped/i);
      expect(day101.getAttribute("title")).not.toMatch(/frozen/i);
      expect(day102.getAttribute("title")).toMatch(/frozen/i);
      expect(day102.getAttribute("title")).not.toMatch(/skipped/i);
    });
  });
});
