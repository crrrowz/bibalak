import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The UI must reach the host only through `src/lib/platform` (desktop today,
 * web later). Any other file importing
 * `@tauri-apps/*` would tie that screen to the desktop shell.
 */
const SRC = resolve(process.cwd(), "src");
const ALLOWED = [/^lib\/platform\//, /^dev\//, /\.test\.tsx?$/];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

describe("platform guard", () => {
  it("imports @tauri-apps only inside src/lib/platform", () => {
    const offenders = sources(SRC)
      .map((p) => ({ path: relative(SRC, p).split("\\").join("/"), src: readFileSync(p, "utf8") }))
      .filter(({ path }) => !ALLOWED.some((re) => re.test(path)))
      .filter(({ src }) => /from\s+["']@tauri-apps\/|import\(\s*["']@tauri-apps\//.test(src))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
