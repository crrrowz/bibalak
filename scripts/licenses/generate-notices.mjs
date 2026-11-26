/* global console, process */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ALLOWED_SPDX_IDS = new Set([
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "Apache-2.0 WITH LLVM-exception",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Zlib",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "BSL-1.0",
  "Unicode-3.0",
  "Unicode-DFS-2016",
  "MPL-2.0",
  "OFL-1.1",
  "CDLA-Permissive-2.0",
  "BlueOak-1.0.0",
]);

export const SYNAPSE_MIT_NOTICE = [
  "MIT License",
  "",
  "Copyright (c) 2026 Synapse contributors",
  "",
  "Permission is hereby granted, free of charge, to any person obtaining a copy",
  'of this software and associated documentation files (the "Software"), to deal',
  "in the Software without restriction, including without limitation the rights",
  "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
  "copies of the Software, and to permit persons to whom the Software is",
  "furnished to do so, subject to the following conditions:",
  "",
  "The above copyright notice and this permission notice shall be included in all",
  "copies or substantial portions of the Software.",
  "",
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
  "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
  "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
  "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
  "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
  "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
  "SOFTWARE.",
].join("\n");

const START_MARKER = "<!-- generated:start -->";
const END_MARKER = "<!-- generated:end -->";

export function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isForbiddenTerm(id) {
  return /^(A?GPL|LGPL|SSPL|CC-BY-NC)/i.test(id) || /noncommercial/i.test(id);
}

function tokenizeSpdx(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "/") {
      tokens.push(ch);
      i++;
      continue;
    }
    let start = i;
    while (i < expr.length && !/[\s()/]/.test(expr[i])) {
      i++;
    }
    tokens.push(expr.slice(start, i));
  }
  return tokens;
}

/**
 * Evaluate an SPDX license expression against ALLOWED_SPDX_IDS.
 * Supports `OR`, `AND`, `/`, parentheses, and `WITH <exception>`.
 */
export function isAllowedSpdxExpression(expr) {
  if (typeof expr !== "string" || !expr.trim()) return false;
  const tokens = tokenizeSpdx(expr.trim());
  if (tokens.length === 0) return false;

  let pos = 0;

  function parseOr() {
    let left = parseAnd();
    if (left === null) return null;
    while (pos < tokens.length && (tokens[pos] === "OR" || tokens[pos] === "/")) {
      pos++;
      const right = parseAnd();
      if (right === null) return null;
      left = left || right;
    }
    return left;
  }

  function parseAnd() {
    let left = parseAtom();
    if (left === null) return null;
    while (pos < tokens.length && tokens[pos] === "AND") {
      pos++;
      const right = parseAtom();
      if (right === null) return null;
      left = left && right;
    }
    return left;
  }

  function parseAtom() {
    if (pos >= tokens.length) return null;
    if (tokens[pos] === "(") {
      pos++;
      const val = parseOr();
      if (val === null || tokens[pos] !== ")") return null;
      pos++;
      return val;
    }
    const base = tokens[pos];
    if (base === ")" || base === "OR" || base === "AND" || base === "/") {
      return null;
    }
    pos++;
    let fullId = base;
    if (pos + 1 < tokens.length && tokens[pos] === "WITH") {
      const exc = tokens[pos + 1];
      if (!exc || exc === "(" || exc === ")") return null;
      fullId = `${base} WITH ${exc}`;
      pos += 2;
    }
    if (isForbiddenTerm(fullId)) return false;
    return ALLOWED_SPDX_IDS.has(fullId);
  }

  const result = parseOr();
  if (result === null || pos !== tokens.length) return false;
  return result;
}

export function isFirstPartyNpmPackage(name) {
  return typeof name === "string" && name.startsWith("@bibalak/");
}

export function validateNpmLicenses(licensesMap) {
  const disallowed = [];
  for (const [licenseKey, pkgs] of Object.entries(licensesMap ?? {})) {
    for (const pkg of pkgs ?? []) {
      if (isFirstPartyNpmPackage(pkg.name)) continue;
      const expr = pkg.license || licenseKey;
      if (!isAllowedSpdxExpression(expr)) {
        const version = Array.isArray(pkg.versions) ? pkg.versions.join(", ") : "";
        disallowed.push(`${pkg.name}@${version} (${expr || "UNKNOWN"})`);
      }
    }
  }
  if (disallowed.length > 0) {
    throw new Error(`Disallowed npm licence(s) found:\n  - ${disallowed.join("\n  - ")}`);
  }
}

export function assertSynapseNoticeIntact(docText) {
  const normalized = normalizeNewlines(docText);
  const startIdx = normalized.indexOf(START_MARKER);
  const headerPart = startIdx === -1 ? normalized : normalized.slice(0, startIdx);
  if (!headerPart.includes(SYNAPSE_MIT_NOTICE)) {
    throw new Error(
      "Synapse MIT notice in THIRD_PARTY_NOTICES.md is missing or has been modified.",
    );
  }
}

export function assertAssetsRegisterExists(repoRoot) {
  const registerPath = path.join(repoRoot, "docs", "legal", "third-party-assets-register.md");
  if (!fs.existsSync(registerPath)) {
    throw new Error(`Required third-party assets register is missing: ${registerPath}`);
  }
  const content = fs.readFileSync(registerPath, "utf8").trim();
  if (!content) {
    throw new Error(`Required third-party assets register is empty: ${registerPath}`);
  }
}

export function replaceGeneratedSection(docText, generatedBody) {
  const normalized = normalizeNewlines(docText);
  const startIdx = normalized.indexOf(START_MARKER);
  const endIdx = normalized.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `THIRD_PARTY_NOTICES.md must contain ${START_MARKER} followed by ${END_MARKER}.`,
    );
  }
  const before = normalized.slice(0, startIdx + START_MARKER.length);
  const after = normalized.slice(endIdx);
  const cleanBody = normalizeNewlines(generatedBody).trim();
  return `${before}\n\n${cleanBody}\n\n${after}`;
}

