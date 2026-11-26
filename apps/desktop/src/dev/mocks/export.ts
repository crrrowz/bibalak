import { emit } from "@tauri-apps/api/event";
import type {
  ExportEstimate,
  ExportPackageRequest,
  ExportProgress,
  ExportScope,
  ExportSummary,
  ImportProgress,
  ImportSummary,
} from "@bibalak/ipc-types";

const cancelledJobs = new Set<string>();

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function makeCancelledError() {
  return { kind: "cancelled", message: "cancelled" };
}

export const exportMocks = {
  pick_save_path: (args: unknown) => {
    const defaultPath =
      (args as { defaultPath?: string } | undefined)?.defaultPath ?? "collection.apkg";
    return `C:/Exports/${defaultPath}`;
  },
  pick_open_path: () => "C:/Imports/Arabic_Verbs.apkg",

  get_export_estimate: (args: unknown): ExportEstimate => {
    const { scope, includeMedia } = (args ?? {}) as {
      scope?: ExportScope;
      includeMedia?: boolean;
    };
    const isCollection = !scope || scope.kind === "collection";
    const cards = isCollection ? 1240 : scope.include_subdecks ? 320 : 140;
    const notes = Math.round(cards * 0.75);
    const media_files = includeMedia ? (isCollection ? 84 : 18) : 0;
    const media_bytes = includeMedia ? (isCollection ? 148_897_792 : 24_117_248) : 0;
    return { notes, cards, media_files, media_bytes };
  },

  export_package: async (args: unknown): Promise<ExportSummary> => {
    const req = (args as { request: ExportPackageRequest }).request;
    const isCollection = req.scope.kind === "collection";
    const notesTotal = isCollection ? 930 : 240;
    const cardsTotal = isCollection ? 1240 : 320;
    const mediaTotal = req.include_media ? (isCollection ? 84 : 18) : 0;
    const bytesTotal = req.include_media ? (isCollection ? 148_897_792 : 24_117_248) : 0;

    const emitStage = (patch: Partial<ExportProgress>) =>
      emit<ExportProgress>("bibalak://export-progress", {
        export_id: req.export_id,
        stage: "preparing",
        notes_done: 0,
        notes_total: notesTotal,
        cards_done: 0,
        cards_total: cardsTotal,
        media_done: 0,
        media_total: mediaTotal,
        bytes_done: 0,
        bytes_total: bytesTotal,
        ...patch,
      });

    await emitStage({ stage: "preparing" });
    await sleep(160);
    if (cancelledJobs.delete(req.export_id)) throw makeCancelledError();

    await emitStage({ stage: "writing-db", notes_done: notesTotal, cards_done: cardsTotal });
    await sleep(200);
    if (cancelledJobs.delete(req.export_id)) throw makeCancelledError();

    if (req.include_media && mediaTotal > 0) {
      for (const step of [0.25, 0.55, 0.85, 1]) {
        if (cancelledJobs.delete(req.export_id)) throw makeCancelledError();
        await emitStage({
          stage: "packing-media",
          notes_done: notesTotal,
          cards_done: cardsTotal,
          media_done: Math.round(mediaTotal * step),
          bytes_done: Math.round(bytesTotal * step),
        });
        await sleep(180);
      }
    }

    if (cancelledJobs.delete(req.export_id)) throw makeCancelledError();
    await emitStage({
      stage: "finalizing",
      notes_done: notesTotal,
      cards_done: cardsTotal,
      media_done: mediaTotal,
      bytes_done: bytesTotal,
    });
    await sleep(120);

    return {
      notes_exported: notesTotal,
      cards_exported: cardsTotal,
      media_exported: mediaTotal,
      media_skipped_missing: isCollection ? 0 : 1,
      bytes_written: bytesTotal + 512_000,
    };
  },

  cancel_export: (args: unknown): boolean => {
    const id = (args as { exportId?: string } | undefined)?.exportId;
    if (id) cancelledJobs.add(id);
    return true;
  },

  import_package: async (args: unknown): Promise<ImportSummary> => {
    const importId = (args as { importId?: string } | undefined)?.importId;
    await emit<ImportProgress>("bibalak://import-progress", {
      stage: "reading-package",
      done: 0,
      total: 0,
    });
    await sleep(200);
    if (importId && cancelledJobs.delete(importId)) throw makeCancelledError();

    for (const done of [0, 6, 12, 18]) {
      if (importId && cancelledJobs.delete(importId)) throw makeCancelledError();
      await emit<ImportProgress>("bibalak://import-progress", {
        stage: "copying-media",
        done,
        total: 18,
      });
      await sleep(160);
    }

    if (importId && cancelledJobs.delete(importId)) throw makeCancelledError();
    await emit<ImportProgress>("bibalak://import-progress", {
      stage: "merging",
      done: 120,
      total: 240,
    });
    await sleep(220);

    return {
      decks_added: 1,
      notetypes_added: 0,
      notes_added: 24,
      notes_updated: 0,
      cards_added: 48,
      revlog_added: 0,
      media_imported: 18,
    };
  },

  cancel_import: (args: unknown): boolean => {
    const id = (args as { importId?: string } | undefined)?.importId;
    if (id) cancelledJobs.add(id);
    return true;
  },
};
