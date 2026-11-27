import type { ReactNode } from "react";
import { create } from "zustand";
import type { Locale } from "@/lib/i18n";
import type { LocaleKey } from "@/locales/en";
import type { Style } from "@/stores/style";

export const DAILY_GOAL_OPTIONS = [10, 20, 30, 50] as const;
export type DailyGoalXp = (typeof DAILY_GOAL_OPTIONS)[number];
export type OnboardingStep = number;

export interface OnboardingStepContext {
  locale: Locale;
  style: Style;
  goalXp: DailyGoalXp;
  createStarter: boolean;
  isSubmitting: boolean;
  headingId: string;
  handleSelectLocale: (next: Locale) => void;
  setStyle: (style: Style) => void;
  setGoalXp: (goal: DailyGoalXp) => void;
  setCreateStarter: (createStarter: boolean) => void;
}

export interface OnboardingStepDef {
  id: string;
  titleKey: LocaleKey;
  render: (ctx: OnboardingStepContext) => ReactNode;
  isValid: (ctx: OnboardingStepContext) => boolean;
  apply?: (ctx: OnboardingStepContext) => Promise<void> | void;
}

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
  goalXp: 10 as DailyGoalXp,
  createStarter: false,
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
