import type { FieldKind, FieldOptions, TemplateSummary } from "@bibalak/ipc-types";
import { errorMessage } from "@/lib/ipc";
import { t } from "@/lib/i18n";

export type MediaFieldKind = "audio" | "video" | "image";

const STOCK_FIELD_KEYS: Record<
  string,
  | "add.stockField.front"
  | "add.stockField.back"
  | "add.stockField.text"
  | "add.stockField.extra"
  | "add.stockField.backExtra"
> = {
  Front: "add.stockField.front",
  Back: "add.stockField.back",
  Text: "add.stockField.text",
  Extra: "add.stockField.extra",
  "Back Extra": "add.stockField.backExtra",
};

/** Localize standard built-in field names for display without altering database keys (`A1-31`). */
export function localizeStockFieldName(name: string): string {
  const key = STOCK_FIELD_KEYS[name];
  return key ? t(key) : name;
}

/** Map core note-creation validation strings to friendly localized `t()` messages (`F11`). */
export function formatAddError(err: unknown, firstFieldLabel: string): string {
  const raw = errorMessage(err);
  if (/first field cannot be empty/i.test(raw)) {
    return t("add.error.emptyFirstField", { field: firstFieldLabel });
  }
  if (/note creates no cards|creates no cards/i.test(raw)) {
    return t("add.error.noCards");
  }
  if (/filtered deck/i.test(raw)) {
    return t("add.error.filteredDeck");
  }
  return raw;
}

