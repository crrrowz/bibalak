import { create } from "zustand";

const LEGACY_KEY_VOLUME = "keepsake-sound-volume";
const LEGACY_KEY_MUTED = "keepsake-sound-muted";

const STORAGE_KEY_CARD_VOLUME = "keepsake-card-volume";
const STORAGE_KEY_CARD_MUTED = "keepsake-card-muted";
const STORAGE_KEY_APP_VOLUME = "keepsake-app-volume";
const STORAGE_KEY_APP_MUTED = "keepsake-app-muted";
const STORAGE_KEY_STYLE_SFX = "keepsake-style-sfx-enabled";

function clampVolume(vol: number): number {
  return Number.isFinite(vol) ? Math.max(0, Math.min(100, Math.round(vol))) : 100;
}

function safeGet(key: string): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable
  }
}

function parseVolume(raw: string | null, fallback = 100): number {
  if (raw === null) return fallback;
  return clampVolume(Number(raw));
}

function parseMuted(raw: string | null, fallback = false): boolean {
  if (raw === null) return fallback;
  return raw === "true";
}

function readStoredState() {
  const hasCardVol = safeGet(STORAGE_KEY_CARD_VOLUME) !== null;
  const hasCardMute = safeGet(STORAGE_KEY_CARD_MUTED) !== null;
  const hasAppVol = safeGet(STORAGE_KEY_APP_VOLUME) !== null;
  const hasAppMute = safeGet(STORAGE_KEY_APP_MUTED) !== null;

  const legacyVol = safeGet(LEGACY_KEY_VOLUME);
  const legacyMuted = safeGet(LEGACY_KEY_MUTED);

  // First-run migration: copy the legacy single volume/mute into both channels.
  if (!hasCardVol && !hasAppVol && legacyVol !== null) {
    const migratedVol = String(parseVolume(legacyVol));
    safeSet(STORAGE_KEY_CARD_VOLUME, migratedVol);
    safeSet(STORAGE_KEY_APP_VOLUME, migratedVol);
  }
  if (!hasCardMute && !hasAppMute && legacyMuted !== null) {
    const migratedMute = String(parseMuted(legacyMuted));
    safeSet(STORAGE_KEY_CARD_MUTED, migratedMute);
    safeSet(STORAGE_KEY_APP_MUTED, migratedMute);
  }

  const cardVolume = parseVolume(safeGet(STORAGE_KEY_CARD_VOLUME), parseVolume(legacyVol, 100));
  const cardMuted = parseMuted(safeGet(STORAGE_KEY_CARD_MUTED), parseMuted(legacyMuted, false));
  const appVolume = parseVolume(safeGet(STORAGE_KEY_APP_VOLUME), parseVolume(legacyVol, 100));
  const appMuted = parseMuted(safeGet(STORAGE_KEY_APP_MUTED), parseMuted(legacyMuted, false));
  const styleSfxEnabled = safeGet(STORAGE_KEY_STYLE_SFX) !== "false";

  const cardEffectiveVolume = cardMuted ? 0 : cardVolume / 100;
  const appEffectiveVolume = appMuted ? 0 : appVolume / 100;

  return {
    volume: cardVolume,
    muted: cardMuted,
    effectiveVolume: cardEffectiveVolume,
    cardVolume,
    cardMuted,
    cardEffectiveVolume,
    appVolume,
    appMuted,
    appEffectiveVolume,
    styleSfxEnabled,
  };
}

export interface SoundState {
  // Legacy aliases mapped to Card audio for existing consumers/tests.
  volume: number; // 0-100
  muted: boolean;
  effectiveVolume: number; // 0.0 - 1.0
  // Independent Card audio channel (card media & TTS).
  cardVolume: number; // 0-100
  cardMuted: boolean;
  cardEffectiveVolume: number; // 0.0 - 1.0
  // Independent App sounds channel (style cues & pop-up sounds).
  appVolume: number; // 0-100
  appMuted: boolean;
  appEffectiveVolume: number; // 0.0 - 1.0
  styleSfxEnabled: boolean;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  toggleMute: () => void;
  setCardVolume: (volume: number) => void;
  setCardMuted: (muted: boolean) => void;
  toggleCardMute: () => void;
  setAppVolume: (volume: number) => void;
  setAppMuted: (muted: boolean) => void;
  toggleAppMute: () => void;
  setStyleSfxEnabled: (enabled: boolean) => void;
  toggleStyleSfx: () => void;
}

