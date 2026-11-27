# Changelog

All notable changes to Bibalak are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

Bibalak is derived from Synapse (MIT, see `THIRD_PARTY_NOTICES.md`); entries
up to 0.1.0-beta.3 are Synapse's history.

## [Unreleased]

## [1.1.1] - 2026-11-27

### Added

- **Deck options you can read:** a simple view with three questions (new
  cards a day, most reviews a day, how much you want to remember, with an
  estimate of minutes a day) and an advanced view with sections named by
  what they do. Every setting says what it does and what its value means,
  and each section can go back to its defaults. New decks use FSRS.
- **Undo for more actions:** suspend, bury, flags, moving cards, deck
  options, today's extra limit and adding notes can now be undone.
- **A friendlier first start:** the setup picks Arabic when your computer
  lists Arabic, starts with the Game look, a 10 XP (about 5 minutes) daily
  goal and an empty workspace. The empty Home offers Create a deck, Import
  from Anki and Add a sample deck.

### Changed

- The app's data folder is now `com.bibalak.desktop`. The old folder is
  renamed on the first start, with nothing copied and nothing lost, and the
  saved AI key moves with it.
- The app opens maximized the first time.
- Import results show as a notice you can close, not a strip under the page.

### Fixed

- **Counts:** resetting a card now makes it count as new again; the study
  counter no longer grows when you press Again; New, Learn and Due stay right
  after every action and line up under their headers in English and Arabic.
- Cards waiting a day in learning are counted on the right day.
- Studying in a filtered deck no longer uses up the home deck's daily limits,
  as in Anki.
- Undoing a deck delete brings back its review history and settings too.
- Statistics leave filtered decks out of the deck filter and per-deck totals.
- A deleted app folder no longer brings back data from the old Synapse
  folder.
- Long deck names wrap in the delete dialog, which now says the delete can
  be undone.
- Changing a note type between basic and cloze is refused while it has
  notes, and removing card templates asks first.
- Cancelling an import right at the end no longer leaves extra media files.
- Calendar agenda shows the day's habits; streak and habit views refresh.

## [1.1.0] - 2026-11-27

### Added

- **Export one deck:** every deck menu has **Export deck…**. Choose whether to
  include subdecks, media files and review history, see the size before you
  start, follow a progress bar and cancel at any time. Collection export moved
  to Settings → Data and the command palette. Exports are written to a
  temporary file first, so a cancelled or failed export never leaves a broken
  `.apkg` behind, and large collections export several times faster.
- **Import progress:** importing a package shows its stages (reading, media,
  merging) and can be cancelled before anything is written. Importing a deck
  you already have says so instead of finishing silently.
- **Updates inside the app:** Bibalak checks GitHub Releases once a day when it
  starts (you can turn this off in Settings → Updates), shows the new version
  and its notes, and installs only when you click **Update and restart**.
  Portable copies show a link to the new version instead. Users of 1.0.0
  install this version by hand once.

### Changed

- **Subdecks work like Anki:** creating `A::B::C` also creates missing
  parents; renaming a deck moves all its subdecks with it (and `X::Y` moves it
  under `X`), with one undo step; names such as `A:: B` or `A::` are tidied;
  deck lists show subdecks right under their parent.
- **Search:** `deck:Name` now finds cards in the deck and all its subdecks,
  ignores upper and lower case, and includes cards that are in a filtered deck
  right now. Clicking a deck in Browse and the statistics drill-down use the
  same rule.
- **Windows installer:** `-setup.exe` carries the Bibalak icon, branded setup
  pages and an English / Arabic language choice; the `.msi` uses the same
  pages.

### Fixed

- Resetting the progress of a deck, or **Forget** in Browse, now also resets
  cards that sit in a filtered deck, and returns them to their home deck first.
- Deleting a deck that had been renamed now deletes its subdecks too.
- Statistics for a deck no longer count a different deck whose name starts
  with the same word.

## [1.0.0] - 2026-11-26

The first release of Bibalak.

### Added

- **Bibalak's own identity:** new name, logo and icons, a warm design, and a
  complete Arabic interface that reads right to left, with bundled Arabic and
  Latin fonts.
- **Anki compatibility:** import and export `.apkg` and `.colpkg` files with
  notes, scheduling, review history and media; text import from CSV, TSV and
  Markdown; missing parent decks are rebuilt on import.
- **Studying:** FSRS-6 and SM-2 per deck, an optimiser for FSRS, filtered
  decks, "study more today", deck progress reset, and a progress bar inside
  each session.
- **Browse and note types:** Anki-style search with Arabic-aware matching,
  paging, bulk actions, find and replace, duplicate finder, image occlusion,
  and a live note-type editor.
- **Media library:** filters, sorting, previews, an audio player and an
  "unused files" view.
- **Statistics:** review heatmap, retention, forecast, card maturity, FSRS
  memory charts and CSV export.
- **AI assistant (optional, off by default):** your own OpenAI-compatible key
  (kept in the system keychain) or a local Ollama model; generate cards from
  text, a study tutor, deck quality review and a study coach. Every request
  shows what will be sent before it goes.
- **Planning:** Eisenhower matrix, habit tracker and calendar that know your
  due decks.
- **Motivation:** daily goal, quests, streaks and a Today card, in three
  presentation styles — Default, Scholar and Game — backed by one progress
  ledger with undo.
- **Plugins:** an isolated plugin host with permissions, installation from a
  folder or `.zip`, and four sample plugins.
- **Desktop comforts:** command palette (`Ctrl+K` / `⌘K`), Quick Add from a
  global shortcut, reminders, notification centre, sound and volume controls,
  portable mode on Windows, and automatic backups.

### Security

- Card templates from shared decks run in a sandboxed frame with no access to
  the app, its data or the network.
- A strict Content-Security-Policy; plugins and cards cannot reach the network.
- Plugin permissions are checked twice (in the app and in the Rust core), and
  plugin files cannot leave their folder.
- File access is limited to files you pick and to the app's own folders.
- API keys live in the operating-system keychain and never appear in logs.
- Dependencies are audited in CI; releases wait for a clean audit.

### Notes

- Installers are not yet code-signed; see the install guide for the first
  launch on Windows and macOS.
- Automatic updates are off in this version; new versions are published on
  the Releases page.

## [0.1.0-beta.3] - 2026-07-04

Synapse release, kept as history. Source:
[github.com/Emadab/Synapse](https://github.com/Emadab/Synapse).

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

[unreleased]: https://github.com/crrrowz/bibalak/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/crrrowz/bibalak/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/crrrowz/bibalak/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/crrrowz/bibalak/releases/tag/v1.0.0
