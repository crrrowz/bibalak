import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as ipcModule from "@/lib/ipc";
import { setLocale } from "@/lib/i18n";
import { ActivityScreen } from "./ActivityScreen";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
  },
}));

describe("ActivityScreen (F4)", () => {
  afterEach(() => {
    setLocale("en");
    vi.restoreAllMocks();
  });

  it("renders newest-first undo history paged 20 per page, enables Undo only on top item, and paginates", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const historySpy = vi
      .spyOn(
        ipcModule.ipc as {
          undoHistory?: (page?: number) => Promise<unknown>;
        },
        "undoHistory",
      )
      .mockImplementation(async (page = 0) => ({
        page,
        page_size: 20,
        total: 22,
        items:
          page === 0
            ? Array.from({ length: 20 }, (_, idx) => ({
                action:
                  idx === 0
                    ? { kind: "reset-deck-progress", name: "Biology", count: 5 }
                    : { kind: "create-deck", name: `Deck ${idx}` },
                created_at_ms: 1_700_000_100_000 - idx * 60_000,
                can_undo: idx === 0,
              }))
            : [
                {
                  action: { kind: "delete-deck", name: "Old Deck 1" },
                  created_at_ms: 1_700_000_000_000,
                  can_undo: false,
                },
                {
                  action: { kind: "answer-card" },
                  created_at_ms: 1_699_999_900_000,
                  can_undo: false,
                },
              ],
      }));
    const undoSpy = vi.spyOn(ipcModule.ipc, "undo").mockResolvedValue({
      kind: "reset-deck-progress",
      name: "Biology",
      count: 5,
    } as never);

    render(
      <QueryClientProvider client={queryClient}>
        <ActivityScreen />
      </QueryClientProvider>,
    );

    const list = await screen.findByTestId("activity-list");
    const rows = within(list).getAllByTestId("activity-row");
    expect(rows).toHaveLength(20);
    expect(rows[0]).toHaveTextContent(/Reset progress for "Biology"/i);
    expect(within(rows[0]).getByRole("button", { name: /^Undo$/i })).toBeEnabled();
    expect(within(rows[1]).queryByRole("button", { name: /^Undo$/i })).not.toBeInTheDocument();

    // Pagination Next -> fetches page 1 with remaining 2 items
    await user.click(screen.getByRole("button", { name: /Next/i }));
    await waitFor(() => expect(historySpy).toHaveBeenCalledWith(1));
    const page2Rows = await within(screen.getByTestId("activity-list")).findAllByTestId(
      "activity-row",
    );
    expect(page2Rows).toHaveLength(2);
    expect(page2Rows[0]).toHaveTextContent(/Delete deck "Old Deck 1"/i);

    // Go back to page 0 and click Undo on newest item
    await user.click(screen.getByRole("button", { name: /Previous/i }));
    const undoTopBtn = await screen.findByRole("button", { name: /^Undo$/i });
    await user.click(undoTopBtn);
    await waitFor(() => expect(undoSpy).toHaveBeenCalledTimes(1));
  });
});
