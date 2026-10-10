# ADR-0007: Versions: the newest release compatible with each qualifying one

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §6.10, §4.7

## Decision
- A release qualifies when it is at least 12 months old. Each dependency is pinned exactly to the newest release
  backward compatible with its newest qualifying one, adopted at once (by semver: the same major at 1.0 or later, the
  same minor for 0.x). Code writes the qualifying release's API.
- Engine internals may go newer when a measurement on the platform shows better quality (doctrine: Quality under the
  hood); `tools/deps.json` records the measurement.
- Today's pins: three.js r182.0 and Rapier SIMD 0.21.0 (internals, §4.7), stdlib's math 0.3.1, TypeScript 5.9.3,
  Vite 7.3, Vitest 3.2, Playwright 1.64 driving the container's Chromium 141, and Node 24.21 LTS (installed by
  `scripts/setup.sh` while the container ships Node 22).
- `node x deps --update` adopts compatible releases at the start of every WP, in a commit of its own; `--qualify`
  lists newly qualifying lines at every gate, which become upgrade WPs.

## Why
Doctrine Mastery: agents know a release a year old deeply, and a backward-compatible successor keeps that knowledge
valid while bringing its fixes.

## Enforced by
Exact pins and the lockfile (`npm ci`); `node x deps --check` in T0 (WP 0.3); `.nvmrc` and `scripts/setup.sh` for
Node.
