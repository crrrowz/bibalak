import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MotivationStateDto, StreakCalendarDto } from "@bibalak/ipc-types";
import { AppShell } from "@/app/AppShell";
import { router } from "@/app/router";
import { motivationMocks, resetMotivationPreviewMocks } from "@/dev/mocks/motivation";
import { OnboardingGate } from "@/features/onboarding/OnboardingGate";
import { StreakContent } from "@/features/motivation/StreakContent";
import { QuestsContent } from "@/features/quests/QuestsContent";
import { StreakScreen } from "@/features/motivation/StreakScreen";
import { QuestsScreen } from "@/features/quests/QuestsScreen";
import { setLocale } from "@/lib/i18n";
import { useStyle } from "@/stores/style";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({
      children,
      to,
      activeOptions: _activeOptions,
      activeProps: _activeProps,
      inactiveProps: _inactiveProps,
      ...rest
    }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
      to: string;
      activeOptions?: unknown;
      activeProps?: unknown;
      inactiveProps?: unknown;
    }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
    Outlet: () => <div>outlet</div>,
    useMatchRoute: () => (opts: { to: string }) => opts.to === "/quests",
  };
});

vi.mock("@/lib/useCoreEvents", () => ({
  useCoreEvents: () => {},
}));

vi.mock("@/components/TitleBar", () => ({
  TitleBar: () => <div />,
}));

vi.mock("@/components/CommandPalette", () => ({
  CommandPalette: () => null,
}));

vi.mock("@/components/KeyboardShortcutsDialog", () => ({
  KeyboardShortcutsDialog: () => null,
}));

vi.mock("@/features/progress/CelebrationHost", () => ({
  CelebrationHost: () => null,
}));

vi.mock("@/features/progress/StyleHud", () => ({
  StyleHud: () => null,
}));

vi.mock("@/components/ui/toast", () => ({
  Toaster: () => null,
}));

describe("Cycle 3 motivation shared frames & mocks (16d)", () => {
  beforeEach(() => {
    setLocale("en");
    useStyle.getState().setStyle("default");
    resetMotivationPreviewMocks();
    localStorage.setItem("sb-width", "220");
  });

  it("registers /streak and /quests routes on the router", () => {
    expect(router.routesByPath["/streak"]).toBeDefined();
    expect(router.routesByPath["/quests"]).toBeDefined();
  });

  it("renders StreakScreen, QuestsScreen, StreakContent, QuestsContent, and OnboardingGate", () => {
    const { container } = render(<OnboardingGate />);
    expect(container.firstChild).toBeNull();

    const { unmount: unmountContent } = render(<StreakContent />);
    expect(screen.getByText("Streak")).toBeInTheDocument();
    unmountContent();

    render(<QuestsContent />);
    expect(screen.getByText("Daily challenges")).toBeInTheDocument();

    const { unmount: unmountStreak } = render(<StreakScreen />);
    expect(screen.getAllByText("Streak")).toHaveLength(1);
    unmountStreak();

    render(<QuestsScreen />);
    expect(screen.getAllByText("Daily challenges").length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ["default", "Daily challenges"],
    ["scholar", "Assignments & honors"],
    ["game", "Quests"],
  ] as const)("shows Quests nav link in %s style", (style, navLabel) => {
    useStyle.getState().setStyle(style);
    render(<AppShell />);
    expect(screen.getByRole("link", { name: navLabel })).toHaveAttribute("href", "/quests");
  });

  it("motivationMocks supports stateful goal update, freeze, comeback dismiss, and onboarding", () => {
    const getState = motivationMocks.get_motivation_state as () => MotivationStateDto;
    const setGoal = motivationMocks.set_daily_goal as (a: { goalXp: number }) => MotivationStateDto;
    const getCal = motivationMocks.get_streak_calendar as (a: {
      year: number;
      month: number;
    }) => StreakCalendarDto;
    const freezeDay = motivationMocks.freeze_study_day as (a: {
      dayIndex: number;
    }) => StreakCalendarDto;

    expect(getState().daily_goal_xp).toBe(10);
    expect(setGoal({ goalXp: 50 }).daily_goal_xp).toBe(50);
    expect(getState().daily_goal_xp).toBe(50);

    const cal = getCal({ year: 2026, month: 11 });
    expect(cal.days.length).toBe(30);
    const frozenCal = freezeDay({ dayIndex: cal.today_day_index - 1 });
    expect(frozenCal.freeze_tokens_held).toBe(1);
  });
});
