import { create } from "zustand";
import type { Locale } from "@/lib/i18n";

export const DAILY_GOAL_OPTIONS = [10, 20, 30, 50] as const;
export type DailyGoalXp = (typeof DAILY_GOAL_OPTIONS)[number];
export type OnboardingStep = 0 | 1 | 2 | 3;

interface OnboardingDraftState {
  step: OnboardingStep;
  goalXp: DailyGoalXp;
  createStarter: boolean;
  /** Preserves keyboard focus on the selected language radio across App.tsx's locale-keyed remount. */
  refocusLangRadio: Locale | null;
  setStep: (step: OnboardingStep) => void;
  setGoalXp: (goalXp: DailyGoalXp) => void;
  setCreateStarter: (createStarter: boolean) => void;
  setRefocusLangRadio: (locale: Locale | null) => void;
  reset: () => void;
}

const INITIAL_DRAFT = {
  step: 0 as OnboardingStep,
  goalXp: 20 as DailyGoalXp,
  createStarter: true,
  refocusLangRadio: null as Locale | null,
};

export const useOnboardingDraft = create<OnboardingDraftState>((set) => ({
  ...INITIAL_DRAFT,
  setStep: (step) => set({ step }),
  setGoalXp: (goalXp) => set({ goalXp }),
  setCreateStarter: (createStarter) => set({ createStarter }),
  setRefocusLangRadio: (refocusLangRadio) => set({ refocusLangRadio }),
  reset: () => set(INITIAL_DRAFT),
}));
