import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreEventName } from "@bibalak/ipc-types";
import * as ipc from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { useCoreEvents } from "@/lib/useCoreEvents";

let listener: ((payload: CoreEventName) => void) | null = null;

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: (_event: string, cb: (payload: CoreEventName) => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
  },
}));

function Harness() {
  useCoreEvents();
  return null;
}

describe("A3-14: useCoreEvents does not rescan gameDepthState on every card-answered", () => {
  beforeEach(() => {
    listener = null;
    vi.spyOn(ipc.ipc, "setLocalOffset").mockResolvedValue(undefined);
    vi.spyOn(ipc.ipc, "getCollectionPrefs").mockResolvedValue({ rollover_hour: 4 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invalidates gameDepthState on game-changed, not on plain card-answered", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invSpy = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    invSpy.mockClear();

    act(() => {
      listener?.("card-answered");
    });

    const invalidatedOnAnswer = invSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidatedOnAnswer).toContainEqual(queryKeys.gameState);
    expect(invalidatedOnAnswer).not.toContainEqual(queryKeys.gameDepthState);

    invSpy.mockClear();
    act(() => {
      listener?.("game-changed");
    });
    const invalidatedOnGame = invSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidatedOnGame).toContainEqual(queryKeys.gameDepthState);
  });
});
