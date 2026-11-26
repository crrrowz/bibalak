import { afterEach, describe, expect, it } from "vitest";
import { installPreviewMocks } from "@/dev/previewMocks";
import { desktopPlatform } from "./desktop";

describe("platform notifications capability (16c)", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__BIBALAK_PREVIEW__;
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("preview_has_no_notification_capability", () => {
    // In tests / plain web without Tauri runtime, notifications capability is null.
    expect(desktopPlatform.notifications).toBeNull();

    // Even when preview mocks install __TAURI_INTERNALS__, preview has no OS notification capability.
    installPreviewMocks();
    expect(desktopPlatform.isAvailable()).toBe(true);
    expect(desktopPlatform.notifications).toBeNull();
  });
});