const initial = readStoredState();

export const useSound = create<SoundState>((set, get) => ({
  ...initial,

  setCardVolume: (vol) => {
    const clamped = clampVolume(vol);
    safeSet(STORAGE_KEY_CARD_VOLUME, String(clamped));
    const muted = get().cardMuted;
    const eff = muted ? 0 : clamped / 100;
    set({
      volume: clamped,
      cardVolume: clamped,
      effectiveVolume: eff,
      cardEffectiveVolume: eff,
    });
  },
  setCardMuted: (muted) => {
    safeSet(STORAGE_KEY_CARD_MUTED, String(muted));
    const vol = get().cardVolume;
    const eff = muted ? 0 : vol / 100;
    set({
      muted,
      cardMuted: muted,
      effectiveVolume: eff,
      cardEffectiveVolume: eff,
    });
  },
  toggleCardMute: () => {
    get().setCardMuted(!get().cardMuted);
  },

  setVolume: (vol) => {
    get().setCardVolume(vol);
  },
  setMuted: (muted) => {
    get().setCardMuted(muted);
  },
  toggleMute: () => {
    get().toggleCardMute();
  },

  setAppVolume: (vol) => {
    const clamped = clampVolume(vol);
    safeSet(STORAGE_KEY_APP_VOLUME, String(clamped));
    const muted = get().appMuted;
    set({
      appVolume: clamped,
      appEffectiveVolume: muted ? 0 : clamped / 100,
    });
  },
  setAppMuted: (muted) => {
    safeSet(STORAGE_KEY_APP_MUTED, String(muted));
    const vol = get().appVolume;
    set({
      appMuted: muted,
      appEffectiveVolume: muted ? 0 : vol / 100,
    });
  },
  toggleAppMute: () => {
    get().setAppMuted(!get().appMuted);
  },

  setStyleSfxEnabled: (enabled) => {
    safeSet(STORAGE_KEY_STYLE_SFX, String(enabled));
    set({ styleSfxEnabled: enabled });
  },
  toggleStyleSfx: () => {
    get().setStyleSfxEnabled(!get().styleSfxEnabled);
  },
}));

/** Reload and migrate sound preferences from localStorage (used by tests). */
export function initSoundFromStorage(): void {
  useSound.setState(readStoredState());
}

/** Effective volume (0.0 - 1.0) for card audio (card media, TTS, media preview). */
export function getCardEffectiveVolume(): number {
  const s = useSound.getState();
  return s.muted ? 0 : s.volume / 100;
}

/** Subscribe to changes in card audio effective volume only. */
export function subscribeCardEffectiveVolume(callback: (volume: number) => void): () => void {
  let prev = getCardEffectiveVolume();
  return useSound.subscribe(() => {
    const next = getCardEffectiveVolume();
    if (next !== prev) {
      prev = next;
      callback(next);
    }
  });
}

/** Effective volume (0.0 - 1.0) for app sounds (style cues and pop-up sounds). */
export function getAppEffectiveVolume(): number {
  const s = useSound.getState();
  return s.appMuted ? 0 : s.appVolume / 100;
}

/** Subscribe to changes in app sounds effective volume only. */
export function subscribeAppEffectiveVolume(callback: (volume: number) => void): () => void {
  let prev = getAppEffectiveVolume();
  return useSound.subscribe(() => {
    const next = getAppEffectiveVolume();
    if (next !== prev) {
      prev = next;
      callback(next);
    }
  });
}

/** Non-reactive getter for card audio effective volume (legacy alias). */
export function getEffectiveVolume(): number {
  return getCardEffectiveVolume();
}

/** Subscribe to card audio effective volume changes (legacy alias). */
export function subscribeEffectiveVolume(callback: (volume: number) => void): () => void {
  return subscribeCardEffectiveVolume(callback);
}
