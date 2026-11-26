# ADR-007: Anki-compatible note guids and checksums

**Status:** Accepted
**Date:** 2026-11-14

## Context

The screen audit (A4, A5) found that new notes got `guid = note id` ("1",
"2", …) and no first-field checksum. Import matches notes by guid, so a deck
from another collection could update unrelated notes; without checksums,
duplicates could not be detected. Anki stores both on every note and uses
them the same way, and our `.apkg`/`.colpkg` export writes them out.

## Decision

- **guid:** 10 random characters from a 91-character alphabet (Anki-style),
  generated with `fastrand` (already in the dependency tree; OS-seeded per
  thread). Existing notes keep their guid.
- **checksum:** exactly Anki's `csum`: the first 4 bytes (big-endian) of
  SHA-1 over the first field with media file names kept as " name ", other
  HTML stripped and entities decoded (`bibalak-db/src/browse/text.rs`,
  `field_checksum`). Set on add and on edit. Tests pin known Anki values.
- New direct dependencies of `bibalak-db`: `sha1` 0.10 (RustCrypto, same
  family as the `sha2` already in the tree), `fastrand` 2, and
  `bibalak-render` (to create cards only for templates whose front renders
  non-empty; an inner-ring crate, allowed by the layer rules).

## Consequences

- Imported Anki notes and new notes share one checksum scheme, so the
  duplicate warning works across both, and exported decks carry values Anki
  accepts.
- SHA-1 is used only as a fingerprint for duplicate detection, not for
  security.
- Notes created before this change have no checksum until edited; that only
  limits the duplicate warning for those notes.
