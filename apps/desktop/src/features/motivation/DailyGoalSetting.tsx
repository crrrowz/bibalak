import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/lib/i18n";
import { isTauri } from "@/lib/ipc";
import { handleRadioGroupKeyDown } from "@/lib/radioGroupKeys";
import { useStyle } from "@/stores/style";
import {
  DAILY_GOAL_XP_CHOICES,
  type DailyGoalChoice,
  useMotivationState,
  useSetDailyGoal,
} from "./useMotivation";

const GOAL_HINT_KEY: Record<
  DailyGoalChoice,
  | "motivation.onboarding.goalHint.10"
  | "motivation.onboarding.goalHint.20"
  | "motivation.onboarding.goalHint.30"
  | "motivation.onboarding.goalHint.50"
> = {
  10: "motivation.onboarding.goalHint.10",
  20: "motivation.onboarding.goalHint.20",
  30: "motivation.onboarding.goalHint.30",
  50: "motivation.onboarding.goalHint.50",
};

/**
 * Daily XP goal selector (`10 / 20 / 30 / 50 XP`) mounted in Settings -> Study.
 * Updates the synced daily goal immediately without revoking earned rewards.
 */
export function DailyGoalSetting() {
  const tauri = isTauri();
  const style = useStyle((s) => s.style);
  const { data: state } = useMotivationState();
  const setGoalMut = useSetDailyGoal();

  if (!tauri) return null;

  const labelKey =
    style === "game"
      ? "motivation.goal.label.game"
      : style === "scholar"
        ? "motivation.goal.label.scholar"
        : "motivation.goal.label.default";

  const currentGoal: DailyGoalChoice =
    state?.daily_goal_xp === 10 ||
    state?.daily_goal_xp === 20 ||
    state?.daily_goal_xp === 30 ||
    state?.daily_goal_xp === 50
      ? state.daily_goal_xp
      : 20;

  return (
    <div className="border-t border-border/60 pt-4 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{t(labelKey)}</span>
        {state && (
          <span className="tnum text-xs font-medium text-foreground">
            {t("motivation.goal.progress", {
              earned: formatNumber(state.today_xp),
              goal: formatNumber(state.daily_goal_xp),
            })}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t(labelKey)}>
        {DAILY_GOAL_XP_CHOICES.map((choice, idx) => {
          const checked = currentGoal === choice;
          return (
            <Button
              key={choice}
              type="button"
              variant={checked ? "default" : "outline"}
              size="sm"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={setGoalMut.isPending}
              onClick={() => setGoalMut.mutate(choice)}
              onKeyDown={(e) =>
                handleRadioGroupKeyDown(e, DAILY_GOAL_XP_CHOICES, idx, (next) =>
                  setGoalMut.mutate(next),
                )
              }
            >
              {t("motivation.goal.option", { xp: formatNumber(choice) })}
            </Button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">{t(GOAL_HINT_KEY[currentGoal])}</p>
    </div>
  );
}
