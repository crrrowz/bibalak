# Bibalak User Guide

## Getting started

1. Install Bibalak, or unzip the portable Windows copy — see
   [Install, build and portable use](install.md).
2. On first launch the **Default** deck is ready. Create decks from the
   **Decks** screen, or import your Anki collection.
3. The interface language follows your system (English or Arabic). Change it
   any time in **Settings → General → Language**, with the `EN` / `AR` button
   in the sidebar footer, or with **⌘K / Ctrl+K → Switch to Arabic / English**.
4. The sidebar lists study screens (**Decks**, **Browse**, **Add**, **Note
   Types**, **Media**, **Stats**, **Assistant**) followed by the **Plan** group
   (**Matrix**, **Habits**, **Calendar**). The sidebar footer holds quick icon
   buttons for **Settings**, **Language**, **Theme**, **Style** (`Default` /
   `Scholar` / `Game`), and **Sound volume** (`0–100` sliders and mute toggles
   for card audio/TTS and UI/game sound effects).

Updating from an earlier Synapse build? Your collection, media, backups and
plugins are copied over automatically in the background after first launch; the
old folder is left untouched.

---

## Importing from Anki

Bibalak reads Anki `.apkg` and `.colpkg` files (schema v11 and v18),
including review history, media and FSRS state.

1. In Anki: **File → Export** → _Anki Collection Package_ (`.colpkg`) or
   _Anki Deck Package_ (`.apkg`).
2. In Bibalak: **Decks → Import** (or **⌘K / Ctrl+K → Import**) and pick the
   file.
3. Notes are matched by their ID, so importing the same file again updates
   instead of duplicating. Missing parent decks in imported hierarchies are
   created automatically.

Shared decks from the internet are safe to open: card templates run in a
sandbox with no access to your collection, files or the network.

---

## Importing CSV, TSV and Markdown

Use **Decks → Import text** (or **⌘K / Ctrl+K → Import CSV / Markdown**) to
bring notes from UTF-8 text files (`.csv`, `.tsv`, `.txt`, `.md`):

- **CSV / TSV / semicolon files:** UTF-8 with or without BOM (Arabic supported).
  Delimiter (comma, tab or semicolon) is auto-detected from sample rows and can
  be overridden in the options bar. Quoted fields may contain embedded newlines.
  Toggle **First row is header** and **Allow HTML** before mapping columns to
  fields, **Tags** (space- or comma-separated) or **Ignore**.
- **Markdown files (`.md`, `.markdown`):**
  1. **`##` heading sections:** Each level-2 heading (`## Front`) starts one note
     whose front is the heading and whose back is the Markdown body rendered to
     HTML until the next `##` heading, `---` divider or `Q:` block. Level-1
     headings (`# Title`) outside notes and fenced code blocks are ignored.
  2. **`Q:` / `A:` pairs:** A line beginning with `Q:` starts the front and the
     matching `A:` paragraph becomes the back.
  3. **`==text==` cloze highlights:** Inside any Markdown note (or a standalone
     paragraph containing `==...==`), highlighted spans convert sequentially to
     `{{c1::text}}`, `{{c2::text}}`, resetting per note. Select a **Cloze** note
     type when importing highlighted notes.
- **Duplicates:** Checked using Anki's first-field SHA-1 checksum with a choice
  of **Skip**, **Update** or **Keep both**. Any invalid lines report their
  1-based source line numbers in the summary.

---

## Studying

1. Click a deck, or **Study now** on the home screen (in Hero layout).
2. Read the question, press **Space** or **Enter** to reveal the answer.
3. Rate yourself with the buttons or the number keys.

With FSRS on a review card you get three buttons — **Forgot / Remembered /
Easy** (keys 1–3). Otherwise four — **Again / Hard / Good / Easy** (keys 1–4).

