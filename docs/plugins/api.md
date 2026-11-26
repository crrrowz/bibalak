# Plugin API reference (0.2.0)

Updated 2026-11-26 · The source of truth is
[`packages/plugin-sdk/src/index.ts`](../../packages/plugin-sdk/src/index.ts);
this page explains it. Start with the [guide](README.md) if you have not
written a plugin yet.

## Entry point

```ts
BibalakPlugin.definePlugin({
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
});
```

Call `definePlugin` once, at the top level of your script. `activate` runs
right away. In 0.2 the app stops a plugin by ending its sandbox, so
`deactivate` is not called; do not rely on it to save anything.

## `ctx` at a glance

| Member                          | Permission      | Returns                              |
| ------------------------------- | --------------- | ------------------------------------ |
| `ctx.manifest`                  | —               | Your `plugin.json`, read-only        |
| `ctx.registerCommand(cmd)`      | `ui:command`    | `Disposable`                         |
| `ctx.addSidebarPanel(panel)`    | `ui:panel`      | `SidebarPanelHandle`                 |
| `ctx.showToast(message)`        | —               | nothing                              |
| `ctx.onEvent(handler)`          | `events:listen` | `Disposable`                         |
| `ctx.decks.list()`              | `read:decks`    | `Promise<PluginDeckSummary[]>`       |
| `ctx.notes.search(q, opts?)`    | `read:notes`    | `Promise<PluginNoteSummary[]>`       |
| `ctx.notes.get(noteId)`         | `read:notes`    | `Promise<PluginNoteSummary \| null>` |
| `ctx.notes.checkMediaMissing()` | `read:notes`    | `Promise<string[]>`                  |
| `ctx.navigation.openDeck(id)`   | —               | nothing                              |
| `ctx.navigation.openBrowse(q?)` | —               | nothing                              |

Calling a member without its permission throws
`Plugin permission denied: <permission>`. The app checks again on its side,
so editing the sandbox does not get around it.

## Commands

```ts
interface CommandDefinition {
  id: string; // unique within your plugin
  title: string; // shown in the palette; start it with your plugin's name
  keybinding?: string; // a hint shown next to the title, e.g. "mod+shift+k" (max 64 chars)
  run(): void | Promise<void>;
}
```

The command appears in the command palette (`Ctrl+K` / `⌘K`) and in
Settings → Plugins. `keybinding` is only shown as a hint in 0.2; it does not
bind a key. `dispose()` removes the command. Registering the same `id` again
replaces it.

## Panels

```ts
interface SidebarPanelDefinition {
  id: string;
  title: string;
  blocks: PanelBlock[];
  onAction?(actionId: string, payload?: unknown): void | Promise<void>;
}

interface SidebarPanelHandle {
  update(blocks: PanelBlock[]): void; // replaces all blocks
  dispose(): void; // removes the panel
}
```

Each panel gets a button in the sidebar; the panel opens in a drawer. Keep
your state in variables and call `update` with a full new list of blocks
whenever it changes.

### Panel blocks

| Block                                                               | Draws                                                       |
| ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `{ type: "heading", text }`                                         | A section title                                             |
| `{ type: "text", text, tone? }`                                     | A paragraph                                                 |
| `{ type: "stat", label, value }`                                    | A label with a value beside it (pass numbers as strings)    |
| `{ type: "badge", text, tone? }`                                    | A small coloured tag                                        |
| `{ type: "actions", buttons: [{ id, label, variant?, payload? }] }` | A row of buttons; `variant` is `"primary"` or `"secondary"` |
| `{ type: "list", items: [...], emptyText? }`                        | A list; `emptyText` shows when `items` is empty             |
| `{ type: "divider" }`                                               | A line                                                      |

`tone` is one of `"default"`, `"muted"`, `"accent"`, `"warning"`,
`"danger"`. A list item is:

```ts
{ id: string; title: string; subtitle?: string; badge?: string;
  actionLabel?: string; actionId?: string; actionPayload?: unknown }
```

