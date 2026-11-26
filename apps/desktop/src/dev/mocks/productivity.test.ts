import { beforeEach, describe, expect, it } from "vitest";
import { installPreviewMocks } from "@/dev/previewMocks";
import { buildQuadrantsForDeckMove } from "@/features/matrix/matrixHelpers";
import { ipc } from "@/lib/ipc";

describe("productivity preview mocks", () => {
  beforeEach(() => {
    installPreviewMocks();
  });

  it("evaluateDeckDue drops child decks when an ancestor is listed in the same quadrant (Z2 B1)", async () => {
    const board = await ipc.getMatrixBoard(false);
    const deckIds = board.deck_due_items.map((item) => item.deck_id);

    // Parent decks 1 (Default), 2 (Classical Music Themes), 4 (Spanish) appear;
    // child decks 3 (Classical Music Themes::Part I) and 5 (Spanish::Vocabulario) are dropped.
    expect(deckIds).toContain(1);
    expect(deckIds).toContain(2);
    expect(deckIds).toContain(4);
    expect(deckIds).not.toContain(3);
    expect(deckIds).not.toContain(5);
  });

  it("mocks get_habit_history, list_archived_habits, reorder_tasks, and reschedule_overdue_tasks", async () => {
    const habitBoard = await ipc.getHabitBoard(null, "sat");
    expect(habitBoard.habits.length).toBeGreaterThan(0);

    const history = await ipc.getHabitHistory(habitBoard.habits[0].id, 12, "sat");
    expect(history.habit.id).toBe(habitBoard.habits[0].id);

    const archived = await ipc.listArchivedHabits();
    expect(Array.isArray(archived)).toBe(true);

    const matrixBoard = await ipc.getMatrixBoard(false);
    const firstTask = matrixBoard.tasks[0];
    await ipc.reorderTasks([{ id: firstTask.id, sort_order: 42 }]);
    const updatedBoard = await ipc.getMatrixBoard(false);
    expect(updatedBoard.tasks.find((t) => t.id === firstTask.id)?.sort_order).toBe(42);

    const rescheduled = await ipc.rescheduleOverdueTasks(matrixBoard.today_date);
    expect(typeof rescheduled).toBe("number");
  });

  it("moves a study drill to Q2 in preview mocks without dropping other decks or tasks", async () => {
    const initial = await ipc.getMatrixBoard(false);
    const changed = buildQuadrantsForDeckMove(initial.quadrants, 2, "q2");
    await Promise.all(changed.map((q) => ipc.saveMatrixQuadrant(q)));

    const after = await ipc.getMatrixBoard(false);
    expect(after.deck_due_items.find((d) => d.deck_id === 2)?.quadrant_key).toBe("q2");
    expect(after.deck_due_items.find((d) => d.deck_id === 1)?.quadrant_key).toBe("q1");
  });
});
