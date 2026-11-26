import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScreenHeader } from "./ScreenHeader";

describe("ScreenHeader (Z1a)", () => {
  it("renders a direction-aware chevron icon instead of literal '›' in breadcrumbs", async () => {
    const onBack = vi.fn();
    render(
      <ScreenHeader title="Generate cards from text" breadcrumb={{ label: "Assistant", onBack }} />,
    );

    const nav = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(nav.textContent).not.toContain("›");

    const chevron = nav.querySelector("svg");
    expect(chevron).not.toBeNull();
    expect(chevron).toHaveAttribute("aria-hidden", "true");
    expect(chevron).toHaveClass("rtl:-scale-x-100");

    const user = userEvent.setup();
    await user.click(within(nav).getByRole("button", { name: "Assistant" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
