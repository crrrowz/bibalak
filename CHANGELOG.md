# Changelog

All notable changes to Bibalak are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

Bibalak is derived from Synapse (MIT, see `THIRD_PARTY_NOTICES.md`); entries
up to 0.1.0-beta.3 are Synapse's history.

## [Unreleased]

## [1.0.0] - 2026-11-26

### Added

- **Identity & i18n:** Bibalak name, logo, app icons, warm "Study Lamp" design
  (terracotta, Figtree), open-source AGPL-3.0-or-later license with the Synapse MIT notice kept,
  and full Arabic RTL interface with IBM Plex Sans Arabic
- **Shell & Settings:** two-column categorized Settings screen with keyboard
  navigation and OS-aware shortcut labels (`Ctrl+K` / `⌘K`) (`U7`); sidebar
  icon footer with language, theme, and app-wide sound volume popover (`U8`);
  build SHA and date stamp in Settings → Updates (`Z2`)
- **Media & Import:** Media Library filter bar (name, deck, tag, kind, usage),
  sorting, and preview panel (`M0`) with custom audio player (`U8`); one-time
  copy of data from the pre-rename app folder (`com.synapse.app`), made
  two-phase and resumable (`H1`)
- **AI assistant:** Assistant hub (`/assistant`) with OpenAI-compatible and
  local Ollama setup, OS keychain API key storage, plain-text consent preview,
  and session-only "don't ask again" (`AI0`); Generate cards from pasted text
  (`/assistant/generate`) with Basic/Cloze drafts and batch add (`AI1`); Study
  Tutor panel (`T`) with Explain, Example, Mnemonic, Translate, Why was I
  wrong?, and Save to field (`AI2`); Deck quality review (`/assistant/quality`)
  with atomic rewrites, tags, and Cloze splits (`AI3`); Study coach on Stats
  and Assistant hub with metrics-only preview and 7-day plan (`AI4`)
- **Progress & presentation styles:** Schema v9 (`progress_ledger`) and pure
  progress engine awarding XP, levels, and gold for card reviews with undo-safe
  sync ledger support (`R1`); presentation style switcher (`Default` and
  `Scholar`), `ProgressPanel` on Home and Stats, and custom SVG icons (`P1`);
  Scholar academic titles, promotion certificates, `/transcript` page, and
  30-day Lecture log (`P2`)
- **Plan (Matrix, Habits, Calendar):** Schema v10 productivity tables
  (`task_lists`, `tasks`, `matrix_quadrants`, `habits`, `habit_logs`,
  `calendar_events`), core use-cases, undo, and sync (`M1`); Plan sidebar group
  and Eisenhower Matrix screen (`/plan/matrix`) with rule editor, task lists,
  quick add, drag-and-drop, and due-deck cards (`M2`); Habit tracker screen
  (`/plan/habits`) with 7-day ring strip, sections, frequencies, yes/no and
  amount goals, and mood/reflection logs (`M3`); local Calendar screen
  (`/plan/calendar`) with Week, Month, and Agenda views, recurring events,
  scheduled/due tasks, habit windows, clickable study forecast badges, and
  unscheduled tasks panel (`CAL1`, `BW1`); task/habit rewards, deck-linked
  review habits, and dismissible Yesterday summary card (`R3`)
- **Sync foundation:** Schema v7 (`sync_state`) and v8 (`grave_times`), write-path
  sync markers (`S1a`), deterministic LWW merge engine (`S1b`), and pre-merge
  backups (`S1c`)
- **Release, CI & Testing:** signed update manifests and in-app Tauri updater
  gated by `DOWNLOAD_SITE` (`C1`), macOS CI job (`Q1`), automated third-party
  licence check and `THIRD_PARTY_NOTICES.md` generator (`C2`), Settings screen
  tests (`Q2`), and mocked browser preview (`preview.html`)
- **Game style & quick controls:** opt-in Game presentation style (RPG HUD,
  character, achievements, quests, streaks), sidebar footer `StylePopover` and
  dual-channel `VolumePopover` (`16i`), shared sticky `EditorToolbar` across
  Add, Browse, and Quick Add (`16j`), and `StartupErrorScreen` with automatic
  pre-migration `.pre-v<N>.sqlite` backups (`ARCH1`)

### Changed

- **Browse & Assistant:** grouped Browse bulk action bar with keyboard-accessible
  `ActionMenu` (`U6`); simplified Assistant hub moving provider setup into
  Settings → AI assistant with `Assistant › tool` breadcrumbs (`U8`); split
  `browse.rs` and `notetype.rs` into submodules (`Q3`)
- **Database & Sync:** cosmetic notetype edits no longer force a full sync,
  bury/unbury mark cards dirty, and `bibalak-db` uses the injected collection
  clock instead of reading the system clock (`S1b`)
- **Architecture & Performance:** moved `answer_card` orchestration and
  `SchedulerSet` port into `bibalak-core` (`ARCH2`), split `Storage` into 10
  role traits with a shared `SqliteStorage`/`FakeStorage` contract test suite
  (`ARCH5`, `ARCH6`), centralized hierarchical `queryKeys` and typed
  `CoreEventName` (`ARCH7`), moved IPC commands off the main thread via
  `async` + `spawn_blocking` (`ARCH3`), split JS routes and vendor chunks
  (`H3`), and organized frontend screens under `features/<area>/` (`ARCH11`)

### Security

- Card templates from imported decks run in a sandboxed iframe with no access
  to the app, its IPC bridge, or storage (`ADR-004`, verified in the webview),
  with `'unsafe-eval'` removed from CSP (`H1`, `ADR-029`)
- Content-Security-Policy for the webview; plugins and cards cannot reach the
  network
- Plugin capabilities enforced on the host; plugin manifests cannot escape
  their folder
