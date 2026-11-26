# Writing a Bibalak plugin

Plugin API **0.2.0** · Updated 2026-11-26

A plugin is a small JavaScript program that adds a command, a side panel or
both to Bibalak. It can read your decks and notes (plain text only) and react
when you study, but it cannot change your collection, reach the network or
touch the app's window. Every plugin runs in its own sandbox and asks the user
for its permissions before it starts.

This folder has three pages:

| Page                                 | Read it when                                                      |
| ------------------------------------ | ----------------------------------------------------------------- |
| This page                            | You want a working plugin, step by step                           |
| [`api.md`](api.md)                   | You need the exact shape of `ctx`, the panel blocks or the limits |
| [`how-it-works.md`](how-it-works.md) | You want to know how the app loads, runs and checks a plugin      |

Four finished plugins live in [`examples/plugins/`](../../examples/plugins/)
(MIT). Copy one when you start; they cover every part of the API.

## 1. What a plugin is

A folder with two files:

```text
my-plugin/
  plugin.json   the manifest: id, name, version, permissions
  index.js      the code, one file, run inside a Web Worker
  README.md     optional, shown to people who read your folder
```

`index.js` must be a single file: the app loads it as one script, so
`import` and `importScripts` of other files do not work. If you write
TypeScript or several modules, bundle them into one file first (section 7).

## 2. The manifest

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "entry": "index.js",
  "description": "Shows how many cards are due today.",
  "author": "Your Name",
  "apiVersion": "0.2.0",
  "permissions": ["read:decks", "ui:command"]
}
```

| Field         | Rule                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | 1–128 characters: letters, digits, `.`, `_`, `-`; not starting with `.`. It is also the folder name on disk, so keep it stable across versions. |
| `name`        | Shown in Settings → Plugins and the consent dialog.                                                                                             |
| `version`     | Your plugin's version. Use semver.                                                                                                              |
| `entry`       | Path to the code, relative to the folder; no `..`, no absolute path.                                                                            |
| `apiVersion`  | `"0.2"` or `"0.2.x"`. Any other version is refused at install.                                                                                  |
| `permissions` | Only what you use. Each one is shown to the user. See the table below.                                                                          |

| Permission      | Gives you                                                               |
| --------------- | ----------------------------------------------------------------------- |
| `read:decks`    | `ctx.decks.list()`: deck names, parents and today's counts              |
| `read:notes`    | `ctx.notes.search()`, `get()`, `checkMediaMissing()`: plain-text fields |
| `ui:command`    | `ctx.registerCommand()`: an entry in the command palette (`Ctrl+K`)     |
| `ui:panel`      | `ctx.addSidebarPanel()`: a panel built from blocks                      |
| `events:listen` | `ctx.onEvent()`: told when a card is answered, notes change, and so on  |

`ctx.showToast()` and `ctx.navigation` need no permission. A manifest that
asks for a reserved permission (`write:cards`, `net:fetch`, `ui:review-button`,
`ai:*`) is refused at install: those are planned for a later API.

## 3. The code

The app puts a global `BibalakPlugin` into the sandbox before your code runs.
Call `BibalakPlugin.definePlugin` once with an `activate` function; it gets
the context `ctx`, which is everything your plugin can do.

```js
/* global BibalakPlugin */

