# ADR-030: Note Type Presets — Schema, Deterministic Compilation, and Anki Compatibility

**Status:** Proposed — owner approved with conditions (2026-11-25)  
**Date:** 2026-11-25  
**Scope:** Note types Simple mode and preset compiler  
**Related:** Note Types Redesign Blueprint · [ADR-001](001-clean-architecture.md) · [ADR-004](004-sandboxed-card-frame.md) · [ADR-014](014-sync-journal.md) · `decisions.md`

---

## Context

Earlier reviews established that Bibalak's current Note Types editor exposes raw Anki HTML (`qfmt` / `afmt`) and raw `.card` CSS to every user. The Note Types redesign introduces a default **Simple mode** (ready card layouts, slot-to-field mapping, and style presets) alongside an **Advanced mode** (raw HTML/CSS).

To preserve Bibalak's core promises, the preset representation must satisfy five constraints:

1. **Lossless Anki compatibility:** Imported `.apkg` note types must work without alteration, and any note type created or edited in Simple mode must export as standard Anki HTML/CSS (`.apkg`) and render through the existing `bibalak-render` engine and `CardFace` sandbox (`ADR-004`).
2. **One core across platforms:** Layout compilation, validation, and stock detection must be pure Rust in `bibalak-core`, with zero OS, database, Tauri, or UI dependencies.
3. **Sync compatibility (`ADR-014`):** Editing a preset's layout options or style must sync cleanly as a cosmetic note-type edit (`mod` + `usn = -1`), bumping `schema_mod` only when fields or templates are structurally added/removed/reordered.
4. **Minimal schema churn:** Avoid an unnecessary SQLite migration if the existing canonical schema already carries extensible per-notetype metadata.
5. **Reversibility & safety:** Switching from Simple to Advanced must never break user-edited code; switching back to Simple must never silently overwrite custom HTML/CSS.

---

## Decision

### 1. Storage in `notetypes.config` JSON (Zero Schema Migration)

Each note type's Simple-mode configuration lives under a single namespaced key `"keepsakePreset"` inside the existing `notetypes.config` JSON column (`crates/bibalak-db/src/schema.rs:L50`):

```json
{
  "css": "/* compiled Anki .card CSS */",
  "sortf": 0,
  "keepsakePreset": {
    "version": 1,
    "mode": "simple",
    "layout": "language-card",
    "slots": {
      "word": "Arabic",
      "reading": "Transliteration",
      "ipa": "IPA",
      "audio": "Sound",
      "meaning": "English",
      "example": "Sentence"
    },
    "options": {
      "includeReverse": true,
      "useFurigana": false,
      "showTranscriptOnFront": false
    },
    "style": {
      "preset": "clean-sans",
      "font": "default",
      "size": "lg",
      "align": "auto",
      "accent": "theme",
      "surface": "theme",
      "divider": "hairline"
    },
    "compiledDigest": "<sha256-hex-of-compiled-qfmt-afmt-css>"
  }
}
```

- **Why `notetypes.config` instead of a new table/column:**
  - `notetypes.config` is already JSON (`TEXT NOT NULL DEFAULT '{}'`), preserved across `save_notetype_css` (`json_set`), cloned by `duplicate_notetype`, and synced automatically by `SyncDelta` (`crates/bibalak-db/src/sync.rs:L140, L598-L608`).
  - `crates/bibalak-ankifmt/src/writer.rs` (`notetype_to_v11`, `L301-L328`) explicitly constructs Anki's model JSON by extracting only `css` and `sortf`, so `"keepsakePreset"` never leaks into `.apkg` exports.
  - Note types that have no `"keepsakePreset"` key (all imported `.apkg` decks and existing custom note types) default cleanly to **Advanced mode**.
  - _(Note: If a future Stage 2 feature introduces shared user-authored preset libraries across note types, a dedicated Postgres-ready `notetype_presets` table can be added then with its own migration and ADR.)_

### 2. Pure-Core Preset Compiler (`bibalak-core::notetype_preset`)

All preset logic lives in pure Rust (`crates/bibalak-core/src/notetype_preset.rs`):

- **Schema types (`#[derive(Serialize, Deserialize, TS)]`):** `NotetypePreset`, `EditorMode` (`Simple | Advanced`), `LayoutId` (`Basic | BasicReversed | Cloze | TypeIn | AudioText | ImageText | LanguageCard`), `StylePresetId`, `StyleOptions`, and `TemplateLintHint`.
- **Deterministic compilation (`compile_preset(preset, fields) -> CompiledNotetype`):**
  - Produces ordered `CompiledTemplate { name, qfmt, afmt }` definitions, normalized `css`, and a SHA-256 `compiledDigest` over `(templates, css)`.
  - Uses standard Anki syntax (`{{Field}}`, `{{FrontSide}}`, `{{#Field}}...{{/Field}}`, `{{^Field}}...{{/Field}}`, `{{cloze:...}}`, `{{type:...}}`, `{{hint:...}}`, `{{furigana:...}}`, `{{tts ...}}`), wraps text slots with `dir="auto"`, and emits CSS using Bibalak's theme CSS variables (`hsl(var(--...))`) and `.night_mode` / `.nightMode` rules.
  - **Alignment rule:** Newly created Simple note types default to `align: "auto"` (start-aligned, RTL-aware). Existing note types never have their alignment changed unless the user edits them explicitly.
  - **Every save in Simple mode compiles and persists `templates` and `notetypes.config.$.css` in the same SQLite transaction**, so `bibalak-render`, Study, Browse preview, and `.apkg` export always read standard templates and CSS without needing to understand presets. **Opening a note type in Simple mode never mutates its `templates` or `css` until the user explicitly edits and saves.**

