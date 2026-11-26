import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInfo, BackupInfo, MediaReport, PluginInfo } from "@bibalak/ipc-types";
import { SettingsScreen } from "./SettingsScreen";
import { setLocale } from "@/lib/i18n";
import * as ipcModule from "@/lib/ipc";
import { pluginHost } from "@/lib/pluginHost";
import * as releasesModule from "@/lib/releases";
import { useStyle } from "@/stores/style";
import { useTheme } from "@/stores/theme";
import { useReminders } from "@/stores/reminders";

const {
  isAvailableMock,
  pickPathMock,
  pickSavePathMock,
  invokeMock,
  updaterCheckMock,
  updaterDownloadAndInstallMock,
  updaterRelaunchMock,
  notifIsGrantedMock,
  notifRequestPermissionMock,
  notifSendMock,
} = vi.hoisted(() => ({
  isAvailableMock: vi.fn(() => true),
  pickPathMock: vi.fn<() => Promise<string | null>>(async () => null),
  pickSavePathMock: vi.fn<() => Promise<string | null>>(async () => null),
  invokeMock: vi.fn(),
  updaterCheckMock: vi.fn<
    () => Promise<{ version: string; notes?: string; date?: string } | null | "not-available">
  >(async () => null),
  updaterDownloadAndInstallMock: vi.fn<
    (
      onProgress?: (p: { kind: string; downloadedBytes?: number; contentLength?: number }) => void,
    ) => Promise<void>
  >(async () => {}),
  updaterRelaunchMock: vi.fn<() => Promise<void>>(async () => {}),
  notifIsGrantedMock: vi.fn<() => Promise<boolean>>(async () => true),
  notifRequestPermissionMock: vi.fn<() => Promise<"granted" | "denied" | "default">>(
    async () => "granted",
  ),
  notifSendMock: vi.fn<() => Promise<void>>(async () => {}),
}));

vi.mock("@/lib/platform", () => ({
  platform: {
    kind: "desktop",
    isAvailable: () => isAvailableMock(),
    invoke: (...args: unknown[]) => invokeMock(...args),
    listen: () => () => {},
    pickPath: () => pickPathMock(),
    pickSavePath: () => pickSavePathMock(),
    window: null,
    globalShortcut: null,
    notifications: {
      isPermissionGranted: () => notifIsGrantedMock(),
      requestPermission: () => notifRequestPermissionMock(),
      sendNotification: () => notifSendMock(),
    },
    updater: {
      check: () => updaterCheckMock(),
      downloadAndInstall: (
        onProgress?: (p: {
          kind: string;
          downloadedBytes?: number;
          contentLength?: number;
        }) => void,
      ) => updaterDownloadAndInstallMock(onProgress),
      relaunch: () => updaterRelaunchMock(),
    },
  },
}));

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {}
  emit(msg: unknown) {
    this.onmessage?.({ data: msg } as MessageEvent);
  }
}

const DEFAULT_APP_INFO: AppInfo = {
  name: "Bibalak",
  version: "1.0.0",
  tauri_version: "2.0.0",
  media_dir: "C:/keepsake/collection.media",
};

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsScreen />
    </QueryClientProvider>,
  );
}

function setupDefaultTauriIpc(overrides?: {
  backups?: BackupInfo[];
  plugins?: PluginInfo[];
  rolloverHour?: number;
  appInfo?: AppInfo;
  legacyMediaPending?: boolean;
}) {
  vi.spyOn(ipcModule.ipc, "getCollectionPrefs").mockResolvedValue({
    rollover_hour: overrides?.rolloverHour ?? 4,
  });
  vi.spyOn(ipcModule.ipc, "getQuickAddConfig").mockResolvedValue({
    enabled: false,
    shortcut: "Ctrl+Shift+K",
    last_deck_id: null,
    last_notetype_id: null,
  });
  vi.spyOn(ipcModule.ipc, "aiGetConfig").mockResolvedValue({
    enabled: false,
    provider: "open-ai-compatible",
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    has_api_key: false,
  });
  vi.spyOn(ipcModule.ipc, "listBackups").mockResolvedValue(overrides?.backups ?? []);
  vi.spyOn(ipcModule.ipc, "listPlugins").mockResolvedValue(overrides?.plugins ?? []);
  vi.spyOn(ipcModule.ipc, "appInfo").mockResolvedValue(overrides?.appInfo ?? DEFAULT_APP_INFO);
  vi.spyOn(ipcModule.ipc, "legacyMediaPending").mockResolvedValue(
    overrides?.legacyMediaPending ?? false,
  );
}

