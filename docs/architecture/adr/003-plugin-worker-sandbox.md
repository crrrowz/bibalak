# ADR-003: Plugin sandbox via Web Workers (not Wasm runtime)

**Status:** Accepted  
**Date:** 2025-06-01

## Context

Bibalak needs a plugin runtime that:

- Sandboxes untrusted JS code (no DOM access, no arbitrary fs/net)
- Enforces capability declarations from the plugin manifest
- Works without adding new native Rust dependencies (network blocked in CI; `wasmtime` and `rquickjs` can't be fetched)
- Can host the plugin SDK API surface (`registerCommand`, `addSidebarPanel`, `showToast`, `onEvent`)

## Decision

Run each plugin in a **browser Web Worker** created from a `Blob` URL. Before executing plugin code, inject a bridge IIFE that:

1. Reads the plugin's declared capabilities from the manifest.
2. Exposes `self.BibalakPlugin = { registerCommand, addSidebarPanel, showToast, onCommand, onEvent }`.
3. Guards every host-side capability behind `_check(cap)` which throws `PermissionDenied` if the capability is not in the manifest.
4. Leaves network APIs (`fetch`, `XMLHttpRequest`) unavailable — Workers do have `fetch` but the Tauri CSP blocks external origins.

`PluginHost` in `src/lib/pluginHost.ts` manages the Worker lifecycle, routes `postMessage` calls to host handlers, and exposes the plugin's registered commands to the UI.

## Consequences

- No new Rust dependency; sandbox is provided by the browser engine Tauri embeds.
- Worker thread isolation is real: plugin code cannot access `document`, `window`, or the main thread's memory.
- Capability enforcement happens on the host: `PluginWorker` checks every message a Worker posts against the manifest permissions, so calling raw `postMessage` does not bypass it. The bridge-preamble checks only give plugin authors an early, readable error. Events are only sent to plugins with `events:listen`, and a command is invoked only in the plugin that registered it.
- Network isolation depends on the app CSP (`connect-src`) set in `tauri.conf.json`; Workers inherit it from the document.
- Audio/DOM rendering extensions must go through the bridge API; direct DOM manipulation from plugins is not possible.
- If a Wasm runtime becomes available (v1.1+), the bridge API surface is stable and the sandbox can be swapped without changing plugin manifests.

## Update — API 0.2.0 (PLG1, 2026-11-26)

- Host and SDK share API `0.2.0`. Data reads go Worker → host (permission
  check and rate limit) → Rust IPC (`plugin_read_decks`, `plugin_read_notes`,
  `plugin_check_media_missing`). Rust checks again that the plugin is
  installed, enabled and declares the capability (ADR-029 rules: inputs
  validated and capped).
- Installing from a `.zip` accepts only a file picked in the dialog, at most
  256 entries and 10 MB extracted, no symlinks and no paths that leave the
  folder. A new or updated plugin starts disabled until the user agrees to its
  permissions.
- `write:cards`, `ui:review-button`, `net:fetch` and `ai:*` stay reserved and
  are refused at install. `net:fetch` needs its own ADR (SSRF guard,
  `connect-src` change) before it can open.
- Four MIT sample plugins live in `examples/plugins/` and are bundled into the
  app (Settings → Plugins → install samples). Guide: `docs/guides/plugins.md`.
