import type { UndoAction } from "@bibalak/ipc-types";
import { t, tn } from "@/lib/i18n";

export function formatUndoAction(action: UndoAction): string {
  switch (action.kind) {
    case "answer-card":
      return t("undo.action.answerCard");
    case "create-deck":
      return t("undo.action.createDeck", { name: action.name });
    case "rename-deck":
      return t("undo.action.renameDeck", { name: action.name });
    case "delete-deck":
      return t("undo.action.deleteDeck", { name: action.name });
    case "forget-cards":
      return tn("undo.action.forgetCards", action.count);
    case "set-due-date":
      return tn("undo.action.setDueDate", action.count);
    case "reposition-cards":
      return tn("undo.action.repositionCards", action.count);
    case "suspend-cards":
      return tn("undo.action.suspendCards", action.count);
    case "unsuspend-cards":
      return tn("undo.action.unsuspendCards", action.count);
    case "bury-cards":
      return tn("undo.action.buryCards", action.count);
    case "unbury-cards":
      return tn("undo.action.unburyCards", action.count);
    case "move-cards":
      return tn("undo.action.moveCards", action.count);
    case "set-card-flag":
      return tn("undo.action.setCardFlag", action.count);
    case "change-deck-options":
      return t("undo.action.changeDeckOptions");
    case "increase-today-limit":
      return t("undo.action.increaseTodayLimit");
    case "find-replace":
      return tn("undo.action.findReplace", action.count);
    case "change-note-type":
      return tn("undo.action.changeNoteType", action.count);
    case "add-note":
      return tn("undo.action.addNote", action.count);
    case "edit-note":
      return t("undo.action.editNote");
    case "quality-fixes":
      return tn("undo.action.qualityFixes", action.count);
    case "complete-task":
      return t("undo.action.completeTask", { title: action.title });
    case "reopen-task":
      return t("undo.action.reopenTask", { title: action.title });
    case "delete-task":
      return t("undo.action.deleteTask", { title: action.title });
    case "delete-task-list":
      return t("undo.action.deleteTaskList", { name: action.name });
    case "log-habit":
      return t("undo.action.logHabit", { title: action.title });
    case "delete-habit":
      return t("undo.action.deleteHabit", { title: action.title });
    case "delete-calendar-event":
      return t("undo.action.deleteCalendarEvent", { title: action.title });
  }
}
