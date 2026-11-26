import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GameDepthStateDto, GamePathId } from "@bibalak/ipc-types";
import { ipc, isTauri } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { playStyleCue } from "@/lib/styleAudio";

/** Query Game depth state (pets, mounts, paths, achievements, unseen unlocks). */
export function useGameDepthState(enabled = true) {
  return useQuery({
    queryKey: queryKeys.gameDepthState,
    queryFn: ipc.getGameDepthState,
    enabled: isTauri() && enabled,
  });
}

/** Choose or switch cosmetic Path at Level 10+. */
export function useChooseGamePathMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { pathId: GamePathId; isSwitch: boolean }) => {
      const next = await ipc.chooseGamePath(input.pathId);
      return { next, isSwitch: input.isSwitch };
    },
    onSuccess: ({ next, isSwitch }) => {
      queryClient.setQueryData<GameDepthStateDto>(queryKeys.gameDepthState, next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.gameState });
      void queryClient.invalidateQueries({ queryKey: queryKeys.progressSummary });
      playStyleCue(isSwitch ? "purchase" : "unlock");
    },
  });
}

/** Activate, mount, or rest a pet in the Stable. */
export function useSetActivePetMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { petId: string | null; mounted: boolean }) =>
      ipc.setActivePet(input.petId, input.mounted),
    onSuccess: (next, variables) => {
      queryClient.setQueryData<GameDepthStateDto>(queryKeys.gameDepthState, next);
      if (variables.petId !== null) {
        playStyleCue("unlock");
      }
    },
  });
}

/** Mark unseen unlocks as acknowledged so toasts do not repeat. */
export function useAcknowledgeUnlocksMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (unlockIds: string[]) => ipc.acknowledgeUnlocks(unlockIds),
    onSuccess: (_, unlockIds) => {
      const seen = new Set(unlockIds);
      queryClient.setQueryData<GameDepthStateDto | undefined>(queryKeys.gameDepthState, (prev) =>
        prev
          ? { ...prev, unseen_unlocks: prev.unseen_unlocks.filter((u) => !seen.has(u.id)) }
          : prev,
      );
    },
  });
}
