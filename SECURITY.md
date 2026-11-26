# Security Policy

## Supported versions

Security fixes are released for the latest stable release and the `main` branch.

## Reporting a vulnerability

Please report security vulnerabilities **privately** — never open a public GitHub issue, PR, or discussion thread:

- **Preferred:** Open a [GitHub Private Vulnerability Report](https://github.com/crrrowz/bibalak/security/advisories/new).

Please include the affected version or commit SHA, clear reproduction steps or proof of concept, and expected impact. You will get an acknowledgement within 72 hours and a first assessment within 7 days. We fix confirmed issues privately, publish a release, and then disclose the advisory with credit to the reporter unless you prefer to stay anonymous.

## Scope & security model

The following boundaries are in scope for security reports:

- **Sandboxed card frame (`CardFace`, [ADR-004](docs/architecture/adr/004-sandboxed-card-frame.md)):** Imported deck templates render inside `<iframe sandbox="allow-scripts">` with an opaque origin (no access to app DOM, Tauri IPC, storage, or network).
- **Tauri IPC & path safety ([ADR-029](docs/architecture/adr/029-ipc-security-hardening.md)):** Command input validation, per-window capabilities, Rust-mediated file dialogs, backup/restore `paths_guard`, and webview CSP (`apps/desktop/src-tauri/tauri.conf.json`).
- **Plugin sandbox ([ADR-003](docs/architecture/adr/003-plugin-worker-sandbox.md)):** Web Worker isolation, capability enforcement, and manifest path containment.
- **AI credentials & consent ([ADR-013](docs/architecture/adr/013-ai-assistant.md)):** OS keychain storage for API keys, key redaction from logs/errors, and outbound consent preview.
- **Release & updater integrity:** Signed updater manifests (when `DOWNLOAD_SITE` is configured) and dependency vulnerability audits (`cargo audit`, `pnpm audit`).

---

## ملخص الأمان (بالعربية)

يُرجى الإبلاغ عن الثغرات الأمنية **بشكل خاص** وعدم نشرها في البلاغات العامة:

- **القناة المفضلة:** فتح بلاغ أمني خاص عبر [GitHub Security Advisories](https://github.com/crrrowz/bibalak/security/advisories/new).

يشمل نطاق الأمان: عزل قوالب البطاقات (`CardFace`)، وحدود أوامر Tauri IPC وحماية المسارات، وعزل الإضافات، وحفظ مفاتيح الذكاء الاصطناعي في خزنة النظام، وسلامة التحديثات.
