import { create } from "zustand";

export type Theme = "light" | "dark" | "system";
type Resolved = "light" | "dark";

const STORAGE_KEY = "keepsake-theme";

function getColorSchemeQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
}

function systemPrefersDark(): boolean {
  return getColorSchemeQuery()?.matches ?? false;
}

function resolveTheme(theme: Theme): Resolved {
  return theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
}

/** Apply the resolved theme to <html> and return it. */
function applyTheme(theme: Theme): Resolved {
  const resolved = resolveTheme(theme);
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }
  return resolved;
}

function readStored(): Theme {
  if (typeof localStorage === "undefined") return "system";
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  } catch {
    return "system";
  }
}

function writeStored(theme: Theme) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // storage unavailable: still update in-memory state
  }
}

interface ThemeState {
  theme: Theme;
  resolved: Resolved;
  setTheme: (theme: Theme) => void;
}

let activeMediaQuery: MediaQueryList | null = null;
let activeMediaListener: ((e: MediaQueryListEvent) => void) | null = null;

function detachSystemListener() {
  if (activeMediaQuery && activeMediaListener && activeMediaQuery.removeEventListener) {
    activeMediaQuery.removeEventListener("change", activeMediaListener);
  }
  activeMediaQuery = null;
  activeMediaListener = null;
}

function syncSystemListener(theme: Theme, onSystemChange: () => void) {
  detachSystemListener();
  if (theme !== "system") return;
  const mq = getColorSchemeQuery();
  if (!mq || typeof mq.addEventListener !== "function") return;
  const listener = () => onSystemChange();
  mq.addEventListener("change", listener);
  activeMediaQuery = mq;
  activeMediaListener = listener;
}

const initial = readStored();

export const useTheme = create<ThemeState>((set, get) => {
  const handleSystemChange = () => {
    if (get().theme === "system") {
      set({ resolved: applyTheme("system") });
    }
  };

  syncSystemListener(initial, handleSystemChange);

  return {
    theme: initial,
    resolved: applyTheme(initial),
    setTheme: (theme) => {
      writeStored(theme);
      syncSystemListener(theme, handleSystemChange);
      set({ theme, resolved: applyTheme(theme) });
    },
  };
});
