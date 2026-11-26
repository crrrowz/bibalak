# AGENTS.md

Rules for AI coding agents working on Bibalak. Read this file, [`CONTRIBUTING.md`](CONTRIBUTING.md), and [`ARCHITECTURE.md`](ARCHITECTURE.md) before changing code.

## Project facts

- **Bibalak** — open-source (`AGPL-3.0-or-later`, with `packages/plugin-sdk` under `MIT`), Anki-compatible spaced-repetition desktop app (Tauri 2 + React 19 + Rust workspace). Derived from Synapse (MIT): keep `THIRD_PARTY_NOTICES.md` intact.
- **Architecture:** Clean architecture (`bibalak-core` pure domain + ports → adapter crates → `apps/desktop/src-tauri` shell → `apps/desktop/src` React UI). See `docs/architecture/overview.md` and `docs/architecture/adr/`.

## Working rules

1. One branch per change; small, test-first commits (`fix/...`, `feat/...`, `docs/...`); never commit directly to `main`.
2. Run all checks before every commit (or `pnpm check` / `pnpm check:no-rust`):
   - `cargo fmt --check`
   - `cargo clippy --workspace --all-targets -- -D warnings`
   - `cargo test --workspace`
   - `git diff --exit-code packages/ipc-types`
   - `pnpm lint:ts`
   - `pnpm fmt:check`
   - `pnpm test:ts`
   - `pnpm --filter @bibalak/desktop build`
3. UI text only through `t()` / `tn()` with keys in `apps/desktop/src/locales/en.ts` and `ar.ts`; layout classes logical only (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`, `text-start` — enforced by `src/test/i18nGuards.test.ts`).
4. Card HTML is untrusted: render it only through `CardFace` (sandboxed iframe, ADR-004).
5. Host APIs (`@tauri-apps/*`) live only inside `apps/desktop/src/lib/platform/` (`platformGuard.test.ts`); screens use `src/lib/ipc.ts` and `platform` (cross-platform rule).
6. UI checks without Tauri: `pnpm dev:web` → `http://localhost:1420/preview.html`.
7. Any new dependency must be compatible with `AGPL-3.0-or-later` (`about.toml`) and reflected via `node scripts/licenses/generate-notices.mjs --write`. Any third-party art, icon, font, or sound gets a row in `docs/legal/third-party-assets-register.md`.
8. Never commit keys, signing secrets, `.env` files, or personal collections (`fixtures/` holds synthetic test decks only).

## Known pitfalls

- **Tags** are stored as `" a b "` (leading and trailing space); `tag:` search matches `"% a %"`. Rewrite tags only through the existing tag helpers.
- **Note checksum** = Anki `csum`: first 4 bytes of SHA-1 of the first field (media names kept, HTML stripped, entities decoded) — `field_checksum` in `crates/bibalak-db/src/browse/text.rs` (ADR-007). Never another hash.
- **Media files keep their original names** (cards reference them by name and `.apkg` export must stay valid in Anki). Duplicates are found by checksum; a name collision gets a suffix, never a hash-based rename.
- **Import remaps ids:** tests must look up note/card/deck ids after import, not assume fixture ids.
- **Card `type` vs `queue`:** relearning is type 3 / queue 1 (`phase_to_type_queue`); restoring with `queue = type` is wrong.
- **Days:** use the backend's day index (rollover hour + tz offset, see `day_expr` in `crates/bibalak-db/src/stats.rs`); never compute days in the UI.
- **Data paths** only via `data_dir::data_dir` (portable mode, ADR-006).
- **Layers:** `bibalak-core`, `bibalak-scheduler`, and `bibalak-render` have no network, filesystem, Tauri, or UI dependencies.
- **Formatting:** use `lib/i18n` formatters (app locale, not system locale). Arabic fractions read `3 من 10`, not `3 / 10`.
- **MSI pre-releases:** Windows WiX MSI requires numeric pre-release suffixes (`1.0.1-1`, never `-rc.1`).

## Release

When preparing a release (see [`RELEASING.md`](RELEASING.md)):

### What a contributor or agent prepares (never pushes tags)

1. Choose the semantic version `<ver>` (numeric pre-release only if pre-release, e.g. `1.0.1-1`).
2. Review merged PRs since the previous tag and draft concise entries under `## [Unreleased]` in `CHANGELOG.md` (Keep a Changelog format: `Added`, `Changed`, `Security`, `Fixed`).
3. Run the release bump script:
   ```sh
   node scripts/release/bump-version.mjs <ver>
   ```
   This updates `Cargo.toml`, every workspace `package.json` (except the plugin SDK), `apps/desktop/src-tauri/tauri.conf.json`, and promotes `## [Unreleased]` to `## [<ver>] - YYYY-MM-DD` in `CHANGELOG.md`.
4. Verify `.github/release-notes-template.md` and `pnpm check` (all Rust + TypeScript + licence checks green).
5. Commit the version bump (`chore(release): prepare v<ver>`) and report readiness to the owner.

### What only the owner does

- Reviews the release commit and `CHANGELOG.md`.
- Creates and pushes the release tag (`git tag -a v<ver> -m "v<ver>" && git push origin v<ver>`), which triggers `.github/workflows/release.yml`.
- Watches the release run. The workflow publishes the release once every platform, `SHA256SUMS` and the security audit have passed (set the repository variable `RELEASE_KEEP_DRAFT=true` to review drafts by hand instead).
