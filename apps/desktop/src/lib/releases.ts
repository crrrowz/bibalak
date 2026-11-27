/**
 * Where Bibalak releases live (ADR-021).
 *
 * - `VITE_DOWNLOAD_SITE` set (wired from the `DOWNLOAD_SITE` GitHub variable):
 *   the product website's "Download" page.
 * - Unset: GitHub Releases of the public repository, built from the one
 *   constant in `updateSource.json` (also read by `scripts/release/site-config.mjs`).
 * - `VITE_UPDATER_SIGNED` is "true" only in release builds that sign updater
 *   bundles. Without it (dev, tests, forks without the key) there is no update
 *   source at all and in-app updates stay off.
 */
import updateSource from "./updateSource.json";

export const GITHUB_REPOSITORY_URL: string = updateSource.repository;

/** `latest` resolves to the newest published, non-draft, non-prerelease release. */
export const GITHUB_LATEST_JSON = `${GITHUB_REPOSITORY_URL}/releases/latest/download/latest.json`;

export function parseDownloadSite(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return null;
  return url.origin;
}

export const DOWNLOAD_SITE: string | null = parseDownloadSite(
  import.meta.env.VITE_DOWNLOAD_SITE as string | undefined,
);

export const UPDATER_SIGNED: boolean =
  (import.meta.env.VITE_UPDATER_SIGNED as string | undefined) === "true";

/** URL of the update manifest, or `null` when this build cannot update itself. */
export function updateManifestUrl(
  site: string | null = DOWNLOAD_SITE,
  signed: boolean = UPDATER_SIGNED,
): string | null {
  if (!signed) return null;
  const origin = parseDownloadSite(site);
  return origin ? `${origin}/download/latest.json` : GITHUB_LATEST_JSON;
}

/** Page where a user downloads a given version. */
export function releasePageUrl(version: string, site: string | null = DOWNLOAD_SITE): string {
  const origin = parseDownloadSite(site);
  if (origin) return `${origin}/download?version=${encodeURIComponent(version)}`;
  const tag = version.startsWith("v") ? version : `v${version}`;
  return `${GITHUB_REPOSITORY_URL}/releases/tag/${encodeURIComponent(tag)}`;
}
