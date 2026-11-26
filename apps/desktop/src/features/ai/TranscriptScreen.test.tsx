import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DeckProgress,
  DeckSummary,
  ProgressDay,
  ProgressSummaryDto,
  StudyDay,
} from "@bibalak/ipc-types";
import { TranscriptScreen } from "./TranscriptScreen";
import { setLocale } from "@/lib/i18n";
import * as ipcModule from "@/lib/ipc";
import { SCHOLAR_NAME_KEY } from "@/lib/styles/scholar";
import { useStyle } from "@/stores/style";

const navigateMock = vi.fn();

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

function renderTranscript() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TranscriptScreen />
    </QueryClientProvider>,
  );
}

const SUMMARY: ProgressSummaryDto = {
  level: 10,
  xp_into_level: 100,
  xp_to_next_level: 550,
  total_xp: 2800,
  gold_cents: 4750,
  today_xp: 30,
  today_gold_cents: 250,
  tasks_rewarded_today: 0,
  task_reward_daily_cap: 10,
};

const HISTORY: ProgressDay[] = [
  { day: 1, date: "2026-11-10", xp: 700, gold_cents: 2500, cumulative_xp: 700, level_after: 5 },
  { day: 2, date: "2026-11-18", xp: 2100, gold_cents: 2250, cumulative_xp: 2800, level_after: 10 },
];

const BY_DECK: DeckProgress[] = [
  {
    deck_id: 2,
    name: "Classical Music Themes",
    total_cards: 120,
    mature_pct: 50,
    retention_pct: 92,
    xp: 1800,
    gold_cents: 3000,
    last_studied_date: "2026-11-18",
  },
];

const STUDY_DAYS: StudyDay[] = [
  {
    day: 2,
    date: "2026-11-18",
    reviews: 45,
    minutes: 18.5,
    deck_ids: [2],
    xp: 135,
    gold_cents: 1125,
    tasks_completed: 2,
    habits_completed: 1,
  },
];

const DECKS: DeckSummary[] = [
  {
    id: 2,
    name: "Classical Music Themes",
    parent_id: null,
    new_count: 10,
    learning_count: 2,
    review_count: 20,
    is_filtered: false,
    collapsed: false,
  },
];

describe("TranscriptScreen (P2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigateMock.mockReset();
    localStorage.clear();
    setLocale("en");
    useStyle.getState().setStyle("scholar");
  });

  afterEach(() => {
    localStorage.clear();
    setLocale("en");
    useStyle.getState().setStyle("default");
  });

  it("renders header, earned certificates from history, course row, lecture log row, and rule headings", async () => {
    localStorage.setItem(SCHOLAR_NAME_KEY, "Dr. Ada");
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue(SUMMARY);
    vi.spyOn(ipcModule.ipc, "progressHistory").mockResolvedValue(HISTORY);
    vi.spyOn(ipcModule.ipc, "progressByDeck").mockResolvedValue(BY_DECK);
    vi.spyOn(ipcModule.ipc, "studyDays").mockResolvedValue(STUDY_DAYS);
    vi.spyOn(ipcModule.ipc, "listDecks").mockResolvedValue(DECKS);

    renderTranscript();

    expect(await screen.findByText("Dr. Ada")).toBeInTheDocument();
    expect(screen.getByText("Lecturer · Level 10")).toBeInTheDocument();
    expect(screen.getByText(/2,800 XP total/)).toBeInTheDocument();
    expect(screen.getByText("47.5 knowledge points")).toBeInTheDocument();

    // Certificates derived from progress_history (Researcher + Lecturer)
    expect(screen.getByText("Researcher")).toBeInTheDocument();
    expect(screen.getByText("Lecturer")).toBeInTheDocument();

    // Courses table row + deleted-card note
    expect(screen.getAllByText("Classical Music Themes").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText(/deleted cards/i)).toBeInTheDocument();

    // Lecture log row (cards, tasks, habits, XP, points)
    expect(screen.getByText("18.5")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Habits" })).toBeInTheDocument();
    const xpCell = screen.getByText("+135 XP").closest("td");
    const pointsCell = screen.getByText("+11.25").closest("td");
    expect(xpCell).not.toBeNull();
    expect(pointsCell).not.toBeNull();
    expect(xpCell!.textContent?.trim().startsWith("+")).toBe(true);
    expect(pointsCell!.textContent?.trim().startsWith("+")).toBe(true);

    // Explicit .scholar-heading-rule class on section headings
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.length).toBeGreaterThanOrEqual(3);
    for (const h of headings) {
      expect(h).toHaveClass("scholar-heading-rule");
    }
  });

  it("shows Default-style note and opens Settings -> Appearance on click", async () => {
    useStyle.getState().setStyle("default");
    const user = userEvent.setup();
    renderTranscript();

    expect(screen.getByText("The transcript is part of the Scholar style.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Appearance settings" }));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/settings" });
  });

  it("renders empty states and error retry state", async () => {
    vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue({
      ...SUMMARY,
      level: 1,
      total_xp: 0,
      gold_cents: 0,
    });
    vi.spyOn(ipcModule.ipc, "progressHistory").mockResolvedValue([]);
    vi.spyOn(ipcModule.ipc, "progressByDeck").mockResolvedValue([]);
    vi.spyOn(ipcModule.ipc, "studyDays").mockResolvedValue([]);
    vi.spyOn(ipcModule.ipc, "listDecks").mockResolvedValue([]);

    const { unmount } = renderTranscript();
    expect(await screen.findByText("No certificates earned yet.")).toBeInTheDocument();
    expect(screen.getByText("No decks with cards yet.")).toBeInTheDocument();
    expect(screen.getByText("No study sessions recorded in the last 30 days.")).toBeInTheDocument();
    unmount();

    vi.spyOn(ipcModule.ipc, "progressSummary").mockRejectedValue(new Error("fail"));
    renderTranscript();
    expect(await screen.findByText("Could not load transcript data.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
