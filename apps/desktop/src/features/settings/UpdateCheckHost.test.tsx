import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as releasesModule from "@/lib/releases";
import { useToastStore } from "@/stores/toast";
import { UpdateCheckHost } from "./UpdateCheckHost";
import { LAST_CHECK_KEY, useUpdateCheck } from "./updateCheck";

const { checkMock, navigateMock } = vi.hoisted(() => ({
  checkMock: vi.fn<() => Promise<{ version: string } | null | "not-available">>(async () => null),
  navigateMock: vi.fn(),
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

vi.mock("@/lib/useOptionalNavigate", () => ({
  useOptionalNavigate: () => navigateMock,
}));

describe("UpdateCheckHost (UPD1)", () => {
  beforeEach(() => {
    checkMock.mockReset().mockResolvedValue(null);
    navigateMock.mockReset();
    localStorage.clear();
    sessionStorage.clear();
    useToastStore.getState().clear();
    useUpdateCheck.setState({ autoCheck: true, checking: false, result: null });
    vi.spyOn(releasesModule, "updateManifestUrl").mockReturnValue(
      "https://github.com/crrrowz/bibalak/releases/latest/download/latest.json",
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("checks once on start and offers a toast that opens Settings → Updates", async () => {
    checkMock.mockResolvedValueOnce({ version: "1.1.0" });

    render(<UpdateCheckHost />);

    await waitFor(() => expect(useToastStore.getState().items).toHaveLength(1));
    const toast = useToastStore.getState().items[0];
    expect(toast.message).toBe("Bibalak 1.1.0 is available.");
    expect(toast.action?.label).toBe("View");
    expect(checkMock).toHaveBeenCalledTimes(1);

    act(() => toast.action?.onClick());
    expect(sessionStorage.getItem("keepsake-settings-category")).toBe("updates");
    expect(navigateMock).toHaveBeenCalledWith("/settings");
  });

  it("shows nothing and makes no call when checked less than a day ago", async () => {
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now() - 60_000));
    render(<UpdateCheckHost />);
    await act(async () => {});
    expect(checkMock).not.toHaveBeenCalled();
    expect(useToastStore.getState().items).toHaveLength(0);
  });
});
