/* global URL, console, process */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function parseSiteOrigin(raw) {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid DOWNLOAD_SITE URL: "${trimmed}"`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`DOWNLOAD_SITE must use https: (got "${trimmed}")`);
  }
  if (url.username || url.password) {
    throw new Error(`DOWNLOAD_SITE must not contain credentials (got "${trimmed}")`);
  }
  if (url.pathname !== "/") {
    throw new Error(`DOWNLOAD_SITE must be an origin without a path (got "${trimmed}")`);
  }
  if (url.search !== "") {
    throw new Error(`DOWNLOAD_SITE must not include a query string (got "${trimmed}")`);
  }
  if (url.hash !== "") {
    throw new Error(`DOWNLOAD_SITE must not include a hash fragment (got "${trimmed}")`);
  }
  return url.origin;
}

/**
 * The public repository whose GitHub Releases serve updates while there is no
 * download website. One constant, shared with the app
 * (`apps/desktop/src/lib/updateSource.json`, read by `lib/releases.ts`).
 */
const UPDATE_SOURCE_FILE = new URL("../../apps/desktop/src/lib/updateSource.json", import.meta.url);
export const GITHUB_REPOSITORY_URL = JSON.parse(
  fs.readFileSync(UPDATE_SOURCE_FILE, "utf8"),
).repository;
/** `latest` resolves to the newest published, non-draft, non-prerelease release. */
export const GITHUB_LATEST_JSON = `${GITHUB_REPOSITORY_URL}/releases/latest/download/latest.json`;

/**
 * The updater manifest URL for a build: the site when DOWNLOAD_SITE is set,
 * GitHub Releases otherwise, and none at all when the build does not sign its
 * updater bundles (forks or runs without TAURI_SIGNING_PRIVATE_KEY).
 */
export function updaterEndpoint(siteOrigin, { signed }) {
  if (!signed) return null;
  return siteOrigin ? `${siteOrigin}/download/latest.json` : GITHUB_LATEST_JSON;
}

export function buildSiteOverlay(siteOrigin, { signed }) {
  const endpoint = updaterEndpoint(siteOrigin, { signed });
  return {
    plugins: {
      updater: {
        endpoints: endpoint ? [endpoint] : [],
      },
    },
  };
}

function parseCliArgs(argv) {
  let site = process.env.DOWNLOAD_SITE ?? "";
  let signed = process.env.UPDATER_SIGNED === "true";
  let out = "apps/desktop/src-tauri/tauri.site.conf.json";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--site" && i + 1 < argv.length) {
      site = argv[++i];
    } else if (arg === "--signed" && i + 1 < argv.length) {
      signed = argv[++i] === "true";
    } else if (arg === "--out" && i + 1 < argv.length) {
      out = argv[++i];
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  return { site, signed, out };
}

function main() {
  const { site, signed, out } = parseCliArgs(process.argv.slice(2));
  const origin = parseSiteOrigin(site);
  const overlay = buildSiteOverlay(origin, { signed });
  const outPath = path.resolve(out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    `${JSON.stringify(overlay, null, 2)}
`,
    "utf8",
  );
  const [endpoint] = overlay.plugins.updater.endpoints;
  console.log(
    endpoint
      ? `Wrote ${outPath} with updater endpoint ${endpoint}`
      : `Wrote ${outPath} with updater endpoints disabled (unsigned build)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
