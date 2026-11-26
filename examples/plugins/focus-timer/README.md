# Focus Timer (Sample Plugin)

**License:** MIT  
**API Version:** `0.2.0`  
**Capabilities:** `events:listen`, `ui:panel`

## What it does

Adds a **Focus Timer** sidebar panel with a 25-minute Focus / 5-minute Break Pomodoro timer that counts cards answered during your session via `ctx.onEvent` (`card-answered`).

## Files

- `plugin.json` — manifest declaring `events:listen` and `ui:panel`
- `index.js` — Worker entry point using `BibalakPlugin.definePlugin`
