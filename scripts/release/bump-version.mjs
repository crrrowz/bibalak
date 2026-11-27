/* global console, process */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function validateVersion(version) {
  const trimmed = String(version ?? "").trim();
  const match = /^(\d+\.\d+\.\d+)(?:-(.+))?$/.exec(trimmed);
  if (!match) {
    throw new Error(
      `Invalid version "${version}": expected MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-N`,
    );
  }
  const pre = match[2];
  if (pre !== undefined && !/^\d+$/.test(pre)) {
    throw new Error(
      `Non-numeric pre-release suffix in "${version}": Windows MSI bundler requires numeric pre-release suffixes (e.g. 1.0.1-1).`,
    );
  }
  return trimmed;
}

function findPackageJsonFiles(rootDir) {
  const results = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        entry.name === "target" ||
        entry.name === "dist" ||
        // The plugin SDK carries its own API version (packages/plugin-sdk).
        (entry.name === "plugin-sdk" && path.basename(dir) === "packages")
      ) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name === "package.json") results.push(full);
    }
  }
  visit(rootDir);
  return results.sort((a, b) => a.localeCompare(b));
}

function updateCargoToml(cargoPath, version) {
  if (!fs.existsSync(cargoPath)) return false;
  const raw = fs.readFileSync(cargoPath, "utf8");
  const pattern = /(\[workspace\.package\][\s\S]*?\bversion\s*=\s*")[^"]+(")/;
  if (!pattern.test(raw)) {
    throw new Error(`Could not locate [workspace.package] version in ${cargoPath}`);
  }
  // Re-running with the current version is allowed and changes nothing.
  fs.writeFileSync(cargoPath, raw.replace(pattern, `$1${version}$2`), "utf8");
  return true;
}

function updateJsonVersion(jsonPath, version) {
  if (!fs.existsSync(jsonPath)) return false;
  const raw = fs.readFileSync(jsonPath, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed.version !== "string") {
    throw new Error(`Could not locate string "version" field in ${jsonPath}`);
  }
  const pattern = /^([ \t]*"version"\s*:\s*")[^"]+(")/m;
  if (!pattern.test(raw)) {
    throw new Error(`Could not update "version" line in place in ${jsonPath}`);
  }
  const updated = raw.replace(pattern, `$1${version}$2`);
  if (JSON.parse(updated).version !== version) {
    throw new Error(`In-place version update verification failed for ${jsonPath}`);
  }
  fs.writeFileSync(jsonPath, updated, "utf8");
  return true;
}

export function updateChangelog(changelogPath, version, date) {
  if (!fs.existsSync(changelogPath)) return false;
  const raw = fs.readFileSync(changelogPath, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  const unreleasedIdx = lines.findIndex((line) => /^## \[Unreleased\]/i.test(line));
  if (unreleasedIdx === -1) {
    throw new Error(`Could not find "## [Unreleased]" heading in ${changelogPath}`);
  }

  let nextHeadingIdx = lines.length;
  for (let i = unreleasedIdx + 1; i < lines.length; i++) {
    if (/^## \[/.test(lines[i])) {
      nextHeadingIdx = i;
      break;
    }
  }

  const bodyLines = lines.slice(unreleasedIdx + 1, nextHeadingIdx);
  while (bodyLines.length > 0 && bodyLines[0].trim() === "") bodyLines.shift();
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") bodyLines.pop();

  const updated = [
    ...lines.slice(0, unreleasedIdx),
    "## [Unreleased]",
    "",
    `## [${version}] - ${date}`,
    ...(bodyLines.length > 0
      ? ["", ...bodyLines]
      : ["", "### Changed", "", "- Release preparation"]),
    "",
    ...lines.slice(nextHeadingIdx),
  ];

  fs.writeFileSync(changelogPath, updated.join(eol), "utf8");
  return true;
}

export function bumpVersion({ repoRoot, version, date = new Date().toISOString().slice(0, 10) }) {
  const validVersion = validateVersion(version);
  const absRoot = path.resolve(repoRoot);
  const updatedFiles = [];

  const cargoPath = path.join(absRoot, "Cargo.toml");
  if (updateCargoToml(cargoPath, validVersion)) {
    updatedFiles.push("Cargo.toml");
  }

  for (const pkgPath of findPackageJsonFiles(absRoot)) {
    if (updateJsonVersion(pkgPath, validVersion)) {
      updatedFiles.push(path.relative(absRoot, pkgPath).split(path.sep).join("/"));
    }
  }

  const tauriConfPath = path.join(absRoot, "apps/desktop/src-tauri/tauri.conf.json");
  if (updateJsonVersion(tauriConfPath, validVersion)) {
    updatedFiles.push("apps/desktop/src-tauri/tauri.conf.json");
  }

  const changelogPath = path.join(absRoot, "CHANGELOG.md");
  if (updateChangelog(changelogPath, validVersion, date)) {
    updatedFiles.push("CHANGELOG.md");
  }

  return { version: validVersion, date, updatedFiles };
}

function parseArgs(argv) {
  let version = "";
  let date = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--date" && i + 1 < argv.length) {
      date = argv[++i];
    } else if (!arg.startsWith("-") && !version) {
      version = arg;
    } else {
      throw new Error(`Unknown or unexpected argument: ${arg}`);
    }
  }
  if (!version) {
    throw new Error("Usage: node scripts/release/bump-version.mjs <version> [--date YYYY-MM-DD]");
  }
  return { version, date };
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const { version, date } = parseArgs(process.argv.slice(2));
  const result = bumpVersion({ repoRoot, version, date });
  console.log(`Bumped version to ${result.version} (${result.date}) in:`);
  for (const rel of result.updatedFiles) {
    console.log(`  - ${rel}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
