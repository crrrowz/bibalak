import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ar } from "@/locales/ar";

/**
 * Guards for the Arabic/RTL work:
 *  - UI text goes through `t()` (no hard-coded English in JSX or user-facing props);
 *  - layout uses logical sides (ms/me/ps/pe/start/end), never left/right, so the
 *    same markup mirrors correctly in RTL.
 */
const SRC = resolve(process.cwd(), "src");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "dev" || name === "test" ? [] : tsxFiles(p);
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });
}

function uiTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      return name === "dev" || name === "test" || name === "locales" ? [] : uiTsFiles(p);
    }
    if (!p.endsWith(".ts") || p.endsWith(".test.ts") || p.endsWith(".d.ts")) return [];
    const rel = relative(SRC, p).split("\\").join("/");
    return rel.startsWith("features/") || rel.startsWith("components/") ? [p] : [];
  });
}

const files = tsxFiles(SRC).map((p) => ({
  path: relative(SRC, p).split("\\").join("/"),
  src: readFileSync(p, "utf8"),
}));

const tsHelperFiles = uiTsFiles(SRC).map((p) => ({
  path: relative(SRC, p).split("\\").join("/"),
  src: readFileSync(p, "utf8"),
}));

/** Text that is not language: brand, key caps, units, symbols. */
const ALLOWED_TEXT =
  /^(Bibalak|Anki|FSRS|FSRS-5|FSRS-6|SM-2|KaTeX|⌘K|Ctrl|Esc|Space|Enter|Tab|[A-Z]|[0-9]+|[0-9]+[a-z]?|apkg|\.apkg|\.colpkg|B|I|U|S|h1|h2|h3|h4|p|div|span|button)$/;

describe("i18n guard", () => {
  it("has no hard-coded English text in JSX or UI helper .ts files", () => {
    const offenders: string[] = [];
    for (const { path, src } of files) {
      // Text nodes: >Some words<   (ignores {expressions})
      for (const m of src.matchAll(/>\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*?)\s*</g)) {
        const text = m[1].trim();
        // Skip code that merely sits between < and > (comparisons, generics, regexes).
        const looksLikeCode = /&&|\|\||[?=;(){}/]|\.\w+\(/.test(text);
        if (
          text &&
          !looksLikeCode &&
          !ALLOWED_TEXT.test(text) &&
          !/^[=&|?:()!.,;[\]`'"+*/-]/.test(text)
        ) {
          offenders.push(`${path}: "${text.slice(0, 60)}"`);
        }
      }
      // Inline JSX ternary/fallback string expressions: {cond ? "Text" : ...} or {x ?? "Text"}
      for (const m of src.matchAll(
        />\s*\{([^}]*(?:\?|:|\|\||\?\?)\s*"([A-Z][A-Za-z0-9 ,.!?\-:'()/]{2,})")[^}]*\}\s*</g,
      )) {
        const expr = m[1];
        const val = m[2].trim();
        const beforeVal = expr.slice(0, expr.indexOf(`"${val}"`));
        if (!/\btn?\s*\(\s*"[^"]*"\s*$/.test(beforeVal) && !ALLOWED_TEXT.test(val)) {
          offenders.push(`${path}: {${val.slice(0, 60)}}`);
        }
      }
      // User-facing string props (direct string or string literals inside ternaries/expressions).
      for (const m of src.matchAll(
        /\b(placeholder|title|aria-label|ariaLabel|alt|label|description|confirmLabel|cancelLabel|emptyText|helperText|hint|heading|subtitle)=(?:"([^"]*[A-Za-z][^"]*)"|\{([\s\S]*?)\})/g,
      )) {
        const prop = m[1];
        if (m[2]) {
          if (!ALLOWED_TEXT.test(m[2])) offenders.push(`${path}: ${prop}="${m[2].slice(0, 60)}"`);
        } else if (m[3]) {
          const expr = m[3];
          for (const strMatch of expr.matchAll(/[?:,]\s*"([^"]*[A-Za-z][^"]*)"/g)) {
            const val = strMatch[1];
            // Check if string is an argument to t() or tn()
            const matchIndex = strMatch.index ?? 0;
            const prefix = expr.slice(0, matchIndex);
            if (/\btn?\s*\(\s*$/.test(prefix)) {
              continue;
            }
            if (!ALLOWED_TEXT.test(val)) offenders.push(`${path}: ${prop}="${val.slice(0, 60)}"`);
          }
        }
      }
    }
    // Check user-facing UI helper .ts files for multi-word English UI string returns or fields.
    for (const { path, src } of tsHelperFiles) {
      const noComments = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      for (const m of noComments.matchAll(
        /(?:return\s+|(?:label|title|description|message|hint|emptyText)\s*:\s*)"([A-Z][a-z]+(?:\s+[A-Za-z]{2,})+[^"]*)"/g,
      )) {
        const val = m[1].trim();
        const before = noComments.slice(Math.max(0, (m.index ?? 0) - 32), m.index ?? 0);
        if (/new\s+Error\s*\($|throw\s+$|console\.\w+\s*\($/.test(before)) continue;
        if (!ALLOWED_TEXT.test(val)) {
          offenders.push(`${path}: "${val.slice(0, 60)}"`);
        }
      }
    }
    expect(offenders, offenders.slice(0, 40).join("\n")).toEqual([]);
  });
});

describe("RTL guard", () => {
  it("uses logical sides instead of left/right utility classes", () => {
    const physical =
      /(?<![\w-])(text-(?:left|right)|(?:-?m[lr]|p[lr]|left(?!-1\/2)|right|border-[lr]|rounded-[lr]|rounded-t[lr]|rounded-b[lr]|space-x|origin-(?:top-|bottom-)?(?:left|right))-[\w./[\]-]+)(?![\w-])/g;
    const offenders: string[] = [];
    for (const { path, src } of files) {
      for (const m of src.matchAll(physical)) {
        offenders.push(`${path}: ${m[0]}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("uses Arabic 'من' instead of spaced slash fractions in ar.ts", () => {
    const offenders = Object.entries(ar)
      .filter(([, val]) => /\}\}\s+\/\s+\{\{/.test(val))
      .map(([key, val]) => `${key}: "${val}"`);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
