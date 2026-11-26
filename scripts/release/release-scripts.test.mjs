import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSiteOverlay, parseSiteOrigin } from "./site-config.mjs";
import { rewriteManifest } from "./rewrite-manifest.mjs";

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

test("buildSiteOverlay emits empty endpoints when unset and manifest URL when configured", () => {
  assert.deepEqual(buildSiteOverlay(null), {
    plugins: { updater: { endpoints: [] } },
  });
  assert.deepEqual(buildSiteOverlay("https://bibalak.example"), {
    plugins: { updater: { endpoints: ["https://bibalak.example/download/latest.json"] } },
  });
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
