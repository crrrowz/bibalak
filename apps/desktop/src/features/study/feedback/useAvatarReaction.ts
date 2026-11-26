import { useEffect, useRef, useState } from "react";
import { petHop } from "@/lib/motion";
import { useStudyFeedbackStore } from "./feedbackStore";

export interface UseAvatarReactionOptions {
  level: number | null;
  hasPet: boolean;
  reducedMotion: boolean;
}

const REACTION_DURATION_MS = 400;

/**
 * Triggers a short happy bounce on the HUD avatar (and hop on the active pet)
 * on in-session streak milestones or level-up. Stays still under reduced motion.
 */
export function useAvatarReaction({ level, hasPet, reducedMotion }: UseAvatarReactionOptions) {
  const stageRef = useRef<HTMLDivElement>(null);
  const prevLevelRef = useRef<number | null>(null);
  const reactionNonce = useStudyFeedbackStore((s) => s.reactionNonce);
  const prevNonceRef = useRef<number>(reactionNonce);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [reacting, setReacting] = useState(false);

  const trigger = () => {
    clearTimeout(timerRef.current);
    setReacting(true);
    if (!reducedMotion && hasPet) {
      const petEl = stageRef.current?.querySelector<SVGElement>(
        '[data-layer="pet"], [data-layer="mount"]',
      );
      petEl?.animate?.(petHop.keyframes, petHop.options);
    }
    timerRef.current = setTimeout(() => setReacting(false), REACTION_DURATION_MS);
  };

  useEffect(() => {
    if (level === null) {
      prevLevelRef.current = null;
      return;
    }
    const prev = prevLevelRef.current;
    prevLevelRef.current = level;
    if (prev !== null && level > prev) {
      trigger();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  useEffect(() => {
    if (reactionNonce !== prevNonceRef.current) {
      prevNonceRef.current = reactionNonce;
      trigger();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactionNonce]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return {
    stageRef,
    reacting: reacting && !reducedMotion,
    petHopping: reacting && hasPet && !reducedMotion,
    still: reacting && reducedMotion,
  };
}
