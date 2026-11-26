import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudySessionScreen } from "./StudySessionScreen";
import * as ipc from "@/lib/ipc";
import { setLocale } from "@/lib/i18n";
import * as styleAudio from "@/lib/styleAudio";
import { useSound } from "@/stores/sound";
import { useStyle } from "@/stores/style";
import { useUi } from "@/stores/ui";

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

describe("StudySessionScreen undo toast localization (X8)", () => {
  it("shows localized Arabic undo toast when undoing an answer", async () => {
    setLocale("ar");
    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
      vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue(null);
      vi.spyOn(ipc.ipc, "undo").mockResolvedValue({ kind: "answer-card" });

      render(
        <QueryClientProvider client={queryClient}>
          <StudySessionScreen />
        </QueryClientProvider>,
      );

      const undoBtn = await screen.findByRole("button", { name: "تراجع" });
      await userEvent.click(undoBtn);

      expect(await screen.findByText("تم التراجع: الإجابة عن بطاقة")).toBeInTheDocument();
    } finally {
      setLocale("en");
    }
  });

  it("E11: shows Explain this card only after reveal and previews before sending", async () => {
    setLocale("en");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Biology",
        parent_id: null,
        is_filtered: false,
        collapsed: false,
        new_count: 1,
        learning_count: 0,
        review_count: 0,
      },
    ]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: true,
    });
    vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue({
      card_id: 77,
      note_id: 10,
      deck_id: 1,
      question: "<b>Q</b>",
      answer: "<i>A</i>",
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
    const previewSpy = vi.spyOn(ipc.ipc, "aiPreviewAction").mockResolvedValue({
      provider: "open-ai-compatible",
      endpoint_origin: "https://api.openai.com",
      model: "gpt-4o-mini",
      system: "Tutor",
      prompt: "Front:\nQ\n\nBack:\nA",
    });
    const runSpy = vi.spyOn(ipc.ipc, "aiRunAction").mockResolvedValue({
      prompt_id: "explain_card@1",
      text: "Because A defines Q.",
      suggested_fields: null,
      generated_cards: null,
      quality_findings: null,
      input_tokens: 10,
      output_tokens: 5,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StudySessionScreen />
      </QueryClientProvider>,
    );

    const showAnswerBtn = await screen.findByRole("button", { name: /Show Answer/i });
    expect(screen.queryByRole("button", { name: /^Tutor/i })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(showAnswerBtn);

    await user.click(await screen.findByRole("button", { name: /^Tutor/i }));
    const explainBtn = await screen.findByRole("button", { name: /Explain this card/i });
    await user.click(explainBtn);

    expect(await screen.findByText("https://api.openai.com")).toBeInTheDocument();
    expect(previewSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Send to AI/i }));
    expect(await screen.findByText("Because A defines Q.")).toBeInTheDocument();
  });

  it("U4: adjusts card reading scale smoothly from the study bar", async () => {
    setLocale("en");
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue({
      card_id: 88,
      note_id: 11,
      deck_id: 1,
      question: "<b>Q</b>",
      answer: "<i>A</i>",
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

    render(
      <QueryClientProvider client={queryClient}>
        <StudySessionScreen />
      </QueryClientProvider>,
    );

    const zoomIn = await screen.findByRole("button", { name: /Increase card text size/i });
    const zoomOut = screen.getByRole("button", { name: /Decrease card text size/i });

    await user.click(zoomIn);
    expect((useUi.getState() as { studyScale?: number }).studyScale).toBe(1.1);

    await user.click(zoomOut);
    await user.click(zoomOut);
    expect((useUi.getState() as { studyScale?: number }).studyScale).toBe(0.9);
  });

  it("AI0: keeps Explain this card visible when AI is off and opens Set up AI explainer", async () => {
    setLocale("en");
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue({
      enabled: false,
      provider: "open-ai-compatible",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      has_api_key: false,
    });
    vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue({
      card_id: 99,
      note_id: 12,
      deck_id: 1,
      question: "<b>Q</b>",
      answer: "<i>A</i>",
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
    const runSpy = vi.spyOn(ipc.ipc, "aiRunAction").mockClear();
    const previewSpy = vi.spyOn(ipc.ipc, "aiPreviewAction").mockClear();

    render(
      <QueryClientProvider client={queryClient}>
        <StudySessionScreen />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /Show Answer/i }));
    await user.click(await screen.findByRole("button", { name: /^Tutor/i }));
    const explainBtn = await screen.findByRole("button", { name: /Explain this card/i });
    await user.click(explainBtn);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/Set up AI/i);
    expect(previewSpy).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("AI2: opens compact Tutor panel via T shortcut/button with 5 actions, blocks study hotkeys while open, and closes on Esc", async () => {
    setLocale("en");
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Biology",
        parent_id: null,
        is_filtered: false,
        collapsed: false,
        new_count: 1,
        learning_count: 0,
        review_count: 0,
      },
    ]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "ollama",
      base_url: "http://localhost:11434",
      model: "llama3.1",
      has_api_key: false,
    });
    vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue({
      card_id: 120,
      note_id: 20,
      deck_id: 1,
      question: "<b>What is preload?</b>",
      answer: "<i>Initial stretching of cardiac myocytes before contraction.</i>",
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
    const answerSpy = vi.spyOn(ipc.ipc, "answerCard");

    render(
      <QueryClientProvider client={queryClient}>
        <StudySessionScreen />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /Show Answer/i }));

    const tutorBtn = await screen.findByRole("button", { name: /^Tutor/i });
    expect(tutorBtn).toBeInTheDocument();

    // Shortcut T opens the Tutor panel below the card with all 5 actions
    await user.keyboard("t");
    expect(await screen.findByRole("button", { name: /Explain this card/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Give an example/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mnemonic/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Translate/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Why was I wrong\?/i })).toBeInTheDocument();

    // Study keys 1-4 must do nothing while Tutor panel is open
    await user.keyboard("1");
    expect(answerSpy).not.toHaveBeenCalled();

    // Esc closes the Tutor panel cleanly
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: /Give an example/i })).not.toBeInTheDocument();
  });

  it("AI2: previews appending escaped AI result via Save to field (<br><br>) and saves through normal note path", async () => {
    setLocale("en");
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Biology",
        parent_id: null,
        is_filtered: false,
        collapsed: false,
        new_count: 1,
        learning_count: 0,
        review_count: 0,
      },
    ]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue({
      enabled: true,
      provider: "ollama",
      base_url: "http://localhost:11434",
      model: "llama3.1",
      has_api_key: false,
    });
    vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue({
      card_id: 121,
      note_id: 21,
      deck_id: 1,
      question: "<b>Front Q</b>",
      answer: "<i>Back A</i>",
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
    vi.spyOn(ipc.ipc, "aiPreviewAction").mockResolvedValue({
      provider: "ollama",
      endpoint_origin: "http://localhost:11434",
      model: "llama3.1",
      system: "Tutor",
      prompt: "Front:\nFront Q\n\nBack:\nBack A",
    });
    vi.spyOn(ipc.ipc, "aiRunAction").mockResolvedValue({
      prompt_id: "tutor_example@1",
      text: "Example <script>alert(1)</script>\nLine 2",
      suggested_fields: null,
      generated_cards: null,
      quality_findings: null,
      input_tokens: 12,
      output_tokens: 8,
    });
    vi.spyOn(ipc.ipc, "getNote").mockResolvedValue({
      note_id: 21,
      notetype_name: "Basic",
      fields: [
        {
          name: "Front",
          value: "Front Q",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
        {
          name: "Back",
          value: "Back A",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
      ],
      tags: ["cardiology"],
    });
    const saveNoteSpy = vi.spyOn(ipc.ipc, "saveNote").mockResolvedValue(undefined);

    render(
      <QueryClientProvider client={queryClient}>
        <StudySessionScreen />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /Show Answer/i }));
    await user.keyboard("t");
    await user.click(await screen.findByRole("button", { name: /Give an example/i }));
    await user.click(await screen.findByRole("button", { name: /^Send to AI$/i }));

    expect(await screen.findByText(/tutor_example@1/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Save to field/i }));
    const fieldSelect = (await screen.findByLabelText(/Target field/i)) as HTMLSelectElement;
    expect(fieldSelect.value).toBe("1");

    // Final appended HTML preview lives inside a sandboxed CardFace iframe
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("iframe[sandbox]")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Append to field/i }));
    expect(saveNoteSpy).toHaveBeenCalledWith(
      21,
      ["Front Q", "Back A<br><br>Example &lt;script&gt;alert(1)&lt;/script&gt;<br>Line 2"],
      ["cardiology"],
    );

    const undoSpy = vi.spyOn(ipc.ipc, "undo").mockResolvedValueOnce({ kind: "edit-note" });
    undoSpy.mockClear();
    await user.keyboard("z");
    expect(undoSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Undid: Edit note/i)).toBeInTheDocument();
  });

  it("H1: updates playing [sound:] audio volume immediately and ignores study hotkeys while slider has focus", async () => {
    setLocale("en");
    useSound.setState({ volume: 100, muted: false, effectiveVolume: 1 });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const mockAudio = {
      volume: 1,
      src: "",
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      onended: null as (() => void) | null,
    };
    const audioCtor = vi.fn(function () {
      return mockAudio;
    });
    vi.stubGlobal("Audio", audioCtor);

    try {
      vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
      vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue(null as never);
      vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue({
        card_id: 201,
        note_id: 31,
        deck_id: 1,
        question: "<b>Listen</b> [sound:music.mp3]",
        answer: "<i>Back</i>",
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
      const answerSpy = vi.spyOn(ipc.ipc, "answerCard");

      render(
        <QueryClientProvider client={queryClient}>
          <StudySessionScreen />
        </QueryClientProvider>,
      );

      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: /Replay/i }));
      await vi.waitFor(() => expect(mockAudio.play).toHaveBeenCalledTimes(1));
      expect(mockAudio.volume).toBe(1);

      useSound.getState().setVolume(35);
      expect(mockAudio.volume).toBeCloseTo(0.35);

      useSound.getState().setMuted(true);
      expect(mockAudio.volume).toBe(0);

      useSound.getState().setMuted(false);
      expect(mockAudio.volume).toBeCloseTo(0.35);

      // Reveal card, then focus an <input type="range"> slider: keys 1-4 and arrows must not answer the card.
      await user.click(await screen.findByRole("button", { name: /Show Answer/i }));
      const slider = document.createElement("input");
      slider.type = "range";
      document.body.appendChild(slider);
      try {
        slider.focus();
        await user.keyboard("{ArrowRight}{ArrowLeft}1234 ");
        expect(answerSpy).not.toHaveBeenCalled();
      } finally {
        slider.remove();
      }
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});

