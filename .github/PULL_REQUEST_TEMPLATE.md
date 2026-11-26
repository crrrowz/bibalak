<!-- Adapted from GitHub pull request template conventions (Open Source Guides, CC-BY-4.0) and the project's internal PULL_REQUEST_TEMPLATE.md. -->

## What / why

Fixes #

## Contributor License Agreement (CLA)

- [ ] I have signed (or will sign via the CLA bot on this pull request) the [Individual](../CLA-INDIVIDUAL.md) or [Entity](../CLA-ENTITY.md) Contributor License Agreement, and I understand that accepted contributions may be distributed under `AGPL-3.0-or-later` and separate commercial licences per the CLA.

## Checklist

- [ ] `pnpm lint:ts` and `cargo clippy --workspace --all-targets -- -D warnings` pass
- [ ] `cargo fmt --check` and `pnpm fmt:check` pass
- [ ] `cargo test --workspace`, `pnpm test:ts`, and `pnpm build` pass
- [ ] New IPC commands have a Rust test and a TypeScript wrapper
- [ ] Ran `pnpm bindings` if Rust `#[derive(TS)]` structs changed
- [ ] UI changes use `t()`/`tn()` in both `en.ts` and `ar.ts` and logical CSS classes (RTL verified)
- [ ] Any new dependencies are `AGPL-3.0-or-later` compatible and `THIRD_PARTY_NOTICES.md` was updated if needed