| Action                | Key                                                |
| --------------------- | -------------------------------------------------- |
| Show answer           | Space / Enter                                      |
| Rate                  | 1–4 (or 1–3)                                       |
| Open AI Tutor         | T (after reveal)                                   |
| Replay audio          | R                                                  |
| Suspend card          | S                                                  |
| Bury card             | B                                                  |
| Undo last action      | Z                                                  |
| Focus mode on / off   | F / Esc                                            |
| Flag                  | flag menu under the card (right-click it to clear) |
| Command palette       | ⌘K / Ctrl+K                                        |
| Keyboard shortcuts    | ?                                                  |
| Dock / undock sidebar | Alt+Z                                              |

Cards follow their own text direction: an Arabic card reads right-to-left even
in the English interface, and the other way round.

### How a study session works

- **The three count badges:** Each deck and study header shows three numbers by
  card type (badges hide automatically once their count reaches `0`):
  - **Blue — New:** Never-studied cards remaining within today's daily limit.
  - **Amber — Learning:** Cards currently in short-interval learning or
    relearning steps due before today ends (including cards waiting out a 1- or
    10-minute step). That is why the amber badge climbs as you introduce new
    cards, then disappears once those cards graduate to tomorrow's reviews.
  - **Green — Review:** Previously graduated cards scheduled for today, capped
    by today's review limit.
- **Learning steps:** By default, new cards step through **1 minute** and **10
  minutes** (**Deck options → New cards**). Rating **Again** restarts a card on
  the 1-minute step so it returns ahead of further new cards once that minute is
  up; rating **Good** advances to the 10-minute step and then graduates the card
  to Review (`≥ 1 day`). Lapsed review cards enter a 10-minute relearning step
  (**Deck options → Lapses**).
- **Daily limits (including parent & subdeck):** Set each deck's daily new-card
  and review limits in **Deck options → General**. Studying a parent deck caps
  each subdeck by the lowest remaining limit of itself and every ancestor up to
  the deck you clicked — so a parent limited to 20 new cards/day introduces at
  most 20 new cards total across all its subdecks combined. Studying a subdeck
  directly uses that subdeck's own remaining limits. Filtered decks study in
  isolation. The study day rolls over at the hour set in **Settings → Study**
  (default `04:00`).
- **Learn-ahead at the end of a session:** Once all due-now learning, new, and
  review cards are done, Bibalak shows any remaining learning cards scheduled
  for later today (soonest due first) so you can finish your session without
  waiting out the final minutes.
- **"Increase today's new card limit":** When you finish a session and want
  more new cards today, use **Increase today's new card limit** on the "All
  done" screen; the extra allowance applies to today only.

---

## Adding and editing notes

1. **Add** in the sidebar (or open **Quick Add** with your global shortcut).
2. Choose the note type and deck, fill in the fields (rich text, images, audio,
   math with KaTeX).
3. **Add Note**.

For **Image Occlusion**, choose an image and drag to mark regions; each region
becomes its own card. Edit existing notes from **Browse** (click a row).

---

## Note types and templates

**Note Types** lets you add or reorder fields, edit card templates (with a live
preview) and edit card CSS. Template syntax follows Anki: `{{Field}}`,
`{{#Field}}…{{/Field}}`, `{{^Field}}…{{/Field}}`, `{{cloze:Field}}`,
`{{type:Field}}`, `{{hint:Field}}`, `{{tts …:Field}}`.

---

## Deck options

**⋯** next to a deck → **Deck options**.

| Tab       | Settings                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| General   | Algorithm (SM-2 / FSRS), new cards and reviews per day                                                                                      |
| New cards | Learning steps, graduating and easy intervals, starting ease                                                                                |
| Reviews   | Easy bonus, hard interval, interval modifier, maximum interval                                                                              |
| Lapses    | Relearning steps, new interval, minimum interval, leech threshold                                                                           |
| FSRS      | Desired retention, weights (21 FSRS-6 values), **Optimize FSRS weights** (≥ 400 reviews), and **Workload projection** simulator (30d / 90d) |

---

## Browse

Search with Anki-style queries (press **?** next to the search box for the
cheat-sheet):

