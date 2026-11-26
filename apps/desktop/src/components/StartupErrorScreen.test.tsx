import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StartupErrorGate } from "./StartupErrorScreen";
import { platform } from "@/lib/platform";
import { setLocale } from "@/lib/i18n";

function renderWithGate(available = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.spyOn(platform, "isAvailable").mockReturnValue(available);
  return render(
    <QueryClientProvider client={queryClient}>
      <StartupErrorGate>
        <div>App Content</div>
      </StartupErrorGate>
    </QueryClientProvider>,
  );
}

describe("StartupErrorGate (SAFE / ARCH1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setLocale("en");
  });

  it("shows calm SchemaTooNew screen when collection schema is newer than supported", async () => {
    vi.spyOn(platform, "invoke").mockResolvedValue({
      kind: "schema_too_new",
      found: 99,
      supported: 15,
      message: "schema v99 > supported v15",
    });

    renderWithGate(true);

    expect(
      await screen.findByRole("heading", { name: /Update Bibalak to open this collection/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/This collection was saved by a newer Bibalak/i)).toBeInTheDocument();
    expect(screen.getAllByText(/v99/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/v15/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("App Content")).not.toBeInTheDocument();
  });

  it("renders children when startup has no error", async () => {
    vi.spyOn(platform, "invoke").mockResolvedValue(null);

    renderWithGate(true);

    expect(await screen.findByText("App Content")).toBeInTheDocument();
  });
});
