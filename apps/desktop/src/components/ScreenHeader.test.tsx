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

  it("A1-25: keeps title container readable instead of crushing it against wrapped actions", () => {
    render(
      <ScreenHeader
        title="المجموعات"
        description={<span>120 جديدة</span>}
        actions={
          <>
            <button type="button">A</button>
            <button type="button">B</button>
          </>
        }
      />,
    );
    const titleGroup = screen.getByRole("heading", { level: 1 }).parentElement!;
    expect(titleGroup.className).toContain("min-w-[10rem]");
  });

  it("A3-22: keeps primary screen-title h1 non-truncating next to toolbar actions", () => {
    render(
      <ScreenHeader
        title="Eisenhower Matrix"
        description={<span>Prioritize tasks by urgency and importance.</span>}
        actions={
          <>
            <button type="button">Matrix</button>
            <button type="button">Manage lists</button>
            <button type="button">Show completed</button>
          </>
        }
      />,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Eisenhower Matrix" });
    expect(heading.className).toContain("shrink-0");
    expect(heading.className).not.toContain("truncate");
  });
});
