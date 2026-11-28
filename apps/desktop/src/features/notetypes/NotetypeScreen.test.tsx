import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotetypeScreen } from "./NotetypeScreen";
import { ipc } from "@/lib/ipc";
import { useToastStore } from "@/stores/toast";

beforeAll(() => {
  document.elementFromPoint = () => null;
  Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
});

vi.mock("@/lib/ipc", () => ({
  isTauri: () => true,
  ipc: {
    listNotetypes: vi.fn().mockResolvedValue([
      {
        id: 1,
        name: "Basic",
        kind: 0,
        field_names: ["Front", "Back"],
        note_count: 15,
      },
    ]),
    listStockNotetypes: vi.fn().mockResolvedValue(["Basic", "Cloze"]),
    getNotetype: vi.fn().mockResolvedValue({
      id: 1,
      name: "Basic",
      kind: 0,
      fields: [
        { ord: 0, name: "Front" },
        { ord: 1, name: "Back" },
      ],
      templates: [
        {
          ord: 0,
          name: "Card 1",
          qfmt: "{{Front}}",
          afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}",
        },
      ],
      css: ".card { font-size: 20px; }",
    }),
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
    checkFieldRemove: vi
      .fn()
      .mockResolvedValue({ notes_with_content: 2, using_templates: ["Card 1"] }),
    addTemplate: vi.fn().mockResolvedValue(undefined),
    checkTemplateRemove: vi.fn().mockResolvedValue(10),
    removeTemplate: vi.fn().mockResolvedValue(undefined),
    saveTemplate: vi.fn().mockResolvedValue(undefined),
    previewTemplate: vi.fn().mockResolvedValue({
      question: "<div>(Front)</div>",
      answer: "<div>(Front)</div><hr>(Back)</div>",
    }),
  },
}));

