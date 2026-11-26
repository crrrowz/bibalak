# Note Checker (Sample Plugin)

**License:** MIT  
**API Version:** `0.2.0`  
**Capabilities:** `read:notes`, `ui:panel`

## What it does

Scans up to 100 notes via `ctx.notes.search` and `ctx.notes.checkMediaMissing()` to detect:

- Notes with empty fields (no text and no media references)
- Notes referencing missing media files

Displays findings in the **Note Checker** sidebar panel with one-click **Open in Browse**.
