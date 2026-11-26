import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { useUi } from "@/stores/ui";
import * as ipc from "@/lib/ipc";
import { CommandPalette } from "./CommandPalette";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = () => {};
});

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

describe("CommandPalette completeness (U4)", () => {
  it("exposes Add note, Note types, Study next due deck, and Quick add commands", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    navigateMock.mockReset();

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 2,
        name: "Medicine::Cardiology",
        parent_id: 1,
        new_count: 5,
        learning_count: 0,
        review_count: 10,
        is_filtered: false,
        collapsed: false,
      },
    ]);
    const toggleQuickAddSpy = vi.spyOn(ipc.ipc, "toggleQuickAdd").mockResolvedValue(true);

    render(
      <QueryClientProvider client={qc}>
        <CommandPalette />
      </QueryClientProvider>,
    );

    act(() => {
      useUi.getState().openPalette();
    });

    expect(await screen.findByText("Add note")).toBeInTheDocument();
    expect(screen.getByText("Manage note types")).toBeInTheDocument();
    expect(screen.getByText("Study next due deck")).toBeInTheDocument();

    const quickAddItem = screen.getByText("Open quick add");
    await user.click(quickAddItem);
    expect(toggleQuickAddSpy).toHaveBeenCalledTimes(1);
  });

  it("opens ExportDialog from Export collection command", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "getExportEstimate").mockResolvedValue({
      notes: 1,
      cards: 2,
      media_files: 0,
      media_bytes: 0,
    });

    render(
      <QueryClientProvider client={qc}>
        <CommandPalette />
      </QueryClientProvider>,
    );

    act(() => {
      useUi.getState().openPalette();
    });

    await user.click(await screen.findByText("Export collection as .apkg"));
    expect(await screen.findByRole("heading", { name: "Export collection" })).toBeInTheDocument();
  });
});
