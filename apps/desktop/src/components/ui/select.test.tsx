import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./select";

describe("Select primitive", () => {
  it("renders a native combobox with chevron and preserves selectOptions compatibility", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Select
        aria-label="Deck selector"
        defaultValue="1"
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="1">Medicine</option>
        <option value="2">Anatomy</option>
      </Select>,
    );

    const combobox = screen.getByRole("combobox", { name: "Deck selector" });
    await user.selectOptions(combobox, "2");
    expect(onChange).toHaveBeenCalledWith("2");
  });

  it("A1-32: suppresses native select arrows cleanly and relaxes Arabic heading typography", () => {
    render(
      <Select aria-label="Language" defaultValue="ar">
        <option value="ar">العربية</option>
      </Select>,
    );
    const select = screen.getByRole("combobox", { name: "Language" });
    expect(select.className).toContain("appearance-none");
    expect(select.className).toContain("bg-none");
    expect(select).toHaveAttribute("data-styled-select", "true");

    const css = fs.readFileSync(path.resolve(__dirname, "../../styles/globals.css"), "utf8");
    expect(css).toContain('select[data-styled-select="true"]');
    expect(css).toContain("::-ms-expand");
    expect(css).toContain('[dir="rtl"] h1');
    expect(css).toContain("line-height: 1.45");
  });
});