const AUDIO_NAME_RE = /\b(audio|sound|voice)\b|صوت/i;
const VIDEO_NAME_RE = /\b(video)\b|فيديو/i;
const IMAGE_NAME_RE = /\b(image|snapshot|photo|picture|pic|diagram)\b|صورة/i;
const MEDIA_PATH_RE =
  /^(?:["'])?(?:[a-zA-Z]:[\\/]|\\\\|\/|\.{1,2}[\\/]).+\.(mp3|ogg|wav|m4a|flac|aac|opus|mp4|webm|mkv|mov|png|jpe?g|gif|webp|bmp|avif|ico)(?:["'])?$/i;

/** Detect whether a pasted single-line string is a local OS path to an audio/video/image file. */
export function normalizePastedMediaPath(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes("\n") || trimmed.includes("\r")) return null;
  if (!MEDIA_PATH_RE.test(trimmed)) return null;
  return trimmed.replace(/^["']|["']$/g, "");
}

/** Infer media field kind from template usage (`[sound:{{F}}]`, `<img src="{{F}}">`) or field name (`F11`). */
export function detectMediaFieldKind(
  fieldName: string,
  templates?: TemplateSummary[],
): MediaFieldKind | null {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const soundTplRe = new RegExp(`\\[sound:[^\\]]*\\{\\{(?:[^}]*:)?${escaped}\\}\\}`, "i");
  const imgTplRe = new RegExp(`<img\\b[^>]*\\{\\{(?:[^}]*:)?${escaped}\\}\\}`, "i");
  for (const tpl of templates ?? []) {
    const combined = `${tpl.qfmt}\n${tpl.afmt}`;
    if (soundTplRe.test(combined)) {
      return VIDEO_NAME_RE.test(fieldName) ? "video" : "audio";
    }
    if (imgTplRe.test(combined)) {
      return "image";
    }
  }
  if (VIDEO_NAME_RE.test(fieldName)) return "video";
  if (AUDIO_NAME_RE.test(fieldName)) return "audio";
  if (IMAGE_NAME_RE.test(fieldName)) return "image";
  return null;
}

/**
 * Resolve a field's media kind, respecting any explicit `options.kind` set in Note Types
 * (`"text"` disables inference; `"image" | "audio" | "video"` overrides name/template inference).
 */
export function resolveFieldMediaKind(
  fieldName: string,
  options?: Pick<FieldOptions, "kind"> | null,
  templates?: TemplateSummary[],
): MediaFieldKind | null {
  if (options?.kind === "text") return null;
  if (options?.kind === "image" || options?.kind === "audio" || options?.kind === "video") {
    return options.kind;
  }
  return detectMediaFieldKind(fieldName, templates);
}

/** Resolve the full `FieldKind` (`"text" | "image" | "audio" | "video"`) for Note Types display. */
export function resolveFieldKind(
  fieldName: string,
  options?: Pick<FieldOptions, "kind"> | null,
  templates?: TemplateSummary[],
): FieldKind {
  return resolveFieldMediaKind(fieldName, options, templates) ?? "text";
}

/** Build the stored field reference tag (`[sound:...]` or `<img>`) for a saved media file. */
export function formatStoredMediaReference(kind: MediaFieldKind, filename: string): string {
  return kind === "image" ? `<img src="${filename}" alt="${filename}">` : `[sound:${filename}]`;
}

const MORE_FIELDS_STORAGE_KEY = "keepsake-add-more-fields";
const SPECIAL_TEMPLATE_TOKENS = new Set([
  "frontside",
  "tags",
  "type",
  "deck",
  "subdeck",
  "card",
  "cardflag",
]);

function extractTemplateFieldNames(fmt: string): string[] {
  const names: string[] = [];
  const matches = fmt.matchAll(/\{\{([^}]+)\}\}/g);
  for (const match of matches) {
    let raw = match[1].trim();
    if (!raw || raw.startsWith("/") || raw.startsWith("!")) continue;
    if (raw.startsWith("#") || raw.startsWith("^")) {
      raw = raw.slice(1).trim();
    }
    const colonIdx = raw.lastIndexOf(":");
    const fieldName = (colonIdx >= 0 ? raw.slice(colonIdx + 1) : raw).trim();
    if (!fieldName) continue;
    if (SPECIAL_TEMPLATE_TOKENS.has(fieldName.toLowerCase())) continue;
    names.push(fieldName);
  }
  return names;
}

/**
 * Partitions note-type field indices into:
 * - `primary`: fields referenced by card templates (front template fields first, then back template fields),
 * - `extra`: all remaining fields in note-type order.
 *
 * When no templates exist or none reference any field, all fields stay in `primary`.
 */
export function partitionFieldsByTemplates(
  fieldNames: string[],
  templates: TemplateSummary[] | undefined,
  excludedIndices: Set<number> = new Set(),
): { primary: number[]; extra: number[] } {
  const eligible = fieldNames
    .map((_, index) => index)
    .filter((index) => !excludedIndices.has(index));

  if (!templates || templates.length === 0) {
    return { primary: eligible, extra: [] };
  }

  const byExact = new Map<string, number>();
  const byLower = new Map<string, number>();
  for (const index of eligible) {
    const name = fieldNames[index];
    byExact.set(name, index);
    byLower.set(name.toLowerCase(), index);
  }

  const primary: number[] = [];
  const seen = new Set<number>();

  const pushRef = (ref: string) => {
    const idx = byExact.get(ref) ?? byLower.get(ref.toLowerCase());
    if (idx !== undefined && !seen.has(idx)) {
      seen.add(idx);
      primary.push(idx);
    }
  };

  for (const tpl of templates) {
    for (const ref of extractTemplateFieldNames(tpl.qfmt)) {
      pushRef(ref);
    }
  }
  for (const tpl of templates) {
    for (const ref of extractTemplateFieldNames(tpl.afmt)) {
      pushRef(ref);
    }
  }

  if (primary.length === 0) {
    return { primary: eligible, extra: [] };
  }

  const extra = eligible.filter((index) => !seen.has(index));
  return { primary, extra };
}

export function readMoreFieldsExpanded(notetypeId: number | null): boolean {
  if (notetypeId === null || typeof localStorage === "undefined") return false;
  try {
    const raw = localStorage.getItem(MORE_FIELDS_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return Boolean(parsed[String(notetypeId)]);
  } catch {
    return false;
  }
}

export function writeMoreFieldsExpanded(notetypeId: number | null, expanded: boolean): void {
  if (notetypeId === null || typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(MORE_FIELDS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    parsed[String(notetypeId)] = expanded;
    localStorage.setItem(MORE_FIELDS_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // localStorage unavailable or malformed
  }
}
