/**
 * Convert plain-text AI output into safe HTML paragraphs for Tiptap `FieldEditor`
 * so characters like `<`, `>`, `&` render literally instead of as markup.
 */
export function plainTextToEditorHtml(text: string): string {
  const escaped = escapeHtmlText(text);
  const lines = escaped.split(/\r?\n/);
  if (lines.length <= 1) return escaped;
  return lines.map((line) => (line ? `<p>${line}</p>` : "<p></p>")).join("");
}

/**
 * HTML-escape plain text from AI card generation and convert line breaks to `<br>`
 * while keeping cloze syntax (`{{cN::...}}`) intact as text (D21).
 */
export function plainTextToFieldHtml(text: string): string {
  return escapeHtmlText(text).replace(/\r?\n/g, "<br>");
}

/**
 * Append untrusted plain-text AI output to an existing field after `<br><br>`,
 * HTML-escaping the new text and preserving existing field markup (D22).
 */
export function buildAppendedFieldHtml(existingHtml: string, aiPlainText: string): string {
  const escaped = plainTextToFieldHtml(aiPlainText.trim());
  if (!escaped) return existingHtml;
  const trimmedExisting = existingHtml.trim();
  return trimmedExisting ? `${trimmedExisting}<br><br>${escaped}` : escaped;
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CLOZE_MARKER_RE = /\{\{c(\d+)::([^}]*?)\}\}/g;

/**
 * Convert already-escaped cloze field HTML into safe HTML for sandboxed `CardFace` preview.
 * On `"front"`, cloze targets display `[hint]` or `[…]`; on `"back"`, they display the answer.
 */
export function buildClozePreviewHtml(escapedFieldHtml: string, side: "front" | "back"): string {
  return escapedFieldHtml.replace(CLOZE_MARKER_RE, (_whole, _ord, body: string) => {
    const sep = body.indexOf("::");
    const answer = sep >= 0 ? body.slice(0, sep) : body;
    const hint = sep >= 0 ? body.slice(sep + 2) : "";
    if (side === "front") {
      return `<span class="cloze">[${hint || "…"}]</span>`;
    }
    return `<span class="cloze">${answer}</span>`;
  });
}
