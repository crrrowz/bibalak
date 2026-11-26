import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressSummaryDto } from "@bibalak/ipc-types";
import { ProgressPanel } from "./ProgressPanel";
import * as ipcModule from "@/lib/ipc";
import { setLocale } from "@/lib/i18n";
import { useStyle } from "@/stores/style";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

function makeProgress(overrides?: Partial<ProgressSummaryDto>): ProgressSummaryDto {
  return {
    level: 4,
    xp_into_level: 120,
    xp_to_next_level: 250,
    total_xp: 570,
    gold_cents: 4750,
    today_xp: 45,
    today_gold_cents: 375,
    tasks_rewarded_today: 0,
    task_reward_daily_cap: 10,
    ...overrides,
  };
}

function renderPanel(variant?: "compact" | "section") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProgressPanel variant={variant} />
    </QueryClientProvider>,
  );
}

describe("ProgressPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  afterEach(() => {
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it("renders Default level, XP progress bar with ARIA attributes, gold, and omits duplicate today XP on Home", async () => {
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(makeProgress());

    renderPanel();

    expect(await screen.findByText("Level 4")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "120");
    expect(bar).toHaveAttribute("aria-valuemax", "250");
    expect(screen.getByText(/120 \/ 250/)).toBeInTheDocument();
    expect(screen.getByText(/570/)).toBeInTheDocument();
    expect(screen.getByText("47.5 gold")).toBeInTheDocument();
    expect(screen.queryByText(/Today: \+45 XP/)).not.toBeInTheDocument();
  });

  it("switches to Scholar title and knowledge points when style changes", async () => {
    useStyle.getState().setStyle("scholar");
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(
      makeProgress({ level: 5, xp_into_level: 80, xp_to_next_level: 300, gold_cents: 25 }),
    );

    renderPanel("section");

    expect(await screen.findByText("Researcher · Level 5")).toBeInTheDocument();
    expect(screen.getByText("0.25 knowledge points")).toBeInTheDocument();

    act(() => {
      useStyle.getState().setStyle("default");
    });
    expect(screen.getByText("Level 5")).toBeInTheDocument();
    expect(screen.getByText("0.25 gold")).toBeInTheDocument();
  });

  it("renders Arabic Scholar title and knowledge points", async () => {
    setLocale("ar");
    useStyle.getState().setStyle("scholar");
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(
      makeProgress({ level: 5, gold_cents: 300 }),
    );

    renderPanel("section");

    expect(await screen.findByText("باحث · المستوى 5")).toBeInTheDocument();
    expect(screen.getByText("3 نقاط معرفة")).toBeInTheDocument();
  });

  it("renders loading state and single-line error state without crashing", async () => {
    vi.spyOn(ipcModule.ipc, "progressSummary").mockReturnValue(new Promise(() => {}));
    const { unmount } = renderPanel();
    expect(screen.getByTestId("progress-panel-loading")).toBeInTheDocument();
    unmount();

    vi.spyOn(ipcModule.ipc, "progressSummary").mockRejectedValue(new Error("DB error"));
    renderPanel();
    expect(await screen.findByTestId("progress-panel-error")).toBeInTheDocument();
  });

  it("shows Transcript link only in Scholar style", async () => {
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(makeProgress());

    const { rerender } = renderPanel();
    await screen.findByText("Level 4");
    expect(screen.queryByRole("link", { name: /Transcript/i })).not.toBeInTheDocument();

    act(() => {
      useStyle.getState().setStyle("scholar");
    });
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ProgressPanel />
      </QueryClientProvider>,
    );
    const link = await screen.findByRole("link", { name: /Transcript/i });
    expect(link).toHaveAttribute("href", "/transcript");
  });

  it("renders Scholar avatar and Game compact / section variants (14d)", async () => {
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(makeProgress());

    useStyle.getState().setStyle("scholar");
    // Compact Scholar leaves title, avatar, XP bar to StyleHud and today XP to TodayCard.
    const { rerender } = renderPanel("compact");
    expect(await screen.findByText("3.75 knowledge points")).toBeInTheDocument();
    expect(screen.queryByText(/Today: \+45 XP/)).not.toBeInTheDocument();
    expect(screen.queryByText("Student · Level 4")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Transcript/i })).toBeInTheDocument();

    useStyle.getState().setStyle("game");
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ProgressPanel variant="compact" />
      </QueryClientProvider>,
    );
    expect(screen.queryByText("Today's Loot")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ProgressPanel variant="section" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Novice · Level 4")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-stage").style.width).toBe("64px");
  });
});