| Query                                | Meaning                                                        |
| ------------------------------------ | -------------------------------------------------------------- |
| `deck:Spanish`                       | Cards in the Spanish deck (`deck:Spanish*` includes sub-decks) |
| `tag:grammar`                        | Notes tagged "grammar"                                         |
| `is:due` / `is:new` / `is:suspended` | Card state                                                     |
| `flag:1`                             | Red flag                                                       |
| `prop:ivl>30`                        | Interval over 30 days                                          |
| `added:7`                            | Added in the last 7 days                                       |
| `-tag:easy`                          | Negate with `-`                                                |

Plain-text search ignores Arabic diacritics (tashkeel), tatweel, alef/hamza,
taa-marbuta (`ة`/`ه`), and alef-maqsura (`ى`/`ي`) variants as well as Latin
accents (e.g. `الاسلام` finds `الإسلام`, `cafe` finds `café`), while `tag:` and
`deck:` filters remain exact.

Select rows (Shift/⌘-click) to use the grouped bulk action bar: **Study state**
(suspend/unsuspend, bury/unbury), **Flag**, **Tags**, **Move to deck**,
**More** (preview, forget, set due date, reposition new cards, find & replace,
change note type, check quality with AI), and **Delete**. The tag sidebar
renames and deletes tags.

### Filtered decks (custom study)

**Decks → Filtered**: give a name, a search query, an order and a limit.
**Empty** returns the cards to their original decks with their scheduling
intact.

---

## Media Library

**Media** lists stored images, audio, and video files with note usage counts.

- Filter by filename, **Deck**, **Tag**, **File type** (`All`, `Images`,
  `Audio`, `Video`, `Other`), or **Usage** (`All files`, `Used`, `Unused`), and
  sort by **Name**, **Largest**, or **Most used**.
- Click any tile to open the preview panel (`Esc` closes it) showing the image,
  video, or built-in audio player (`Play`/`Pause` and seek timeline, using the
  sidebar app volume), file size, usage count, and **Show notes using it** in
  Browse.
- **Delete unused** permanently removes unreferenced files (disabled while a
  background legacy migration is still finishing).

---

## Statistics

**Stats** shows your **Study progress** summary, reviews, retention, streak,
time, an activity heatmap, retention over time, answer buttons, reviews by hour,
a 30-day forecast, card maturity, the FSRS memory model and a per-deck table.
Filter by deck and range, export CSV, or click a chart to open the matching
cards in Browse.

---

## Progress

Bibalak tracks your effort with one progress engine shared across every style:

- **Card reviews:** You earn XP and gold once per card per day (until the day
  rollover hour): **Again** earns 1 XP, **Hard** earns 2 XP, and **Good** or
  **Easy** earns 3 XP, plus **0.25 gold** per rewarded review. Manual
  reschedules earn nothing.
- **Tasks:** Completing a task in the Matrix earns **10 XP** and **1 gold**, up
  to **10 rewarded tasks per day** (extra tasks still complete without XP or
  gold). Reopening a task revokes that reward.
- **Habits:** Completing a habit target earns **10 XP** and **1 gold** once per
  habit per day for today or yesterday (older logs save without reward).
- **Undo-safe:** Undoing a card review, task completion, or habit check-in
  reverses its reward automatically.
- **Levels and progress panel:** XP advances your level (`50 * level + 50` XP
  per level). A **Study progress** panel appears at the top of **Decks** and
  inside **Stats**, showing your level, progress bar, total XP, gold (or
  **knowledge points** in Scholar), and today's XP.
- **Yesterday summary card:** At the start of a new day, if yesterday had at
  least one completed review, task, or habit, a dismissible **Yesterday** card
  appears on **Decks** showing reviews, tasks, habits, XP, and gold earned.

---

## Presentation styles

Change presentation styles in **Settings → General → Appearance → Style**.
Styles change colors, fonts, wording, and progress extras without changing
points or scheduling rules.

- **Default:** Bibalak's calm Study Lamp desk look with quiet numbers and
  progress bars.
- **Scholar:** Classic library palette with serif headings (Literata for Latin,
  Amiri for Arabic), academic ranks from **Student** (Level 1) to **Researcher**
  (Level 5), **Lecturer** (Level 10), **Assistant Professor** (Level 20), and
  **Professor** (Level 35), **knowledge points** instead of gold, promotion
  certificates (customize your name under **Settings → General → Appearance**),
  and a **Transcript** link (`/transcript`) showing earned certificates, per-course
  deck rollups, and a 30-day **Lecture log** (including completed tasks and
  habits).
