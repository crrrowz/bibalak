import type {
  MotivationStateDto,
  StreakCalendarDayDto,
  StreakCalendarDto,
} from "@bibalak/ipc-types";

const DAY_MS = 86_400_000;
const TODAY_INDEX = 365;

function isoDateOffset(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function searchFlag(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

function isGameStyleActive(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem("keepsake-style") === "game";
  } catch {
    return false;
  }
}

interface PreviewMotivationStore {
  dailyGoalXp: number;
  todayXp: number;
  onboardingCompleted: boolean;
  comebackDismissed: boolean;
  comebackActive: boolean;
  freezeTokensHeld: number;
  frozenDays: Set<number>;
  badgeSeenMonths: Set<string>;
}

function createInitialStore(): PreviewMotivationStore {
  const incompleteGoal = searchFlag("goal") === "incomplete";
  const showOnboarding = searchFlag("onboarding") === "1";
  const showComeback = searchFlag("comeback") === "1";
  return {
    dailyGoalXp: 10,
    todayXp: incompleteGoal ? 5 : 45,
    onboardingCompleted: !showOnboarding,
    comebackDismissed: false,
    comebackActive: showComeback,
    freezeTokensHeld: 2,
    frozenDays: new Set<number>([TODAY_INDEX - 3]),
    badgeSeenMonths: new Set<string>(["2026-10"]),
  };
}

let store: PreviewMotivationStore = createInitialStore();

export function resetMotivationPreviewMocks() {
  store = createInitialStore();
}

function buildState(): MotivationStateDto {
  const todayDate = isoDateOffset(0);
  const monthKey = todayDate.slice(0, 7);
  const goalMet = store.todayXp >= store.dailyGoalXp;
  const incomplete = store.todayXp < 20;

  return {
    daily_goal_xp: store.dailyGoalXp,
    today_xp: store.todayXp,
    goal_met_today: goalMet,
    current_streak: 14,
    best_streak: 21,
    studied_today: true,
    next_milestone: 30,
    today_day_index: TODAY_INDEX,
    today_date: todayDate,
    days_remaining_in_week: 3,
    daily_quests: [
      {
        id: "reviews_15",
        kind: "daily",
        metric: "reviews",
        progress: incomplete ? 11 : 15,
        target: 15,
        completed: !incomplete,
        reward_gold_cents: 200,
      },
      {
        id: "new_5",
        kind: "daily",
        metric: "new_cards",
        progress: incomplete ? 3 : 5,
        target: 5,
        completed: !incomplete,
        reward_gold_cents: 200,
      },
      {
        id: "tasks_2",
        kind: "daily",
        metric: "tasks",
        progress: 1,
        target: 2,
        completed: false,
        reward_gold_cents: 200,
      },
    ],
    weekly_quest: {
      id: "w_reviews_150",
      kind: "weekly",
      metric: "reviews",
      progress: 92,
      target: 150,
      completed: false,
      reward_gold_cents: 1000,
    },
    monthly_badge: {
      month_key: monthKey,
      completed_daily_quests: 14,
      target_daily_quests: 20,
      earned: false,
      earned_at: null,
      seen: store.badgeSeenMonths.has(monthKey),
      reward_gold_cents: 1000,
    },
    earned_monthly_badges: [
      {
        month_key: "2026-10",
        quest_count_at_earn: 21,
        earned_at: Date.now() - 20 * DAY_MS,
        seen: store.badgeSeenMonths.has("2026-10"),
      },
    ],
    comeback_offer:
      store.comebackActive && !store.comebackDismissed && !goalMet
        ? {
            return_day: TODAY_INDEX,
            away_days: 9,
            reward_gold_cents: 500,
          }
        : null,
    onboarding_completed: store.onboardingCompleted,
    auto_frozen_day: null,
  };
}

function buildCalendar(year: number, month: number): StreakCalendarDto {
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const count = daysInMonth(year, month);
  const game = isGameStyleActive();
  const days: StreakCalendarDayDto[] = [];

  for (let dom = 1; dom <= count; dom++) {
    const cellMs = new Date(year, month - 1, dom).getTime();
    const diffDays = Math.round((cellMs - todayMidnight) / DAY_MS);
    const dayIndex = TODAY_INDEX + diffDays;
    const isFuture = diffDays > 0;
    const frozen = game && store.frozenDays.has(dayIndex);
    const studied = !isFuture && !frozen && (diffDays === 0 || Math.abs(dayIndex) % 4 !== 1);
    const xp = studied ? (Math.abs(dayIndex) % 3 === 0 ? 12 : 35) : 0;
    const goalMet = studied && xp >= store.dailyGoalXp;
    const mStr = String(month).padStart(2, "0");
    const dStr = String(dom).padStart(2, "0");
    days.push({
      day_index: dayIndex,
      date: `${year}-${mStr}-${dStr}`,
      day_of_month: dom,
      is_future: isFuture,
      studied,
      goal_met: goalMet,
      frozen,
      xp,
      reviews: studied ? 18 + (Math.abs(dayIndex) % 15) : 0,
      tasks_completed: studied && Math.abs(dayIndex) % 2 === 0 ? 1 : 0,
      habits_completed: studied && Math.abs(dayIndex) % 3 === 0 ? 1 : 0,
    });
  }

  return {
    year,
    month,
    today_day_index: TODAY_INDEX,
    today_date: isoDateOffset(0),
    daily_goal_xp: store.dailyGoalXp,
    current_streak: 14,
    best_streak: 21,
    studied_today: true,
    next_milestone: 30,
    milestones: [
      { target: 7, achieved: true },
      { target: 30, achieved: false },
      { target: 100, achieved: false },
      { target: 365, achieved: false },
    ],
    freeze_tokens_held: store.freezeTokensHeld,
    freeze_token_cap: 3,
    can_freeze_day:
      store.freezeTokensHeld > 0 && !store.frozenDays.has(TODAY_INDEX - 1) ? TODAY_INDEX - 1 : null,
    days,
  };
}

export const motivationMocks: Record<string, unknown> = {
  get_motivation_state: (): MotivationStateDto => buildState(),
  set_daily_goal: (args?: { goalXp?: number }): MotivationStateDto => {
    const g = args?.goalXp;
    if (g === 10 || g === 20 || g === 30 || g === 50) {
      store.dailyGoalXp = g;
    }
    return buildState();
  },
  get_streak_calendar: (args?: { year?: number; month?: number }): StreakCalendarDto => {
    const now = new Date();
    const year = typeof args?.year === "number" ? args.year : now.getFullYear();
    const month = typeof args?.month === "number" ? args.month : now.getMonth() + 1;
    return buildCalendar(year, month);
  },
  freeze_study_day: (args?: { dayIndex?: number }): StreakCalendarDto => {
    const dayIndex = typeof args?.dayIndex === "number" ? args.dayIndex : TODAY_INDEX - 1;
    if (!store.frozenDays.has(dayIndex) && store.freezeTokensHeld > 0) {
      store.frozenDays.add(dayIndex);
      store.freezeTokensHeld -= 1;
    }
    const now = new Date();
    return buildCalendar(now.getFullYear(), now.getMonth() + 1);
  },
  dismiss_comeback_offer: (): void => {
    store.comebackDismissed = true;
  },
  complete_onboarding: (): void => {
    store.onboardingCompleted = true;
  },
  mark_monthly_badge_seen: (args?: { monthKey?: string }): void => {
    if (typeof args?.monthKey === "string") {
      store.badgeSeenMonths.add(args.monthKey);
    }
  },
};
