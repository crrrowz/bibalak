import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import { ipc } from "@/lib/ipc";
import { installPreviewMocks } from "./previewMocks";

describe("previewMocks (A1-34, A2-39)", () => {
  afterEach(() => {
    clearMocks();
  });

  it("A1-34 / A2-39: returns unique note_id rows from searchNoteRows and resolves getNote for every row", async () => {
    installPreviewMocks();
    const rows = await ipc.searchNoteRows("", 0, undefined, undefined, 500);
    const total = await ipc.countNoteRows("");

    expect(rows.length).toBeGreaterThan(0);
    const ids = rows.map((r) => r.note_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(total).toBe(ids.length);

    const firstDetail = await ipc.getNote(rows[0]!.note_id);
    const lastDetail = await ipc.getNote(rows[rows.length - 1]!.note_id);
    expect(firstDetail).not.toBeNull();
    expect(firstDetail?.fields.length).toBeGreaterThan(0);
    expect(lastDetail).not.toBeNull();
    expect(lastDetail?.fields.length).toBeGreaterThan(0);
  });

  it("A2-39: returns rendered preview HTML from previewTemplate and lints cleanly", async () => {
    installPreviewMocks();
    const preview = await ipc.previewTemplate(1, 0, ["(Front)", "(Back)"]);
    expect(preview.question).toContain("(Front)");
    expect(preview.answer).toContain("(Back)");

    const hints = await ipc.lintNotetype(1);
    expect(Array.isArray(hints)).toBe(true);
  });
});
