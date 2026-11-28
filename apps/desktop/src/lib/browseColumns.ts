import type { LocaleKey } from "@/locales/en";

export type BrowseDialogKind =
  | null
  | "forget"
  | "setDueDate"
  | "reposition"
  | "preview"
  | "findReplace"
  | "findDuplicates"
  | "emptyCards"
  | "changeNotetype"
  | "columns";

export type BrowseMode = "cards" | "notes";

export type CardColumnId =
  | "sort_field"
  | "deck"
  | "notetype"
  | "queue"
  | "due"
  | "interval"
  | "lapses"
  | "reps"
  | "tags";

export type NoteColumnId = "sort_field" | "notetype" | "deck" | "cards" | "tags" | "modified";

export interface ColumnDef<T extends string> {
  id: T;
  labelKey: LocaleKey;
  sortKey?: string;
}

export const CARD_COLUMNS: ColumnDef<CardColumnId>[] = [
  { id: "sort_field", labelKey: "browse.col.sortField", sortKey: "sort_field" },
  { id: "deck", labelKey: "browse.col.deck", sortKey: "deck" },
  { id: "notetype", labelKey: "browse.col.notetype", sortKey: "notetype" },
  { id: "queue", labelKey: "browse.col.status", sortKey: "queue" },
  { id: "due", labelKey: "browse.col.due", sortKey: "due" },
  { id: "interval", labelKey: "browse.col.interval", sortKey: "interval" },
  { id: "lapses", labelKey: "browse.col.lapses", sortKey: "lapses" },
  { id: "reps", labelKey: "browse.col.reps", sortKey: "reps" },
  { id: "tags", labelKey: "browse.tags" },
];

export const NOTE_COLUMNS: ColumnDef<NoteColumnId>[] = [
  { id: "sort_field", labelKey: "browse.col.sortField", sortKey: "sort_field" },
  { id: "notetype", labelKey: "browse.col.notetype", sortKey: "notetype" },
  { id: "deck", labelKey: "browse.col.deck", sortKey: "deck" },
  { id: "cards", labelKey: "browse.col.cards", sortKey: "cards" },
  { id: "tags", labelKey: "browse.tags" },
  { id: "modified", labelKey: "browse.col.modified", sortKey: "modified" },
];

export const DEFAULT_CARD_COLUMNS: CardColumnId[] = [
  "sort_field",
  "deck",
  "queue",
  "due",
  "interval",
  "lapses",
  "tags",
];

export const DEFAULT_NOTE_COLUMNS: NoteColumnId[] = [
  "sort_field",
  "notetype",
  "deck",
  "cards",
  "tags",
];

const BROWSE_MODE_KEY = "keepsake-browse-mode";
const CARD_COLUMNS_KEY = "keepsake-browse-columns-cards";
const NOTE_COLUMNS_KEY = "keepsake-browse-columns-notes";

export function readBrowseMode(): BrowseMode {
  if (typeof localStorage === "undefined") return "cards";
  return localStorage.getItem(BROWSE_MODE_KEY) === "notes" ? "notes" : "cards";
}

export function writeBrowseMode(mode: BrowseMode) {
  if (typeof localStorage !== "undefined") localStorage.setItem(BROWSE_MODE_KEY, mode);
}

function readColumnList<T extends string>(key: string, valid: T[], fallback: T[]): T[] {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const allowed = new Set<string>(valid);
    const filtered = parsed.filter((x): x is T => typeof x === "string" && allowed.has(x));
    return filtered.length > 0 ? filtered : fallback;
  } catch {
    return fallback;
  }
}

export function readCardColumns(): CardColumnId[] {
  return readColumnList(
    CARD_COLUMNS_KEY,
    CARD_COLUMNS.map((c) => c.id),
    DEFAULT_CARD_COLUMNS,
  );
}

export function writeCardColumns(cols: CardColumnId[]) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(CARD_COLUMNS_KEY, JSON.stringify(cols));
  }
}

export function readNoteColumns(): NoteColumnId[] {
  return readColumnList(
    NOTE_COLUMNS_KEY,
    NOTE_COLUMNS.map((c) => c.id),
    DEFAULT_NOTE_COLUMNS,
  );
}

export function writeNoteColumns(cols: NoteColumnId[]) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(NOTE_COLUMNS_KEY, JSON.stringify(cols));
  }
}
