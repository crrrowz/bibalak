import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameStateDto, ProgressSummaryDto } from "@bibalak/ipc-types";
import { StyleHud } from "./StyleHud";
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

const SAMPLE_GAME_STATE: GameStateDto = {
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
};

const SAMPLE_PROGRESS: ProgressSummaryDto = {
  level: 5,
  xp_into_level: 80,
  xp_to_next_level: 300,
  total_xp: 780,
  gold_cents: 4750,
  today_xp: 45,
  today_gold_cents: 375,
  tasks_rewarded_today: 2,
  task_reward_daily_cap: 10,
};

function renderHud(inFocus = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StyleHud inFocus={inFocus} />
    </QueryClientProvider>,
  );
}

describe("StyleHud (14d)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  afterEach(() => {
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it("renders nothing in Default style and when in focus mode", () => {
    const { container, rerender } = renderHud(false);
    expect(container.firstChild).toBeNull();

    useStyle.getState().setStyle("game");
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <StyleHud inFocus={true} />
      </QueryClientProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders Game HUD with 32px avatar, rank & level, XP bar, gold, streak, and freeze links", async () => {
    useStyle.getState().setStyle("game");
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue(SAMPLE_GAME_STATE);

    renderHud(false);

    expect(await screen.findByText("Novice · Level 4")).toBeInTheDocument();
    expect(screen.getByText("Novice · Level 4").className).toContain("game-hud-level");
    const stage = screen.getByTestId("avatar-stage");
    expect(stage.style.width).toBe("32px");

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "120");
    expect(bar).toHaveAttribute("aria-valuemax", "250");
    expect(screen.getByText("120 / 250 XP")).toBeInTheDocument();
    expect(screen.getByText("47.5 gold")).toBeInTheDocument();
    expect(screen.getByText("6d streak")).toBeInTheDocument();
    expect(screen.getByText("2 / 3 freezes")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Novice · Level 4/i })).toHaveAttribute(
      "href",
      "/character",
    );
    expect(screen.getByRole("link", { name: /47\.5 gold/i })).toHaveAttribute("href", "/shop");
    expect(screen.getByRole("link", { name: /2 \/ 3 freezes/i })).toHaveAttribute(
      "href",
      "/plan/habits",
    );
  });

  it("renders Scholar HUD with academic title, 32px avatar, knowledge points, /character link, and no freezes", async () => {
    useStyle.getState().setStyle("scholar");
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(SAMPLE_PROGRESS);
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue({
      ...SAMPLE_GAME_STATE,
      level: 5,
      xp_into_level: 80,
      xp_to_next_level: 300,
    });

    renderHud(false);

    expect(await screen.findByText("Researcher · Level 5")).toBeInTheDocument();
    const stage = screen.getByTestId("avatar-stage");
    expect(stage.style.width).toBe("32px");
    expect(screen.getByText("47.5 knowledge points")).toBeInTheDocument();
    expect(screen.getByText("6d study streak")).toBeInTheDocument();
    expect(screen.queryByText(/freeze/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Researcher · Level 5/i })).toHaveAttribute(
      "href",
      "/character",
    );
  });

  it("H4: renders Arabic HUD rank/level with spaces around '·' in Game and Scholar", async () => {
    setLocale("ar");
    useStyle.getState().setStyle("game");
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue(SAMPLE_GAME_STATE);

    const { unmount } = renderHud(false);
    const gameRank = await screen.findByText(/مبتدئ · المستوى/);
    expect(gameRank.textContent).toContain(" · ");
    unmount();

    useStyle.getState().setStyle("scholar");
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(SAMPLE_PROGRESS);
    renderHud(false);
    const scholarRank = await screen.findByText(/باحث · المستوى/);
    expect(scholarRank.textContent).toContain(" · ");
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it("BW2-21: labels the top-bar daily goal pill as Today: X / Y XP with a daily-goal tooltip", async () => {
    useStyle.getState().setStyle("game");
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue(SAMPLE_GAME_STATE);
    vi.spyOn(ipcModule.ipc, "getMotivationState").mockResolvedValue({
      daily_goal_xp: 10,
      today_xp: 44,
      goal_met_today: true,
      current_streak: 6,
      best_streak: 6,
      studied_today: true,
      next_milestone: 7,
      today_day_index: 10,
      today_date: "2026-11-26",
      days_remaining_in_week: 4,
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
      onboarding_completed: true,
      auto_frozen_day: null,
    });

    renderHud(false);

    expect(await screen.findByText("Today: 44 / 10 XP")).toBeInTheDocument();
    const goalLink = screen.getByRole("link", { name: /Today: 44 \/ 10 XP/i });
    expect(goalLink).toHaveAttribute("title", expect.stringMatching(/Daily goal/i));
  });

  it("LOGIC1: does not force dir=ltr on Arabic xpIntoNext text containing من", async () => {
    setLocale("ar");
    useStyle.getState().setStyle("scholar");
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(SAMPLE_PROGRESS);

    renderHud(false);

    const xpText = await screen.findByText(/80 من 300 XP/);
    expect(xpText).not.toHaveAttribute("dir", "ltr");
  });

  it("A1-32: keeps Game XP bar and status chips on a single non-wrapping row at desktop widths", async () => {
    setLocale("ar");
    useStyle.getState().setStyle("game");
    vi.spyOn(ipcModule.ipc, "getGameState").mockResolvedValue(SAMPLE_GAME_STATE);

    renderHud(false);

    const progressBar = await screen.findByRole("progressbar");
    const xpWrapper = progressBar.parentElement as HTMLElement;
    const hudRow = xpWrapper.parentElement as HTMLElement;
    expect(hudRow.className).toContain("lg:flex-nowrap");
    expect(xpWrapper.className).toContain("min-w-[110px]");
  });
});
