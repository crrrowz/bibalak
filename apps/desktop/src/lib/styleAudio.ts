import { getAppEffectiveVolume, useSound } from "@/stores/sound";
import { useStyle, type Style } from "@/stores/style";

export type StyleCue = "review_answer" | "level_up" | "purchase" | "unlock" | "achievement";

export interface StyleAudioOptions {
  /** Overrides active presentation style (primarily for tests). */
  style?: Style;
  /** Overrides current timestamp in ms (primarily for deterministic cooldown tests). */
  now?: number;
}

const STYLE_CUE_URLS: Record<Exclude<Style, "default">, Record<StyleCue, string>> = {
  game: {
    review_answer: "/sounds/game/review_answer.mp3",
    level_up: "/sounds/game/level_up.mp3",
    purchase: "/sounds/game/purchase.mp3",
    unlock: "/sounds/game/unlock.mp3",
    achievement: "/sounds/game/achievement.mp3",
  },
  scholar: {
    review_answer: "/sounds/scholar/review_answer.mp3",
    level_up: "/sounds/scholar/level_up.mp3",
    purchase: "/sounds/scholar/purchase.mp3",
    unlock: "/sounds/scholar/unlock.mp3",
    achievement: "/sounds/scholar/achievement.mp3",
  },
};

const CUE_COOLDOWN_MS: Record<StyleCue, number> = {
  review_answer: 80,
  level_up: 500,
  purchase: 150,
  unlock: 300,
  achievement: 300,
};

/** Global burst coalescing window across simultaneous cues (ms). */
const BURST_COALESCE_MS = 150;

let audioCtx: AudioContext | null = null;
const bufferCache = new Map<string, AudioBuffer>();
const pendingBuffers = new Map<string, Promise<AudioBuffer | null>>();
let lastAnyCueAt = -Infinity;
let nextScheduledSlotAt = -Infinity;
const lastCuePlayedAt: Partial<Record<StyleCue, number>> = {};
const queuedCueTimers = new Map<StyleCue, ReturnType<typeof setTimeout>>();

function getAudioContextConstructor(): (new () => AudioContext) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function ensureAudioContext(): AudioContext | null {
  if (audioCtx) return audioCtx;
  const Ctor = getAudioContextConstructor();
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

async function loadAudioBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(url);
  if (cached) return cached;

  const inflight = pendingBuffers.get(url);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      bufferCache.set(url, decoded);
      return decoded;
    } catch {
      return null;
    } finally {
      pendingBuffers.delete(url);
    }
  })();

  pendingBuffers.set(url, promise);
  return promise;
}

function playWithHtmlAudio(url: string, volume: number): void {
  if (typeof Audio === "undefined") return;
  try {
    const audio = new Audio(url);
    audio.volume = volume;
    void audio.play().catch(() => {});
  } catch {
    // ignore playback failures
  }
}

function playBuffer(ctx: AudioContext, buffer: AudioBuffer): void {
  const volume = getAppEffectiveVolume();
  if (volume <= 0) return;
  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
  } catch {
    // ignore playback failures
  }
}

/**
 * Play a short presentation-style sound cue for Game or Scholar.
 * Default style is always silent. Respects styleSfxEnabled, app volume/mute,
 * document.hidden, per-cue cooldowns, and burst coalescing.
 */
export function playStyleCue(cue: StyleCue, options?: StyleAudioOptions): void {
  try {
    const style = options?.style ?? useStyle.getState().style;
    if (style === "default") return;

    const { styleSfxEnabled } = useSound.getState();
    if (!styleSfxEnabled) return;

    const volume = getAppEffectiveVolume();
    if (volume <= 0) return;

    if (typeof document !== "undefined" && document.hidden) return;

    const now = options?.now ?? Date.now();
    const lastForCue = lastCuePlayedAt[cue] ?? -Infinity;
    if (now - lastForCue < CUE_COOLDOWN_MS[cue]) return;

    if (now - lastAnyCueAt < BURST_COALESCE_MS) {
      if (options?.now === undefined && !queuedCueTimers.has(cue)) {
        const baseAt = Math.max(now, nextScheduledSlotAt, lastAnyCueAt);
        const targetAt = baseAt + BURST_COALESCE_MS;
        nextScheduledSlotAt = targetAt;
        const delayMs = Math.max(1, targetAt - now);
        const timer = setTimeout(() => {
          queuedCueTimers.delete(cue);
          playStyleCue(cue);
        }, delayMs);
        queuedCueTimers.set(cue, timer);
      }
      return;
    }

    lastAnyCueAt = now;
    nextScheduledSlotAt = Math.max(nextScheduledSlotAt, now);
    lastCuePlayedAt[cue] = now;

    const url = STYLE_CUE_URLS[style][cue];
    const ctx = ensureAudioContext();
    if (!ctx) {
      playWithHtmlAudio(url, volume);
      return;
    }

    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }

    const cached = bufferCache.get(url);
    if (cached) {
      playBuffer(ctx, cached);
      return;
    }

    void loadAudioBuffer(ctx, url).then((buffer) => {
      if (!buffer) return;
      if (typeof document !== "undefined" && document.hidden) return;
      playBuffer(ctx, buffer);
    });
  } catch {
    // Never surface audio errors to the UI
  }
}

/** Reset cached audio context, buffers, and cooldown timestamps (tests only). */
export function resetStyleAudioForTest(): void {
  audioCtx = null;
  bufferCache.clear();
  pendingBuffers.clear();
  lastAnyCueAt = -Infinity;
  nextScheduledSlotAt = -Infinity;
  for (const timer of queuedCueTimers.values()) {
    clearTimeout(timer);
  }
  queuedCueTimers.clear();
  for (const key of Object.keys(lastCuePlayedAt) as StyleCue[]) {
    delete lastCuePlayedAt[key];
  }
}
