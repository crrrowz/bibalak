import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const srcTauriDir = resolve(process.cwd(), "src-tauri");
const confPath = resolve(srcTauriDir, "tauri.conf.json");
const releaseConfPath = resolve(srcTauriDir, "tauri.release.conf.json");

interface NsisConfig {
  installerIcon?: string;
  headerImage?: string;
  sidebarImage?: string;
  languages?: string[];
  displayLanguageSelector?: boolean;
}

interface WixConfig {
  language?: string | string[] | Record<string, unknown>;
  bannerPath?: string;
  dialogImagePath?: string;
}

interface TauriConfigShape {
  app?: { windows?: Array<{ dragDropEnabled?: boolean }> };
  bundle?: {
    windows?: {
      nsis?: NsisConfig;
      wix?: WixConfig;
    };
  };
}

const conf = JSON.parse(readFileSync(confPath, "utf8")) as TauriConfigShape;
const releaseConf = JSON.parse(readFileSync(releaseConfPath, "utf8")) as TauriConfigShape;

function readBmpDimensions(relPath: string): { width: number; height: number } {
  const fullPath = resolve(srcTauriDir, relPath);
  expect(existsSync(fullPath), `Expected BMP file at ${fullPath}`).toBe(true);
  const buf = readFileSync(fullPath);
  expect(buf.subarray(0, 2).toString("ascii")).toBe("BM");
  return {
    width: buf.readInt32LE(18),
    height: Math.abs(buf.readInt32LE(22)),
  };
}

describe("tauri window drag-and-drop config (C1)", () => {
  it("disables native dragDropEnabled on the main window so HTML5 drag works", () => {
    expect(conf.app?.windows?.[0]?.dragDropEnabled).toBe(false);
    expect(releaseConf.app?.windows?.[0]?.dragDropEnabled).not.toBe(true);
  });
});

describe("tauri Windows installer branding (INS1)", () => {
  it("configures NSIS icon and BMP images with exact dimensions", () => {
    const nsis = conf.bundle?.windows?.nsis;
    expect(nsis?.installerIcon).toBe("icons/icon.ico");
    expect(existsSync(resolve(srcTauriDir, nsis?.installerIcon ?? ""))).toBe(true);

    expect(nsis?.headerImage).toBeTruthy();
    expect(readBmpDimensions(nsis!.headerImage!)).toEqual({ width: 150, height: 57 });

    expect(nsis?.sidebarImage).toBeTruthy();
    expect(readBmpDimensions(nsis!.sidebarImage!)).toEqual({ width: 164, height: 314 });
  });

  it("configures WiX banner and dialog BMP images with exact dimensions and en-US only", () => {
    const wix = conf.bundle?.windows?.wix;
    expect(wix?.language).toBe("en-US");

    expect(wix?.bannerPath).toBeTruthy();
    expect(readBmpDimensions(wix!.bannerPath!)).toEqual({ width: 493, height: 58 });

    expect(wix?.dialogImagePath).toBeTruthy();
    expect(readBmpDimensions(wix!.dialogImagePath!)).toEqual({ width: 493, height: 312 });
  });

  it("does not override Windows installer branding in tauri.release.conf.json", () => {
    expect(releaseConf.bundle?.windows).toBeUndefined();
  });
});
