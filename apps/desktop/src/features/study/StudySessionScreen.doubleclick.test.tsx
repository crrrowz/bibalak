import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudySessionScreen } from "./StudySessionScreen";
import * as ipc from "@/lib/ipc";
import { setLocale } from "@/lib/i18n";

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

describe("AUDIT1 double-click answer probe", () => {
  it("A1-10: ignores a second click on AnswerButton while answerCard is still pending", async () => {
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
    vi.spyOn(ipc.ipc, "aiGetConfig").mockResolvedValue(null as never);
    vi.spyOn(ipc.ipc, "getNextCard").mockResolvedValue({
      card_id: 101,
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
      flag: 0,
    });

    let resolveAnswer!: () => void;
    const answerSpy = vi.spyOn(ipc.ipc, "answerCard").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAnswer = () =>
            resolve({
              card_id: 101,
              note_id: 10,
              deck_id: 1,
              question: "<b>Q</b>",
              answer: "<i>A</i>",
              again: "1m",
              hard: "6m",
              good: "10m",
              easy: "4d",
              new_count: 0,
              learning_count: 0,
              review_count: 0,
              card_phase: "new",
              algorithm: "sm2",
              css: "",
              flag: 0,
            });
        }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <StudySessionScreen />
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    const showBtn = await screen.findByRole("button", { name: /Show Answer/i });
    await user.click(showBtn);

    const goodBtn = await screen.findByRole("button", { name: /Good/i });
    await user.dblClick(goodBtn);

    expect(answerSpy).toHaveBeenCalledTimes(1);
    resolveAnswer?.();
  });
});
