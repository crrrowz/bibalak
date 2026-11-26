import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoachInput } from "@bibalak/ipc-types";
import { ipc } from "@/lib/ipc";
import { CoachConsentDialog } from "./CoachConsentDialog";

const SAMPLE_INPUT: CoachInput = {
  selected_deck: "Default",
  selected_deck_id: 1,
  reviews_30d: 300,
  retention_pct: 88,
  retention_goal_pct: 90,
  backlog_count: 15,
  forecast_7d: 120,
  forecast_30d: 400,
  studied_days: 25,
  avg_minutes_per_day: 15,
  leech_count: 3,
  peak_hours: [9, 14],
  top_decks: [{ deck_id: 1, name: "Default", due_today: 15, retention_pct: 88 }],
};

describe("CoachConsentDialog (Z1a)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the coach-specific consent notice instead of card-HTML plainTextNotice", async () => {
    vi.spyOn(ipc, "aiPreviewAction").mockResolvedValue({
      provider: "ollama",
      endpoint_origin: "http://localhost:11434",
      model: "llama3.1",
      system: "Coach system",
      prompt: "Metrics prompt",
    });

    render(
      <CoachConsentDialog
        open
        input={SAMPLE_INPUT}
        configured
        onSuccess={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(/Only counts and deck names are sent — no card text/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Card HTML is stripped to plain text/i)).not.toBeInTheDocument();
  });
});
