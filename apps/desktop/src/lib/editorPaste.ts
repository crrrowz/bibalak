import { Node as TiptapNode, mergeAttributes } from "@tiptap/react";

const DROP_SUBTREE_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "svg",
  "meta",
  "link",
  "head",
  "title",
  "xml",
  "form",
  "input",
  "textarea",
  "button",
  "select",
]);

const ALLOWED_DIRECT_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "sub",
  "sup",
  "br",
  "ul",
  "ol",
  "li",
  "p",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
]);

const BLOCK_TO_PARAGRAPH_TAGS = new Set([
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "section",
  "article",
  "header",
  "footer",
  "nav",
  "aside",
  "figure",
  "figcaption",
]);

const BLOCK_TAG_NAMES = new Set([
  "p",
  "div",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
]);

/** Allow only safe link/image URLs; strip control/whitespace obfuscation before checking scheme. */
export function isSafePastedUrl(raw: string | null, kind: "link" | "image"): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  // eslint-disable-next-line no-control-regex
  const compact = trimmed.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  if (compact.startsWith("#") && kind === "link") return true;

  const schemeMatch = compact.match(/^([a-z][a-z0-9+.-]*):/);
  if (!schemeMatch) {
    // Relative path or bare media filename (e.g. "diagram.png").
    return true;
  }
  const scheme = schemeMatch[1];
  if (scheme === "http" || scheme === "https") return true;
  if (kind === "link") return scheme === "mailto";
  if (scheme === "bibalak-media") return true;
  if (scheme === "data")
    return compact.startsWith("data:image/") && !compact.startsWith("data:image/svg+xml");
  return false;
}

function parseDimensionPx(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(?:px)?$/i);
  return m ? Number(m[1]) : null;
}

function isTrackingImage(el: Element): boolean {
  const style = el.getAttribute("style") ?? "";
  if (/(?:^|;)\s*display\s*:\s*none\b/i.test(style)) return true;
  if (/(?:^|;)\s*visibility\s*:\s*hidden\b/i.test(style)) return true;
  if (/(?:^|;)\s*opacity\s*:\s*0(?:\s*;|$)/i.test(style)) return true;

  const widthAttr = parseDimensionPx(el.getAttribute("width"));
  const heightAttr = parseDimensionPx(el.getAttribute("height"));
  const widthStyleMatch = style.match(/(?:^|;)\s*width\s*:\s*([^;]+)/i);
  const heightStyleMatch = style.match(/(?:^|;)\s*height\s*:\s*([^;]+)/i);
  const w = widthAttr ?? parseDimensionPx(widthStyleMatch?.[1] ?? null);
  const h = heightAttr ?? parseDimensionPx(heightStyleMatch?.[1] ?? null);
  if (w !== null && w <= 2) return true;
  if (h !== null && h <= 2) return true;
  return false;
}

function hasNormalFontWeight(style: string): boolean {
  const match = style.match(/(?:^|;)\s*font-weight\s*:\s*([^;]+)/i);
  if (!match) return false;
  const v = match[1].trim().toLowerCase();
  return v === "normal" || v === "400";
}

function wrapInTags(doc: Document, nodes: Node[], tags: string[]): Node[] {
  if (nodes.length === 0 || tags.length === 0) return nodes;
  let current: Node[] = nodes;
  for (let i = tags.length - 1; i >= 0; i -= 1) {
    const wrapper = doc.createElement(tags[i]);
    for (const child of current) wrapper.appendChild(child);
    current = [wrapper];
  }
  return current;
}

function sanitizeChildNodes(doc: Document, parent: Node): Node[] {
  const out: Node[] = [];
  for (const child of Array.from(parent.childNodes)) {
    out.push(...sanitizeNode(doc, child));
  }
  return out;
}

function containsBlockElement(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (BLOCK_TAG_NAMES.has(child.tagName.toLowerCase())) return true;
  }
  return false;
}

