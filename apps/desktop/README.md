# Bibalak desktop app

Tauri 2 shell (`src-tauri/`, Rust) and React 19 frontend (`src/`). The domain
logic lives in the workspace crates under `../../crates`; this package only
adapts it to the desktop.

## Commands

Run from the repo root (use `npx pnpm@11.5.0 <cmd>` on Windows if `corepack` /
`pnpm` is not on your PATH):

```sh
pnpm dev            # Tauri desktop window with hot reload
pnpm dev:web        # Vite only (no Tauri); open http://localhost:1420/preview.html
pnpm build          # TypeScript check (tsc --noEmit) + Vite production bundle
pnpm build:app      # Full Tauri desktop installer/binary build
pnpm bindings       # Regenerate TypeScript IPC types from Rust (cargo test -p bibalak-core)
pnpm test:ts        # Run Vitest unit/component/guard tests
pnpm lint:ts        # Run ESLint across TypeScript files
pnpm fmt:check      # Check Prettier and rustfmt formatting
```

Package-local scripts in `apps/desktop/package.json`:

| Script       | Command                                        | Purpose                            |
| ------------ | ---------------------------------------------- | ---------------------------------- |
| `dev`        | `vite`                                         | Start browser preview server       |
| `build`      | `tsc --noEmit && vite build`                   | Type-check and build frontend      |
| `preview`    | `vite preview`                                 | Serve built frontend bundle        |
| `tauri`      | `tauri`                                        | Tauri CLI wrapper                  |
| `test`       | `vitest run`                                   | Run frontend tests once            |
| `test:watch` | `vitest`                                       | Run frontend tests in watch mode   |
| `lint`       | `eslint .`                                     | Lint frontend files                |
| `e2e`        | `pnpm --prefix test-e2e wdio run wdio.conf.ts` | WebdriverIO smoke suite (Linux CI) |

## Preview page

`http://localhost:1420/preview.html` (served by `pnpm dev:web`) runs the real UI
against fake IPC data (`src/dev/previewMocks.ts` and `src/dev/mocks/`) via
`@tauri-apps/api/mocks`. It is never imported by `main.tsx` and is not part of
the production build.

Useful query parameters on `preview.html`:

- `?probe` — injects a card script to verify `CardFace` iframe isolation.
- `?progress=scholar` (or `?level=5`) — switches mock progress data to Level 5
  for Scholar Transcript previews.
- `?legacy=pending` — simulates an in-progress background legacy migration.

## Portable mode

When a file named `portable.txt` sits next to `Bibalak.exe` (Windows),
`data_dir::data_dir` stores the entire user directory (`collection.sqlite`,
`collection.media/`, `backups/`, `plugins/`, and app preferences) inside a `data/`
folder beside the executable instead of `%APPDATA%\com.bibalak.desktop`. See
[Install, build and portable use](../../docs/guides/install.md) and
[ADR-006](../../docs/architecture/adr/006-portable-mode.md).

## IPC types

TypeScript IPC types live in `@bibalak/ipc-types` (`../../packages/ipc-types`).
They are generated from Rust structs marked `#[derive(TS)]` via `ts-rs` when you
run `pnpm bindings` (`cargo test -p bibalak-core`). The frontend calls commands
only through typed wrappers in `src/lib/ipc.ts`.

## Layout

| Path                      | What                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/app`                 | Shell (`AppShell`), router, providers                                                                          |
| `src/routes`              | Top-level route screens (Decks, Study, Browse, Add, Note Types, Media, Stats, Assistant, Transcript, Settings) |
| `src/features`            | Feature modules (`matrix`, `habits`, `calendar`, `progress`, `ai`, `browse`, `study`, `media`)                 |
| `src/components`          | Shared components (`ui/` = shadcn primitives, `icons/`, `decks/`, `stats/`, `settings/`)                       |
| `src/stores`              | Zustand client state (`ui`, `theme`, `style`, `sound`, `toast`, `aiSession`)                                   |
| `src/lib`                 | IPC wrapper (`ipc.ts`), i18n (`i18n.ts`), card frame (`cardFrame.ts`), plugin host, releases                   |
| `src/locales`             | `en.ts` (source strings) and `ar.ts` (Arabic)                                                                  |
| `src/styles`              | Theme tokens (`globals.css`, Default and Scholar styles) and card base CSS                                     |
| `src/dev`                 | `preview.html` mocks (`previewMocks.ts`, `mocks/*`)                                                            |
| `src/test`                | Guards: CSP, theme contrast, i18n/RTL                                                                          |
| `src-tauri/src/commands`  | Tauri IPC commands, one file per feature                                                                       |
| `src-tauri/src/legacy.rs` | Two-phase resumable copy of data from the pre-rename app folder (`com.synapse.app`)                            |

## Rules of thumb

- Text through `t()` / `tn()`; logical layout classes only (see
  `../../CONTRIBUTING.md`).
- Card HTML only inside `CardFace` (sandboxed iframe, ADR-004).
- Design tokens and component rules: `DESIGN.md`; product brief: `PRODUCT.md`.
