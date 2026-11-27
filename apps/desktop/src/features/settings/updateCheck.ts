/**
 * Update checks (ADR-021, UPD1): the manual check in Settings → Updates and
 * the quiet check when the app starts, at most once a day and only while the
 * "check on start" setting is on (default on). Checking never downloads or
 * installs anything: that needs an explicit click in Settings.
 */
import { create } from "zustand";
import { errorMessage } from "@/lib/ipc";
import { platform } from "@/lib/platform";
import type { AvailableUpdate } from "@/lib/platform";
import { t } from "@/lib/i18n";
import { updateManifestUrl } from "@/lib/releases";

export const AUTO_CHECK_KEY = "keepsake-update-auto-check";
export const LAST_CHECK_KEY = "keepsake-update-last-check";
export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type UpdateCheckResult =
  | { kind: "up-to-date" }
  | { kind: "available"; version: string; notes?: string }
  | { kind: "error"; message: string }
  | null;

function readStorage(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable: keep the in-memory value
  }
}

interface UpdateCheckState {
  autoCheck: boolean;
  checking: boolean;
  result: UpdateCheckResult;
  setAutoCheck: (on: boolean) => void;
  /** Manual check from Settings: shows every outcome, errors included. */
  check: () => Promise<void>;
  setResult: (result: UpdateCheckResult) => void;
}

function toResult(update: AvailableUpdate | null | "not-available"): UpdateCheckResult {
  if (update === "not-available") {
    return { kind: "error", message: t("settings.updates.notAvailable") };
  }
  if (update === null) return { kind: "up-to-date" };
  return { kind: "available", version: update.version, notes: update.notes };
}

export const useUpdateCheck = create<UpdateCheckState>((set) => ({
  autoCheck: readStorage(AUTO_CHECK_KEY) !== "off",
  checking: false,
  result: null,

  setAutoCheck: (on) => {
    writeStorage(AUTO_CHECK_KEY, on ? "on" : "off");
    set({ autoCheck: on });
  },

  check: async () => {
    if (!updateManifestUrl()) return;
    set({ checking: true, result: null });
    try {
      set({ result: toResult(await platform.updater.check()) });
    } catch (e) {
      set({ result: { kind: "error", message: errorMessage(e) } });
    } finally {
      set({ checking: false });
    }
  },

  setResult: (result) => set({ result }),
}));

/**
 * Quiet check when the app starts. Returns the available update (so the shell
 * can show a toast) or `null`. No network call when the build cannot update
 * itself, the setting is off, or the last check was less than a day ago.
 * A failed check stays silent here; a manual check in Settings shows errors.
 */
export async function runStartupUpdateCheck(
  now: number = Date.now(),
): Promise<AvailableUpdate | null> {
  const state = useUpdateCheck.getState();
  if (!updateManifestUrl() || !state.autoCheck || state.checking) return null;

  const last = Number(readStorage(LAST_CHECK_KEY));
  if (Number.isFinite(last) && last > 0 && last <= now && now - last < AUTO_CHECK_INTERVAL_MS) {
    return null;
  }
  writeStorage(LAST_CHECK_KEY, String(now));

  try {
    const update = await platform.updater.check();
    if (update === null || update === "not-available") return null;
    useUpdateCheck.getState().setResult(toResult(update));
    return update;
  } catch {
    return null;
  }
}
