import { describe, expect, it } from "vitest";
import { toDisplayHtml, toStorageHtml } from "./editorMedia";

describe("editorMedia URL rewriting (A2-24)", () => {
  it("handles malformed percent encoding without throwing URIError and rewrites video/audio/single-quoted media", () => {
    expect(() =>
      toStorageHtml('<img src="bibalak-media://localhost/100%25_broken%ZZ.png">'),
    ).not.toThrow();

    const videoHtml = "<video src=\"lesson.mp4\"></video><img src='single.png'>";
    const displayed = toDisplayHtml(videoHtml, true);
    expect(displayed).toContain("bibalak-media://localhost/lesson.mp4");
    expect(displayed).toContain("bibalak-media://localhost/single.png");
  });
});