- **Game (coming later):** Shown disabled in Settings until it is built.

---

## Plan

The **Plan** group in the sidebar brings your study organization tools together.

### Eisenhower Matrix

Open **Plan → Matrix** to organize tasks and due study decks across four boxes:
**I — Urgent & important**, **II — Important, not urgent**, **III — Urgent, not
important**, and **IV — Not urgent & not important**.

- **Quick add and task editor:** Click **+** on any box to quick-add a task, or
  open a task's **⋯** menu to edit its title, notes, priority (`High`, `Medium`,
  `Low`, `None`), due date, task list, linked deck, and tags. Use **Manage
  lists** in the header to create, rename, or delete custom task lists (deleting
  a list moves its tasks to **Inbox**).
- **Drag and move:** Drag open tasks between boxes, or use **⋯ → Move to…** to
  pin a task manually to a box. Tasks that do not match any rule appear under
  **Unsorted** below the grid. Toggle **Show completed** in the header to view
  or reopen completed tasks.
- **Custom box rules:** Each box has a **⋯** menu to **Group by** (`None`,
  `List`, `Priority`, `Tag`, `Date`), **Sort by** (`Due date`, `Priority`,
  `Title`, `Manual`), or **Edit matrix rule** (custom title, lists/decks filter,
  date filter, priority filter, and item type filter, plus **Restore defaults**).
- **Due-deck cards:** Decks with cards due today appear automatically as
  **Review** cards according to box rules (child decks are hidden when an
  ancestor deck is in the same box). Click **Study** to review, or use **⋯** to
  **Open in Browse** or **Edit this box's rule**.
- **Daily task rewards:** A banner above the grid shows **Rewarded tasks today:
  N / 10**.

### Habits

Open **Plan → Habits** to track daily routines and study goals.

- **7-day strip:** The top strip shows completion rings for each day of the
  week (`Previous week`, `This week`, `Next week`). Click a past or current day
  to filter and log check-ins for that day (future days are read-only for
  check-ins).
- **Sections and frequencies:** Habits are grouped into **Morning**,
  **Afternoon**, **Night**, and **Others**. When creating or editing a habit
  (**New habit**), choose **Daily**, **Selected weekdays**, **Times per week**,
  or **Every N days**, plus a start date and optional fixed duration in days.
- **Goal modes:** Choose **Achieve it all (yes/no)** for one-tap check-ins, or
  **Reach a target amount** with a target number and unit (log with the number
  input, **Save amount**, or **+1**). Completed habits show their current day
  streak.
- **Deck-linked habits:** Link a habit to a deck (optional). Deck-linked habits
  fill automatically from your card reviews in that deck and its subdecks,
  display **"from your reviews"** as read-only, and award the habit reward once
  the daily target is reached.
- **Logs and reminders:** Use a habit's **⋯ → Add log** (or enable auto pop-up
  after check-in) to save a mood (`1–5`) and reflection note. Reminder times are
  stored for planning only; notifications are not sent in this version.

### Calendar

Open **Plan → Calendar** to view your schedule alongside study forecasts.

- **Views:** Switch between **Week**, **Month**, and **Agenda** (14-day list),
  step backward or forward, or jump back to **Today**.
- **Events:** Click **New event** (or **+** on a day in Week view) to create
  all-day or timed events with location, description, and optional **Daily** or
  **Weekly** recurrence (interval, weekdays, and end never / on date / after
  count). Edit an event or delete either one occurrence or the entire series.
- **Tasks, habits, and study forecast:** Scheduled tasks appear with their time
  range, unscheduled tasks with a due date appear with a **Due** badge, and
  scheduled habits appear by section. Days with upcoming Anki reviews show a
  clickable forecast badge (**N cards due**) that opens **Decks**.
