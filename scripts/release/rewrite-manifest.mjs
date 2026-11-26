/* global URL, console, process */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSiteOrigin } from "./site-config.mjs";

export function rewriteManifest(manifest, rawSite) {
  const origin = parseSiteOrigin(rawSite);
  if (!origin) {
    throw new Error("DOWNLOAD_SITE must be a valid https origin to rewrite latest.json");
  }
  if (!manifest || typeof manifest !== "object" || !manifest.platforms) {
    throw new Error("latest.json must include a platforms map");
  }
  const entries = Object.entries(manifest.platforms);
  if (entries.length === 0) {
    throw new Error("latest.json platforms map is empty");
  }

  const platforms = {};
  for (const [target, info] of entries) {
    if (!info || typeof info.url !== "string" || !info.url.trim()) {
      throw new Error(`Platform "${target}" is missing a valid url`);
    }
    const parsedUrl = new URL(info.url);
    const filename = path.posix.basename(parsedUrl.pathname);
    if (!filename) {
      throw new Error(`Could not extract filename from platform "${target}" url: ${info.url}`);
    }
    platforms[target] = {
      ...info,
      url: `${origin}/download/${filename}`,
    };
  }

  return {
    ...manifest,
    platforms,
  };
}

function parseCliArgs(argv) {
  let site = process.env.DOWNLOAD_SITE ?? "";
  let input = "";
  let output = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--site" && i + 1 < argv.length) {
      site = argv[++i];
    } else if (arg === "--in" && i + 1 < argv.length) {
      input = argv[++i];
    } else if (arg === "--out" && i + 1 < argv.length) {
      output = argv[++i];
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  if (!input || !output) {
    throw new Error(
      "Usage: node scripts/release/rewrite-manifest.mjs --site <origin> --in <path> --out <path>",
    );
  }
  return { site, input, output };
}

function main() {
  const { site, input, output } = parseCliArgs(process.argv.slice(2));
  const raw = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
  const rewritten = rewriteManifest(raw, site);
  const outPath = path.resolve(output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(rewritten, null, 2)}\n`, "utf8");
  console.log(
    `Rewrote updater manifest URLs for ${Object.keys(rewritten.platforms).length} platform(s)`,
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
