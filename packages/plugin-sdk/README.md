# `@bibalak/plugin-sdk` (MIT)

Public TypeScript contract for [Bibalak](https://github.com/crrrowz/bibalak) plugins targeting **API `0.2.0`**.

Plugins run inside a sandboxed Web Worker (`PluginHost`). They have no access to `window`, `document`, the Tauri IPC bridge, or external network endpoints, and they interact with Bibalak exclusively through the capability-scoped `PluginContext` passed to `activate(ctx)`.

## Quick Example

```js
/// <reference types="@bibalak/plugin-sdk" />

BibalakPlugin.definePlugin({
  activate(ctx) {
    ctx.registerCommand({
      id: "hello",
      title: "Hello from plugin",
      run() {
        ctx.showToast("Hello from " + ctx.manifest.name + "!");
      },
    });
  },
});
```

## Capabilities (`0.2.0`)

| Capability      | Description                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `read:decks`    | Read deck names and due card counts (`ctx.decks.list()`).                                                   |
| `read:notes`    | Search notes up to a bounded limit with plain-text fields and check missing media references (`ctx.notes`). |
| `ui:panel`      | Register an interactive declarative sidebar panel (`ctx.addSidebarPanel`).                                  |
| `ui:command`    | Register commands in the Command Palette and Settings (`ctx.registerCommand`).                              |
| `events:listen` | Subscribe to study and collection events (`ctx.onEvent`).                                                   |

### Reserved Capabilities (Rejected in `0.2.0`)

The following capabilities are reserved for future API versions and are rejected at install time:
`write:cards`, `ui:review-button`, `net:fetch`, `ai:card-hint`, `ai:note-fill-back`, `ai:deck-summary`.

## License

MIT — see the root `LICENSE` notice or individual sample plugins under `examples/plugins/`.
