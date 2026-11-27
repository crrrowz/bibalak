# Architecture Decision Records

An ADR is required before a card adds a dependency, a schema migration or a new
public API (`AGENTS.md`). Write it as
`NNN-short-name.md`, start with `Status: Proposed`, and switch to `Accepted`
only after the owner approves.

## Accepted

| ADR                                         | Decision                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [001](001-clean-architecture.md)            | Clean architecture: ports in `bibalak-core`, adapters outside                                                                              |
| [002](002-dual-scheduler.md)                | SM-2 and FSRS-6, switchable per deck                                                                                                       |
| [003](003-plugin-worker-sandbox.md)         | Plugin sandbox via Web Workers                                                                                                             |
| [004](004-sandboxed-card-frame.md)          | Card HTML only in a sandboxed iframe (`CardFace`)                                                                                          |
| [005](005-study-index.md)                   | Covering index for the study queue (schema v4)                                                                                             |
| [006](006-portable-mode.md)                 | Portable mode by marker file                                                                                                               |
| [007](007-note-ids-and-checksums.md)        | Anki-compatible note guids and checksums                                                                                                   |
| [008](008-window-state.md)                  | Window state persistence                                                                                                                   |
| [009](009-arabic-search-normalization.md)   | Arabic/accent-insensitive search (schema v5)                                                                                               |
| [010](010-media-store.md)                   | `MediaStore` port, Anki-compatible media on disk                                                                                           |
| [011](011-text-import.md)                   | CSV/TSV and Markdown import                                                                                                                |
| [012](012-stats-revlog-index.md)            | Single-pass stats, `revlog(id, card_id)` index (schema v6)                                                                                 |
| [013](013-ai-assistant.md)                  | AI assistant adapter, OS keyring, host-pinned CSP                                                                                          |
| [014](014-sync-journal.md)                  | Sync journal, merge rules, ID model; full sync only for structural changes                                                                 |
| [018](018-productivity-data-model.md)       | Productivity data model: task lists, tasks, matrix rules, habits, logs, local calendar (schema v10)                                        |
| [019](019-progress-engine.md)               | Progress engine: XP, level, gold, and undo-safe reward ledger; §4 R3 addendum: task and habit rewards                                      |
| [021](021-in-app-updates.md)                | In-app updates: Tauri updater and process plugins, one download-site setting                                                               |
| [022](022-open-source-model.md)             | Open source (AGPL-3.0 + CLA + trademark), paid cloud services; publish at OS4                                                              |
| [023](023-habit-skip-and-freeze.md)         | Habit skip and freeze: `status` in `habit_logs` (schema v11); skip in every style, freeze only in Game                                     |
| [025](025-game-inventory-and-spending.md)   | Game inventory, equipment, shop, custom rewards, gold spending ledger, freeze tokens (schema v12)                                          |
| [026](026-game-unlocks-and-achievements.md) | Game unlocks, pets and mounts (growth credits), cosmetic Paths, solo achievements (schema v13)                                             |
| [027](027-daily-motivation.md)              | Daily motivation: synced daily goal and onboarding, deterministic quests, comeback bonus, monthly badges, study-streak freeze (schema v15) |

## Proposed

| ADR                                  | Topic                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| [028](028-reminders-core-plan.md)    | Reminders: pure rules in `bibalak-core`, `plan_reminders` IPC, `NotificationsApi` capability (16c)    |
| [029](029-ipc-security-hardening.md) | IPC path guards, Rust-mediated file dialogs, per-window capabilities, CSP tightening                  |
| [030](030-note-type-presets.md)      | Note type presets: Simple-mode config in `notetypes.config`, pure-core compiler, Anki compat          |
| [031](031-deck-export.md)            | Deck export: scoped export, `MediaStore::open_reader` streaming, atomic temp write, cancel & progress |
| [032](032-deck-reset.md)             | Deck progress reset: `deck_card_ids` IPC, reuse `forget_cards` with undo                              |

## Reserved numbers (not written yet)

Numbers are reserved here so no two cards claim the same one; steps refer to
the project roadmap. If a
reservation is dropped, leave the number unused rather than reusing it.

| ADR | Topic                                                                                           | Card    | Gate                   |
| --- | ----------------------------------------------------------------------------------------------- | ------- | ---------------------- |
| 015 | Opt-in crash reporting (payload rules, SDK choice) — Stage 3                                    | `C3`    | owner OK for SDK       |
| 016 | Google Drive storage: OAuth PKCE loopback, keychain tokens, `CloudStore` adapter                | `S3`    | Stage 2, after ADR-017 |
| 017 | Server stack for Stage 2 (own API server; Supabase/Postgres behind it or not), auth, sync       | `SUPA1` | first step of Stage 2  |
| 020 | External calendar providers (Google / Graph / CalDAV) adapter crate                             | Stage 2 | Stage 2, after ADR-017 |
| 024 | Mobile: form factors, `MobileShell`, density tokens, platform capabilities, data path, keystore | `MOB1`  | after Stage 1          |

## Schema version rule

The live schema is **v15** (16d: [ADR-027](027-daily-motivation.md) `motivation_settings`, `monthly_badges` and index `idx_revlog_new_kind`; 14b: v12 [ADR-025](025-game-inventory-and-spending.md), v13 [ADR-026](026-game-unlocks-and-achievements.md); 14c: v14 indexes `idx_game_pet_credits_ledger` & `idx_progress_ledger_active_created`) (`crates/bibalak-db/src/schema.rs`, `MIGRATIONS`).
Version numbers written in blueprints (`v6→v7`, `v7→v8`) are placeholders: **v10**
is taken by **M1** ([ADR-018](018-productivity-data-model.md)). Never edit a shipped migration.
