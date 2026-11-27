import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CoreEventName } from "@bibalak/ipc-types";
import { useCoreEvents } from "./useCoreEvents";
import { platform } from "./platform";
import { queryKeys } from "./queryKeys";

vi.mock("./ipc", () => ({
  isTauri: () => true,
  ipc: {
    setLocalOffset: vi.fn(),
  },
}));

function mountCoreEvents() {
  let listener: ((payload: CoreEventName) => void) | null = null;
  vi.spyOn(platform, "listen").mockImplementation((_event, cb) => {
    listener = cb as (payload: CoreEventName) => void;
    return () => {};
  });

  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  renderHook(() => useCoreEvents(), { wrapper });
  expect(listener).not.toBeNull();

  return { emit: listener!, invalidateSpy, queryClient };
}

describe("useCoreEvents", () => {
  it("invalidates deck list on card-answered", () => {
    const { emit, invalidateSpy } = mountCoreEvents();

    emit("card-answered");

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.decks });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["stats"] });
  });

  it('invalidates ["tags"] on notes-changed and schema-changed', () => {
    const { emit, invalidateSpy } = mountCoreEvents();

    emit("notes-changed");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tags"] });

    invalidateSpy.mockClear();
    emit("schema-changed");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tags"] });
  });

  it("invalidates progressSummary and Scholar history queries on card-answered and undo-related domain events", () => {
    const { emit, invalidateSpy } = mountCoreEvents();

    for (const event of [
      "card-answered",
      "deck-changed",
      "notes-changed",
      "schema-changed",
    ] satisfies CoreEventName[]) {
      invalidateSpy.mockClear();
      emit(event);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.progressSummary });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.progressHistory });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.studyDaysAll });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.progressByDeck });
    }
  });

  it("H1: invalidates media-library when media-changed arrives (e.g. background legacy copy)", () => {
    const { emit, invalidateSpy } = mountCoreEvents();

    emit("media-changed");

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["media-library"] });
  });

  it("Z1b: invalidates legacyMediaPending when media-changed arrives", () => {
    const { emit, invalidateSpy } = mountCoreEvents();

    emit("media-changed");

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.legacyMediaPending });
  });

  it("M1: invalidates productivity prefixes, undoStatus, and progress keys on productivity-changed and schema-changed", () => {
    const { emit, invalidateSpy } = mountCoreEvents();

    for (const event of ["productivity-changed", "schema-changed"] satisfies CoreEventName[]) {
      invalidateSpy.mockClear();
      emit(event);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.taskListsAll });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.matrixAll });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.habitsAll });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.calendarAll });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.undoStatus });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.progressSummary });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.progressHistory });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.studyDaysAll });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.progressByDeck });
    }
  });

  it("M1: invalidates matrixAll and calendarAll on deck-changed, card-answered, and notes-changed", () => {
    const { emit, invalidateSpy } = mountCoreEvents();

    for (const event of [
      "deck-changed",
      "card-answered",
      "notes-changed",
    ] satisfies CoreEventName[]) {
      invalidateSpy.mockClear();
      emit(event);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.matrixAll });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.calendarAll });
    }
  });

  it("R3: invalidates yesterdaySummary and habitsAll on card-answered and productivity-changed", () => {
    const { emit, invalidateSpy } = mountCoreEvents();

    emit("card-answered");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.yesterdaySummary });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.habitsAll });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.habitHistoryAll });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.archivedHabits });

    invalidateSpy.mockClear();
    emit("productivity-changed");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.yesterdaySummary });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.habitsAll });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.habitHistoryAll });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.archivedHabits });

    invalidateSpy.mockClear();
    emit("schema-changed");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.habitHistoryAll });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.archivedHabits });
  });

  it("14d: invalidates gameState, customRewards, spendHistory, and gameDepthState on game-changed, card-answered, productivity-changed, and schema-changed", () => {
    const { emit, invalidateSpy } = mountCoreEvents();

    for (const event of [
      "game-changed",
      "card-answered",
      "productivity-changed",
      "schema-changed",
    ] satisfies CoreEventName[]) {
      invalidateSpy.mockClear();
      emit(event);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.gameState });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.customRewards });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.spendHistory });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.gameDepthState });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.progressSummary });
    }
  });

  it("ARCH7: invalidates notesDetail(id) on notes-changed and notetypesDetail(id) on schema-changed", () => {
    const { emit, queryClient } = mountCoreEvents();

    queryClient.setQueryData(queryKeys.notesDetail(42), { id: 42 });
    queryClient.setQueryData(queryKeys.notetypesDetail(7), { id: 7 });

    emit("notes-changed");
    expect(queryClient.getQueryState(queryKeys.notesDetail(42))?.isInvalidated).toBe(true);

    emit("schema-changed");
    expect(queryClient.getQueryState(queryKeys.notetypesDetail(7))?.isInvalidated).toBe(true);
  });

  it("LOGIC1: invalidates decks, queue, and deck-card-ids on notes-changed and deck-changed", () => {
    const { emit, invalidateSpy, queryClient } = mountCoreEvents();

    queryClient.setQueryData(["queue", "1"], { card_id: 1 });
    queryClient.setQueryData(["deck-card-ids", 1, true], [1]);

    emit("notes-changed");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.decks });
    expect(queryClient.getQueryState(["queue", "1"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["deck-card-ids", 1, true])?.isInvalidated).toBe(true);

    invalidateSpy.mockClear();
    queryClient.setQueryData(["queue", "1"], { card_id: 1 });
    queryClient.setQueryData(["deck-card-ids", 1, true], [1]);

    emit("deck-changed");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.statsAll });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.cardsAll });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.notesAll });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.tags });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.notetypesAll });
    expect(queryClient.getQueryState(["queue", "1"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["deck-card-ids", 1, true])?.isInvalidated).toBe(true);
  });

  it("LOGIC1: invalidates mediaLibraryAll, queue, and deck-card-ids on schema-changed", () => {
    const { emit, invalidateSpy, queryClient } = mountCoreEvents();

    queryClient.setQueryData(["queue", "2"], { card_id: 2 });
    queryClient.setQueryData(["deck-card-ids", 2, false], [2]);

    emit("schema-changed");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.mediaLibraryAll });
    expect(queryClient.getQueryState(["queue", "2"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["deck-card-ids", 2, false])?.isInvalidated).toBe(true);
  });

  it("LOGIC1: invalidates day-boundary queries after setLocalOffset resolves", async () => {
    const { ipc } = await import("./ipc");
    let resolveOffset!: () => void;
    vi.mocked(ipc.setLocalOffset).mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveOffset = res;
        }),
    );

    const { invalidateSpy } = mountCoreEvents();
    invalidateSpy.mockClear();
    resolveOffset();

    await vi.waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.decks });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.motivationState });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.matrixAll });
    });
  });
});