- **Unscheduled tasks:** Active tasks without a scheduled time appear in the
  **Unscheduled tasks** panel; drag a task onto any day in Week view (schedules
  at `09:00` for 1 hour) or click **Schedule…** to pick a date, start time, and
  duration.

---

## AI assistant

**Assistant** (in the sidebar after **Stats**) brings together Bibalak's
optional study and writing helpers:

- **What it does:** **Study tutor** in Study after clicking **Show Answer**
  (press `T` for **Explain**, **Give an example**, **Mnemonic**, **Translate**,
  or **Why was I wrong?**), **Suggest back** (Add Note, above the Back field),
  **Rewrite leech** (Browse note editor), **Generate cards** from text
  (**Assistant** or **Add Note → Generate with AI**), **Deck quality**
  (**Assistant**, Deck menu → **Check quality with AI**, or Browse → **More →
  Check quality with AI**), and **Study coach** (**Stats → Ask the coach** or
  **Assistant → Ask the coach**). Suggestions are drafts only — nothing changes
  in your collection until you click **Accept**, **Append to field**, or
  **Add**.
- **What it sends:** card HTML is stripped to plain text before leaving your
  machine (Study coach sends aggregate numbers and deck names only, never card
  text). No media files or other cards are attached. You can review the exact
  destination, model, system instructions, and prompt before clicking **Send**,
  or optionally skip that confirmation per action for the current session only.
- **Provider and costs:** you connect your own **OpenAI-compatible** endpoint or
  local **Ollama** server. Requests go directly from your machine to the URL you
  configure, and any usage charges are billed by your chosen provider (token
  counts are shown after each reply).
- **How to set up:** open **Settings → AI assistant** (or click **Change in
  Settings** / **Set up AI in Settings** on the **Assistant** hub), choose
  **OpenAI-compatible** or **Local Ollama** (editable presets suggest
  `https://api.openai.com/v1` / `gpt-4o-mini` or `http://localhost:11434` /
  `llama3.1`), turn on **Enable AI assistant**, enter your API key if needed
  (stored only in your OS credential store, never in settings files), and click
  **Test connection**.
- **How to turn it off:** uncheck **Enable AI assistant** in **Settings → AI
  assistant** and save, or click **Remove saved key** to clear any stored key
  from your OS credential store.

### Study tutor

1. While studying a card, click **Show Answer** (`Space`), then click **Tutor**
   or press `T` to open the compact tutor panel below the card (`Esc` closes it,
   and advancing to the next card closes it automatically).
2. Choose one action at a time: **Explain this card**, **Give an example**,
   **Mnemonic**, **Translate** (Arabic → English when the card is mainly Arabic,
   otherwise into Arabic), or **Why was I wrong?** (includes any typed answer
   on type-in-the-answer cards).
3. Review the consent preview before clicking **Send to AI** (or opt to skip
   that confirmation for the current session per action).
4. Click **Copy** to copy the plain-text reply, or **Save to field** to pick a
   field, preview the appended text (`<br><br>` plus escaped AI text inside the
   sandboxed renderer), and save without overwriting existing content. Pressing
   `Z` / Undo restores the previous field.

### Generate cards from text

1. Open **Assistant → Open generator** (or click **Generate with AI** from **Add
   Note**). Use the `Assistant › Generate cards` breadcrumb to return to the
   hub.
2. Paste study notes or a lecture summary (up to 50,000 characters), choose a
   target deck, card kind (**Basic** or **Cloze**), matching note type, and
   target card count (5–50, default 15).
3. If your collection has no Cloze note type yet when **Cloze** is selected,
   click **Add stock Cloze note type** to create it inline.
4. Click **Generate cards**. Long text is split into parts (~6,000 characters
   each); the confirmation dialog shows how many parts will be sent, previews
   part 1 in full, and lists parts 2..N with their character counts.
5. Review the generated drafts, edit fields inline, discard unwanted cards, and
   watch for **Possible duplicate** badges against existing notes in the target
   note type. Cloze drafts show Front (`[…]`) and Back previews inside the
   sandboxed card renderer.
6. Click **Add X cards to &lt;deck&gt;** to save all accepted cards in one batch
   (tagged `ai-generated` by default, with a toast shortcut to **Open in
   Browse**).

