import { useQuery } from "@tanstack/react-query";
import { ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";

/** Read-only query for Game state (avatar profile, equipment, gold, freezes, streak). */
export function useGameState(enabled = true) {
  return useQuery({
    queryKey: queryKeys.gameState,
    queryFn: ipc.getGameState,
    enabled: isTauri() && enabled,
  });
}
