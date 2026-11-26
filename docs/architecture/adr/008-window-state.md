# ADR-008: Window state persistence without external plugin

**Status:** Accepted
**Date:** 2026-11-14

## Context

Bibalak creates its main window in `setup()` (`tauri.conf.json` sets `"create": false`, see ADR-006) so portable builds can isolate the WebView2 profile under `data/webview`. Without window state persistence, the window opens at the default `1200×800` size every launch instead of remembering size, position, and maximized state.

Evaluating the official `tauri-plugin-window-state` (`2.5.0`) revealed three issues:

1. **Unwanted Tauri/WebView stack upgrade:** Adding `tauri-plugin-window-state` 2.5.0 bumps `tauri` from `2.11.3` to `2.12.5` (along with `wry`, `tao`, and `webview2-com`), which is out of scope and risks affecting the sandboxed card frame (ADR-004).
2. **Portable mode violation (ADR-006):** `tauri-plugin-window-state` hardcodes `app.path().app_config_dir()` and calls `create_dir_all(app_dir)` on exit with no custom directory option, writing into `%APPDATA%` even in portable mode.
3. **Removed-monitor / off-screen handling:** The plugin skips `set_position` when no monitor intersects, leaving the window at an OS-default non-centered position while still applying the old size and maximized flag, and allows windows whose top drag bar is off-screen.

## Decision

- Do **not** add `tauri-plugin-window-state` (or any new crate); keep `Cargo.lock` and the Tauri `2.11.3` stack unchanged.
- Use one shared code path in `apps/desktop/src-tauri/src/window_state.rs` for **both** installed and portable modes, reading and writing `data_dir::data_dir(app)/.window-state.json`.
- Restore size, position, and maximized state in `setup()` right after `window.build()`, track `Moved` / `Resized` / `CloseRequested` window events, and flush on `RunEvent::Exit`.
- Validate saved coordinates (and pre-maximize coordinates) against `available_monitors()`. When off-screen or unreachable (e.g., monitor disconnected), unmaximize, reset to the configured default size (`1200×800`), and center on screen.

## Consequences

- `Cargo.lock` and the Tauri/WebView2 dependency graph remain untouched.
- Installed and portable copies share identical behavior, with all state files routed through `data_dir::data_dir` (ADR-006) and zero `%APPDATA%` writes in portable mode.
- Disconnecting an external monitor reliably resets the window to centered defaults.
