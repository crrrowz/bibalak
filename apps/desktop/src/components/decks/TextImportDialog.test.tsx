import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextImportDialog } from "./TextImportDialog";
import { ipc } from "@/lib/ipc";
import { platform } from "@/lib/platform";

vi.mock("@/lib/platform", () => ({
  platform: {
    isAvailable: () => true,
    invoke: vi.fn(),
    listen: vi.fn(() => () => {}),
    pickPath: vi.fn(),
  },
}));

describe("TextImportDialog (E4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("picks file, renders live preview, remaps column target, and submits importText", async () => {
    vi.mocked(platform.pickPath).mockResolvedValue("C:/data/vocab.csv");
    vi.spyOn(ipc, "listDecks").mockResolvedValue([
      {
        id: 2,
        name: "Arabic",
        parent_id: null,
        new_count: 0,
        learning_count: 0,
        review_count: 0,
        is_filtered: false,
        collapsed: false,
      },
    ]);
    vi.spyOn(ipc, "listNotetypes").mockResolvedValue([
      { id: 10, name: "Basic", kind: 0n, field_names: ["Front", "Back"], note_count: 0 },
    ]);
    vi.spyOn(ipc, "getNotetype").mockResolvedValue({
      id: 10,
      name: "Basic",
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
      templates: [{ ord: 0n, name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}" }],
      preset: null,
    });
    vi.spyOn(ipc, "previewTextImport").mockResolvedValue({
      detected_format: "csv",
      detected_delimiter: ",",
      has_header: true,
      columns: ["Word", "Translation", "Tags"],
      rows: [["كتاب", "Book", "arabic::nouns"]],
      total_rows: 1,
      errors: [],
    });
    const importSpy = vi.spyOn(ipc, "importText").mockResolvedValue({
      notes_added: 1,
      notes_updated: 0,
      notes_skipped: 0,
      cards_added: 1,
      errors: [{ line: 3, message: "first field cannot be empty" }],
    });

    const onImported = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TextImportDialog open onClose={() => {}} onImported={onImported} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Choose file/i }));

    expect(await screen.findByText("كتاب")).toBeInTheDocument();
    expect(screen.getByText(/Preview \(1 of 1 rows\)/i)).toBeInTheDocument();

    // Wait for decks, notetypes, and notetype fields to finish loading and seed default mapping
    // before mutating column mapping or clicking Import notes.
    const tagsMappingSelect = screen.getByLabelText("Mapping for Tags");
    await within(tagsMappingSelect).findByRole("option", { name: "Field: Front" });
    const importBtn = screen.getByRole("button", { name: /Import notes/i });
    await waitFor(() => expect(importBtn).toBeEnabled());

    // Change third column mapping from Tags to Ignore, change duplicate policy to update
    fireEvent.change(tagsMappingSelect, {
      target: { value: "ignore" },
    });
    fireEvent.change(screen.getByLabelText(/Duplicates/i), {
      target: { value: "update" },
    });

    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(importSpy).toHaveBeenCalledWith(
        "C:/data/vocab.csv",
        expect.objectContaining({
          deck_id: 2,
          notetype_id: 10,
          duplicate_policy: "update",
          columns: [{ kind: "field", ord: 0 }, { kind: "field", ord: 1 }, { kind: "ignore" }],
        }),
      );
    });

    expect(await screen.findByText(/Added 1 notes \(1 cards\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Line 3: first field cannot be empty/i)).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledOnce();
  });
});
