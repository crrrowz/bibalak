/**
 * Why a field name can't be used, or `null` if it can. Mirrors the backend
 * check in bibalak-db (`check_field_name_syntax`): field names appear inside
 * `{{…}}` in templates and are rewritten on rename, so they must be unique in
 * the note type (case-insensitive, like Anki) and free of template syntax.
 */
export type FieldNameProblem = "empty" | "duplicate" | "syntax";

export function fieldNameProblem(name: string, otherNames: string[]): FieldNameProblem | null {
  const clean = name.trim();
  if (!clean) return "empty";
  if (/[:{}"]/.test(clean) || /^[#^/]/.test(clean)) return "syntax";
  const lower = clean.toLowerCase();
  if (otherNames.some((other) => other.toLowerCase() === lower)) return "duplicate";
  return null;
}
