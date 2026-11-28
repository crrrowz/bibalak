import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckProgress, ProgressSummaryDto } from "@bibalak/ipc-types";
import { FsrsPanels } from "@/components/stats/FsrsPanels";

describe("A3-16: Web preview mock data consistency for Stats and Transcript", () => {
  beforeEach(() => {
    vi.resetModules();
    window.history.replaceState(null, "", "/preview.html?route=/transcript&style=scholar");
    localStorage.setItem("keepsake-style", "scholar");
  });

  it("preview avg_retrievability uses 0..100 scale matching Rust so FsrsPanels displays 91%", async () => {
    let capturedInvoke: ((cmd: string, args?: unknown) => Promise<unknown>) | null = null;
    vi.doMock("@tauri-apps/api/mocks", () => ({
      mockWindows: vi.fn(),
      mockIPC: (fn: (cmd: string, args?: unknown) => Promise<unknown>) => {
        capturedInvoke = fn;
      },
    }));

    const { installPreviewMocks } = await import("@/dev/previewMocks");
    installPreviewMocks();
    const stats = (await capturedInvoke!("get_stats", {})) as {
      fsrs: {
        card_count: number;
        stability_buckets: number[];
        difficulty_buckets: number[];
        avg_retrievability: number | null;
      };
    };

    render(<FsrsPanels fsrs={stats.fsrs} onDrill={vi.fn()} deckName={null} />);

    expect(screen.queryByText("1%")).toBeNull();
    expect(screen.getByText("91%")).toBeInTheDocument();
  });

  it("Scholar preview progress_summary total_xp is at least the sum of progress_by_deck XP", async () => {
    let capturedInvoke: ((cmd: string, args?: unknown) => Promise<unknown>) | null = null;
    vi.doMock("@tauri-apps/api/mocks", () => ({
      mockWindows: vi.fn(),
      mockIPC: (fn: (cmd: string, args?: unknown) => Promise<unknown>) => {
        capturedInvoke = fn;
      },
    }));

    const { installPreviewMocks } = await import("@/dev/previewMocks");
    installPreviewMocks();

    const summary = (await capturedInvoke!("progress_summary", {})) as ProgressSummaryDto;
    const byDeck = (await capturedInvoke!("progress_by_deck", {})) as DeckProgress[];
    const deckXpSum = byDeck.reduce((acc, d) => acc + d.xp, 0);

    expect(summary.total_xp).toBeGreaterThanOrEqual(deckXpSum);
  });
});
