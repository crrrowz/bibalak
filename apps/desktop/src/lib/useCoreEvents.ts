import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CoreEventName } from "@bibalak/ipc-types";
import { ipc, isTauri } from "@/lib/ipc";
import { platform } from "@/lib/platform";
import { pluginHost } from "@/lib/pluginHost";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Subscribe to core domain events (re-emitted by the Tauri shell) and map them
 * to TanStack Query cache invalidations. This is how the UI stays live without
 * polling — the Rust core is the source of truth. Mount once in the AppShell.
 */
export function useCoreEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isTauri()) return;
    // Rust core has no OS timezone access; the day-rollover boundary is
    // evaluated in local time using this offset, sent once per session.
    void ipc.setLocalOffset(-new Date().getTimezoneOffset());
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    return platform.listen<CoreEventName>("bibalak://event", (payload) => {
      pluginHost.broadcastEvent({ type: payload });
      if (
        payload === "deck-changed" ||
        payload === "schema-changed" ||
        payload === "card-answered"
      ) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
      }
      if (
        payload === "deck-changed" ||
        payload === "schema-changed" ||
        payload === "card-answered" ||
        payload === "notes-changed" ||
        payload === "productivity-changed"
      ) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.undoStatus });
        void queryClient.invalidateQueries({ queryKey: queryKeys.progressSummary });
        void queryClient.invalidateQueries({ queryKey: queryKeys.progressHistory });
        void queryClient.invalidateQueries({ queryKey: queryKeys.studyDaysAll });
        void queryClient.invalidateQueries({ queryKey: queryKeys.progressByDeck });
        void queryClient.invalidateQueries({ queryKey: queryKeys.yesterdaySummary });
      }
      if (payload === "productivity-changed" || payload === "schema-changed") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.taskListsAll });
        void queryClient.invalidateQueries({ queryKey: queryKeys.matrixAll });
        void queryClient.invalidateQueries({ queryKey: queryKeys.habitsAll });
        void queryClient.invalidateQueries({ queryKey: queryKeys.calendarAll });
      }
      if (
        payload === "deck-changed" ||
        payload === "card-answered" ||
        payload === "notes-changed"
      ) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.matrixAll });
        void queryClient.invalidateQueries({ queryKey: queryKeys.calendarAll });
      }
      if (payload === "card-answered") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.habitsAll });
      }
      if (payload === "notes-changed" || payload === "schema-changed") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
        void queryClient.invalidateQueries({ queryKey: queryKeys.notetypesAll });
        void queryClient.invalidateQueries({ queryKey: queryKeys.tags });
      }
      if (payload === "notes-changed" || payload === "media-changed") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.mediaLibraryAll });
      }
      if (payload === "media-changed") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.legacyMediaPending });
      }
      if (
        payload === "card-answered" ||
        payload === "notes-changed" ||
        payload === "schema-changed"
      ) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.statsAll });
        void queryClient.invalidateQueries({ queryKey: queryKeys.cardsAll });
      }
      if (
        payload === "game-changed" ||
        payload === "card-answered" ||
        payload === "productivity-changed" ||
        payload === "schema-changed"
      ) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.gameState });
        void queryClient.invalidateQueries({ queryKey: queryKeys.customRewards });
        void queryClient.invalidateQueries({ queryKey: queryKeys.spendHistory });
        void queryClient.invalidateQueries({ queryKey: queryKeys.gameDepthState });
      }
      if (payload === "game-changed") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.progressSummary });
      }
      if (
        payload === "card-answered" ||
        payload === "productivity-changed" ||
        payload === "game-changed" ||
        payload === "schema-changed"
      ) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.motivationState });
        void queryClient.invalidateQueries({ queryKey: queryKeys.streakCalendarAll });
      }
    });
  }, [queryClient]);
}
