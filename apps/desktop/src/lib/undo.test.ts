import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { formatUndoAction } from "@/lib/undo";

describe("formatUndoAction", () => {
  it("formats all variants in English and Arabic", () => {
    try {
      setLocale("en");
      expect(formatUndoAction({ kind: "answer-card" })).toBe("Answer card");
      expect(formatUndoAction({ kind: "create-deck", name: "Math" })).toBe('Create deck "Math"');
      expect(formatUndoAction({ kind: "rename-deck", name: "Bio" })).toBe('Rename deck to "Bio"');
      expect(formatUndoAction({ kind: "delete-deck", name: "Chem" })).toBe('Delete deck "Chem"');

      setLocale("ar");
      expect(formatUndoAction({ kind: "answer-card" })).toBe("الإجابة عن بطاقة");
      expect(formatUndoAction({ kind: "create-deck", name: "Math" })).toBe('إنشاء المجموعة "Math"');
      expect(formatUndoAction({ kind: "rename-deck", name: "Bio" })).toBe(
        'إعادة تسمية المجموعة إلى "Bio"',
      );
      expect(formatUndoAction({ kind: "delete-deck", name: "Chem" })).toBe('حذف المجموعة "Chem"');
    } finally {
      setLocale("en");
    }
  });

  it("M1: formats all seven productivity undo variants in English and Arabic", () => {
    try {
      setLocale("en");
      expect(formatUndoAction({ kind: "complete-task", title: "Essay" })).toBe(
        'Complete task "Essay"',
      );
      expect(formatUndoAction({ kind: "reopen-task", title: "Essay" })).toBe('Reopen task "Essay"');
      expect(formatUndoAction({ kind: "delete-task", title: "Essay" })).toBe('Delete task "Essay"');
      expect(formatUndoAction({ kind: "delete-task-list", name: "Uni" })).toBe(
        'Delete task list "Uni"',
      );
      expect(formatUndoAction({ kind: "log-habit", title: "Read" })).toBe('Log habit "Read"');
      expect(formatUndoAction({ kind: "delete-habit", title: "Read" })).toBe('Delete habit "Read"');
      expect(formatUndoAction({ kind: "delete-calendar-event", title: "Exam" })).toBe(
        'Delete calendar event "Exam"',
      );

      setLocale("ar");
      expect(formatUndoAction({ kind: "complete-task", title: "Essay" })).toBe(
        'إكمال المهمة "Essay"',
      );
      expect(formatUndoAction({ kind: "reopen-task", title: "Essay" })).toBe(
        'إعادة فتح المهمة "Essay"',
      );
      expect(formatUndoAction({ kind: "delete-task", title: "Essay" })).toBe('حذف المهمة "Essay"');
      expect(formatUndoAction({ kind: "delete-task-list", name: "Uni" })).toBe(
        'حذف قائمة المهام "Uni"',
      );
      expect(formatUndoAction({ kind: "log-habit", title: "Read" })).toBe('تسجيل العادة "Read"');
      expect(formatUndoAction({ kind: "delete-habit", title: "Read" })).toBe('حذف العادة "Read"');
      expect(formatUndoAction({ kind: "delete-calendar-event", title: "Exam" })).toBe(
        'حذف حدث التقويم "Exam"',
      );
    } finally {
      setLocale("en");
    }
  });
});
