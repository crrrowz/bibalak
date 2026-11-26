import { useReducedMotion, type TargetAndTransition } from "framer-motion";
export { useReducedMotion };

export const ease = [0.2, 0, 0, 1] as const;
export const dur = { fast: 0.15, base: 0.22, slow: 0.3 } as const;

export const staggerList = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.01 } },
} as const;

export const listItem = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.2, 0, 0, 1] } },
} as const;

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.96, y: 4 },
  show: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.18, ease: [0.2, 0, 0, 1] } },
  exit: { opacity: 0, scale: 0.96, y: 4, transition: { duration: 0.12, ease: [0.2, 0, 0, 1] } },
} as const;

export const streakBadge = {
  hidden: { opacity: 0, y: -4, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.18, ease } },
  exit: { opacity: 0, y: -4, scale: 0.96, transition: { duration: 0.14, ease } },
} as const;

export const xpFloat: {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  stillInitial: TargetAndTransition;
  stillAnimate: TargetAndTransition;
} = {
  initial: { opacity: 0, y: 6 },
  animate: {
    opacity: [0, 1, 1, 0],
    y: [6, 0, -4, -10],
    transition: { duration: 1.0, times: [0, 0.18, 0.72, 1], ease: [0.2, 0, 0, 1] },
  },
  stillInitial: { opacity: 0 },
  stillAnimate: {
    opacity: [0, 1, 1, 0],
    transition: { duration: 1.0, times: [0, 0.15, 0.85, 1] },
  },
};

export const avatarBounce: {
  active: TargetAndTransition;
  still: TargetAndTransition;
} = {
  active: {
    y: [0, -5, 0],
    scale: [1, 1.06, 1],
    transition: { duration: 0.36, ease: [0.2, 0, 0, 1] },
  },
  still: {
    y: 0,
    scale: 1,
    transition: { duration: 0 },
  },
};

export const petHop = {
  keyframes: [
    { transform: "translateY(0)" },
    { transform: "translateY(-4px)" },
    { transform: "translateY(0)" },
  ] as Keyframe[],
  options: { duration: 360, easing: "cubic-bezier(0.2, 0, 0, 1)" } as KeyframeAnimationOptions,
};
