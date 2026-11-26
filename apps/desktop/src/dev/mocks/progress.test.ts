import { describe, expect, it } from "vitest";
import { mockStudyDaysScholar } from "./progress";

describe("progress preview mocks (Z1a)", () => {
  it("keeps lecture-log rows consistent with the reward rule (25 gold_cents/review, XP 1x..3x)", () => {
    expect(mockStudyDaysScholar.length).toBeGreaterThan(0);
    for (const row of mockStudyDaysScholar) {
      expect(row.gold_cents).toBe(row.reviews * 25);
      expect(row.xp).toBeGreaterThanOrEqual(row.reviews);
      expect(row.xp).toBeLessThanOrEqual(row.reviews * 3);
    }
  });
});
