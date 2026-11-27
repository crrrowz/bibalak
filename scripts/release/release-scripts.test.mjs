/* global URL */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  GITHUB_LATEST_JSON,
  GITHUB_REPOSITORY_URL,
  buildSiteOverlay,
  parseSiteOrigin,
  updaterEndpoint,
} from "./site-config.mjs";
import { rewriteManifest, rewriteManifestForGitHub } from "./rewrite-manifest.mjs";

test("parseSiteOrigin validates https origins with no path, query, hash, or credentials", () => {
  assert.equal(parseSiteOrigin(undefined), null);
  assert.equal(parseSiteOrigin(""), null);
  assert.equal(parseSiteOrigin("   "), null);
  assert.equal(parseSiteOrigin("https://bibalak.example/"), "https://bibalak.example");

  assert.throws(() => parseSiteOrigin("http://bibalak.example"), /https/);
  assert.throws(() => parseSiteOrigin("https://bibalak.example/download"), /path/i);
  assert.throws(() => parseSiteOrigin("https://bibalak.example?x=1"), /query/i);
  assert.throws(() => parseSiteOrigin("https://user@bibalak.example"), /credentials/i);
});

test("the GitHub update source is built from the one shared repository constant", () => {
  const shared = JSON.parse(
    fs.readFileSync(
      new URL("../../apps/desktop/src/lib/updateSource.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(GITHUB_REPOSITORY_URL, shared.repository);
  assert.equal(GITHUB_REPOSITORY_URL, "https://github.com/crrrowz/bibalak");
  assert.equal(
    GITHUB_LATEST_JSON,
    "https://github.com/crrrowz/bibalak/releases/latest/download/latest.json",
  );
});

test("updaterEndpoint: site when set, GitHub Releases when unset, none without signing", () => {
  assert.equal(
    updaterEndpoint("https://bibalak.example", { signed: true }),
    "https://bibalak.example/download/latest.json",
  );
  assert.equal(updaterEndpoint(null, { signed: true }), GITHUB_LATEST_JSON);
  assert.equal(updaterEndpoint(null, { signed: false }), null);
  assert.equal(updaterEndpoint("https://bibalak.example", { signed: false }), null);
});

test("buildSiteOverlay emits the endpoint for signed builds and none for unsigned ones", () => {
  assert.deepEqual(buildSiteOverlay(null, { signed: false }), {
    plugins: { updater: { endpoints: [] } },
  });
  assert.deepEqual(buildSiteOverlay(null, { signed: true }), {
    plugins: { updater: { endpoints: [GITHUB_LATEST_JSON] } },
  });
  assert.deepEqual(buildSiteOverlay("https://bibalak.example", { signed: true }), {
    plugins: { updater: { endpoints: ["https://bibalak.example/download/latest.json"] } },
  });
  assert.deepEqual(buildSiteOverlay("https://bibalak.example", { signed: false }), {
    plugins: { updater: { endpoints: [] } },
  });
});

test("rewriteManifestForGitHub points every platform at the release download URL by asset name", () => {
  const api = "https://api.github.com/repos/crrrowz/bibalak/releases/assets";
  const manifest = {
    version: "1.1.0",
    notes: "",
    pub_date: "2026-11-26T12:00:00Z",
    platforms: {
      "windows-x86_64": { signature: "SIG_NSIS", url: `${api}/11` },
      "windows-x86_64-nsis": { signature: "SIG_NSIS", url: `${api}/11` },
      "windows-x86_64-msi": { signature: "SIG_MSI", url: `${api}/12` },
      "linux-x86_64-deb": { signature: "SIG_DEB", url: `${api}/13` },
    },
  };
  const assets = [
    { name: "Bibalak_1.1.0_x64-setup.exe", url: `${api}/11` },
    { name: "Bibalak_1.1.0_x64_en-US.msi", url: `${api}/12` },
    { name: "Bibalak_1.1.0_amd64.deb", url: `${api}/13` },
  ];
  const opts = { repositoryUrl: "https://github.com/crrrowz/bibalak", tag: "v1.1.0", assets };
  const out = rewriteManifestForGitHub(manifest, opts);
  const base = "https://github.com/crrrowz/bibalak/releases/download/v1.1.0";
  assert.equal(out.platforms["windows-x86_64"].url, `${base}/Bibalak_1.1.0_x64-setup.exe`);
  assert.equal(out.platforms["windows-x86_64-nsis"].url, `${base}/Bibalak_1.1.0_x64-setup.exe`);
  assert.equal(out.platforms["windows-x86_64-msi"].url, `${base}/Bibalak_1.1.0_x64_en-US.msi`);
  assert.equal(out.platforms["linux-x86_64-deb"].url, `${base}/Bibalak_1.1.0_amd64.deb`);
  assert.equal(out.platforms["windows-x86_64-msi"].signature, "SIG_MSI");
  assert.equal(out.version, "1.1.0");

  // Empty notes are filled from the release body, without the downloads table.
  const withNotes = rewriteManifestForGitHub(manifest, {
    ...opts,
    releaseBody: "### Fixed\n\n- Faster study queue\n\n## Downloads\n\n| Platform |",
  });
  assert.equal(withNotes.notes, "### Fixed\n\n- Faster study queue");
  assert.equal(
    rewriteManifestForGitHub({ ...manifest, notes: "Kept" }, { ...opts, releaseBody: "x" }).notes,
    "Kept",
  );

  // A re-run on an already rewritten manifest changes nothing.
  assert.deepEqual(rewriteManifestForGitHub(out, opts), out);

  assert.throws(
    () =>
      rewriteManifestForGitHub(
        { ...manifest, platforms: { "linux-x86_64": { signature: "S", url: `${api}/99` } } },
        opts,
      ),
    /linux-x86_64/,
  );
});

test("rewriteManifest rewrites all platform URLs to <site>/download/<filename> preserving signatures", () => {
  const original = {
    version: "1.2.0",
    notes: "Bug fixes",
    pub_date: "2026-11-16T12:00:00Z",
    platforms: {
      "windows-x86_64": {
        signature: "SIG_WIN",
        url: "https://github.com/example/keepsake/releases/download/v1.2.0/Bibalak_1.2.0_x64-setup.exe",
      },
      "darwin-aarch64": {
        signature: "SIG_MAC",
        url: "https://github.com/example/keepsake/releases/download/v1.2.0/Bibalak_aarch64.app.tar.gz",
      },
      "linux-x86_64": {
        signature: "SIG_LIN",
        url: "https://github.com/example/keepsake/releases/download/v1.2.0/Bibalak_1.2.0_amd64.AppImage",
      },
    },
  };

  const rewritten = rewriteManifest(original, "https://bibalak.example/");
  assert.equal(rewritten.version, "1.2.0");
  assert.equal(rewritten.notes, "Bug fixes");
  assert.equal(rewritten.platforms["windows-x86_64"].signature, "SIG_WIN");
  assert.equal(
    rewritten.platforms["windows-x86_64"].url,
    "https://bibalak.example/download/Bibalak_1.2.0_x64-setup.exe",
  );
  assert.equal(
    rewritten.platforms["darwin-aarch64"].url,
    "https://bibalak.example/download/Bibalak_aarch64.app.tar.gz",
  );
  assert.equal(
    rewritten.platforms["linux-x86_64"].url,
    "https://bibalak.example/download/Bibalak_1.2.0_amd64.AppImage",
  );

  assert.throws(
    () => rewriteManifest({ version: "1.2.0", platforms: {} }, "https://bibalak.example"),
    /platforms/,
  );
  assert.throws(() => rewriteManifest(original, ""), /DOWNLOAD_SITE/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "keepsake-site-cfg-"));
  fs.rmSync(tmp, { recursive: true, force: true });
});
