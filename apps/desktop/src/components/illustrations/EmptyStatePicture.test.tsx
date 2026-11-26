import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HabitBoardDto } from "@bibalak/ipc-types";
import { DeckBrowserScreen } from "@/features/decks/DeckBrowserScreen";
import { HabitTrackerScreen } from "@/features/habits/HabitTrackerScreen";
import { TaskListView } from "@/features/matrix/TaskListView";
import * as ipcModule from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { useStyle, type Style } from "@/stores/style";

vi.mock("@/lib/platform", () => ({
  platform: {
    kind: "desktop",
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: () => () => {},
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({ create: false }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

function makeEmptyHabitBoard(): HabitBoardDto {
  return {
    today_day_index: 103,
    today_date: "2026-11-21",
    week_days: [
      {
        day_index: 100,
        date: "2026-11-18",
        scheduled_count: 0,
        completed_count: 0,
        excused_count: 0,
        completion_ratio: 0,
      },
    ],
    habits: [],
    logs: [],
  };
}

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function setupDeckMocks() {
  vi.spyOn(ipcModule.ipc, "appInfo").mockResolvedValue({
    name: "Bibalak",
    version: "1.0.0",
    tauri_version: "2.0.0",
    media_dir: "",
  });
  vi.spyOn(ipcModule.ipc, "listDecks").mockResolvedValue([]);
  vi.spyOn(ipcModule.ipc, "undoStatus").mockResolvedValue(null);
  vi.spyOn(ipcModule.ipc, "progressSummary").mockResolvedValue({
    level: 1,
    xp_into_level: 0,
    xp_to_next_level: 100,
    total_xp: 0,
    gold_cents: 0,
    today_xp: 0,
    today_gold_cents: 0,
    tasks_rewarded_today: 0,
    task_reward_daily_cap: 10,
  });
  vi.spyOn(ipcModule.ipc, "yesterdaySummary").mockResolvedValue(null);
  vi.spyOn(ipcModule.ipc, "getGameState").mockRejectedValue(new Error("unused"));
}

function setupHabitMocks() {
  vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(makeEmptyHabitBoard());
  vi.spyOn(ipcModule.ipc, "listDecks").mockResolvedValue([]);
  vi.spyOn(ipcModule.ipc, "undoStatus").mockResolvedValue(null);
}

describe("empty_state_picture_per_style (14g)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useStyle.getState().setStyle("default");
  });

  afterEach(() => {
    cleanup();
    useStyle.getState().setStyle("default");
  });

  it.each(["default", "game", "scholar"] as Style[])(
    "renders the expected empty-state picture for %s style on Home, Habits, and Tasks",
    async (style) => {
      useStyle.getState().setStyle(style);

      // 1. Home (DeckBrowserScreen)
      setupDeckMocks();
      const home = renderWithQuery(<DeckBrowserScreen />);
      const homeTitle = await screen.findByText(t("decks.none.title"));
      if (style === "default") {
        expect(screen.queryByTestId(/empty-illustration-/)).not.toBeInTheDocument();
      } else {
        const pic = screen.getByTestId(`empty-illustration-decks-${style}`);
        expect(pic).toHaveAttribute("role", "img");
        expect(pic).toHaveAttribute("aria-label", t(`emptyState.decks.${style}`));
        expect(
          pic.compareDocumentPosition(homeTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
      home.unmount();

      // 2. Habits (HabitTrackerScreen)
      setupHabitMocks();
      const habits = renderWithQuery(<HabitTrackerScreen />);
      const habitsTitle = await screen.findByText(t("habits.empty"));
      if (style === "default") {
        expect(screen.queryByTestId(/empty-illustration-/)).not.toBeInTheDocument();
      } else {
        const pic = screen.getByTestId(`empty-illustration-habits-${style}`);
        expect(pic).toHaveAttribute("role", "img");
        expect(pic).toHaveAttribute("aria-label", t(`emptyState.habits.${style}`));
        expect(
          pic.compareDocumentPosition(habitsTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
      habits.unmount();

      // 3. Tasks (TaskListView)
      const tasks = renderWithQuery(
        <TaskListView
          todayDate="2026-11-21"
          tasks={[]}
          deckDueItems={[]}
          quadrants={[]}
          taskLists={[]}
          includeCompleted={false}
          selectedTaskId={null}
          focusedTaskId={null}
          editingTaskTitleId={null}
          quickAddRef={{ current: null }}
          isCreating={false}
          onRequestInlineEdit={vi.fn()}
          onSelectTask={vi.fn()}
          onFocusTask={vi.fn()}
          onCreateTask={vi.fn()}
          onToggleComplete={vi.fn()}
          onUpdateTask={vi.fn()}
          onDeleteTask={vi.fn()}
          onMoveToQuadrant={vi.fn()}
          onManageLists={vi.fn()}
        />,
      );
      const tasksTitle = await screen.findByText(t("matrix.list.emptyTitle"));
      if (style === "default") {
        expect(screen.queryByTestId(/empty-illustration-/)).not.toBeInTheDocument();
      } else {
        const pic = screen.getByTestId(`empty-illustration-tasks-${style}`);
        expect(pic).toHaveAttribute("role", "img");
        expect(pic).toHaveAttribute("aria-label", t(`emptyState.tasks.${style}`));
        expect(
          pic.compareDocumentPosition(tasksTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
      tasks.unmount();
    },
  );
});