A button click calls `onAction(button.id, button.payload)`; a list item's
action calls `onAction(item.actionId, item.actionPayload)`. Payloads are
copied between the app and your sandbox, so use plain JSON values.

Blocks are text only. The app draws them with its own components, in the
user's language direction and style; there is no way to add HTML, images or
your own CSS. A panel shows at most 100 blocks; unknown block types are
dropped.

## Toasts

`ctx.showToast(message)` shows a short message at the corner of the window
(up to 500 characters). Use it for the result of a command, not for errors
you can show in a panel.

## Events

```ts
type PluginEvent =
  | { type: "card-answered" } // a card was answered in study
  | { type: "notes-changed" } // notes were added, edited or deleted
  | { type: "deck-changed" } // decks were added, renamed, moved or deleted
  | { type: "collection-opened" }
  | { type: "collection-closed" }
  | { type: "schema-changed" }; // note types or a large import changed the collection
```

Events say only _that_ something changed; read the data again if you need
it. The app also sends a few internal event types (for example
`"media-changed"`, `"productivity-changed"`, `"game-changed"`); ignore types
you do not know, since they may change without notice. Events arrive often
during study: if you reload data on `card-answered`, keep it cheap or wait a
moment before you read.

## Decks

```ts
interface PluginDeckSummary {
  id: number;
  name: string; // full name with "::" between levels
  parentId: number | null;
  newCount: number; // what the user will see today
  learningCount: number;
  reviewCount: number;
  dueToday: number; // new + learning + review
  isFiltered: boolean; // a filtered (custom study) deck
}
```

At most 500 decks are returned. A card in a filtered deck is counted there,
not in its home deck, so skip `isFiltered` decks only if you want home decks
alone. Counts are the same numbers the Decks screen shows.

## Notes

```ts
interface PluginNoteSummary {
  noteId: number;
  deck: string;
  notetype: string;
  sortField: string; // plain text
  tags: string[];
  fields: { name: string; text: string }[]; // plain text, HTML removed
  mediaRefs: string[]; // file names of images and sounds the note uses
}
```

- `search(query, { limit })` uses the same search language as Browse
  (`deck:"Spanish"`, `tag:verbs`, `is:due`, words…). `""` matches every note.
  `limit` defaults to 50 and is capped at 200; the query is cut at 500
  characters. Results come in Browse's default order.
- `get(noteId)` returns one note, or `null`. **Known limit in 0.2:** it only
  looks among the first 200 notes of the collection, so it can return `null`
  for a note that exists. Until this is fixed, prefer `search` with a query
  that finds the note.
- `checkMediaMissing()` returns the names of media files that notes use but
  that are not in the media folder (at most 1000).

Fields are always plain text: you never see the note's HTML, scripts or
styling, and you cannot open its media files.

## Navigation

- `openDeck(deckId)` opens the study screen for that deck.
- `openBrowse(query?)` opens Browse with the search box filled in (the query
  is cut at 500 characters).

## Limits

| Limit                         | Value                            | What happens                      |
| ----------------------------- | -------------------------------- | --------------------------------- |
| Data calls (`decks`, `notes`) | 30 in any 10 seconds, per plugin | The call is refused with an error |
| Notes per search              | 200                              | Capped silently                   |
| Search query                  | 500 characters                   | Cut                               |
| Decks per list                | 500                              | Capped silently                   |
| Panel blocks                  | 100 per panel                    | Extra blocks dropped              |
| Toast                         | 500 characters                   | Cut                               |
| Plugin archive                | 256 files, 10 MB unpacked        | Install refused                   |
| Uncaught error                | —                                | Plugin stopped and marked Crashed |

## Not in 0.2

Writing cards or notes, review-screen buttons, network access, AI helpers
and settings storage. The first four are reserved as permissions
(`write:cards`, `ui:review-button`, `net:fetch`, `ai:card-hint`,
`ai:note-fill-back`, `ai:deck-summary`) and refused at install for now. Each
will come with its own design review; open a discussion on GitHub if you
need one.
