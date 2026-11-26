import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressSummaryDto } from "@bibalak/ipc-types";
import { CertificateWatcher } from "./CertificateDialog";
import * as ipcModule from "@/lib/ipc";
import { setLocale } from "@/lib/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { SCHOLAR_NAME_KEY, SCHOLAR_TITLE_SEEN_KEY } from "@/lib/styles/scholar";
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
    level: 9,
    xp_into_level: 100,
    xp_to_next_level: 500,
    total_xp: 2300,
    gold_cents: 2500,
    today_xp: 30,
    today_gold_cents: 250,
    tasks_rewarded_today: 0,
    task_reward_daily_cap: 10,
    ...overrides,
  };
}

function renderWatcher(queryClient?: QueryClient) {
  const client =
    queryClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  const utils = render(
    <QueryClientProvider client={client}>
      <CertificateWatcher />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient: client };
}

describe("CertificateDialog & CertificateWatcher (P2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    setLocale("en");
    useStyle.getState().setStyle("scholar");
  });

  afterEach(() => {
    localStorage.clear();
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it("sets missing high-water mark silently on first run without opening", async () => {
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(
      makeProgress({ level: 12, total_xp: 4000 }),
    );
    renderWatcher();

    await vi.waitFor(() => {
      expect(localStorage.getItem(SCHOLAR_TITLE_SEEN_KEY)).toBe("2");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens once in Scholar when crossing 9 -> 10 (Lecturer), closes on Close/Escape, and does not reopen on refresh", async () => {
    localStorage.setItem(SCHOLAR_TITLE_SEEN_KEY, "1");
    localStorage.setItem(SCHOLAR_NAME_KEY, "Dr. Ada");

    const spy = vi
      .spyOn(ipcModule.ipc, "progressSummary")
      .mockResolvedValueOnce(makeProgress({ level: 9, total_xp: 2300 }))
      .mockResolvedValueOnce(makeProgress({ level: 10, total_xp: 2700 }));

    const { queryClient, unmount } = renderWatcher();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.progressSummary });
    });
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Lecturer");
    expect(dialog).toHaveTextContent("Dr. Ada");
    expect(dialog).toHaveTextContent("Level 10");
    expect(dialog).toHaveTextContent("2,700");
    expect(localStorage.getItem(SCHOLAR_TITLE_SEEN_KEY)).toBe("2");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    unmount();

    // Refresh / remount at level 10 must not reopen
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(
      makeProgress({ level: 10, total_xp: 2700 }),
    );
    renderWatcher();
    await vi.waitFor(() => expect(ipcModule.ipc.progressSummary).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape and uses fallback name when name is empty", async () => {
    localStorage.setItem(SCHOLAR_TITLE_SEEN_KEY, "1");
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(
      makeProgress({ level: 10, total_xp: 2700 }),
    );
    renderWatcher();

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Bibalak learner");

    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("updates high-water mark silently in Default style and never lowers on undo", async () => {
    useStyle.getState().setStyle("default");
    localStorage.setItem(SCHOLAR_TITLE_SEEN_KEY, "1");

    const spy = vi
      .spyOn(ipcModule.ipc, "progressSummary")
      .mockResolvedValueOnce(makeProgress({ level: 10, total_xp: 2700 }))
      .mockResolvedValueOnce(makeProgress({ level: 9, total_xp: 2697 }));

    const { queryClient } = renderWatcher();
    await vi.waitFor(() => expect(localStorage.getItem(SCHOLAR_TITLE_SEEN_KEY)).toBe("2"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Undo back to level 9 must not lower high-water mark
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.progressSummary });
    });
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(localStorage.getItem(SCHOLAR_TITLE_SEEN_KEY)).toBe("2");
  });
});
