import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotetypeScreen } from "./NotetypeScreen";
import { ipc } from "@/lib/ipc";

beforeAll(() => {
  document.elementFromPoint = () => null;
  Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
});

vi.mock("@/lib/ipc", () => ({
  isTauri: () => true,
  ipc: {
    listNotetypes: vi.fn(),
    listStockNotetypes: vi.fn().mockResolvedValue(["Basic", "Cloze"]),
    getNotetype: vi.fn(),
    renameNotetype: vi.fn().mockResolvedValue(undefined),
    createNotetype: vi.fn().mockResolvedValue({ id: 2 }),
    addStockNotetype: vi.fn().mockResolvedValue({ id: 3 }),
    deleteNotetype: vi.fn().mockResolvedValue(undefined),
    duplicateNotetype: vi.fn().mockResolvedValue({ id: 2 }),
    setSortField: vi.fn().mockResolvedValue(undefined),
    saveFieldOptions: vi.fn().mockResolvedValue(undefined),
    saveNotetypeCss: vi.fn().mockResolvedValue(undefined),
    addField: vi.fn().mockResolvedValue(undefined),
    removeField: vi.fn().mockResolvedValue(undefined),
    renameField: vi.fn().mockResolvedValue(undefined),
    reorderFields: vi.fn().mockResolvedValue(undefined),
    checkFieldRemove: vi.fn().mockResolvedValue({ notes_with_content: 0, using_templates: [] }),
    addTemplate: vi.fn().mockResolvedValue(undefined),
    checkTemplateRemove: vi.fn().mockResolvedValue(0),
    removeTemplate: vi.fn().mockResolvedValue(undefined),
    saveTemplate: vi.fn().mockResolvedValue(undefined),
    previewTemplate: vi.fn().mockResolvedValue({
      question: "<div>(Text)</div>",
      answer: "<div>(Text)</div>",
    }),
    searchNoteRows: vi.fn().mockResolvedValue([]),
    getNote: vi.fn().mockResolvedValue(null),
  },
}));

function setupMocks() {
  (ipc.listNotetypes as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 1, name: "Basic", kind: 0, field_names: ["Front", "Back"], note_count: 1 },
    { id: 2, name: "Cloze", kind: 1, field_names: ["Text", "Extra"], note_count: 1 },
  ]);
  (ipc.getNotetype as ReturnType<typeof vi.fn>).mockImplementation(async (id: number) => {
    if (id === 1) {
      return {
        id: 1,
        name: "Basic",
        kind: 0,
        fields: [
          { ord: 0, name: "Front" },
          { ord: 1, name: "Back" },
        ],
        templates: [{ ord: 0, name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}" }],
        css: ".card { color: black; }",
      };
    }
    return {
      id: 2,
      name: "Cloze",
      kind: 1,
      fields: [
        { ord: 0, name: "Text" },
        { ord: 1, name: "Extra" },
      ],
      templates: [{ ord: 0, name: "Cloze", qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}" }],
      css: ".cloze { color: blue; }",
    };
  });
}

describe("NotetypeScreen guards & preview (A2-32, A2-33, A2-37)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("A2-32: warns before discarding unsaved CSS edits in Styling tab when switching note types", async () => {
    setupMocks();
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <NotetypeScreen />
      </QueryClientProvider>,
    );

    const stylingTab = await screen.findByRole("tab", { name: /Styling/i });
    await user.click(stylingTab);

    const cssArea = await screen.findByDisplayValue(".card { color: black; }");
    fireEvent.change(cssArea, { target: { value: ".card { color: crimson; }" } });

    await user.click(screen.getByRole("button", { name: /Cloze/i }));

    expect(screen.getByText(/unsaved changes|discard/i)).toBeInTheDocument();
  });

  it("A2-33: Cloze template preview provides sample {{c1::...}} content instead of literal '(Text)'", async () => {
    setupMocks();
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <NotetypeScreen />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /Cloze/i }));

    await waitFor(() => {
      const clozeCalls = (ipc.previewTemplate as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => c[0] === 2,
      );
      expect(clozeCalls.length).toBeGreaterThan(0);
      const sampleFields = clozeCalls[clozeCalls.length - 1]?.[2] as string[];
      expect(sampleFields[0]).toMatch(/\{\{c\d+::/);
    });
  });

  it("A2-37: clicking Add Field prompts for a field name instead of immediately calling addField with 'New Field'", async () => {
    setupMocks();
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <NotetypeScreen />
      </QueryClientProvider>,
    );

    const fieldsTab = await screen.findByRole("tab", { name: /Fields/i });
    await user.click(fieldsTab);

    const addFieldBtn = await screen.findByRole("button", { name: /Add field/i });
    await user.click(addFieldBtn);

    expect(ipc.addField).not.toHaveBeenCalled();
  });

  it("A2-32: keeps unsaved CSS edits across tab switches", async () => {
    setupMocks();
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <NotetypeScreen />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("tab", { name: /Styling/i }));
    const cssArea = await screen.findByDisplayValue(".card { color: black; }");
    fireEvent.change(cssArea, { target: { value: ".card { color: teal; }" } });

    await user.click(screen.getByRole("tab", { name: /Fields/i }));
    await user.click(screen.getByRole("tab", { name: /Styling/i }));

    expect(screen.getByDisplayValue(".card { color: teal; }")).toBeInTheDocument();
  });

  it("F7: previews templates using real note content and switches sample notes", async () => {
    setupMocks();
    (ipc.searchNoteRows as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        note_id: 101,
        card_ids: [1001],
        sort_field: "Sample 1",
        notetype: "Basic",
        deck: "Default",
        card_count: 1,
        tags: [],
        mod_ms: 0,
        has_suspended: false,
        has_unsuspended: true,
        has_buried: false,
        has_unburied: true,
      },
      {
        note_id: 102,
        card_ids: [1002],
        sort_field: "Sample 2",
        notetype: "Basic",
        deck: "Default",
        card_count: 1,
        tags: [],
        mod_ms: 0,
        has_suspended: false,
        has_unsuspended: true,
        has_buried: false,
        has_unburied: true,
      },
    ]);
    (ipc.getNote as ReturnType<typeof vi.fn>).mockImplementation(async (id: number) => ({
      note_id: id,
      notetype_name: "Basic",
      fields: [
        {
          name: "Front",
          value: id === 101 ? "Real Front 1" : "Real Front 2",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
        {
          name: "Back",
          value: id === 101 ? "Real Back 1" : "Real Back 2",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
      ],
      tags: [],
    }));

    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <NotetypeScreen />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("tab", { name: /Templates/i }));
    await waitFor(() => {
      expect(ipc.previewTemplate).toHaveBeenCalledWith(
        1,
        0,
        ["Real Front 1", "Real Back 1"],
        expect.any(String),
        expect.any(String),
      );
    });

    expect(screen.getByText(/Note 1 of 2/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Next sample note/i }));

    await waitFor(() => {
      expect(ipc.previewTemplate).toHaveBeenCalledWith(
        1,
        0,
        ["Real Front 2", "Real Back 2"],
        expect.any(String),
        expect.any(String),
      );
    });
  });
});
