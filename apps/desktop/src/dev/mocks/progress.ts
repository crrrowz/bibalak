import type {
  DeckProgress,
  ProgressDay,
  ProgressSummaryDto,
  StudyDay,
  YesterdaySummaryDto,
} from "@bibalak/ipc-types";

export const mockProgressDefault: ProgressSummaryDto = {
  level: 4,
  xp_into_level: 120,
  xp_to_next_level: 250,
  total_xp: 570,
  gold_cents: 4750,
  today_xp: 45,
  today_gold_cents: 375,
  tasks_rewarded_today: 2,
  task_reward_daily_cap: 10,
};

export const mockProgressScholar: ProgressSummaryDto = {
  level: 5,
  xp_into_level: 80,
  xp_to_next_level: 300,
  total_xp: 780,
  gold_cents: 4750,
  today_xp: 45,
  today_gold_cents: 375,
  tasks_rewarded_today: 2,
  task_reward_daily_cap: 10,
};

function recentIsoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const mockProgressHistoryDefault: ProgressDay[] = [
  {
    day: 356,
    date: recentIsoDate(9),
    xp: 120,
    gold_cents: 1000,
    cumulative_xp: 120,
    level_after: 2,
  },
  {
    day: 359,
    date: recentIsoDate(6),
    xp: 160,
    gold_cents: 1250,
    cumulative_xp: 280,
    level_after: 3,
  },
  {
    day: 362,
    date: recentIsoDate(3),
    xp: 185,
    gold_cents: 1500,
    cumulative_xp: 465,
    level_after: 4,
  },
  {
    day: 365,
    date: recentIsoDate(0),
    xp: 105,
    gold_cents: 1000,
    cumulative_xp: 570,
    level_after: 4,
  },
];

export const mockProgressHistoryScholar: ProgressDay[] = [
  {
    day: 354,
    date: recentIsoDate(11),
    xp: 120,
    gold_cents: 750,
    cumulative_xp: 120,
    level_after: 2,
  },
  {
    day: 357,
    date: recentIsoDate(8),
    xp: 180,
    gold_cents: 1000,
    cumulative_xp: 300,
    level_after: 3,
  },
  {
    day: 360,
    date: recentIsoDate(5),
    xp: 200,
    gold_cents: 1250,
    cumulative_xp: 500,
    level_after: 4,
  },
  {
    day: 363,
    date: recentIsoDate(2),
    xp: 235,
    gold_cents: 1375,
    cumulative_xp: 735,
    level_after: 5,
  },
  { day: 365, date: recentIsoDate(0), xp: 45, gold_cents: 375, cumulative_xp: 780, level_after: 5 },
];

export const mockProgressByDeckScholar: DeckProgress[] = [
  {
    deck_id: 2,
    name: "Classical Music Themes",
    total_cards: 1350,
    mature_pct: 48,
    retention_pct: 89,
    xp: 460,
    gold_cents: 2750,
    last_studied_date: recentIsoDate(0),
  },
  {
    deck_id: 1,
    name: "Default",
    total_cards: 85,
    mature_pct: 62,
    retention_pct: 94,
    xp: 60,
    gold_cents: 500,
    last_studied_date: recentIsoDate(5),
  },
  {
    deck_id: 4,
    name: "Spanish",
    total_cards: 420,
    mature_pct: 35,
    retention_pct: 91,
    xp: 260,
    gold_cents: 1500,
    last_studied_date: recentIsoDate(1),
  },
];

export const mockStudyDaysScholar: StudyDay[] = [
  {
    day: 365,
    date: recentIsoDate(0),
    reviews: 15,
    minutes: 6.4,
    deck_ids: [2],
    xp: 45,
    gold_cents: 375,
    tasks_completed: 2,
    habits_completed: 1,
  },
  {
    day: 364,
    date: recentIsoDate(1),
    reviews: 32,
    minutes: 14.2,
    deck_ids: [2, 4],
    xp: 90,
    gold_cents: 800,
    tasks_completed: 3,
    habits_completed: 2,
  },
  {
    day: 363,
    date: recentIsoDate(2),
    reviews: 54,
    minutes: 22.8,
    deck_ids: [2, 4],
    xp: 145,
    gold_cents: 1350,
    tasks_completed: 1,
    habits_completed: 2,
  },
  {
    day: 360,
    date: recentIsoDate(5),
    reviews: 68,
    minutes: 28.5,
    deck_ids: [1, 2, 4],
    xp: 200,
    gold_cents: 1700,
    tasks_completed: 2,
    habits_completed: 1,
  },
  {
    day: 357,
    date: recentIsoDate(8),
    reviews: 60,
    minutes: 24.0,
    deck_ids: [2, 4],
    xp: 180,
    gold_cents: 1500,
    tasks_completed: 1,
    habits_completed: 1,
  },
  {
    day: 354,
    date: recentIsoDate(11),
    reviews: 41,
    minutes: 16.5,
    deck_ids: [2],
    xp: 120,
    gold_cents: 1025,
    tasks_completed: 0,
    habits_completed: 1,
  },
];

function isScholarPreset(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const styleParam = params.get("style");
  const progressParam = params.get("progress");
  const levelParam = params.get("level");
  if (styleParam === "scholar" || progressParam === "scholar" || levelParam === "5") {
    return true;
  }
  try {
    return !styleParam && localStorage.getItem("keepsake-style") === "scholar";
  } catch {
    return false;
  }
}

let yesterdayDismissedDay = 0;

export const mockYesterdaySummary: YesterdaySummaryDto = {
  day: 364,
  date: recentIsoDate(1),
  reviews: 32,
  tasks_completed: 3,
  habits_completed: 2,
  xp: 140,
  gold_cents: 1300,
};

export const progressMocks: Record<string, unknown> = {
  progress_summary: (): ProgressSummaryDto =>
    isScholarPreset() ? mockProgressScholar : mockProgressDefault,
  progress_history: (): ProgressDay[] =>
    isScholarPreset() ? mockProgressHistoryScholar : mockProgressHistoryDefault,
  study_days: (args?: { limit?: number | null }): StudyDay[] => {
    const limit = typeof args?.limit === "number" ? Math.max(0, Math.min(365, args.limit)) : 30;
    return mockStudyDaysScholar.slice(0, limit);
  },
  progress_by_deck: (): DeckProgress[] => mockProgressByDeckScholar,
  yesterday_summary: (): YesterdaySummaryDto | null =>
    yesterdayDismissedDay >= 365 ? null : mockYesterdaySummary,
  dismiss_yesterday_summary: (args?: { day?: number }): void => {
    if (typeof args?.day === "number") {
      yesterdayDismissedDay = Math.max(yesterdayDismissedDay, args.day);
    }
  },
};
