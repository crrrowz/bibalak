import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DeckConfig, WorkloadComparisonDto } from "@bibalak/ipc-types";
import * as ipc from "@/lib/ipc";
import { DeckOptionsDialog } from "./DeckOptionsDialog";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
  },
}));

const sampleConfig: DeckConfig = {
  deck_id: 1,
  config_id: 1,
  algorithm: "fsrs",
  new_per_day: 20,
  review_per_day: 200,
  learning_steps_min: [1, 10],
  relearning_steps_min: [10],
  graduating_interval_days: 1,
  easy_interval_days: 4,
  starting_ease_milli: 2500,
  easy_bonus: 1.3,
  hard_interval_factor: 1.2,
  interval_modifier: 1.0,
  maximum_interval_days: 36500,
  lapse_interval_factor: 0.0,
  minimum_interval_days: 1,
  leech_threshold: 8,
  desired_retention: 0.9,
  fsrs_weights: Array.from({ length: 21 }, (_, i) => i * 0.1 + 0.2),
};

function makeComparison(horizon: number, factor = 1): WorkloadComparisonDto {
  const days = Array.from({ length: horizon }, (_, day) => ({
    day,
    current_reviews: 40,
    proposed_reviews: Math.round(40 * factor),
    current_minutes: 8,
    proposed_minutes: Math.round(8 * factor * 10) / 10,
  }));
  return {
    days,
    total_current_reviews: 40 * horizon,
    total_proposed_reviews: Math.round(40 * factor) * horizon,
    avg_daily_minutes_current: 8,
    avg_daily_minutes_proposed: Math.round(8 * factor * 10) / 10,
  };
}

describe("DeckOptionsDialog FSRS workload simulator (E9)", () => {
  it("simulates live comparison curve before saving when retention changes and toggles 30d/90d", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "getDeckConfig").mockResolvedValue(sampleConfig);
    const setSpy = vi.spyOn(ipc.ipc, "setDeckConfig").mockResolvedValue();
    const simSpy = vi
      .spyOn(ipc.ipc, "simulateWorkload")
      .mockImplementation(async (_id, retention, _newPerDay, horizon) =>
        makeComparison(horizon, retention > 0.9 ? 1.35 : 1),
      );

    render(
      <QueryClientProvider client={qc}>
        <DeckOptionsDialog deckId={1} deckName="Anatomy" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const fsrsTab = await screen.findByText("FSRS");
    await user.click(fsrsTab);

    await waitFor(() => {
      expect(simSpy).toHaveBeenCalledWith(1, 0.9, 20, 30, sampleConfig.fsrs_weights);
    });
    expect(screen.getByText(/Workload projection/i)).toBeInTheDocument();

    const retInput = screen.getByLabelText(/Desired retention/i);
    fireEvent.change(retInput, { target: { value: "0.95" } });

    await waitFor(() => {
      expect(simSpy).toHaveBeenCalledWith(1, 0.95, 20, 30, sampleConfig.fsrs_weights);
    });
    expect(setSpy).not.toHaveBeenCalled();

    const horizon90Btn = screen.getByText(/90d/i);
    await user.click(horizon90Btn);

    await waitFor(() => {
      expect(simSpy).toHaveBeenCalledWith(1, 0.95, 20, 90, sampleConfig.fsrs_weights);
    });
  });

  it("exposes dialog and tabs cleanly to screen readers (no aria-hidden ancestor)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "getDeckConfig").mockResolvedValue(sampleConfig);

    render(
      <QueryClientProvider client={qc}>
        <DeckOptionsDialog deckId={1} deckName="Anatomy" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.closest('[aria-hidden="true"]')).toBeNull();

    const tablist = await screen.findByRole("tablist");
    expect(tablist).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    expect(tabs[1]).toHaveAttribute("tabindex", "-1");
    expect(tabs[0]).toHaveAttribute("aria-controls");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tabs[0].id);

    // Algorithm toggle buttons expose aria-pressed
    expect(screen.getByRole("button", { name: "SM-2" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "FSRS-5" })).toHaveAttribute("aria-pressed", "true");
  });

  it("supports arrow-key, Home/End, and RTL tab navigation plus labeled weights textarea (B2)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "getDeckConfig").mockResolvedValue(sampleConfig);
    vi.spyOn(ipc.ipc, "simulateWorkload").mockResolvedValue(makeComparison(30, 1));

    render(
      <QueryClientProvider client={qc}>
        <DeckOptionsDialog deckId={1} deckName="Anatomy" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const tabs = await screen.findAllByRole("tab");
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveFocus();

    fireEvent.keyDown(tabs[1], { key: "End" });
    const fsrsTab = tabs[tabs.length - 1];
    expect(fsrsTab).toHaveAttribute("aria-selected", "true");
    expect(fsrsTab).toHaveFocus();
    expect(screen.getByLabelText(/FSRS-6 weights/i)).toBeInTheDocument();

    document.documentElement.dir = "rtl";
    try {
      fireEvent.keyDown(fsrsTab, { key: "ArrowRight" });
      const prevTab = tabs[tabs.length - 2];
      expect(prevTab).toHaveAttribute("aria-selected", "true");
      expect(prevTab).toHaveFocus();
    } finally {
      document.documentElement.dir = "ltr";
    }
  });

  it("STUDY1: shows today's extra new-card allowance next to New cards/day and lists decks sharing the preset", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "getTodayExtraNew").mockResolvedValue(10);
    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Anatomy",
        parent_id: null,
        new_count: 10,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
      {
        id: 2,
        name: "Physiology",
        parent_id: null,
        new_count: 5,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
      {
        id: 3,
        name: "History",
        parent_id: null,
        new_count: 5,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc.ipc, "getDeckConfig").mockImplementation(async (deckId) => ({
      ...sampleConfig,
      deck_id: deckId,
      config_id: deckId === 3 ? 2 : 1,
    }));

    render(
      <QueryClientProvider client={qc}>
        <DeckOptionsDialog deckId={1} deckName="Anatomy" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/\+10 today/i)).toBeInTheDocument();
    expect(await screen.findByText(/Shared with:.*Physiology/i)).toBeInTheDocument();
    expect(screen.queryByText(/History/)).not.toBeInTheDocument();
  });
});
