import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckConfig, WorkloadComparisonDto } from "@bibalak/ipc-types";
import * as ipc from "@/lib/ipc";
import { setLocale } from "@/lib/i18n";
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
  beforeEach(() => {
    localStorage.clear();
    setLocale("en");
    vi.restoreAllMocks();
  });

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

    await user.click(await screen.findByRole("button", { name: /Advanced/i }));

    await waitFor(() => {
      expect(simSpy).toHaveBeenCalledWith(1, 0.9, 20, 30, sampleConfig.fsrs_weights);
    });
    expect(screen.getByText(/Workload projection/i)).toBeInTheDocument();

    const retInput = screen.getByLabelText(/How much do you want to remember/i);
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

  it("exposes dialog and sections cleanly to screen readers (no aria-hidden ancestor, no tab roles)", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "getDeckConfig").mockResolvedValue(sampleConfig);
    vi.spyOn(ipc.ipc, "simulateWorkload").mockResolvedValue(makeComparison(30, 1));

    render(
      <QueryClientProvider client={qc}>
        <DeckOptionsDialog deckId={1} deckName="Anatomy" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.closest('[aria-hidden="true"]')).toBeNull();
    expect(await screen.findByLabelText(/New cards a day/i)).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Advanced/i }));
    expect(screen.getByRole("button", { name: /SM-2/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /FSRS-6.*Recommended/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("validates 21 weights in Edit mode and resets weights + sections to defaults (B2)", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "getDeckConfig").mockResolvedValue({
      ...sampleConfig,
      learning_steps_min: [5, 20],
    });
    vi.spyOn(ipc.ipc, "simulateWorkload").mockResolvedValue(makeComparison(30, 1));
    const setSpy = vi.spyOn(ipc.ipc, "setDeckConfig").mockResolvedValue();

    render(
      <QueryClientProvider client={qc}>
        <DeckOptionsDialog deckId={1} deckName="Anatomy" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /Advanced/i }));
    expect(screen.getByText(/Seen again after 5 minutes, then 20 minutes/i)).toBeInTheDocument();

    // Expand FSRS parameters -> Edit -> invalid count shows validation error
    await user.click(screen.getByRole("button", { name: /FSRS-6 parameters/i }));
    await user.click(screen.getByRole("button", { name: /^Edit$/i }));
    const box = screen.getByLabelText(/FSRS-6 weights/i);
    await user.clear(box);
    await user.type(box, "1, 2, 3");
    await user.click(screen.getByRole("button", { name: /^Apply$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/21 valid numbers/i);

    await user.click(screen.getAllByRole("button", { name: /^Cancel$/i })[0]);
    await user.click(screen.getByRole("button", { name: /^Reset$/i }));
    await user.click(screen.getByRole("button", { name: /^Save$/i }));
    expect(setSpy).toHaveBeenCalled();
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
    expect(
      await screen.findByText(/These options are also used by:.*Physiology/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/History/)).not.toBeInTheDocument();
  });
});

