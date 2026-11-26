import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { YesterdaySummaryDto } from "@bibalak/ipc-types";
import { YesterdaySummaryCard } from "./YesterdaySummaryCard";
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

const SAMPLE_SUMMARY: YesterdaySummaryDto = {
  day: 364,
  date: "2026-11-21",
  reviews: 32,
  tasks_completed: 3,
  habits_completed: 2,
  xp: 140,
  gold_cents: 1300,
};

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <YesterdaySummaryCard />
    </QueryClientProvider>,
  );
}

describe("YesterdaySummaryCard (R3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  afterEach(() => {
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it("renders nothing when yesterdaySummary returns null", async () => {
    vi.spyOn(ipcModule.ipc, "yesterdaySummary").mockResolvedValue(null);

    const { container } = renderCard();

    await waitFor(() => expect(ipcModule.ipc.yesterdaySummary).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("renders Default style with counts, XP, and gold, and dismisses via IPC", async () => {
    const user = userEvent.setup();
    let current: YesterdaySummaryDto | null = SAMPLE_SUMMARY;
    vi.spyOn(ipcModule.ipc, "yesterdaySummary").mockImplementation(async () => current);
    const dismissSpy = vi
      .spyOn(ipcModule.ipc, "dismissYesterdaySummary")
      .mockImplementation(async () => {
        current = null;
      });

    renderCard();

    expect(await screen.findByText(/Yesterday/i)).toBeInTheDocument();
    expect(screen.getByText(/32/)).toBeInTheDocument();
    expect(screen.getByText(/140 XP/)).toBeInTheDocument();
    expect(screen.getByText(/13 gold/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Dismiss/i }));

    await waitFor(() => expect(dismissSpy).toHaveBeenCalledWith(365));
    await waitFor(() => expect(screen.queryByText(/32/)).not.toBeInTheDocument());
  });

  it("renders Scholar knowledge points, Default gold, and Arabic labels without blame wording", async () => {
    vi.spyOn(ipcModule.ipc, "yesterdaySummary").mockResolvedValue(SAMPLE_SUMMARY);

    useStyle.getState().setStyle("scholar");
    const { rerender } = renderCard();

    expect(await screen.findByText(/13 knowledge points/i)).toBeInTheDocument();

    useStyle.getState().setStyle("default");
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <YesterdaySummaryCard />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/13 gold/i)).toBeInTheDocument();

    setLocale("ar");
    useStyle.getState().setStyle("scholar");
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <YesterdaySummaryCard />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/13 نقطة معرفة/)).toBeInTheDocument();
  });

  it("renders Game Yesterday's Loot heading with the same numbers", async () => {
    vi.spyOn(ipcModule.ipc, "yesterdaySummary").mockResolvedValue(SAMPLE_SUMMARY);
    useStyle.getState().setStyle("game");

    renderCard();

    expect(await screen.findByText(/Yesterday's Loot/i)).toBeInTheDocument();
    expect(screen.getByText(/32/)).toBeInTheDocument();
    expect(screen.getByText(/13 gold/i)).toBeInTheDocument();
  });

  it.each(["default", "scholar", "game"] as const)(
    "bw2_12_renders_loot_as_small_chips_and_clear_dismiss (%s)",
    async (style) => {
      vi.spyOn(ipcModule.ipc, "yesterdaySummary").mockResolvedValue(SAMPLE_SUMMARY);
      useStyle.getState().setStyle(style);

      renderCard();

      const card = await screen.findByTestId("yesterday-summary-card");
      const chips = card.querySelectorAll("[data-testid='yesterday-loot-chip']");
      expect(chips.length).toBeGreaterThanOrEqual(4);
      for (const chip of chips) {
        expect(chip.className).toContain("rounded-md");
        expect(chip.className).toContain("border");
      }

      const dismissBtn = await screen.findByRole("button", { name: /Dismiss/i });
      expect(dismissBtn.className).toContain("border");
    },
  );
});
