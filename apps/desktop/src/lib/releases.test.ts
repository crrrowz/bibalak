import { describe, expect, it } from "vitest";
import updateSource from "./updateSource.json";
import {
  DOWNLOAD_SITE,
  GITHUB_LATEST_JSON,
  GITHUB_REPOSITORY_URL,
  UPDATER_SIGNED,
  parseDownloadSite,
  releasePageUrl,
  updateManifestUrl,
} from "./releases";

describe("releases", () => {
  it("has no update URL in an unsigned build (tests, dev, forks without the key)", () => {
    expect(DOWNLOAD_SITE).toBeNull();
    expect(UPDATER_SIGNED).toBe(false);
    expect(updateManifestUrl()).toBeNull();
  });

  it("builds the GitHub source from the one shared repository constant", () => {
    expect(GITHUB_REPOSITORY_URL).toBe(updateSource.repository);
    expect(GITHUB_REPOSITORY_URL).toBe("https://github.com/crrrowz/bibalak");
    expect(GITHUB_LATEST_JSON).toBe(
      "https://github.com/crrrowz/bibalak/releases/latest/download/latest.json",
    );
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

  it("picks the update source: site when set, GitHub Releases when unset, none unsigned", () => {
    const site = "https://example.test";
    expect(updateManifestUrl(site, true)).toBe("https://example.test/download/latest.json");
    expect(updateManifestUrl(null, true)).toBe(GITHUB_LATEST_JSON);
    expect(updateManifestUrl(null, false)).toBeNull();
    expect(updateManifestUrl(site, false)).toBeNull();
  });

  it("links to the release page on the site or on GitHub Releases", () => {
    expect(releasePageUrl("1.0.1", "https://example.test")).toBe(
      "https://example.test/download?version=1.0.1",
    );
    expect(releasePageUrl("1.1.0", null)).toBe(
      "https://github.com/crrrowz/bibalak/releases/tag/v1.1.0",
    );
  });

  it("points only at the public GitHub repository", () => {
    const publicRepo = "https://github.com/crrrowz/bibalak/";
    expect(String(updateManifestUrl(null, true)).startsWith(publicRepo)).toBe(true);
    expect(releasePageUrl("1.1.0", null).startsWith(publicRepo)).toBe(true);
  });
});
