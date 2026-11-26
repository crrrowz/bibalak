import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { desktopPlatform } from "./desktop";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

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
