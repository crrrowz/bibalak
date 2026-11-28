# ADR-038: Raw binary IPC body for `save_media`

**Status:** Proposed
**Date:** 2026-11-28

## Context

Previously (`A2-09`), `ipc.saveMedia(bytes: Uint8Array, filename: string)` converted `bytes` with `Array.from(bytes)` and serialized it as a JSON number array over Tauri IPC, inflating a 50 MB audio/video paste or recording to hundreds of megabytes of JSON heap allocations in both the webview and Rust.

## Decision

Send media uploads over Tauri 2's raw binary IPC transport (`Uint8Array` body -> `tauri::ipc::Request<'_>` with `InvokeBody::Raw`), passing the percent-encoded original filename in the `x-media-filename` request header.

- UI (`apps/desktop/src/lib/ipc.ts`): `platform.invoke("save_media", bytes, { headers: { "x-media-filename": encodeURIComponent(filename) } })`.
- Platform port (`apps/desktop/src/lib/platform/`): `Platform.invoke` forwards raw `Uint8Array` / `ArrayBuffer` payloads and optional `{ headers }` to `@tauri-apps/api/core`.
- Tauri adapter (`apps/desktop/src-tauri/src/commands/media.rs`): decodes `x-media-filename`, extracts `InvokeBody::Raw(bytes)`, validates `allowed_media_mime(&filename)` and `MAX_MEDIA_BYTES`, and delegates to `MediaState`.

## Consequences

- Zero JSON array conversion or ~8x memory bloat for pasted/dropped/recorded media.
- Preserves original filenames (including UTF-8 / Arabic characters via `encodeURIComponent` + percent-decoding) and keeps the 100 MiB ceiling.
