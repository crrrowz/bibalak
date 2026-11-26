import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bumpVersion } from "./bump-version.mjs";

function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
}

test("bumpVersion updates Cargo.toml, all workspace package.json files, tauri.conf.json, and CHANGELOG.md", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keepsake-bump-"));
  try {
    writeFiles(root, {
      "Cargo.toml": '[workspace.package]\nversion = "1.0.0"\nedition = "2021"\n',
      "package.json":
        JSON.stringify({ name: "bibalak-monorepo", version: "1.0.0" }, null, 2) + "\n",
      "apps/desktop/package.json":
        JSON.stringify({ name: "@bibalak/desktop", version: "1.0.0" }, null, 2) + "\n",
      "packages/ipc-types/package.json":
        JSON.stringify({ name: "@bibalak/ipc-types", version: "0.1.0" }, null, 2) + "\n",
      "packages/plugin-sdk/package.json":
        JSON.stringify({ name: "@bibalak/plugin-sdk", version: "0.1.0" }, null, 2) + "\n",
      "apps/desktop/src-tauri/tauri.conf.json":
        JSON.stringify({ productName: "Bibalak", version: "1.0.0" }, null, 2) + "\n",
      "CHANGELOG.md": [
        "# Changelog",
        "",
        "## [Unreleased] — first Bibalak release (1.0.0)",
        "",
        "### Added",
        "",
        "- Initial release items",
        "",
        "## [0.1.0-beta.3] - 2026-07-04",
        "",
        "- Older item",
        "",
      ].join("\n"),
    });

    const result = bumpVersion({
      repoRoot: root,
      version: "1.2.0",
      date: "2026-11-25",
    });

    assert.ok(result.updatedFiles.length >= 6);
    assert.ok(fs.readFileSync(path.join(root, "Cargo.toml"), "utf8").includes('version = "1.2.0"'));
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version,
      "1.2.0",
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, "apps/desktop/package.json"), "utf8")).version,
      "1.2.0",
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, "packages/ipc-types/package.json"), "utf8"))
        .version,
      "1.2.0",
    );
    // The plugin SDK keeps its own API version.
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, "packages/plugin-sdk/package.json"), "utf8"))
        .version,
      "0.1.0",
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"))
        .version,
      "1.2.0",
    );

    const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
    assert.ok(changelog.includes("## [Unreleased]\n"));
    assert.ok(changelog.includes("## [1.2.0] - 2026-11-25\n"));
    assert.ok(changelog.indexOf("## [Unreleased]") < changelog.indexOf("## [1.2.0] - 2026-11-25"));
    assert.ok(
      changelog.indexOf("## [1.2.0] - 2026-11-25") <
        changelog.indexOf("## [0.1.0-beta.3] - 2026-07-04"),
    );
    assert.ok(changelog.includes("- Initial release items"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bumpVersion rejects invalid versions and non-numeric MSI-incompatible pre-releases", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keepsake-bump-err-"));
  try {
    assert.throws(
      () => bumpVersion({ repoRoot: root, version: "1.0.0-rc.1", date: "2026-11-25" }),
      /numeric pre-release/i,
    );
    assert.throws(
      () => bumpVersion({ repoRoot: root, version: "not-a-version", date: "2026-11-25" }),
      /invalid version/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
