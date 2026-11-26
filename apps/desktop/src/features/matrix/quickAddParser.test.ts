import { describe, expect, it } from "vitest";
import type { MatrixQuadrantDto, TaskListDto } from "@bibalak/ipc-types";
import { parseQuickAdd, quadrantQuickAddDefaults } from "./quickAddParser";

const taskLists: TaskListDto[] = [
  {
    id: "list-study",
    name: "Study Plan",
    color_token: "accent",
    icon_key: null,
    sort_order: 0,
  },
  {
    id: "list-admin",
    name: "Admin",
    color_token: "accent",
    icon_key: null,
    sort_order: 1,
  },
  {
    id: "list-ar",
    name: "خطة الدراسة",
    color_token: "accent",
    icon_key: null,
    sort_order: 2,
  },
  {
    id: "list-ar-admin",
    name: "إدارة",
    color_token: "accent",
    icon_key: null,
    sort_order: 3,
  },
];

// 2026-11-24 is a Tuesday
const TODAY = "2026-11-24";

describe("parseQuickAdd (PLN2)", () => {
  it("quick_add_parser_parses_en_and_ar_tokens_keeps_unknown", () => {
    const en = parseQuickAdd('Read Ch.4 !high tomorrow #pharmacology ~"Study Plan"', {
      todayDate: TODAY,
      taskLists,
    });
    expect(en.title).toBe("Read Ch.4");
    expect(en.priority).toBe("high");
    expect(en.dueDate).toBe("2026-11-25");
    expect(en.tags).toEqual(["pharmacology"]);
    expect(en.listId).toBe("list-study");
    expect(en.tokens).toHaveLength(4);

    // Arabic with tanwin ("غدًا") + ta marbuta ("!عالية") + Arabic tag + Arabic list
    const ar = parseQuickAdd('مراجعة محاضرة القلب !عالية غدًا #باطنة ~"خطة الدراسة"', {
      todayDate: TODAY,
      taskLists,
    });
    expect(ar.title).toBe("مراجعة محاضرة القلب");
    expect(ar.priority).toBe("high");
    expect(ar.dueDate).toBe("2026-11-25");
    expect(ar.tags).toEqual(["باطنة"]);
    expect(ar.listId).toBe("list-ar");

    // Unknown tokens stay verbatim in title: numeric #42, unknown ~unknown, unknown !foo, invalid 2026-02-30
    const unknown = parseQuickAdd("Fix #42 bug ~unknown !foo on 2026-02-30", {
      todayDate: TODAY,
      taskLists,
    });
    expect(unknown.title).toBe("Fix #42 bug ~unknown !foo on 2026-02-30");
    expect(unknown.priority).toBe("none");
    expect(unknown.dueDate).toBeNull();
    expect(unknown.listId).toBeNull();
    expect(unknown.tags).toEqual([]);
    expect(unknown.tokens).toHaveLength(0);
  });

  it("handles Arabic letter folding (أ/إ/آ -> ا and ة -> ه), multi-word dates, and last priority wins", () => {
    // بعد غد (+2 days), إدارة matched with ~اداره, !متوسطه -> medium, then !منخفض -> low wins
    const res = parseQuickAdd("تلخيص المحاضرة بعد غد ~اداره !متوسطه !منخفض #امتحان-1 #امتحان-1", {
      todayDate: TODAY,
      taskLists,
    });
    expect(res.title).toBe("تلخيص المحاضرة");
    expect(res.dueDate).toBe("2026-11-26");
    expect(res.listId).toBe("list-ar-admin");
    expect(res.priority).toBe("low");
    expect(res.tags).toEqual(["امتحان-1"]);

    const nextSat = parseQuickAdd("Organize notes السبت القادم ~admin", {
      todayDate: TODAY, // Tuesday Nov 24 -> Saturday is Nov 28
      taskLists,
    });
    expect(nextSat.title).toBe("Organize notes");
    expect(nextSat.dueDate).toBe("2026-11-28");
    expect(nextSat.listId).toBe("list-admin");
  });

  it("supports EN weekday names, next weekday, valid ISO dates, and all priority aliases", () => {
    const tmr = parseQuickAdd("Review notes tmr !2", { todayDate: TODAY, taskLists });
    expect(tmr.dueDate).toBe("2026-11-25");
    expect(tmr.priority).toBe("medium");

    const nextMon = parseQuickAdd("Prep seminar next mon !l 2026-12-01", {
      todayDate: TODAY,
      taskLists,
    });
    // Last valid date token or explicit ISO date wins
    expect(nextMon.dueDate).toBe("2026-12-01");
    expect(nextMon.priority).toBe("low");
    expect(nextMon.title).toBe("Prep seminar");

    const fri = parseQuickAdd("Submit form fri !0", { todayDate: TODAY, taskLists });
    // Tue Nov 24 -> Fri Nov 27
    expect(fri.dueDate).toBe("2026-11-27");
    expect(fri.priority).toBe("none");
  });

  it("restores raw token text into title when a chip is suppressed", () => {
    const first = parseQuickAdd("Read Ch.4 tomorrow !high #pharma", {
      todayDate: TODAY,
      taskLists,
    });
    const dateToken = first.tokens.find((tok) => tok.kind === "date");
    expect(dateToken).toBeDefined();

    const suppressed = parseQuickAdd("Read Ch.4 tomorrow !high #pharma", {
      todayDate: TODAY,
      taskLists,
      suppressedTokenIds: new Set([dateToken!.id]),
    });
    expect(suppressed.title).toBe("Read Ch.4 tomorrow");
    expect(suppressed.dueDate).toBeNull();
    expect(suppressed.priority).toBe("high");
    expect(suppressed.tags).toEqual(["pharma"]);
  });

  it("computes quadrant defaults for Q1/Q3 vs Q2/Q4", () => {
    const q1: MatrixQuadrantDto = {
      quadrant_key: "q1",
      title: "",
      color_token: "danger",
      group_by: "none",
      sort_by: "date",
      rule: {
        lists: { mode: "all" },
        date_filters: ["overdue", "today", "tomorrow"],
        priorities: ["high"],
        types: null,
        pinned_deck_ids: [],
        excluded_deck_ids: [],
      },
    };
    const q2: MatrixQuadrantDto = {
      quadrant_key: "q2",
      title: "",
      color_token: "warning",
      group_by: "none",
      sort_by: "date",
      rule: {
        lists: { mode: "all" },
        date_filters: null,
        priorities: ["high", "medium"],
        types: null,
        pinned_deck_ids: [],
        excluded_deck_ids: [],
      },
    };

    expect(quadrantQuickAddDefaults(q1, TODAY)).toEqual({
      defaultPriority: "high",
      defaultDueDate: TODAY,
    });
    expect(quadrantQuickAddDefaults(q2, TODAY)).toEqual({
      defaultPriority: "high",
      defaultDueDate: null,
    });
  });
});
