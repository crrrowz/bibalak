import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenHeader } from "@/components/ScreenHeader";
import { AchievementsPanel } from "@/features/game/depth/AchievementsPanel";
import { QuestsView } from "@/features/quests/QuestsView";
import { setLocale } from "@/lib/i18n";
import { ar } from "@/locales/ar";
import { en } from "@/locales/en";
import { StreakScreen } from "@/features/motivation/StreakScreen";
import { useStyle } from "@/stores/style";

const ipcMock = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  getGameDepthState: vi.fn(),
  getMotivationState: vi.fn(),
  getStreakCalendar: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  isTauri: ipcMock.isTauri,
  ipc: {
    getGameDepthState: ipcMock.getGameDepthState,
    getMotivationState: ipcMock.getMotivationState,
    getStreakCalendar: ipcMock.getStreakCalendar,
  },
}));

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("H4 UX & §B3 regression suite", () => {
  beforeEach(() => {
    setLocale("en");
    useStyle.setState({ style: "default" });
    vi.clearAllMocks();
    ipcMock.isTauri.mockReturnValue(true);
  });

  it("1-2. ScreenHeader wraps actions and allows title/description shrinking at 700px", () => {
    const { container } = render(
      <ScreenHeader
        title="المجموعات"
        description={<span>120 جديدة · 50 للمراجعة</span>}
        actions={
          <>
            <button type="button">استيراد</button>
            <button type="button">استيراد نص</button>
            <button type="button">تراجع</button>
            <button type="button">مجموعة مصفاة</button>
            <button type="button">مجموعة جديدة</button>
          </>
        }
      />,
    );

    const header = container.firstElementChild as HTMLElement;
    expect(header.className).toContain("flex-wrap");
    expect(header.className).toContain("min-h-12");
    expect(header.className).not.toMatch(/(?:^|\s)h-12(?:\s|$)/);

    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).toContain("shrink-0");
    expect(h1.className).not.toContain("truncate");

    const actionsContainer = screen.getByRole("button", { name: "استيراد" }).parentElement!;
    expect(actionsContainer.className).toContain("flex-wrap");
    expect(actionsContainer.className).not.toContain("shrink-0");
  });

  it("3. Arabic achievement titles wrap instead of truncating at 700px", async () => {
    setLocale("ar");
    ipcMock.getGameDepthState.mockResolvedValue({
      pets: [],
      active_pet_id: null,
      mounted: false,
      outfits: [],
      equipped_outfit_id: null,
      paths: [],
      active_path_id: null,
      achievements: [
        {
          achievement_key: "first_review",
          category: "study",
          unlocked: true,
          earned_at: Date.UTC(2026, 9, 14),
          current_value: 1,
          target_value: 1,
        },
      ],
    });

    renderWithQuery(<AchievementsPanel skinId="game" />);

    const title = await screen.findByRole("heading", { level: 4 });
    expect(title.className).not.toContain("truncate");
  });

  it("7. Scholar week-strip excused tooltip keys do not say 'skipped' in EN or AR", () => {
    expect(en["habits.strip.excused.scholar_one"].toLowerCase()).not.toContain("skipped");
    expect(en["habits.strip.excused.scholar_other"].toLowerCase()).not.toContain("skipped");
    expect(ar["habits.strip.excused.scholar_one"]).not.toContain("متخط");
    expect(ar["habits.strip.excused.scholar_other"]).not.toContain("متخط");
  });

  it("8. Quests screen daily heading in Arabic uses التحديات اليومية instead of المهام اليومية", () => {
    setLocale("ar");
    renderWithQuery(
      <QuestsView
        style="game"
        isLoading={false}
        isError={false}
        state={{
          today_date: "2026-11-24",
          today_day_index: 100,
          daily_goal_xp: 20,
          today_xp: 10,
          goal_met_today: false,
          current_streak: 3,
          best_streak: 5,
          studied_today: true,
          next_milestone: 7,
          daily_quests: [],
          weekly_quest: {
            id: "w1",
            kind: "weekly",
            metric: "reviews",
            target: 50,
            progress: 10,
            completed: false,
            reward_gold_cents: 100,
          },
          days_remaining_in_week: 3,
          monthly_badge: {
            month_key: "2026-11",
            completed_daily_quests: 1,
            target_daily_quests: 20,
            earned: false,
            earned_at: null,
            seen: true,
            reward_gold_cents: 500,
          },
          earned_monthly_badges: [],
          comeback_offer: null,
          onboarding_completed: true,
          auto_frozen_day: null,
        }}
      />,
    );

    expect(screen.getByText("التحديات اليومية")).toBeInTheDocument();
    expect(screen.queryByText("المهام اليومية")).not.toBeInTheDocument();
  });

  it("9. StreakScreen renders 'Streak' only once (in ScreenHeader, not duplicated in body)", () => {
    ipcMock.getMotivationState.mockResolvedValue({
      today_date: "2026-11-24",
      today_day_index: 100,
      daily_goal_xp: 20,
      today_xp: 10,
      goal_met_today: false,
      current_streak: 3,
      best_streak: 5,
      studied_today: true,
      next_milestone: 7,
      daily_quests: [],
      weekly_quest: {
        id: "w1",
        kind: "weekly",
        metric: "reviews",
        target: 50,
        progress: 10,
        completed: false,
        reward_gold_cents: 100,
      },
      days_remaining_in_week: 3,
      monthly_badge: {
        month_key: "2026-11",
        completed_daily_quests: 1,
        target_daily_quests: 20,
        earned: false,
        earned_at: null,
        seen: true,
        reward_gold_cents: 500,
      },
      earned_monthly_badges: [],
      comeback_offer: null,
      onboarding_completed: true,
      auto_frozen_day: null,
    });
    ipcMock.getStreakCalendar.mockResolvedValue({
      year: 2026,
      month: 11,
      today_day_index: 100,
      current_streak: 3,
      best_streak: 5,
      next_milestone: 7,
      studied_today: true,
      freeze_tokens_held: 1,
      freeze_token_cap: 3,
      can_freeze_yesterday: false,
      days: [],
    });

    renderWithQuery(<StreakScreen />);
    expect(screen.getAllByText("Streak")).toHaveLength(1);
  });

  it("10. decks.layout.hero unused locale key is removed from en and ar", () => {
    expect("decks.layout.hero" in en).toBe(false);
    expect("decks.layout.hero" in ar).toBe(false);
  });

  it("11. §B3: AchievementsPanel, QuestsView, StreakScreen, and ScreenHeader expose accessible loading/error/empty states and ARIA roles", async () => {
    // AchievementsPanel loading
    ipcMock.getGameDepthState.mockReturnValue(new Promise(() => {}));
    const { unmount: unmountAchLoading } = renderWithQuery(<AchievementsPanel skinId="game" />);
    expect(screen.getByLabelText(en["game.depth.loading"])).toBeInTheDocument();
    unmountAchLoading();

    // AchievementsPanel error + retry button
    ipcMock.getGameDepthState.mockRejectedValue(new Error("fail"));
    const { unmount: unmountAchErr } = renderWithQuery(<AchievementsPanel skinId="game" />);
    expect(await screen.findByText(en["game.depth.error.load"])).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en["game.depth.error.retry"] })).toBeInTheDocument();
    unmountAchErr();

    // AchievementsPanel empty
    ipcMock.getGameDepthState.mockResolvedValue({
      pets: [],
      active_pet_id: null,
      mounted: false,
      outfits: [],
      equipped_outfit_id: null,
      paths: [],
      active_path_id: null,
      achievements: [],
    });
    const { unmount: unmountAchEmpty } = renderWithQuery(<AchievementsPanel skinId="scholar" />);
    expect(await screen.findByText(en["scholar.achievements.empty"])).toBeInTheDocument();
    unmountAchEmpty();

    // QuestsView loading / error / empty
    const { rerender, unmount: unmountQuests } = renderWithQuery(
      <QuestsView style="default" isLoading={true} isError={false} state={undefined} />,
    );
    expect(screen.getByTestId("quests-loading")).toHaveAttribute(
      "aria-label",
      en["motivation.quests.loading"],
    );

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <QuestsView
          style="default"
          isLoading={false}
          isError={true}
          state={undefined}
          onRetry={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("quests-error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en["motivation.quests.retry"] })).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <QuestsView style="default" isLoading={false} isError={false} state={undefined} />
      </QueryClientProvider>,
    );
    expect(screen.getByText(en["motivation.quests.empty"])).toBeInTheDocument();
    unmountQuests();

    // ScreenHeader breadcrumb keyboard-focusable back button
    const onBack = vi.fn();
    render(<ScreenHeader title="Detail" breadcrumb={{ label: "Back", onBack }} />);
    const nav = screen.getByRole("navigation", { name: en["ai.breadcrumb.ariaLabel"] });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" }).className).toContain(
      "focus-visible:ring-2",
    );
  });
});
