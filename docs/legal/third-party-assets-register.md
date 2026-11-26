# Third-party assets & borrowed ideas register

**Status: living list · Updated: 2026-11-15**

Everything in Bibalak that is **not our own work** — code, art, icons, fonts,
sounds, borrowed game mechanics and names — is listed here, with what must
happen before public launch (decisions D1, D5).

**Rule for every agent and contributor:** adding a third-party asset, pack,
font, sound or a mechanic/name taken from another product means adding a row
here **in the same commit**. The licence report (backlog step 3) checks that
this file exists; launch step `L2` works through it.

Libraries pulled in by `Cargo.toml` / `package.json` are **not** listed one by
one here: they are covered by the generated `THIRD_PARTY_NOTICES.md` (step 3).
Only list a library here when it needs action beyond a notice.

**Action values:** `Keep` (licence allows open-source and commercial use, notice
only) · `Replace` (must be swapped for our own before launch) · `License`
(buy or obtain a commercial licence before launch) · `Check` (licence not yet
verified).

## Code

| Item                  | Source / licence | Where used               | Action                                              |
| --------------------- | ---------------- | ------------------------ | --------------------------------------------------- |
| Synapse (fork origin) | MIT              | whole workspace          | Keep — notice in `THIRD_PARTY_NOTICES.md` must stay |
| Habitica code         | GPL-3.0          | **must never be copied** | — (re-implement from formulas only)                 |

## Fonts and icons

| Item                 | Source / licence                            | Where used            | Action                                                              |
| -------------------- | ------------------------------------------- | --------------------- | ------------------------------------------------------------------- |
| Figtree (variable)   | `@fontsource-variable/figtree`, OFL-1.1     | UI and card base font | Keep — notice                                                       |
| IBM Plex Sans Arabic | `@fontsource/ibm-plex-sans-arabic`, OFL-1.1 | Arabic UI             | Keep — notice                                                       |
| Literata (variable)  | `@fontsource-variable/literata`, OFL-1.1    | Scholar headings      | Keep — notice                                                       |
| Amiri                | `@fontsource/amiri`, OFL-1.1                | Scholar headings      | Keep — notice                                                       |
| Handjet (variable)   | `@fontsource-variable/handjet`, OFL-1.1     | Game headings & level | Keep — notice                                                       |
| Lucide icons         | `lucide-react`, ISC                         | all UI icons          | Keep for Default style; custom SVG set for progress/Game style (D1) |
| Bibalak logo         | own (`public/logos/bibalak-icon.svg`)       | app icon              | Own — trademark check at launch (`L3`)                              |

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

Known licence traps (asset licensing policy):
Habitica sprites are CC-BY-NC-SA (no commercial use) — never use them. CC0
packs (e.g. Kenney) can be kept; paid itch.io packs need their licence file
saved next to the asset.

## Borrowed mechanics and names (from Habitica and similar apps)

Mechanics and formulas are not protected, but names, item keys and wording can
be. Replace these with our own before launch.

| Borrowed item                                                                  | From              | Planned in                        | Action                                                        |
| ------------------------------------------------------------------------------ | ----------------- | --------------------------------- | ------------------------------------------------------------- |
| Task-value colour scale and scoring formula (`0.9747^v`), XP curve, crits      | Habitica          | `R1`, blueprint `01-…`            | Keep the maths in our own code; own constants where practical |
| Class names Warrior / Mage / Healer / Rogue and their skill names              | Habitica          | `R4`, blueprint `01-…`            | Replace with our own names                                    |
| Item keys like `weapon_warrior_3`, `Pet-Dragon-Base`, "Rest in the Inn"        | Habitica          | blueprints `02-…`, `04-…`, `05-…` | Replace with our own naming scheme                            |
| Habits / Dailies / To-Dos / Rewards four-column board                          | Habitica          | blueprint `03-…`                  | Keep concept, own layout and wording                          |
| Eisenhower matrix rule-editor and habit-tracker layouts modelled on other apps | productivity apps | `M2`, `M3`                        | Own layout and wording before launch                          |

## Compatibility names

| Item                                                    | Note                                                  | Action                                                    |
| ------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| "Anki", `.apkg` / `.colpkg`, Anki terms (Bury, Suspend) | Used for compatibility; "Anki" is someone else's name | Check wording on website and store pages at launch (`L3`) |
