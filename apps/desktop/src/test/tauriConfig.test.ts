import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const confPath = resolve(process.cwd(), "src-tauri/tauri.conf.json");
const releaseConfPath = resolve(process.cwd(), "src-tauri/tauri.release.conf.json");

const conf = JSON.parse(readFileSync(confPath, "utf8")) as {
  app?: { windows?: Array<{ dragDropEnabled?: boolean }> };
};
const releaseConf = JSON.parse(readFileSync(releaseConfPath, "utf8")) as {
  app?: { windows?: Array<{ dragDropEnabled?: boolean }> };
};

describe("tauri window drag-and-drop config (C1)", () => {
  it("disables native dragDropEnabled on the main window so HTML5 drag works", () => {
    expect(conf.app?.windows?.[0]?.dragDropEnabled).toBe(false);
    expect(releaseConf.app?.windows?.[0]?.dragDropEnabled).not.toBe(true);
  });
});
