import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "./toast";
import { toast, useToastStore } from "@/stores/toast";

describe("Toaster primitive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.getState().clear();
  });

  afterEach(() => {
    useToastStore.getState().clear();
    vi.useRealTimers();
  });

  it("renders status/alert live regions with logical placement and dismisses manually or on timer", () => {
    render(<Toaster />);

    act(() => {
      toast.success("Note saved");
      toast.error("Sync failed");
    });

    const status = screen.getByRole("status");
    const alert = screen.getByRole("alert");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Note saved");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveTextContent("Sync failed");

    const region = screen.getByTestId("toast-viewport");
    expect(region.className).toContain("end-4");
    expect(region.className).not.toMatch(/\b(left|right)-/);

    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    expect(useToastStore.getState().items.map((i) => i.message)).toEqual(["Sync failed"]);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText("Note saved")).not.toBeInTheDocument();
    expect(screen.getByText("Sync failed")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(6200);
    });
    expect(useToastStore.getState().items).toHaveLength(0);
    expect(screen.queryByText("Sync failed")).not.toBeInTheDocument();
  });

  it("caps stacked toasts at 4 items", () => {
    render(<Toaster />);

    act(() => {
      toast.info("One");
      toast.info("Two");
      toast.info("Three");
      toast.info("Four");
      toast.info("Five");
    });

    expect(screen.queryByText("One")).not.toBeInTheDocument();
    expect(screen.getByText("Five")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(4);
  });
});
