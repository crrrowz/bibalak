import type {
  BatchNoteInput,
  QualityFinding,
  QualityNoteEdit,
  QualityNoteInput,
  QualityScanNote,
} from "@bibalak/ipc-types";
import { buildClozePreviewHtml, plainTextToFieldHtml } from "@/lib/aiFormat";

/** Maximum notes sent in one deck-quality scan. */
export const MAX_QUALITY_SCAN_NOTES = 200;

/** Default number of notes sent per AI request chunk. */
export const DEFAULT_QUALITY_CHUNK_NOTES = 20;

/** Display order of all six quality finding kinds. */
export const QUALITY_FINDING_KINDS = [
  "unclear",
  "overloaded",
  "duplicate-meaning",
  "suggested-tags",
  "rewrite",
  "cloze-split",
] as const;

export type QualityFindingKind = QualityFinding["kind"];

/** Scoped CSS used inside `<CardFace>` previews on the quality review screen. */
export const QUALITY_PREVIEW_CSS =
  "html, body { background: transparent; margin: 0; } .card { font-family: system-ui, -apple-system, sans-serif; font-size: 13px; line-height: 1.5; text-align: start; padding: 6px 8px; background: transparent; } .quality-sep { border: 0; border-top: 1px dashed rgba(128,128,128,0.35); margin: 6px 0; } .cloze { font-weight: 700; color: #b45309; } .nightMode .cloze { color: #fbbf24; }";

/** Review-list state for one AI quality finding returned during a scan. */
export interface QualityReviewItem {
  id: string;
  finding: QualityFinding;
  accepted: boolean;
  /** User-edited replacement fields (plain text, escaped at apply time). */
  editedFields?: string[];
  /** User-edited tag additions (whitespace-free). */
  editedTags?: string[];
  /** User-edited Cloze card texts (one new Cloze note per non-empty item). */
  editedClozes?: string[];
  /** Optional opt-in: suspend the original note after adding split Cloze cards. */
  suspendOriginal?: boolean;
}

export interface ClozeSplitBatch {
  deckId: number;
  sourceNoteId: number;
  notes: BatchNoteInput[];
}

export interface QualityApplyPlan {
  edits: QualityNoteEdit[];
  clozeSplits: ClozeSplitBatch[];
  suspendCardIds: number[];
}

/** True when accepting this finding produces a DB mutation (rewrite, tags, or cloze-split). */
export function isActionableFindingKind(kind: QualityFindingKind): boolean {
  return kind === "suggested-tags" || kind === "rewrite" || kind === "cloze-split";
}

/** Normalize a tag token so whitespace runs become hyphens. */
export function sanitizeTagToken(raw: string): string {
  return raw.trim().replace(/\s+/g, "-");
}

/** Parse space-delimited tag text into unique valid tag tokens. */
export function parseTagList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/\s+/)) {
    const clean = sanitizeTagToken(part);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

/** Convert up to 200 loaded notes to `QualityNoteInput` and partition into chunks of `chunkSize`. */
export function chunkQualityNotes(
  notes: QualityScanNote[],
  chunkSize = DEFAULT_QUALITY_CHUNK_NOTES,
): QualityNoteInput[][] {
  const capped = notes.slice(0, MAX_QUALITY_SCAN_NOTES);
  if (capped.length === 0) return [];
  const step = Math.max(1, Math.floor(chunkSize));
  const inputs: QualityNoteInput[] = capped.map((note) => ({
    note_id: note.note_id,
    notetype_kind: note.notetype_kind,
    fields: note.fields,
    tags: note.tags,
    lapses: note.lapses,
  }));
  const chunks: QualityNoteInput[][] = [];
  for (let i = 0; i < inputs.length; i += step) {
    chunks.push(inputs.slice(i, i + step));
  }
  return chunks;
}

/**
 * Compile accepted findings into atomic DB edits (`rewrite` + `suggested-tags` merged
 * per `note_id`, HTML-escaped via `plainTextToFieldHtml`) and separate Cloze split batches.
 */
export function buildQualityApplyPlan(
  items: readonly QualityReviewItem[],
  notesById: ReadonlyMap<number, QualityScanNote>,
  clozeFieldCount = 2,
): QualityApplyPlan {
  const editsByNote = new Map<number, { fields: string[] | null; tags: Set<string> }>();
  const clozeSplits: ClozeSplitBatch[] = [];
  const suspendIdsSet = new Set<number>();

  for (const item of items) {
    if (!item.accepted) continue;
    const { finding } = item;

    if (finding.kind === "rewrite") {
      const rawFields = item.editedFields ?? finding.fields;
      const escapedFields = rawFields.map((val) => plainTextToFieldHtml(val));
      const entry = editsByNote.get(finding.note_id) ?? { fields: null, tags: new Set() };
      entry.fields = escapedFields;
      editsByNote.set(finding.note_id, entry);
      continue;
    }

    if (finding.kind === "suggested-tags") {
      const rawTags = item.editedTags ?? finding.tags;
      const cleanTags = rawTags.map(sanitizeTagToken).filter(Boolean);
      if (cleanTags.length === 0) continue;
      const entry = editsByNote.get(finding.note_id) ?? { fields: null, tags: new Set() };
      for (const tag of cleanTags) entry.tags.add(tag);
      editsByNote.set(finding.note_id, entry);
      continue;
    }

    if (finding.kind === "cloze-split") {
      const source = notesById.get(finding.note_id);
      if (!source) continue;
      const rawClozes = (item.editedClozes ?? finding.clozes).map((c) => c.trim()).filter(Boolean);
      if (rawClozes.length === 0) continue;

      const padCount = Math.max(1, clozeFieldCount);
      const batchNotes: BatchNoteInput[] = rawClozes.map((text) => {
        const fields = Array.from({ length: padCount }, (_, idx) =>
          idx === 0 ? plainTextToFieldHtml(text) : "",
        );
        return { fields, tags: ["ai-generated"] };
      });
      clozeSplits.push({
        deckId: source.deck_id,
        sourceNoteId: source.note_id,
        notes: batchNotes,
      });

      if (item.suspendOriginal) {
        for (const cid of source.card_ids) {
          suspendIdsSet.add(cid);
        }
      }
    }
  }

  const edits: QualityNoteEdit[] = Array.from(editsByNote.entries()).map(([note_id, val]) => ({
    note_id,
    fields: val.fields,
    add_tags: Array.from(val.tags),
  }));

  return {
    edits,
    clozeSplits,
    suspendCardIds: Array.from(suspendIdsSet),
  };
}

/** Build safe card preview HTML for `<CardFace>` from an existing note's raw HTML fields. */
export function buildNoteHtmlPreview(note: QualityScanNote): string {
  const joined = note.fields
    .map((f) => f.value_html || "")
    .filter((v) => v.trim().length > 0)
    .join('<hr class="quality-sep">');
  return `<div class="card">${joined}</div>`;
}

/** Build safe `<CardFace>` preview HTML for escaped plain-text rewrite fields. */
export function buildPlainRewritePreview(fields: readonly string[]): string {
  const joined = fields
    .map((f) => plainTextToFieldHtml(f))
    .filter((v) => v.trim().length > 0)
    .join('<hr class="quality-sep">');
  return `<div class="card">${joined}</div>`;
}

/** Build safe `<CardFace>` preview HTML for a proposed Cloze card (front with mask). */
export function buildClozeSplitPreviewHtml(clozeText: string): string {
  const escaped = plainTextToFieldHtml(clozeText);
  return `<div class="card">${buildClozePreviewHtml(escaped, "front")}</div>`;
}
