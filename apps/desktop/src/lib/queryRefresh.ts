import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

/**
 * Invalidate every query affected when today's card counts or progress change
 * (increasing today's limit, saving deck options, resetting progress, answering,
 * or undoing).
 */
export function invalidateTodayCounts(queryClient: QueryClient): Promise<void[]> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.decks }),
    queryClient.invalidateQueries({ queryKey: queryKeys.motivationState }),
    queryClient.invalidateQueries({ queryKey: queryKeys.progressSummary }),
    queryClient.invalidateQueries({ queryKey: queryKeys.statsAll }),
    queryClient.invalidateQueries({ queryKey: queryKeys.undoStatus }),
    queryClient.invalidateQueries({ queryKey: queryKeys.progressHistory }),
    queryClient.invalidateQueries({ queryKey: queryKeys.studyDaysAll }),
    queryClient.invalidateQueries({ queryKey: queryKeys.progressByDeck }),
    queryClient.invalidateQueries({ queryKey: queryKeys.streakCalendarAll }),
  ]);
}
