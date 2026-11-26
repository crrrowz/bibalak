# ADR-013: AI assistant adapter (`bibalak-ai`), OS keyring storage, and host-pinned CSP

Date: 2026-11-14
Status: Accepted

## Context

Card E11 introduces an opt-in AI assistant across four surfaces:

1. Settings: configure an OpenAI-compatible or local Ollama provider (`base_url`, `model`, optional API key) and test the connection.
2. Study: "Explain this card" after answer reveal.
3. Add: "Suggest back" from the Front field.
4. Browse: "Rewrite leech" in the note editor panel.

Three constraints shape the implementation:

- **Layer isolation:** `bibalak-core` must remain free of network crates and OS credential libraries.
- **Secret hygiene:** API keys must never be stored in `collection.sqlite`, config JSON files, logs, or returned to the frontend over IPC.
- **Consent and WebView CSP safety (ADR-003 / ADR-004):** Imported card HTML is untrusted and plugin Web Workers inherit the document's `connect-src` CSP (`tauriCsp.test.ts`). Card HTML must be converted to plain text before leaving the app, nothing may be sent without an explicit user click, and network access must stay strictly scoped to the single user-configured host.

## Decision

1. **Adapter crate `crates/bibalak-ai`:** Implement `bibalak_core::ai::AIProvider` using `ureq = "3"` (`features = ["json"]`) for OpenAI-compatible (`/v1/chat/completions`) and native Ollama (`/api/chat`) endpoints, and `keyring = "3"` for storing/reading/deleting the API key (`SecretStore` trait with `KeyringSecretStore` in production and `MemorySecretStore` in tests).
2. **Portable-aware settings file (`data_dir/.ai.json`):** Persist `{ enabled, provider, base_url, model }` under `data_dir::data_dir` so portable installs remain self-contained, while returning only `has_api_key: bool` over IPC.
3. **Host-pinned HTTP & CSP `connect-src` helper:**
   - Because all AI HTTP calls execute in Rust via `bibalak-ai` behind Tauri IPC (`ai_run_action` on `spawn_blocking`) rather than browser `fetch()`, the static WebView CSP in `tauri.conf.json` stays locked down so plugin Workers and card scripts cannot reach external AI hosts.
   - `normalize_provider_origin` validates `http://`/`https://` URLs (rejecting embedded credentials, whitespace, and non-HTTP schemes), `HttpAIProvider` disables cross-host redirects (`max_redirects(0)`), and `bibalak_core::ai::csp_with_ai_origin` updates `connect-src` exclusively for the configured origin when dynamic CSP strings are rendered.
4. **Two-step consent UI & plain-text sanitization:** `bibalak_core::ai::html_to_plain_text` strips tags/scripts/styles and decodes entities before building prompts (`ai_preview_action`). Every UI action displays the exact plain-text payload and target origin before the user explicitly clicks Send, and edit suggestions (`Suggest back`, `Rewrite leech`) are inserted into fields only after the user clicks Accept.

## Consequences

- `bibalak-core` gains zero network or OS keyring dependencies (`ureq` 3 and `keyring` 3 stay isolated in `bibalak-ai`).
- Portable mode keeps provider configuration under `data_dir`, while secrets live in the host OS credential manager.
- `tauriCsp.test.ts` remains green without exposing WebView scripts or plugin Workers to arbitrary third-party endpoints.
