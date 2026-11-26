# ADR-004: Render card faces in a sandboxed iframe

**Status:** Accepted
**Date:** 2026-11-12

## Context

Card templates come from imported `.apkg` decks, which users download from
anywhere. Anki templates may contain `<script>` blocks and inline `on*`
handlers, and decks rely on them (hints, toggles, custom layouts). Until now
`CardFace` injected that HTML into a shadow root in the main window and ran
the scripts there, so a shared deck had the app's full privileges: the Tauri
IPC bridge (`__TAURI_INTERNALS__`: delete notes, export, restore backups,
install plugins), app storage and the DOM. The CSP (commit "set a
Content-Security-Policy") blocks network exfiltration but not IPC.

## Decision

Each card face renders in `<iframe sandbox="allow-scripts">` built from a
`srcdoc` (`src/lib/cardFrame.ts`):

- **No `allow-same-origin`:** the frame gets an opaque origin, so its scripts
  cannot reach `window.parent`, the IPC bridge, storage or cookies. No other
  sandbox flags (no popups, forms, top navigation).
- **Prepared in the app, executed in the frame:** the sound/TTS queue, media
  URLs, KaTeX, the typed-answer diff and TTS voice names are produced in the
  parent on an inert `DOMParser` document (nothing runs or loads there). The
  frame only injects the HTML, runs the template scripts and wires hints,
  image-occlusion peeking and the type-answer input.
- **Messages:** `postMessage` both ways, tagged `channel: "keepsake-card"`.
  The parent accepts messages only when `event.source` is that face's frame
  and validates them (`parseFrameMessage`); the frame accepts `render` only
  from `window.parent`.
- **Frame → app:** `ready`, `height` (the frame is sized to its content),
  `typed` (type-answer input), `wantsFocus`, and `key` (keyboard shortcuts
  pressed while the card has focus are re-dispatched on the app document).
- **Styling:** card base CSS, KaTeX CSS and the app font are inlined into the
  frame, with font files converted to data URIs (an opaque origin would need
  CORS headers to load them). Theme colors are sent as CSS variables on each
  render; per-notetype CSS goes into its own `<style>`.

## Consequences

- A malicious deck can still run script inside its own card, but only there.
  It can still load remote images (`img-src https:` is kept for shared decks),
  which reveals that a card was shown, nothing more.
- Links inside cards no longer navigate the app window (sandbox blocks
  navigation and popups). Opening card links externally would need an
  explicit `openLink` message later.
- Template scripts that reach outside the card (`window.parent`, app DOM)
  stop working; Anki templates do not do this.

## Verification in the real webview (Tauri 2.12.5, WebView2 157, Windows)

Probed over the WebView2 DevTools port, inside the card frames of a real study
session and inside an identical injected frame:

- Tauri **does** inject `__TAURI_INTERNALS__` (and `window.ipc` /
  `chrome.webview`) into the sandboxed frame, and a script can capture the
  invoke key by hooking `Headers.prototype.set`. The sandbox alone is
  therefore not what blocks IPC; these do:
  - custom-protocol IPC from the frame is rejected by Tauri:
    `Origin header is not a valid URL` (the opaque origin sends `null`);
  - `window.ipc.postMessage` / `chrome.webview.postMessage` from the frame,
    with the stolen key and a correct message, has no effect. The same
    message from the main window does create a deck (positive control).
- `window.parent.document` and `localStorage` throw `SecurityError`;
  `fetch` to the internet fails (CSP).
- Card text renders; the 42 KaTeX/Figtree woff2 files are inlined.

Because the protection depends on Tauri/wry behaviour, re-run this probe after
every Tauri or WebView2 upgrade (an E2E test for it is a follow-up).

## CSP Addendum (H1, 2026-11-24)

- **`'unsafe-eval'` removed:** Neither the app bundle (Vite/React/KaTeX/TipTap) nor `FRAME_RUNTIME` requires `eval()` / `new Function()`, so `'unsafe-eval'` is dropped from `script-src` in both `csp` and `devCsp` (`tauri.conf.json`, guarded by `src/test/tauriCsp.test.ts`).
- **`'unsafe-inline'` and `dangerousDisableAssetCspModification: ["script-src", "style-src"]` retained for now:** Because `CardFace` uses `<iframe sandbox="allow-scripts" srcdoc={...}>`, the frame inherits the parent document's CSP. Enabling Tauri's automatic per-asset nonces on `script-src`/`style-src` causes browsers to ignore `'unsafe-inline'`, blocking `FRAME_RUNTIME`, imported card `<script>` / `on*` handlers, and per-notetype `<style>` blocks inside `srcdoc`. Moving `CardFace` to its own custom-protocol origin (e.g. `keepsake-card://` with its own CSP header) so the main app document can re-enable nonces and drop `'unsafe-inline'` requires real-WebView2/WKWebView verification and is deferred as a dedicated post-beta hardening task.
