import { beforeEach, describe, expect, it, vi } from "vitest";
import { speak } from "./tts";
import { useSound } from "@/stores/sound";

describe("TTS volume integration (U8)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSound.setState({ volume: 100, muted: false, effectiveVolume: 1 });
  });

  it("sets utterance.volume from sound store effectiveVolume", async () => {
    let capturedVolume: number | undefined;

    class FakeUtterance {
      text: string;
      volume = 1;
      voice: SpeechSynthesisVoice | null = null;
      lang = "";
      rate = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }

    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => [{ name: "TestVoice", lang: "en-US" }],
      speak: (utter: FakeUtterance) => {
        capturedVolume = utter.volume;
        setTimeout(() => utter.onend?.(), 0);
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    useSound.getState().setVolume(35);
    await speak("Hello world");

    expect(capturedVolume).toBeCloseTo(0.35);

    useSound.getState().setMuted(true);
    await speak("Muted speech");
    expect(capturedVolume).toBe(0);
  });
});
