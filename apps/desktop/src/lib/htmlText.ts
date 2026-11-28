/**
 * Plain text from card HTML for previews, sorting and empty checks. The result
 * is shown as text (React escapes it); it is never inserted as HTML.
 */

const TAG = /<[^<>]*>/g;
const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(nbsp|amp|lt|gt|quot|apos));/g;
const NAMED: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Remove tags, repeating until none are left (`<<b>x>` cannot leave a tag behind). */
export function stripTags(html: string, replacement = ""): string {
  let text = html;
  let previous: string;
  do {
    previous = text;
    text = text.replace(TAG, replacement);
  } while (text !== previous);
  return text;
}

/** Decode common entities in one pass, so `&amp;lt;` becomes `&lt;`, not `<`. */
export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (match, dec?: string, hex?: string, name?: string) => {
    if (name) return NAMED[name] ?? match;
    const code = dec ? Number(dec) : parseInt(hex ?? "", 16);
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : match;
  });
}

const MEDIA_SRC =
  /<(?:img|audio|video|source)\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;

/** Tags removed, entities decoded, outer whitespace trimmed (preserving media filename if text is empty). */
export function htmlToText(html: string, tagReplacement = ""): string {
  const plain = decodeEntities(stripTags(html, tagReplacement)).trim();
  if (plain) return plain;
  const withMedia = html.replace(MEDIA_SRC, (_m, a?: string, b?: string, c?: string) => {
    const name = a ?? b ?? c ?? "";
    return name ? ` ${name} ` : "";
  });
  return decodeEntities(stripTags(withMedia, tagReplacement)).trim();
}
