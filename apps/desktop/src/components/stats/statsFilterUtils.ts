export type StatsRange = "7d" | "1m" | "3m" | "1y" | "all";

export const RANGE_DAYS: Record<StatsRange, number | null> = {
  "7d": 7,
  "1m": 30,
  "3m": 90,
  "1y": 365,
  all: null,
};
