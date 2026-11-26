import type { MatrixQuadrantDto, TaskListDto, TaskPriority } from "@bibalak/ipc-types";
import { offsetIsoDate, parseIsoDateLocal } from "./matrixHelpers";

export type QuickAddTokenKind = "priority" | "tag" | "list" | "date";

export interface QuickAddToken {
  id: string;
  kind: QuickAddTokenKind;
  raw: string;
  value: string;
  listName?: string;
}

export interface ParseQuickAddOptions {
  todayDate: string;
  taskLists: TaskListDto[];
  defaultPriority?: TaskPriority;
  defaultDueDate?: string | null;
  defaultListId?: string | null;
  suppressedTokenIds?: ReadonlySet<string>;
}

export interface ParsedQuickAdd {
  title: string;
  priority: TaskPriority;
  dueDate: string | null;
  listId: string | null;
  tags: string[];
  tokens: QuickAddToken[];
  explicitPriority: boolean;
  explicitDueDate: boolean;
  explicitList: boolean;
}

const ARABIC_DIACRITICS_RE = /[\u064B-\u065F\u0670\u0640]/g;

export function foldArabic(input: string): string {
  return input.replace(ARABIC_DIACRITICS_RE, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
}

function normalizeMatch(input: string): string {
  return foldArabic(input).toLowerCase();
}

const PRIORITY_MAP: Record<string, TaskPriority> = {
  high: "high",
  h: "high",
  "1": "high",
  عالي: "high",
  عاليه: "high",
  medium: "medium",
  med: "medium",
  m: "medium",
  "2": "medium",
  متوسط: "medium",
  متوسطه: "medium",
  low: "low",
  l: "low",
  "3": "low",
  منخفض: "low",
  منخفضه: "low",
  none: "none",
  "0": "none",
  بلا: "none",
};

// JS getDay(): 0 = Sun .. 6 = Sat
const EN_WEEKDAY_MAP: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const AR_WEEKDAY_MAP: Record<string, number> = {
  الاحد: 0,
  احد: 0,
  الاثنين: 1,
  اثنين: 1,
  الثلاثاء: 2,
  ثلاثاء: 2,
  الاربعاء: 3,
  اربعاء: 3,
  الخميس: 4,
  خميس: 4,
  الجمعه: 5,
  جمعه: 5,
  السبت: 6,
  سبت: 6,
};

const TAG_RE = /^#([\p{L}][\p{L}\p{N}_-]*)$/u;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidIsoDate(raw: string): boolean {
  const m = ISO_DATE_RE.exec(raw);
  if (!m) return false;
  const y = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(y, month - 1, day);
  return dt.getFullYear() === y && dt.getMonth() === month - 1 && dt.getDate() === day;
}

function upcomingWeekday(todayDate: string, targetWeekday: number): string {
  const todayWd = parseIsoDateLocal(todayDate).getDay();
  const delta = (targetWeekday - todayWd + 7) % 7 || 7;
  return offsetIsoDate(todayDate, delta);
}

interface RawChunk {
  text: string;
  start: number;
  end: number;
  quotedListName: string | null;
}

function scanChunks(input: string): RawChunk[] {
  const chunks: RawChunk[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    while (i < len && /\s/.test(input[i])) i += 1;
    if (i >= len) break;

    const start = i;
    if (input[i] === "~" && i + 1 < len && (input[i + 1] === '"' || input[i + 1] === "'")) {
      const quote = input[i + 1];
      const closeIdx = input.indexOf(quote, i + 2);
      if (closeIdx !== -1 && (closeIdx + 1 === len || /\s/.test(input[closeIdx + 1]))) {
        const end = closeIdx + 1;
        chunks.push({
          text: input.slice(start, end),
          start,
          end,
          quotedListName: input.slice(i + 2, closeIdx),
        });
        i = end;
        continue;
      }
    }

    while (i < len && !/\s/.test(input[i])) i += 1;
    chunks.push({
      text: input.slice(start, i),
      start,
      end: i,
      quotedListName: null,
    });
  }

  return chunks;
}

