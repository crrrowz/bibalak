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

/**
 * tauri-action v1 writes each platform URL as a GitHub API asset URL
 * (`https://api.github.com/repos/<o>/<r>/releases/assets/<id>`). Those are rate
 * limited for anonymous clients, so point each entry at the plain release
 * download URL instead (`<repo>/releases/download/<tag>/<asset name>`), looked
 * up by API URL in the release's asset list. Signatures are kept as they are.
 */
/** The user-facing part of a release body: everything before the downloads table. */
export function releaseNotesFromBody(body) {
  const text = String(body ?? "").replace(/\r\n/g, "\n");
  const cut = text.search(/^## Downloads\b/m);
  return (cut === -1 ? text : text.slice(0, cut)).trim();
}

export function rewriteManifestForGitHub(manifest, { repositoryUrl, tag, assets, releaseBody }) {
  if (!manifest || typeof manifest !== "object" || !manifest.platforms) {
    throw new Error("latest.json must include a platforms map");
  }
  const entries = Object.entries(manifest.platforms);
  if (entries.length === 0) {
    throw new Error("latest.json platforms map is empty");
  }
  if (!repositoryUrl || !tag) {
    throw new Error("repositoryUrl and tag are required");
  }
  const base = `${repositoryUrl.replace(/\/+$/, "")}/releases/download/${encodeURIComponent(tag)}/`;
  const nameByUrl = new Map((assets ?? []).map((a) => [a.url, a.name]));

  const platforms = {};
  for (const [target, info] of entries) {
    if (!info || typeof info.url !== "string" || !info.url.trim()) {
      throw new Error(`Platform "${target}" is missing a valid url`);
    }
    if (info.url.startsWith(base)) {
      platforms[target] = { ...info };
      continue;
    }
    const name = nameByUrl.get(info.url);
    if (!name) {
      throw new Error(`Platform "${target}" url is not an asset of release ${tag}: ${info.url}`);
    }
    platforms[target] = { ...info, url: `${base}${encodeURIComponent(name)}` };
  }
  const notes =
    typeof manifest.notes === "string" && manifest.notes.trim()
      ? manifest.notes
      : releaseNotesFromBody(releaseBody);
  return { ...manifest, notes, platforms };
}

function parseCliArgs(argv) {
  let site = process.env.DOWNLOAD_SITE ?? "";
  let input = "";
  let output = "";
  let githubTag = "";
  let repositoryUrl = "";
  let assetsFile = "";
  let bodyFile = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--site" && i + 1 < argv.length) {
      site = argv[++i];
    } else if (arg === "--github-tag" && i + 1 < argv.length) {
      githubTag = argv[++i];
    } else if (arg === "--repository" && i + 1 < argv.length) {
      repositoryUrl = argv[++i];
    } else if (arg === "--assets" && i + 1 < argv.length) {
      assetsFile = argv[++i];
    } else if (arg === "--release-body" && i + 1 < argv.length) {
      bodyFile = argv[++i];
    } else if (arg === "--in" && i + 1 < argv.length) {
      input = argv[++i];
    } else if (arg === "--out" && i + 1 < argv.length) {
      output = argv[++i];
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  if (!input || !output || (githubTag && (!repositoryUrl || !assetsFile))) {
    throw new Error(
      "Usage: node scripts/release/rewrite-manifest.mjs --site <origin> --in <path> --out <path>\n" +
        "   or: node scripts/release/rewrite-manifest.mjs --github-tag <tag> --repository <url> " +
        "--assets <gh release view --json assets output> [--release-body <file>] --in <path> --out <path>",
    );
  }
  return { site, input, output, githubTag, repositoryUrl, assetsFile, bodyFile };
}

function main() {
  const { site, input, output, githubTag, repositoryUrl, assetsFile, bodyFile } = parseCliArgs(
    process.argv.slice(2),
  );
  const raw = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
  let rewritten;
  if (githubTag) {
    // `gh release view <tag> --json assets` gives { assets: [{ name, apiUrl, ... }] }.
    const listed = JSON.parse(fs.readFileSync(path.resolve(assetsFile), "utf8")).assets ?? [];
    const assets = listed.map((a) => ({ name: a.name, url: a.apiUrl }));
    const releaseBody = bodyFile ? fs.readFileSync(path.resolve(bodyFile), "utf8") : "";
    rewritten = rewriteManifestForGitHub(raw, {
      repositoryUrl,
      tag: githubTag,
      assets,
      releaseBody,
    });
  } else {
    rewritten = rewriteManifest(raw, site);
  }
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