describe("DeckOptionsDialog UX2 Simple/Advanced & FSRS-6 (B1-B7)", () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale("en");
    vi.restoreAllMocks();
  });

  it("B1/B6: Simple view shows only the three items, removes tab roles, and hides retention under SM-2", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "getDeckConfig").mockResolvedValue(sampleConfig);
    vi.spyOn(ipc.ipc, "simulateWorkload").mockResolvedValue(makeComparison(30, 1));

    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <DeckOptionsDialog deckId={1} deckName="Anatomy" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByLabelText(/New cards a day/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Most reviews a day/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/How much do you want to remember/i)).toBeInTheDocument();
    expect(await screen.findByText(/about 8 minutes a day/i)).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByText(/Learning new cards/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/When you forget a card/i)).not.toBeInTheDocument();

    // Under SM-2, retention item is hidden in Simple view.
    vi.spyOn(ipc.ipc, "getDeckConfig").mockResolvedValue({ ...sampleConfig, algorithm: "sm2" });
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DeckOptionsDialog deckId={2} deckName="History" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText(/New cards a day/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/How much do you want to remember/i)).not.toBeInTheDocument();
  });

  it("B1/B2/B3/B7: Advanced shows meaning sections, FSRS-6 constant, live effects, and hides SM-2/FSRS fields by algorithm", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "getDeckConfig").mockResolvedValue(sampleConfig);
    vi.spyOn(ipc.ipc, "simulateWorkload").mockResolvedValue(makeComparison(30, 1));

    render(
      <QueryClientProvider client={qc}>
        <DeckOptionsDialog deckId={1} deckName="Anatomy" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /Advanced/i }));
    expect(localStorage.getItem("keepsake-deck-options-advanced")).toBe("true");

    expect(screen.getByRole("button", { name: /FSRS-6.*Recommended/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/Scheduling/i)).toBeInTheDocument();
    expect(screen.getByText(/Learning new cards/i)).toBeInTheDocument();
    expect(screen.getByText(/When you forget a card/i)).toBeInTheDocument();
    expect(screen.getByText(/Seen again after 1 minute, then 10 minutes/i)).toBeInTheDocument();

    // SM-2 fine-tuning and SM-2-only lapse controls hidden under FSRS.
    expect(screen.queryByText(/SM-2 fine-tuning/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Starting ease/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/New interval after a lapse/i)).not.toBeInTheDocument();

    // FSRS parameters collapsed by default; expand -> Edit -> Reset.
    expect(screen.queryByRole("textbox", { name: /FSRS-6 weights/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /FSRS-6 parameters/i }));
    await user.click(screen.getByRole("button", { name: /^Edit$/i }));
    expect(screen.getByLabelText(/FSRS-6 weights/i)).toBeInTheDocument();

    expect(screen.getByText(/Waits 1 day$/i)).toBeInTheDocument();

    // Switch to SM-2 -> SM-2 fine-tuning starts collapsed by default, expands on click.
    await user.click(screen.getByRole("button", { name: /SM-2/i }));
    const sm2Toggle = screen.getByRole("button", { name: /SM-2 fine-tuning/i });
    expect(sm2Toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(sm2Toggle);
    expect(screen.getByLabelText(/Starting ease/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/New interval after a lapse/i)).toBeInTheDocument();
    expect(screen.getByText(/At least 1 day after a lapse/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Interval modifier/i)).toBeValid();
    expect(screen.queryByText(/FSRS-6 parameters/i)).not.toBeInTheDocument();
  });

  it("B7: round-trips DeckConfig unchanged through getDeckConfig/setDeckConfig and renders Arabic labels", async () => {
    const user = userEvent.setup();
    const customConfig: DeckConfig = {
      ...sampleConfig,
      new_per_day: 15,
      review_per_day: 120,
      desired_retention: 0.87,
      learning_steps_min: [2, 15],
      lapse_interval_factor: 0.25,
      starting_ease_milli: 2350,
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "getDeckConfig").mockResolvedValue(customConfig);
    vi.spyOn(ipc.ipc, "simulateWorkload").mockResolvedValue(makeComparison(30, 1));
    const setSpy = vi.spyOn(ipc.ipc, "setDeckConfig").mockResolvedValue();

    render(
      <QueryClientProvider client={qc}>
        <DeckOptionsDialog deckId={1} deckName="Anatomy" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /^Save$/i }));
    expect(setSpy).toHaveBeenCalledWith(customConfig);

    setLocale("ar");
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DeckOptionsDialog deckId={1} deckName="تشريح" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText(/البطاقات الجديدة يوميًا/i)).toBeInTheDocument();
  });

  it("OPT-MIN: rounds daily minutes to whole minutes and handles <1 minute in EN and AR", async () => {
    vi.spyOn(ipc.ipc, "getDeckConfig").mockResolvedValue(sampleConfig);
    const simSpy = vi.spyOn(ipc.ipc, "simulateWorkload").mockResolvedValue({
      ...makeComparison(30, 1),
      avg_daily_minutes_proposed: 7.6,
    });

    const qc1 = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={qc1}>
        <DeckOptionsDialog deckId={1} deckName="Anatomy" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/About 8 minutes a day/i)).toBeInTheDocument();
    unmount();

    simSpy.mockResolvedValue({ ...makeComparison(30, 1), avg_daily_minutes_proposed: 1.2 });
    const qc2 = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r2 = render(
      <QueryClientProvider client={qc2}>
        <DeckOptionsDialog deckId={1} deckName="Anatomy" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/About 1 minute a day/i)).toBeInTheDocument();
    r2.unmount();

    simSpy.mockResolvedValue({ ...makeComparison(30, 1), avg_daily_minutes_proposed: 0.4 });
    const qc3 = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r3 = render(
      <QueryClientProvider client={qc3}>
        <DeckOptionsDialog deckId={1} deckName="Anatomy" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Less than a minute a day/i)).toBeInTheDocument();
    r3.unmount();

    setLocale("ar");
    const qc4 = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc4}>
        <DeckOptionsDialog deckId={1} deckName="تشريح" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/أقل من دقيقة يوميًا/i)).toBeInTheDocument();
  });
});

