import { desktopPlatform } from "./desktop";
import type { Platform } from "./types";

export type {
  AvailableUpdate,
  FileFilter,
  NotificationPayload,
  NotificationPermissionState,
  NotificationsApi,
  Platform,
  UpdateDownloadProgress,
  UpdaterApi,
  WindowControls,
} from "./types";

/**
 * The host the UI runs in. Desktop only today; the future web build will pick
 * a web implementation here (e.g. from a build-time flag) without any screen
 * changing.
 */
export const platform: Platform = desktopPlatform;
