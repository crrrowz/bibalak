/**
 * Everything the UI needs from its host. Screens use `platform` (from
 * `@/lib/platform`) and never a host API directly, so the same UI can run in
 * the Tauri desktop shell today and in a browser against our server later
 *. `src/test/platformGuard.test.ts`
 * enforces that `@tauri-apps/*` is imported only inside this folder.
 */

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface GlobalShortcutApi {
  register(shortcut: string, onTrigger: () => void): Promise<void>;
  unregister(shortcut: string): Promise<void>;
  isRegistered(shortcut: string): Promise<boolean>;
}

export interface AvailableUpdate {
  version: string;
  notes?: string;
  date?: string;
}

export type UpdateDownloadProgress =
  | { kind: "started"; contentLength?: number }
  | { kind: "progress"; chunkLength: number; downloadedBytes: number; contentLength?: number }
  | { kind: "finished" };

export interface UpdaterApi {
  check(): Promise<AvailableUpdate | null | "not-available">;
  downloadAndInstall(onProgress?: (progress: UpdateDownloadProgress) => void): Promise<void>;
  relaunch(): Promise<void>;
  /**
   * True for a portable copy (`portable.txt` next to the executable, ADR-006).
   * A portable copy never installs updates itself: the installer would write a
   * normal install and leave the portable data behind.
   */
  isPortable(): Promise<boolean>;
  /** Open an https release/download page in the system browser. */
  openReleasePage(url: string): Promise<void>;
}

export interface WindowControls {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  hide(): Promise<void>;
  isMaximized(): Promise<boolean>;
  label(): string;
  /** Subscribe to window resizes; returns an unsubscribe function. */
  onResized(handler: () => void): () => void;
}

export interface NotificationPayload {
  title: string;
  body: string;
}

export type NotificationPermissionState = "granted" | "denied" | "default";

export interface NotificationsApi {
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<NotificationPermissionState>;
  sendNotification(payload: NotificationPayload): Promise<void>;
}

export interface Platform {
  readonly kind: "desktop" | "web";
  /** True when a backend is reachable (false in a plain browser via `pnpm dev:web`). */
  isAvailable(): boolean;
  /** Call a backend command (Tauri IPC on desktop, HTTP on the web). */
  invoke<T>(
    command: string,
    args?: Record<string, unknown> | number[] | ArrayBuffer | Uint8Array,
    options?: { headers?: Record<string, string> },
  ): Promise<T>;
  /** Subscribe to a backend event; returns an unsubscribe function. */
  listen<T>(event: string, handler: (payload: T) => void): () => void;
  /**
   * Ask the user for a file or folder on this machine and return its path
   * (`null` if cancelled). Desktop only today; the web adapter will return
   * uploaded files instead (see the web plan).
   */
  pickPath(options: {
    title?: string;
    directory?: boolean;
    filters?: FileFilter[];
  }): Promise<string | null>;
  /** Ask where to save a file; returns the chosen path or `null`. Desktop only today. */
  pickSavePath(options: { defaultPath: string; filters?: FileFilter[] }): Promise<string | null>;
  /** Open a permitted local file or folder in the OS file manager. */
  openPath?(path: string): Promise<void>;
  /** Native window controls when the app draws its own title bar; `null` otherwise. */
  readonly window: WindowControls | null;
  /** OS-wide keyboard shortcuts when running on desktop; `null` on web. */
  readonly globalShortcut: GlobalShortcutApi | null;
  /** OS desktop notifications; `null` on web, in preview, and in tests. */
  readonly notifications: NotificationsApi | null;
  /** Official Tauri in-app updater (returns `"not-available"` outside Tauri). */
  readonly updater: UpdaterApi;
}
