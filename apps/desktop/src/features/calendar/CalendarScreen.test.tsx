import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CalendarOccurrenceDto,
  HabitBoardDto,
  MatrixBoardDto,
  StatsDto,
  TaskDto,
} from "@bibalak/ipc-types";
import { CalendarScreen } from "./CalendarScreen";
import * as ipcModule from "@/lib/ipc";
import { setLocale } from "@/lib/i18n";
import { useWeekStart } from "@/stores/weekStart";

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

function localIso(daysOffset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localTimeMs(isoDate: string, hour: number, minute: number): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0).getTime();
}

function makeStats(todayDate: string, tomorrowDate: string): StatsDto {
  return {
    today: 10,
    today_date: todayDate,
    dates: { 10: todayDate, 11: tomorrowDate },
    total_reviews: 100,
    studied_days: 10,
    retention_pct: 90,
    retention_goal_pct: 90,
    total_time_ms: 1000,
    new_count: 5,
    learning_count: 2,
    young_count: 20,
    mature_count: 30,
    suspended_count: 0,
    reviews: [],
    forecast: [
      { day: 0, count: 42, date: todayDate },
      { day: 1, count: 19, date: tomorrowDate },
    ],
    backlog_count: 0,
    day0_ms: 0,
    retention_weekly: [],
    answer_buttons: { learning: [0, 0, 0, 0], young: [0, 0, 0, 0], mature: [0, 0, 0, 0] },
    hourly: [],
    fsrs: {
      card_count: 50,
      stability_buckets: [],
      difficulty_buckets: [],
      avg_retrievability: 0.9,
    },
    deck_stats: [],
    coach: {
      leech_count: 0,
      leech_card_ids: [],
      leech_weekly_minutes: 0,
      overdue_count: 0,
      suggested_daily_reviews: 20,
    },
  };
}

function makeMatrixBoard(todayDate: string, tomorrowDate: string): MatrixBoardDto {
  const unscheduled: TaskDto = {
    id: "task-unscheduled",
    list_id: null,
    list_name: null,
    title: "Read physiology chapter",
    notes: "",
    priority: "medium",
    manual_quadrant: "q2",
    effective_quadrant: "q2",
    due_date: tomorrowDate,
    scheduled_start_ms: null,
    scheduled_end_ms: null,
    tags: [],
    deck_id: null,
    deck_name: null,
    completed_at: null,
    completed_day: null,
    sort_order: 0,
  };
  const scheduled: TaskDto = {
    id: "task-scheduled",
    list_id: null,
    list_name: null,
    title: "Anki deck deep focus",
    notes: "",
    priority: "high",
    manual_quadrant: "q1",
    effective_quadrant: "q1",
    due_date: todayDate,
    scheduled_start_ms: localTimeMs(todayDate, 14, 0),
    scheduled_end_ms: localTimeMs(todayDate, 15, 0),
    tags: [],
    deck_id: null,
    deck_name: null,
    completed_at: null,
    completed_day: null,
    sort_order: 1,
  };
  return {
    today_date: todayDate,
    quadrants: [],
    tasks: [unscheduled, scheduled],
    deck_due_items: [],
  };
}

function makeHabitBoard(todayDate: string): HabitBoardDto {
  return {
    today_day_index: 10,
    today_date: todayDate,
    week_days: [
      {
        day_index: 10,
        date: todayDate,
        scheduled_count: 1,
        completed_count: 0,
        excused_count: 0,
        completion_ratio: 0,
      },
    ],
    habits: [
      {
        id: "h-1",
        title: "Morning review",
        notes: "",
        icon_key: "sun",
        color_token: "accent",
        frequency_kind: "daily",
        weekdays: [],
        weekly_target: null,
        interval_days: null,
        goal_mode: "achieve_all",
        goal_target: 1,
        goal_unit: "",
        start_day_index: 1,
        start_date: todayDate,
        target_days: null,
        section: "morning",
        reminders: [],
        auto_popup_log: false,
        deck_id: null,
        deck_name: null,
        archived_at: null,
        sort_order: 0,
        current_streak: 2,
      },
    ],
    logs: [],
  };
}

function renderCalendar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CalendarScreen />
    </QueryClientProvider>,
  );
}

