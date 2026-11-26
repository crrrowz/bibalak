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

export function buildSiteOverlay(siteOrigin) {
  return {
    plugins: {
      updater: {
        endpoints: siteOrigin ? [`${siteOrigin}/download/latest.json`] : [],
      },
    },
  };
}

function parseCliArgs(argv) {
  let site = process.env.DOWNLOAD_SITE ?? "";
  let out = "apps/desktop/src-tauri/tauri.site.conf.json";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--site" && i + 1 < argv.length) {
      site = argv[++i];
    } else if (arg === "--out" && i + 1 < argv.length) {
      out = argv[++i];
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  return { site, out };
}

function main() {
  const { site, out } = parseCliArgs(process.argv.slice(2));
  const origin = parseSiteOrigin(site);
  const overlay = buildSiteOverlay(origin);
  const outPath = path.resolve(out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(overlay, null, 2)}\n`, "utf8");
  console.log(
    origin
      ? `Wrote ${outPath} with updater endpoint ${origin}/download/latest.json`
      : `Wrote ${outPath} with updater endpoints disabled (DOWNLOAD_SITE unset)`,
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
