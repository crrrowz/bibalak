import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { desktopPlatform } from "./desktop";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
}));

describe("desktopPlatform updater install kind and release page (UPD1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.mocked(tauriInvoke).mockReset();
    vi.unstubAllGlobals();
  });

  it("asks the Rust is_portable command whether this copy is portable", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.mocked(tauriInvoke).mockResolvedValueOnce(true);
    await expect(desktopPlatform.updater.isPortable()).resolves.toBe(true);
    expect(tauriInvoke).toHaveBeenCalledWith("is_portable", undefined);
  });

  it("is never portable outside Tauri and makes no call", async () => {
    await expect(desktopPlatform.updater.isPortable()).resolves.toBe(false);
    expect(tauriInvoke).not.toHaveBeenCalled();
  });

  it("opens the release page in the system browser, only for https links", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    const url = "https://github.com/crrrowz/bibalak/releases/tag/v1.1.0";
    await desktopPlatform.updater.openReleasePage(url);
    expect(tauriOpenUrl).toHaveBeenCalledWith(url);
    await expect(desktopPlatform.updater.openReleasePage("file:///C:/x.exe")).rejects.toThrow();
    expect(tauriOpenUrl).toHaveBeenCalledTimes(1);
  });

  it("opens the release page in a new tab outside Tauri", async () => {
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    const url = "https://github.com/crrrowz/bibalak/releases/tag/v1.1.0";
    await desktopPlatform.updater.openReleasePage(url);
    expect(openSpy).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");
    expect(tauriOpenUrl).not.toHaveBeenCalled();
  });
});

describe("desktopPlatform dialog pickers (H1/F1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes pickPath through the Rust pick_open_path command", async () => {
    vi.mocked(tauriInvoke).mockResolvedValueOnce("C:/exports/deck.apkg");
    const picked = await desktopPlatform.pickPath({
      title: "Import",
      directory: false,
      filters: [{ name: "Anki", extensions: ["apkg"] }],
    });
    expect(picked).toBe("C:/exports/deck.apkg");
    expect(tauriInvoke).toHaveBeenCalledWith("pick_open_path", {
      title: "Import",
      directory: false,
      filters: [{ name: "Anki", extensions: ["apkg"] }],
    });
  });

  it("routes pickSavePath through the Rust pick_save_path command", async () => {
    vi.mocked(tauriInvoke).mockResolvedValueOnce("C:/exports/out.apkg");
    const picked = await desktopPlatform.pickSavePath({
      defaultPath: "collection.apkg",
      filters: [{ name: "Anki", extensions: ["apkg"] }],
    });
    expect(picked).toBe("C:/exports/out.apkg");
    expect(tauriInvoke).toHaveBeenCalledWith("pick_save_path", {
      defaultPath: "collection.apkg",
      filters: [{ name: "Anki", extensions: ["apkg"] }],
    });
  });
});
