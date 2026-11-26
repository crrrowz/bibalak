import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every TanStack Query key in the UI must come from `src/lib/queryKeys.ts` so
 * domain-event invalidation prefixes always match detail and list queries.
 */
const SRC = resolve(process.cwd(), "src");
const ALLOWED = [/^lib\/queryKeys\.ts$/, /^dev\//, /\.test\.tsx?$/];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

function hasInlineQueryKey(src: string): boolean {
  const re = /\bqueryKey\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src)) !== null) {
    let i = match.index + match[0].length;
    let depth = 0;
    const start = i;
    while (i < src.length) {
      const ch = src[i];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") {
        if (depth === 0) break;
        depth--;
      } else if (ch === "," && depth === 0) break;
      i++;
    }
    if (/\[\s*["']/.test(src.slice(start, i))) return true;
  }
  return false;
}

describe("queryKeys guard", () => {
  it("defines queryKey arrays only inside src/lib/queryKeys.ts", () => {
    const offenders = sources(SRC)
      .map((p) => ({ path: relative(SRC, p).split("\\").join("/"), src: readFileSync(p, "utf8") }))
      .filter(({ path }) => !ALLOWED.some((re) => re.test(path)))
      .filter(({ src }) => hasInlineQueryKey(src))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("catches inline queryKey arrays inside ternaries and spreads", () => {
    expect(hasInlineQueryKey(`useQuery({ queryKey: cond ? ["a"] : queryKeys.decks })`)).toBe(true);
    expect(hasInlineQueryKey(`useQuery({ queryKey: cond ? queryKeys.decks : ["a"] })`)).toBe(true);
    expect(hasInlineQueryKey(`useQuery({ queryKey: [...["a", "b"], x] })`)).toBe(true);
    expect(
      hasInlineQueryKey(`useQuery({ queryKey: [...queryKeys.habitHistory(id, 12), weekStart] })`),
    ).toBe(false);
    expect(
      hasInlineQueryKey(
        `useQuery({ queryKey: queryKeys.habitHistoryAll, placeholderData: ["a"] })`,
      ),
    ).toBe(false);
  });
});
