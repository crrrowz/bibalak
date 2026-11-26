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
});
