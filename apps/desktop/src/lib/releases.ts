/**
 * Where Bibalak releases live: the "Download" page of the product website * Controlled by one build-time variable
 * (`VITE_DOWNLOAD_SITE`, wired from the `DOWNLOAD_SITE` GitHub variable).
 *
 * When empty or unset this resolves to `null` and in-app updates stay off; a
 * release download server does not serve release assets to users.
 */
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

/** URL of the update manifest, or `null` while there is no download site. */
export function updateManifestUrl(site: string | null = DOWNLOAD_SITE): string | null {
  const origin = parseDownloadSite(site);
  return origin ? `${origin}/download/latest.json` : null;
}

/** Page where a user downloads a given version. */
export function releasePageUrl(
  version: string,
  site: string | null = DOWNLOAD_SITE,
): string | null {
  const origin = parseDownloadSite(site);
  return origin ? `${origin}/download?version=${encodeURIComponent(version)}` : null;
}
