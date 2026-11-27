# Releasing Bibalak

This guide describes how Bibalak releases are prepared and built across **Windows**, **macOS**, and **Linux**.

## Versioning rules

- Semantic Versioning (`MAJOR.MINOR.PATCH`).
- **Pre-release suffixes must be numeric** (for example `1.0.1-1`, never `-rc.1` or `-beta.1`) because the Windows MSI bundler rejects non-numeric pre-release identifiers.

## Step 1 — Agent / maintainer preparation (no tag push)

1. Ensure `main` is clean and all checks pass (`pnpm check` and `node scripts/licenses/generate-notices.mjs --check`).
2. Update `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md) from merged pull requests (categorized under `Added`, `Changed`, `Security`, `Fixed`).
3. Bump all manifests and stamp the changelog date with:
   ```sh
   node scripts/release/bump-version.mjs <version>
   ```
   This updates:
   - `Cargo.toml` (`[workspace.package].version`)
   - every workspace `package.json` (`package.json`, `apps/desktop/package.json`, `packages/ipc-types/package.json`, `packages/ui-tokens/package.json`, `apps/desktop/test-e2e/package.json`; skips `packages/plugin-sdk`, which keeps its own plugin API version; in `1.0.0` the internal packages `ipc-types`, `ui-tokens`, and `test-e2e` remained at `0.1.0`)
   - `apps/desktop/src-tauri/tauri.conf.json`
   - `CHANGELOG.md` (moves `## [Unreleased]` items into `## [<version>] - YYYY-MM-DD`)
4. Review the diff and commit:
   ```sh
   git commit -am "chore(release): prepare v<version>"
   ```

## Step 2 — Owner-only tag & publish

Only the project owner pushes release tags and publishes GitHub Releases:

1. Create and push an annotated tag:
   ```sh
   git tag -a v<version> -m "v<version>"
   git push origin v<version>
   ```
2. GitHub Actions (`.github/workflows/release.yml`) runs automatically on `v*` tags:
   - **Windows (`x86_64`):** NSIS installer (`-setup.exe`), MSI (`.msi`), and portable ZIP (`_x64_portable.zip`). `Bibalak_<version>_x64-setup.exe` is the normal choice on Windows; `.msi` files show the generic Windows Installer icon in Explorer by design.
   - **macOS (`aarch64` & `x86_64`):** `.dmg` disk images.
   - **Linux (`x86_64`):** `.AppImage`, `.deb` and `.rpm`.
   - **Checksums:** Generates `SHA256SUMS` covering all release artifacts.
   - **Release body:** Combines the matching `CHANGELOG.md` section with `.github/release-notes-template.md`.
   - **Publish:** Once every platform has uploaded its files and `SHA256SUMS` is attached, the `publish` job takes the release out of draft. A tag with a suffix (`v1.2.0-1`) becomes a pre-release; a plain tag becomes the **Latest** release.
3. Optional signing secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) are only used when present in repository secrets; forks and unsigned builds skip updater signing cleanly without failing.
4. To review a release by hand before it goes out, set the repository variable `RELEASE_KEEP_DRAFT` to `true`; the release then stays a draft until you click **Publish release**.

## Keeping in-app updates working

Installed copies of Bibalak (1.1.0 and later) check
`https://github.com/crrrowz/bibalak/releases/latest/download/latest.json`.
`latest` is the newest **published, non-draft, non-prerelease** release, so:

1. The release must be signed: both signing secrets must be set, or the build has no `latest.json` and no `.sig` files. A signed build that ends without `latest.json` fails the workflow on purpose.
2. **Publish the draft.** Until it is published, no copy sees the update. With `RELEASE_KEEP_DRAFT=true`, click **Publish release** yourself and keep **Set as the latest release** ticked.
3. **Never mark a release for everyone as a pre-release**, and never mark a pre-release (`v1.2.0-1`) as latest: users would be offered it.
4. Do not delete or rename `latest.json` or the installer files of the latest release. Each entry points at `https://github.com/crrrowz/bibalak/releases/download/<tag>/<file>`.
5. Check after publishing: open the `latest.json` link above in a browser; it must show the new version and the per-installer keys (`windows-x86_64-nsis`, `windows-x86_64-msi`, `linux-x86_64-appimage`, `linux-x86_64-deb`, `linux-x86_64-rpm`, `darwin-aarch64-app`, `darwin-x86_64-app`).

Forks build without the maintainer secrets: their builds have no update source and say so in **Settings → Updates**.

## Code signing

Builds are not yet signed with an operating-system certificate. Windows shows a
SmartScreen prompt and macOS a Gatekeeper prompt on first launch; the
[install guide](docs/guides/install.md#unsigned-builds) shows
users how to proceed. When certificates are available, add them as repository
secrets and the workflow will sign automatically.

## Verifying downloads (`SHA256SUMS`)

Download the installer/archive and `SHA256SUMS` from the release page, then verify:

```sh
# macOS / Linux
sha256sum -c SHA256SUMS --ignore-missing

# Windows (PowerShell)
Get-FileHash .\Bibalak_<version>_x64-setup.exe -Algorithm SHA256
```
