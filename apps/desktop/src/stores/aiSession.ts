import type { AIActionRequest, AIConfig } from "@bibalak/ipc-types";
import { create } from "zustand";

type ActionKind = AIActionRequest["kind"];

interface AiSessionState {
  /** Session-only opt-out for consent preview, keyed by action kind (never persisted). */
  skipPreviewKinds: Partial<Record<ActionKind, boolean>>;
  shouldSkipPreview: (kind: ActionKind) => boolean;
  setSkipPreview: (kind: ActionKind, skip: boolean) => void;
  reset: () => void;
}

export const useAiSession = create<AiSessionState>((set, get) => ({
  skipPreviewKinds: {},
  shouldSkipPreview: (kind) => Boolean(get().skipPreviewKinds[kind]),
  setSkipPreview: (kind, skip) =>
    set((state) => ({
      skipPreviewKinds: { ...state.skipPreviewKinds, [kind]: skip },
    })),
  reset: () => set({ skipPreviewKinds: {} }),
}));

/** Returns true when AI is enabled, endpoint/model are filled, and required credentials exist. */
export function isAiConfigured(cfg: AIConfig | null | undefined): boolean {
  if (!cfg || !cfg.enabled) return false;
  if (!cfg.base_url.trim() || !cfg.model.trim()) return false;
  if (cfg.provider === "open-ai-compatible" && !cfg.has_api_key) return false;
  return true;
}
