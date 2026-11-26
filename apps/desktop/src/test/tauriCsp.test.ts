import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the webview Content-Security-Policy in tauri.conf.json. Card
 * templates from imported decks and plugin Workers run in this document, so
 * the CSP is what keeps them off the network and away from remote code.
 */
// Vitest runs from apps/desktop (jsdom gives import.meta.url a non-file URL).
const confPath = resolve(process.cwd(), "src-tauri/tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
const security = conf.app.security as {
  csp: Record<string, string> | string | null;
  devCsp?: Record<string, string> | string | null;
};

function directives(csp: Record<string, string> | string | null | undefined) {
  if (csp == null) return {} as Record<string, string[]>;
  const entries =
    typeof csp === "string"
      ? csp
          .split(";")
          .map((d) => d.trim())
          .filter(Boolean)
          .map((d) => [d.split(/\s+/)[0], d.split(/\s+/).slice(1).join(" ")])
      : Object.entries(csp);
  return Object.fromEntries(entries.map(([k, v]) => [k, v.split(/\s+/).filter(Boolean)]));
}

describe.each([
  ["csp", security.csp],
  ["devCsp", security.devCsp],
])("tauri %s", (_name, csp) => {
  const d = directives(csp);

  it("is set", () => {
    expect(csp).not.toBeNull();
    expect(d["default-src"]).toEqual(["'self'"]);
  });

  it("does not let scripts load from remote origins", () => {
    for (const src of d["script-src"] ?? []) {
      expect(src).not.toMatch(/^(https?:|\*|data:|blob:)/);
    }
  });

  it("does not allow unsafe-eval in script-src", () => {
    expect(d["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("limits network access to IPC and the dev server without GitHub updater hosts", () => {
    const allowed = ["'self'", "ipc:", "http://ipc.localhost", "ws://localhost:1420"];
    expect(d["connect-src"]).toBeDefined();
    for (const src of d["connect-src"]) expect(allowed).toContain(src);
    expect(d["connect-src"]).not.toContain("https://github.com");
    expect(d["connect-src"]).not.toContain("https://objects.githubusercontent.com");
    expect(d["connect-src"]).not.toContain("https://release-assets.githubusercontent.com");
  });

  it("blocks plugins, frames and base-tag tricks", () => {
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["frame-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'none'"]);
    expect(d["form-action"]).toEqual(["'none'"]);
  });

  it("allows plugin Workers only from blob: URLs", () => {
    expect(d["worker-src"]).toEqual(["'self'", "blob:"]);
  });
});

describe("tauri updater config", () => {
  it("does not bake private GitHub release endpoints into tauri.conf.json", () => {
    const endpoints: string[] = conf.plugins?.updater?.endpoints ?? [];
    expect(endpoints).toEqual([]);
  });
});