BibalakPlugin.definePlugin({
  activate(ctx) {
    ctx.registerCommand({
      id: "due-today",
      title: "My Plugin: cards due today",
      async run() {
        const decks = await ctx.decks.list();
        const due = decks.filter((d) => !d.isFiltered).reduce((sum, d) => sum + d.dueToday, 0);
        ctx.showToast(`Due today: ${due}`);
      },
    });
  },
});
```

A panel is a list of blocks that you replace whenever your state changes:

```js
BibalakPlugin.definePlugin({
  async activate(ctx) {
    const render = (decks) => [
      { type: "heading", text: "Today" },
      ...decks.map((d) => ({ type: "stat", label: d.name, value: String(d.dueToday) })),
      { type: "actions", buttons: [{ id: "refresh", label: "Refresh", variant: "primary" }] },
    ];

    const panel = ctx.addSidebarPanel({
      id: "today",
      title: "Today",
      blocks: [{ type: "text", text: "Loading…", tone: "muted" }],
      async onAction(actionId) {
        if (actionId === "refresh") panel.update(render(await ctx.decks.list()));
      },
    });

    panel.update(render(await ctx.decks.list()));
    ctx.onEvent((event) => {
      if (event.type === "card-answered") ctx.decks.list().then((d) => panel.update(render(d)));
    });
  },
});
```

That one needs `read:decks`, `ui:panel` and `events:listen`.

**Errors stop the plugin.** An error thrown from `activate`, a command, a
panel action or an event handler (or a rejected promise from one) marks the
plugin **Crashed** and stops it; its commands and panels disappear. Catch the
errors you expect and show them in your panel instead; see
[`note-checker`](../../examples/plugins/note-checker/index.js).

## 4. Types in your editor

The API is described in TypeScript in
[`packages/plugin-sdk/src/index.ts`](../../packages/plugin-sdk/src/index.ts)
(MIT; not on npm yet). Copy that file next to your code and add at the top of
`index.js`:

```js
/// <reference path="./bibalak-plugin-sdk.d.ts" />
/** @typedef {import("./bibalak-plugin-sdk").PluginContext} PluginContext */
```

Rename the copy to `bibalak-plugin-sdk.d.ts` (or keep it `.ts` and use
`@ts-check` with a `jsconfig.json`). Your editor then completes `ctx.` and
checks the panel blocks.

## 5. Install and try it

1. Open **Settings → Plugins → Install plugin…** and pick your folder (or
   **Install .zip…** for an archive).
2. The plugin installs **off**. Turn it on: the consent dialog lists its
   permissions; choose **Allow and enable**.
3. Your command is in the command palette (`Ctrl+K` / `⌘K`) and in Settings →
   Plugins; your panel opens from the sidebar's plugin panel button.
4. Changed the code? Install the folder again (it replaces the copy and turns
   the plugin off), then enable it again. **Reload** in Settings restarts the
   installed copy, which is the quickest way to retry after a crash.

The app keeps its own copy of the plugin in its data folder (see
[`how-it-works.md`](how-it-works.md#where-plugins-live)); editing your source
folder does not change the installed copy until you install again. For a
fast loop while you work, edit `index.js` inside the installed copy
(`<data folder>/plugins/installed/<id>/`) and press **Reload**: it reads the
script from disk again without asking for consent. Copy your changes back to
your source folder when you are done.

**Debugging.** Plugin errors are written to the developer console as
`[plugin:<id>]`. In a development build (`pnpm tauri dev`) open the web
inspector with right-click → Inspect; `console.log` from your plugin appears
there too. A crashed plugin shows its error message in Settings → Plugins.

**Without the desktop app.** The browser preview (`pnpm dev:web`, then
`http://localhost:1420/preview.html`) runs the real plugin host against fake
data, so you can try panels and commands without Rust.

## 6. Test it

The app's own tests load every sample plugin in the real host:
[`apps/desktop/src/lib/pluginHost.test.ts`](../../apps/desktop/src/lib/pluginHost.test.ts).
Copy that pattern to test your plugin with Vitest: create a `PluginHost`,
give it a fake data bridge that returns your test decks and notes, `load` your
code, invoke a command or panel action, and check the panels and toasts.

## 7. Bundle and ship

**Bundling** (only if you have more than one source file or use TypeScript):

```sh
npx esbuild src/main.ts --bundle --format=iife --target=es2020 --outfile=dist/index.js
```

Ship `dist/index.js` as the `entry`. Do not bundle anything that needs the
DOM, `fetch` or Node built-ins; none of them work in the sandbox.

**Packaging.** Zip the folder with `plugin.json` at the top of the archive (or
the folder itself as the only top entry):

```sh
cd my-plugin
zip -r ../my-plugin-1.0.0.zip plugin.json index.js README.md
```

The installer refuses archives with more than 256 files, more than 10 MB
unpacked, symbolic links, or paths that leave the folder.

**Publishing.** There is no plugin store yet. Share the zip on your own
GitHub releases page and tell users to install it with **Install .zip…**. Say
in your README which permissions you ask for and why.

**Versions.** Bump `version` in `plugin.json` for every release. Plugins for
API `0.2.x` keep working for every `0.2` release of the app; a new minor API
(`0.3`) may change the contract; the app then shows older plugins as
**Incompatible API** and will not start them until you test and update
`apiVersion`.

## 8. The samples

| Sample                                                           | Shows                                                     | Permissions                               |
| ---------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| [`focus-timer`](../../examples/plugins/focus-timer/)             | A panel with state and buttons, a command, no data access | `ui:panel`, `ui:command`                  |
| [`today-at-a-glance`](../../examples/plugins/today-at-a-glance/) | Deck counts that refresh on study events                  | `read:decks`, `ui:panel`, `events:listen` |
| [`leech-helper`](../../examples/plugins/leech-helper/)           | Searching notes and opening Browse with a query           | `read:notes`, `ui:panel`, `ui:command`    |
| [`note-checker`](../../examples/plugins/note-checker/)           | Scanning notes, missing media, error handling in a panel  | `read:notes`, `ui:panel`                  |

**Install sample plugins** in Settings → Plugins installs all four (off).

## 9. Questions

- **Can a plugin change cards or add notes?** Not in 0.2. `write:cards` is
  planned; until then a plugin can open Browse or a deck for the user.
- **Can it call a web API?** No. The sandbox has no network; `net:fetch` is
  planned behind its own design review.
- **Can it show HTML?** No. Panels are built only from the blocks in
  [`api.md`](api.md#panel-blocks); the app draws them in its own style, in
  both languages and all three styles.
- **Can it store settings?** Not yet: there is no storage API in 0.2, and a
  plugin's memory is lost when it stops.
- **Does it run on macOS and Linux?** Yes; plugins are plain JavaScript and
  run the same everywhere the app runs.
