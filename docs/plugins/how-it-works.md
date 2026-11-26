# How plugins connect to the app

Updated 2026-11-26 · For plugin authors who want to know what happens behind
`ctx`, and for contributors who change the plugin system. The design
decision is [ADR-003](../architecture/adr/003-plugin-worker-sandbox.md).

## The parts

```text
 plugin.json + index.js
        │ install (folder or .zip)
        ▼
 Rust: bibalak-plugin (PluginManager)          <data folder>/plugins/
   checks the manifest, copies the files,  ──► installed/<id>/...
   keeps the on/off list                       state.json
        │ get_plugin_entry
        ▼
 React UI: PluginHost (apps/desktop/src/lib/pluginHost.ts)
   one Web Worker per enabled plugin
   ┌──────────────── Worker ────────────────┐
   │ bridge (BibalakPlugin, ctx)            │
   │ + your index.js                        │
   └────────────────────────────────────────┘
        ▲ postMessage both ways
        │
   host checks permission + rate limit ──► Tauri commands plugin_read_*
                                            Rust checks again, reads the
                                            collection, returns plain text
```

| Part                                                                                                                                  | Code                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Manifest rules, install, enable, disable, remove                                                                                      | `crates/bibalak-plugin/src/lib.rs`                                                       |
| Tauri commands (`list_plugins`, `install_plugin`, `install_plugin_zip`, `enable_plugin`, `plugin_read_decks`, `plugin_read_notes`, …) | `apps/desktop/src-tauri/src/commands/plugins.rs`                                         |
| Sandbox, bridge, message checks, limits                                                                                               | `apps/desktop/src/lib/pluginHost.ts`                                                     |
| Starting enabled plugins when the app opens                                                                                           | `apps/desktop/src/features/plugins/PluginBootHost.tsx`                                   |
| Settings → Plugins, consent dialog                                                                                                    | `apps/desktop/src/features/settings/PluginManagerSection.tsx`, `PluginConsentDialog.tsx` |
| Panel drawer                                                                                                                          | `apps/desktop/src/features/plugins/PluginPanelView.tsx`                                  |
| Public types                                                                                                                          | `packages/plugin-sdk/src/index.ts`                                                       |
| Bundled samples (compiled into the app)                                                                                               | `examples/plugins/`                                                                      |

## Where plugins live

In the app's data folder (`%APPDATA%\com.keepsake.desktop` on Windows,
`~/Library/Application Support/com.keepsake.desktop` on macOS,
`~/.local/share/com.keepsake.desktop` on Linux; in portable mode, next to
the app; see [the install guide](../guides/install.md)):

```text
plugins/
  installed/<plugin id>/   a copy of the plugin folder
  state.json               {"enabled": ["<id>", ...]}
```

Installing copies your folder (or unpacks your zip) into
`installed/<id>/`, replacing any older copy with the same id, and turns the
plugin **off**. Removing deletes that folder. The app never runs code from
anywhere else.

## Life of a plugin

1. **Install.** Rust reads `plugin.json`, checks the id, the entry path, the
   API version and that every permission is active in 0.2, and that the entry
   file exists. Zips are unpacked first with limits (256 files, 10 MB, no
   symlinks, no paths that leave the folder).
2. **Enable.** The UI shows the consent dialog with the permissions. On
   **Allow and enable**, Rust adds the id to `state.json`.
3. **Start.** When the app opens (and right after enabling), the UI reads the
   entry script through Rust and starts a Web Worker with the bridge code
   followed by your script, as one in-memory file.
4. **Run.** Your `activate(ctx)` registers commands and panels. Each
   registration is a message to the host, which shows it in the palette,
   Settings or the sidebar. Clicks travel back as messages and call your
   handlers.
5. **Stop.** Disabling, removing, reloading or closing the app ends the
   Worker. Its commands and panels disappear at once.
6. **Crash.** An uncaught error in your code ends the Worker, removes its
   commands and panels, shows a toast and marks the plugin **Crashed** with
   the message. **Reload** starts it again.

## What the sandbox allows

The Worker has no `window` or `document`, no access to the app's storage,
Tauri IPC or card HTML, and the app's content security policy blocks network
requests from it. All it can do is send messages to the host.

Every message is checked **on the host**, because a plugin could skip the
bridge and call `self.postMessage` itself:

- each request is matched against the permissions in the manifest;
- data requests are limited to 30 per 10 seconds per plugin;
- text is cut to its limit (queries 500, toasts 500, keybinding hints 64) and
  panel blocks are rebuilt from known types only (100 at most);
- navigation goes only to a deck or to Browse.

Data requests then go to Rust, which checks **again** that the plugin is
installed, enabled and has the permission, before it reads the collection.
Notes leave Rust as plain text with media names only, so no card HTML or
script ever reaches a plugin.

## Changing the plugin system

For contributors:

- A new capability needs a design note or ADR, a row in the permission
  table of [`README.md`](README.md) and [`api.md`](api.md), the type in
  `packages/plugin-sdk`, the check in both `pluginHost.ts` and the Rust
  command, a consent-dialog string in both languages, and tests on both
  sides (`pluginHost.test.ts`, `bibalak-plugin` and the command tests).
- A breaking change to `ctx` bumps the API minor (`0.3.0`) in
  `packages/plugin-sdk`, `bibalak-plugin` (`PLUGIN_API_VERSION`) and the
  version check in `PluginBootHost.tsx`; then update the samples.
- The samples are compiled into the app (`include_str!`), so a broken sample
  breaks the build: run `pluginHost.test.ts`, which loads all four.
