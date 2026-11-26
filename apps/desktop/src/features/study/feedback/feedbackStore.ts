import { create } from "zustand";
import { formatNumber, t, tn } from "@/lib/i18n";
import type { Style } from "@/stores/style";

export const IN_A_ROW_THRESHOLDS = new Set([3, 5, 10, 20]);
export const IN_A_ROW_DURATION_MS = 1500;

export function formatInARowLabel(count: number, style: Style): string {
  const formatted = formatNumber(count);
  if (style === "game") {
    return t("study.feedback.streak.game", { count: formatted });
  }
  if (style === "scholar") {
    return tn("study.feedback.streak.scholar", count, { count: formatted });
  }
  return t("study.feedback.streak.default", { count: formatted });
}

export type AvatarReactionKind = "streak" | "levelUp";

interface StudyFeedbackState {
  reactionNonce: number;
  reactionKind: AvatarReactionKind | null;
  triggerAvatarReaction: (kind: AvatarReactionKind) => void;
}

/**
 * Ephemeral UI-only store linking study-session streak milestones to the
 * shared StyleHud avatar/pet reaction without adding persistent state.
 */
export const useStudyFeedbackStore = create<StudyFeedbackState>((set) => ({
  reactionNonce: 0,
  reactionKind: null,
  triggerAvatarReaction: (kind) =>
    set((s) => ({
      reactionNonce: s.reactionNonce + 1,
      reactionKind: kind,
    })),
}));
