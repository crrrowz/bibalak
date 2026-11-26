# Bibalak Plugins Guide (API 0.2.0)

Build your first Bibalak plugin in 10 minutes. Plugins run inside a sandboxed **Web Worker** and extend Bibalak with commands, interactive sidebar panels, and read access to decks and plain-text notes—without touching the app DOM or bypassing user consent.

## 1. Create a plugin folder

Create a directory (for example `my-first-plugin/`) with two files:

- `plugin.json` — the plugin manifest
- `index.js` — the entry script loaded inside the Worker sandbox

### `plugin.json`

```json
{
  "id": "my-first-plugin",
  "name": "My First Plugin",
  "version": "1.0.0",
  "entry": "index.js",
  "description": "Counts due cards and adds a quick command.",
  "author": "Your Name",
  "apiVersion": "0.2.0",
  "permissions": ["read:decks", "ui:command"]
}
```

Manifest rules enforced at install time:

- `id`: 1–128 characters, ASCII letters/digits, `.`, `_`, or `-` (must not start with `.`).
- `entry`: relative path inside the plugin directory (no `..`, drive letters, or leading `/`).
- `apiVersion`: must target `0.2.x` (`"0.2"` or `"0.2.0"`).
- `permissions`: only active API `0.2.0` capabilities are accepted.

## 2. Write `index.js`

Inside the Worker sandbox, Bibalak injects `BibalakPlugin` before your script runs. Register your plugin with `BibalakPlugin.definePlugin`:

```js
/// <reference path="../../packages/plugin-sdk/src/index.ts" />

BibalakPlugin.definePlugin({
  async activate(ctx) {
    ctx.registerCommand({
      id: "hello-due",
      title: "My First Plugin: Show due count",
      async run() {
        const decks = await ctx.decks.list();
        const total = decks.filter((d) => !d.isFiltered).reduce((s, d) => s + d.dueToday, 0);
        ctx.showToast("Due today: " + total + " cards");
      },
    });
  },

  deactivate() {
    // Optional cleanup when unloaded or reloaded
  },
});
```

## 3. Capabilities (`0.2.0`)

| Capability      | Access granted                                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read:decks`    | `ctx.decks.list()` — deck names, hierarchy parent id, new/learning/review/due counts.                                                                                                          |
| `read:notes`    | `ctx.notes.search(query, { limit })`, `ctx.notes.get(noteId)`, `ctx.notes.checkMediaMissing()`. Fields are stripped to plain text (`text`), with local `mediaRefs` filenames extracted safely. |
| `ui:panel`      | `ctx.addSidebarPanel({ id, title, blocks, onAction })` — returns a handle with `update(blocks)` and `dispose()`.                                                                               |
| `ui:command`    | `ctx.registerCommand({ id, title, keybinding?, run })` — adds an entry to the Command Palette (`Ctrl+K` / `⌘K`) and Settings → Plugins.                                                        |
| `events:listen` | `ctx.onEvent(handler)` — notifies on `"card-answered"`, `"notes-changed"`, `"deck-changed"`, `"collection-opened"`, `"collection-closed"`, `"schema-changed"`.                                 |

### Reserved Capabilities (Rejected in `0.2.0`)

These capabilities are reserved for future releases and are rejected with an error at install time:
`write:cards`, `ui:review-button`, `net:fetch`, `ai:card-hint`, `ai:note-fill-back`, `ai:deck-summary`.

## 4. Declarative Panel Blocks (`ui:panel`)

Because Workers cannot touch `window` or `document`, panels render from declarative blocks:

- `{ type: "heading", text }`
- `{ type: "text", text, tone?: "default" | "muted" | "accent" | "warning" | "danger" }`
- `{ type: "stat", label, value }`
- `{ type: "badge", text, tone? }`
- `{ type: "actions", buttons: [{ id, label, variant?: "primary" | "secondary", payload? }] }`
- `{ type: "list", items: [{ id, title, subtitle?, badge?, actionLabel?, actionId?, actionPayload? }], emptyText? }`
- `{ type: "divider" }`

Clicking any button or list action invokes `onAction(actionId, payload)` inside your Worker. Call `panelHandle.update(newBlocks)` whenever your state changes.

## 5. Security & Resource Bounds

- **Worker isolation:** Plugins cannot access `window`, `document`, local storage of the app, Tauri IPC, or card HTML.
- **No network access:** The app CSP blocks external requests from Workers; `net:fetch` is reserved in `0.2.0`.
- **Host + Rust enforcement:** Every data call is checked against the manifest both in `PluginHost` and in Rust before touching the collection.
- **Rate & size limits:** Up to 30 data requests per 10 seconds per plugin; `ctx.notes.search` is capped at 200 notes per query and queries are capped at 500 characters.
- **Crash isolation:** If your Worker throws an uncaught error, Bibalak stops the Worker, removes its panels/commands, and marks it **Crashed** in Settings without affecting the rest of the app.

## 6. Test & Iterate Live

1. Open **Settings → Plugins** and click **Install plugin…** to select your plugin folder (or click **Install sample plugins** to inspect the four MIT samples under `examples/plugins/`).
2. Review the permissions in the consent dialog and click **Allow and enable**.
3. Edit `index.js` on disk, then click **Reload** in **Settings → Plugins** to restart the Worker with your latest changes.
4. For automated unit tests, see `apps/desktop/src/lib/pluginHost.test.ts`, which loads and runs every sample plugin inside `PluginHost`.

## 7. Package as a `.zip`

Zip either the contents of your plugin folder (with `plugin.json` at the archive root) or the single plugin folder itself:

```sh
cd my-first-plugin
zip -r ../my-first-plugin-1.0.0.zip plugin.json index.js README.md
```

Users can install the archive directly via **Settings → Plugins → Install .zip…**. Archives are checked for path traversal, symlinks, entry count (max 256), and extracted size (max 10 MB).