describe("DeckOptionsDialog F3 / A1-20 / A1-30 / A1-33", () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale("en");
    vi.restoreAllMocks();
  });

  it("F3 / A1-30: edits learning steps as chips with unit picker, max interval year presets, and Forgot/Remembered/Easy terminology", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "getDeckConfig").mockResolvedValue(sampleConfig);
    vi.spyOn(ipc.ipc, "simulateWorkload").mockResolvedValue(makeComparison(30, 1));
    const setSpy = vi.spyOn(ipc.ipc, "setDeckConfig").mockResolvedValue();

    render(
      <QueryClientProvider client={qc}>
        <DeckOptionsDialog deckId={1} deckName="Anatomy" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /Advanced/i }));

    // Step chips: default [1, 10] rendered cleanly with add/remove controls, no free-text "1m 10m".
    expect(screen.queryByDisplayValue("1m 10m")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add learning step/i }));
    const unitPickers = screen.getAllByLabelText(/Step \d+ unit/i);
    await user.selectOptions(unitPickers[2]!, "hours");
    expect(screen.getByText(/10 hours/i)).toBeInTheDocument();

    // Max interval year presets update stored days cleanly.
    await user.click(screen.getByRole("button", { name: /^5 years$/i }));

    // Aligned button terms: Remembered/Forgot, not Good/Again.
    const dialogText = screen.getByRole("dialog").textContent ?? "";
    expect(dialogText).toMatch(/Remembered/);
    expect(dialogText).toMatch(/Forgot/);
    expect(dialogText).not.toMatch(/tapping Good|tapping Again|with Good|pressing Again/i);

    await user.click(screen.getByRole("button", { name: /^Save$/i }));
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        maximum_interval_days: 1825,
        learning_steps_min: [1, 10, 600],
      }),
    );

    // Arabic steps & presets use localized units with zero "1m 10m" English tokens.
    setLocale("ar");
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DeckOptionsDialog deckId={2} deckName="تشريح" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );
    await screen.findByText("إضافة خطوة تعلّم");
    const arText = screen.getAllByRole("dialog")[1]!.textContent ?? "";
    expect(arText).not.toContain("1m 10m");
  });

  it("A1-20 / F3: shows inline validation error for decimals/out-of-range integers without silent revert and blocks Save", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "getDeckConfig").mockResolvedValue(sampleConfig);
    vi.spyOn(ipc.ipc, "simulateWorkload").mockResolvedValue(makeComparison(30, 1));
    const setSpy = vi.spyOn(ipc.ipc, "setDeckConfig").mockResolvedValue();

    render(
      <QueryClientProvider client={qc}>
        <DeckOptionsDialog deckId={1} deckName="Anatomy" onClose={vi.fn()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const newInput = await screen.findByLabelText(/New cards a day/i);
    await user.clear(newInput);
    await user.type(newInput, "1.5");

    expect(newInput).toHaveValue(1.5);
    expect(newInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Save$/i })).toBeDisabled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("A1-33: exports uniform XAxis tick marks for 30d (5..30) and 90d (15..90)", async () => {
    const mod = await import("@/components/stats/chartTheme");
    expect(mod.WORKLOAD_TICKS[30]).toEqual([4, 9, 14, 19, 24, 29]);
    expect(mod.WORKLOAD_TICKS[90]).toEqual([14, 29, 44, 59, 74, 89]);
  });
});
