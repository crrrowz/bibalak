# Project Governance

_Adapted from [Open Source Guides — Leadership and Governance](https://opensource.guide/leadership-and-governance/) (licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)) following an owner-led ("Benevolent Dictator") governance model._

## 1. Model Overview

Bibalak is an **owner-led open-source project**. The source code of the desktop application is developed openly with community participation under `AGPL-3.0-or-later`, while strategic direction, final architectural sign-off, releases, licensing, and trademarks are led by Hassanein Hassan Alkahafji.

## 2. Roles and Responsibilities

### Project Owner (Hassanein Hassan Alkahafji)

- Holds final authority over project direction, roadmap priorities, and release approvals.
- Owns the project trademarks (`TRADEMARKS.md`), manages the CLA and dual-licensing rights (`CLA-INDIVIDUAL.md`, `CLA-ENTITY.md`), and signs off on security advisories.
- Appoints and removes Maintainers.

### Maintainers

- Trusted contributors granted triage, review, and merge permissions for the repository (or specific subsystems).
- Review pull requests for correctness, tests, security invariants, i18n/RTL quality, and licence compatibility.
- Help triage issues, guide contributors, and uphold the [Code of Conduct](CODE_OF_CONDUCT.md).

### Contributors

- Anyone who participates in discussions, reports bugs, suggests features, improves translations/documentation, or submits pull requests (subject to the CLA and Code of Conduct).

## 3. Decision Process

- **Routine changes** (bug fixes, test improvements, documentation, UI polish, translation updates): Decided through pull-request review. Merging requires at least one Maintainer (or Project Owner) approval, passing CI checks, and a green CLA check.
- **Significant changes** (new user-facing features, database schema migrations, public API or plugin SDK changes, security-model changes, or new dependencies): Must be discussed first in a GitHub Issue or Architecture Decision Record (ADR) proposal. Maintainers gather community feedback; the Project Owner (or a Maintainer explicitly delegated for that area) makes the final decision.
- **Deadlocks:** If consensus cannot be reached in review or discussion, the Project Owner makes the final decision.
- **Reserved decisions:** Licensing changes, CLA terms, trademark permissions, release signing keys, and hosted cloud/commercial service architecture remain exclusively with Hassanein Hassan Alkahafji.

## 4. Becoming a Maintainer & Stepping Down

- **Nomination:** Contributors who demonstrate sustained, high-quality contributions, sound architectural judgement, and constructive community engagement may be invited by Hassanein Hassan Alkahafji to become Maintainers.
- **Stepping down / Emeritus:** A Maintainer may step down at any time by notifying Hassanein Hassan Alkahafji. Maintainers who are inactive for an extended period (for example, 6 months) may be moved to emeritus status and have write permissions paused for repository security; they are always welcome to return.
- **Removal:** Hassanein Hassan Alkahafji may revoke maintainer status for Code of Conduct violations, security breaches, or persistent disregard for project standards.

## 5. Continuity

If Hassanein Hassan Alkahafji can no longer lead the project, his rights in
the project (including the rights granted under the Contributor License
Agreements) pass to his successors or assigns, who decide who leads it next.
Until then, the repository stays open under its licence: anyone may keep
using, studying and forking it under `AGPL-3.0-or-later`, subject to the
trademark policy.

## 6. Changes to Governance

Hassanein Hassan Alkahafji may update this governance document via a public pull request with a summary of changes.