### Check deck quality

1. Open **Assistant → Open quality review**, choose **Check quality with AI**
   from a deck's `···` menu, or select cards in **Browse** and choose
   **More → Check quality with AI**.
2. Pick your scope (**Deck** including subdecks, **Browse selection**, or
   **Leeches only**, up to 200 notes per scan) and click **Scan notes**.
3. Review the consent preview showing how many batches of 20 notes will be
   sent, then review findings grouped by kind: **Unclear wording**,
   **Overloaded cards**, **Duplicate meaning**, **Suggested tags**,
   **Suggested rewrites**, and **Cloze splits**.
4. Edit or **Accept** / **Dismiss** individual items (or **Accept all in
   group**), then click **Apply accepted changes** to apply rewrites and tags in
   one undoable step (while Cloze splits add new Cloze cards alongside the
   original unless **Suspend the original** is checked). If another undoable
   action happens after Apply, the banner explains why Undo is no longer
   available.

### Study coach

1. On the **Stats** screen, click **Ask the coach** next to the coach summaries
   (or click **Ask the coach** from the **Assistant** hub card).
2. The consent preview shows the exact metrics prompt sent: 30-day reviews, true
   retention vs. goal, overdue backlog, 7- and 30-day forecast totals, studied
   days, average study minutes, leech count, peak hours, and top decks by due
   count. Zero card text or note fields are included.
3. Review the coach's personalized analysis:
   - **Summary:** High-level diagnosis of your current pacing and backlog.
   - **Targeted advice:** 1–5 actionable recommendations with direct links to
     open stats for specific decks.
   - **7-day study plan:** Daily breakdown of recommended reviews, new card
     allocations, and session focus.
4. Click **Copy plan** to copy the formatted text advice and table to your
   clipboard. The plan is advisory and never modifies deck configurations or
   scheduling parameters automatically.

---

## Settings

Settings is organized into eight categories on the left rail (or top tab strip
on narrow windows):

| Category      | What it controls                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| General       | Theme (`Light` / `Dark` / `System`), Style (`Default` / `Scholar` / `Game`), certificate name, Language (`EN` / `العربية`) |
| Study         | Day rollover hour (`Day starts at`)                                                                                        |
| Quick add     | Enable global shortcut, set shortcut key, and open the Quick Add window                                                    |
| AI assistant  | Provider (`OpenAI-compatible` / `Local Ollama`), base URL, model, API key, enable toggle, test connection                  |
| Data & backup | Export collection as `.apkg`, create/restore/delete local backups                                                          |
| Maintenance   | Database integrity check (also repairs orphan subdecks and tag registry), optimize database, media check & orphan cleanup  |
| Plugins       | Install, enable, disable, and run commands from sandboxed plugins                                                          |
| Updates       | Current version, **build stamp** (`Build <sha> · <date>`), and update check (active once the download site is configured)  |

---

## Backups and restore

Bibalak backs up automatically on startup (keeping the last 20 ZIPs).
**Settings → Data & backup → Backup now** makes one on demand. To restore, pick
a backup and confirm; restart the app afterwards.

---

## Plugins

Plugins are sandboxed JavaScript with a `plugin.json` manifest that declares
what they may do. When you enable one, Bibalak lists the permissions it asks
for. **Settings → Plugins → Install plugin…** and select the plugin's folder;
its commands appear under **Plugin commands**.

---

## Troubleshooting

- **Import fails:** make sure the file is a valid `.apkg` / `.colpkg` exported
  from Anki.
- **Audio doesn't play:** the deck must have been exported with media, and check
  the sound icon in the sidebar footer is not muted or at `0`.
- **No cards to study:** daily limits may be reached or cards suspended — check
  **Browse** with `deck:"Name" is:due`.
- **App won't start:** if a newer database schema is detected, Bibalak stops
  without modifying your data and shows the recovery screen; pre-migration
  `.pre-v<N>.sqlite` backups are also kept beside your collection. Otherwise
  check the latest log file and crash report (`bibalak-crash.txt` in the
  system temp folder).
