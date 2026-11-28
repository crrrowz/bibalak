# Bibalak — System Architecture

> A calm, modern spaced-repetition desktop app, **fully bidirectionally
> compatible with Anki**, in English and Arabic. Tauri + React/TS frontend over
> a UI-agnostic Rust core.

## Why this shape

Millions rely on Anki but dislike its dated UI, clumsy browser and weak
editing/search. The opportunity is **not** a prettier clone and **not** a new
SRS algorithm — it is to wrap Anki's proven scheduling data model in a
Linear/Obsidian-grade experience while guaranteeing lossless interop.

Three load-bearing decisions let a team build this for years without a rewrite:

1. A **canonical, normalized internal schema** that is a _superset_ of Anki's,
   with import/export adapters — we are never bound to Anki's on-disk format.
2. A **platform-agnostic Rust core** (`bibalak-core`) with zero Tauri/React
   deps, so the same engine powers desktop today and mobile/CLI later.
3. **Clean-architecture dependency rules** enforced at the crate boundary.

### Locked decisions

- **Anki compatibility:** support **both** legacy schema **v11** (decks/models/
  conf as JSON blobs in `col`) and modern **v18** (table-based), detected on
  read. Export to **.apkg v2 (zlib)**, **.apkg v3 / .colpkg (zstd)**. Full
  fidelity for tags, deck hierarchy, templates, HTML/CSS/JS, media, review
  history, learning state and FSRS memory state.
- **Sync:** architected, not implemented in MVP. The `SyncProvider` trait plus
  local change tracking (`usn`/`mod`/`graves`) keep the collection sync-ready.
- **Scheduling:** **SM-2 and FSRS both ship**, switchable per deck, behind one
  `Scheduler` trait.

## 1. Monorepo & folder structure

Cargo workspace (Rust) + pnpm workspace (TS) in one repo. The Tauri shell is a
thin adapter; all logic lives in reusable crates.

```text
crates/        bibalak-{core,db,scheduler,ankifmt,search,media,render,plugin,ai}
apps/desktop/  src-tauri/ (Rust shell)  +  src/ (React frontend)
packages/      ipc-types (generated), ui-tokens, plugin-sdk
fixtures/      small synthetic .apkg/.colpkg decks + golden scheduler vectors
docs/          this file + ADRs
```

Features are vertical slices (study, browser, editor, assistant, matrix, habits,
calendar, progress…), every Rust module is a small single-responsibility crate,
and Tauri appears only in `apps/desktop`.

## 2. Module boundaries (clean architecture)

Four rings; **dependencies point inward only**, enforced by the crate graph.
`bibalak-core` defines _ports_ (traits) and depends on none of the impls:

- `Storage` → `bibalak-db` (SQLite)
- `MediaStore` → `bibalak-media`
- `Scheduler` → `bibalak-scheduler` (SM-2, FSRS-6)
- `AIProvider` → `bibalak-ai` (OpenAI-compatible / Ollama HTTP + OS keychain)
- `SyncProvider` → local delta export & merge engine implemented (`ADR-014`); remote transport planned for Stage 2
- `Clock` → injectable time (real at runtime, fixed in tests)

The application aggregate [`Collection`](../../crates/bibalak-core/src/collection.rs)
exposes use cases structured by domain module under `crates/bibalak-core/src/collection/`
(`study`, `decks`, `notes`, `notetypes`, `browse`, `import_export`, `maintenance`,
`media`, `stats`, `productivity`, `sync`) behind a unified public API, with
pure domain logic in `progress.rs`, `productivity.rs`, and `ai/`, and in-memory
test fakes in `fake_storage` and `testkit`. (Note: the Tauri shell still holds
some answer-card orchestration in `commands/study.rs`, planned to move into `Collection`.)

**Hard rule:** `bibalak-core`, `bibalak-scheduler`, `bibalak-render` have no
dependency on Tauri, rusqlite or any UI. That is what makes mobile/CLI/web server
reuse clean (§13).

## 3. Database schema

