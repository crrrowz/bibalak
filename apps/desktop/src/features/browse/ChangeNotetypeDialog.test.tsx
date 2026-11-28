import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChangeNotetypeDialog } from "./ChangeNotetypeDialog";
import { ipc } from "@/lib/ipc";

vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>();
  return {
    ...actual,
    isTauri: () => true,
  };
});

describe("ChangeNotetypeDialog card impact & confirmation (A2-06)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("A2-06: exposes template impact and explicit card-loss warning when changing Basic-Reversed (2 cards) to Cloze", async () => {
    vi.spyOn(ipc, "listNotetypes").mockResolvedValue([
      {
        id: 1,
        name: "Basic (and reversed)",
        kind: 0n,
        field_names: ["Front", "Back"],
        note_count: 3,
      },
      { id: 2, name: "Cloze", kind: 1n, field_names: ["Text", "Extra"], note_count: 1 },
    ]);
    vi.spyOn(ipc, "getNotetype").mockImplementation(async (id) => {
      if (id === 1) {
        return {
          id: 1,
          name: "Basic (and reversed)",
          kind: 0n,
          css: "",
          sort_field: 0n,
          fields: [
            {
              ord: 0n,
              name: "Front",
              options: { direction: "auto", font: "", size: 0, description: "" },
            },
            {
              ord: 1n,
              name: "Back",
              options: { direction: "auto", font: "", size: 0, description: "" },
            },
          ],
          templates: [
            { ord: 0n, name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}" },
            { ord: 1n, name: "Card 2", qfmt: "{{Back}}", afmt: "{{Front}}" },
          ],
          preset: null,
        };
      }
      return {
        id: 2,
        name: "Cloze",
        kind: 1n,
        css: "",
        sort_field: 0n,
        fields: [
          {
            ord: 0n,
            name: "Text",
            options: { direction: "auto", font: "", size: 0, description: "" },
          },
          {
            ord: 1n,
            name: "Extra",
            options: { direction: "auto", font: "", size: 0, description: "" },
          },
        ],
        templates: [{ ord: 0n, name: "Cloze", qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}" }],
        preset: null,
      };
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ChangeNotetypeDialog
          open
          noteIds={[10]}
          sourceNotetypeNames={["Basic (and reversed)"]}
          onClose={vi.fn()}
          onDone={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Text")).toBeInTheDocument();
    });

    expect(screen.getByText(/Card 2/)).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: /^Change$/i });
    expect(submit).toBeDisabled();

    const changeSpy = vi.spyOn(ipc, "changeNoteType").mockResolvedValue(1);
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /review history/i }));
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => {
      expect(changeSpy).toHaveBeenCalledWith(
        [10],
        2,
        [0, 1],
        [
          [0, 0],
          [1, null],
        ],
      );
    });
  });
});