### 3. Mode Transitions, Strict Stock Detection & Digest Verification

- **Strict stock detection (`detect_stock_preset`):** A note type without `keepsakePreset` opens in **Simple mode** **only** if its `templates` (`qfmt` / `afmt`) and `css` match a built-in stock pattern **exactly after whitespace normalization**. Any deviation opens in **Advanced mode** without altering templates or CSS.
- **Simple → Advanced:** Sets `keepsakePreset.mode = "advanced"`, keeping the rest of `keepsakePreset` intact. Requires user confirmation explaining that manual edits prevent automatic return to Simple sliders.
- **Advanced → Simple (safe return):** Allowed automatically only when the current `(templates, css)` still matches `compiledDigest` (meaning the user has not diverged from the compiled output), or passes the strict whitespace-normalized `detect_stock_preset` check. Otherwise, the UI requires an explicit **"Replace with a Simple layout"** confirmation that overwrites `qfmt`/`afmt`/`css` with the newly compiled preset.

### 4. Field Rename & Removal Synchronization

- `rename_field` and `remove_field` (`crates/bibalak-db/src/notetype/fields.rs`) already rewrite `{{Field}}` across `templates` in a single transaction. When `keepsakePreset` is present in `notetypes.config`, they update/clear matching field names in `keepsakePreset.slots` and refresh `compiledDigest` in the same transaction.
- Toggling a layout option that changes the number of card templates (e.g., `includeReverse` on `language-card`, or switching between `basic` and `basic-reversed`) invokes the existing `add_template` / `remove_template` card-generation and `bump_schema_mod` logic inside `save_notetype_preset`, returning a warning count if cards will be deleted.

### 5. Typed IPC Contract (`crates/bibalak-core/src/ipc.rs`)

- `NotetypeDetail` gains `pub preset: Option<NotetypePreset>` and `pub can_return_to_simple: bool`.
- New async commands (thin wrappers over `Collection`):
  - `save_notetype_preset(notetype_id: i64, preset: NotetypePreset) -> NotetypeDetail`
  - `switch_notetype_mode(notetype_id: i64, mode: EditorMode) -> NotetypeDetail`
  - `lint_notetype_templates(notetype_id: i64, qfmt: String, afmt: String, css: String) -> Vec<TemplateLintHint>`
- `preview_template` remains unchanged for Advanced mode; Simple mode either passes compiled templates to `preview_template` or calls a `preview_preset` helper using the same `bibalak_render::render` pipeline. In all cases, preview HTML renders **only** inside the sandboxed `CardFace` iframe (`ADR-004`).

### 6. Required Verification & Deferred Items (Owner Conditions)

- **Anki `.apkg` compatibility tests:** Automated tests must verify that (a) an `.apkg` export carries zero `keepsakePreset` data in exported Anki model JSON and opens cleanly, and (b) an import → export `.apkg` round trip leaves unedited note types identical.
- **AI template helper:** Sends only field names, `qfmt`/`afmt`, and CSS by default; optional 1-note plain-text sample requires a per-request opt-in tick each time. Deferred until the Simple-mode editor is implemented and evaluated.
- **Card scripts & animation libraries:** Bundled JS/animation libraries inside `CardFace` remain deferred to a separate future ADR extending `ADR-004` security.

---

## Consequences

- **Positive:**
  - Zero SQLite schema migration (`v15` unchanged) and zero changes to `bibalak-ankifmt` or `bibalak-render`.
  - Sync (`ADR-014`) carries `keepsakePreset` across devices automatically with no merge-engine changes.
  - Works identically on desktop, future mobile (`MOB`), and web (`W1`).
  - Pure-core compilation and linting are fast to unit-test in Rust without DB or UI setup.
- **Negative / Trade-offs:**
  - `notetypes.config` JSON carries a small (~400 byte) `keepsakePreset` object per Simple note type; cosmetic edits overwrite `notetypes.config` as one LWW blob (already the case for `$.css` and `$.sortf`).
  - Users who edit HTML/CSS in Advanced mode cannot auto-sync those edits back into Simple sliders unless they reset to a preset.
- **Deferred:**
  - Bundled JavaScript / animation libraries inside `CardFace` (`Motion`, `Anime.js`, `Prism.js`, etc.) are explicitly out of scope for `ADR-030` and will require their own ADR extending `ADR-004`.
