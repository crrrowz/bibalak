import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from "./spinner";

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

describe("Spinner (A5-18)", () => {
  it("renders consistent sizes and keeps aria-hidden", () => {
    const { container, rerender } = render(<Spinner />);
    const sm = container.querySelector("svg");
    expect(sm).toHaveAttribute("aria-hidden", "true");
    expect(sm?.getAttribute("class")).toContain("animate-spin");
    expect(sm?.getAttribute("class")).toContain("size-3.5");

    rerender(<Spinner size="md" />);
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("size-4");
  });

  it("forbids ad-hoc Loader2 imports outside components/ui/spinner.tsx", () => {
    const srcRoot = path.resolve(__dirname, "../..");
    const files = collectSourceFiles(srcRoot);
    const offenders = files
      .filter((f) => path.basename(f) !== "spinner.tsx")
      .filter((f) => /\bLoader2\b/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(srcRoot, f));
    expect(offenders).toEqual([]);
  });
});
