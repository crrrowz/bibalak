# ADR-039: Opaque-origin sandboxed plugin host and UI/navigation capabilities

**Status:** Proposed  
**Date:** 2026-11-28

## Context

Under [ADR-003](003-plugin-worker-sandbox.md), `PluginWorker` (`apps/desktop/src/lib/pluginHost.ts`) created a `Blob` URL Web Worker directly from the main app document. A `Blob` URL created by the main document inherits the document's origin, which gives plugin code access to same-origin `indexedDB`, `caches`, and same-origin `fetch` inside the app origin. In addition, `show:toast`, `navigate:deck`, and `navigate:browse` did not require any declared manifest permissions, allowing a plugin with `permissions: []` to spam toasts or navigate the UI.

## Decision

Extend the sandbox architecture of [ADR-003](003-plugin-worker-sandbox.md) using the opaque-origin iframe isolation model of [ADR-004](004-sandboxed-card-frame.md):

1. **Opaque-origin iframe host (`<iframe sandbox="allow-scripts">`):**
   - `PluginWorker` no longer instantiates a `Worker` from a `blob:` URL on the main window.
   - Instead, `PluginWorker` mounts a hidden `<iframe sandbox="allow-scripts" aria-hidden="true">` with `srcDoc` (no `allow-same-origin`, no popups, no forms, no top navigation).
   - Inside that opaque (`null`) origin frame, a minimal bootstrapper starts the plugin's `Blob` URL Web Worker (so the Worker also inherits the opaque `null` origin, never the app origin) and relays structured messages between the Worker and `window.parent` over `postMessage` tagged with channel `"bibalak-plugin"`.
   - The host verifies `event.source === frame.contentWindow` and channel `"bibalak-plugin"` before accepting any message, and the iframe bridge verifies `event.source === window.parent` and channel `"bibalak-plugin"`.

2. **Capability-gated toasts and navigation:**
   - Add two active API `0.2.0` capabilities:
     - `ui:toast` — required for `ctx.showToast(...)` (`show:toast` message).
     - `ui:navigate` — required for `ctx.navigation.openDeck(...)` and `ctx.navigation.openBrowse(...)` (`navigate:deck`, `navigate:browse` messages).
   - Enforce both in `PluginWorker` on the host (never trusting the frame or Worker) and in the in-worker bridge preamble (`_check`), and declare them in `crates/bibalak-plugin` (`Capability::UiToast`, `Capability::UiNavigate`), `@bibalak/plugin-sdk`, `PluginConsentDialog`, and the bundled sample plugin manifests that use them.

## Consequences

- Untrusted plugin scripts have no access to the app origin (`localStorage`, `indexedDB`, `caches`, cookies, app-origin `fetch`, `window.parent`, or Tauri IPC).
- Plugins with `permissions: []` cannot trigger toasts or UI navigation.
- Zero database schema changes, zero new npm or Cargo dependencies, and `@bibalak/ipc-types` stays unchanged (`PluginInfo.permissions` is `string[]`).
- Third-party plugins that call `ctx.showToast` or `ctx.navigation.*` must declare `"ui:toast"` / `"ui:navigate"` in `plugin.json` and receive user consent in `PluginConsentDialog`.
