import { create } from "zustand";

export type Style = "default" | "scholar" | "game";

const STORAGE_KEY = "keepsake-style";

/** Apply the active presentation style attribute to <html>. */
function applyStyle(style: Style): Style {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-style", style);
  }
  return style;
}

function readStored(): Style {
  if (typeof localStorage === "undefined") return "game";
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "default" || value === "scholar" || value === "game" ? value : "game";
  } catch {
    return "game";
  }
}

interface StyleState {
  style: Style;
  setStyle: (style: Style) => void;
}

const initial = readStored();

export const useStyle = create<StyleState>((set) => ({
  style: applyStyle(initial),
  setStyle: (style) => {
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, style);
      } catch {
        // storage unavailable: still update in-memory state
      }
    }
    set({ style: applyStyle(style) });
  },
}));
