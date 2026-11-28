import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudySessionScreen } from "./StudySessionScreen";
import * as ipc from "@/lib/ipc";
import { setLocale } from "@/lib/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { useSound } from "@/stores/sound";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ deckId: 1 }),
  useNavigate: () => vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AUDIT1 audio queue & replay fixes (F2, A1-16, A1-21)", () => {
  it("F2 / A1-16a: does not play audio from stale cached card before empty queue resolves", async () => {
    const playSpy = vi.fn().mockResolvedValue(undefined);
    const pauseSpy = vi.fn();
    const AudioMock = vi.fn(function (this: Record<string, unknown>, src: string) {
      this.src = src;
      this.volume = 1;
      this.play = playSpy;
      this.pause = pauseSpy;
      this.onended = null;
    });
    vi.stubGlobal("Audio", AudioMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    // Seed stale cached card in queue (e.g. from previous session or pre-reset).
    queryClient.setQueryData(queryKeys.queue("1"), {
      card_id: 42,
      note_id: 10,
      deck_id: 1,
      question: "Word [sound:stale-audio.mp3]",
      answer: "Meaning",
      again: "1m",
      hard: "6m",
      good: "10m",
      easy: "4d",
      new_count: 1,
      learning_count: 0,
      review_count: 0,
      card_phase: "new",
      algorithm: "sm2",
      css: "",
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getNextCard").mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(null), 30)),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <StudySessionScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("session-finish")).toBeInTheDocument();
    });

    expect(playSpy).not.toHaveBeenCalled();
  });

  it("A1-16b: advancing from a card with [sound:] to a plain card does not play card 1 audio on card 2", async () => {
    setLocale("en");
    useSound.setState({ volume: 100, muted: false, effectiveVolume: 1 });
    const playedSrcs: string[] = [];
    const playSpy = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function (this: Record<string, unknown>, src: string) {
      this.src = src;
      this.volume = 1;
      this.play = () => {
        playedSrcs.push(src);
        return playSpy();
      };
      this.pause = vi.fn();
      this.onended = null;
    });
    vi.stubGlobal("Audio", AudioMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue({
      card_id: 201,
      note_id: 21,
      deck_id: 1,
      question: "First [sound:first-card.mp3]",
      answer: "Answer 1",
      again: "1m",
      hard: "6m",
      good: "10m",
      easy: "4d",
      new_count: 2,
      learning_count: 0,
      review_count: 0,
      card_phase: "new",
      algorithm: "sm2",
      css: "",
      flag: 0,
    });
    vi.spyOn(ipc.ipc, "answerCard").mockResolvedValue({
      card_id: 202,
      note_id: 22,
      deck_id: 1,
      question: "Second card plain text",
      answer: "Answer 2",
      again: "1m",
      hard: "6m",
      good: "10m",
      easy: "4d",
      new_count: 1,
      learning_count: 0,
      review_count: 0,
      card_phase: "new",
      algorithm: "sm2",
      css: "",
      flag: 0,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StudySessionScreen />
      </QueryClientProvider>,
    );

    await screen.findByRole("button", { name: /Replay/i });
    await waitFor(() => {
      expect(playSpy).toHaveBeenCalledTimes(1);
    });
    const countBeforeAdvance = playedSrcs.length;

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Show Answer/i }));
    await user.click(await screen.findByRole("button", { name: /Good/i }));

    await new Promise((r) => setTimeout(r, 30));

    expect(
      playedSrcs.slice(countBeforeAdvance).filter((s) => s.includes("first-card.mp3")),
    ).toEqual([]);
  });

  it("A1-21a: clicking Replay twice replays single-sound queue when queueIdx is already 0", async () => {
    setLocale("en");
    useSound.setState({ volume: 100, muted: false, effectiveVolume: 1 });
    const playSpy = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function (this: Record<string, unknown>, src: string) {
      this.src = src;
      this.volume = 1;
      this.play = playSpy;
      this.pause = vi.fn();
      this.onended = null;
    });
    vi.stubGlobal("Audio", AudioMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue({
      card_id: 203,
      note_id: 23,
      deck_id: 1,
      question: "Word [sound:solo.mp3]",
      answer: "Meaning",
      again: "1m",
      hard: "6m",
      good: "10m",
      easy: "4d",
      new_count: 1,
      learning_count: 0,
      review_count: 0,
      card_phase: "new",
      algorithm: "sm2",
      css: "",
      flag: 0,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StudySessionScreen />
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    const replayBtn = await screen.findByRole("button", { name: /Replay/i });
    await waitFor(() => {
      expect(playSpy).toHaveBeenCalledTimes(1);
    });

    // Second click while idx === 0 (onended has not fired).
    await user.click(replayBtn);
    await waitFor(() => {
      expect(playSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("A1-21b: rejected play() advances to next item instead of stalling the queue", async () => {
    setLocale("en");
    useSound.setState({ volume: 100, muted: false, effectiveVolume: 1 });
    const playedSrcs: string[] = [];
    const AudioMock = vi.fn(function (this: Record<string, unknown>, src: string) {
      this.src = src;
      this.volume = 1;
      this.play = () => {
        playedSrcs.push(src);
        if (src.includes("broken.mp3")) {
          return Promise.reject(new Error("decode error"));
        }
        return Promise.resolve();
      };
      this.pause = vi.fn();
      this.onended = null;
    });
    vi.stubGlobal("Audio", AudioMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue({
      card_id: 204,
      note_id: 24,
      deck_id: 1,
      question: "One [sound:broken.mp3] Two [sound:ok.mp3]",
      answer: "Meaning",
      again: "1m",
      hard: "6m",
      good: "10m",
      easy: "4d",
      new_count: 1,
      learning_count: 0,
      review_count: 0,
      card_phase: "new",
      algorithm: "sm2",
      css: "",
      flag: 0,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StudySessionScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(playedSrcs.some((s) => s.includes("ok.mp3"))).toBe(true);
    });
  });
});