describe("NotetypeScreen N1-N10 & X1-X4", () => {
  it("displays notetype name and note count in sidebar", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <NotetypeScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Basic").length).toBeGreaterThan(0);
      expect(screen.getByText("15")).toBeInTheDocument();
    });
  });

  it("N2: renames notetype on blur/Enter, not on every keystroke", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <NotetypeScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("Basic")).toBeInTheDocument();
    });

    const headerInput = screen.getByDisplayValue("Basic");
    await user.type(headerInput, " Modified");

    // While typing, renameNotetype should NOT be called yet
    expect(ipc.renameNotetype).not.toHaveBeenCalled();

    // On blur, it should be called once with trimmed value
    await user.tab();
    expect(ipc.renameNotetype).toHaveBeenCalledWith(1, "Basic Modified");
  });

  it("N7 & N9: new template uses first two field names and has no nested buttons", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <NotetypeScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Templates")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Templates"));

    const addTemplateBtn = screen.getByTitle("Add card template");
    await user.click(addTemplateBtn);

    expect(ipc.addTemplate).toHaveBeenCalledWith(
      1,
      "Card 2",
      "{{Front}}",
      "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}",
    );

    // Verify there are no nested button elements in the template list
    const buttons = screen.getAllByRole("button");
    for (const b of buttons) {
      expect(b.querySelector("button")).toBeNull();
    }
  });

  it("N8 & X3: template deletion shows card count in ConfirmDialog", async () => {
    (ipc.getNotetype as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 1,
      name: "Basic",
      kind: 0,
      fields: [
        { ord: 0, name: "Front" },
        { ord: 1, name: "Back" },
      ],
      templates: [
        { ord: 0, name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}" },
        { ord: 1, name: "Card 2", qfmt: "{{Back}}", afmt: "{{Front}}" },
      ],
      css: "",
    });

    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <NotetypeScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Templates")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Templates"));

    await waitFor(() => {
      expect(screen.getByText("Card 2")).toBeInTheDocument();
    });

    const deleteBtn = screen.getAllByTitle("Delete template")[0];
    await user.click(deleteBtn);

    await waitFor(() => {
      expect(ipc.checkTemplateRemove).toHaveBeenCalledWith(1, 0);
      expect(screen.getByText(/10 cards will be deleted/i)).toBeInTheDocument();
    });
  });

  it("N10: edits field options, sets sort field, and duplicates note type", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <NotetypeScreen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /duplicate/i })).toBeInTheDocument();
    });

    // Sort field selector
    const sortSelect = screen.getByLabelText(/sort field/i);
    await user.selectOptions(sortSelect, "1");
    await waitFor(() => {
      expect(ipc.setSortField).toHaveBeenCalledWith(1, 1);
    });

    // Field options for first field (Front)
    const dirSelect = screen.getAllByLabelText(/text direction/i)[0];
    await user.selectOptions(dirSelect, "rtl");
    await waitFor(() => {
      expect(ipc.saveFieldOptions).toHaveBeenCalledWith(
        1,
        0,
        expect.objectContaining({ direction: "rtl" }),
      );
    });

    const fontInput = screen.getAllByLabelText(/editor font/i)[0];
    await user.type(fontInput, "Amiri");
    await user.tab();
    await waitFor(() => {
      expect(ipc.saveFieldOptions).toHaveBeenCalledWith(
        1,
        0,
        expect.objectContaining({ font: "Amiri" }),
      );
    });

    const descInput = screen.getAllByLabelText(/field description/i)[0];
    await user.type(descInput, "Arabic root");
    await user.tab();
    await waitFor(() => {
      expect(ipc.saveFieldOptions).toHaveBeenCalledWith(
        1,
        0,
        expect.objectContaining({ description: "Arabic root" }),
      );
    });

    // Duplicate note type (selects the cloned note type id=2)
    await user.click(screen.getByRole("button", { name: /duplicate/i }));
    await waitFor(() => {
      expect(ipc.duplicateNotetype).toHaveBeenCalledWith(1, "Basic copy");
    });
  });

  it("U5: exposes tablist/tab ARIA semantics and dispatches toast on mutation error", async () => {
    useToastStore.getState().clear();
    (
      ipc.addField as unknown as { mockRejectedValueOnce: (e: unknown) => void }
    ).mockRejectedValueOnce(new Error("field limit reached"));

    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <NotetypeScreen />
      </QueryClientProvider>,
    );

    const tablist = await screen.findByRole("tablist");
    expect(tablist).toBeInTheDocument();
    const fieldsTab = screen.getByRole("tab", { name: "Fields" });
    expect(fieldsTab).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: /add field/i }));
    await user.type(screen.getByLabelText(/new field name/i), "Notes");
    await user.click(screen.getByRole("button", { name: /^Add$/i }));
    await waitFor(() => {
      expect(ipc.addField).toHaveBeenCalledWith(1, "Notes");
      expect(useToastStore.getState().items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tone: "error", message: "field limit reached" }),
        ]),
      );
    });
    useToastStore.getState().clear();
  });

  it("B2: supports tablist keyboard navigation, non-duplicated add control, aria-current, and labeled CSS textarea", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <NotetypeScreen />
      </QueryClientProvider>,
    );

    const tabs = await screen.findAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    expect(tabs[1]).toHaveAttribute("tabindex", "-1");

    // Sidebar should not expose a duplicate Add note type button alongside the <select>
    expect(screen.queryByRole("button", { name: /add note type/i })).toBeNull();
    const addSelect = screen.getByRole("combobox", { name: /add note type/i });
    expect(addSelect).toBeInTheDocument();
    // A5-13: visible, shared <Select> (not an opacity-0 overlay)
    expect(addSelect).toHaveAttribute("data-styled-select", "true");
    expect(addSelect.className).not.toContain("opacity-0");
    expect(addSelect.className).toContain("focus-visible:ring-2");

    // Active notetype item exposes aria-current="true"
    const activeItem = screen.getByRole("button", { name: /Basic/i });
    expect(activeItem).toHaveAttribute("aria-current", "true");

    // ArrowRight moves to Templates tab, End moves to Styling tab
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveFocus();

    fireEvent.keyDown(tabs[1], { key: "End" });
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    expect(tabs[2]).toHaveFocus();

    // Styling textarea is programmatically associated with its <label>
    expect(screen.getByLabelText(/Card CSS/i)).toBeInTheDocument();

    // Also verify mouse click + Home jumps back to Fields
    await user.click(tabs[1]);
    tabs[1].focus();
    fireEvent.keyDown(tabs[1], { key: "Home" });
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveFocus();
  });

  it("lets the user set field type (text/image/audio/video), hides text-only options on media fields, and saves type on Add Field", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <NotetypeScreen />
      </QueryClientProvider>,
    );

    const kindSelect = await screen.findByLabelText(/Field type: Front/i);
    await user.selectOptions(kindSelect, "audio");
    await waitFor(() => {
      expect(ipc.saveFieldOptions).toHaveBeenCalledWith(
        1,
        0,
        expect.objectContaining({ kind: "audio" }),
      );
    });

    // Updating queried data to reflect kind='audio' hides text direction, font, and size
    (ipc.getNotetype as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 1,
      name: "Basic",
      kind: 0,
      sort_field: 0,
      fields: [
        {
          ord: 0,
          name: "Front",
          options: { direction: "auto", font: "", size: 0, description: "", kind: "audio" },
        },
        {
          ord: 1,
          name: "Back",
          options: { direction: "auto", font: "", size: 0, description: "" },
        },
      ],
      templates: [{ ord: 0, name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}" }],
      css: "",
    });
    await qc.invalidateQueries();
    await waitFor(() => {
      expect(screen.queryByLabelText(/Text direction: Front/i)).toBeNull();
      expect(screen.queryByLabelText(/Editor font: Front/i)).toBeNull();
      expect(screen.queryByLabelText(/Font size \(px\): Front/i)).toBeNull();
    });
    expect(screen.getByLabelText(/Field description: Front/i)).toBeInTheDocument();

    // Add a new field with explicit type 'image'
    await user.click(screen.getByRole("button", { name: /add field/i }));
    await user.type(screen.getByLabelText(/new field name/i), "Diagram");
    await user.selectOptions(screen.getByLabelText(/new field type/i), "image");
    await user.click(screen.getByRole("button", { name: /^Add$/i }));
    await waitFor(() => {
      expect(ipc.addField).toHaveBeenCalledWith(1, "Diagram");
      expect(ipc.saveFieldOptions).toHaveBeenCalledWith(
        1,
        2,
        expect.objectContaining({ kind: "image" }),
      );
    });
  });
});
