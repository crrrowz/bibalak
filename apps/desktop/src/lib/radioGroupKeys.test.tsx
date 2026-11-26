import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setLocale } from "@/lib/i18n";
import { handleRadioGroupKeyDown, nextRadioIndex } from "./radioGroupKeys";

describe("radioGroupKeys (Z1a)", () => {
  afterEach(() => {
    setLocale("en");
  });

  it("computes next/prev/wrap/Home/End in LTR and swaps Left/Right in RTL", () => {
    // LTR
    expect(nextRadioIndex("ArrowRight", 0, 3, "ltr")).toBe(1);
    expect(nextRadioIndex("ArrowRight", 2, 3, "ltr")).toBe(0);
    expect(nextRadioIndex("ArrowDown", 1, 3, "ltr")).toBe(2);
    expect(nextRadioIndex("ArrowDown", 2, 3, "ltr")).toBe(0);
    expect(nextRadioIndex("ArrowLeft", 0, 3, "ltr")).toBe(2);
    expect(nextRadioIndex("ArrowUp", 0, 3, "ltr")).toBe(2);
    expect(nextRadioIndex("Home", 2, 3, "ltr")).toBe(0);
    expect(nextRadioIndex("End", 0, 3, "ltr")).toBe(2);
    expect(nextRadioIndex("Enter", 0, 3, "ltr")).toBeNull();

    // RTL: Left = next, Right = prev; Up/Down never swap
    expect(nextRadioIndex("ArrowLeft", 0, 3, "rtl")).toBe(1);
    expect(nextRadioIndex("ArrowLeft", 2, 3, "rtl")).toBe(0);
    expect(nextRadioIndex("ArrowRight", 0, 3, "rtl")).toBe(2);
    expect(nextRadioIndex("ArrowDown", 0, 3, "rtl")).toBe(1);
    expect(nextRadioIndex("ArrowUp", 0, 3, "rtl")).toBe(2);
    expect(nextRadioIndex("Home", 1, 3, "rtl")).toBe(0);
    expect(nextRadioIndex("End", 1, 3, "rtl")).toBe(2);
  });

  it("reads direction from app locale and updates selection + focus via handleRadioGroupKeyDown", async () => {
    const options = ["light", "dark", "system"] as const;
    const onSelect = vi.fn();

    function TestGroup({ dirLocale }: { dirLocale: "en" | "ar" }) {
      setLocale(dirLocale);
      return (
        <div role="radiogroup" aria-label="Theme">
          {options.map((opt, idx) => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={idx === 0}
              tabIndex={idx === 0 ? 0 : -1}
              onKeyDown={(e) => handleRadioGroupKeyDown(e, options, idx, onSelect)}
            >
              {opt}
            </button>
          ))}
        </div>
      );
    }

    const user = userEvent.setup();
    const { rerender } = render(<TestGroup dirLocale="en" />);
    const radios = screen.getAllByRole("radio");

    radios[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(onSelect).toHaveBeenLastCalledWith("dark");
    expect(radios[1]).toHaveFocus();

    onSelect.mockClear();
    rerender(<TestGroup dirLocale="ar" />);
    radios[0].focus();
    await user.keyboard("{ArrowLeft}");
    expect(onSelect).toHaveBeenLastCalledWith("dark");
    expect(radios[1]).toHaveFocus();
  });
});
