import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FieldEditor } from "./FieldEditor";
import { toDisplayHtml, toStorageHtml } from "@/lib/editorMedia";

vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>();
  return {
    ...actual,
    isTauri: () => true,
  };
});

beforeAll(() => {
  document.elementFromPoint = () => null;
  Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => ({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
});

describe("FieldEditor HTML & media round-trip (A1-01, A1-07)", () => {
  it("preserves Anki styled div/class/ruby HTML when edited", async () => {
    const importedHtml =
      '<div class="jp-expr" style="background:black;color:white"><ruby>漢<rt>かん</rt></ruby></div>';
    let latestHtml = importedHtml;
    const user = userEvent.setup();

    const { container } = render(
      <FieldEditor
        value={importedHtml}
        onChange={(html) => {
          latestHtml = html;
        }}
      />,
    );

    const textbox = container.querySelector('[contenteditable="true"]') as HTMLElement;
    await waitFor(() => expect(textbox).not.toBeNull());
    await user.click(textbox);
    await user.type(textbox, "!");

    expect(latestHtml).toContain('class="jp-expr"');
    expect(latestHtml).toContain("<ruby>");
  });

  it("does not emit onChange when mounted without edits (untouched HTML kept byte-for-byte)", async () => {
    const importedHtml =
      '<div class="jp-expr" style="background:black;color:white"><ruby>漢<rt>かん</rt></ruby></div>';
    const onChange = vi.fn();
    render(<FieldEditor value={importedHtml} onChange={onChange} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("handles single-quoted img src in toDisplayHtml and toStorageHtml", () => {
    const singleQuoted = "<img src='diagram.png'>";
    const displayed = toDisplayHtml(singleQuoted, true);
    expect(displayed).not.toBe(singleQuoted);
    expect(toStorageHtml(displayed)).toBe(singleQuoted);
  });
});
