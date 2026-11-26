import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MotivationStateDto } from "@bibalak/ipc-types";
import { resetMotivationPreviewMocks } from "@/dev/mocks/motivation";
import { installPreviewMocks } from "@/dev/previewMocks";
import { setLocale, useLocale } from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { ar } from "@/locales/ar";
import { en } from "@/locales/en";
import { useStyle } from "@/stores/style";
import { OnboardingGate } from "./OnboardingGate";
import { useOnboardingDraft } from "./onboardingDraft";

function makeMotivationState(overrides: Partial<MotivationStateDto> = {}): MotivationStateDto {
  return {
    daily_goal_xp: 20,
    today_xp: 0,
    goal_met_today: false,
    current_streak: 0,
    best_streak: 0,
    studied_today: false,
    next_milestone: 7,
    today_day_index: 365,
    today_date: "2026-11-24",
    days_remaining_in_week: 6,
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
    comeback_offer: null,
    onboarding_completed: false,
    auto_frozen_day: null,
    ...overrides,
  };
}

/** Mirrors App.tsx's `<RouterProvider key={locale} />` remount on locale switch. */
function LocaleKeyedGate() {
  const locale = useLocale((s) => s.locale);
  return <OnboardingGate key={locale} />;
}

function renderWithQueryClient(client?: QueryClient) {
  const queryClient =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <LocaleKeyedGate />
      </QueryClientProvider>,
    ),
  };
}

