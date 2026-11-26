import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playStyleCue, resetStyleAudioForTest } from "./styleAudio";
import { getCardEffectiveVolume, useSound } from "@/stores/sound";
import { useStyle } from "@/stores/style";

interface FakeAudioCapture {
  urlsFetched: string[];
  gains: number[];
  startCalls: number;
  contextCreations: number;
  resumeCalls: number;
}

function installAudioMocks(options?: {
  throwOnConstruct?: boolean;
  rejectDecode?: boolean;
  rejectFetch?: boolean;
  initialState?: AudioContextState;
}): FakeAudioCapture {
  const capture: FakeAudioCapture = {
    urlsFetched: [],
    gains: [],
    startCalls: 0,
    contextCreations: 0,
    resumeCalls: 0,
  };

  class FakeAudioContext {
    state: AudioContextState = options?.initialState ?? "running";
    destination = {} as AudioDestinationNode;

    constructor() {
      capture.contextCreations += 1;
      if (options?.throwOnConstruct) {
        throw new DOMException("NotAllowedError", "NotAllowedError");
      }
    }

    resume = vi.fn(async () => {
      capture.resumeCalls += 1;
      this.state = "running";
    });

    decodeAudioData = vi.fn(async () => {
      if (options?.rejectDecode) {
        throw new Error("decode failed");
      }
      return {} as AudioBuffer;
    });

    createBufferSource = vi.fn(() => ({
      buffer: null as AudioBuffer | null,
      connect: vi.fn(),
      start: vi.fn(() => {
        capture.startCalls += 1;
      }),
    }));

    createGain = vi.fn(() => {
      const node = {
        gain: { value: 1 },
        connect: vi.fn(),
      };
      capture.gains.push(node.gain.value);
      return new Proxy(node, {
        get(target, prop) {
          return Reflect.get(target, prop);
        },
      });
    });
  }

  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      capture.urlsFetched.push(String(input));
      if (options?.rejectFetch) {
        throw new Error("network error");
      }
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      } as unknown as Response;
    }),
  );

  return capture;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("styleAudio (14g)", () => {
  beforeEach(() => {
    resetStyleAudioForTest();
    localStorage.clear();
    useStyle.getState().setStyle("game");
    useSound.setState({
      volume: 100,
      muted: false,
      effectiveVolume: 1,
      cardVolume: 100,
      cardMuted: false,
      cardEffectiveVolume: 1,
      appVolume: 100,
      appMuted: false,
      appEffectiveVolume: 1,
      styleSfxEnabled: true,
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetStyleAudioForTest();
  });

  it("style_audio_respects_mute_volume_and_toggle", async () => {
    const gainsApplied: number[] = [];
    const startMock = vi.fn();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    vi.stubGlobal("fetch", fetchMock);

    class TrackingAudioContext {
      state: AudioContextState = "running";
      destination = {};
      resume = vi.fn(async () => {});
      decodeAudioData = vi.fn(async () => ({}) as AudioBuffer);
      createBufferSource = vi.fn(() => ({
        buffer: null as AudioBuffer | null,
        connect: vi.fn(),
        start: startMock,
      }));
      createGain = vi.fn(() => {
        const gainObj = {
          _val: 1,
          get value() {
            return this._val;
          },
          set value(v: number) {
            this._val = v;
            gainsApplied.push(v);
          },
        };
        return { gain: gainObj, connect: vi.fn() };
      });
    }
    vi.stubGlobal("AudioContext", TrackingAudioContext);

    // 1. App muted: zero playback
    useSound.getState().setAppMuted(true);
    playStyleCue("review_answer", { now: 1000 });
    await flushMicrotasks();
    expect(startMock).not.toHaveBeenCalled();

    // 2. App volume 0: zero playback
    useSound.getState().setAppMuted(false);
    useSound.getState().setAppVolume(0);
    playStyleCue("review_answer", { now: 2000 });
    await flushMicrotasks();
    expect(startMock).not.toHaveBeenCalled();

    // 3. Toggle disabled: zero playback
    useSound.getState().setAppVolume(60);
    useSound.getState().setStyleSfxEnabled(false);
    expect(localStorage.getItem("keepsake-style-sfx-enabled")).toBe("false");
    playStyleCue("review_answer", { now: 3000 });
    await flushMicrotasks();
    expect(startMock).not.toHaveBeenCalled();

    // 4. Toggle enabled + app volume 60: plays Game cue at gain 0.6
    useSound.getState().setStyleSfxEnabled(true);
    expect(localStorage.getItem("keepsake-style-sfx-enabled")).toBe("true");
    playStyleCue("review_answer", { now: 4000 });
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledWith("/sounds/game/review_answer.mp3");
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(gainsApplied[gainsApplied.length - 1]).toBeCloseTo(0.6);

    // 5. Scholar style maps to /sounds/scholar/
    useStyle.getState().setStyle("scholar");
    playStyleCue("level_up", { now: 5000 });
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledWith("/sounds/scholar/level_up.mp3");
    expect(startMock).toHaveBeenCalledTimes(2);
  });

  it("style_cue_uses_app_volume_card_audio_uses_card_volume", async () => {
    const gainsApplied: number[] = [];
    const startMock = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );
    class TrackingAudioContext {
      state: AudioContextState = "running";
      destination = {};
      resume = vi.fn(async () => {});
      decodeAudioData = vi.fn(async () => ({}) as AudioBuffer);
      createBufferSource = vi.fn(() => ({
        buffer: null as AudioBuffer | null,
        connect: vi.fn(),
        start: startMock,
      }));
      createGain = vi.fn(() => ({
        gain: {
          set value(v: number) {
            gainsApplied.push(v);
          },
        },
        connect: vi.fn(),
      }));
    }
    vi.stubGlobal("AudioContext", TrackingAudioContext);

    // Card audio muted & low, app sounds at 75%: playStyleCue still plays at 0.75.
    useSound.getState().setCardVolume(15);
    useSound.getState().setCardMuted(true);
    useSound.getState().setAppVolume(75);
    useSound.getState().setAppMuted(false);

    expect(getCardEffectiveVolume()).toBe(0);
    playStyleCue("unlock", { now: 6000 });
    await flushMicrotasks();
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(gainsApplied[gainsApplied.length - 1]).toBeCloseTo(0.75);

    // App sounds muted, card audio unmuted at 45%: playStyleCue stays silent, card audio is 0.45.
    useSound.getState().setAppMuted(true);
    useSound.getState().setCardMuted(false);
    useSound.getState().setCardVolume(45);

    expect(getCardEffectiveVolume()).toBeCloseTo(0.45);
    playStyleCue("achievement", { now: 7000 });
    await flushMicrotasks();
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it("style_audio_coalesces_bursts_and_skips_hidden", async () => {
    const capture = installAudioMocks({ initialState: "suspended" });

    // 1. 3 simultaneous unlock calls trigger at most 1 play within 150ms
    playStyleCue("unlock", { now: 1000 });
    playStyleCue("unlock", { now: 1020 });
    playStyleCue("unlock", { now: 1120 });
    await flushMicrotasks();
    expect(capture.startCalls).toBe(1);
    expect(capture.resumeCalls).toBe(1);

    // 2. Simultaneous different cue inside burst window is coalesced
    playStyleCue("achievement", { now: 1140 });
    await flushMicrotasks();
    expect(capture.startCalls).toBe(1);

    // 3. After cooldown (300ms for unlock), plays again
    playStyleCue("unlock", { now: 1400 });
    await flushMicrotasks();
    expect(capture.startCalls).toBe(2);

    // 4. Skips when document.hidden is true
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    playStyleCue("purchase", { now: 2000 });
    await flushMicrotasks();
    expect(capture.startCalls).toBe(2);

    // 5. Errors are swallowed silently
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    resetStyleAudioForTest();
    installAudioMocks({ rejectFetch: true });
    expect(() => playStyleCue("level_up", { now: 3000 })).not.toThrow();
    await flushMicrotasks();
  });

  it("default_style_plays_nothing", async () => {
    const capture = installAudioMocks();
    useStyle.getState().setStyle("default");

    playStyleCue("review_answer", { now: 1000 });
    playStyleCue("level_up", { now: 2000 });
    playStyleCue("purchase", { now: 3000 });
    playStyleCue("unlock", { now: 4000 });
    playStyleCue("achievement", { now: 5000 });
    await flushMicrotasks();

    expect(capture.contextCreations).toBe(0);
    expect(capture.urlsFetched).toEqual([]);
    expect(capture.startCalls).toBe(0);
  });

  it("bundles all 5 MP3 cues per style under the 300 KB budget", () => {
    const cues = [
      "review_answer.mp3",
      "level_up.mp3",
      "purchase.mp3",
      "unlock.mp3",
      "achievement.mp3",
    ];
    for (const style of ["game", "scholar"] as const) {
      const dir = resolve(process.cwd(), "public/sounds", style);
      const files = readdirSync(dir).sort();
      expect(files).toEqual([...cues].sort());
      const totalBytes = files.reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);
      expect(totalBytes).toBeGreaterThan(0);
      expect(totalBytes).toBeLessThanOrEqual(300 * 1024);
    }
  });
});
