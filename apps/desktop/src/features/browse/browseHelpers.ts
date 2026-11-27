import { formatDate, formatNumber, t, tn } from "@/lib/i18n";
import type { LocaleKey } from "@/locales/en";
import type { CardRow } from "@bibalak/ipc-types";
import { decodeEntities, stripTags } from "@/lib/htmlText";

export type SortKey = string;

export const QUEUE_LABELS: Record<number, { text: LocaleKey; cls: string }> = {
  "-3": { text: "browse.queue.sibling", cls: "text-muted-foreground" },
  "-2": { text: "browse.queue.buried", cls: "text-amber-600 dark:text-amber-400" },
  "-1": { text: "browse.queue.suspended", cls: "text-red-500" },
  0: { text: "browse.queue.new", cls: "text-blue-600 dark:text-blue-400" },
  1: { text: "browse.queue.learn", cls: "text-amber-600 dark:text-amber-400" },
  2: { text: "browse.queue.review", cls: "text-green-600 dark:text-green-400" },
  3: { text: "browse.queue.learn", cls: "text-amber-600 dark:text-amber-400" },
};

export const FLAG_COLORS: Record<number, string> = {
  0: "text-muted-foreground",
  1: "text-red-500",
  2: "text-orange-500",
  3: "text-green-500",
  4: "text-blue-500",
  5: "text-pink-500",
  6: "text-teal-500",
  7: "text-purple-500",
};

/** Strips HTML tags, cloze markers, and common HTML entities for table sorting/preview. */
export function plain(html: string): string {
  const text = stripTags(html).replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, "$1");
  return decodeEntities(text).trim();
}

export function isEditingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable ||
    target.closest(".tiptap") !== null ||
    target.closest("[contenteditable='true']") !== null
  );
}

export function formatDue(row: CardRow, today: number): string {
  const isNew = row.card_type === 0 || (row.queue === 0 && row.due < 1000000);
  const isLearning = row.card_type === 1 || row.card_type === 3 || row.due > 10000000000;

  if (isNew) {
    return `#${formatNumber(row.due)}`;
  }

  if (isLearning) {
    if (row.due <= 0) return t("browse.queue.learn");
    return formatDate(row.due, { hour: "2-digit", minute: "2-digit" });
  }

  const diff = row.due - today;
  if (diff === 0) {
    return t("browse.due.today");
  }
  if (diff > 0) {
    return tn("browse.due.inDays", diff);
  }
  return tn("browse.due.overdue", Math.abs(diff));
}

/** Query cheat-sheet; query tokens stay as typed, only annotations translate. */
export function querySyntax(): string {
  return `${t("browse.syntax.title")}
  is:new  is:review  is:learn  is:due
  is:suspended  is:buried
  flag:1  flag:2  flag:3  flag:4
  deck:name   deck:parent*
  tag:word
  note:notetype
  added:7  (${t("browse.syntax.lastDays")})
  prop:ivl>5   prop:lapses>=3   prop:reps<10
  prop:due>0   prop:ease>200
  prop:stability<7   prop:difficulty>=5
  -is:new  (${t("browse.syntax.negate")})
  a or b  (${t("browse.syntax.or")})`;
}

/**
 * `deck:"<name>"` for one deck and its subdecks (Anki rule, SUB1). The name is
 * escaped so `\`, `"`, `*` and `_` match literally instead of as search syntax.
 */
export function deckSearchToken(deckName: string): string {
  const escaped = deckName.replace(/[\\"*_]/g, (ch) => `\\${ch}`);
  return `deck:"${escaped}"`;
}

/** Format a Browse search token (`deck:"..."` or `tag:...`), quoting values with spaces. */
export function buildBrowseFilterQuery(
  deckName: string | null | undefined,
  tagName: string | null | undefined,
): string {
  const parts: string[] = [];
  const deck = deckName?.trim();
  if (deck) {
    parts.push(deckSearchToken(deck));
  }
  const tag = tagName?.trim().replace(/"/g, "");
  if (tag) {
    parts.push(/\s/.test(tag) ? `tag:"${tag}"` : `tag:${tag}`);
  }
  return parts.join(" ");
}
