import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as releasesModule from "@/lib/releases";
import {
  AUTO_CHECK_INTERVAL_MS,
  AUTO_CHECK_KEY,
  LAST_CHECK_KEY,
  runStartupUpdateCheck,
  useUpdateCheck,
} from "./updateCheck";

const { checkMock } = vi.hoisted(() => ({
  checkMock: vi.fn<() => Promise<{ version: string; notes?: string } | null | "not-available">>(
    async () => null,
  ),
}));

vi.mock("@/lib/platform", () => ({
  platform: {
    updater: {
      check: () => checkMock(),
      downloadAndInstall: vi.fn(),
      relaunch: vi.fn(),
      isPortable: vi.fn(async () => false),
      openReleasePage: vi.fn(),
    },
  },
}));

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);

function signedBuild() {
  vi.spyOn(releasesModule, "updateManifestUrl").mockReturnValue(
    "https://github.com/crrrowz/bibalak/releases/latest/download/latest.json",
  );
}

describe("update check on start (UPD1)", () => {
  beforeEach(() => {
    checkMock.mockReset().mockResolvedValue(null);
    localStorage.clear();
    useUpdateCheck.setState({ autoCheck: true, checking: false, result: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("is on by default", () => {
    expect(useUpdateCheck.getState().autoCheck).toBe(true);
  });

  it("checks once on start, records the time and keeps the result for Settings", async () => {
    signedBuild();
    checkMock.mockResolvedValueOnce({ version: "1.1.0", notes: "Faster" });

    const found = await runStartupUpdateCheck(NOW);

    expect(found).toEqual({ version: "1.1.0", notes: "Faster" });
    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(LAST_CHECK_KEY)).toBe(String(NOW));
    expect(useUpdateCheck.getState().result).toEqual({
      kind: "available",
      version: "1.1.0",
      notes: "Faster",
    });
  });

  it("checks at most once a day", async () => {
    signedBuild();
    localStorage.setItem(LAST_CHECK_KEY, String(NOW - AUTO_CHECK_INTERVAL_MS + 60_000));
    expect(await runStartupUpdateCheck(NOW)).toBeNull();
    expect(checkMock).not.toHaveBeenCalled();

    localStorage.setItem(LAST_CHECK_KEY, String(NOW - AUTO_CHECK_INTERVAL_MS));
    await runStartupUpdateCheck(NOW);
    expect(checkMock).toHaveBeenCalledTimes(1);
  });

  it("makes no network call when the setting is off", async () => {
    signedBuild();
    useUpdateCheck.getState().setAutoCheck(false);
    expect(localStorage.getItem(AUTO_CHECK_KEY)).toBe("off");

    expect(await runStartupUpdateCheck(NOW)).toBeNull();
    expect(checkMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(LAST_CHECK_KEY)).toBeNull();
  });

  it("makes no network call in a build that cannot update itself", async () => {
    vi.spyOn(releasesModule, "updateManifestUrl").mockReturnValue(null);
    expect(await runStartupUpdateCheck(NOW)).toBeNull();
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("stays quiet on a failed start-up check and does not suppress retries for 24 hours (A5-02)", async () => {
    signedBuild();
    checkMock.mockRejectedValueOnce(new Error("offline"));
    expect(await runStartupUpdateCheck(NOW)).toBeNull();
    expect(useUpdateCheck.getState().result).toBeNull();
    expect(localStorage.getItem(LAST_CHECK_KEY)).toBeNull();

    // Coming back online 5 minutes later should still check and stamp on success.
    checkMock.mockResolvedValueOnce({ version: "1.2.0" });
    const found = await runStartupUpdateCheck(NOW + 5 * 60_000);
    expect(found).toEqual({ version: "1.2.0" });
    expect(checkMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(LAST_CHECK_KEY)).toBe(String(NOW + 5 * 60_000));
  });

  it("a manual check shows errors plainly", async () => {
    signedBuild();
    checkMock.mockRejectedValueOnce(new Error("Network error"));
    await useUpdateCheck.getState().check();
    expect(useUpdateCheck.getState().result).toEqual({ kind: "error", message: "Network error" });
    expect(useUpdateCheck.getState().checking).toBe(false);
  });
});
