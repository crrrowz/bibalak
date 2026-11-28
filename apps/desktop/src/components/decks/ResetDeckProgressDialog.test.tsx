import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DeckSummary } from "@bibalak/ipc-types";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { ResetDeckProgressDialog } from "./ResetDeckProgressDialog";

const deck: DeckSummary = {
  id: 1,
  name: "Biology",
  parent_id: null,
  new_count: 1,
  learning_count: 1,
  review_count: 0,
  is_filtered: false,
  collapsed: false,
};

describe("ResetDeckProgressDialog", () => {
  it("disables reset confirm while deckCardIds is background-fetching and uses fresh IDs", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Seed stale cached card IDs and make it stale so opening dialog triggers background refetch.
    queryClient.setQueryData(queryKeys.deckCardIds(1, true), [1]);
    await queryClient.invalidateQueries({ queryKey: queryKeys.deckCardIds(1, true) });

    let resolveIds!: (ids: number[]) => void;
    vi.spyOn(ipc, "deckCardIds").mockImplementation(
      () =>
        new Promise<number[]>((res) => {
          resolveIds = res;
        }),
    );
    const resetSpy = vi
      .spyOn(
        ipc as {
          resetDeckProgress?: (deckId: number, includeSubdecks?: boolean) => Promise<number>;
        },
        "resetDeckProgress",
      )
      .mockResolvedValue(2);

    render(
      <QueryClientProvider client={queryClient}>
        <ResetDeckProgressDialog
          deck={deck}
          hasSubdecks={false}
          onClose={vi.fn()}
          onDone={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const confirmBtn = screen.getByRole("button", { name: /Reset progress/i });
    expect(confirmBtn).toBeDisabled();

    resolveIds([1, 2]);
    await waitFor(() => expect(confirmBtn).toBeEnabled());
    expect(screen.getByText(/Gold never drops below zero/i)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(confirmBtn);
    await waitFor(() => expect(resetSpy).toHaveBeenCalledWith(1, true));
  });
});
