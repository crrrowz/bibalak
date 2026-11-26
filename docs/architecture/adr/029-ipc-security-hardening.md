# ADR-029: IPC path guards, Rust-mediated file dialogs, and per-window command capabilities (H1)

**Status:** Proposed
**Date:** 2026-11-24

## Context

The pre-beta architecture and security review (H1 / F1) identified three defence-in-depth gaps on the Tauri IPC boundary:

1. `restore_backup` and `delete_backup` joined client-supplied `name` directly onto `backups/`, allowing `..`, path separators, or absolute paths to leave the backups folder.
2. `export_package`, `import_package`, `preview_text_import`, `import_text`, `save_media_from_path`, and `install_plugin` accepted arbitrary path strings from the webview without verifying that the user chose them via a native dialog or that they stay outside `data_dir`.
3. `build.rs` used plain `tauri_build::build()`, leaving all main-window IPC commands callable from the `quick-add` window.

## Decision

1. **Backup filename guard (`paths_guard::resolve_backup_zip_path`):** `restore_backup` and `delete_backup` accept only a single normal `.zip` filename component (no empty names, `.`, `..`, `/`, `\`, `:`, NUL bytes, or symlinks), canonicalized and verified to stay inside `backups/`.
2. **Rust-mediated dialogs + session allowlist (`paths_guard::PickedPathsState`):**
   - `pick_open_path` and `pick_save_path` invoke `tauri_plugin_dialog` on the Rust side (with `#[cfg(desktop)]` `set_parent` / folder support for cross-platform D45 compatibility) and record picked paths in `PickedPathsState` (bounded to 64 entries per kind, rejecting `..`, UNC/device prefixes, and anything inside `data_dir`).
   - `apps/desktop/src/lib/platform/desktop.ts` delegates `pickPath` / `pickSavePath` to those commands while keeping every screen and `ipc.ts` wrapper signature unchanged (`export_package`, `import_package`, `preview_text_import`, `import_text`, `save_media_from_path`, `install_plugin`).
   - Raw `"dialog:default"` is removed from `capabilities/default.json` so the webview cannot open dialogs outside `PickedPathsState`.
3. **Per-window capabilities (`AppManifest::commands`):** `build.rs` enumerates all registered app commands; `capabilities/default.json` grants them to `main`, while `capabilities/quick-add.json` grants only the 11 commands needed by Quick Add (`set_local_offset`, `get_quick_add_config`, `remember_quick_add_target`, `hide_quick_add`, `list_notetypes`, `list_decks`, `list_tags`, `get_notetype`, `check_duplicate`, `add_note`, `save_media`).
4. **CSP tightening:** Remove `'unsafe-eval'` from `tauri.conf.json`; retain `'unsafe-inline'` and `dangerousDisableAssetCspModification` per the ADR-004 CSP addendum until `CardFace` moves to a dedicated custom-protocol origin.

## Consequences

- Existing `ipc.ts` signatures and `@bibalak/ipc-types` stay backwards-compatible; every screen and mock continues working unchanged.
- Any new IPC command added to `lib.rs` must also be added to `build.rs` (`APP_COMMANDS`) and `capabilities/default.json` (enforced by `src/test/tauriCapabilities.test.ts`).
