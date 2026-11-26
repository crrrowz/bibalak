import type { DayCount } from "@bibalak/ipc-types";

/** Current + longest consecutive-day streaks, counting back from `today` (collection-relative day). */
export function computeStreaks(
  reviews: DayCount[],
  today: number,
): { current: number; longest: number } {
  const days = new Set(reviews.filter((d) => d.count > 0).map((d) => d.day));

  let current = 0;
  // A streak is "alive" if today or yesterday was studied (allows for not-yet-studied-today).
  let cursor = days.has(today) ? today : today - 1;
  while (days.has(cursor)) {
    current++;
    cursor--;
  }

  let longest = 0;
  let run = 0;
  const sorted = [...days].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] === sorted[i - 1] + 1) {
      run++;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
  }

  return { current, longest };
}