export function parseQuickAdd(rawInput: string, options: ParseQuickAddOptions): ParsedQuickAdd {
  const {
    todayDate,
    taskLists,
    defaultPriority = "none",
    defaultDueDate = null,
    defaultListId = null,
    suppressedTokenIds,
  } = options;

  const listByNormName = new Map<string, TaskListDto>();
  for (const list of taskLists) {
    const key = normalizeMatch(list.name.trim());
    if (key && !listByNormName.has(key)) {
      listByNormName.set(key, list);
    }
  }

  const chunks = scanChunks(rawInput);
  const removedSpans: Array<{ start: number; end: number }> = [];

  let priority: TaskPriority = defaultPriority;
  let explicitPriority = false;
  let winningPriorityToken: QuickAddToken | null = null;

  let dueDate: string | null = defaultDueDate;
  let explicitDueDate = false;
  let winningDateToken: QuickAddToken | null = null;

  let listId: string | null = defaultListId;
  let explicitList = false;
  let winningListToken: QuickAddToken | null = null;

  const tags: string[] = [];
  const seenTags = new Set<string>();
  const tagTokens: QuickAddToken[] = [];

  const isSuppressed = (id: string) => suppressedTokenIds?.has(id) ?? false;

  for (let idx = 0; idx < chunks.length; idx += 1) {
    const chunk = chunks[idx];
    const nextChunk = idx + 1 < chunks.length ? chunks[idx + 1] : null;

    // 1. Two-word date phrases
    if (nextChunk) {
      const normFirst = normalizeMatch(chunk.text);
      const normSecond = normalizeMatch(nextChunk.text);
      let phraseDate: string | null = null;

      if (normFirst === "next" && normSecond in EN_WEEKDAY_MAP) {
        phraseDate = upcomingWeekday(todayDate, EN_WEEKDAY_MAP[normSecond]);
      } else if (normFirst === "بعد" && normSecond === "غد") {
        phraseDate = offsetIsoDate(todayDate, 2);
      } else if (
        normFirst in AR_WEEKDAY_MAP &&
        (normSecond === "القادم" || normSecond === "القادمه")
      ) {
        phraseDate = upcomingWeekday(todayDate, AR_WEEKDAY_MAP[normFirst]);
      }

      if (phraseDate) {
        const rawSpan = rawInput.slice(chunk.start, nextChunk.end);
        const tokenId = `date:${chunk.start}:${rawSpan}`;
        if (!isSuppressed(tokenId)) {
          dueDate = phraseDate;
          explicitDueDate = true;
          winningDateToken = { id: tokenId, kind: "date", raw: rawSpan, value: phraseDate };
          removedSpans.push({ start: chunk.start, end: nextChunk.end });
          idx += 1;
          continue;
        }
      }
    }

    // 2. Quoted or bare ~list
    if (chunk.quotedListName !== null) {
      const matchedList = listByNormName.get(normalizeMatch(chunk.quotedListName.trim()));
      if (matchedList) {
        const tokenId = `list:${chunk.start}:${chunk.text}`;
        if (!isSuppressed(tokenId)) {
          listId = matchedList.id;
          explicitList = true;
          winningListToken = {
            id: tokenId,
            kind: "list",
            raw: chunk.text,
            value: matchedList.id,
            listName: matchedList.name,
          };
          removedSpans.push({ start: chunk.start, end: chunk.end });
          continue;
        }
      }
    } else if (chunk.text.startsWith("~") && chunk.text.length > 1) {
      const rawListName = chunk.text.slice(1);
      const matchedList = listByNormName.get(normalizeMatch(rawListName));
      if (matchedList) {
        const tokenId = `list:${chunk.start}:${chunk.text}`;
        if (!isSuppressed(tokenId)) {
          listId = matchedList.id;
          explicitList = true;
          winningListToken = {
            id: tokenId,
            kind: "list",
            raw: chunk.text,
            value: matchedList.id,
            listName: matchedList.name,
          };
          removedSpans.push({ start: chunk.start, end: chunk.end });
          continue;
        }
      }
    }

    // 3. Priority !token
    if (chunk.text.startsWith("!") && chunk.text.length > 1) {
      const key = normalizeMatch(chunk.text.slice(1));
      const matchedPriority = PRIORITY_MAP[key];
      if (matchedPriority) {
        const tokenId = `priority:${chunk.start}:${chunk.text}`;
        if (!isSuppressed(tokenId)) {
          priority = matchedPriority;
          explicitPriority = true;
          winningPriorityToken = {
            id: tokenId,
            kind: "priority",
            raw: chunk.text,
            value: matchedPriority,
          };
          removedSpans.push({ start: chunk.start, end: chunk.end });
          continue;
        }
      }
    }

    // 4. Tag #token (must start with a Unicode letter)
    const tagMatch = TAG_RE.exec(chunk.text);
    if (tagMatch) {
      const tagName = tagMatch[1];
      const tokenId = `tag:${chunk.start}:${chunk.text}`;
      if (!isSuppressed(tokenId)) {
        const dedupKey = normalizeMatch(tagName);
        if (!seenTags.has(dedupKey)) {
          seenTags.add(dedupKey);
          tags.push(tagName);
          tagTokens.push({ id: tokenId, kind: "tag", raw: chunk.text, value: tagName });
        }
        removedSpans.push({ start: chunk.start, end: chunk.end });
        continue;
      }
    }

    // 5. Single-word date
    const norm = normalizeMatch(chunk.text);
    let singleDate: string | null = null;
    if (norm === "today" || norm === "tod" || norm === "اليوم") {
      singleDate = todayDate;
    } else if (norm === "tomorrow" || norm === "tmr" || norm === "غدا") {
      singleDate = offsetIsoDate(todayDate, 1);
    } else if (norm in EN_WEEKDAY_MAP) {
      singleDate = upcomingWeekday(todayDate, EN_WEEKDAY_MAP[norm]);
    } else if (norm in AR_WEEKDAY_MAP) {
      singleDate = upcomingWeekday(todayDate, AR_WEEKDAY_MAP[norm]);
    } else if (isValidIsoDate(chunk.text)) {
      singleDate = chunk.text;
    }

    if (singleDate) {
      const tokenId = `date:${chunk.start}:${chunk.text}`;
      if (!isSuppressed(tokenId)) {
        dueDate = singleDate;
        explicitDueDate = true;
        winningDateToken = { id: tokenId, kind: "date", raw: chunk.text, value: singleDate };
        removedSpans.push({ start: chunk.start, end: chunk.end });
      }
    }
  }

  let title = "";
  let cursor = 0;
  for (const span of removedSpans) {
    if (span.start > cursor) {
      title += rawInput.slice(cursor, span.start);
    }
    cursor = span.end;
  }
  if (cursor < rawInput.length) {
    title += rawInput.slice(cursor);
  }
  title = title.replace(/\s+/g, " ").trim();

  const tokens: QuickAddToken[] = [];
  if (winningDateToken) tokens.push(winningDateToken);
  if (winningPriorityToken) tokens.push(winningPriorityToken);
  if (winningListToken) tokens.push(winningListToken);
  tokens.push(...tagTokens);

  return {
    title,
    priority,
    dueDate,
    listId,
    tags,
    tokens,
    explicitPriority,
    explicitDueDate,
    explicitList,
  };
}

export function quadrantQuickAddDefaults(
  quadrant: MatrixQuadrantDto,
  todayDate: string,
): { defaultPriority: TaskPriority; defaultDueDate: string | null } {
  const defaultPriority = quadrant.rule.priorities?.[0] ?? "none";
  const filters = quadrant.rule.date_filters;
  const requiresToday =
    filters !== null &&
    !filters.includes("no_date") &&
    (filters.includes("today") || filters.includes("tomorrow"));
  return {
    defaultPriority,
    defaultDueDate: requiresToday ? todayDate : null,
  };
}
