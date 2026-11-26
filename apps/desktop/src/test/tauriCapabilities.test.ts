import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tauriDir = resolve(process.cwd(), "src-tauri");
const libRs = readFileSync(resolve(tauriDir, "src/lib.rs"), "utf8");
const buildRs = readFileSync(resolve(tauriDir, "build.rs"), "utf8");
const defaultCap = JSON.parse(
  readFileSync(resolve(tauriDir, "capabilities/default.json"), "utf8"),
) as { windows: string[]; permissions: string[] };
const quickAddCap = JSON.parse(
  readFileSync(resolve(tauriDir, "capabilities/quick-add.json"), "utf8"),
) as { windows: string[]; permissions: string[] };

function registeredCommands(): string[] {
  const match = libRs.match(/tauri::generate_handler!\[([\s\S]*?)\]/);
  if (!match) throw new Error("generate_handler! not found in src/lib.rs");
  return [...match[1].matchAll(/commands::[a-z_]+::([a-z0-9_]+)/g)].map((m) => m[1]);
}

function manifestCommands(): string[] {
  const inlineMatch = buildRs.match(/\.commands\(&\[([\s\S]*?)\]\)/);
  const constMatch = buildRs.match(/const APP_COMMANDS:\s*&\[&str\]\s*=\s*&\[([\s\S]*?)\]/);
  const body = inlineMatch?.[1] ?? constMatch?.[1];
  if (!body) return [];
  return [...body.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
}

const ALLOWED_QUICK_ADD_COMMANDS = [
  "get_startup_error",
  "set_local_offset",
  "get_quick_add_config",
  "remember_quick_add_target",
  "hide_quick_add",
  "list_notetypes",
  "list_decks",
  "list_tags",
  "get_notetype",
  "check_duplicate",
  "add_note",
  "save_media",
].map((c) => `allow-${c.replace(/_/g, "-")}`);

describe("tauri per-window command capabilities (H1)", () => {
  it("declares every registered command in build.rs AppManifest::commands", () => {
    const registered = registeredCommands();
    const declared = manifestCommands();
    expect(registered.length).toBeGreaterThan(100);
    expect(new Set(declared)).toEqual(new Set(registered));
    expect(declared.length).toBe(registered.length);
  });

  it("grants all app commands to the main window and removes raw dialog plugin access", () => {
    expect(defaultCap.windows).toEqual(["main"]);
    expect(defaultCap.permissions).not.toContain("dialog:default");
    for (const cmd of registeredCommands()) {
      expect(defaultCap.permissions).toContain(`allow-${cmd.replace(/_/g, "-")}`);
    }
  });

  it("quick_add_window_cannot_call_admin_commands", () => {
    expect(quickAddCap.windows).toEqual(["quick-add"]);
    const appAllows = quickAddCap.permissions.filter((p) => p.startsWith("allow-"));
    expect(new Set(appAllows)).toEqual(new Set(ALLOWED_QUICK_ADD_COMMANDS));

    for (const forbidden of [
      "allow-delete-backup",
      "allow-restore-backup",
      "allow-export-package",
      "allow-import-package",
      "allow-install-plugin",
      "allow-delete-notes",
      "allow-delete-deck",
      "allow-optimize-db",
      "allow-ai-set-config",
      "allow-ai-run-action",
      "allow-pick-open-path",
      "allow-pick-save-path",
      "dialog:default",
      "updater:allow-download-and-install",
      "process:allow-restart",
    ]) {
      expect(quickAddCap.permissions).not.toContain(forbidden);
    }
  });
});
