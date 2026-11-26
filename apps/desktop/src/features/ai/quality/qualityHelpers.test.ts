import { describe, expect, it } from "vitest";
import type { QualityScanNote } from "@bibalak/ipc-types";
import {
  buildQualityApplyPlan,
  chunkQualityNotes,
  DEFAULT_QUALITY_CHUNK_NOTES,
  MAX_QUALITY_SCAN_NOTES,
  type QualityReviewItem,
} from "./qualityHelpers";

function makeScanNote(id: number, deckId = 1): QualityScanNote {
  return {
    note_id: id,
    deck_id: deckId,
    notetype_id: 10,
    notetype_kind: 0,
    notetype_css: "",
    fields: [
      { name: "Front", value_html: `<b>Question ${id}</b>` },
      { name: "Back", value_html: `Answer ${id}` },
    ],
    tags: ["existing"],
    lapses: id % 4,
    card_ids: [id * 100],
  };
}

describe("qualityHelpers", () => {
  it("caps loaded notes at 200 and partitions them into chunks of 20", () => {
    const notes = Array.from({ length: 235 }, (_, i) => makeScanNote(i + 1));
    const chunks = chunkQualityNotes(notes, DEFAULT_QUALITY_CHUNK_NOTES);

    expect(MAX_QUALITY_SCAN_NOTES).toBe(200);
    expect(DEFAULT_QUALITY_CHUNK_NOTES).toBe(20);
    expect(chunks).toHaveLength(10);
    expect(chunks.every((c) => c.length === 20)).toBe(true);
    expect(chunks.flat()).toHaveLength(200);
    expect(chunks[0][0]).toEqual({
      note_id: 1,
      notetype_kind: 0,
      fields: [
        { name: "Front", value_html: "<b>Question 1</b>" },
        { name: "Back", value_html: "Answer 1" },
      ],
      tags: ["existing"],
      lapses: 1,
    });
    expect(chunks[9][19].note_id).toBe(200);
  });

  it("merges rewrite + suggested-tags per note, HTML-escapes fields, and keeps cloze-split non-destructive by default", () => {
    const n1 = makeScanNote(1, 5);
    const n2 = makeScanNote(2, 7);
    const n3 = makeScanNote(3, 9);
    const notesById = new Map<number, QualityScanNote>([
      [1, n1],
      [2, n2],
      [3, n3],
    ]);

    const items: QualityReviewItem[] = [
      {
        id: "f-rewrite-1",
        accepted: true,
        finding: {
          kind: "rewrite",
          note_id: 1,
          fields: ["What <drug> is first-line?\nDetail", "Beta-blocker"],
          reason: "Clarify question",
        },
      },
      {
        id: "f-tags-1",
        accepted: true,
        finding: {
          kind: "suggested-tags",
          note_id: 1,
          tags: ["cardiology", "with spaces", "high-yield"],
          reason: "Missing topic tag",
        },
      },
      {
        id: "f-cloze-2",
        accepted: true,
        suspendOriginal: false,
        finding: {
          kind: "cloze-split",
          note_id: 2,
          clozes: ["ACEi blocks {{c1::angiotensin II}}", "ARB blocks {{c1::AT1 receptor}}"],
          reason: "Separate targets",
        },
      },
      {
        id: "f-cloze-3",
        accepted: true,
        suspendOriginal: true,
        finding: {
          kind: "cloze-split",
          note_id: 3,
          clozes: ["Loop diuretic acts on {{c1::NKCC2}}"],
          reason: "Split mechanism",
        },
      },
      {
        id: "f-ignored-unclear",
        accepted: true,
        finding: {
          kind: "unclear",
          note_id: 2,
          reason: "Needs clinical context",
        },
      },
    ];

    const plan = buildQualityApplyPlan(items, notesById);

    expect(plan.edits).toEqual([
      {
        note_id: 1,
        fields: ["What &lt;drug&gt; is first-line?<br>Detail", "Beta-blocker"],
        add_tags: ["cardiology", "with-spaces", "high-yield"],
      },
    ]);
    expect(plan.clozeSplits).toEqual([
      {
        deckId: 7,
        sourceNoteId: 2,
        notes: [
          { fields: ["ACEi blocks {{c1::angiotensin II}}", ""], tags: ["ai-generated"] },
          { fields: ["ARB blocks {{c1::AT1 receptor}}", ""], tags: ["ai-generated"] },
        ],
      },
      {
        deckId: 9,
        sourceNoteId: 3,
        notes: [{ fields: ["Loop diuretic acts on {{c1::NKCC2}}", ""], tags: ["ai-generated"] }],
      },
    ]);
    // Only note 3 opted into suspending the original card
    expect(plan.suspendCardIds).toEqual([300]);
  });
});
