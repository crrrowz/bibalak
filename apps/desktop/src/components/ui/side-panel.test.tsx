import { useEffect, useRef, useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useUi } from "@/stores/ui";
import { SidePanel } from "./side-panel";

function InnerBubbleDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Confirm delete">
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

function SidePanelHarness() {
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopoverOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popoverOpen]);

  return (
    <div>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Open inspector
      </button>
      <SidePanel open={open} title="Inspector" onClose={() => setOpen(false)}>
        <p>Panel body</p>
        <button type="button" onClick={() => setDialogOpen(true)}>
          Open confirm
        </button>
        <button type="button" onClick={() => setPopoverOpen(true)}>
          Open popover
        </button>
        {dialogOpen && <InnerBubbleDialog onClose={() => setDialogOpen(false)} />}
        {popoverOpen && (
          <div data-popover-layer="true" role="listbox" aria-label="Quick dates">
            <span>Today</span>
          </div>
        )}
      </SidePanel>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe("SidePanel", () => {
  it("renders non-modal complementary aside, tracks useUi state, and restores focus on Esc and close", async () => {
    const user = userEvent.setup();
    render(<SidePanelHarness />);

    const opener = screen.getByRole("button", { name: "Open inspector" });
    await user.click(opener);

    const aside = screen.getByRole("complementary", { name: "Inspector" });
    expect(aside).toBeInTheDocument();
    expect(aside).not.toHaveAttribute("aria-modal");
    expect(useUi.getState().sidePanelCount).toBe(1);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Inspector" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(useUi.getState().sidePanelCount).toBe(0);

    await user.click(opener);
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary", { name: "Inspector" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("side_panel_esc_closes_only_top_layer", async () => {
    const user = userEvent.setup();
    render(<SidePanelHarness />);

    const opener = screen.getByRole("button", { name: "Open inspector" });
    await user.click(opener);
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeInTheDocument();

    // Open a dialog from inside SidePanel: first Esc closes only the dialog
    await user.click(screen.getByRole("button", { name: "Open confirm" }));
    expect(screen.getByRole("dialog", { name: "Confirm delete" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Confirm delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeInTheDocument();

    // Open a popover inside SidePanel: Esc closes only the popover
    await user.click(screen.getByRole("button", { name: "Open popover" }));
    expect(screen.getByRole("listbox", { name: "Quick dates" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Quick dates" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeInTheDocument();

    // Next Esc with no overlay on top closes SidePanel and restores focus
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Inspector" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
