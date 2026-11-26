import { QueryClientContext } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Layers, Sparkles } from "lucide-react";
import { useContext, useEffect, useId, useState } from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatNumber, LOCALE_NAMES, setLocale, t, useLocale, type Locale } from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/queryKeys";
import { handleRadioGroupKeyDown } from "@/lib/radioGroupKeys";
import { cn } from "@/lib/utils";
import type { LocaleKey } from "@/locales/en";
import { useStyle, type Style } from "@/stores/style";
import {
  DAILY_GOAL_OPTIONS,
  useOnboardingDraft,
  type DailyGoalXp,
  type OnboardingStep,
} from "./onboardingDraft";
import { StylePreview } from "./StylePreview";

const TOTAL_STEPS = 4;
const LOCALE_OPTIONS: readonly Locale[] = ["en", "ar"];
const STYLE_OPTIONS: readonly Style[] = ["default", "scholar", "game"];
const STARTER_OPTIONS: readonly boolean[] = [true, false];

const STEP_TITLE_KEYS: Record<OnboardingStep, LocaleKey> = {
  0: "motivation.onboarding.langTitle",
  1: "motivation.onboarding.styleTitle",
  2: "motivation.onboarding.goalTitle",
  3: "motivation.onboarding.deckTitle",
};

const STYLE_META: Record<Style, { labelKey: LocaleKey; descKey: LocaleKey }> = {
  default: {
    labelKey: "settings.style.default",
    descKey: "motivation.onboarding.styleDefaultDesc",
  },
  scholar: {
    labelKey: "settings.style.scholar",
    descKey: "motivation.onboarding.styleScholarDesc",
  },
  game: {
    labelKey: "settings.style.game",
    descKey: "motivation.onboarding.styleGameDesc",
  },
};

const GOAL_HINT_KEYS: Record<DailyGoalXp, LocaleKey> = {
  10: "motivation.onboarding.goalHint.10",
  20: "motivation.onboarding.goalHint.20",
  30: "motivation.onboarding.goalHint.30",
  50: "motivation.onboarding.goalHint.50",
};

function RadioIndicator({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors motion-reduce:transition-none",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/40 bg-background",
      )}
    >
      {checked && <Check className="size-3" />}
    </span>
  );
}

const radioCardClass = (checked: boolean) =>
  cn(
    "flex w-full items-start justify-between gap-3 rounded-xl border p-3.5 text-start transition-colors motion-reduce:transition-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    checked
      ? "border-primary bg-primary/5 ring-1 ring-primary"
      : "border-border bg-background hover:bg-accent/50",
  );

/**
 * Four-step first-run setup dialog for new collections:
 * 1) Language (switches immediately),
 * 2) Presentation style (Default, Scholar, Game with visual previews),
 * 3) Daily XP goal (10/20/30/50, default 20),
 * 4) Starter deck yes/no, then finish.
 */
