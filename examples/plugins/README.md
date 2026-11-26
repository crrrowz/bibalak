# Sample plugins

Four small plugins for Bibalak plugin API 0.2.0, MIT licensed. Copy one to
start your own; the [plugin guide](../../docs/plugins/README.md) explains every
part.

| Folder                                     | Shows                                                     |
| ------------------------------------------ | --------------------------------------------------------- |
| [`focus-timer/`](focus-timer/)             | A panel with state and buttons, a command, no data access |
| [`today-at-a-glance/`](today-at-a-glance/) | Deck counts that refresh while you study                  |
| [`leech-helper/`](leech-helper/)           | Searching notes and opening Browse with a query           |
| [`note-checker/`](note-checker/)           | Scanning notes and media, handling errors in a panel      |

To try them: Settings → Plugins → **Install sample plugins**, then turn one
on. These files are compiled into the app (`crates/bibalak-plugin`), so a
change here ships with the next build; `apps/desktop/src/lib/pluginHost.test.ts`
loads all four.
