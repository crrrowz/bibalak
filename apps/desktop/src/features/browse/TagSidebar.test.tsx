import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TagSidebar } from "./TagSidebar";
import { ipc } from "@/lib/ipc";
import { setLocale } from "@/lib/i18n";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    listTags: vi.fn(),
    listTagCounts: vi.fn(),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
  },
}));

function renderSidebar(onFilter = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onFilter,
    ...render(
      <QueryClientProvider client={qc}>
        <TagSidebar onFilter={onFilter} />
      </QueryClientProvider>,
    ),
  };
}

describe("TagSidebar BW2-10", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setLocale("en");
    (ipc as unknown as Record<string, unknown>).listTagCounts = vi.fn().mockResolvedValue([
      { name: "cardiology::ecg", count: 12 },
      { name: "cardiology::pharm", count: 5 },
      { name: "verbs", count: 8 },
    ]);
    vi.mocked(ipc.listTags).mockResolvedValue(["cardiology::ecg", "cardiology::pharm", "verbs"]);
  });

  it("renders resizable, collapsible tag sidebar with search box, counts, and :: tree", async () => {
    const user = userEvent.setup();
    renderSidebar();

    // Displays counts and collapses :: tree by default
    expect(await screen.findByText("verbs")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("cardiology")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.queryByText("ecg")).not.toBeInTheDocument();

    // Expand :: tree branch
    await user.click(screen.getByRole("button", { name: /Expand cardiology/i }));
    expect(screen.getByText("ecg")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();

    // Search box filters tree and keeps matching branch visible
    const search = screen.getByRole("searchbox", { name: /Filter tags/i });
    await user.type(search, "ecg");
    expect(screen.getByText("ecg")).toBeInTheDocument();
    expect(screen.queryByText("verbs")).not.toBeInTheDocument();
    await user.clear(search);
    expect(screen.getByText("verbs")).toBeInTheDocument();

    // Keyboard resize handle remembers width in localStorage
    const separator = screen.getByRole("separator", { name: /Resize tags panel/i });
    const aside = separator.closest("aside")!;
    const beforeWidth = parseInt(aside.style.width || "0", 10);
    separator.focus();
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    await waitFor(() => {
      expect(parseInt(aside.style.width, 10)).toBeGreaterThan(beforeWidth);
    });
    expect(localStorage.getItem("keepsake-tags-width")).toBe(
      String(parseInt(aside.style.width, 10)),
    );

    // Collapsible panel remembers collapsed state
    const collapseBtn = screen.getByRole("button", { name: /Collapse tags/i });
    await user.click(collapseBtn);
    expect(screen.queryByRole("searchbox", { name: /Filter tags/i })).not.toBeInTheDocument();
    expect(localStorage.getItem("keepsake-tags-collapsed")).toBe("1");
  });

  it("BW2-19: uses thin-scrollbar on tag list, renders single expand button when collapsed, and provides visible drag handle with RTL keyboard resize", async () => {
    const user = userEvent.setup();
    renderSidebar();

    await screen.findByText("verbs");

    // 1. Tag list container uses the shared thin-scrollbar utility class
    const listEl = screen.getByText("verbs").closest("ul")!;
    const scrollContainer = listEl.parentElement!;
    expect(scrollContainer.className).toContain("thin-scrollbar");

    // 2. Visible resize handle with hover/focus states and RTL-aware keyboard resize
    const separator = screen.getByRole("separator", { name: /Resize tags panel/i });
    expect(separator.className).toMatch(/hover:/);
    expect(separator.className).toMatch(/focus-visible:/);
    expect(separator.querySelector('[data-testid="tags-resize-grip"]')).not.toBeNull();

    const aside = separator.closest("aside")!;
    fireEvent.keyDown(separator, { key: "Home" });
    expect(aside.style.width).toBe("140px");
    fireEvent.keyDown(separator, { key: "End" });
    expect(aside.style.width).toBe("380px");

    // RTL: ArrowLeft widens, ArrowRight narrows
    document.documentElement.dir = "rtl";
    try {
      fireEvent.keyDown(separator, { key: "Home" });
      expect(aside.style.width).toBe("140px");
      fireEvent.keyDown(separator, { key: "ArrowLeft" });
      expect(parseInt(aside.style.width, 10)).toBe(156);
      fireEvent.keyDown(separator, { key: "ArrowRight" });
      expect(parseInt(aside.style.width, 10)).toBe(140);
    } finally {
      document.documentElement.dir = "ltr";
    }

    // 3. Collapsed state renders strictly ONE expand button (no duplicate buttons)
    await user.click(screen.getByRole("button", { name: /Collapse tags/i }));
    const expandButtons = screen.getAllByRole("button", { name: /Expand tags panel/i });
    expect(expandButtons).toHaveLength(1);
    expect(screen.getAllByRole("button")).toHaveLength(1);

    await user.click(expandButtons[0]);
    expect(screen.getByRole("searchbox", { name: /Filter tags/i })).toBeInTheDocument();
  });
});
