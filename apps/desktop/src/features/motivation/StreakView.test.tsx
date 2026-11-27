import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MotivationStateDto, StreakCalendarDto } from "@bibalak/ipc-types";
import { StreakContent } from "./StreakContent";
import { motivationMocks } from "@/dev/mocks/motivation";
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

function makeCalendar(year = 2026, month = 11, canFreeze = true): StreakCalendarDto {
  return {
    year,
    month,
    today_day_index: 365,
    today_date: "2026-11-24",
    daily_goal_xp: 20,
    current_streak: 14,
    best_streak: 21,
    studied_today: true,
    next_milestone: 30,
    milestones: [
      { target: 7, achieved: true },
      { target: 30, achieved: false },
      { target: 100, achieved: false },
      { target: 365, achieved: false },
    ],
    freeze_tokens_held: 2,
    freeze_token_cap: 3,
    can_freeze_day: canFreeze ? 364 : null,
    days: [
      {
        day_index: 362,
        date: `${year}-${String(month).padStart(2, "0")}-21`,
        day_of_month: 21,
        is_future: false,
        studied: false,
        goal_met: false,
        frozen: true,
        xp: 0,
        reviews: 0,
        tasks_completed: 0,
        habits_completed: 0,
      },
      {
        day_index: 363,
        date: `${year}-${String(month).padStart(2, "0")}-22`,
        day_of_month: 22,
        is_future: false,
        studied: true,
        goal_met: false,
        frozen: false,
        xp: 12,
        reviews: 6,
        tasks_completed: 0,
        habits_completed: 0,
      },
      {
        day_index: 364,
        date: `${year}-${String(month).padStart(2, "0")}-23`,
        day_of_month: 23,
        is_future: false,
        studied: false,
        goal_met: false,
        frozen: false,
        xp: 0,
        reviews: 0,
        tasks_completed: 0,
        habits_completed: 0,
      },
      {
        day_index: 365,
        date: `${year}-${String(month).padStart(2, "0")}-24`,
        day_of_month: 24,
        is_future: false,
        studied: true,
        goal_met: true,
        frozen: false,
        xp: 35,
        reviews: 20,
        tasks_completed: 1,
        habits_completed: 1,
      },
    ],
  };
}

describe("StreakView (16e)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  afterEach(() => {
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it("streak_screen_renders_calendar_frozen_days_and_next_milestone_in_en_and_ar", async () => {
    useStyle.getState().setStyle("game");
    const calSpy = vi
      .spyOn(ipcModule.ipc, "getStreakCalendar")
      .mockImplementation(async (year, month) => makeCalendar(year, month));
    const freezeSpy = vi
      .spyOn(ipcModule.ipc, "freezeStudyDay")
      .mockResolvedValue({ ...makeCalendar(2026, 11, false), freeze_tokens_held: 1 });

    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <StreakContent />
      </QueryClientProvider>,
    );

    await screen.findByText("14 days");
    const view = screen.getByTestId("streak-view");
    expect(view).toHaveTextContent("14 days");
    expect(view).toHaveTextContent("21 days");
    expect(view).toHaveTextContent("Next milestone: 30 days");
    expect(view).toHaveTextContent("14 / 30 days");
    expect(view).toHaveTextContent("Streak Freezes held: 2 / 3");

    expect(screen.getByTestId("streak-day-21")).toHaveAttribute("data-day-status", "frozen");
    expect(screen.getByTestId("streak-day-22")).toHaveAttribute("data-day-status", "studied");
    expect(screen.getByTestId("streak-day-24")).toHaveAttribute("data-day-status", "goal-met");

    // Manual freeze yesterday button
    const freezeBtn = screen.getByRole("button", { name: /Protect yesterday with Streak Freeze/i });
    await user.click(freezeBtn);
    await waitFor(() => expect(freezeSpy).toHaveBeenCalledWith(364));

    // Month navigation
    await user.click(screen.getByRole("button", { name: /Previous month/i }));
    await waitFor(() => expect(calSpy).toHaveBeenCalledWith(2026, 10));

    // Arabic + RTL
    setLocale("ar");
    useStyle.getState().setStyle("scholar");
    rerender(
      <QueryClientProvider client={client}>
        <StreakContent />
      </QueryClientProvider>,
    );

    const arView = await screen.findByTestId("streak-view");
    expect(arView).toHaveTextContent("سلسلة المواظبة");
    expect(arView).toHaveTextContent("14 من 30 يومًا");
    const prevSvg = screen.getByRole("button", { name: "الشهر السابق" }).querySelector("svg");
    expect(prevSvg?.getAttribute("class")).toContain("rtl:-scale-x-100");
  });

  it("MOT-PERIOD: syncs period month/year once motivationQuery today_date loads", async () => {
    let resolveMotivation!: (val: MotivationStateDto) => void;
    vi.spyOn(ipcModule.ipc, "getMotivationState").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMotivation = resolve;
        }),
    );
    const calSpy = vi
      .spyOn(ipcModule.ipc, "getStreakCalendar")
      .mockImplementation(async (year, month) => makeCalendar(year, month));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <StreakContent />
      </QueryClientProvider>,
    );

    const baseState = (motivationMocks.get_motivation_state as () => MotivationStateDto)();
    resolveMotivation({
      ...baseState,
      today_date: "2024-02-15",
      today_day_index: 45,
    });

    await waitFor(() => {
      expect(calSpy).toHaveBeenCalledWith(2024, 2);
    });
  });
});
