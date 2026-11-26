# Contributing to Bibalak

_Adapted from [Open Source Guides — How to Contribute](https://opensource.guide/how-to-contribute/) (CC-BY-4.0) and [Conventional Commits v1.0.0](https://www.conventionalcommits.org/) (CC-BY-3.0)._

Welcome! Contributions of bug fixes, tests, accessibility improvements, documentation, and English/Arabic localization are all appreciated. Before starting significant work, please read our [Code of Conduct](CODE_OF_CONDUCT.md) and the Contributor License Agreement (CLA) requirement below.

## Prerequisites

| Tool      | Version        | Notes                                                      |
| --------- | -------------- | ---------------------------------------------------------- |
| Rust      | stable (1.89+) | Install via `rustup`; on Windows select the MSVC toolchain |
| Node.js   | 22 or newer    |                                                            |
| pnpm      | 11             | `corepack enable`, or `npx pnpm@11.5.0 <cmd>`              |
| Tauri CLI | v2             | Installed via workspace dependencies (`pnpm dev`)          |

Platform-specific system libraries (Visual Studio Build Tools on Windows, Xcode Command Line Tools on macOS, WebKitGTK/GTK packages on Linux) are listed in [`docs/guides/install.md`](docs/guides/install.md).

## Setup

```sh
git clone https://github.com/crrrowz/bibalak
cd bibalak
pnpm install
cargo test -p bibalak-core   # generates TypeScript IPC types
```

Run the app or UI preview:

```sh
pnpm dev        # full Tauri desktop app with hot reload
pnpm dev:web    # React UI only in browser at http://localhost:1420/preview.html
```

## Architecture & Coding Standards

Clean architecture — layers must not import downward (see [`ARCHITECTURE.md`](ARCHITECTURE.md)):

```text
bibalak-core   — ports + domain types (no IO or network dependencies)
   ↓
bibalak-db / bibalak-scheduler / bibalak-ankifmt / bibalak-search /
bibalak-media / bibalak-render / bibalak-plugin / bibalak-ai
   ↓
apps/desktop/src-tauri — Tauri shell (implements ports, exposes IPC)
   ↓
apps/desktop/src       — React 19 + TypeScript frontend
```

Key invariants enforced by automated tests:

- **Sandboxed card HTML:** Card templates are untrusted and render only inside `CardFace` (sandboxed iframe, ADR-004). Never inject card HTML into the main app document.
- **Internationalization (`i18n`):** Every visible UI string must use `t()` / `tn()` from `src/lib/i18n.ts` with keys in both `src/locales/en.ts` and `src/locales/ar.ts`.
- **RTL-safe layout:** Use CSS logical properties (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`, `text-start`) rather than `ml-`, `left-`, or `text-left`. `src/test/i18nGuards.test.ts` checks both rules.
- **Colors & contrast:** Use semantic tokens from `src/styles/globals.css`; `src/test/themeContrast.test.ts` verifies WCAG AA contrast.
- **Error handling:** Never use `unwrap()` or `expect()` in Tauri `commands/*` or import/export paths.
- **Dependency licences:** New dependencies must be compatible with `AGPL-3.0-or-later` (checked against `about.toml`).

## Required Checks

Run these checks locally before opening or updating a pull request (or run `pnpm check`):

```sh
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
git diff --exit-code packages/ipc-types
pnpm lint:ts
pnpm fmt:check
pnpm test:ts
pnpm --filter @bibalak/desktop build
```

Additional commands when applicable:

```sh
pnpm bindings                                      # after changing Rust #[derive(TS)] structs
node scripts/licenses/generate-notices.mjs --write # after changing dependencies
pnpm audit --audit-level=high && cargo audit       # security audit (also run in CI)
```

## Commit Style

Use short, clear [Conventional Commits](https://www.conventionalcommits.org/) messages:

```text
feat: add FSRS weight optimizer command
fix: exclude buried siblings from study queue
test: add golden vector for cloze template render
docs: clarify portable mode data directory
```

## Working with AI Coding Agents

AI coding tools are welcome when used responsibly:

- Point your agent to [`AGENTS.md`](AGENTS.md) (imported automatically by [`CLAUDE.md`](CLAUDE.md)) so it follows all architecture boundaries, test-first steps, and formatting/guard checks.
- Verify every generated change and run the full `pnpm check` suite yourself before opening a pull request — do not submit unreviewed or untested AI output.
- All PRs, including AI-assisted ones, require a signed CLA from the contributor submitting the PR.

## Contributor License Agreement (CLA) & DCO

- **CLA required:** Every pull request requires signing our Individual or Entity CLA via the CLA bot on your first PR (see [`docs/contributing/cla-signing.md`](docs/contributing/cla-signing.md)). We use a CLA rather than DCO alone so Bibalak can stay `AGPL-3.0-or-later` while preserving dual-licensing rights.
- **DCO optional:** You are welcome to include `Signed-off-by` (`git commit -s`), though the PR CLA check remains the binding requirement.

## How to Pick an Issue & Submit a PR

1. Browse open issues labelled **`good first issue`** or **`help wanted`**.
2. Comment on the issue before starting work so maintainers know someone is looking at it.
3. For large features, architecture changes, schema changes, or new dependencies, **open a proposal issue first** to align with maintainers before writing code.
4. Work on a dedicated branch (`fix/...`, `feat/...`, `docs/...`), add tests covering your change, keep PRs focused on one logical change, and complete the pull request checklist.

## Helping with Arabic Translation & RTL

Bibalak treats English and Arabic as first-class languages:

- Translation files live in `apps/desktop/src/locales/en.ts` and `apps/desktop/src/locales/ar.ts`.
- You can inspect and test Arabic UI without building Rust via `pnpm dev:web` (`http://localhost:1420/preview.html`), switching the app language to Arabic in the UI.
- Check both wording (natural Arabic educational/UI phrasing, avoiding literal machine translations) and layout alignment (icons, chevrons, numbers, fractions, and bidirectional text with `dir="auto"` on user content).
- Run `pnpm test:ts` after edits to verify `i18nGuards.test.ts` passes.

## Reporting Bugs or Security Issues

- **Bugs & feature ideas:** Use our issue templates on GitHub and avoid attaching personal decks containing private material or API keys.
- **Security vulnerabilities:** Report privately following [`SECURITY.md`](SECURITY.md) — never in a public issue.

---

## ملخص المساهمة (بالعربية)

مرحباً بك في Bibalak! نرحب بمساهمات إصلاح الأخطاء والاختبارات وإتاحة الوصول والتوثيق ومراجعة اللغة العربية وتخطيط اليمين إلى اليسار (RTL):

- **معاينة الواجهة العربية سريعاً:** شغّل `pnpm dev:web` وافتح `http://localhost:1420/preview.html` دون الحاجة لبناء Rust، ثم بدّل اللغة إلى العربية وراجع النصوص في `apps/desktop/src/locales/ar.ts`.
- **قواعد الواجهة:** كل نص ظاهر يجب أن يمر عبر `t()` أو `tn()`، وجميع هوامش التخطيط يجب أن تستخدم الخصائص المنطقية (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`) لا اليسار واليمين الصريحين.
- **الفحوصات المطلوبة:** شغّل `pnpm check` (أو `pnpm check:no-rust` عند تعديل الواجهة فقط) قبل إرسال طلب الدمج (PR).
- **اتفاقية المساهم (CLA):** يتطلب قبول أي طلب دمج توقيع اتفاقية CLA عبر البوت المخصص تلقائياً عند أول مساهمة ([التفاصيل](docs/contributing/cla-signing.md)).