function readPackageLicenseText(pkgDir) {
  if (!pkgDir || !fs.existsSync(pkgDir)) return null;
  let entries;
  try {
    entries = fs.readdirSync(pkgDir);
  } catch {
    return null;
  }
  const candidate = entries
    .filter((name) => /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i.test(name))
    .sort((a, b) => a.localeCompare(b))[0];
  if (!candidate) return null;
  try {
    const raw = normalizeNewlines(fs.readFileSync(path.join(pkgDir, candidate), "utf8")).trim();
    return raw || null;
  } catch {
    return null;
  }
}

export function renderNpmNotices(licensesMap) {
  const rows = [];
  const textGroups = new Map();

  for (const [licenseKey, pkgs] of Object.entries(licensesMap ?? {})) {
    for (const pkg of pkgs ?? []) {
      if (isFirstPartyNpmPackage(pkg.name)) continue;
      const expr = pkg.license || licenseKey;
      const version = Array.isArray(pkg.versions)
        ? [...pkg.versions].sort((a, b) => a.localeCompare(b)).join(", ")
        : "";
      rows.push({ name: pkg.name, version, license: expr });

      for (const pkgPath of pkg.paths ?? []) {
        const text = readPackageLicenseText(pkgPath);
        if (!text) continue;
        const hash = createHash("sha256").update(text).digest("hex");
        let group = textGroups.get(hash);
        if (!group) {
          group = { license: expr, text, packages: new Set() };
          textGroups.set(hash, group);
        }
        group.packages.add(`${pkg.name}@${version}`);
      }
    }
  }

  rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  const lines = [
    "### npm packages (`@bibalak/desktop` production dependencies)",
    "",
    "| Package | Version | License |",
    "| --- | --- | --- |",
    ...rows.map((r) => `| \`${r.name}\` | \`${r.version}\` | \`${r.license}\` |`),
  ];

  const sortedTexts = [...textGroups.values()].sort((a, b) => {
    const firstA = [...a.packages].sort()[0] ?? "";
    const firstB = [...b.packages].sort()[0] ?? "";
    return a.license.localeCompare(b.license) || firstA.localeCompare(firstB);
  });

  if (sortedTexts.length > 0) {
    lines.push("", "#### npm license texts", "");
    for (const group of sortedTexts) {
      const pkgsList = [...group.packages]
        .sort()
        .map((p) => `\`${p}\``)
        .join(", ");
      lines.push(`##### ${group.license} — ${pkgsList}`, "", "````text", group.text, "````", "");
    }
  }

  return lines.join("\n").trimEnd();
}

function runCommand(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runPnpmLicensesJson(repoRoot) {
  const args = ["--filter", "@bibalak/desktop", "licenses", "list", "--prod", "--json"];
  let stdout;
  try {
    stdout = runCommand("pnpm", args, repoRoot);
  } catch (err) {
    if (process.platform === "win32") {
      try {
        stdout = execFileSync("cmd.exe", ["/c", "pnpm", ...args], {
          cwd: repoRoot,
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        stdout = execFileSync("cmd.exe", ["/c", "npx", "pnpm@11.5.0", ...args], {
          cwd: repoRoot,
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        });
      }
    } else {
      throw err;
    }
  }
  return JSON.parse(stdout);
}

function runCargoAboutMarkdown(repoRoot) {
  const tmpFile = path.join(os.tmpdir(), `keepsake-cargo-about-${process.pid}-${Date.now()}.md`);
  try {
    runCommand(
      "cargo",
      ["about", "generate", "--workspace", "--locked", "--fail", "about.hbs", "-o", tmpFile],
      repoRoot,
    );
    return normalizeNewlines(fs.readFileSync(tmpFile, "utf8")).trim();
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

export function generateNoticesDocument(repoRoot) {
  assertAssetsRegisterExists(repoRoot);

  const noticesPath = path.join(repoRoot, "THIRD_PARTY_NOTICES.md");
  const currentDoc = normalizeNewlines(fs.readFileSync(noticesPath, "utf8"));
  assertSynapseNoticeIntact(currentDoc);

  const npmLicenses = runPnpmLicensesJson(repoRoot);
  validateNpmLicenses(npmLicenses);

  const rustSection = runCargoAboutMarkdown(repoRoot);
  const npmSection = renderNpmNotices(npmLicenses);
  const combined = `${rustSection}\n\n${npmSection}`;
  return replaceGeneratedSection(currentDoc, combined);
}

function main() {
  const args = process.argv.slice(2);
  const modeWrite = args.includes("--write");
  const modeCheck = args.includes("--check");
  if ((modeWrite && modeCheck) || (!modeWrite && !modeCheck) || args.length !== 1) {
    console.error("Usage: node scripts/licenses/generate-notices.mjs --write | --check");
    process.exit(2);
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const noticesPath = path.join(repoRoot, "THIRD_PARTY_NOTICES.md");

  try {
    const nextDoc = generateNoticesDocument(repoRoot);
    if (modeWrite) {
      fs.writeFileSync(noticesPath, nextDoc, "utf8");
      console.log("Updated THIRD_PARTY_NOTICES.md");
      return;
    }
    const existingDoc = normalizeNewlines(fs.readFileSync(noticesPath, "utf8"));
    if (existingDoc !== nextDoc) {
      console.error(
        "THIRD_PARTY_NOTICES.md is out of date. Run: node scripts/licenses/generate-notices.mjs --write",
      );
      process.exit(1);
    }
    console.log("THIRD_PARTY_NOTICES.md is up to date and all licences are allowed.");
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