export function OnboardingModal() {
  const headingId = useId();
  const queryClient = useContext(QueryClientContext);
  const locale = useLocale((s) => s.locale);
  const style = useStyle((s) => s.style);
  const setStyle = useStyle((s) => s.setStyle);

  const step = useOnboardingDraft((s) => s.step);
  const goalXp = useOnboardingDraft((s) => s.goalXp);
  const createStarter = useOnboardingDraft((s) => s.createStarter);
  const refocusLangRadio = useOnboardingDraft((s) => s.refocusLangRadio);
  const setStep = useOnboardingDraft((s) => s.setStep);
  const setGoalXp = useOnboardingDraft((s) => s.setGoalXp);
  const setCreateStarter = useOnboardingDraft((s) => s.setCreateStarter);
  const setRefocusLangRadio = useOnboardingDraft((s) => s.setRefocusLangRadio);
  const resetDraft = useOnboardingDraft((s) => s.reset);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 0 || !refocusLangRadio) return;
    const radio = document.querySelector<HTMLElement>(
      `[data-onboarding-lang="${refocusLangRadio}"]`,
    );
    radio?.focus();
    setRefocusLangRadio(null);
  }, [step, refocusLangRadio, setRefocusLangRadio]);

  function handleSelectLocale(next: Locale) {
    if (next === locale) return;
    setRefocusLangRadio(next);
    setLocale(next);
  }

  async function handleSkip() {
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await ipc.completeOnboarding(true, false, locale);
      if (queryClient) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.motivationState });
      }
      resetDraft();
    } catch {
      setError(t("motivation.onboarding.saveError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleFinish() {
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await ipc.setDailyGoal(goalXp);
      await ipc.completeOnboarding(false, createStarter, locale);
      if (queryClient) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.motivationState }),
          queryClient.invalidateQueries({ queryKey: queryKeys.decks }),
        ]);
      }
      resetDraft();
    } catch {
      setError(t("motivation.onboarding.saveError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  function goBack() {
    if (step > 0 && !isSubmitting) {
      setError(null);
      setStep((step - 1) as OnboardingStep);
    }
  }

  function goNext() {
    if (step < 3 && !isSubmitting) {
      setError(null);
      setStep((step + 1) as OnboardingStep);
    }
  }

  return (
    <Dialog
      open={true}
      onClose={() => void handleSkip()}
      ariaLabelledBy={headingId}
      closeOnEscape={!isSubmitting}
      closeOnBackdrop={false}
      animation="fade"
      className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto p-4 sm:p-6"
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Logo size={20} showWordmark={false} />
            <span className="text-xs font-medium text-muted-foreground tabular-nums">
              {t("motivation.onboarding.stepOf", {
                step: formatNumber(step + 1),
                total: formatNumber(TOTAL_STEPS),
              })}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="onboarding-skip"
            disabled={isSubmitting}
            onClick={() => void handleSkip()}
          >
            {t("motivation.onboarding.skip")}
          </Button>
        </div>

        <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
          {Array.from({ length: TOTAL_STEPS }, (_, idx) => (
            <div
              key={idx}
              className={cn(
                "h-1.5 rounded-full transition-colors motion-reduce:transition-none",
                idx <= step ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>

        <div className="space-y-3">
          <h2 id={headingId} className="text-lg font-semibold text-foreground">
            {t(STEP_TITLE_KEYS[step])}
          </h2>

          {step === 0 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{t("settings.language.description")}</p>
              <div
                role="radiogroup"
                aria-labelledby={headingId}
                className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
              >
                {LOCALE_OPTIONS.map((option, idx) => {
                  const checked = locale === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      lang={option}
                      data-onboarding-lang={option}
                      role="radio"
                      aria-checked={checked}
                      tabIndex={checked ? 0 : -1}
                      disabled={isSubmitting}
                      className={radioCardClass(checked)}
                      onClick={() => handleSelectLocale(option)}
                      onKeyDown={(e) =>
                        handleRadioGroupKeyDown(e, LOCALE_OPTIONS, idx, handleSelectLocale)
                      }
                    >
                      <span className="text-sm font-medium text-foreground">
                        {LOCALE_NAMES[option]}
                      </span>
                      <RadioIndicator checked={checked} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 1 && (
            <div
              role="radiogroup"
              aria-labelledby={headingId}
              className="grid grid-cols-1 gap-2.5 sm:grid-cols-3"
            >
              {STYLE_OPTIONS.map((option, idx) => {
                const checked = style === option;
                const meta = STYLE_META[option];
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    tabIndex={checked ? 0 : -1}
                    disabled={isSubmitting}
                    className={cn(
                      radioCardClass(checked),
                      "flex-col items-stretch justify-start gap-2.5 p-3",
                    )}
                    onClick={() => setStyle(option)}
                    onKeyDown={(e) => handleRadioGroupKeyDown(e, STYLE_OPTIONS, idx, setStyle)}
                  >
                    <StylePreview style={option} />
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <div className="text-sm font-medium text-foreground">
                          {t(meta.labelKey)}
                        </div>
                        <div className="text-xs leading-snug text-muted-foreground">
                          {t(meta.descKey)}
                        </div>
                      </div>
                      <RadioIndicator checked={checked} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {step === 2 && (
            <div
              role="radiogroup"
              aria-labelledby={headingId}
              className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
            >
              {DAILY_GOAL_OPTIONS.map((goal, idx) => {
                const checked = goalXp === goal;
                return (
                  <button
                    key={goal}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    tabIndex={checked ? 0 : -1}
                    disabled={isSubmitting}
                    className={radioCardClass(checked)}
                    onClick={() => setGoalXp(goal)}
                    onKeyDown={(e) =>
                      handleRadioGroupKeyDown(e, DAILY_GOAL_OPTIONS, idx, setGoalXp)
                    }
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-sm font-medium text-foreground tabular-nums">
                        {t("motivation.goal.option", { xp: formatNumber(goal) })}
                      </div>
                      <div className="text-xs text-muted-foreground">{t(GOAL_HINT_KEYS[goal])}</div>
                    </div>
                    <RadioIndicator checked={checked} />
                  </button>
                );
              })}
            </div>
          )}

          {step === 3 && (
            <div
              role="radiogroup"
              aria-labelledby={headingId}
              className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
            >
              {STARTER_OPTIONS.map((option, idx) => {
                const checked = createStarter === option;
                const Icon = option ? Sparkles : Layers;
                return (
                  <button
                    key={String(option)}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    tabIndex={checked ? 0 : -1}
                    disabled={isSubmitting}
                    className={radioCardClass(checked)}
                    onClick={() => setCreateStarter(option)}
                    onKeyDown={(e) =>
                      handleRadioGroupKeyDown(e, STARTER_OPTIONS, idx, setCreateStarter)
                    }
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon
                        className={cn(
                          "size-4 shrink-0",
                          option ? "text-primary" : "text-muted-foreground",
                        )}
                        aria-hidden="true"
                      />
                      <span className="text-sm font-medium text-foreground">
                        {t(
                          option
                            ? "motivation.onboarding.createStarter"
                            : "motivation.onboarding.startEmpty",
                        )}
                      </span>
                    </div>
                    <RadioIndicator checked={checked} />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {step > 0 ? (
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={goBack}>
              <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
              <span>{t("motivation.onboarding.back")}</span>
            </Button>
          ) : (
            <span aria-hidden="true" />
          )}

          {step < 3 ? (
            <Button type="button" disabled={isSubmitting} onClick={goNext}>
              <span>{t("motivation.onboarding.next")}</span>
              <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
            </Button>
          ) : (
            <Button type="button" disabled={isSubmitting} onClick={() => void handleFinish()}>
              {isSubmitting ? t("common.saving") : t("motivation.onboarding.finish")}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