describe("SettingsScreen (Q2)", () => {
  beforeEach(() => {
    FakeWorker.all = [];
    isAvailableMock.mockReturnValue(true);
    pickPathMock.mockReset().mockResolvedValue(null);
    pickSavePathMock.mockReset().mockResolvedValue(null);
    invokeMock.mockReset();
    updaterCheckMock.mockReset().mockResolvedValue(null);
    updaterDownloadAndInstallMock.mockReset().mockResolvedValue(undefined);
    updaterRelaunchMock.mockReset().mockResolvedValue(undefined);
    notifIsGrantedMock.mockReset().mockResolvedValue(true);
    notifRequestPermissionMock.mockReset().mockResolvedValue("granted");
    notifSendMock.mockReset().mockResolvedValue(undefined);
    useReminders.getState().reset();
    vi.stubGlobal("Worker", FakeWorker);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    pluginHost.destroyAll();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setLocale("en");
    useTheme.getState().setTheme("system");
    useStyle.getState().setStyle("default");
    localStorage.clear();
    sessionStorage.clear();
  });

  it("1. in web mode renders only theme, language, and scheduling without any IPC sections or calls", async () => {
    isAvailableMock.mockReturnValue(false);
    const prefsSpy = vi.spyOn(ipcModule.ipc, "getCollectionPrefs");
    const backupsSpy = vi.spyOn(ipcModule.ipc, "listBackups");
    const pluginsSpy = vi.spyOn(ipcModule.ipc, "listPlugins");
    const appInfoSpy = vi.spyOn(ipcModule.ipc, "appInfo");
    const user = userEvent.setup();

    renderScreen();

    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Language" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Study" }));
    expect(await screen.findByRole("heading", { name: "Scheduling" })).toBeInTheDocument();

    expect(screen.queryByRole("tab", { name: "Export" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Data & backup" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Maintenance" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Plugins" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Updates" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Quick add" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "AI assistant" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Day starts at")).not.toBeInTheDocument();

    expect(prefsSpy).not.toHaveBeenCalled();
    expect(backupsSpy).not.toHaveBeenCalled();
    expect(pluginsSpy).not.toHaveBeenCalled();
    expect(appInfoSpy).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("2. in Tauri mode renders every settings section heading", async () => {
    setupDefaultTauriIpc();
    const user = userEvent.setup();
    renderScreen();

    // General
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Language" })).toBeInTheDocument();

    // Study
    await user.click(screen.getByRole("tab", { name: "Study" }));
    expect(await screen.findByRole("heading", { name: "Scheduling" })).toBeInTheDocument();

    // Quick add
    await user.click(screen.getByRole("tab", { name: "Quick add" }));
    expect(await screen.findByRole("heading", { name: "Quick add window" })).toBeInTheDocument();

    // AI assistant
    await user.click(screen.getByRole("tab", { name: "AI assistant" }));
    expect(await screen.findByRole("heading", { name: "AI assistant" })).toBeInTheDocument();

    // Data & backup
    await user.click(screen.getByRole("tab", { name: "Data & backup" }));
    expect(await screen.findByRole("heading", { name: "Export" })).toBeInTheDocument();

    // Maintenance
    await user.click(screen.getByRole("tab", { name: "Maintenance" }));
    expect(await screen.findByRole("heading", { name: "Maintenance" })).toBeInTheDocument();

    // Plugins
    await user.click(screen.getByRole("tab", { name: "Plugins" }));
    expect(await screen.findByRole("heading", { name: "Plugins" })).toBeInTheDocument();

    // Updates
    await user.click(screen.getByRole("tab", { name: "Updates" }));
    expect(await screen.findByRole("heading", { name: "Updates" })).toBeInTheDocument();
  });

  it("3. theme radiogroup updates useTheme and moves aria-checked", async () => {
    isAvailableMock.mockReturnValue(false);
    const user = userEvent.setup();
    renderScreen();

    const group = screen.getByRole("radiogroup", { name: "Theme" });
    const lightRadio = within(group).getByRole("radio", { name: "Light" });
    const darkRadio = within(group).getByRole("radio", { name: "Dark" });
    const systemRadio = within(group).getByRole("radio", { name: "System" });

    expect(systemRadio).toHaveAttribute("aria-checked", "true");
    expect(darkRadio).toHaveAttribute("aria-checked", "false");

    await user.click(darkRadio);
    expect(useTheme.getState().theme).toBe("dark");
    expect(darkRadio).toHaveAttribute("aria-checked", "true");
    expect(systemRadio).toHaveAttribute("aria-checked", "false");

    await user.click(lightRadio);
    expect(useTheme.getState().theme).toBe("light");
    expect(lightRadio).toHaveAttribute("aria-checked", "true");
    expect(darkRadio).toHaveAttribute("aria-checked", "false");
  });

  it("3b. style radiogroup selects Scholar and Game and updates <html>", async () => {
    isAvailableMock.mockReturnValue(false);
    const user = userEvent.setup();
    renderScreen();

    const group = screen.getByRole("radiogroup", { name: "Style" });
    const defaultRadio = within(group).getByRole("radio", { name: "Default" });
    const scholarRadio = within(group).getByRole("radio", { name: "Scholar" });
    const gameRadio = within(group).getByRole("radio", { name: "Game" });

    expect(defaultRadio).toHaveAttribute("aria-checked", "true");
    expect(scholarRadio).toHaveAttribute("aria-checked", "false");
    expect(gameRadio).toBeEnabled();
    expect(gameRadio).toHaveAttribute("aria-checked", "false");

    await user.click(scholarRadio);
    expect(useStyle.getState().style).toBe("scholar");
    expect(scholarRadio).toHaveAttribute("aria-checked", "true");
    expect(defaultRadio).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.getAttribute("data-style")).toBe("scholar");

    await user.click(gameRadio);
    expect(useStyle.getState().style).toBe("game");
    expect(gameRadio).toHaveAttribute("aria-checked", "true");
    expect(scholarRadio).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.getAttribute("data-style")).toBe("game");

    defaultRadio.focus();
    await user.keyboard("{Enter}");
    expect(useStyle.getState().style).toBe("default");
    expect(defaultRadio).toHaveAttribute("aria-checked", "true");
  });

  it("3c. certificate name field appears only in Scholar style and saves trimmed <= 60 chars", async () => {
    isAvailableMock.mockReturnValue(false);
    const user = userEvent.setup();
    renderScreen();

    expect(screen.queryByLabelText("Name on certificates")).not.toBeInTheDocument();

    const group = screen.getByRole("radiogroup", { name: "Style" });
    await user.click(within(group).getByRole("radio", { name: "Scholar" }));

    const input = await screen.findByLabelText("Name on certificates");
    expect(input).toBeInTheDocument();
    await user.type(input, "  Dr. Ada Lovelace  ");
    expect(localStorage.getItem("keepsake-scholar-name")).toBe("Dr. Ada Lovelace");

    await user.click(within(group).getByRole("radio", { name: "Default" }));
    expect(screen.queryByLabelText("Name on certificates")).not.toBeInTheDocument();
  });

  it("4. language radiogroup exposes lang attributes and flips UI strings to Arabic", async () => {
    isAvailableMock.mockReturnValue(false);
    const user = userEvent.setup();
    renderScreen();

    const group = screen.getByRole("radiogroup", { name: "Language" });
    const enRadio = within(group).getByRole("radio", { name: "English" });
    const arRadio = within(group).getByRole("radio", { name: "العربية" });

    expect(enRadio).toHaveAttribute("lang", "en");
    expect(arRadio).toHaveAttribute("lang", "ar");
    expect(enRadio).toHaveAttribute("aria-checked", "true");

    await user.click(arRadio);

    expect(arRadio).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(screen.getByRole("heading", { name: "المظهر" })).toBeInTheDocument();
  });

  it("4b. theme, style and language radiogroups support roving tabindex and RTL-aware arrow keys", async () => {
    isAvailableMock.mockReturnValue(false);
    const user = userEvent.setup();
    renderScreen();

    // Theme group (LTR): Light, Dark, System (System checked initially)
    const themeGroup = screen.getByRole("radiogroup", { name: "Theme" });
    const lightRadio = within(themeGroup).getByRole("radio", { name: "Light" });
    const darkRadio = within(themeGroup).getByRole("radio", { name: "Dark" });
    const systemRadio = within(themeGroup).getByRole("radio", { name: "System" });

    expect(systemRadio).toHaveAttribute("tabIndex", "0");
    expect(lightRadio).toHaveAttribute("tabIndex", "-1");
    expect(darkRadio).toHaveAttribute("tabIndex", "-1");

    systemRadio.focus();
    await user.keyboard("{ArrowRight}");
    expect(useTheme.getState().theme).toBe("light");
    expect(lightRadio).toHaveFocus();
    expect(lightRadio).toHaveAttribute("tabIndex", "0");
    expect(systemRadio).toHaveAttribute("tabIndex", "-1");

    await user.keyboard("{End}");
    expect(useTheme.getState().theme).toBe("system");
    expect(systemRadio).toHaveFocus();

    await user.keyboard("{Home}");
    expect(useTheme.getState().theme).toBe("light");
    expect(lightRadio).toHaveFocus();

    // Style group: Default, Scholar, Game
    const styleGroup = screen.getByRole("radiogroup", { name: "Style" });
    const defaultRadio = within(styleGroup).getByRole("radio", { name: "Default" });
    const scholarRadio = within(styleGroup).getByRole("radio", { name: "Scholar" });
    const gameRadio = within(styleGroup).getByRole("radio", { name: "Game" });
    expect(defaultRadio).toHaveAttribute("tabIndex", "0");
    expect(scholarRadio).toHaveAttribute("tabIndex", "-1");
    expect(gameRadio).toHaveAttribute("tabIndex", "-1");

    defaultRadio.focus();
    await user.keyboard("{End}");
    expect(useStyle.getState().style).toBe("game");
    expect(gameRadio).toHaveFocus();
    expect(gameRadio).toHaveAttribute("tabIndex", "0");
    expect(defaultRadio).toHaveAttribute("tabIndex", "-1");

    await user.keyboard("{Home}");
    expect(useStyle.getState().style).toBe("default");
    expect(defaultRadio).toHaveFocus();

    // Language group: ArrowRight in LTR switches to Arabic (RTL), then ArrowRight in RTL goes back to English
    const langGroup = screen.getByRole("radiogroup", { name: "Language" });
    const enRadio = within(langGroup).getByRole("radio", { name: "English" });
    const arRadio = within(langGroup).getByRole("radio", { name: "العربية" });
    expect(enRadio).toHaveAttribute("tabIndex", "0");
    expect(arRadio).toHaveAttribute("tabIndex", "-1");

    enRadio.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.documentElement.dir).toBe("rtl");
    expect(arRadio).toHaveFocus();
    expect(arRadio).toHaveAttribute("tabIndex", "0");

    // In RTL, ArrowRight moves previous -> English
    await user.keyboard("{ArrowRight}");
    expect(document.documentElement.dir).toBe("ltr");
    expect(enRadio).toHaveFocus();
  });

  it("5. export opens ExportDialog for collection scope, runs export, and handles cancel and error", async () => {
    sessionStorage.setItem("keepsake-settings-category", "data");
    setupDefaultTauriIpc();
    const user = userEvent.setup();

    vi.spyOn(ipcModule.ipc, "getExportEstimate").mockResolvedValue({
      notes: 5,
      cards: 10,
      media_files: 3,
      media_bytes: 1024,
    });
    const exportSpy = vi.spyOn(ipcModule.ipc, "exportPackage").mockResolvedValue({
      notes_exported: 5,
      cards_exported: 10,
      media_exported: 3,
      media_skipped_missing: 0,
      bytes_written: 2048,
    });
    pickSavePathMock.mockResolvedValueOnce("C:/exports/collection.apkg");

    renderScreen();

    await user.click(screen.getByRole("button", { name: "Export .apkg" }));
    expect(await screen.findByRole("heading", { name: "Export collection" })).toBeInTheDocument();
    expect(await screen.findByText(/10 cards/)).toBeInTheDocument();

    // Cancel inside configure closes dialog without calling exportPackage
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Export collection" })).not.toBeInTheDocument();
    });
    expect(exportSpy).not.toHaveBeenCalled();

    // Reopen and confirm export
    await user.click(screen.getByRole("button", { name: "Export .apkg" }));
    await user.click(await screen.findByRole("button", { name: "Export…" }));
    expect(await screen.findByText("Export complete")).toBeInTheDocument();
    expect(exportSpy).toHaveBeenCalledTimes(1);
    expect(exportSpy.mock.calls[0][0].scope).toEqual({ kind: "collection" });
    await user.click(screen.getByRole("button", { name: "Done" }));

    // Rejection displays error in role="alert"
    pickSavePathMock.mockResolvedValueOnce("C:/exports/collection.apkg");
    exportSpy.mockRejectedValueOnce({ kind: "storage", message: "Disk full" });
    await user.click(screen.getByRole("button", { name: "Export .apkg" }));
    await user.click(await screen.findByRole("button", { name: "Export…" }));

    const errEl = await screen.findByRole("alert");
    expect(errEl).toHaveTextContent("Disk full");
  });

  it("6. backup renders list from listBackups and creates a new backup with formatted size", async () => {
    sessionStorage.setItem("keepsake-settings-category", "data");
    const initialBackups: BackupInfo[] = [
      { name: "backup-2026-11-15.colpkg", created_ms: 1700000000000, size_bytes: 2048 },
    ];
    setupDefaultTauriIpc({ backups: initialBackups });
    const createSpy = vi.spyOn(ipcModule.ipc, "createBackup").mockResolvedValue({
      name: "backup-2026-11-16.colpkg",
      created_ms: 1700086400000,
      size_bytes: 4096,
    });
    const listSpy = vi.spyOn(ipcModule.ipc, "listBackups");
    const user = userEvent.setup();

    renderScreen();

    expect(await screen.findByText("2.0 KB")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Backup now" }));

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("Backup created: backup-2026-11-16.colpkg (4.0 KB)"),
    ).toBeInTheDocument();
    expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("7. restore requires inline confirm; cancel aborts and confirm calls restoreBackup", async () => {
    sessionStorage.setItem("keepsake-settings-category", "data");
    const backups: BackupInfo[] = [
      { name: "snap-1.colpkg", created_ms: 1700000000000, size_bytes: 512 },
    ];
    setupDefaultTauriIpc({ backups });
    const restoreSpy = vi.spyOn(ipcModule.ipc, "restoreBackup").mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderScreen();

    await user.click(await screen.findByRole("button", { name: "Restore" }));
    expect(screen.getByText('Restore backup "snap-1.colpkg"?')).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText('Restore backup "snap-1.colpkg"?')).not.toBeInTheDocument();
    expect(restoreSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Restore" }));
    await user.click(screen.getByRole("button", { name: "Yes, restore" }));

    expect(restoreSpy).toHaveBeenCalledWith("snap-1.colpkg");
    expect(
      await screen.findByText("Backup restored. Restart Bibalak to apply."),
    ).toBeInTheDocument();
  });

  it("8. delete backup calls deleteBackup with the right name", async () => {
    sessionStorage.setItem("keepsake-settings-category", "data");
    const backups: BackupInfo[] = [
      { name: "old-snap.colpkg", created_ms: 1700000000000, size_bytes: 1024 },
    ];
    setupDefaultTauriIpc({ backups });
    const deleteSpy = vi.spyOn(ipcModule.ipc, "deleteBackup").mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderScreen();

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(deleteSpy).toHaveBeenCalledWith("old-snap.colpkg");
  });

  it("BW2-18: aligns backup rows in fixed columns (name+date, size, end-aligned actions) in EN and AR", async () => {
    sessionStorage.setItem("keepsake-settings-category", "data");
    const backups: BackupInfo[] = [
      { name: "b1.colpkg", created_ms: 1700000000000, size_bytes: 512 },
      {
        name: "backup-2026-11-18-before-major-import.colpkg",
        created_ms: 1700691200000,
        size_bytes: 14_889_779,
      },
    ];
    setupDefaultTauriIpc({ backups });

    const { unmount } = renderScreen();

    const firstRowName = await screen.findByText("b1.colpkg");
    expect(screen.getByText("backup-2026-11-18-before-major-import.colpkg")).toBeInTheDocument();

    const list = firstRowName.closest("ul")!;
    const rows = Array.from(list.querySelectorAll("li"));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.className).toContain("grid");
      expect(row.className).not.toContain("justify-between");
      const actions = row.querySelector('[data-testid="backup-row-actions"]');
      expect(actions).not.toBeNull();
      expect(actions!.className).toContain("justify-end");
      expect(actions!.querySelectorAll("button")).toHaveLength(2);
    }

    unmount();

    setLocale("ar");
    sessionStorage.setItem("keepsake-settings-category", "data");
    setupDefaultTauriIpc({ backups });
    renderScreen();

    const arName = await screen.findByText("b1.colpkg");
    const arRows = Array.from(arName.closest("ul")!.querySelectorAll("li"));
    expect(arRows).toHaveLength(2);
    for (const row of arRows) {
      expect(row.className).toContain("grid");
      const actions = row.querySelector('[data-testid="backup-row-actions"]');
      expect(actions).not.toBeNull();
      expect(actions!.className).toContain("justify-end");
    }
  });

  it("9. integrity check shows healthy message or lists problem rows", async () => {
    sessionStorage.setItem("keepsake-settings-category", "maintenance");
    setupDefaultTauriIpc();
    const integritySpy = vi
      .spyOn(ipcModule.ipc, "checkIntegrity")
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["Missing deck row 42", "Orphan card 99"]);
    const user = userEvent.setup();

    renderScreen();

    await user.click(screen.getByRole("button", { name: "Check integrity" }));
    expect(await screen.findByText("Database is healthy.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Check integrity" }));
    expect(await screen.findByText("Missing deck row 42")).toBeInTheDocument();
    expect(screen.getByText("Orphan card 99")).toBeInTheDocument();
    expect(integritySpy).toHaveBeenCalledTimes(2);
  });

  it("10. optimize database calls optimizeDb and shows done message", async () => {
    sessionStorage.setItem("keepsake-settings-category", "maintenance");
    setupDefaultTauriIpc();
    const optimizeSpy = vi.spyOn(ipcModule.ipc, "optimizeDb").mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderScreen();

    await user.click(screen.getByRole("button", { name: "Optimize database" }));
    expect(optimizeSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Database compacted and optimized.")).toBeInTheDocument();
  });

  it("11. media check reports consistent, missing files, and confirms orphan deletion", async () => {
    sessionStorage.setItem("keepsake-settings-category", "maintenance");
    setupDefaultTauriIpc();
    const consistent: MediaReport = { orphan_files: [], missing_files: [] };
    const withIssues: MediaReport = {
      orphan_files: ["unused-a.png", "unused-b.mp3"],
      missing_files: ["lost-diagram.svg"],
    };
    vi.spyOn(ipcModule.ipc, "checkMedia")
      .mockResolvedValueOnce(consistent)
      .mockResolvedValueOnce(withIssues);
    const deleteOrphanSpy = vi.spyOn(ipcModule.ipc, "deleteOrphanMedia").mockResolvedValue(2);
    const user = userEvent.setup();

    renderScreen();

    await user.click(screen.getByRole("button", { name: "Check media" }));
    expect(await screen.findByText("All media files are consistent.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Check media" }));
    expect(
      await screen.findByText("Orphan files (2) — on disk but not referenced by any note:"),
    ).toBeInTheDocument();
    expect(screen.getByText("unused-a.png")).toBeInTheDocument();
    expect(screen.getByText("unused-b.mp3")).toBeInTheDocument();
    expect(
      screen.getByText("Missing files (1) — referenced in notes but not on disk:"),
    ).toBeInTheDocument();
    expect(screen.getByText("lost-diagram.svg")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete orphan files…" }));
    expect(screen.getByText("Delete 2 orphan files?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(deleteOrphanSpy).toHaveBeenCalledWith(["unused-a.png", "unused-b.mp3"]);
    expect(await screen.findByText("Deleted 2 orphan files.")).toBeInTheDocument();
  });

  it("12. plugins handles empty state, permission confirm, enable/disable, and install flows", async () => {
    sessionStorage.setItem("keepsake-settings-category", "plugins");
    setupDefaultTauriIpc({ plugins: [] });
    const user = userEvent.setup();

    const { unmount } = renderScreen();
    expect(await screen.findByText("No plugins installed.")).toBeInTheDocument();

    // Install cancelled (pickPath returns null) -> no installPlugin call
    const installSpy = vi.spyOn(ipcModule.ipc, "installPlugin");
    pickPathMock.mockResolvedValueOnce(null);
    await user.click(screen.getByRole("button", { name: "Install plugin…" }));
    expect(installSpy).not.toHaveBeenCalled();

    // Install error -> shown in plugin alert and toast
    pickPathMock.mockResolvedValueOnce("C:/plugins/broken");
    installSpy.mockRejectedValueOnce({ message: "Invalid plugin manifest" });
    await user.click(screen.getByRole("button", { name: "Install plugin…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid plugin manifest");

    unmount();

    // Enable with permissions (decline vs accept) and Disable
    const disabledPlugin: PluginInfo = {
      id: "demo-plugin",
      name: "Demo Plugin",
      version: "1.2.0",
      api_version: "0.2.0",
      description: "Adds helper tools",
      author: "Hassan",
      permissions: ["read:decks", "ui:command"],
      enabled: false,
    };
    const enabledPlugin: PluginInfo = { ...disabledPlugin, enabled: true };
    setupDefaultTauriIpc({ plugins: [disabledPlugin] });
    const listPluginsSpy = vi
      .spyOn(ipcModule.ipc, "listPlugins")
      .mockResolvedValueOnce([disabledPlugin])
      .mockResolvedValueOnce([enabledPlugin])
      .mockResolvedValueOnce([disabledPlugin]);
    const enableSpy = vi.spyOn(ipcModule.ipc, "enablePlugin").mockResolvedValue(undefined);
    const entrySpy = vi.spyOn(ipcModule.ipc, "getPluginEntry").mockResolvedValue("/* entry */");
    const disableSpy = vi.spyOn(ipcModule.ipc, "disablePlugin").mockResolvedValue(undefined);
    const loadSpy = vi.spyOn(pluginHost, "load");
    const unloadSpy = vi.spyOn(pluginHost, "unload");

    renderScreen();

    const enableBtn = await screen.findByRole("button", { name: "Enable" });
    // Declined in Consent Dialog -> enablePlugin not called
    await user.click(enableBtn);
    const consentDialog = await screen.findByRole("dialog");
    expect(consentDialog).toHaveTextContent("Demo Plugin");
    expect(consentDialog).toHaveTextContent("Read your deck names and due card counts");
    expect(consentDialog).toHaveTextContent("Add commands to the command palette");
    expect(enableSpy).not.toHaveBeenCalled();
    await user.click(within(consentDialog).getByRole("button", { name: "Cancel" }));
    expect(enableSpy).not.toHaveBeenCalled();

    // Accepted -> enablePlugin + getPluginEntry + pluginHost.load
    await user.click(enableBtn);
    await user.click(await screen.findByRole("button", { name: "Allow and enable" }));
    await waitFor(() => {
      expect(enableSpy).toHaveBeenCalledWith("demo-plugin");
      expect(entrySpy).toHaveBeenCalledWith("demo-plugin");
      expect(loadSpy).toHaveBeenCalledWith(
        "demo-plugin",
        ["read:decks", "ui:command"],
        "/* entry */",
        expect.objectContaining({ id: "demo-plugin", apiVersion: "0.2.0" }),
      );
    });

    // Now enabled -> clicking Enabled disables it
    const enabledBtn = await screen.findByRole("button", { name: "Enabled" });
    await user.click(enabledBtn);
    await waitFor(() => {
      expect(disableSpy).toHaveBeenCalledWith("demo-plugin");
      expect(unloadSpy).toHaveBeenCalledWith("demo-plugin");
    });
    expect(listPluginsSpy).toHaveBeenCalled();

    // Plugin commands registered on pluginHost can be invoked via Run
    pluginHost.load("cmd-plugin", ["ui:command"], "");
    FakeWorker.all[FakeWorker.all.length - 1]?.emit({
      type: "register:command",
      id: "say-hi",
      title: "Say Hi",
    });
    const invokeSpy = vi.spyOn(pluginHost, "invokeCommand");
    const cmdScreen = renderScreen();
    await user.click(await within(cmdScreen.container).findByRole("button", { name: "Run" }));
    expect(invokeSpy).toHaveBeenCalledWith("cmd-plugin", "say-hi");
    expect(await within(cmdScreen.container).findByText("Invoked: Say Hi")).toBeInTheDocument();
  });

  it("13. updates hides check button when DOWNLOAD_SITE is null, and handles check, install with progress, up-to-date, and alert errors", async () => {
    sessionStorage.setItem("keepsake-settings-category", "updates");
    setupDefaultTauriIpc({ appInfo: { ...DEFAULT_APP_INFO, version: "1.0.0" } });
    const user = userEvent.setup();

    const { unmount } = renderScreen();
    expect(
      await screen.findByText(
        "Automatic updates are off in this version. Get new versions from the Releases page: github.com/crrrowz/bibalak/releases",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check for updates" })).not.toBeInTheDocument();
    expect(updaterCheckMock).not.toHaveBeenCalled();

    unmount();

    vi.spyOn(releasesModule, "updateManifestUrl").mockReturnValue(
      "https://bibalak.example/download/latest.json",
    );

    let resolveInstall!: () => void;
    updaterCheckMock
      .mockResolvedValueOnce({ version: "1.2.0", notes: "Faster study queue" })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({ version: "1.2.1" });
    updaterDownloadAndInstallMock
      .mockImplementationOnce(
        (onProgress) =>
          new Promise<void>((resolve) => {
            onProgress?.({ kind: "started", contentLength: 200 });
            onProgress?.({ kind: "progress", downloadedBytes: 100, contentLength: 200 });
            resolveInstall = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("Signature mismatch"));

    renderScreen();

    // Available -> shows version + notes + Install button, does NOT auto-install
    await user.click(await screen.findByRole("button", { name: "Check for updates" }));
    expect(updaterCheckMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/is available\./)).toBeInTheDocument();
    expect(screen.getByText("1.2.0")).toBeInTheDocument();
    expect(screen.getByText("Faster study queue")).toBeInTheDocument();
    expect(updaterDownloadAndInstallMock).not.toHaveBeenCalled();
    expect(updaterRelaunchMock).not.toHaveBeenCalled();

    // Explicit click on Install and restart -> shows progress then relaunches
    await user.click(screen.getByRole("button", { name: "Install and restart" }));
    expect(await screen.findByText("Downloading… 50%")).toBeInTheDocument();
    resolveInstall();
    await waitFor(() => expect(updaterRelaunchMock).toHaveBeenCalledTimes(1));

    // Up-to-date (also covers older/equal manifests since the plugin filters them to null)
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Bibalak is up to date.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install and restart" })).not.toBeInTheDocument();

    // Check error -> role="alert"
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error");

    // Install error -> role="alert" and no relaunch
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    await user.click(await screen.findByRole("button", { name: "Install and restart" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Signature mismatch");
    expect(updaterRelaunchMock).toHaveBeenCalledTimes(1);
  });

  it("13b. shows the build stamp with sha and formatted date under the version (A3)", async () => {
    sessionStorage.setItem("keepsake-settings-category", "updates");
    setupDefaultTauriIpc({ appInfo: { ...DEFAULT_APP_INFO, version: "1.0.0" } });

    renderScreen();

    expect(await screen.findByText(/Build test · /)).toBeInTheDocument();
  });

  it("14. rollover shows current hour and saves changed hour via setCollectionPrefs", async () => {
    sessionStorage.setItem("keepsake-settings-category", "study");
    setupDefaultTauriIpc({ rolloverHour: 5 });
    const setPrefsSpy = vi.spyOn(ipcModule.ipc, "setCollectionPrefs").mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderScreen();

    const select = (await screen.findByLabelText("Day starts at")) as HTMLSelectElement;
    await waitFor(() => {
      expect(select).toBeEnabled();
      expect(select.value).toBe("5");
    });

    await user.selectOptions(select, "8");
    expect(setPrefsSpy).toHaveBeenCalledWith({ rollover_hour: 8 });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("15. mutation rejections display error text without crashing across maintenance, media deletion, and rollover", async () => {
    sessionStorage.setItem("keepsake-settings-category", "data");
    const backups: BackupInfo[] = [
      { name: "snap.colpkg", created_ms: 1700000000000, size_bytes: 1024 },
    ];
    setupDefaultTauriIpc({ backups, rolloverHour: 4 });
    vi.spyOn(ipcModule.ipc, "createBackup").mockRejectedValue({ message: "Backup failed" });
    vi.spyOn(ipcModule.ipc, "restoreBackup").mockRejectedValue({ message: "Restore failed" });
    vi.spyOn(ipcModule.ipc, "deleteBackup").mockRejectedValue({ message: "Delete backup failed" });
    vi.spyOn(ipcModule.ipc, "checkIntegrity").mockRejectedValue({ message: "Integrity failed" });
    vi.spyOn(ipcModule.ipc, "optimizeDb").mockRejectedValue({ message: "Optimize failed" });
    vi.spyOn(ipcModule.ipc, "checkMedia")
      .mockRejectedValueOnce({ message: "Media scan failed" })
      .mockResolvedValueOnce({ orphan_files: ["bad.png"], missing_files: [] });
    vi.spyOn(ipcModule.ipc, "deleteOrphanMedia").mockRejectedValue({
      message: "Delete orphans failed",
    });
    vi.spyOn(ipcModule.ipc, "setCollectionPrefs").mockRejectedValue({
      message: "Rollover save failed",
    });
    const user = userEvent.setup();

    renderScreen();

    await user.click(await screen.findByRole("button", { name: "Backup now" }));
    expect(await screen.findByText("Backup failed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restore" }));
    await user.click(screen.getByRole("button", { name: "Yes, restore" }));
    expect(await screen.findByText("Restore failed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Delete backup failed")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Maintenance" }));
    await user.click(screen.getByRole("button", { name: "Check integrity" }));
    expect(await screen.findByText("Integrity failed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Optimize database" }));
    expect(await screen.findByText("Optimize failed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Check media" }));
    expect(await screen.findByText("Media scan failed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Check media" }));
    await user.click(await screen.findByRole("button", { name: "Delete orphan files…" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByText("Delete orphans failed")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Study" }));
    const select = screen.getByLabelText("Day starts at");
    await waitFor(() => expect(select).toBeEnabled());
    await user.selectOptions(select, "6");
    expect(await screen.findByText("Rollover save failed")).toBeInTheDocument();
  });

  it("16. plugin enable and disable rejections show error toast without unhandled promise rejection", async () => {
    sessionStorage.setItem("keepsake-settings-category", "plugins");
    const plugins: PluginInfo[] = [
      {
        id: "p-off",
        name: "P Off",
        version: "1.0.0",
        api_version: "0.2.0",
        description: null,
        author: null,
        permissions: [],
        enabled: false,
      },
      {
        id: "p-on",
        name: "P On",
        version: "1.0.0",
        api_version: "0.2.0",
        description: null,
        author: null,
        permissions: [],
        enabled: true,
      },
    ];
    setupDefaultTauriIpc({ plugins });
    vi.spyOn(ipcModule.ipc, "enablePlugin").mockRejectedValue({ message: "Plugin enable failed" });
    vi.spyOn(ipcModule.ipc, "disablePlugin").mockRejectedValue({
      message: "Plugin disable failed",
    });
    const user = userEvent.setup();

    renderScreen();

    await user.click(await screen.findByRole("button", { name: "Enable" }));
    await user.click(await screen.findByRole("button", { name: "Allow and enable" }));
    expect((await screen.findAllByText("Plugin enable failed")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Enabled" }));
    expect((await screen.findAllByText("Plugin disable failed")).length).toBeGreaterThan(0);
  });

  it("17. media check rejection shows role='alert' without orphan list, delete button, or deleteOrphanMedia call", async () => {
    sessionStorage.setItem("keepsake-settings-category", "maintenance");
    setupDefaultTauriIpc();
    vi.spyOn(ipcModule.ipc, "checkMedia").mockRejectedValue({
      message: "Permission denied reading media dir",
    });
    const deleteOrphanSpy = vi.spyOn(ipcModule.ipc, "deleteOrphanMedia");
    const user = userEvent.setup();

    renderScreen();

    await user.click(screen.getByRole("button", { name: "Check media" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Permission denied reading media dir");
    expect(screen.queryByText(/Orphan files/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete orphan files…" })).not.toBeInTheDocument();
    expect(deleteOrphanSpy).not.toHaveBeenCalled();
  });

  it("18. integrity check rejection shows role='alert' and not a problem list item", async () => {
    sessionStorage.setItem("keepsake-settings-category", "maintenance");
    setupDefaultTauriIpc();
    vi.spyOn(ipcModule.ipc, "checkIntegrity").mockRejectedValue({ message: "Database busy" });
    const user = userEvent.setup();

    renderScreen();

    await user.click(screen.getByRole("button", { name: "Check integrity" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Database busy");
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("19. successful media and integrity re-checks clear previous error alerts and show normal results", async () => {
    sessionStorage.setItem("keepsake-settings-category", "maintenance");
    setupDefaultTauriIpc();
    vi.spyOn(ipcModule.ipc, "checkMedia")
      .mockRejectedValueOnce({ message: "Disk offline" })
      .mockResolvedValueOnce({ orphan_files: [], missing_files: [] });
    vi.spyOn(ipcModule.ipc, "checkIntegrity")
      .mockRejectedValueOnce({ message: "Lock timeout" })
      .mockResolvedValueOnce([]);
    const user = userEvent.setup();

    renderScreen();

    await user.click(screen.getByRole("button", { name: "Check media" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Disk offline");

    await user.click(screen.getByRole("button", { name: "Check media" }));
    expect(await screen.findByText("All media files are consistent.")).toBeInTheDocument();
    expect(screen.queryByText("Disk offline")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Check integrity" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Lock timeout");

    await user.click(screen.getByRole("button", { name: "Check integrity" }));
    expect(await screen.findByText("Database is healthy.")).toBeInTheDocument();
    expect(screen.queryByText("Lock timeout")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("16. AI0 / OT-13: AI assistant section shows status, links to the Assistant hub, and renders the setup form", async () => {
    sessionStorage.setItem("keepsake-settings-category", "ai");
    setupDefaultTauriIpc();
    renderScreen();

    const heading = await screen.findByRole("heading", { name: "AI assistant" });
    const section = heading.closest("section")!;
    expect(within(section).getByRole("button", { name: /Open AI assistant/i })).toBeInTheDocument();
    expect(await within(section).findByLabelText(/API key/i)).toBeInTheDocument();
  });

  it("20. switches categories via tab clicks and updates visible panels (OT-10)", async () => {
    setupDefaultTauriIpc();
    const user = userEvent.setup();
    renderScreen();

    // Default category is General
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();

    // Click Study
    await user.click(screen.getByRole("tab", { name: "Study" }));
    expect(await screen.findByRole("heading", { name: "Scheduling" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Appearance" })).not.toBeInTheDocument();

    // Click Quick add
    await user.click(screen.getByRole("tab", { name: "Quick add" }));
    expect(await screen.findByRole("heading", { name: "Quick add window" })).toBeInTheDocument();

    // Click AI assistant
    await user.click(screen.getByRole("tab", { name: "AI assistant" }));
    expect(await screen.findByRole("heading", { name: "AI assistant" })).toBeInTheDocument();

    // Click Data & backup
    await user.click(screen.getByRole("tab", { name: "Data & backup" }));
    expect(await screen.findByRole("heading", { name: "Export" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Backups" })).toBeInTheDocument();

    // Click Maintenance
    await user.click(screen.getByRole("tab", { name: "Maintenance" }));
    expect(await screen.findByRole("heading", { name: "Maintenance" })).toBeInTheDocument();

    // Click Plugins
    await user.click(screen.getByRole("tab", { name: "Plugins" }));
    expect(await screen.findByRole("heading", { name: "Plugins" })).toBeInTheDocument();

    // Click Updates
    await user.click(screen.getByRole("tab", { name: "Updates" }));
    expect(await screen.findByRole("heading", { name: "Updates" })).toBeInTheDocument();
  });

  it("21. navigates categories via keyboard arrows, Enter, and remembers session category (OT-10)", async () => {
    setupDefaultTauriIpc();
    const user = userEvent.setup();
    renderScreen();

    const generalTab = screen.getByRole("tab", { name: "General" });
    generalTab.focus();
    expect(generalTab).toHaveFocus();

    // Arrow down moves focus to next tab (Study)
    await user.keyboard("{ArrowDown}");
    const studyTab = screen.getByRole("tab", { name: "Study" });
    expect(studyTab).toHaveFocus();

    // Press Enter to activate
    await user.keyboard("{Enter}");
    expect(studyTab).toHaveAttribute("aria-selected", "true");
    expect(sessionStorage.getItem("keepsake-settings-category")).toBe("study");
    expect(await screen.findByRole("heading", { name: "Scheduling" })).toBeInTheDocument();
  });

  it("22. Z1b: disables Check media with notice while legacy copy is pending, enabled when idle", async () => {
    sessionStorage.setItem("keepsake-settings-category", "maintenance");
    setupDefaultTauriIpc({ legacyMediaPending: true });
    const { unmount } = renderScreen();

    const checkBtn = screen.getByRole("button", { name: "Check media" });
    await waitFor(() => expect(checkBtn).toBeDisabled());
    expect(
      screen.getByText(
        "Media from the old app folder is still being copied. Cleanup is available when it finishes.",
      ),
    ).toBeInTheDocument();

    unmount();

    setupDefaultTauriIpc({ legacyMediaPending: false });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Check media" })).toBeEnabled();
    });
    expect(
      screen.queryByText(
        "Media from the old app folder is still being copied. Cleanup is available when it finishes.",
      ),
    ).not.toBeInTheDocument();
  });

  it("23. PLN0: sets week-start in Appearance with RTL arrow key reversal", async () => {
    setupDefaultTauriIpc();
    localStorage.clear();
    setLocale("ar");
    const user = userEvent.setup();
    renderScreen();

    const group = screen.getByRole("radiogroup", { name: "بداية الأسبوع" });
    const sat = within(group).getByRole("radio", { name: "السبت" });
    const sun = within(group).getByRole("radio", { name: "الأحد" });
    const mon = within(group).getByRole("radio", { name: "الإثنين" });

    expect(sat).toHaveAttribute("aria-checked", "true");
    expect(sun).toHaveAttribute("aria-checked", "false");
    expect(mon).toHaveAttribute("aria-checked", "false");

    // In RTL, ArrowLeft advances to the next option (Saturday -> Sunday).
    sat.focus();
    await user.keyboard("{ArrowLeft}");
    expect(sun).toHaveAttribute("aria-checked", "true");
    expect(sun).toHaveFocus();
    expect(localStorage.getItem("keepsake-week-start")).toBe("sun");

    await user.click(mon);
    expect(mon).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem("keepsake-week-start")).toBe("mon");
  });

  it("settings_toggle_persists", async () => {
    setupDefaultTauriIpc();
    localStorage.clear();
    const user = userEvent.setup();
    const { unmount } = renderScreen();

    await user.click(screen.getByRole("tab", { name: "Sound" }));
    const soundHeading = await screen.findByRole("heading", { name: "Sound" });
    const soundSection = soundHeading.closest("section")!;
    const toggle = within(soundSection).getByRole("switch", { name: "Style sound effects" });

    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(localStorage.getItem("keepsake-style-sfx-enabled")).toBe("false");

    unmount();
    renderScreen();

    await user.click(screen.getByRole("tab", { name: "Sound" }));
    const persistedToggle = await screen.findByRole("switch", { name: "Style sound effects" });
    expect(persistedToggle).toHaveAttribute("aria-checked", "false");
  });

  it("settings_sound_keeps_style_effects_only", async () => {
    setupDefaultTauriIpc();
    localStorage.clear();
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole("tab", { name: "Sound" }));
    const soundHeading = await screen.findByRole("heading", { name: "Sound" });
    const soundSection = soundHeading.closest("section")!;

    expect(within(soundSection).queryAllByRole("slider")).toHaveLength(0);
    expect(
      within(soundSection).getByRole("switch", { name: "Style sound effects" }),
    ).toBeInTheDocument();
    expect(
      within(soundSection).getByText(
        "Volumes are in the sound button at the bottom of the sidebar.",
      ),
    ).toBeInTheDocument();
  });

  it("notifications_section_controls_persist_and_request_permission_on_enable", async () => {
    setupDefaultTauriIpc();
    notifIsGrantedMock.mockResolvedValue(false);
    notifRequestPermissionMock.mockResolvedValue("granted");
    const user = userEvent.setup();
    const { unmount } = renderScreen();

    // Never ask permission on initial render.
    expect(notifIsGrantedMock).not.toHaveBeenCalled();
    expect(notifRequestPermissionMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "Notifications" }));
    const heading = await screen.findByRole("heading", { name: "Notifications" });
    const section = heading.closest("section")!;
    const switches = within(section).getAllByRole("switch");
    expect(switches).toHaveLength(3);

    const dailySwitch = switches[0];
    const eveningSwitch = switches[1];
    const habitsSwitch = switches[2];
    expect(dailySwitch).toHaveAttribute("aria-checked", "false");
    expect(eveningSwitch).toHaveAttribute("aria-checked", "false");
    expect(habitsSwitch).toHaveAttribute("aria-checked", "false");

    const timeInputs = section.querySelectorAll('input[type="time"]');
    expect(timeInputs).toHaveLength(2);
    expect((timeInputs[0] as HTMLInputElement).value).toBe("19:00");
    expect((timeInputs[1] as HTMLInputElement).value).toBe("21:00");

    // Keyboard toggle (Space) asks OS permission and enables on grant.
    dailySwitch.focus();
    await user.keyboard(" ");
    await waitFor(() => {
      expect(dailySwitch).toHaveAttribute("aria-checked", "true");
    });
    expect(notifRequestPermissionMock).toHaveBeenCalledTimes(1);

    fireEvent.change(timeInputs[0], { target: { value: "18:45" } });
    expect(useReminders.getState().dailyStudyTime).toBe("18:45");

    await user.click(eveningSwitch);
    await waitFor(() => {
      expect(eveningSwitch).toHaveAttribute("aria-checked", "true");
    });
    fireEvent.change(timeInputs[1], { target: { value: "20:30" } });
    expect(useReminders.getState().eveningStreakTime).toBe("20:30");

    await user.click(habitsSwitch);
    await waitFor(() => {
      expect(habitsSwitch).toHaveAttribute("aria-checked", "true");
    });

    unmount();
    renderScreen();

    await user.click(screen.getByRole("tab", { name: "Notifications" }));
    const reloadedSection = (await screen.findByRole("heading", { name: "Notifications" })).closest(
      "section",
    )!;
    const reloadedSwitches = within(reloadedSection).getAllByRole("switch");
    expect(reloadedSwitches[0]).toHaveAttribute("aria-checked", "true");
    expect(reloadedSwitches[1]).toHaveAttribute("aria-checked", "true");
    expect(reloadedSwitches[2]).toHaveAttribute("aria-checked", "true");
    const reloadedTimes = reloadedSection.querySelectorAll('input[type="time"]');
    expect((reloadedTimes[0] as HTMLInputElement).value).toBe("18:45");
    expect((reloadedTimes[1] as HTMLInputElement).value).toBe("20:30");
  });

  it("notifications_section_shows_calm_note_when_os_refuses_permission", async () => {
    setupDefaultTauriIpc();
    notifIsGrantedMock.mockResolvedValue(false);
    notifRequestPermissionMock.mockResolvedValue("denied");
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole("tab", { name: "Notifications" }));
    const section = (await screen.findByRole("heading", { name: "Notifications" })).closest(
      "section",
    )!;
    const dailySwitch = within(section).getAllByRole("switch")[0];

    await user.click(dailySwitch);

    await waitFor(() => {
      expect(notifRequestPermissionMock).toHaveBeenCalledTimes(1);
    });
    expect(dailySwitch).toHaveAttribute("aria-checked", "false");
    expect(within(section).getByRole("status")).toHaveTextContent(/permission/i);
  });

  it("BW2-15: shows dedicated Sound, Notifications, and About sections in the left list with a short help line each", async () => {
    setupDefaultTauriIpc();
    const user = userEvent.setup();
    renderScreen();

    const nav = screen.getByRole("tablist", { name: "Categories" });
    for (const name of [
      "General",
      "Study",
      "Sound",
      "Notifications",
      "AI assistant",
      "Data & backup",
      "Plugins",
      "Updates",
      "About",
    ]) {
      const tab = within(nav).getByRole("tab", { name });
      expect(tab).toBeInTheDocument();
      expect(tab.querySelector("[data-testid='settings-tab-help']")).not.toBeNull();
    }

    await user.click(within(nav).getByRole("tab", { name: "About" }));
    expect(await screen.findByRole("heading", { name: "About" })).toBeInTheDocument();
    expect(screen.getByText(/1\.0\.0/)).toBeInTheDocument();
  });
});
