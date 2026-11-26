# ADR-022: Open-source desktop app with paid cloud services (open core)

Date: 2026-11-17
Status: Accepted 2026-11-23 (owner: "open source as in our plan, but it stays
mine: I can sell it and do anything with it" — this ADR as written, D35).
The licence files and the private-repo rules change only at OS4 (see D35).

## Context

Bibalak is today a paid, proprietary app in a private repository
(`LICENSE`: "proprietary… All rights reserved"; `Cargo.toml`:
`LicenseRef-Proprietary`; `AGENTS.md`: "private-only"). The owner wants the project to be open source so others can use and
improve it, while still earning money from it later through a planned model.

The roadmap already has three layers:

1. **Personal use** (Stage 1): one person, local SQLite, all features,
   optional backup/sync between that person's own devices (S1–S3).
2. **Multi-user** (Stage 2): accounts, Supabase cloud, sync between users,
   multiplayer, web app.
3. **Public launch** (Stage 3): website, live updates, code signing, legal
   texts, licensed art, crash reporting, beta.

Facts that limit the options:

- Bibalak is derived from Synapse (MIT). MIT allows relicensing our own
  work under any licence as long as the Synapse notice stays
  (`THIRD_PARTY_NOTICES.md`).
- Dependency licences are checked in CI against an allowlist (`about.toml`,
  `scripts/licenses/generate-notices.mjs`); today all are permissive
  (MIT / Apache / BSD …), which are compatible with AGPL-3.0.
- Some fonts, icons and art are listed in
  `docs/legal/third-party-assets-register.md` and may not be redistributable.
- Licence ties today (checked 2026-11-17):
  - **Synapse (MIT):** the fork origin; its copyright stays with the Synapse
    contributors, the rest is ours. MIT only asks to keep its notice.
  - **Libraries:** about 220 licence entries in `THIRD_PARTY_NOTICES.md`,
    all permissive (MIT, Apache-2.0, BSD, ISC, Zlib, Unicode, CDLA-P-2.0)
    plus 3 packages under MPL-2.0 (file-level copyleft, fine for both
    closed and AGPL use). No GPL / AGPL library.
  - **Fonts and icons:** Figtree and IBM Plex Sans Arabic (OFL-1.1), Lucide
    icons (ISC) — redistributable with notice. The logo is our own.
  - **No Anki code** is copied: `.apkg` support is our own reader/writer
    (the file format and the name are used only for compatibility). The
    FSRS scheduler is our own implementation of the published algorithm.
  - **Habitica:** only planned mechanics/formulas (not protected); its
    GPL code and CC-BY-NC-SA art must never be copied; its names get
    replaced (assets register).
- Comparable projects earn money around an open core: Anki (AGPL desktop,
  paid iOS app), Bitwarden and Joplin (open apps, paid cloud), Standard
  Notes.

## Decision (proposed)

1. **Licence of the app and all crates: AGPL-3.0-or-later.** Anyone may use,
   study, change and share it; anyone who runs a changed version as a
   network service must publish their changes. This blocks a closed
   competitor built on our code and matches Anki's licence.
2. **Contributor Licence Agreement (CLA).** Every outside contribution is
   accepted only after the contributor signs a CLA that lets the project
   owner relicense it. This keeps the option of selling a commercial
   licence (dual licensing) to companies that cannot accept AGPL.
3. **Name and logo are trademarks, not covered by the licence.** A
   `TRADEMARKS.md` policy allows forks under another name only. The official
   builds, the updater and the paid services use the name Bibalak.
4. **What stays free and what is paid:**

   | Free and open                                          | Paid (later, Stage 2+)                                                |
   | ------------------------------------------------------ | --------------------------------------------------------------------- |
   | The full desktop app for personal use (all of Stage 1) | Bibalak Cloud: accounts and sync between devices and users (Supabase) |
   | AI with the user's own key or local Ollama             | Hosted AI without own key (subscription)                              |
   | Backup to the user's own Google Drive (S3)             | Multiplayer features, premium art / game packs, mobile app            |
   | Source code, issues, contributions                     | Commercial licence for companies (via the CLA)                        |

   Whether the Stage 2 server code is open (sell hosting) or closed is
   decided by ADR-017 when Stage 2 starts.

5. **Publish a fresh public repository with a clean history.** The current
   private repository stays private as the archive. The public repository
   starts from one reviewed commit (no planning notes, no agent prompts, no
   owner test data unless chosen), so nothing private in the old history can
   leak.
6. **When:** prepare during Stage 1 (steps OS1–OS3 in the backlog); publish
   (OS4) once Stage 1 is stable enough for a good first impression, before
   Stage 3.

## Consequences

- `LICENSE`, `Cargo.toml` `license`, `package.json` files, README, `AGENTS.md`
  ("paid, proprietary", "private-only") and the prior EULA must be
  rewritten when this ADR is accepted; agents keep the current rules until
  then.
- Every new dependency must stay AGPL-compatible (permissive or
  GPL-compatible); the licence allowlist keeps enforcing it.
- Art and fonts that cannot be redistributed must be replaced or licensed
  before publishing (moves part of L2 forward).
- Public repositories get free GitHub Actions minutes on standard runners,
  which also removes the current CI billing block.
- Revenue depends on the paid services being better than self-hosting, not
  on hiding code.
- Not legal advice: the final licence text, CLA and trademark policy are
  checked by a lawyer in L3 (or earlier, before OS4).

## Alternatives considered

- **Stay closed (today's state):** simplest, but the owner wants openness.
- **MIT / Apache-2.0:** maximum adoption, but anyone can ship a closed paid
  copy, including a competing cloud.
- **Source-available (FSL / BSL, becomes open after 2–4 years):** protects
  revenue strongly, but is not "open source" by the OSI definition and puts
  off contributors.
- **GPL-3.0 without the A:** does not cover running a changed version as a
  web service, which matters once a web app exists (W1).
