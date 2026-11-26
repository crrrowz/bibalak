# How CLA Signing Works

_Based on the [CLA Assistant](https://github.com/cla-assistant/cla-assistant) workflow (licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)) and [Open Source Guides](https://opensource.guide/) (CC-BY-4.0)._

Every outside contribution to Bibalak requires a signed Contributor License Agreement (CLA) before it can be merged (ADR-022).

## Why a CLA (instead of DCO alone)

A Developer Certificate of Origin (`Signed-off-by`) only confirms you have the right to submit code under the repository's outbound open-source licence (`AGPL-3.0-or-later`). Bibalak uses an open-core model where Hassanein Hassan Alkahafji also offers commercial dual licences for organizations that cannot use AGPL software. A CLA grants Hassanein Hassan Alkahafji the explicit right to relicense accepted contributions for that purpose (see [`CLA-INDIVIDUAL.md`](../../CLA-INDIVIDUAL.md) and [`CLA-ENTITY.md`](../../CLA-ENTITY.md)).

## 1. Signing as an Individual (PR Flow)

1. Open a pull request against https://github.com/crrrowz/bibalak.
2. Our CLA bot (**CLA Assistant**) automatically checks the GitHub accounts on every commit in your pull request.
3. If you have not signed the current CLA yet, the bot posts a comment on the PR with a link to review and sign [`CLA-INDIVIDUAL.md`](../../CLA-INDIVIDUAL.md).
4. Click the link, sign in with your GitHub account, read the agreement, and click **Sign**.
5. Once signed, the bot automatically updates the PR status check to green. You only need to sign once across future pull requests (unless a new CLA version is published).

## 2. Signing for an Organization (Entity CLA)

If you contribute as part of your job or using company resources, your employer may own the intellectual property in your work:

1. Have an authorized representative of your company complete [`CLA-ENTITY.md`](../../CLA-ENTITY.md), then open an issue titled "Entity CLA" (without the signed document); the maintainer ([@crrrowz](https://github.com/crrrowz)) replies with a private way to send it.
2. Include your GitHub username(s) in **Schedule A (Designated Contributors)**.
3. Hassanein Hassan Alkahafji adds the signed Entity CLA and links the approved GitHub usernames in the CLA allowlist so PRs from those accounts pass the CLA check automatically.
4. Notify the maintainer ([@crrrowz](https://github.com/crrrowz)) whenever designated contributors are added or removed.

## 3. What the CLA Bot Checks

On every pull request open or synchronize event, the bot verifies:

- **All commit authors and co-authors** in the PR branch have a valid signature (or belong to an active Entity CLA allowlist) matching the **current CLA version**.
- **GitHub email mapping:** Ensure the email address on your local Git commits (`git config user.email`) is linked and verified on your GitHub account so GitHub resolves every commit to your GitHub username.
- **Required merge gate:** Branch protection on `main` requires the CLA status check to pass before any maintainer can merge.

### Automated bots and trivial edits

- Automated dependency-update bots (e.g., Dependabot or Renovate) that only bump version manifests may be exempt if configured in the CLA allowlist; any human-authored commit requires a CLA unless Hassanein Hassan Alkahafji publishes an explicit trivial-edit exception after legal review.

## 4. Where Signatures Are Stored (Privacy)

- Signatures are stored in a **private** signature store managed by Hassanein Hassan Alkahafji (either a private GitHub repository configured for CLA Assistant or an encrypted private database), **never** committed into the public Bibalak source repository.
- Recorded fields: GitHub user ID, GitHub username, signed CLA version/hash, timestamp (UTC), and originating repository/PR reference (plus Entity schedule details for corporate signatories).
- Signature records are retained for as long as the Project distributes the covered contributions so Hassanein Hassan Alkahafji can demonstrate provenance and relicensing rights. Requests regarding signature records may be sent to the maintainer ([@crrrowz](https://github.com/crrrowz)).
