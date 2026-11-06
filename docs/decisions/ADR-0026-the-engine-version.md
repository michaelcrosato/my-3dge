# ADR-0026: The engine's version: 0.1.0, bumped by every merge, each one a tag games pin

Status: accepted · 2026-11-06 · Records PLAN.md WP 13.45, §8.9, Phase H (its versioning, brought forward)

## Decision
- **The number** (the owner's call of 2026-11-06): my-3dge has a semantic version, from 0.1.0. package.json holds it
  (I-32), `ENGINE_VERSION` gives it to code (engine/core/version.ts, the public API), `__engine.info().version` to
  agents, and the playground's start menu and splash show it beside the engine's name. It stays below 1.0 until a
  game ships (Phase H): a minor version may change the public API.
- **Every merge bumps it** (the owner's call): `npm version patch --no-git-tag-version` for a fix, `minor` for a
  feature or a change to the public API, then `node x docs --write` and `node x html --write`. The quick gate's
  `node x version --check` (tools/lib/version.ts) fails a branch that differs from origin/main while its version is not
  above main's; main's own run, with nothing differing, passes.
- **Each version is a tag on main** (.github/workflows/release.yml): main's push tags the pushed commit `v<version>`
  at once, never moving or deleting a tag. The owner's option said "after main's full run passes"; the tag goes on at
  the merge instead, because the lean guide on main names it in its engine URLs and must never name a tag that does
  not exist for the two hours the full run takes. A full run that fails on a version is fixed by the next one.
- **Games pin to it** (the owner's call): lean pages load the engine from jsDelivr at `@v<version>` (tools/lib/lean.ts
  `LEAN_URL`), not `@main`, so a game keeps the engine it was made with, served as it was for good; it moves up by
  putting a newer version in its two engine URLs. The full workspace already pins a commit (engine-lock.json).

## Why
The owner's direction: the engine should carry a version number. A number names what a game was built on and what
changed, and a pinned tag keeps a lean game working when main moves on, where `@main` changed under it.

## Enforced by
`node x version --check` in the quick gate (tools/cmd/ci.ts); tools/lib/version.test.ts, engine/core/version.test.ts,
tools/cmd/release-workflow.test.ts (the tag the workflow makes is the one the lean URLs name) and tools/lib/lean.test.ts;
AGENTS.md's rule and the x-loop skill.
