import { create } from "zustand";

export type HomeLayout = "list" | "grid";

const HOME_LAYOUT_KEY = "keepsake-home-layout";
const LAST_ADD_NOTETYPE_KEY = "keepsake-last-add-notetype";
const LAST_ADD_DECK_KEY = "keepsake-last-add-deck";
const STUDY_SCALE_KEY = "keepsake-study-scale";
const STUDY_SCALE_MIN = 0.8;
const STUDY_SCALE_MAX = 1.5;

function clampStudyScale(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Math.max(STUDY_SCALE_MIN, Math.min(STUDY_SCALE_MAX, rounded));
}

function readStudyScale(): number {
  if (typeof localStorage === "undefined") return 1;
  const raw = Number(localStorage.getItem(STUDY_SCALE_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampStudyScale(raw) : 1;
}

function readHomeLayout(): HomeLayout {
  if (typeof localStorage === "undefined") return "list";
  const value = localStorage.getItem(HOME_LAYOUT_KEY);
  return value === "grid" ? "grid" : "list";
}

function readStoredId(key: string): number | null {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(key);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

interface UiState {
  /** Study focus mode — hides sidebar/chrome. Intentionally not persisted. */
  focusMode: boolean;
  setFocusMode: (value: boolean) => void;
  toggleFocusMode: () => void;

  /** Lets chrome outside CommandPalette (e.g. TitleBar) request it open. */
  paletteOpenSignal: number;
  openPalette: () => void;

  homeLayout: HomeLayout;
  setHomeLayout: (layout: HomeLayout) => void;

  lastAddNotetypeId: number | null;
  lastAddDeckId: number | null;
  setLastAddNotetypeId: (id: number | null) => void;
  setLastAddDeckId: (id: number | null) => void;

  /** Card typography scale multiplier during study (`0.8`–`1.5`). */
  studyScale: number;
  setStudyScale: (scale: number) => void;
  stepStudyScale: (delta: number) => void;

  /** Number of currently open non-modal SidePanels (hides overlapping chrome tips). */
  sidePanelCount: number;
  openSidePanel: () => void;
  closeSidePanel: () => void;
}

export const useUi = create<UiState>((set) => ({
  focusMode: false,
  setFocusMode: (value) => set({ focusMode: value }),
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),

  paletteOpenSignal: 0,
  openPalette: () => set((s) => ({ paletteOpenSignal: s.paletteOpenSignal + 1 })),

  homeLayout: readHomeLayout(),
  setHomeLayout: (layout) => {
    const normalized: HomeLayout = layout === "grid" ? "grid" : "list";
    if (typeof localStorage !== "undefined") localStorage.setItem(HOME_LAYOUT_KEY, normalized);
    set({ homeLayout: normalized });
  },

  lastAddNotetypeId: readStoredId(LAST_ADD_NOTETYPE_KEY),
  lastAddDeckId: readStoredId(LAST_ADD_DECK_KEY),
  setLastAddNotetypeId: (id) => {
    if (typeof localStorage !== "undefined") {
      if (id !== null) localStorage.setItem(LAST_ADD_NOTETYPE_KEY, String(id));
      else localStorage.removeItem(LAST_ADD_NOTETYPE_KEY);
    }
    set({ lastAddNotetypeId: id });
  },
  setLastAddDeckId: (id) => {
    if (typeof localStorage !== "undefined") {
      if (id !== null) localStorage.setItem(LAST_ADD_DECK_KEY, String(id));
      else localStorage.removeItem(LAST_ADD_DECK_KEY);
    }
    set({ lastAddDeckId: id });
  },

  studyScale: readStudyScale(),
  setStudyScale: (scale) => {
    const next = clampStudyScale(scale);
    if (typeof localStorage !== "undefined") localStorage.setItem(STUDY_SCALE_KEY, String(next));
    set({ studyScale: next });
  },
  stepStudyScale: (delta) =>
    set((s) => {
      const next = clampStudyScale(s.studyScale + delta);
      if (typeof localStorage !== "undefined") localStorage.setItem(STUDY_SCALE_KEY, String(next));
      return { studyScale: next };
    }),

  sidePanelCount: 0,
  openSidePanel: () => set((s) => ({ sidePanelCount: s.sidePanelCount + 1 })),
  closeSidePanel: () => set((s) => ({ sidePanelCount: Math.max(0, s.sidePanelCount - 1) })),
}));