- Backup/restore paths restricted to user-picked paths and the app backup
  directory (`paths_guard`), IPC inputs validated across commands, and Tauri
  command capability allowlists enforced in `build.rs` and `capabilities/` (`H1`)
- Dependencies with critical/high advisories updated; CI fails on new ones

### Fixed

- **Study & Decks:** cap subdeck new/review limits by ancestor limits, exclude
  carry-over learning cards from today's new quota, and limit the 60 s learning
  deferral to the last answered card (`Q7`); synthesize missing parent decks on
  `.apkg` import and integrity check and compute deck tree depth from parent
  links (`U7`)
- **Tags & Note Types:** register tags on note add/update/rename (`Q5`), refresh
  the sidebar tag list immediately on note/schema changes (`Q6`), backfill tags
  from `.apkg` imports and integrity checks (`Q8`), and validate field reorder
  permutations (`Q5`); record undo on note edits (`AI2`)
- **AI & Progress:** forward app locale to AI prompts (`AI1`), verify undo status
  and allow quality fixes on filtered-deck notes (`AI4`), share one 30-day
  retention and day-index helper (`Z1b`), and make `complete_task` a no-op when
  already completed (`Z2`)
- **Matrix, Habits & Calendar:** disable native `dragDropEnabled` on the main
  window so HTML5 drag works in Matrix and Calendar, add `Review` badge and
  menu to deck-due cards, and show grab cursor on open tasks (`Z3`); drop child
  decks in Matrix when an ancestor is in the same quadrant (`Z2`); improve
  Calendar Week view readability and defer the unscheduled panel beside the grid
  to `2xl` (`Z2`); fix Arabic fraction order with `من` (`Z2`)
- **UI, Media & Settings:** fix review-button WCAG AA contrast and plugin
  manager lock handling; catch plugin toggle errors (`Q2`); show Maintenance
  errors as alerts instead of result rows (`Q4`); log and display Stats error
  details (`Q9`); portal the sidebar volume popover above all screens (`H1`);
  fix Media `All` tab missing audio on first visit (`H1`); disable media
  cleanup while legacy migration is pending and clean `.keepsake-partial` files
  recursively using temp-then-rename (`Z1b`, `Z2`); fix RTL breadcrumb chevron,
  radiogroup arrow keys, and lecture-log formatting (`Z1a`)
- **Media, Retention, Safety & UX:** detect unquoted `src`, `<audio|video|source>`,
  and CSS `url(...)` media refs with NFC/OS-case matching, escape media browse
  queries, and display `"—"` when retention has zero reviews (`16k`); bump
  colliding same-ms `revlog.id` and fix `fuzz_days` `[0, 1)` range (`ARCH2`);
  recover poisoned mutexes and surface `Collection::new` errors (`ARCH4`); fix
  RTL `ScreenHeader` overlap, 700 px toolbars, Arabic achievement wrapping,
  Calendar block ellipsis, `CommandPaletteTip` placement, Scholar excused
  tooltip, Arabic Quests heading, and duplicate `/streak` heading (`H4`)

## [0.1.0-beta.3] - 2026-07-04

Diff: [beta.2...beta.3](https://github.com/Emadab/Synapse/compare/v0.1.0-beta.2...v0.1.0-beta.3)

### Added

- Statistics dashboard rebuild: filters, retention trend, FSRS memory-model panels, review heatmap, 30-day forecast
- Full Anki-compatible template engine (conditional sections, filters, cloze) with a modern card design and rich note editor
- Study focus mode — `F` to enter, `Esc` to exit — with a session progress bar and distraction-free HUD
- Customizable home screen: list / grid / hero layouts for the deck browser, with a "due today" hero strip (streak, activity heatmap, 7-day sparkline)
- Sleeker, glassy application shell — consolidated title bar / header chrome into two slim layers, cooler accent palette
- Configurable day-rollover hour for new-card limits
- "Increase today's new limit" control and a revamped deck picker
- Async .apkg/.colpkg import with live progress and bulk-preload merge

### Changed

- Decks and Study merged into a single page; subdeck counts now roll up into their parents

### Fixed

- Stats queries moved off the main thread (previously could freeze the UI while computing)
- Startup backup/index/plugin work moved off the main thread
- Deck options number fields can now be cleared while typing instead of snapping back
- Browse screen's select-all checkbox now shows an indeterminate state correctly
- Stale new-card counts after a day rollover
- Study keyboard shortcuts (`s`/`b`/`r`) no longer fire while typing into the type-answer field

## [0.1.0-beta.2] - 2026-07-01

### Fixed

- Patched a transitive RCE advisory in the e2e devDependency chain (`serialize-javascript`)
- Release and e2e CI workflow fixes

## [0.1.0-beta.1] - 2026-06-24

### Added

- M21: Plugin runtime — sandboxed Worker-based JS plugins with capability enforcement
- M20: FSRS weight optimizer — Adam gradient descent on review history, per-deck or full-collection scope
- M19: Backups, integrity check, DB optimize, media consistency scan, panic hook, auto-backup on startup
- M18: KaTeX LaTeX rendering, audio autoplay + replay (R key), dark-mode image inversion, cloze CSS
- M17: Tag manager (rename/delete/merge), filtered decks (custom study)
- M16: Advanced browser search, bulk operations, card-level browser table
- M15: Suspend/bury/flags, leech detection, sibling bury
- M14: Full deck options (algorithm, steps, FSRS weights, retention)
- M13: Note-type and template editor with live preview
- M12: Add Note UI, card generation, template rendering
- Full FSRS-5 and SM-2 schedulers, switchable per deck
- Bidirectional .apkg/.colpkg import/export (Anki schema v11/v18)
- Statistics dashboards
