# ADR-021: In-app updates via official Tauri updater and one-setting switch

Date: 2026-11-16
Status: Accepted ()

## Context

Previously, Bibalak checked for updates by calling `fetch()` directly from the Settings webview against `<site>/download/latest.json` (`apps/desktop/src/routes/SettingsScreen.tsx` `UpdateSection`), compared versions with `manifest.version !== current` (offering older versions as available updates), and only linked to an external download page. Meanwhile, `apps/desktop/src-tauri/tauri.conf.json` carried an unreachable legacy repository endpoint, `tauri-plugin-updater` was not installed, and the webview CSP `connect-src` whitelisted GitHub domains solely for that path.

The project's decisions establish that:

1. Bibalak must perform real in-app updates (check signed manifest, show version and notes, and on explicit user confirmation download, verify signature with the existing public key, install, and restart).
2. Because the download website does not exist yet, the entire feature and release pipeline must ship switched off and activate from **one** GitHub repository variable (`DOWNLOAD_SITE`) plus hosting upload secrets, with zero code changes needed at launch.

## Decision

1. **Official Tauri 2 plugins (thin wiring only):**
   - Register `tauri-plugin-updater = "2"` and `tauri-plugin-process = "2"` in `apps/desktop/src-tauri`, keeping `bibalak-core` and adapter crates free of updater or process concerns (ADR-001).
   - Grant only the minimum required capabilities on the `main` window (`apps/desktop/src-tauri/capabilities/default.json`): `updater:allow-check`, `updater:allow-download-and-install`, and `process:allow-restart`.
   - Expose update operations strictly through the `@/lib/platform` boundary (`platform.updater`: `check`, `downloadAndInstall`, `relaunch`). Outside Tauri (plain browser / `dev:web`), `check()` returns `"not-available"`. Components never import `@tauri-apps/plugin-*` directly (`platformGuard.test.ts`).

2. **One-setting switch (`DOWNLOAD_SITE`):**
   - `DOWNLOAD_SITE` is a single `https` origin with no path, query, hash, or credentials (e.g. `https://bibalak.example`), unset/empty until launch.
   - **Frontend:** `VITE_DOWNLOAD_SITE` is parsed by `parseDownloadSite` in `apps/desktop/src/lib/releases.ts` into `DOWNLOAD_SITE` (`null` when empty/unset/invalid).
   - **Rust/Tauri:** `scripts/release/site-config.mjs` generates a gitignored overlay config `apps/desktop/src-tauri/tauri.site.conf.json` passed via `--config` in `.github/workflows/release.yml`. When `DOWNLOAD_SITE` is set, the overlay sets `plugins.updater.endpoints = ["<origin>/download/latest.json"]`; when unset, `endpoints` stays empty (`[]`). The private GitHub endpoint is removed from `tauri.conf.json`.

3. **Manifest layout and release staging:**
   - Hosted manifests live at `<origin>/download/latest.json`, with platform bundle URLs pointing to `<origin>/download/<filename>` (rewritten from `tauri-action`'s draft output by `scripts/release/rewrite-manifest.mjs`).
   - `.github/workflows/release.yml` remains tag-triggered (`v*`) and creates a **draft** GitHub release. When `DOWNLOAD_SITE` is set, a post-build job rewrites `latest.json` and stages `site-upload/` (`latest.json`, installers, `.sig` files) as a workflow artifact, followed by a clearly marked disabled (`if: false`) upload step to enable once hosting is chosen. When `DOWNLOAD_SITE` is unset, `release.yml` runs as before with no rewrite or site staging.

4. **Behavior when no site is configured:**
   - `DOWNLOAD_SITE` is `null` and `plugins.updater.endpoints` is empty.
   - `SettingsScreen` (`UpdateSection`) renders the existing `settings.updates.noSite` message, hides `"Check for updates"`, and makes zero network requests.

5. **Security and user consent:**
   - **Cryptographic verification:** `tauri-plugin-updater` verifies every downloaded installer against the `.sig` file using the committed minisign public key (`plugins.updater.pubkey` in `tauri.conf.json`; private key remains outside the repo in `.keepsake-signing/` / GitHub secrets).
   - **Version ordering:** `tauri-plugin-updater` performs semver comparison and ignores older or equal manifests, preventing version downgrades.
   - **Explicit consent:** Checking only displays version and notes; downloading, installing, and restarting never happen silently and run only after the user clicks `"Install and restart"`.

6. **CSP tightening (`connect-src`):**
   - Because `tauri-plugin-updater` executes manifest fetches and binary downloads in Rust (`reqwest`) rather than the webview, the webview never connects to the update host.
   - Removing `https://github.com`, `https://objects.githubusercontent.com`, and `https://release-assets.githubusercontent.com` from both `csp.connect-src` and `devCsp.connect-src` in `tauri.conf.json` leaves webview network access restricted exclusively to `'self'`, `ipc:`, `http://ipc.localhost` (plus `ws://localhost:1420` in dev), strengthening ADR-003 / ADR-004 isolation for card HTML and plugin Workers.

## Consequences

- Switching on live updates at launch requires setting `DOWNLOAD_SITE` in GitHub repository variables, adding hosting secrets, and enabling the upload step in `.github/workflows/release.yml` — zero application code changes.
- `tauriCsp.test.ts` enforces the tighter `connect-src` allowlist without GitHub domains.
- `THIRD_PARTY_NOTICES.md` is regenerated (`node scripts/licenses/generate-notices.mjs --write`) to cover the two Tauri plugins and their transitive crates.
