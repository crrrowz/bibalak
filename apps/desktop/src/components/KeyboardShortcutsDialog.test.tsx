import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";

describe("KeyboardShortcutsDialog accessibility", () => {
  it("exposes the dialog to assistive technology without an aria-hidden ancestor", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<KeyboardShortcutsDialog onClose={onClose} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.closest('[aria-hidden="true"]')).toBeNull();
    expect(dialog).toHaveAttribute("aria-modal", "true");

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
