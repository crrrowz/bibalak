# Product

## Register

product

## Platform

Desktop (Windows, macOS, Linux) via Tauri; web UI technology inside. Web app
(`W1`, sharing the React UI against the Bibalak API server) and mobile planned
for Stage 2+.

## Users

Anki power users, in English- and Arabic-speaking markets — students in medicine, language learning, and other exam-heavy fields who already rely on spaced repetition daily. They know the algorithm, the workflow, and Anki's quirks intimately; what they're missing is an interface that respects their time. They study in focused sessions, often for hours, and expect the shell to disappear so the cards can carry the session.

## Product Purpose

Bibalak is a spaced-repetition flashcard and study-planning app fully
compatible with Anki's format and scheduling (SM-2/FSRS-6), rebuilt with a
modern Tauri + React shell. It pairs lossless Anki flashcards and statistics
with an optional AI learning assistant, a unified progress engine, and study
organization tools (Eisenhower matrix, habit tracker, and local calendar).
Success looks like power users switching over without losing any capability,
while gaining a study experience — and a planning and stats workspace — that
feels considered rather than bolted on.

## Positioning

Anki-compatible, but modern: the same proven scheduling and format users already trust, wrapped in a fast, native-feeling desktop app that Anki never had.

## Brand Personality

Warm, calm, dependable. The interface feels like a well-lit desk for a long study session: comfortable materials, no clutter, nothing shouting. It still gets out of the way during study and earns trust through consistency, not decoration. Friendly means comfortable, never cute.

## Anti-references

Not Anki's own UI: the cluttered, inconsistent, dated look that Bibalak exists to replace. Not generic gamified study apps either — no mascots, no cartoonish celebration animations, no streak guilt in the default style. Bibalak's confidence comes from precision and speed, not decoration.

## Design Principles

- Respect the session: chrome recedes during study; the card is the interface.
- Compatibility is table stakes, craft is the differentiator — every screen should feel like it was designed, not ported.
- Data earns its place: stats and charts exist to change what a user does next, not to decorate a dashboard.
- Fast beats fancy: motion and effects (glass surfaces, transitions) are restrained and purposeful, never the reason for a delay.
- Progress is visible, never noisy: every user earns XP, levels and gold from real learning (reviews, tasks, habits) so effort shows as results. In the default style it is shown quietly; no mascots, no forced celebration.
- Styles change presentation, not rules: the user picks a presentation style — Default (this calm desk), Scholar (academic classic-library look, shipped), or Game (opt-in RPG with avatar and HUD, planned). One progress engine serves all of them.

## Progress & presentation styles

Owner decision D1. Points (XP, level, gold) are
part of the product for everyone and reward real learning across reviews,
Matrix tasks, and Habits (`ADR-019`). **Default** and **Scholar** ship today;
the opt-in **Game** style (avatar, HUD, equipment, shop) is planned for Cycle 2.
Default and Scholar never show mascots or confetti. Icons are custom SVG, never
emoji.

## Study organization (Plan)

Owner decision D2. Bibalak includes local-first
**Eisenhower Matrix**, **Habit Tracker**, and **Calendar** tools under the
**Plan** sidebar group so learners can organize study reviews alongside tasks,
routines, and schedules (`ADR-018`). External calendar sync (`CAL2`, `CAL3`) is
planned for Stage 2.

## Accessibility & Inclusion

Standard WCAG AA: sufficient contrast in both light and dark themes, full keyboard navigation, and respect for `prefers-reduced-motion` throughout (already a pattern in the existing motion tokens).