describe("CalendarScreen (CAL1)", () => {
  const todayDate = localIso(0);
  const tomorrowDate = localIso(1);

  beforeEach(() => {
    vi.restoreAllMocks();
    navigateMock.mockReset();
    localStorage.clear();
    setLocale("en");
    useWeekStart.setState({ weekStart: "mon" });
    vi.spyOn(ipcModule.ipc, "undoStatus").mockResolvedValue(null);
    vi.spyOn(ipcModule.ipc, "getStats").mockResolvedValue(makeStats(todayDate, tomorrowDate));
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(makeHabitBoard(todayDate));
    vi.spyOn(ipcModule.ipc, "getMatrixBoard").mockResolvedValue(
      makeMatrixBoard(todayDate, tomorrowDate),
    );
  });

  afterEach(() => {
    localStorage.clear();
    setLocale("en");
    useWeekStart.setState({ weekStart: "mon" });
  });

  it("renders Week view with events in the right day columns, tasks, habit windows, and forecast badges", async () => {
    const occ: CalendarOccurrenceDto = {
      event_id: "ev-1",
      occurrence_date: todayDate,
      is_recurring: false,
      title: "Pharmacology lecture",
      description: "",
      location: "Hall A",
      color_token: "accent",
      start_ms: localTimeMs(todayDate, 9, 0),
      end_ms: localTimeMs(todayDate, 10, 30),
      is_all_day: false,
      linked_task_id: null,
      recurrence: null,
    };
    vi.spyOn(ipcModule.ipc, "listCalendarOccurrences").mockResolvedValue([occ]);

    renderCalendar();

    const todayCol = await screen.findByTestId(`calendar-day-${todayDate}`);
    const todayAllDay = await screen.findByTestId(`calendar-allday-${todayDate}`);
    expect(await within(todayCol).findByText("Pharmacology lecture")).toBeInTheDocument();
    expect(await within(todayCol).findByText("Anki deck deep focus")).toBeInTheDocument();
    expect(await within(todayAllDay).findByText("Morning review")).toBeInTheDocument();
    expect(await within(todayAllDay).findByText("42 cards due")).toBeInTheDocument();
  });

  it("switches cleanly between Week, Month, and Agenda views", async () => {
    const user = userEvent.setup();
    const occ: CalendarOccurrenceDto = {
      event_id: "ev-1",
      occurrence_date: todayDate,
      is_recurring: false,
      title: "Study group",
      description: "",
      location: "",
      color_token: "accent",
      start_ms: localTimeMs(todayDate, 11, 0),
      end_ms: localTimeMs(todayDate, 12, 0),
      is_all_day: false,
      linked_task_id: null,
      recurrence: null,
    };
    vi.spyOn(ipcModule.ipc, "listCalendarOccurrences").mockResolvedValue([occ]);

    renderCalendar();
    await screen.findByTestId("calendar-time-grid");

    await user.click(screen.getByRole("button", { name: /^Month$/i }));
    const monthGrid = await screen.findByTestId("calendar-month-view");
    expect(within(monthGrid).getByText("Study group")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Agenda$/i }));
    const agenda = await screen.findByTestId("calendar-agenda-view");
    expect(within(agenda).getByText("Study group")).toBeInTheDocument();
  });

  it("creates a weekly recurring event and deletes a single occurrence", async () => {
    const user = userEvent.setup();
    let occurrences: CalendarOccurrenceDto[] = [];
    vi.spyOn(ipcModule.ipc, "listCalendarOccurrences").mockImplementation(async () => occurrences);
    const createSpy = vi
      .spyOn(ipcModule.ipc, "createCalendarEvent")
      .mockImplementation(async (input) => {
        const created: CalendarOccurrenceDto = {
          event_id: "ev-rec",
          occurrence_date: todayDate,
          is_recurring: Boolean(input.recurrence),
          title: input.title,
          description: input.description,
          location: input.location,
          color_token: input.color_token,
          start_ms: input.start_ms,
          end_ms: input.end_ms,
          is_all_day: input.is_all_day,
          linked_task_id: input.linked_task_id,
          recurrence: input.recurrence,
        };
        occurrences = [created];
        return created;
      });
    const deleteOccSpy = vi
      .spyOn(ipcModule.ipc, "deleteCalendarOccurrence")
      .mockImplementation(async (id, occDate) => {
        occurrences = occurrences.filter(
          (o) => !(o.event_id === id && o.occurrence_date === occDate),
        );
      });

    renderCalendar();
    await screen.findByTestId("calendar-time-grid");

    await user.click(screen.getByRole("button", { name: /New event/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Title/i), "Weekly anatomy lab");
    await user.selectOptions(within(dialog).getByLabelText(/Repeat/i), "weekly");
    await user.click(within(dialog).getByRole("button", { name: /^Save$/i }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Weekly anatomy lab",
          recurrence: expect.objectContaining({ freq: "weekly" }),
        }),
      ),
    );

    const todayCol = await screen.findByTestId(`calendar-day-${todayDate}`);
    const evActionBtn = within(todayCol).getByRole("button", {
      name: /Actions for Weekly anatomy lab/i,
    });
    await user.click(evActionBtn);
    await user.click(screen.getByRole("menuitem", { name: /Delete this occurrence/i }));

    await waitFor(() => expect(deleteOccSpy).toHaveBeenCalledWith("ev-rec", todayDate));
    await waitFor(() =>
      expect(within(todayCol).queryByText("Weekly anatomy lab")).not.toBeInTheDocument(),
    );
  });

  it("schedules an unscheduled task via the Schedule dialog", async () => {
    const user = userEvent.setup();
    vi.spyOn(ipcModule.ipc, "listCalendarOccurrences").mockResolvedValue([]);
    const updateTaskSpy = vi
      .spyOn(ipcModule.ipc, "updateTask")
      .mockImplementation(async (id, input) => ({
        id,
        list_id: input.list_id,
        list_name: null,
        title: input.title,
        notes: input.notes,
        priority: input.priority,
        manual_quadrant: input.manual_quadrant,
        effective_quadrant: "q2",
        due_date: input.due_date,
        scheduled_start_ms: input.scheduled_start_ms,
        scheduled_end_ms: input.scheduled_end_ms,
        tags: input.tags,
        deck_id: input.deck_id,
        deck_name: null,
        completed_at: null,
        completed_day: null,
        sort_order: input.sort_order,
      }));

    renderCalendar();

    const sidebar = await screen.findByTestId("calendar-unscheduled");
    expect(await within(sidebar).findByText("Read physiology chapter")).toBeInTheDocument();
    await user.click(
      within(sidebar).getByRole("button", { name: /Schedule Read physiology chapter/i }),
    );

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^Schedule$/i }));

    await waitFor(() =>
      expect(updateTaskSpy).toHaveBeenCalledWith(
        "task-unscheduled",
        expect.objectContaining({
          scheduled_start_ms: expect.any(Number),
          scheduled_end_ms: expect.any(Number),
        }),
      ),
    );
  });

  it("renders Arabic labels and logical layout in RTL", async () => {
    setLocale("ar");
    vi.spyOn(ipcModule.ipc, "listCalendarOccurrences").mockResolvedValue([]);

    renderCalendar();

    expect(document.documentElement.dir).toBe("rtl");
    expect(await screen.findByText("التقويم")).toBeInTheDocument();
    await screen.findByTestId("calendar-time-grid");
    expect(screen.getByRole("button", { name: "الأسبوع" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "الشهر" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "الأجندة" })).toBeInTheDocument();
  });

  it("opens Decks when clicking the study forecast badge", async () => {
    const user = userEvent.setup();
    vi.spyOn(ipcModule.ipc, "listCalendarOccurrences").mockResolvedValue([]);

    renderCalendar();

    const todayAllDay = await screen.findByTestId(`calendar-allday-${todayDate}`);
    const badge = await within(todayAllDay).findByRole("button", { name: /42 cards due/i });
    await user.click(badge);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/" });
  });

  it("renders recurring event titles visibly on their own line with full-text title attributes in Week view (A2)", async () => {
    const recurringOcc: CalendarOccurrenceDto = {
      event_id: "ev-rec-1",
      occurrence_date: todayDate,
      is_recurring: true,
      title: "Morning pharmacology seminar",
      description: "",
      location: "",
      color_token: "accent",
      start_ms: localTimeMs(todayDate, 9, 0),
      end_ms: localTimeMs(todayDate, 10, 0),
      is_all_day: false,
      linked_task_id: null,
      recurrence: {
        freq: "weekly",
        interval: 1,
        weekdays: [7],
        until_date: null,
        count: null,
        exdates: [],
      },
    };
    vi.spyOn(ipcModule.ipc, "listCalendarOccurrences").mockResolvedValue([recurringOcc]);

    renderCalendar();

    const todayCol = await screen.findByTestId(`calendar-day-${todayDate}`);
    const todayAllDay = await screen.findByTestId(`calendar-allday-${todayDate}`);
    const occTitle = await within(todayCol).findByText("Morning pharmacology seminar");
    expect(occTitle).toBeVisible();
    expect(occTitle).toHaveAttribute("title", "Morning pharmacology seminar");
    expect(occTitle.className).toContain("line-clamp-2");
    expect(occTitle.className).not.toContain("truncate");

    const taskTitle = within(todayCol).getByText("Anki deck deep focus");
    expect(taskTitle).toHaveAttribute("title", "Anki deck deep focus");

    const habitChip = within(todayAllDay).getByText("Morning review");
    expect(habitChip).toHaveAttribute("title", "Morning review");
    expect(habitChip.className).not.toContain("truncate");

    const forecastBadge = within(todayAllDay).getByRole("button", { name: /42 cards due/i });
    expect(forecastBadge).toHaveAttribute("title", "42 cards due");
  });

  it("week_renders_hourly_grid_and_now_line", async () => {
    const user = userEvent.setup();
    const occ1: CalendarOccurrenceDto = {
      event_id: "ev-1",
      occurrence_date: todayDate,
      is_recurring: false,
      title: "Overlap A",
      description: "",
      location: "",
      color_token: "accent",
      start_ms: localTimeMs(todayDate, 10, 0),
      end_ms: localTimeMs(todayDate, 11, 30),
      is_all_day: false,
      linked_task_id: null,
      recurrence: null,
    };
    const occ2: CalendarOccurrenceDto = {
      event_id: "ev-2",
      occurrence_date: todayDate,
      is_recurring: false,
      title: "Overlap B",
      description: "",
      location: "",
      color_token: "accent",
      start_ms: localTimeMs(todayDate, 10, 30),
      end_ms: localTimeMs(todayDate, 12, 0),
      is_all_day: false,
      linked_task_id: null,
      recurrence: null,
    };
    const skippedBoard = makeHabitBoard(todayDate);
    skippedBoard.logs = [
      {
        habit_id: "h-1",
        day_index: 10,
        date: todayDate,
        logged_value: 0,
        goal_target: 1,
        completed: false,
        status: "skipped",
        mood: null,
        note: "",
      },
    ];
    vi.spyOn(ipcModule.ipc, "getHabitBoard").mockResolvedValue(skippedBoard);
    const logHabitSpy = vi.spyOn(ipcModule.ipc, "logHabit").mockResolvedValue({
      habit_id: "h-1",
      day_index: 10,
      date: todayDate,
      logged_value: 1,
      goal_target: 1,
      completed: true,
      status: "logged",
      mood: null,
      note: "",
    });
    vi.spyOn(ipcModule.ipc, "listCalendarOccurrences").mockResolvedValue([occ1, occ2]);

    renderCalendar();

    const grid = await screen.findByTestId("calendar-time-grid");
    expect(grid).toHaveAttribute("role", "grid");
    expect(grid.querySelectorAll("[data-date]")).toHaveLength(7);
    expect(screen.getByTestId("calendar-hour-gutter")).toBeInTheDocument();

    const todayCol = screen.getByTestId(`calendar-day-${todayDate}`);
    expect(within(todayCol).getByTestId("calendar-now-line")).toBeInTheDocument();

    const blockA = within(todayCol).getByTestId("calendar-block-ev-1");
    const blockB = within(todayCol).getByTestId("calendar-block-ev-2");
    expect(blockA.style.width).toContain("50%");
    expect(blockB.style.width).toContain("50%");

    const todayAllDay = screen.getByTestId(`calendar-allday-${todayDate}`);
    expect(within(todayAllDay).getByText("Skipped")).toBeInTheDocument();
    await user.click(within(todayAllDay).getByRole("button", { name: /Morning review/i }));
    await waitFor(() =>
      expect(logHabitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ habit_id: "h-1", logged_value: 1, status: "logged" }),
      ),
    );
  });

  it("day_and_3day_share_time_grid_columns", async () => {
    const user = userEvent.setup();
    vi.spyOn(ipcModule.ipc, "listCalendarOccurrences").mockResolvedValue([]);

    renderCalendar();
    const grid = await screen.findByTestId("calendar-time-grid");
    expect(grid.querySelectorAll("[data-date]")).toHaveLength(7);

    await user.click(screen.getByRole("button", { name: /^Day$/i }));
    const dayGrid = await screen.findByTestId("calendar-time-grid");
    const dayCols = dayGrid.querySelectorAll("[data-date]");
    expect(dayCols).toHaveLength(1);
    expect(dayCols[0]).toHaveAttribute("data-date", todayDate);

    await user.click(screen.getByRole("button", { name: /^3-Day$/i }));
    const threeDayGrid = await screen.findByTestId("calendar-time-grid");
    const threeCols = threeDayGrid.querySelectorAll("[data-date]");
    expect(threeCols).toHaveLength(3);
    expect(threeCols[0]).toHaveAttribute("data-date", todayDate);
    expect(threeCols[1]).toHaveAttribute("data-date", tomorrowDate);
  });

  it("drag_create_move_resize_snaps_15_minutes", async () => {
    const occ: CalendarOccurrenceDto = {
      event_id: "ev-drag",
      occurrence_date: todayDate,
      is_recurring: false,
      title: "Anatomy block",
      description: "",
      location: "",
      color_token: "accent",
      start_ms: localTimeMs(todayDate, 9, 0),
      end_ms: localTimeMs(todayDate, 10, 0),
      is_all_day: false,
      linked_task_id: null,
      recurrence: null,
    };
    vi.spyOn(ipcModule.ipc, "listCalendarOccurrences").mockResolvedValue([occ]);
    const updateSpy = vi.spyOn(ipcModule.ipc, "updateCalendarEvent").mockResolvedValue(occ);

    renderCalendar();
    const grid = await screen.findByTestId("calendar-time-grid");
    const cols = Array.from(grid.querySelectorAll<HTMLElement>("[data-date]"));
    cols.forEach((col, i) => {
      vi.spyOn(col, "getBoundingClientRect").mockReturnValue({
        left: i * 100,
        right: (i + 1) * 100,
        top: 0,
        bottom: 1152,
        width: 100,
        height: 1152,
        x: i * 100,
        y: 0,
        toJSON: () => ({}),
      });
    });

    const todayIndex = cols.findIndex((c) => c.dataset.date === todayDate);
    const todayCol = cols[todayIndex];
    const todayX = todayIndex * 100 + 50;

    // 1. Drag to create (11:00 -> 11:45 => y = 528 -> 564)
    fireEvent.pointerDown(todayCol, { clientX: todayX, clientY: 528, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: todayX, clientY: 564, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: todayX, clientY: 564, pointerId: 1 });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Start/i)).toHaveValue("11:00");
    expect(within(dialog).getByLabelText(/End/i)).toHaveValue("11:45");
    await userEvent.click(within(dialog).getByRole("button", { name: /^Cancel$/i }));

    // 2. Drag to move event (+60m => +48px, next column)
    const block = screen.getByTestId("calendar-block-ev-drag");
    const nextColIndex = todayIndex + 1 < cols.length ? todayIndex + 1 : todayIndex - 1;
    const targetDate = cols[nextColIndex].dataset.date!;
    const targetX = nextColIndex * 100 + 50;
    fireEvent.pointerDown(block, { clientX: todayX, clientY: 440, button: 0, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: targetX, clientY: 488, pointerId: 2 });
    fireEvent.pointerUp(window, { clientX: targetX, clientY: 488, pointerId: 2 });

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        "ev-drag",
        expect.objectContaining({
          start_ms: localTimeMs(targetDate, 10, 0),
          end_ms: localTimeMs(targetDate, 11, 0),
        }),
      ),
    );

    // 3. Drag bottom handle to resize (+30m => +24px)
    updateSpy.mockClear();
    const resizeBottom = within(block).getByTestId("resize-bottom-ev-drag");
    fireEvent.pointerDown(resizeBottom, { clientX: todayX, clientY: 480, button: 0, pointerId: 3 });
    fireEvent.pointerMove(window, { clientX: todayX, clientY: 504, pointerId: 3 });
    fireEvent.pointerUp(window, { clientX: todayX, clientY: 504, pointerId: 3 });

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        "ev-drag",
        expect.objectContaining({
          start_ms: localTimeMs(todayDate, 9, 0),
          end_ms: localTimeMs(todayDate, 10, 30),
        }),
      ),
    );
  });

  it("rtl_column_hit_test_targets_rightmost_day_first", async () => {
    setLocale("ar");
    useWeekStart.setState({ weekStart: "sat" });
    const occ: CalendarOccurrenceDto = {
      event_id: "ev-rtl",
      occurrence_date: todayDate,
      is_recurring: false,
      title: "ندوة",
      description: "",
      location: "",
      color_token: "accent",
      start_ms: localTimeMs(todayDate, 9, 0),
      end_ms: localTimeMs(todayDate, 10, 0),
      is_all_day: false,
      linked_task_id: null,
      recurrence: null,
    };
    vi.spyOn(ipcModule.ipc, "listCalendarOccurrences").mockResolvedValue([occ]);
    const updateSpy = vi.spyOn(ipcModule.ipc, "updateCalendarEvent").mockResolvedValue(occ);

    renderCalendar();
    expect(document.documentElement.dir).toBe("rtl");

    const grid = await screen.findByTestId("calendar-time-grid");
    const cols = Array.from(grid.querySelectorAll<HTMLElement>("[data-date]"));
    // Simulate RTL physical positions: cols[0] is rightmost (x=600..700), cols[6] is leftmost (x=0..100).
    cols.forEach((col, i) => {
      const left = (cols.length - 1 - i) * 100;
      vi.spyOn(col, "getBoundingClientRect").mockReturnValue({
        left,
        right: left + 100,
        top: 0,
        bottom: 1152,
        width: 100,
        height: 1152,
        x: left,
        y: 0,
        toJSON: () => ({}),
      });
    });

    const todayIndex = cols.findIndex((c) => c.dataset.date === todayDate);
    const neighborIndex = todayIndex === cols.length - 1 ? todayIndex - 1 : todayIndex + 1;
    const todayRect = cols[todayIndex].getBoundingClientRect();
    const neighborRect = cols[neighborIndex].getBoundingClientRect();
    const neighborDate = cols[neighborIndex].dataset.date!;

    const block = screen.getByTestId("calendar-block-ev-rtl");
    expect(block.querySelector('[dir="ltr"].tnum')).toBeInTheDocument();

    fireEvent.pointerDown(block, {
      clientX: todayRect.left + 50,
      clientY: 440,
      button: 0,
      pointerId: 4,
    });
    fireEvent.pointerMove(window, {
      clientX: neighborRect.left + 50,
      clientY: 440,
      pointerId: 4,
    });
    fireEvent.pointerUp(window, {
      clientX: neighborRect.left + 50,
      clientY: 440,
      pointerId: 4,
    });

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        "ev-rtl",
        expect.objectContaining({
          start_ms: localTimeMs(neighborDate, 9, 0),
          end_ms: localTimeMs(neighborDate, 10, 0),
        }),
      ),
    );
  });

  it("unscheduled_drawer_side_by_side_at_1200px_and_drops_to_slot", async () => {
    vi.spyOn(ipcModule.ipc, "listCalendarOccurrences").mockResolvedValue([]);
    const updateTaskSpy = vi
      .spyOn(ipcModule.ipc, "updateTask")
      .mockImplementation(async (id, input) => ({
        id,
        list_id: input.list_id,
        list_name: null,
        title: input.title,
        notes: input.notes,
        priority: input.priority,
        manual_quadrant: input.manual_quadrant,
        effective_quadrant: "q2",
        due_date: input.due_date,
        scheduled_start_ms: input.scheduled_start_ms,
        scheduled_end_ms: input.scheduled_end_ms,
        tags: input.tags,
        deck_id: input.deck_id,
        deck_name: null,
        completed_at: null,
        completed_day: null,
        sort_order: input.sort_order,
      }));

    renderCalendar();

    const grid = await screen.findByTestId("calendar-time-grid");
    const unscheduled = screen.getByTestId("calendar-unscheduled");
    const layoutContainer = unscheduled.parentElement;
    expect(layoutContainer?.className).toContain("lg:grid-cols-[1fr_280px]");
    expect(within(unscheduled).getByTestId("calendar-mini-month")).toBeInTheDocument();

    const cols = Array.from(grid.querySelectorAll<HTMLElement>("[data-date]"));
    cols.forEach((col, i) => {
      vi.spyOn(col, "getBoundingClientRect").mockReturnValue({
        left: i * 100,
        right: (i + 1) * 100,
        top: 0,
        bottom: 1152,
        width: 100,
        height: 1152,
        x: i * 100,
        y: 0,
        toJSON: () => ({}),
      });
    });

    const todayIndex = cols.findIndex((c) => c.dataset.date === todayDate);
    const targetX = todayIndex * 100 + 50;
    const taskRow = within(unscheduled).getByTestId("unscheduled-task-task-unscheduled");

    // Drag to 13:00 (y = 13 * 48 = 624) -> 60-minute block 13:00..14:00
    fireEvent.pointerDown(taskRow, { clientX: 900, clientY: 300, button: 0, pointerId: 5 });
    fireEvent.pointerMove(window, { clientX: targetX, clientY: 624, pointerId: 5 });
    fireEvent.pointerUp(window, { clientX: targetX, clientY: 624, pointerId: 5 });

    await waitFor(() =>
      expect(updateTaskSpy).toHaveBeenCalledWith(
        "task-unscheduled",
        expect.objectContaining({
          scheduled_start_ms: localTimeMs(todayDate, 13, 0),
          scheduled_end_ms: localTimeMs(todayDate, 14, 0),
        }),
      ),
    );
  });

  it("month_more_popover_and_keyboard_shortcuts", async () => {
    const user = userEvent.setup();
    const events: CalendarOccurrenceDto[] = Array.from({ length: 5 }, (_, i) => ({
      event_id: `ev-m-${i}`,
      occurrence_date: todayDate,
      is_recurring: false,
      title: `Month item ${i + 1}`,
      description: "",
      location: "",
      color_token: "accent",
      start_ms: localTimeMs(todayDate, 8 + i, 0),
      end_ms: localTimeMs(todayDate, 9 + i, 0),
      is_all_day: false,
      linked_task_id: null,
      recurrence: null,
    }));
    vi.spyOn(ipcModule.ipc, "listCalendarOccurrences").mockResolvedValue(events);

    renderCalendar();
    await screen.findByTestId("calendar-time-grid");

    // Switch to Month via shortcut `4` (5 events + 1 timed task = 6 items -> 3 visible + "+3 more")
    await user.keyboard("4");
    const monthGrid = await screen.findByTestId("calendar-month-view");
    const moreBtn = within(monthGrid).getByRole("button", { name: /\+3 more/i });
    await user.click(moreBtn);
    const popover = await screen.findByTestId("calendar-month-more-popover");
    expect(within(popover).getByText("Month item 4")).toBeInTheDocument();
    expect(within(popover).getByText("Month item 5")).toBeInTheDocument();

    // Esc closes popover, then shortcuts switch views and toggle drawer
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("calendar-month-more-popover")).not.toBeInTheDocument();

    // Click empty cell space in Month view creates event on that date
    await user.click(within(monthGrid).getByTestId(`calendar-month-cell-${tomorrowDate}`));
    const cellDialog = await screen.findByRole("dialog");
    expect(within(cellDialog).getByLabelText(/Date/i)).toHaveValue(tomorrowDate);
    await user.click(within(cellDialog).getByRole("button", { name: /^Cancel$/i }));

    await user.keyboard("1");
    expect(screen.getByTestId("calendar-time-grid").querySelectorAll("[data-date]")).toHaveLength(
      1,
    );
    await user.keyboard("2");
    expect(screen.getByTestId("calendar-time-grid").querySelectorAll("[data-date]")).toHaveLength(
      3,
    );
    await user.keyboard("3");
    expect(screen.getByTestId("calendar-time-grid").querySelectorAll("[data-date]")).toHaveLength(
      7,
    );
    await user.keyboard("a");
    expect(screen.getByTestId("calendar-agenda-view")).toBeInTheDocument();
    await user.keyboard("w");
    expect(screen.getByTestId("calendar-time-grid")).toBeInTheDocument();
    await user.keyboard("u");
    expect(screen.queryByTestId("calendar-unscheduled")).not.toBeInTheDocument();
    await user.keyboard("u");
    expect(screen.getByTestId("calendar-unscheduled")).toBeInTheDocument();
    await user.keyboard("q");
    const qDialog = await screen.findByRole("dialog");
    // Shortcuts are ignored while a dialog/input has focus
    await user.keyboard("4");
    expect(screen.queryByTestId("calendar-month-view")).not.toBeInTheDocument();
    expect(qDialog).toBeInTheDocument();
  });

  it("week_columns_follow_week_start_sat", async () => {
    useWeekStart.setState({ weekStart: "sat" });
    vi.spyOn(ipcModule.ipc, "listCalendarOccurrences").mockResolvedValue([]);

    renderCalendar();
    const grid = await screen.findByTestId("calendar-time-grid");
    const firstDate = grid.querySelector<HTMLElement>("[data-date]")?.dataset.date;
    expect(firstDate).toBeDefined();
    const [y, m, d] = firstDate!.split("-").map(Number);
    // Saturday is JS getDay() === 6
    expect(new Date(y, m - 1, d).getDay()).toBe(6);
  });

  it("esc_cancels_drag_without_saving", async () => {
    const occ: CalendarOccurrenceDto = {
      event_id: "ev-esc",
      occurrence_date: todayDate,
      is_recurring: false,
      title: "Esc test event",
      description: "",
      location: "",
      color_token: "accent",
      start_ms: localTimeMs(todayDate, 9, 0),
      end_ms: localTimeMs(todayDate, 10, 0),
      is_all_day: false,
      linked_task_id: null,
      recurrence: null,
    };
    vi.spyOn(ipcModule.ipc, "listCalendarOccurrences").mockResolvedValue([occ]);
    const updateSpy = vi.spyOn(ipcModule.ipc, "updateCalendarEvent").mockResolvedValue(occ);
    const createSpy = vi.spyOn(ipcModule.ipc, "createCalendarEvent").mockResolvedValue(occ);

    renderCalendar();
    const grid = await screen.findByTestId("calendar-time-grid");
    const cols = Array.from(grid.querySelectorAll<HTMLElement>("[data-date]"));
    cols.forEach((col, i) => {
      vi.spyOn(col, "getBoundingClientRect").mockReturnValue({
        left: i * 100,
        right: (i + 1) * 100,
        top: 0,
        bottom: 1152,
        width: 100,
        height: 1152,
        x: i * 100,
        y: 0,
        toJSON: () => ({}),
      });
    });

    const todayIndex = cols.findIndex((c) => c.dataset.date === todayDate);
    const todayX = todayIndex * 100 + 50;
    const block = screen.getByTestId("calendar-block-ev-esc");

    fireEvent.pointerDown(block, { clientX: todayX, clientY: 440, button: 0, pointerId: 6 });
    fireEvent.pointerMove(window, { clientX: todayX, clientY: 490, pointerId: 6 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window, { clientX: todayX, clientY: 490, pointerId: 6 });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("H4: narrow calendar blocks wrap/ellipsis long unbroken words without overflowing", async () => {
    const user = userEvent.setup();
    const longWord = "SupercalifragilisticexpialidociousPharmacology";
    const occ: CalendarOccurrenceDto = {
      event_id: "ev-long",
      occurrence_date: todayDate,
      is_recurring: false,
      title: longWord,
      description: "",
      location: "",
      color_token: "accent",
      start_ms: localTimeMs(todayDate, 10, 0),
      end_ms: localTimeMs(todayDate, 11, 0),
      is_all_day: false,
      linked_task_id: null,
      recurrence: null,
    };
    vi.spyOn(ipcModule.ipc, "listCalendarOccurrences").mockResolvedValue([occ]);

    renderCalendar();

    const todayCol = await screen.findByTestId(`calendar-day-${todayDate}`);
    const titleEl = await within(todayCol).findByText(longWord);
    expect(titleEl.className).toContain("min-w-0");
    expect(titleEl.className).toContain("line-clamp-2");
    expect(titleEl.className).toContain("text-ellipsis");
    expect(titleEl.className).toContain("[overflow-wrap:anywhere]");
    expect(titleEl.className).not.toContain("truncate");

    // Month view cell also needs min-w-0 so w-full truncate clips inside CSS grid
    const monthBtn = screen.getByRole("button", { name: /^Month$/i });
    await user.click(monthBtn);
    const monthCell = await screen.findByTestId(`calendar-month-cell-${todayDate}`);
    expect(monthCell.className).toContain("min-w-0");
  });
});
