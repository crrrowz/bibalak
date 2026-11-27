# Third-party assets and borrowed ideas

**Updated:** 2026-11-26

Everything in Bibalak that is **not the project's own work** — code, fonts,
icons, sounds, and mechanics or names taken from other products — is listed
here with its licence and what we do about it.

**For contributors:** adding a third-party asset, font, sound, or a mechanic or
name taken from another product means adding a row here **in the same pull
request**.

Libraries pulled in by `Cargo.toml` / `package.json` are not listed one by
one: they are covered by the generated
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md). A library is listed
here only when it needs more than a notice.

**Action values:** `Keep` (licence allows use and redistribution; notice
only) · `Own` (our own work) · `Avoid` (must never be used).

## Code

| Item                  | Source / licence | Where used      | Action                                              |
| --------------------- | ---------------- | --------------- | --------------------------------------------------- |
| Synapse (fork origin) | MIT              | whole workspace | Keep — notice in `THIRD_PARTY_NOTICES.md` must stay |
| Habitica code         | GPL-3.0          | not used        | Avoid — never copy; mechanics are re-implemented    |

## Fonts and icons

| Item                     | Source / licence                                                                | Where used                                                | Action                                                        |
| ------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| Figtree (variable)       | `@fontsource-variable/figtree`, OFL-1.1                                         | UI and card base font                                     | Keep — notice                                                 |
| IBM Plex Sans Arabic     | `@fontsource/ibm-plex-sans-arabic`, OFL-1.1                                     | Arabic UI                                                 | Keep — notice                                                 |
| Literata (variable)      | `@fontsource-variable/literata`, OFL-1.1                                        | Scholar headings                                          | Keep — notice                                                 |
| Amiri                    | `@fontsource/amiri`, OFL-1.1                                                    | Scholar headings                                          | Keep — notice                                                 |
| Handjet (variable)       | `@fontsource-variable/handjet`, OFL-1.1                                         | Game headings & level                                     | Keep — notice                                                 |
| Lucide icons             | `lucide-react`, ISC                                                             | all UI icons                                              | Keep — notice; progress and Game styles use our own SVG icons |
| Bibalak logo             | own (`public/logos/bibalak-icon.svg`)                                           | app icon                                                  | Own — see [`TRADEMARKS.md`](../../TRADEMARKS.md)              |
| Windows installer images | own (generated from `icons/icon.png` by `scripts/release/installer-images.mjs`) | NSIS and WiX installer BMPs (`src-tauri/installer/*.bmp`) | Own — derived from our own logo                               |

## Game-style art, sounds and UI kits

Every sprite pack, UI kit and sound file added for Game and Scholar styles gets
a row here.

| Pack / file                                                          | Source URL                                | Licence (exact) | Where used                                             | Action         |
| -------------------------------------------------------------------- | ----------------------------------------- | --------------- | ------------------------------------------------------ | -------------- |
| Kenney Interface Sounds (`glass_006.ogg` → `review_answer.mp3`)      | https://kenney.nl/assets/interface-sounds | CC0 1.0         | `apps/desktop/public/sounds/game/review_answer.mp3`    | Keep — CC0 1.0 |
| Kenney Interface Sounds (`confirmation_002.ogg` → `level_up.mp3`)    | https://kenney.nl/assets/interface-sounds | CC0 1.0         | `apps/desktop/public/sounds/game/level_up.mp3`         | Keep — CC0 1.0 |
| Kenney RPG Audio (`handleCoins2.ogg` → `purchase.mp3`)               | https://kenney.nl/assets/rpg-audio        | CC0 1.0         | `apps/desktop/public/sounds/game/purchase.mp3`         | Keep — CC0 1.0 |
| Kenney Interface Sounds (`confirmation_003.ogg` → `unlock.mp3`)      | https://kenney.nl/assets/interface-sounds | CC0 1.0         | `apps/desktop/public/sounds/game/unlock.mp3`           | Keep — CC0 1.0 |
| Kenney Interface Sounds (`confirmation_004.ogg` → `achievement.mp3`) | https://kenney.nl/assets/interface-sounds | CC0 1.0         | `apps/desktop/public/sounds/game/achievement.mp3`      | Keep — CC0 1.0 |
| Kenney Interface Sounds (`scroll_001.ogg` → `review_answer.mp3`)     | https://kenney.nl/assets/interface-sounds | CC0 1.0         | `apps/desktop/public/sounds/scholar/review_answer.mp3` | Keep — CC0 1.0 |
| Kenney Interface Sounds (`maximize_006.ogg` → `level_up.mp3`)        | https://kenney.nl/assets/interface-sounds | CC0 1.0         | `apps/desktop/public/sounds/scholar/level_up.mp3`      | Keep — CC0 1.0 |
| Kenney Interface Sounds (`drop_002.ogg` → `purchase.mp3`)            | https://kenney.nl/assets/interface-sounds | CC0 1.0         | `apps/desktop/public/sounds/scholar/purchase.mp3`      | Keep — CC0 1.0 |
| Kenney Interface Sounds (`glass_004.ogg` → `unlock.mp3`)             | https://kenney.nl/assets/interface-sounds | CC0 1.0         | `apps/desktop/public/sounds/scholar/unlock.mp3`        | Keep — CC0 1.0 |
| Kenney Interface Sounds (`confirmation_001.ogg` → `achievement.mp3`) | https://kenney.nl/assets/interface-sounds | CC0 1.0         | `apps/desktop/public/sounds/scholar/achievement.mp3`   | Keep — CC0 1.0 |

Known licence traps: Habitica sprites are CC-BY-NC-SA (no commercial use)
and must never be used. CC0 packs (such as Kenney's) are fine; a paid pack
needs its licence file saved next to the asset.

## Borrowed mechanics and names (from Habitica and similar apps)

Game mechanics and formulas are not protected, but names, item keys and
wording can be. Bibalak keeps only the ideas and uses its own names.

| Borrowed idea                                                        | From              | Status                                                |
| -------------------------------------------------------------------- | ----------------- | ----------------------------------------------------- |
| Task-value colour scale and scoring formula, XP curve, critical hits | Habitica          | Re-implemented in our own code with our own constants |
| Character classes and their skills                                   | Habitica          | Not used; Bibalak has its own paths and names         |
| Item and pet naming                                                  | Habitica          | Not used; Bibalak uses its own naming scheme          |
| Habits / dailies / to-dos / rewards board                            | Habitica          | Concept only; own layout and wording                  |
| Eisenhower matrix rule editor and habit-tracker layouts              | productivity apps | Concept only; own layout and wording                  |

## Compatibility names

| Item                                                    | Note                                                  | Action                                                   |
| ------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| "Anki", `.apkg` / `.colpkg`, Anki terms (Bury, Suspend) | Used for compatibility; "Anki" is someone else's name | Keep — describes compatibility only; see the README note |
