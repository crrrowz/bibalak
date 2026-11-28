import { Extension, Mark, Node as TiptapNode, mergeAttributes } from "@tiptap/react";
import { TextStyle } from "@tiptap/extension-text-style";

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
  "s",
  "del",
  "code",
  "pre",
  "mark",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
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
  "section",
  "article",
  "header",
  "footer",
  "nav",
  "aside",
  "figure",
  "figcaption",
]);

const SAFE_COLOR_RE =
  /^(?:#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|[a-z]{3,20})$/i;

function extractSafeColorStyle(style: string): string {
  if (!style) return "";
  const kept: string[] = [];
  for (const decl of style.split(";")) {
    const colon = decl.indexOf(":");
    if (colon <= 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const val = decl.slice(colon + 1).trim();
    if (prop !== "color" && prop !== "background-color") continue;
    const lower = val.toLowerCase();
    if (
      !val ||
      lower === "windowtext" ||
      lower === "transparent" ||
      lower === "inherit" ||
      lower === "initial" ||
      lower === "#000000" ||
      lower === "#000" ||
      lower === "rgb(0, 0, 0)" ||
      !SAFE_COLOR_RE.test(val)
    ) {
      continue;
    }
    kept.push(`${prop}: ${val}`);
  }
  return kept.join("; ");
}

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
    if (/(?:^|;)\s*text-decoration(?:-line)?\s*:[^;]*\bline-through\b/i.test(style))
      wrappers.push("s");
    if (/(?:^|;)\s*vertical-align\s*:\s*sub\b/i.test(style)) wrappers.push("sub");
    if (/(?:^|;)\s*vertical-align\s*:\s*super\b/i.test(style)) wrappers.push("sup");
    let wrapped = wrapInTags(doc, children, wrappers);
    const fontColor = tag === "font" ? el.getAttribute("color")?.trim() : undefined;
    const safeStyle = extractSafeColorStyle(fontColor ? `color: ${fontColor}; ${style}` : style);
    if (safeStyle && wrapped.length > 0) {
      const span = doc.createElement("span");
      span.setAttribute("style", safeStyle);
      for (const child of wrapped) span.appendChild(child);
      wrapped = [span];
    }
    return wrapped;
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
    if (tag === "mark") {
      const safeStyle = extractSafeColorStyle(style);
      if (safeStyle) clean.setAttribute("style", safeStyle);
    }
    if (tag === "td" || tag === "th") {
      for (const attr of ["colspan", "rowspan"] as const) {
        const val = el.getAttribute(attr)?.trim();
        if (val && /^\d+$/.test(val) && Number(val) > 1) {
          clean.setAttribute(attr, val);
        }
      }
    }
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
  addAttributes() {
    return {
      colspan: { default: 1 },
      rowspan: { default: 1 },
    };
  },
  parseHTML() {
    return [{ tag: "td" }];
  },
  renderHTML({ HTMLAttributes }) {
    const attrs: Record<string, unknown> = { ...HTMLAttributes };
    if (attrs.colspan === 1) delete attrs.colspan;
    if (attrs.rowspan === 1) delete attrs.rowspan;
    return ["td", mergeAttributes(attrs), 0];
  },
});

const EditorTableHeader = TiptapNode.create({
  name: "tableHeader",
  content: "block+",
  isolating: true,
  addAttributes() {
    return {
      colspan: { default: 1 },
      rowspan: { default: 1 },
    };
  },
  parseHTML() {
    return [{ tag: "th" }];
  },
  renderHTML({ HTMLAttributes }) {
    const attrs: Record<string, unknown> = { ...HTMLAttributes };
    if (attrs.colspan === 1) delete attrs.colspan;
    if (attrs.rowspan === 1) delete attrs.rowspan;
    return ["th", mergeAttributes(attrs), 0];
  },
});

/** Lightweight TipTap schema nodes to preserve pasted HTML tables cleanly. */
export const editorTableExtensions = [
  EditorTable,
  EditorTableRow,
  EditorTableCell,
  EditorTableHeader,
];

const AnkiDiv = TiptapNode.create({
  name: "ankiDiv",
  group: "block",
  content: "inline*",
  priority: 40,
  parseHTML() {
    return [
      {
        tag: "div",
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          if (el.querySelector("p,div,ul,ol,table,h1,h2,h3,h4,h5,h6,blockquote,pre")) {
            return false;
          }
          return el.hasAttribute("class") || el.hasAttribute("style") || el.hasAttribute("dir")
            ? null
            : false;
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes), 0];
  },
});

const AnkiRuby = TiptapNode.create({
  name: "ankiRuby",
  group: "inline",
  inline: true,
  content: "inline*",
  parseHTML() {
    return [{ tag: "ruby" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["ruby", mergeAttributes(HTMLAttributes), 0];
  },
});

const AnkiRt = TiptapNode.create({
  name: "ankiRt",
  group: "inline",
  inline: true,
  content: "text*",
  parseHTML() {
    return [{ tag: "rt" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["rt", mergeAttributes(HTMLAttributes), 0];
  },
});

const AnkiRp = TiptapNode.create({
  name: "ankiRp",
  group: "inline",
  inline: true,
  content: "text*",
  parseHTML() {
    return [{ tag: "rp" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["rp", mergeAttributes(HTMLAttributes), 0];
  },
});

const AnkiSpanClass = Mark.create({
  name: "ankiSpanClass",
  addAttributes() {
    return {
      class: {
        default: null,
        parseHTML: (el) => el.getAttribute("class"),
        renderHTML: (attrs) => (attrs.class ? { class: attrs.class as string } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[class]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});

const AnkiPreserveAttrs = Extension.create({
  name: "ankiPreserveAttrs",
  addGlobalAttributes() {
    return [
      {
        types: [
          "paragraph",
          "heading",
          "blockquote",
          "codeBlock",
          "ankiDiv",
          "ankiRuby",
          "ankiRt",
          "table",
          "tableRow",
          "tableCell",
          "tableHeader",
          "image",
        ],
        attributes: {
          class: {
            default: null,
            parseHTML: (el) => el.getAttribute("class"),
            renderHTML: (attrs) => (attrs.class ? { class: attrs.class as string } : {}),
          },
          style: {
            default: null,
            parseHTML: (el) => el.getAttribute("style"),
            renderHTML: (attrs) => (attrs.style ? { style: attrs.style as string } : {}),
          },
          dir: {
            default: null,
            parseHTML: (el) => el.getAttribute("dir"),
            renderHTML: (attrs) => (attrs.dir ? { dir: attrs.dir as string } : {}),
          },
        },
      },
    ];
  },
});

/** TipTap extensions preserving existing Anki classes, inline styles, and ruby markup. */
export const editorHtmlExtensions = [
  TextStyle,
  AnkiSpanClass,
  AnkiDiv,
  AnkiRuby,
  AnkiRt,
  AnkiRp,
  AnkiPreserveAttrs,
];
