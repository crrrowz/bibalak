import type { TemplateSummary } from "@bibalak/ipc-types";

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
