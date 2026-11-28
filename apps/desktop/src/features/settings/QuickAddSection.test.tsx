import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { QuickAddSection } from "./QuickAddSection";

const registerMock = vi.fn();
const unregisterMock = vi.fn();
const isRegisteredMock = vi.fn();

vi.mock("@/lib/platform", () => ({
  platform: {
    kind: "desktop",
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: () => () => {},
    pickPath: vi.fn(),
    pickSavePath: vi.fn(),
    window: null,
    globalShortcut: {
      register: (...args: unknown[]) => registerMock(...args),
      unregister: (...args: unknown[]) => unregisterMock(...args),
      isRegistered: (...args: unknown[]) => isRegisteredMock(...args),
    },
  },
}));

describe("QuickAddSection in Settings (E10)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    registerMock.mockReset().mockResolvedValue(undefined);
    unregisterMock.mockReset().mockResolvedValue(undefined);
    isRegisteredMock.mockReset().mockResolvedValue(false);
    vi.spyOn(ipc, "getQuickAddConfig").mockResolvedValue({
      enabled: false,
      shortcut: "Ctrl+Shift+K",
      last_deck_id: null,
      last_notetype_id: null,
    });
    vi.spyOn(ipc, "setQuickAddConfig").mockImplementation(async (enabled, shortcut) => ({
      enabled,
      shortcut,
      last_deck_id: null,
      last_notetype_id: null,
    }));
  });

  function renderSection() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <QuickAddSection />
      </QueryClientProvider>,
    );
  }

  it("registers default Ctrl+Shift+K when enabled and reports OS refusal errors cleanly", async () => {
    const user = userEvent.setup();
    renderSection();

    const toggle = await screen.findByRole("switch");
    const shortcutInput = screen.getByLabelText(/Global shortcut/i) as HTMLInputElement;
    expect(shortcutInput.value).toBe("Ctrl+Shift+K");

    await user.click(toggle);
    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith("Ctrl+Shift+K", expect.any(Function));
      expect(ipc.setQuickAddConfig).toHaveBeenCalledWith(true, "Ctrl+Shift+K");
    });

    // OS refuses a conflicting shortcut
    registerMock.mockRejectedValueOnce(new Error("HotKey already registered by OS"));
    await user.clear(shortcutInput);
    await user.type(shortcutInput, "Ctrl+Shift+Space");
    await user.click(screen.getByRole("button", { name: /Apply shortcut/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/HotKey already registered by OS/i);
  });
});
