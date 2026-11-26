# ADR-006: Portable mode by a marker file

**Status:** Accepted
**Date:** 2026-11-13

## Context

Users asked for a Windows copy that runs without installing and can travel on
a USB stick. The exe already runs without an installer, but every path came
from `app_data_dir()` (`%APPDATA%\com.keepsake.desktop`) and the WebView2
profile (language and layout in `localStorage`) went to `%LOCALAPPDATA%`, so
the data stayed behind on the first computer.

## Decision

- A file named `portable.txt` next to the executable turns on portable mode;
  all data then lives in a `data` folder beside it
  (`apps/desktop/src-tauri/src/data_dir.rs`). One exe serves both modes, so
  there is nothing extra to build or sign.
- Every data path goes through `data_dir::data_dir`; a test fails if any
  other file of the desktop crate calls `app_data_dir()`.
- The main window is built in `setup` (`"create": false` in
  `tauri.conf.json`) so a portable copy can point the webview profile at
  `data/webview`. Installed copies keep the default profile location.
- A portable copy skips the Synapse → Bibalak data migration and starts
  empty; it never reads the installed copy's folder.
- `scripts/package-portable.ps1` packs the exe, the marker and the licence
  files; `release.yml` attaches the ZIP to the draft release.

## Consequences

- A marker file is visible and easy to explain ("delete it to install-mode");
  a command-line flag would be lost when users start the app from Explorer.
- The marker is checked once per process. Moving the folder while the app
  runs is not supported.
- Portable copies are not updated in place; users replace `Bibalak.exe` and
  keep `data`.