function sanitizeNode(doc: Document, node: Node): Node[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return [doc.createTextNode(node.textContent ?? "")];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return [];
  }

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  // Drop scripts, styles, Word XML blocks (<w:...>, <m:...>, <v:...>), and active elements.
  if (
    DROP_SUBTREE_TAGS.has(tag) ||
    tag.startsWith("w:") ||
    tag.startsWith("m:") ||
    tag.startsWith("v:")
  ) {
    return [];
  }

  // Unwrap Office paragraph markers (<o:p>) without leaking the literal tag.
  if (tag.includes(":")) {
    return sanitizeChildNodes(doc, el);
  }

  const style = el.getAttribute("style") ?? "";

  // Google Docs wraps pasted fragments in <b style="font-weight:normal" id="docs-internal-guid-...">.
  if (
    (tag === "b" || tag === "strong") &&
    (hasNormalFontWeight(style) || el.id.startsWith("docs-internal-guid"))
  ) {
    return sanitizeChildNodes(doc, el);
  }

  if (tag === "span" || tag === "font") {
    const children = sanitizeChildNodes(doc, el);
    const wrappers: string[] = [];
    if (/(?:^|;)\s*font-weight\s*:\s*(?:bold|[6-9]\d{2})\b/i.test(style)) wrappers.push("b");
    if (/(?:^|;)\s*font-style\s*:\s*italic\b/i.test(style)) wrappers.push("i");
    if (/(?:^|;)\s*text-decoration(?:-line)?\s*:[^;]*\bunderline\b/i.test(style))
      wrappers.push("u");
    if (/(?:^|;)\s*vertical-align\s*:\s*sub\b/i.test(style)) wrappers.push("sub");
    if (/(?:^|;)\s*vertical-align\s*:\s*super\b/i.test(style)) wrappers.push("sup");
    return wrapInTags(doc, children, wrappers);
  }

  if (tag === "img") {
    if (isTrackingImage(el)) return [];
    const src = el.getAttribute("src");
    if (!isSafePastedUrl(src, "image")) return [];
    const img = doc.createElement("img");
    img.setAttribute("src", src!.trim());
    const alt = el.getAttribute("alt")?.trim();
    if (alt) img.setAttribute("alt", alt);
    return [img];
  }

  if (tag === "a") {
    const href = el.getAttribute("href");
    const children = sanitizeChildNodes(doc, el);
    if (!isSafePastedUrl(href, "link")) return children;
    const anchor = doc.createElement("a");
    anchor.setAttribute("href", href!.trim());
    for (const child of children) anchor.appendChild(child);
    return [anchor];
  }

  if (tag === "br") {
    return [doc.createElement("br")];
  }

  if (ALLOWED_DIRECT_TAGS.has(tag)) {
    const clean = doc.createElement(tag);
    for (const child of sanitizeChildNodes(doc, el)) {
      clean.appendChild(child);
    }
    return [clean];
  }

  if (BLOCK_TO_PARAGRAPH_TAGS.has(tag)) {
    const children = sanitizeChildNodes(doc, el);
    if (tag === "div" && containsBlockElement(el)) {
      return children;
    }
    const p = doc.createElement("p");
    for (const child of children) p.appendChild(child);
    return [p];
  }

  // Any other inline wrapper (code, mark, s, etc.): keep inner content only.
  return sanitizeChildNodes(doc, el);
}

/**
 * Clean clipboard HTML (Word, Google Docs, web pages) to a safe subset:
 * b/i/u/sub/sup/br/lists/links/images/tables, without styles, classes,
 * scripts, event handlers, javascript: links, or tracking pixels.
 */
export function cleanPastedHtml(html: string): string {
  const withoutConditionals = html.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "");
  const doc = new DOMParser().parseFromString(withoutConditionals, "text/html");
  const container = doc.createElement("div");
  for (const child of sanitizeChildNodes(doc, doc.body)) {
    container.appendChild(child);
  }
  return container.innerHTML.trim();
}

const EditorTable = TiptapNode.create({
  name: "table",
  group: "block",
  content: "tableRow+",
  isolating: true,
  parseHTML() {
    return [{ tag: "table" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["table", mergeAttributes(HTMLAttributes), ["tbody", 0]];
  },
});

const EditorTableRow = TiptapNode.create({
  name: "tableRow",
  content: "(tableCell | tableHeader)+",
  parseHTML() {
    return [{ tag: "tr" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["tr", mergeAttributes(HTMLAttributes), 0];
  },
});

const EditorTableCell = TiptapNode.create({
  name: "tableCell",
  content: "block+",
  isolating: true,
  parseHTML() {
    return [{ tag: "td" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["td", mergeAttributes(HTMLAttributes), 0];
  },
});

const EditorTableHeader = TiptapNode.create({
  name: "tableHeader",
  content: "block+",
  isolating: true,
  parseHTML() {
    return [{ tag: "th" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["th", mergeAttributes(HTMLAttributes), 0];
  },
});

/** Lightweight TipTap schema nodes to preserve pasted HTML tables cleanly. */
export const editorTableExtensions = [
  EditorTable,
  EditorTableRow,
  EditorTableCell,
  EditorTableHeader,
];
