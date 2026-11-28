import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowseScreen } from "./BrowseScreen";
import { ipc } from "@/lib/ipc";
import { setLocale } from "@/lib/i18n";

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({ q: "" }),
  useNavigate: () => vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  isTauri: () => true,
  errorMessage: (e: unknown) => String(e),
  ipc: {
    aiGetConfig: vi.fn(),
    listTags: vi.fn(),
    listDecks: vi.fn(),
    listNotetypes: vi.fn(),
    getNotetype: vi.fn(),
    getStats: vi.fn(),
    searchCards: vi.fn(),
    searchNoteRows: vi.fn(),
    countCards: vi.fn(),
    countNoteRows: vi.fn(),
    getNote: vi.fn(),
  },
}));

describe("BrowseScreen today rollover (A1-11)", () => {
  it("uses backend stats.today instead of Math.floor((now - day0_ms) / 86400000)", async () => {
    setLocale("en");
    const now = Date.now();
    vi.mocked(ipc.aiGetConfig).mockResolvedValue(null as never);
    vi.mocked(ipc.listTags).mockResolvedValue([]);
    vi.mocked(ipc.listDecks).mockResolvedValue([
      {
        id: 1,
        name: "Default",
        parent_id: null,
        is_filtered: false,
        collapsed: false,
        new_count: 0,
        learning_count: 0,
        review_count: 1,
      },
    ]);
    vi.mocked(ipc.listNotetypes).mockResolvedValue([
      { id: 1, name: "Basic", kind: 0n, field_names: ["Front", "Back"], note_count: 1 },
    ]);
    vi.mocked(ipc.getStats).mockResolvedValue({
      today: 1,
      day0_ms: now - 3 * 3_600_000,
    } as never);
    vi.mocked(ipc.countCards).mockResolvedValue(1);
    vi.mocked(ipc.searchCards).mockResolvedValue([
      {
        card_id: 501,
        note_id: 601,
        sort_field: "Rollover card",
        deck: "Default",
        notetype: "Basic",
        tags: [],
        queue: 2,
        card_type: 2,
        due: 1,
        interval: 5,
        lapses: 0,
        reps: 2,
        flags: 0,
      },
    ]);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <BrowseScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Rollover card")).toBeInTheDocument();
    expect(await screen.findByText("today")).toBeInTheDocument();
  });
});
