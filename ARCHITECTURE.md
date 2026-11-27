[العربية](ARCHITECTURE.ar.md) · **English**

# Bibalak Architecture (Public Overview)

This document summarizes how Bibalak is structured. For the full technical reference and decision history, see [`docs/architecture/overview.md`](docs/architecture/overview.md) and [`docs/architecture/adr/README.md`](docs/architecture/adr/README.md).

## 1. Clean-architecture layers

Dependencies point inward only, enforced by the Cargo workspace graph ([ADR-001](docs/architecture/adr/001-clean-architecture.md)):

```text
crates/bibalak-core       Domain types, ports (traits), Collection use cases (pure Rust; no IO/UI/Tauri)
        ▲
        │ implements ports
crates/bibalak-db         SQLite storage, migrations, sync delta merge (ADR-014)
crates/bibalak-scheduler  Pure SM-2 and FSRS-6 schedulers (ADR-002)
crates/bibalak-ankifmt    .apkg (v2/v3) & .colpkg (v11/v18) import/export
crates/bibalak-search     In-memory FTS5 search + Arabic normalization (ADR-009)
crates/bibalak-media      Content-addressed/checksum media deduplication (ADR-010)
crates/bibalak-render     Card template, Cloze, and KaTeX rendering
crates/bibalak-plugin     Capability model for plugins (ADR-003)
crates/bibalak-ai         OpenAI-compatible / Ollama HTTP adapter + OS keyring (ADR-013)
        ▲
        │ adapts to host
apps/desktop/src-tauri     Tauri 2 shell: implements host wiring & IPC commands
        ▲
        │ typed IPC + DomainEvent stream
apps/desktop/src           React 19 + TypeScript UI (TanStack Router/Query, Zustand, Tailwind)
```

Shared TypeScript packages live under `packages/`:

- `packages/ipc-types` — TypeScript types generated from Rust structs (`#[derive(TS)]` via `ts-rs`, updated with `pnpm bindings`).
- `packages/ui-tokens` — canonical design tokens shared by Tailwind and charts.
- `packages/plugin-sdk` — public MIT-licensed plugin contract (`@bibalak/plugin-sdk`).

## 2. IPC & state synchronization

- **Backend as source of truth:** All persistence, scheduling, and domain validation happen in Rust. Tauri commands in `apps/desktop/src-tauri/src/commands/` validate inputs, run blocking work off the main thread, and delegate to `Collection` or pure core helpers.
- **Frontend calls:** Screens call backend commands only through typed wrappers in `apps/desktop/src/lib/ipc.ts` and never invoke Tauri directly.
- **Live updates:** Core mutations emit typed `DomainEvent`s after commit, which Tauri forwards to the webview to invalidate hierarchical TanStack Query keys (`src/lib/queryKeys.ts`).

## 3. Security boundaries

- **Sandboxed card HTML (`CardFace`, [ADR-004](docs/architecture/adr/004-sandboxed-card-frame.md)):** Shared Anki decks can contain arbitrary HTML, CSS, and scripts. `CardFace` renders every card face inside `<iframe sandbox="allow-scripts">` with an opaque origin — no access to the app DOM, Tauri IPC, storage, or network. Communication goes through validated `postMessage` payloads only.
- **Plugin Worker sandbox ([ADR-003](docs/architecture/adr/003-plugin-worker-sandbox.md)):** Plugins run in Web Workers with host-enforced capability checks and manifest path containment.
- **Webview CSP & IPC hardening ([ADR-029](docs/architecture/adr/029-ipc-security-hardening.md)):** Tightened CSP (`apps/desktop/src-tauri/tauri.conf.json`, tested by `src/test/tauriCsp.test.ts`), per-window capabilities, Rust-mediated file dialogs, and path-restricted backup/restore (`paths_guard`).
- **AI privacy ([ADR-013](docs/architecture/adr/013-ai-assistant.md)):** AI features are off by default; API keys stay in the OS keychain and every outbound call shows a plain-text consent preview.

## 4. Data & portable mode ([ADR-006](docs/architecture/adr/006-portable-mode.md))

- **Standard install:** Stores `collection.sqlite`, `collection.media/`, `backups/`, and `plugins/` in the OS application data directory (`com.bibalak.desktop` resolved via `data_dir::data_dir`).
- **Portable mode (Windows):** Placing an empty `portable.txt` file beside `Bibalak.exe` redirects `data_dir` to `./data/` next to the executable so nothing is written to `%APPDATA%`.
- **Automatic backups:** Daily startup backups plus automatic pre-migration `.pre-v<N>.sqlite` snapshots before schema upgrades.

## 5. Every-platform rule

Bibalak targets Windows, macOS, and Linux today and keeps the core ready for future web and mobile shells:

- Domain rules live in pure Rust (`bibalak-core`, `-scheduler`, `-render`) with no OS-specific APIs or UI dependencies.
- All host capabilities (window controls, global shortcuts, file dialogs, notifications, updater) sit behind interfaces in `apps/desktop/src/lib/platform/types.ts` with one host adapter (`desktop.ts`) and `null` fallbacks where a host lacks a capability (guarded by `src/test/platformGuard.test.ts`).
- Build, check, and release tooling uses Node.js and cross-platform scripts rather than assuming one OS.

## Key ADRs

- [ADR-001: Clean architecture](docs/architecture/adr/001-clean-architecture.md)
- [ADR-002: Dual scheduler (SM-2 & FSRS-6)](docs/architecture/adr/002-dual-scheduler.md)
- [ADR-003: Plugin worker sandbox](docs/architecture/adr/003-plugin-worker-sandbox.md)
- [ADR-004: Sandboxed card frame (`CardFace`)](docs/architecture/adr/004-sandboxed-card-frame.md)
- [ADR-006: Portable mode](docs/architecture/adr/006-portable-mode.md)
- [ADR-014: Sync journal & merge engine](docs/architecture/adr/014-sync-journal.md)
- [ADR-021: In-app updates](docs/architecture/adr/021-in-app-updates.md)
- [ADR-022: Open-source model](docs/architecture/adr/022-open-source-model.md)
- [ADR-028: Reminders core plan](docs/architecture/adr/028-reminders-core-plan.md)
- [ADR-029: IPC security hardening](docs/architecture/adr/029-ipc-security-hardening.md)
