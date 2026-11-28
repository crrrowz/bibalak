import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginInfo } from "@bibalak/ipc-types";
import { PluginManagerSection } from "./PluginManagerSection";
import { setLocale } from "@/lib/i18n";
import * as ipcModule from "@/lib/ipc";
import { PLUGIN_CHANNEL, pluginHost } from "@/lib/pluginHost";

const { pickPathMock } = vi.hoisted(() => ({
  pickPathMock: vi.fn<() => Promise<string | null>>(async () => null),
}));

vi.mock("@/lib/platform", () => ({
  platform: {
    kind: "desktop",
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: () => () => {},
    pickPath: (...args: unknown[]) => pickPathMock(...(args as [])),
    pickSavePath: vi.fn(async () => null),
    window: null,
    globalShortcut: null,
    notifications: null,
    updater: { check: vi.fn(), downloadAndInstall: vi.fn(), relaunch: vi.fn() },
  },
}));

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PluginManagerSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setLocale("en");
  pluginHost.destroyAll();
});

afterEach(() => {
  cleanup();
  pluginHost.destroyAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PluginManagerSection (PLG1)", () => {
  it("shows accessible consent dialog with plain-word permissions before enabling", async () => {
    const disabled: PluginInfo = {
      id: "bibalak-today-glance",
      name: "Today at a Glance",
      version: "1.0.0",
      api_version: "0.2.0",
      description: "Shows due cards per deck",
      author: "Bibalak",
      permissions: ["read:decks", "ui:command"],
      enabled: false,
    };
    const enabled: PluginInfo = { ...disabled, enabled: true };
    vi.spyOn(ipcModule.ipc, "listPlugins")
      .mockResolvedValueOnce([disabled])
      .mockResolvedValueOnce([enabled]);
    const enableSpy = vi.spyOn(ipcModule.ipc, "enablePlugin").mockResolvedValue(undefined);
    const entrySpy = vi.spyOn(ipcModule.ipc, "getPluginEntry").mockResolvedValue("");

    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole("button", { name: "Enable" }));

    // Consent modal opens with plain-word permission descriptions
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Today at a Glance");
    expect(dialog).toHaveTextContent("Read your deck names and due card counts");
    expect(dialog).toHaveTextContent("Add commands to the command palette");
    expect(enableSpy).not.toHaveBeenCalled();

    // Cancel keeps it disabled
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(enableSpy).not.toHaveBeenCalled();

    // Confirm enables and loads it
    await user.click(screen.getByRole("button", { name: "Enable" }));
    await user.click(await screen.findByRole("button", { name: "Allow and enable" }));
    await waitFor(() => {
      expect(enableSpy).toHaveBeenCalledWith("bibalak-today-glance");
      expect(entrySpy).toHaveBeenCalledWith("bibalak-today-glance");
    });
  });

  it("supports installing from .zip, installing sample plugins, reloading, removing, and surfacing crashes", async () => {
    const samplePlugin: PluginInfo = {
      id: "bibalak-focus-timer",
      name: "Focus Timer",
      version: "1.0.0",
      api_version: "0.2.0",
      description: "Pomodoro timer",
      author: "Bibalak",
      permissions: ["events:listen", "ui:panel"],
      enabled: true,
    };
    vi.spyOn(ipcModule.ipc, "listPlugins").mockResolvedValue([samplePlugin]);
    const zipSpy = vi.spyOn(ipcModule.ipc, "installPluginZip").mockResolvedValue(samplePlugin);
    const samplesSpy = vi
      .spyOn(ipcModule.ipc, "installSamplePlugins")
      .mockResolvedValue([samplePlugin]);
    const removeSpy = vi.spyOn(ipcModule.ipc, "removePlugin").mockResolvedValue(undefined);
    const entrySpy = vi.spyOn(ipcModule.ipc, "getPluginEntry").mockResolvedValue("");

    const user = userEvent.setup();
    renderSection();

    // Install from .zip
    pickPathMock.mockResolvedValueOnce("C:/tmp/plugin.zip");
    await user.click(await screen.findByRole("button", { name: "Install .zip…" }));
    expect(zipSpy).toHaveBeenCalledWith("C:/tmp/plugin.zip");

    // Install sample plugins
    await user.click(screen.getByRole("button", { name: "Install sample plugins" }));
    expect(samplesSpy).toHaveBeenCalledTimes(1);

    // Load and then crash the plugin -> error state badge shown in Settings
    pluginHost.load("bibalak-focus-timer", ["events:listen", "ui:panel"], "");
    const frame = document.querySelector<HTMLIFrameElement>(
      'iframe[data-plugin-id="bibalak-focus-timer"]',
    );
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            channel: PLUGIN_CHANNEL,
            type: "plugin:error",
            message: "Uncaught Error: crash test",
          },
          source: frame?.contentWindow,
        }),
      );
    });
    expect(await screen.findByText("Crashed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/crash test/);

    // Reload button reloads entry into host
    await user.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(entrySpy).toHaveBeenCalledWith("bibalak-focus-timer"));

    // Remove button removes plugin
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(removeSpy).toHaveBeenCalledWith("bibalak-focus-timer");
  });
});