describe("StudySessionScreen feedback (16b)", () => {
  it("session_progress_bar_counts_and_rtl", async () => {
    setLocale("en");
    useStyle.getState().setStyle("game");
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const card1 = {
      card_id: 301,
      note_id: 41,
      deck_id: 1,
      question: "<b>Q1</b>",
      answer: "<i>A1</i>",
      again: "1m",
      hard: "6m",
      good: "10m",
      easy: "4d",
      new_count: 1,
      learning_count: 1,
      review_count: 2,
      card_phase: "review",
      algorithm: "fsrs" as const,
      css: "",
    };
    const card2 = {
      ...card1,
      card_id: 302,
      note_id: 42,
      question: "<b>Q2</b>",
      answer: "<i>A2</i>",
      new_count: 1,
      learning_count: 1,
      review_count: 1,
    };

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue(card1);
    vi.spyOn(ipc.ipc, "answerCard").mockResolvedValueOnce(card2);

    try {
      const { unmount } = render(
        <QueryClientProvider client={queryClient}>
          <StudySessionScreen />
        </QueryClientProvider>,
      );

      const bar = await screen.findByRole("progressbar", { name: /Session progress/i });
      expect(bar).toHaveAttribute("aria-valuenow", "0");
      expect(bar).toHaveAttribute("aria-valuemax", "4");
      expect(screen.getByText("0 of 4")).toBeInTheDocument();
      const fill = screen.getByTestId("session-progress-fill");
      expect(fill.className).toContain("bg-[hsl(var(--game-xp))]");

      await user.click(screen.getByRole("button", { name: /Show Answer/i }));
      await user.click(await screen.findByRole("button", { name: /Remembered/i }));

      await vi.waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "1"));
      expect(screen.getByText("1 of 4")).toBeInTheDocument();
      unmount();

      // Arabic RTL: uses "من" instead of "/", and Scholar style uses primary bar colour
      setLocale("ar");
      useStyle.getState().setStyle("scholar");
      const arClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={arClient}>
          <StudySessionScreen />
        </QueryClientProvider>,
      );

      const arBar = await screen.findByRole("progressbar", { name: /تقدّم الجلسة/i });
      expect(arBar).toHaveAttribute("aria-valuemax", "4");
      expect(screen.getByText("0 من 4")).toBeInTheDocument();
      expect(screen.getByTestId("session-progress-fill").className).toContain("bg-primary");
    } finally {
      setLocale("en");
      useStyle.getState().setStyle("default");
      vi.restoreAllMocks();
    }
  });

  it("in_a_row_badge_at_thresholds_and_resets_on_again", async () => {
    setLocale("en");
    useStyle.getState().setStyle("game");
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const makeCard = (id: number) => ({
      card_id: id,
      note_id: id,
      deck_id: 1,
      question: `<b>Q${id}</b>`,
      answer: `<i>A${id}</i>`,
      again: "1m",
      hard: "6m",
      good: "10m",
      easy: "4d",
      new_count: 10,
      learning_count: 0,
      review_count: 10,
      card_phase: "review",
      algorithm: "fsrs" as const,
      css: "",
    });

    let seq = 400;
    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue(makeCard(seq));
    vi.spyOn(ipc.ipc, "answerCard").mockImplementation(async () => makeCard(++seq));
    const cueSpy = vi.spyOn(styleAudio, "playStyleCue");

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <StudySessionScreen />
        </QueryClientProvider>,
      );

      const answer = async (buttonPattern: RegExp) => {
        await user.click(await screen.findByRole("button", { name: /Show Answer/i }));
        await user.click(await screen.findByRole("button", { name: buttonPattern }));
      };

      // 1 & 2: no badge yet
      await answer(/Remembered/i);
      expect(screen.queryByTestId("in-a-row-badge")).not.toBeInTheDocument();
      await answer(/Easy/i);
      expect(screen.queryByTestId("in-a-row-badge")).not.toBeInTheDocument();

      // 3: threshold badge appears in Game style (no sound of its own)
      await answer(/Remembered/i);
      expect(await screen.findByTestId("in-a-row-badge")).toHaveTextContent("Combo 3");
      expect(cueSpy.mock.calls.every(([cue]) => cue === "review_answer")).toBe(true);

      // Auto-hides after ~1.5 s
      await vi.waitFor(
        () => expect(screen.queryByTestId("in-a-row-badge")).not.toBeInTheDocument(),
        { timeout: 2500 },
      );

      // 4 (Easy, no badge) -> 5 (Good, badge at 5)
      await answer(/Easy/i);
      expect(screen.queryByTestId("in-a-row-badge")).not.toBeInTheDocument();
      await answer(/Remembered/i);
      expect(await screen.findByTestId("in-a-row-badge")).toHaveTextContent("Combo 5");

      // Again resets quietly and clears visible badge immediately
      await answer(/Forgot/i);
      await vi.waitFor(() =>
        expect(screen.queryByTestId("in-a-row-badge")).not.toBeInTheDocument(),
      );

      // 1, 2 after reset -> no badge; 3 -> badge returns at 3 (also verify Scholar wording)
      await act(async () => {
        useStyle.getState().setStyle("scholar");
      });
      await answer(/Remembered/i);
      await answer(/Easy/i);
      expect(screen.queryByTestId("in-a-row-badge")).not.toBeInTheDocument();
      await answer(/Remembered/i);
      expect(await screen.findByTestId("in-a-row-badge")).toHaveTextContent(
        "3 consecutive recalls",
      );
    } finally {
      setLocale("en");
      useStyle.getState().setStyle("default");
      vi.restoreAllMocks();
    }
  }, 10000);

  it("session_finish_shows_xp_and_cards_per_style", async () => {
    setLocale("en");
    useStyle.getState().setStyle("game");
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const card = {
      card_id: 501,
      note_id: 51,
      deck_id: 1,
      question: "<b>Q</b>",
      answer: "<i>A</i>",
      again: "1m",
      hard: "6m",
      good: "10m",
      easy: "4d",
      new_count: 0,
      learning_count: 0,
      review_count: 1,
      card_phase: "review",
      algorithm: "fsrs" as const,
      css: "",
    };

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Biology",
        parent_id: null,
        is_filtered: false,
        collapsed: false,
        new_count: 0,
        learning_count: 0,
        review_count: 1,
      },
    ]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getGameState").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getGameDepthState").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "progressSummary").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue(card);
    vi.spyOn(ipc.ipc, "answerCard").mockResolvedValue(null);

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <StudySessionScreen />
        </QueryClientProvider>,
      );

      await user.click(await screen.findByRole("button", { name: /Show Answer/i }));
      await user.click(await screen.findByRole("button", { name: /Remembered/i }));

      const finish = await screen.findByTestId("session-finish");
      expect(finish).toHaveTextContent("Training Run Complete!");
      expect(finish).toHaveTextContent("1");
      expect(finish).toHaveTextContent("+3 XP");
      expect(screen.getByTestId("avatar-stage")).toBeInTheDocument();
      expect(within(finish).getByRole("button", { name: /Back to decks/i })).toBeInTheDocument();
      expect(within(finish).getByRole("button", { name: /Undo/i })).toBeInTheDocument();
      expect(within(finish).getByRole("button", { name: /Deck options/i })).toBeInTheDocument();

      // Switch to Scholar: keeps avatar, switches to academic words
      await act(async () => {
        useStyle.getState().setStyle("scholar");
      });
      expect(finish).toHaveTextContent("Study block complete");
      expect(finish).toHaveTextContent("Cards reviewed");
      expect(finish).toHaveTextContent("+3 XP");
      expect(screen.getByTestId("avatar-stage")).toBeInTheDocument();

      // Switch to Default: calm finish with no avatar, plain words
      await act(async () => {
        useStyle.getState().setStyle("default");
      });
      expect(finish).toHaveTextContent("Session complete");
      expect(finish).toHaveTextContent("Cards reviewed");
      expect(finish).toHaveTextContent("+3 XP");
      expect(screen.queryByTestId("avatar-stage")).not.toBeInTheDocument();

      // Arabic wording in Scholar and Game
      await act(async () => {
        setLocale("ar");
        useStyle.getState().setStyle("scholar");
      });
      expect(finish).toHaveTextContent("اكتملت جلسة المراجعة");
      expect(finish).toHaveTextContent("البطاقات المراجَعة");
      expect(finish).toHaveTextContent("نقاط الخبرة المكتسبة");

      await act(async () => {
        useStyle.getState().setStyle("game");
      });
      expect(finish).toHaveTextContent("انتهت جولة التدريب!");
      expect(finish).toHaveTextContent("البطاقات المراجَعة");
    } finally {
      setLocale("en");
      useStyle.getState().setStyle("default");
      vi.restoreAllMocks();
    }
  });

  it("session_end_shows_xp_cards_accuracy_time_goal_and_streak_plus_one", async () => {
    setLocale("en");
    useStyle.getState().setStyle("game");
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const makeCard = (id: number) => ({
      card_id: id,
      note_id: id,
      deck_id: 1,
      question: `<b>Q${id}</b>`,
      answer: `<i>A${id}</i>`,
      again: "1m",
      hard: "6m",
      good: "10m",
      easy: "4d",
      new_count: 0,
      learning_count: 0,
      review_count: 2,
      card_phase: "review",
      algorithm: "fsrs" as const,
      css: "",
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Biology",
        parent_id: null,
        is_filtered: false,
        collapsed: false,
        new_count: 0,
        learning_count: 0,
        review_count: 2,
      },
    ]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getGameState").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getGameDepthState").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "progressSummary").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue(makeCard(701));
    vi.spyOn(ipc.ipc, "answerCard")
      .mockResolvedValueOnce(makeCard(702))
      .mockResolvedValueOnce(null);

    const motBefore = {
      daily_goal_xp: 20,
      today_xp: 17,
      goal_met_today: false,
      current_streak: 4,
      best_streak: 10,
      studied_today: false,
      next_milestone: 7,
      today_day_index: 365,
      today_date: "2026-11-24",
      days_remaining_in_week: 3,
      daily_quests: [],
      weekly_quest: {
        id: "w_reviews_150",
        kind: "weekly" as const,
        metric: "reviews" as const,
        progress: 17,
        target: 150,
        completed: false,
        reward_gold_cents: 1000,
      },
      monthly_badge: {
        month_key: "2026-11",
        completed_daily_quests: 5,
        target_daily_quests: 20,
        earned: false,
        earned_at: null,
        seen: false,
        reward_gold_cents: 1000,
      },
      earned_monthly_badges: [],
      comeback_offer: null,
      onboarding_completed: true,
      auto_frozen_day: null,
    };
    const motAfter = {
      ...motBefore,
      today_xp: 21,
      goal_met_today: true,
      current_streak: 5,
      studied_today: true,
    };
    const motSpy = vi.spyOn(ipc.ipc, "getMotivationState").mockResolvedValue(motBefore);

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <StudySessionScreen />
        </QueryClientProvider>,
      );

      await screen.findByRole("button", { name: /Show Answer/i });
      await vi.waitFor(() => expect(motSpy).toHaveBeenCalled());

      // Answer 1 pass (+3 XP) and 1 fail (+1 XP) -> 50% accuracy, 2 cards, +4 XP
      await user.click(await screen.findByRole("button", { name: /Show Answer/i }));
      await user.click(await screen.findByRole("button", { name: /Remembered/i }));
      motSpy.mockResolvedValue(motAfter);
      await user.click(await screen.findByRole("button", { name: /Show Answer/i }));
      await user.click(await screen.findByRole("button", { name: /Forgot/i }));

      const finish = await screen.findByTestId("session-finish");
      expect(finish).toHaveTextContent("Training Run Complete!");
      expect(finish).toHaveTextContent("+4 XP");
      expect(finish).toHaveTextContent("2");
      expect(finish).toHaveTextContent("50%");
      expect(finish).toHaveTextContent(/Time spent/i);

      // Goal ring shows 21 / 20 XP
      const ring = within(finish).getByRole("progressbar", { name: /21 \/ 20 XP/i });
      expect(ring).toHaveAttribute("aria-valuenow", "21");

      // Streak +1 moment shown with link to /streak
      expect(finish).toHaveTextContent("Streak +1");
      expect(finish).toHaveTextContent("5 days");
      expect(within(finish).getByRole("link", { name: /Open streak calendar/i })).toHaveAttribute(
        "href",
        "/streak",
      );
    } finally {
      setLocale("en");
      useStyle.getState().setStyle("default");
      vi.restoreAllMocks();
    }
  });

  it("streak_pill_does_not_cover_session_progress_bar", async () => {
    setLocale("en");
    useStyle.getState().setStyle("game");
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const makeCard = (id: number) => ({
      card_id: id,
      note_id: id,
      deck_id: 1,
      question: `<b>Q${id}</b>`,
      answer: `<i>A${id}</i>`,
      again: "1m",
      hard: "6m",
      good: "10m",
      easy: "4d",
      new_count: 0,
      learning_count: 0,
      review_count: 5,
      card_phase: "review",
      algorithm: "fsrs" as const,
      css: "",
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Biology",
        parent_id: null,
        is_filtered: false,
        collapsed: false,
        new_count: 0,
        learning_count: 0,
        review_count: 5,
      },
    ]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getGameState").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getGameDepthState").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "progressSummary").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getMotivationState").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue(makeCard(801));
    vi.spyOn(ipc.ipc, "answerCard")
      .mockResolvedValueOnce(makeCard(802))
      .mockResolvedValueOnce(makeCard(803))
      .mockResolvedValueOnce(makeCard(804));

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <StudySessionScreen />
        </QueryClientProvider>,
      );

      for (let i = 0; i < 3; i++) {
        await user.click(await screen.findByRole("button", { name: /Show Answer/i }));
        await user.click(await screen.findByRole("button", { name: /Remembered/i }));
      }

      const bar = screen.getByTestId("session-progress-bar");
      const pill = await screen.findByTestId("in-a-row-badge");
      expect(pill).toHaveTextContent("Combo 3");

      // The pill's live container must NOT sit absolutely over the progress bar
      const pillLiveContainer = pill.parentElement!;
      expect(pillLiveContainer.className).not.toMatch(/\babsolute\b/);
      expect(pillLiveContainer.className).not.toMatch(/\binset-x-0\b/);
      // Must be a sibling after session-progress-bar inside a flex layout (end side, RTL-aware)
      expect(bar.parentElement).toBe(pillLiveContainer.parentElement);
      expect(bar.parentElement?.className).toMatch(/\bflex\b/);
    } finally {
      setLocale("en");
      useStyle.getState().setStyle("default");
      vi.restoreAllMocks();
    }
  });

  it("session_end_without_reviews_shows_no_empty_tiles", async () => {
    setLocale("en");
    useStyle.getState().setStyle("default");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Biology",
        parent_id: null,
        is_filtered: false,
        collapsed: false,
        new_count: 0,
        learning_count: 0,
        review_count: 0,
      },
    ]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getGameState").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getGameDepthState").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getMotivationState").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "progressSummary").mockResolvedValue({
      level: 3,
      xp_into_level: 80,
      xp_to_next_level: 200,
      total_xp: 380,
      gold_cents: 1200,
      today_xp: 25,
      today_gold_cents: 150,
      tasks_rewarded_today: 2,
      task_reward_daily_cap: 10,
    });
    vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue(null);

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <StudySessionScreen />
        </QueryClientProvider>,
      );

      const finish = await screen.findByTestId("session-finish");
      expect(finish).toHaveTextContent("All caught up for today");
      expect(within(finish).queryByTestId("session-finish-tiles")).not.toBeInTheDocument();
      expect(within(finish).queryByText("+0 XP")).not.toBeInTheDocument();
      expect(within(finish).queryByText("—")).not.toBeInTheDocument();

      expect(await within(finish).findByTestId("session-finish-empty-line")).toBeInTheDocument();
      const todayTotals = await within(finish).findByTestId("session-finish-today-totals");
      expect(todayTotals).toHaveTextContent("Today: +25 XP");
      expect(todayTotals).toHaveTextContent("1.5 gold");
      expect(todayTotals).toHaveTextContent("Tasks 2 of 10");
    } finally {
      setLocale("en");
      useStyle.getState().setStyle("default");
      vi.restoreAllMocks();
    }
  });

  it("session_end_keeps_real_counts_after_last_answer", async () => {
    setLocale("en");
    useStyle.getState().setStyle("default");
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const card = {
      card_id: 901,
      note_id: 91,
      deck_id: 1,
      question: "<b>Q901</b>",
      answer: "<i>A901</i>",
      again: "1m",
      hard: "6m",
      good: "10m",
      easy: "4d",
      new_count: 0,
      learning_count: 0,
      review_count: 1,
      card_phase: "review",
      algorithm: "fsrs" as const,
      css: "",
    };

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Biology",
        parent_id: null,
        is_filtered: false,
        collapsed: false,
        new_count: 0,
        learning_count: 0,
        review_count: 1,
      },
    ]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getGameState").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getGameDepthState").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getMotivationState").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "progressSummary").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue(card);
    vi.spyOn(ipc.ipc, "answerCard").mockResolvedValueOnce(null);

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <StudySessionScreen />
        </QueryClientProvider>,
      );

      await user.click(await screen.findByRole("button", { name: /Show Answer/i }));
      await user.click(await screen.findByRole("button", { name: /Remembered/i }));

      const finish = await screen.findByTestId("session-finish");
      const tiles = within(finish).getByTestId("session-finish-tiles");
      expect(tiles).toHaveTextContent("+3 XP");
      expect(tiles).toHaveTextContent("1");
      expect(tiles).toHaveTextContent("100%");
    } finally {
      setLocale("en");
      useStyle.getState().setStyle("default");
      vi.restoreAllMocks();
    }
  });

  it("STUDY1 / BW2-22: answer, undo, and saving deck options refresh decks, motivationState, progressSummary, and statsAll", async () => {
    setLocale("en");
    useStyle.getState().setStyle("default");
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    vi.spyOn(ipc.ipc, "listDecks").mockResolvedValue([
      {
        id: 1,
        name: "Biology",
        parent_id: null,
        is_filtered: false,
        collapsed: false,
        new_count: 1,
        learning_count: 0,
        review_count: 0,
      },
    ]);
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getGameState").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getGameDepthState").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getMotivationState").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "progressSummary").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getNextCard")
      .mockResolvedValueOnce({
        card_id: 901,
        note_id: 91,
        deck_id: 1,
        question: "<b>Q901</b>",
        answer: "<i>A901</i>",
        again: "1m",
        hard: "6m",
        good: "10m",
        easy: "4d",
        new_count: 1,
        learning_count: 0,
        review_count: 0,
        card_phase: "new",
        algorithm: "fsrs",
        css: "",
      })
      .mockResolvedValue(null);
    vi.spyOn(ipc.ipc, "answerCard").mockResolvedValueOnce(null);
    vi.spyOn(ipc.ipc, "undo").mockResolvedValueOnce({ kind: "answer-card" });
    vi.spyOn(ipc.ipc, "getDeckConfig").mockResolvedValue({
      deck_id: 1,
      config_id: 1,
      algorithm: "fsrs",
      new_per_day: 20,
      review_per_day: 200,
      learning_steps_min: [1, 10],
      graduating_interval_days: 1,
      easy_interval_days: 4,
      starting_ease_milli: 2500,
      easy_bonus: 1.3,
      hard_interval_factor: 1.2,
      interval_modifier: 1.0,
      maximum_interval_days: 36500,
      relearning_steps_min: [10],
      lapse_interval_factor: 0.0,
      minimum_interval_days: 1,
      leech_threshold: 8,
      fsrs_weights: Array.from({ length: 21 }, () => 0.5),
      desired_retention: 0.9,
    });
    vi.spyOn(ipc.ipc, "setDeckConfig").mockResolvedValue();

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <StudySessionScreen />
        </QueryClientProvider>,
      );

      await user.click(await screen.findByRole("button", { name: /Show Answer/i }));
      invalidateSpy.mockClear();
      await user.click(await screen.findByRole("button", { name: /Remembered/i }));

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["decks"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["motivation-state"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["progress-summary"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["stats"] });

      // Opening and saving DeckOptionsDialog from SessionFinish refreshes all 4 keys + queue
      await user.click(await screen.findByRole("button", { name: /Deck options/i }));
      invalidateSpy.mockClear();
      await user.click(await screen.findByRole("button", { name: /^Save$/i }));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["decks"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["motivation-state"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["progress-summary"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["stats"] });

      // Undo from SessionFinish also refreshes all 4 keys
      invalidateSpy.mockClear();
      await user.click(await screen.findByRole("button", { name: /^Undo$/i }));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["decks"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["motivation-state"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["progress-summary"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["stats"] });
    } finally {
      setLocale("en");
      useStyle.getState().setStyle("default");
      vi.restoreAllMocks();
    }
  });
});
