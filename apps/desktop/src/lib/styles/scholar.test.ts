import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import {
  SCHOLAR_NAME_KEY,
  displayCertificateName,
  formatCurrency,
  formatPoints,
  readCertificateName,
  scholarTitle,
  scholarTitleIndex,
  writeCertificateName,
} from "./scholar";

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  setLocale("en");
});

describe("scholarTitle", () => {
  it.each([
    [1, "progress.title.student", "Student", "طالب"],
    [4, "progress.title.student", "Student", "طالب"],
    [5, "progress.title.researcher", "Researcher", "باحث"],
    [9, "progress.title.researcher", "Researcher", "باحث"],
    [10, "progress.title.lecturer", "Lecturer", "محاضر"],
    [19, "progress.title.lecturer", "Lecturer", "محاضر"],
    [20, "progress.title.assistantProfessor", "Assistant Professor", "أستاذ مساعد"],
    [34, "progress.title.assistantProfessor", "Assistant Professor", "أستاذ مساعد"],
    [35, "progress.title.professor", "Professor", "بروفيسور"],
    [100, "progress.title.professor", "Professor", "بروفيسور"],
  ] as const)("maps level %i to %s (%s / %s)", (level, key, enLabel, arLabel) => {
    expect(scholarTitle(level)).toBe(key);
    setLocale("en");
    expect(t(scholarTitle(level))).toBe(enLabel);
    setLocale("ar");
    expect(t(scholarTitle(level))).toBe(arLabel);
  });
});

describe("formatPoints", () => {
  it("formats gold_cents with at most two decimal places", () => {
    expect(formatPoints(0, "en")).toBe("0");
    expect(formatPoints(25, "en")).toBe("0.25");
    expect(formatPoints(100, "en")).toBe("1");
    expect(formatPoints(4750, "en")).toBe("47.5");
    expect(formatPoints(25, "ar")).toBe("0.25");
    expect(formatPoints(4750, "ar")).toBe("47.5");
  });
});

describe("formatCurrency", () => {
  it("uses gold in Default style and knowledge points with plural forms in Scholar style", () => {
    expect(formatCurrency(4750, "default", "en")).toBe("47.5 gold");
    expect(formatCurrency(25, "scholar", "en")).toBe("0.25 knowledge points");
    expect(formatCurrency(100, "scholar", "en")).toBe("1 knowledge point");

    setLocale("ar");
    expect(formatCurrency(4750, "default", "ar")).toBe("47.5 ذهب");
    expect(formatCurrency(25, "scholar", "ar")).toBe("0.25 نقطة معرفة");
    expect(formatCurrency(200, "scholar", "ar")).toBe("نقطتا معرفة");
    expect(formatCurrency(300, "scholar", "ar")).toBe("3 نقاط معرفة");
  });
});

describe("scholarTitleIndex & certificate name", () => {
  it("maps levels to 0-based title indices across all boundaries", () => {
    expect(scholarTitleIndex(1)).toBe(0);
    expect(scholarTitleIndex(4)).toBe(0);
    expect(scholarTitleIndex(5)).toBe(1);
    expect(scholarTitleIndex(9)).toBe(1);
    expect(scholarTitleIndex(10)).toBe(2);
    expect(scholarTitleIndex(19)).toBe(2);
    expect(scholarTitleIndex(20)).toBe(3);
    expect(scholarTitleIndex(34)).toBe(3);
    expect(scholarTitleIndex(35)).toBe(4);
  });

  it("trims, caps at 60 characters, and falls back to translated default when empty", () => {
    expect(readCertificateName()).toBe("");
    expect(displayCertificateName("en")).toBe("Bibalak learner");
    expect(displayCertificateName("ar")).toBe("متعلّم Bibalak");

    const longName = `  ${"A".repeat(75)}  `;
    const saved = writeCertificateName(longName);
    expect(saved).toBe("A".repeat(60));
    expect(localStorage.getItem(SCHOLAR_NAME_KEY)).toBe("A".repeat(60));
    expect(readCertificateName()).toBe("A".repeat(60));
    expect(displayCertificateName("en")).toBe("A".repeat(60));

    writeCertificateName("   ");
    expect(displayCertificateName("en")).toBe("Bibalak learner");
  });
});
