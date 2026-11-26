import { beforeEach, describe, expect, it } from "vitest";
import {
  getAppEffectiveVolume,
  getCardEffectiveVolume,
  getEffectiveVolume,
  initSoundFromStorage,
  subscribeAppEffectiveVolume,
  subscribeCardEffectiveVolume,
  subscribeEffectiveVolume,
  useSound,
} from "./sound";

describe("sound store (OT-11 / U8 / 16h)", () => {
  beforeEach(() => {
    localStorage.clear();
    initSoundFromStorage();
  });

  it("defaults to 100 volume and not muted", () => {
    expect(useSound.getState().volume).toBe(100);
    expect(useSound.getState().muted).toBe(false);
    expect(useSound.getState().effectiveVolume).toBe(1);
    expect(getEffectiveVolume()).toBe(1);
    expect(getCardEffectiveVolume()).toBe(1);
    expect(getAppEffectiveVolume()).toBe(1);
  });

  it("clamps volume between 0 and 100 and persists in localStorage", () => {
    useSound.getState().setCardVolume(120);
    expect(useSound.getState().cardVolume).toBe(100);
    expect(useSound.getState().volume).toBe(100);
    expect(localStorage.getItem("keepsake-card-volume")).toBe("100");

    useSound.getState().setCardVolume(-20);
    expect(useSound.getState().cardVolume).toBe(0);
    expect(localStorage.getItem("keepsake-card-volume")).toBe("0");

    useSound.getState().setCardVolume(45.6);
    expect(useSound.getState().cardVolume).toBe(46);
    expect(useSound.getState().cardEffectiveVolume).toBeCloseTo(0.46);
    expect(useSound.getState().effectiveVolume).toBeCloseTo(0.46);
    expect(localStorage.getItem("keepsake-card-volume")).toBe("46");
  });

  it("calculates effectiveVolume as 0 when muted, and restores when unmuted", () => {
    useSound.getState().setCardVolume(80);
    expect(useSound.getState().effectiveVolume).toBeCloseTo(0.8);

    useSound.getState().setCardMuted(true);
    expect(useSound.getState().muted).toBe(true);
    expect(useSound.getState().effectiveVolume).toBe(0);
    expect(getEffectiveVolume()).toBe(0);
    expect(getCardEffectiveVolume()).toBe(0);
    expect(localStorage.getItem("keepsake-card-muted")).toBe("true");

    useSound.getState().toggleCardMute();
    expect(useSound.getState().muted).toBe(false);
    expect(useSound.getState().effectiveVolume).toBeCloseTo(0.8);
    expect(getEffectiveVolume()).toBeCloseTo(0.8);
  });

  it("notifies subscribers when volume or mute changes", () => {
    const volumes: number[] = [];
    const unsub = subscribeEffectiveVolume((v) => volumes.push(v));

    useSound.getState().setVolume(50);
    useSound.getState().setMuted(true);
    useSound.getState().setMuted(false);

    unsub();
    useSound.getState().setVolume(20);

    expect(volumes).toEqual([0.5, 0, 0.5]);
  });

  it("two_volumes_are_independent_and_migrate_old_value", () => {
    // Migrate old single value into both card audio and app sounds on first run.
    localStorage.setItem("keepsake-sound-volume", "65");
    localStorage.setItem("keepsake-sound-muted", "true");
    initSoundFromStorage();

    expect(useSound.getState().cardVolume).toBe(65);
    expect(useSound.getState().cardMuted).toBe(true);
    expect(useSound.getState().appVolume).toBe(65);
    expect(useSound.getState().appMuted).toBe(true);
    expect(localStorage.getItem("keepsake-card-volume")).toBe("65");
    expect(localStorage.getItem("keepsake-app-volume")).toBe("65");
    expect(localStorage.getItem("keepsake-card-muted")).toBe("true");
    expect(localStorage.getItem("keepsake-app-muted")).toBe("true");

    // Changing one never changes the other, and subscribers stay independent.
    const cardEvents: number[] = [];
    const appEvents: number[] = [];
    const unsubCard = subscribeCardEffectiveVolume((v) => cardEvents.push(v));
    const unsubApp = subscribeAppEffectiveVolume((v) => appEvents.push(v));

    useSound.getState().setCardMuted(false);
    useSound.getState().setCardVolume(30);
    expect(getCardEffectiveVolume()).toBeCloseTo(0.3);
    expect(getAppEffectiveVolume()).toBe(0);
    expect(useSound.getState().appVolume).toBe(65);
    expect(useSound.getState().appMuted).toBe(true);

    useSound.getState().setAppMuted(false);
    useSound.getState().setAppVolume(85);
    expect(getAppEffectiveVolume()).toBeCloseTo(0.85);
    expect(getCardEffectiveVolume()).toBeCloseTo(0.3);

    unsubCard();
    unsubApp();

    expect(cardEvents).toEqual([0.65, 0.3]);
    expect(appEvents).toEqual([0.65, 0.85]);

    // Subsequent loads keep independent values instead of re-migrating old key.
    initSoundFromStorage();
    expect(useSound.getState().cardVolume).toBe(30);
    expect(useSound.getState().cardMuted).toBe(false);
    expect(useSound.getState().appVolume).toBe(85);
    expect(useSound.getState().appMuted).toBe(false);
  });
});