Bibalak stores a **canonical, normalized (v18-style) schema** as the source of
truth (currently schema **v15** — see
[`adr/README.md`](adr/README.md#schema-version-rule) for shipped migrations);
import/export adapters translate to/from Anki v11 (JSON-blob) and v18 (tabular).
v11 (JSON-blob) and v18 (tabular). The schema is a _superset_, so nothing is
lost on round-trip: Anki-specific scheduling fields are preserved verbatim, and
Bibalak-only fields live in JSON `data` columns Anki ignores. SQLite, WAL mode;
`bibalak-db` owns all SQL + a versioned migration runner.

Core Anki-compatible tables: `collection` (singleton: crt/mod/scm/usn + global
config JSON), `deck_config`, `decks` (full `name`, denormalized `parent_id`,
`config_id`), `notetypes` + `fields` + `templates`, `notes` (guid, notetype_id,
tags, fields, sort_field, checksum), `cards` (type/queue/due/ivl/factor/reps/
lapses/left + `fsrs_stability`/`fsrs_difficulty` + verbatim `data` JSON), `revlog`
(full review history), `tags`, `graves` (deletion tombstones), `media`
(filesystem is the store; table indexes checksums for dedup/cleanup).

Local sync, progress, and productivity tables (never exported to `.apkg`):

- `sync_state` (v7) and `grave_times` (v8, `ADR-014`): sync cursor state and
  deletion timestamps.
- `progress_ledger` (v9, `ADR-019`): idempotent, undo-safe reward ledger for
  card reviews (`card_review:<id>:<day>`), tasks (`task_done:<id>`), and habits
  (`habit_log:<id>:<day>`), keyed with UUIDs and `user_id` (`NIL_USER_ID` in
  Stage 1).
- `task_lists`, `tasks`, `matrix_quadrants`, `habits`, `habit_logs`,
  `calendar_events` (v10, `ADR-018`): account-ready UUID tables with `user_id`,
  `updated_at`, `usn`, and soft delete (`deleted_at`).

Fidelity & sync-readiness: every mutable row carries `usn` + `mod`; deletions
write a `graves` row — the entire substrate sync needs. FSRS state is stored
both as typed columns (fast queries) and preserved in `cards.data` for byte-
faithful v18 round-trip. Full-text search is a separate in-memory SQLite FTS5
index (`bibalak-search`), rebuilt from domain events; the on-disk database stays
the source of truth.

## 4. Review engine (`bibalak-scheduler`)

A **pure** crate: deterministic functions over plain data + an injected `Clock`,
no IO. The application layer loads cards, hands them to the scheduler, persists
results.

```rust
pub trait Scheduler {
    fn build_queue(&self, ctx: &SchedContext) -> Queue;
    fn answer_buttons(&self, card: &Card, ctx: &SchedContext) -> [Interval; 4];
    fn answer(&self, card: &Card, rating: Rating, ctx: &SchedContext) -> AnswerOutcome;
    fn algorithm(&self) -> Algorithm; // Sm2 | Fsrs
}
```

`Sm2Scheduler` is Anki-faithful (learning/review/relearn queues, steps, ease,
fuzz, leeches, day cutoff via `Clock`). `FsrsScheduler` computes stability/
difficulty from 19 per-deck weights + desired retention. Selection is per-deck
config; switching is a config write + queue rebuild (both states always
persist). Validated by golden vectors generated from Anki (§12).

## 5. Import / export (`bibalak-ankifmt`)

Pipeline, transactional (all-or-nothing staging txn):

```
unzip → detect container (.apkg/.colpkg) → detect schema (col.ver: v11|v18)
      → SchemaReader (V11Reader JSON-blob | V18Reader tables) → CanonicalModel
      → MergeStrategy (match notes by guid, notetypes by signature, decks by name)
      → staging txn → commit ;  media deduped by checksum, refs rewritten
```

Export reverses it: `V2Writer` (zlib `collection.anki2`), `V3Writer` (zstd
`.anki21b` + protobuf meta), `.colpkg` (whole collection + media). Round-trip
(import → export → re-import = no-op diff) is a test gate.

## 6. Event system (`bibalak-core::events`)

A typed domain event bus. Core mutations emit `DomainEvent`s _after_ commit;
subscribers include the search-index updater, stats invalidator, plugin host,
and a Tauri bridge that re-emits to the webview. The frontend maps events →
TanStack Query cache invalidation (live UI, no polling). Undo/redo uses a
separate command + inverse log in the application layer.

## 7. Plugin API (`bibalak-plugin` + `packages/plugin-sdk`)

Manifest + capability model (`read:notes`, `write:cards`, `ui:panel`,
`net:fetch`, …); the host grants only what is declared. Two surfaces: UI plugins
in a sandboxed worker/iframe (`registerCommand`, `addSidebarPanel`,
`addReviewButton`, `registerCardRenderer`, `onEvent`), and core hooks in a
sandboxed JS/Wasm runtime reacting to events. `@bibalak/plugin` types are the
stable public contract. Plugins run today in Web Workers (ADR-003): the host
checks every message against the manifest's capabilities, and manifests cannot
reference files outside the plugin folder.

## 7a. Untrusted card content (ADR-004)

Card templates come from shared decks and may contain scripts. `CardFace`
renders each face in an `<iframe sandbox="allow-scripts">` (opaque origin, no
IPC, no storage, no network via CSP); the app prepares the HTML on an inert
`DOMParser` document and talks to the frame only through validated
`postMessage`s. The webview CSP lives in `tauri.conf.json`.

## 7b. Localisation

`src/lib/i18n.ts` holds the locale store (persisted, mirrored to
`<html lang dir>`), `t()` / `tn()` (CLDR plurals via `Intl.PluralRules`) and
`Intl` number/date formatting. Strings live in `src/locales/{en,ar}.ts`; layout
uses logical CSS properties so Arabic mirrors without separate styles. Guard
tests reject hard-coded UI text and physical left/right classes.

## 8. State management

Rust core is the single source of truth; the frontend caches.

- **TanStack Query** = all server state (queues, cards, decks, stats, search,
  progress, matrix, habits, calendar). Keys are centered in `lib/queryKeys.ts`;
  mutations rely on event-driven invalidation (`DomainEvent`).
- **Zustand** = ephemeral client state and local preferences (`ui`, `theme`,
  `style`, `sound`, `toast`, `aiSession`).
- **Command layer** (`lib/ipc.ts`) = a typed wrapper over Tauri `invoke` (via
  `lib/platform/` — `desktop.ts`, `index.ts`, `types.ts`); the UI never calls
  `invoke` directly.
- **Type safety**: Rust structs derive `ts-rs` → `packages/ipc-types`; a Rust
  schema change breaks the TS build.

## 9. UI component hierarchy

`AppShell` (TitleBar, collapsible Sidebar with study nav, `Plan` group, and
icon footer, CommandPalette ⌘K, `<Outlet/>`) renders the route tree.
Tiers: shadcn primitives (`components/ui`) → shared composites (`components`) →
feature slices (`features/*` for `matrix`, `habits`, `calendar`, `progress`,
`ai`, `browse`, `study`, `media`) → route screens (`routes`). Presentation
styles (`data-style="default" | "scholar"` on `<html>`) override surface,
heading font, and radius tokens in `globals.css` (`DESIGN.md §8`); `Game` style
is planned. Tokens live in `packages/ui-tokens`; Framer Motion is interruptible
and respects `prefers-reduced-motion`; accessibility primitives use Radix.

Chrome is two layers: the 36px `TitleBar` (window drag + controls, sidebar
dock button, ⌘K trigger) and a slim sticky per-route `ScreenHeader` (title +
inline `description`, single `h-12` row — hidden below `md`, so keep
descriptions compact). Translucent chrome and floating panels (palette,
dialogs, popovers, study HUD) use the `.glass-chrome` / `.glass-panel`
utilities in `globals.css`.

## 10. Routing

TanStack Router (type-safe, pairs with TanStack Query, typed search params for
browser and stats filters). Routes: `/`, `/study/$deckId`, `/browse`, `/add`,
`/quick-add`, `/notetypes`, `/media`, `/stats`, `/transcript`, `/assistant`,
`/assistant/generate`, `/assistant/quality`, `/plan/matrix`, `/plan/habits`,
`/plan/calendar`, `/settings`.

## 11. Error handling

Rust: one `thiserror` enum per crate composing into `CoreError`; the IPC
boundary maps it to a typed serialisable error union. No `unwrap()` in library
code. Frontend: typed `Result` from the IPC client, per-route ErrorBoundary, and
toasts for recoverable errors. Today there is a daily background zip backup on
startup (if the newest backup is over 24 h old), with pre-migration safety copy
and newer-schema recovery screen. Observability via `tracing` → rolling log.

## 12. Testing strategy

| Layer          | Tool                                 | What                                                                                |
| -------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| Scheduler      | Rust unit + golden vectors           | SM-2/FSRS vs Anki-generated vectors; deterministic via injected `Clock` + fixed RNG |
| Import/export  | Rust integration                     | Real fixtures; round-trip no-op diff; media remap                                   |
| Core use-cases | Rust integration                     | In-memory SQLite; events, undo/redo, rollback                                       |
| Render         | Rust unit                            | Cloze, nested fields, conditionals, LaTeX                                           |
| Component      | Vitest + Testing Library             | UI with mocked IPC                                                                  |
| E2E            | WebdriverIO + tauri-driver           | Smoke run of the built app (Linux CI)                                               |
| Guards         | Vitest                               | CSP, WCAG contrast of theme tokens, no raw UI text, no left/right classes           |
| Lint/format    | ESLint + Prettier + clippy + rustfmt | CI gate                                                                             |

## 13. Future web and mobile compatibility

`bibalak-core` and the other logic crates are platform-agnostic Rust (zero UI
deps) and compile for server, iOS, and Android targets unchanged.

Under the every-platform rule, domain rules and decisions live in
`bibalak-core` (pure Rust), host features (notifications, files, tray, global
shortcuts, updater) are interfaces in `lib/platform/types.ts` with one adapter
per host (`desktop.ts`, `index.ts`, `types.ts`) and `null` where a host lacks
that capability, and nothing assumes Windows (paths, APIs, keys or fonts).

- **Web build (planned, `W1`):** the React UI talks through `lib/platform/`
  and `lib/ipc.ts` so a future web build can swap the Tauri adapter for HTTP
  calls to the Bibalak API server (Stage 2). Not built yet.
- **Mobile (planned):** Tauri v2 mobile reuses the same core and command layer,
  or the core can be wrapped via UniFFI for a native UI. A CLI reusing the core
  doubles as a scripting/test harness.

## Roadmap

The original Synapse milestones (M0–M21) are complete; see `CHANGELOG.md`.
Stage 1 Cycle 1 (core app, AI assistant, sync foundation, progress engine,
Scholar style, polish, and local Matrix/Habits/Calendar) is merged on `main`.
Remaining work — Plan screens redesign, Game style (Cycle 2), Stage 2 online
service (accounts, sync transport, external calendars, planned web build `W1`),
and Stage 3 launch — is tracked on GitHub Issues and Milestones.
