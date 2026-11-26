import { describe, expect, it } from "vitest";
import { DOWNLOAD_SITE, parseDownloadSite, releasePageUrl, updateManifestUrl } from "./releases";

describe("releases", () => {
  it("has no update URL until the download site exists", () => {
    expect(DOWNLOAD_SITE).toBeNull();
    expect(updateManifestUrl()).toBeNull();
    expect(releasePageUrl("1.0.1")).toBeNull();
  });

  it("parses valid https origins and rejects empty, non-https, or path-bearing URLs", () => {
    expect(parseDownloadSite(undefined)).toBeNull();
    expect(parseDownloadSite("")).toBeNull();
    expect(parseDownloadSite("   ")).toBeNull();
    expect(parseDownloadSite("http://example.test")).toBeNull();
    expect(parseDownloadSite("https://example.test/download")).toBeNull();
    expect(parseDownloadSite("https://example.test?a=1")).toBeNull();
    expect(parseDownloadSite("https://example.test#frag")).toBeNull();
    expect(parseDownloadSite("https://user:pass@example.test")).toBeNull();
    expect(parseDownloadSite("not-a-url")).toBeNull();
    expect(parseDownloadSite("https://example.test")).toBe("https://example.test");
    expect(parseDownloadSite("  https://example.test/  ")).toBe("https://example.test");
  });

  it("builds URLs on the download site", () => {
    const site = "https://example.test";
    expect(updateManifestUrl(site)).toBe("https://example.test/download/latest.json");
    expect(releasePageUrl("1.0.1", site)).toBe("https://example.test/download?version=1.0.1");
  });

  it("never points at the private GitHub repository", () => {
    expect(String(updateManifestUrl("https://example.test"))).not.toContain("github.com");
  });
});
