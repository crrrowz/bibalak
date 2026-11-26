import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ExportProgress, ExportSummary } from "@bibalak/ipc-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as ipcModule from "@/lib/ipc";
import { setLocale } from "@/lib/i18n";
import { ExportDialog } from "./ExportDialog";

const listeners = new Map<string, (payload: unknown) => void>();
const pickSavePathMock = vi.fn();

vi.mock("@/lib/platform", () => ({
  platform: {
    kind: "desktop",
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn((event: string, handler: (payload: unknown) => void) => {
      listeners.set(event, handler);
      return () => {
        listeners.delete(event);
      };
    }),
    pickPath: vi.fn(),
    pickSavePath: (...args: unknown[]) => pickSavePathMock(...args),
    window: null,
    globalShortcut: null,
    notifications: null,
    updater: { check: vi.fn(), downloadAndInstall: vi.fn(), relaunch: vi.fn() },
  },
}));

afterEach(() => {
  setLocale("en");
  listeners.clear();
  vi.restoreAllMocks();
  pickSavePathMock.mockReset();
});

function renderDialog(props: Partial<Parameters<typeof ExportDialog>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ExportDialog
        open
        scope={{ kind: "deck", deck_id: 42, include_subdecks: true }}
        deckName="Languages::Arabic"
        hasChildren
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("ExportDialog (T8)", () => {
  it("uses deck defaults (scheduling off) and shows estimate, progress, and done summary", async () => {
    const user = userEvent.setup();
    vi.spyOn(ipcModule.ipc, "getExportEstimate").mockResolvedValue({
      notes: 12,
      cards: 24,
      media_files: 3,
      media_bytes: 2048,
    });

    let resolveExport!: (s: ExportSummary) => void;
    const exportSpy = vi.spyOn(ipcModule.ipc, "exportPackage").mockImplementation(
      () =>
        new Promise<ExportSummary>((resolve) => {
          resolveExport = resolve;
        }),
    );

    renderDialog();

    expect(await screen.findByText(/24 cards/)).toBeInTheDocument();
    expect(screen.getByText(/3 media files \(2 KB\)/)).toBeInTheDocument();

    const subdecksBox = screen.getByLabelText("Include subdecks") as HTMLInputElement;
    const mediaBox = screen.getByLabelText(/Include media files/) as HTMLInputElement;
    const schedBox = screen.getByLabelText(/Include scheduling/) as HTMLInputElement;
    expect(subdecksBox.checked).toBe(true);
    expect(mediaBox.checked).toBe(true);
    expect(schedBox.checked).toBe(false);
    expect(screen.getByText("Cards will be exported as new cards.")).toBeInTheDocument();

    // Cancelling OS save picker stays on configure without invoking exportPackage.
    pickSavePathMock.mockResolvedValueOnce(null);
    await user.click(screen.getByRole("button", { name: "Export…" }));
    expect(exportSpy).not.toHaveBeenCalled();

    // Confirmed path starts export and renders progress events.
    pickSavePathMock.mockResolvedValueOnce("C:/Exports/Languages_Arabic.apkg");
    await user.click(screen.getByRole("button", { name: "Export…" }));

    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
    const req = exportSpy.mock.calls[0][0];
    expect(req.scope).toEqual({ kind: "deck", deck_id: 42, include_subdecks: true });
    expect(req.include_media).toBe(true);
    expect(req.include_scheduling).toBe(false);

    const emit = listeners.get("bibalak://export-progress");
    expect(emit).toBeDefined();
    act(() => {
      emit!({
        export_id: req.export_id,
        stage: "packing-media",
        notes_done: 12,
        notes_total: 12,
        cards_done: 24,
        cards_total: 24,
        media_done: 2,
        media_total: 3,
        bytes_done: 1024,
        bytes_total: 2048,
      } satisfies ExportProgress);
    });

    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("Packing media…")).toBeInTheDocument();
    expect(screen.getByText(/2 of 3 media files/)).toBeInTheDocument();

    act(() => {
      resolveExport({
        notes_exported: 12,
        cards_exported: 24,
        media_exported: 2,
        media_skipped_missing: 1,
        bytes_written: 4096,
      });
    });

    expect(await screen.findByText("Export complete")).toBeInTheDocument();
    expect(screen.getByText("1 missing media file was skipped.")).toBeInTheDocument();
  });

  it("cancels an in-flight export and defaults collection scheduling to on", async () => {
    const user = userEvent.setup();
    vi.spyOn(ipcModule.ipc, "getExportEstimate").mockResolvedValue({
      notes: 100,
      cards: 200,
      media_files: 10,
      media_bytes: 10240,
    });

    let rejectExport!: (err: unknown) => void;
    vi.spyOn(ipcModule.ipc, "exportPackage").mockImplementation(
      () =>
        new Promise<ExportSummary>((_res, rej) => {
          rejectExport = rej;
        }),
    );
    const cancelSpy = vi.spyOn(ipcModule.ipc, "cancelExport").mockResolvedValue(true);
    pickSavePathMock.mockResolvedValueOnce("C:/Exports/collection.apkg");

    renderDialog({ scope: { kind: "collection" }, deckName: undefined, hasChildren: false });

    const schedBox = (await screen.findByLabelText(/Include scheduling/)) as HTMLInputElement;
    expect(schedBox.checked).toBe(true);

    await user.click(screen.getByRole("button", { name: "Export…" }));
    const cancelBtn = await screen.findByRole("button", { name: "Cancel" });
    await user.click(cancelBtn);

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Cancelling…" })).toBeDisabled();

    act(() => {
      rejectExport({ kind: "cancelled", message: "cancelled" });
    });

    expect(await screen.findByText("Export cancelled. No file was written.")).toBeInTheDocument();
  });

  it("renders Arabic labels and counts cleanly", async () => {
    setLocale("ar");
    vi.spyOn(ipcModule.ipc, "getExportEstimate").mockResolvedValue({
      notes: 1,
      cards: 2,
      media_files: 2,
      media_bytes: 2048,
    });
    renderDialog();

    expect(await screen.findByText("تصدير Languages::Arabic")).toBeInTheDocument();
    expect(await screen.findByText(/بطاقتان/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تصدير…" })).toBeInTheDocument();
  });
});
