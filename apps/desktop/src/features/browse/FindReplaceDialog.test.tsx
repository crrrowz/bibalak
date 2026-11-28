import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FindReplaceDialog } from "./FindReplaceDialog";
import { ipc } from "@/lib/ipc";

vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>();
  return {
    ...actual,
    isTauri: () => true,
  };
});

describe("FindReplaceDialog scoped fields & HTML safety (A2-14, A2-35)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("A2-35: only offers fields belonging to the selected notes instead of every notetype in the collection", async () => {
    vi.spyOn(ipc, "listNotetypes").mockResolvedValue([
      { id: 1, name: "Basic", kind: 0n, field_names: ["Front", "Back"], note_count: 5 },
      {
        id: 2,
        name: "UnrelatedType",
        kind: 0n,
        field_names: ["SecretUnrelatedField"],
        note_count: 2,
      },
    ]);
    vi.spyOn(ipc, "getNote").mockImplementation(async (id) => ({
      note_id: id,
      notetype_name: "Basic",
      fields: [
        {
          name: "Front",
          value: "a",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
        {
          name: "Back",
          value: "b",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
      ],
      tags: [],
    }));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <FindReplaceDialog open noteIds={[1, 2]} onClose={vi.fn()} onDone={vi.fn()} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Front" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("option", { name: "SecretUnrelatedField" })).toBeNull();
  });

  it("A2-14: defaults Include HTML tags to unchecked and renders before/after sample diff on preview", async () => {
    vi.spyOn(ipc, "listNotetypes").mockResolvedValue([
      { id: 1, name: "Basic", kind: 0n, field_names: ["Front", "Back"], note_count: 5 },
    ]);
    const previewSpy = vi.spyOn(ipc, "previewFindReplace").mockResolvedValue({
      notes_matched: 1,
      occurrences: 1,
      sample_before: "<span>cls word</span>",
      sample_after: "<span>new word</span>",
    });

    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <FindReplaceDialog
          open
          noteIds={[1]}
          notetypeNames={["Basic"]}
          onClose={vi.fn()}
          onDone={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const htmlToggle = screen.getByRole("checkbox", { name: /Include HTML/i });
    expect(htmlToggle).not.toBeChecked();

    await user.type(screen.getByLabelText(/^Find$/i), "cls");
    await user.type(screen.getByLabelText(/Replace with/i), "new");
    await user.click(screen.getByRole("button", { name: /^Preview$/i }));

    await waitFor(() => {
      expect(previewSpy).toHaveBeenCalledWith([1], null, "cls", false, false, "new", false);
      expect(screen.getByText(/<span>cls word<\/span>/)).toBeInTheDocument();
      expect(screen.getByText(/<span>new word<\/span>/)).toBeInTheDocument();
    });
  });
});