describe("Onboarding wizard (16f)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    setLocale("en");
    useStyle.getState().setStyle("default");
    useOnboardingDraft.getState().reset();
    resetMotivationPreviewMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
    setLocale("en");
    useStyle.getState().setStyle("default");
    useOnboardingDraft.getState().reset();
  });

  it("onboarding_hidden_when_already_completed", async () => {
    // Loading state renders nothing.
    let resolveLoad!: (dto: MotivationStateDto) => void;
    const getMock = vi.spyOn(ipc, "getMotivationState").mockImplementationOnce(
      () =>
        new Promise<MotivationStateDto>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const { queryClient } = renderWithQueryClient();
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Completed state renders nothing.
    resolveLoad(makeMotivationState({ onboarding_completed: true }));
    await waitFor(() => {
      const state = queryClient.getQueryState(queryKeys.motivationState);
      expect(state?.status).toBe("success");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Error state renders nothing.
    getMock.mockRejectedValueOnce(new Error("db offline"));
    await queryClient.invalidateQueries({ queryKey: queryKeys.motivationState });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("onboarding_switches_locale_style_and_goal_then_creates_starter_deck", async () => {
    const user = userEvent.setup();
    let completed = false;
    let goalXp = 20;

    vi.spyOn(ipc, "getMotivationState").mockImplementation(async () =>
      makeMotivationState({ onboarding_completed: completed, daily_goal_xp: goalXp }),
    );
    const setGoalSpy = vi.spyOn(ipc, "setDailyGoal").mockImplementation(async (g) => {
      goalXp = g;
      return makeMotivationState({ onboarding_completed: completed, daily_goal_xp: g });
    });
    const completeSpy = vi.spyOn(ipc, "completeOnboarding").mockImplementation(async () => {
      completed = true;
    });

    const { queryClient } = renderWithQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    // Step 1: Language switches the app at once.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(en["motivation.onboarding.langTitle"])).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /العربية/ }));
    expect(useLocale.getState().locale).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ar");
    expect(await screen.findByText(ar["motivation.onboarding.langTitle"])).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: ar["motivation.onboarding.next"] }));

    // Step 2: Style (Default, Scholar, Game with a small preview each).
    expect(await screen.findByText(ar["motivation.onboarding.styleTitle"])).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-style-preview-default")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-style-preview-scholar")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-style-preview-game")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: new RegExp(ar["settings.style.scholar"]) }));
    expect(useStyle.getState().style).toBe("scholar");
    expect(document.documentElement.getAttribute("data-style")).toBe("scholar");

    await user.click(screen.getByRole("button", { name: ar["motivation.onboarding.next"] }));

    // Step 3: Daily goal (10/20/30/50, default 20).
    expect(await screen.findByText(ar["motivation.onboarding.goalTitle"])).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /20 XP/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /10 XP/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /30 XP/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /50 XP/ })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /30 XP/ }));
    await user.click(screen.getByRole("button", { name: ar["motivation.onboarding.next"] }));

    // Step 4: Starter deck yes/no; then finish.
    expect(await screen.findByText(ar["motivation.onboarding.deckTitle"])).toBeInTheDocument();
    await user.click(
      screen.getByRole("radio", { name: new RegExp(ar["motivation.onboarding.createStarter"]) }),
    );

    const finishBtn = screen.getByRole("button", { name: ar["motivation.onboarding.finish"] });
    await user.click(finishBtn);

    await waitFor(() => expect(setGoalSpy).toHaveBeenCalledWith(30));
    expect(completeSpy).toHaveBeenCalledWith(false, true, "ar");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.motivationState });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.decks });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("onboarding_skip_marks_completed_and_never_reappears", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?onboarding=1");
    installPreviewMocks();
    resetMotivationPreviewMocks();

    const completeSpy = vi.spyOn(ipc, "completeOnboarding");
    const setGoalSpy = vi.spyOn(ipc, "setDailyGoal");

    const { rerender, queryClient } = renderWithQueryClient();

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();

    const skipBtn = screen.getByRole("button", { name: en["motivation.onboarding.skip"] });
    await waitFor(() => expect(skipBtn).toBeVisible());

    await user.click(skipBtn);

    await waitFor(() => expect(completeSpy).toHaveBeenCalledWith(true, false, "en"));
    expect(setGoalSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Invalidating or remounting never shows the wizard again.
    await queryClient.invalidateQueries({ queryKey: queryKeys.motivationState });
    rerender(
      <QueryClientProvider client={queryClient}>
        <LocaleKeyedGate />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    window.history.replaceState(null, "", "/");
  });

  it("onboarding_keyboard_navigation_and_rtl_layout", async () => {
    const user = userEvent.setup();
    let completed = false;
    vi.spyOn(ipc, "getMotivationState").mockImplementation(async () =>
      makeMotivationState({ onboarding_completed: completed }),
    );
    const completeSpy = vi.spyOn(ipc, "completeOnboarding").mockImplementation(async () => {
      completed = true;
    });
    const setGoalSpy = vi
      .spyOn(ipc, "setDailyGoal")
      .mockImplementation(async (g) =>
        makeMotivationState({ onboarding_completed: completed, daily_goal_xp: g }),
      );

    renderWithQueryClient();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby");

    // Focus trap keeps Tab inside the dialog.
    const skipBtn = screen.getByRole("button", { name: en["motivation.onboarding.skip"] });
    const nextBtn = screen.getByRole("button", { name: en["motivation.onboarding.next"] });
    nextBtn.focus();
    await user.tab();
    expect(skipBtn).toHaveFocus();
    await user.tab({ shift: true });
    expect(nextBtn).toHaveFocus();

    // Switch to Arabic via keyboard in Step 1 radiogroup (ArrowRight in LTR moves to العربية).
    const enRadio = screen.getByRole("radio", { name: /English/ });
    enRadio.focus();
    await user.keyboard("{ArrowRight}");
    expect(useLocale.getState().locale).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");

    // In RTL, ArrowRight moves back to English, ArrowLeft moves forward to العربية.
    const arRadioAfterSwitch = await screen.findByRole("radio", { name: /العربية/ });
    expect(arRadioAfterSwitch).toHaveAttribute("aria-checked", "true");
    expect(arRadioAfterSwitch).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(useLocale.getState().locale).toBe("en");

    const enRadioBack = await screen.findByRole("radio", { name: /English/ });
    expect(enRadioBack).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(useLocale.getState().locale).toBe("ar");

    // Continue through Step 2 -> Step 3 -> Step 4 using keyboard, choosing empty workspace (no starter deck).
    const arNextBtn = await screen.findByRole("button", { name: ar["motivation.onboarding.next"] });
    arNextBtn.focus();
    await user.keyboard("{Enter}");

    // Step 2: select Game via ArrowLeft in RTL (Default -> Scholar -> Game).
    const defaultRadio = await screen.findByRole("radio", {
      name: new RegExp(ar["settings.style.default"]),
    });
    defaultRadio.focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(useStyle.getState().style).toBe("game");
    await user.click(screen.getByRole("button", { name: ar["motivation.onboarding.next"] }));

    // Step 3: move from 20 XP -> 50 XP via ArrowLeft x2 in RTL.
    const goal20 = await screen.findByRole("radio", { name: /20 XP/ });
    goal20.focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("radio", { name: /50 XP/ })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: ar["motivation.onboarding.next"] }));

    // Step 4: toggle from starter deck (true) -> empty workspace (false) via ArrowLeft in RTL, then Esc skips?
    // Test finishing via Enter first, or test Esc skip separately.
    const starterYes = await screen.findByRole("radio", {
      name: new RegExp(ar["motivation.onboarding.createStarter"]),
    });
    starterYes.focus();
    await user.keyboard("{ArrowLeft}");
    expect(
      screen.getByRole("radio", { name: new RegExp(ar["motivation.onboarding.startEmpty"]) }),
    ).toHaveAttribute("aria-checked", "true");

    // Verify Escape skips from any step.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(completeSpy).toHaveBeenCalledWith(true, false, "ar"));
    expect(setGoalSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
