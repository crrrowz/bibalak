import assert from "node:assert/strict";
import test from "node:test";
import {
  SYNAPSE_MIT_NOTICE,
  assertSynapseNoticeIntact,
  isAllowedSpdxExpression,
  replaceGeneratedSection,
  validateNpmLicenses,
  renderNpmNotices,
} from "./generate-notices.mjs";

test("allows every SPDX id in the C2 allowlist and valid combinations", () => {
  for (const id of [
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
  ]) {
    assert.equal(isAllowedSpdxExpression(id), true, `expected ${id} to be allowed`);
  }

  assert.equal(isAllowedSpdxExpression("MIT OR Apache-2.0"), true);
  assert.equal(isAllowedSpdxExpression("MIT AND ISC"), true);
  assert.equal(isAllowedSpdxExpression("(MIT OR Apache-2.0) AND BSD-3-Clause"), true);
  assert.equal(isAllowedSpdxExpression("GPL-3.0-only OR MIT"), true);
});

test("rejects GPL, AGPL, LGPL, SSPL, NonCommercial, and unknown licences", () => {
  for (const bad of [
    "GPL-3.0",
    "GPL-3.0-only",
    "AGPL-3.0-or-later",
    "LGPL-2.1-only",
    "SSPL-1.0",
    "CC-BY-NC-SA-4.0",
    "NonCommercial",
    "MIT AND GPL-3.0-only",
    "Proprietary",
    "",
  ]) {
    assert.equal(isAllowedSpdxExpression(bad), false, `expected ${bad} to be rejected`);
  }
});

test("validateNpmLicenses fails on fake GPL entry and skips @bibalak/* packages", () => {
  const okOnly = {
    MIT: [{ name: "@bibalak/desktop", versions: ["1.0.0"], license: "UNLICENSED", paths: [] }],
    ISC: [{ name: "lucide-react", versions: ["1.20.0"], license: "ISC", paths: [] }],
  };
  assert.doesNotThrow(() => validateNpmLicenses(okOnly));

  const withGpl = {
    ...okOnly,
    "GPL-3.0-only": [
      { name: "evil-gpl-pkg", versions: ["0.1.0"], license: "GPL-3.0-only", paths: [] },
    ],
  };
  assert.throws(
    () => validateNpmLicenses(withGpl),
    /Disallowed npm licence.*evil-gpl-pkg@0\.1\.0.*GPL-3\.0-only/s,
  );
});

test("assertSynapseNoticeIntact passes for exact notice and fails when modified or missing", () => {
  const validDoc = `# Third-Party Notices\n\n${SYNAPSE_MIT_NOTICE}\n\n<!-- generated:start -->\n<!-- generated:end -->\n`;
  assert.doesNotThrow(() => assertSynapseNoticeIntact(validDoc));

  const alteredDoc = validDoc.replace("Synapse contributors", "Someone Else");
  assert.throws(() => assertSynapseNoticeIntact(alteredDoc), /Synapse MIT notice/);

  assert.throws(() => assertSynapseNoticeIntact("# Empty"), /Synapse MIT notice/);
});

test("replaceGeneratedSection preserves header and replaces only marker body", () => {
  const input = [
    "# Header",
    "",
    SYNAPSE_MIT_NOTICE,
    "",
    "<!-- generated:start -->",
    "old content",
    "<!-- generated:end -->",
    "",
  ].join("\n");

  const out = replaceGeneratedSection(input, "new body");
  assert.ok(out.includes("# Header"));
  assert.ok(out.includes("new body"));
  assert.ok(!out.includes("old content"));

  assert.throws(() => replaceGeneratedSection("# No markers", "x"), /generated:start/);
});

test("renderNpmNotices formats deterministic Markdown table and omits @bibalak/* packages", () => {
  const md = renderNpmNotices({
    MIT: [
      { name: "zustand", versions: ["5.0.14"], license: "MIT", paths: [] },
      { name: "@bibalak/core", versions: ["1.0.0"], license: "MIT", paths: [] },
    ],
    ISC: [{ name: "clsx", versions: ["2.1.1"], license: "ISC", paths: [] }],
  });

  assert.ok(!md.includes("@bibalak/core"));
  assert.ok(md.includes("| `clsx` | `2.1.1` | `ISC` |"));
  assert.ok(md.includes("| `zustand` | `5.0.14` | `MIT` |"));
  assert.ok(md.indexOf("`clsx`") < md.indexOf("`zustand`"));
});
