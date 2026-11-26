import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import * as ipc from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { IncreaseLimitControl } from "./IncreaseLimitControl";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
  },
}));

describe("IncreaseLimitControl (STUDY1 / BW2-22)", () => {
  it("invalidates decks, motivationState, progressSummary, and statsAll when adding extra new cards", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const incSpy = vi.spyOn(ipc.ipc, "increaseTodayLimit").mockResolvedValue();
    const onDone = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <IncreaseLimitControl deckId={1} onDone={onDone} />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Add/i }));

    await waitFor(() => expect(incSpy).toHaveBeenCalledWith(1, 10));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.decks });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.motivationState });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.progressSummary });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.statsAll });
    expect(onDone).toHaveBeenCalled();
  });
});
