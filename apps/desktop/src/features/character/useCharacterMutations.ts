import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AvatarProfileInput, EquipmentSlot, GameStateDto } from "@bibalak/ipc-types";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";

/** Save free avatar appearance edits immediately with optimistic cache update. */
export function useUpdateAvatarProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AvatarProfileInput) => ipc.updateAvatarProfile(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.gameState });
      const previous = queryClient.getQueryData<GameStateDto>(queryKeys.gameState);
      if (previous) {
        queryClient.setQueryData<GameStateDto>(queryKeys.gameState, {
          ...previous,
          avatar: { ...input },
        });
      }
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData<GameStateDto>(queryKeys.gameState, context.previous);
      }
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<GameStateDto | undefined>(queryKeys.gameState, (prev) =>
        prev ? { ...prev, avatar: saved } : prev,
      );
    },
  });
}

/** Equip an owned cosmetic item in a slot. */
export function useEquipGameItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { slot: EquipmentSlot; itemKey: string }) =>
      ipc.equipGameItem(input.slot, input.itemKey),
    onSuccess: (next) => {
      queryClient.setQueryData<GameStateDto>(queryKeys.gameState, next);
    },
  });
}

/** Unequip an equipment slot. */
export function useUnequipGameSlotMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slot: EquipmentSlot) => ipc.unequipGameSlot(slot),
    onSuccess: (next) => {
      queryClient.setQueryData<GameStateDto>(queryKeys.gameState, next);
    },
  });
}
