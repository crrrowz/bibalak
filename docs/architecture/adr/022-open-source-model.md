# ADR-022: Licensing model — open-source app, owner-held rights

**Status:** Accepted · **Date:** 2026-11-23 (first public release 2026-11-26)

## Context

Bibalak should be open source so anyone can use, study and improve it, while
its owner keeps the ability to sustain the project commercially later (for
example with optional hosted services or a commercial licence for companies
that cannot use copyleft software).

Constraints:

- Bibalak began as a fork of [Synapse](https://github.com/Emadab/Synapse)
  (MIT). MIT allows our own work to be released under another licence as long
  as the Synapse notice stays (`THIRD_PARTY_NOTICES.md`).
- Every dependency is checked in CI against a licence allowlist (`about.toml`,
  `scripts/licenses/generate-notices.mjs`). All are permissive (MIT,
  Apache-2.0, BSD, ISC, Zlib, Unicode, CDLA-Permissive-2.0) or MPL-2.0
  (file-level copyleft); none is GPL or AGPL.
- Fonts (OFL-1.1) and icons (ISC) are redistributable with notice; the logo
  is the project's own. Other assets are tracked in
  `docs/legal/third-party-assets-register.md`.
- No Anki code is used: `.apkg` support and the FSRS scheduler are
  independent implementations of public formats and published algorithms.

## Decision

1. **Licence: AGPL-3.0-or-later** for the app and all crates. Anyone may use,
   study, change and share it; anyone who offers a changed version as a
   network service must publish their changes. The plugin SDK
   (`packages/plugin-sdk`) is MIT so plugins can choose any licence.
2. **Contributor License Agreement.** Outside contributions are merged after
   the contributor signs the [individual](../../../CLA-INDIVIDUAL.md) or
   [entity](../../../CLA-ENTITY.md) CLA. It lets the owner also offer the
   code under other licences (dual licensing).
3. **Name and logo are trademarks**, not covered by the code licence. Forks
   are welcome under another name ([`TRADEMARKS.md`](../../../TRADEMARKS.md)).
4. **What stays free:** the complete desktop app, AI with your own key or a
   local model, and the source code. Possible paid offerings later (hosted
   sync, hosted AI, commercial licences) are optional extras built around it.
5. **Public history starts clean** with the first public release.

## Consequences

- Every new dependency must stay AGPL-compatible; the allowlist enforces it.
- Assets that cannot be redistributed are replaced or licensed.
- The CLA must be signed before a contribution is merged, so the dual-licence
  option stays open for all code.
- Revenue, if any, comes from services and licences, not from hiding code.

## Alternatives considered

- **MIT / Apache-2.0:** widest adoption, but anyone could ship a closed copy
  or a competing closed service.
- **Source-available (FSL / BSL):** strong protection, but not open source by
  the OSI definition and off-putting to contributors.
- **GPL-3.0:** does not cover running a changed version as a web service.
