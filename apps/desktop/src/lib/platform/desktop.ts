/**
 * Tauri implementation of `Platform` — the only module in the UI that talks to
 * `@tauri-apps/*`. Tauri APIs are resolved lazily (inside each call) so the
 * dev preview can install its IPC mocks before anything touches them.
 */
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isRegistered as tauriIsShortcutRegistered,
  register as tauriRegisterShortcut,
  unregister as tauriUnregisterShortcut,
} from "@tauri-apps/plugin-global-shortcut";
import {
  isPermissionGranted as tauriIsNotificationPermissionGranted,
  requestPermission as tauriRequestNotificationPermission,
  sendNotification as tauriSendNotification,
} from "@tauri-apps/plugin-notification";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { relaunch as tauriRelaunch } from "@tauri-apps/plugin-process";
import { check as tauriCheckUpdate, type Update } from "@tauri-apps/plugin-updater";
import type {
  GlobalShortcutApi,
  NotificationsApi,
  Platform,
  UpdaterApi,
  WindowControls,
} from "./types";

function isPreviewRuntime(): boolean {
  return Boolean((globalThis as Record<string, unknown>).__BIBALAK_PREVIEW__);
}

export const desktopPlatform: Platform = {
  kind: "desktop",

  isAvailable() {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  },

  invoke<T>(command: string, args?: Record<string, unknown>) {
    return tauriInvoke<T>(command, args);
  },

  listen<T>(event: string, handler: (payload: T) => void) {
    const pending = tauriListen<T>(event, ({ payload }) => handler(payload));
    return () => {
      void pending.then((dispose) => dispose());
    };
  },

  async pickPath({ title, directory = false, filters }) {
    return tauriInvoke<string | null>("pick_open_path", {
      title: title ?? null,
      directory,
      filters: filters ?? [],
    });
  },

  async pickSavePath({ defaultPath, filters }) {
    return tauriInvoke<string | null>("pick_save_path", {
      defaultPath,
      filters: filters ?? [],
    });
  },

  // Null outside the Tauri webview (e.g. `pnpm dev:web` without mocks), so the
  // title bar simply hides its window buttons instead of throwing.
  get window() {
    return this.isAvailable() ? windowControls : null;
  },

  get globalShortcut() {
    return this.isAvailable() ? globalShortcutApi : null;
  },

  get notifications() {
    return this.isAvailable() && !isPreviewRuntime() ? notificationsApi : null;
  },

  get updater() {
    return updaterApi;
  },
};

let pendingUpdate: Update | null = null;

const updaterApi: UpdaterApi = {
  async check() {
    if (!desktopPlatform.isAvailable()) return "not-available";
    if (pendingUpdate) {
      await pendingUpdate.close().catch(() => {});
      pendingUpdate = null;
    }
    const update = await tauriCheckUpdate();
    if (!update) return null;
    pendingUpdate = update;
    return {
      version: update.version,
      notes: update.body ?? undefined,
      date: update.date ?? undefined,
    };
  },

  async downloadAndInstall(onProgress) {
    if (!desktopPlatform.isAvailable()) {
      throw new Error("Updates are not available in this environment.");
    }
    if (!pendingUpdate) {
      throw new Error("No checked update is ready to install.");
    }
    let contentLength: number | undefined;
    let downloadedBytes = 0;
    await pendingUpdate.downloadAndInstall((event) => {
      if (event.event === "Started") {
        contentLength = event.data.contentLength;
        onProgress?.({ kind: "started", contentLength });
      } else if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
        onProgress?.({
          kind: "progress",
          chunkLength: event.data.chunkLength,
          downloadedBytes,
          contentLength,
        });
      } else if (event.event === "Finished") {
        onProgress?.({ kind: "finished" });
      }
    });
  },

  async relaunch() {
    if (!desktopPlatform.isAvailable()) {
      throw new Error("Relaunch is not available in this environment.");
    }
    await tauriRelaunch();
  },

  async isPortable() {
    if (!desktopPlatform.isAvailable() || isPreviewRuntime()) return false;
    return Boolean(await tauriInvoke<boolean>("is_portable", undefined));
  },

  async openReleasePage(url) {
    if (new URL(url).protocol !== "https:") {
      throw new Error("Only https release pages can be opened.");
    }
    if (desktopPlatform.isAvailable()) {
      await tauriOpenUrl(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  },
};

const globalShortcutApi: GlobalShortcutApi = {
  async register(shortcut, onTrigger) {
    await tauriRegisterShortcut(shortcut, (event) => {
      if (event.state === "Pressed") {
        onTrigger();
      }
    });
  },
  unregister: (shortcut) => tauriUnregisterShortcut(shortcut),
  isRegistered: (shortcut) => tauriIsShortcutRegistered(shortcut),
};

const notificationsApi: NotificationsApi = {
  isPermissionGranted: () => tauriIsNotificationPermissionGranted(),
  requestPermission: () => tauriRequestNotificationPermission(),
  async sendNotification(payload) {
    tauriSendNotification({ title: payload.title, body: payload.body });
  },
};

const windowControls: WindowControls = {
  minimize: () => getCurrentWindow().minimize(),
  toggleMaximize: () => getCurrentWindow().toggleMaximize(),
  close: () => getCurrentWindow().close(),
  hide: () => getCurrentWindow().hide(),
  isMaximized: () => getCurrentWindow().isMaximized(),
  label: () => getCurrentWindow().label,
  onResized(handler) {
    const pending = getCurrentWindow().onResized(() => handler());
    return () => {
      void pending.then((dispose) => dispose());
    };
  },
};
