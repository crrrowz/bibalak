import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HabitDto, HabitLogDto, TaskDto } from "@bibalak/ipc-types";
import { TimeGridAllDayStrip } from "./TimeGridAllDayStrip";
import { UnscheduledDrawer } from "./UnscheduledDrawer";

describe("A3-20: Calendar all-day chip wrap and unscheduled drawer button", () => {
  it("keeps all-day habit titles from breaking mid-word with overflow-wrap:anywhere", () => {
    const habit: HabitDto = {
      id: "h1",
      title: "Morning meditation",
      notes: "",
      icon_key: "sun",
      color_token: "primary",
      frequency_kind: "daily",
      weekdays: [],
      weekly_target: 7,
      interval_days: 1,
      goal_mode: "achieve_all",
      goal_target: 1,
      goal_unit: "",
      section: "morning",
      sort_order: 0,
      start_day_index: 1,
      start_date: "2026-11-18",
      target_days: null,
      deck_id: null,
      deck_name: null,
      reminders: [],
      auto_popup_log: false,
      archived_at: null,
      current_streak: 0,
    };
    const log: HabitLogDto = {
      habit_id: "h1",
      day_index: 10,
      date: "2026-11-28",
      logged_value: 0,
      goal_target: 1,
      completed: false,
      status: "skipped",
      mood: null,
      note: "",
    };

    render(
      <TimeGridAllDayStrip
        days={["2026-11-28"]}
        todayDate="2026-11-28"
        todayDayIndex={10}
        occurrencesByDate={new Map()}
        dueOnlyTasks={new Map()}
        habits={[habit]}
        habitLogMap={new Map([["h1:10", log]])}
        forecastMap={new Map()}
        style="default"
        maxAllDayItems={1}
        allDayExpanded={false}
        onToggleExpand={vi.fn()}
        onNavigateDecks={vi.fn()}
        onEditEvent={vi.fn()}
        onDeleteOccurrence={vi.fn()}
        onDeleteSeries={vi.fn()}
        onScheduleTask={vi.fn()}
        onToggleHabit={vi.fn()}
      />,
    );

    const titleEl = screen.getByText("Morning meditation");
    expect(titleEl.className).not.toContain("[overflow-wrap:anywhere]");
    expect(titleEl.className).toContain("truncate");
  });

  it("keeps UnscheduledDrawer Schedule button shrink-0 so label does not clip", () => {
    const task: TaskDto = {
      id: "t1",
      list_id: "l1",
      list_name: "Inbox",
      title: "Long due metadata task",
      notes: "",
      priority: "none",
      manual_quadrant: "q1",
      effective_quadrant: "q1",
      due_date: "2026-11-28",
      scheduled_start_ms: null,
      scheduled_end_ms: null,
      tags: [],
      deck_id: null,
      deck_name: null,
      completed_at: null,
      completed_day: null,
      sort_order: 0,
    };

    render(
      <UnscheduledDrawer
        tasks={[task]}
        anchorDate="2026-11-28"
        todayDate="2026-11-28"
        view="week"
        weekStart="mon"
        onSelectDate={vi.fn()}
        onOpenScheduleDialog={vi.fn()}
        onDropTaskOnSlot={vi.fn()}
        onDropTaskOnAllDay={vi.fn()}
        onExternalDropTargetChange={vi.fn()}
      />,
    );

    const btn = screen.getByRole("button", { name: /Long due metadata task/i });
    expect(btn.className).toContain("shrink-0");
  });
});
