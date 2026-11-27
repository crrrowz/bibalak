import type { GeneratedCardDraft, GeneratedNoteKind, NotetypeSummary } from "@bibalak/ipc-types";
import { deckSearchToken } from "@/features/browse/browseHelpers";

export const MAX_GENERATE_CHARS = 50_000;
export const MIN_GENERATE_COUNT = 5;
export const MAX_GENERATE_COUNT = 50;
export const DEFAULT_GENERATE_COUNT = 15;

/** Distribute `totalCards` across `partCount` parts without exceeding `totalCards`. */
export function distributeCardCounts(totalCards: number, partCount: number): number[] {
  if (partCount <= 0) return [];
  const safeTotal = Math.max(1, totalCards);
  if (partCount >= safeTotal) {
    return Array.from({ length: partCount }, (_, i) => (i < safeTotal ? 1 : 0));
  }
  const base = Math.floor(safeTotal / partCount);
  const rem = safeTotal % partCount;
  return Array.from({ length: partCount }, (_, i) => base + (i < rem ? 1 : 0));
}

/** Return notetypes matching `noteKind` while excluding Image Occlusion. */
export function matchingNotetypesForKind(
  notetypes: NotetypeSummary[],
  noteKind: GeneratedNoteKind,
): NotetypeSummary[] {
  const targetKind = noteKind === "cloze" ? 1 : 0;
  return notetypes.filter((nt) => {
    if (Number(nt.kind) !== targetKind) return false;
    if (nt.field_names.includes("Image") && nt.field_names.includes("Occlusion")) return false;
    return true;
  });
}

/** Build the Browse search query linking to newly added generated notes. */
export function buildGeneratedBrowseQuery(deckName: string, tagged: boolean): string {
  const deck = deckSearchToken(deckName);
  return tagged ? `tag:ai-generated ${deck}` : deck;
}

export interface EditableDraft {
  id: string;
  kind: GeneratedNoteKind;
  front: string;
  back: string;
  text: string;
  accepted: boolean;
}

export function draftFromGenerated(draft: GeneratedCardDraft, id: string): EditableDraft {
  if (draft.kind === "basic") {
    return {
      id,
      kind: "basic",
      front: draft.front,
      back: draft.back,
      text: "",
      accepted: true,
    };
  }
  return {
    id,
    kind: "cloze",
    front: "",
    back: "",
    text: draft.text,
    accepted: true,
  };
}
