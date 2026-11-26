import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./dialog";

describe("Dialog primitive", () => {
  it("renders accessible modal dialog outside aria-hidden and closes on Escape or backdrop", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <Dialog open ariaLabel="Sample dialog" onClose={onClose}>
        <h2>Sample dialog</h2>
        <button type="button">Action</button>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Sample dialog" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.closest('[aria-hidden="true"]')).toBeNull();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("dialog-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
