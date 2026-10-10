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

## Amendment 1 (2026-10-10, WP-0.3)
Calls made where the plan is silent, and WP 0.3's paths widened:
- **Paths.** `x deps` is a thin command, `tools/cmd/deps.ts`, over `tools/lib/deps.ts` (the record and the version
  model), `tools/lib/depsCheck.ts` (the offline check) and `tools/lib/depsUpdate.ts` (`--update`, `--qualify`). As one
  file it measured about 670 lines, over the hard cap of 600 (doctrine: Agent-readable).
- **Types packages.** The rule covers every `@types/*` and `@webgpu/*` package in the lockfile, direct or not
  (`tools/deps.json`'s `types`). A package in the lockfile only because a types package pulls it in (`typesDeps`:
  `@types/three` pulls `@dimforge/rapier3d-compat` 0.12.0, `@tweenjs/tween.js`, `fflate` and `meshoptimizer` for its
  addons' declarations; `@types/node` pulls `undici-types`) takes its range from that package, so the age rule does
  not apply: each is recorded with its version, `via` and reason, the check fails when the lockfile moves one, and
  nothing imports it. Overriding them would break the declarations that need them.
- **`follows`.** `@types/three` stays on three's line and is admitted by three's measurement (rule `internals`);
  `@types/node` stays on the platform Node's line, so its next line is Node's next even one (`@types/node` 25 is
  skipped with Node 25). The check fails when either leaves the line it follows.
- **Pinned docs follow the pin.** `knowledge` ties `docs/reference/three-tsl-wiki.md` and `docs/THREE-DELTA.md` to
  three's line, and the wiki page to its git blob, so an upgrade that leaves them behind fails the check.
- **The registry.** `npm view <pkg> time versions dist-tags --json`, not `time` alone: `time` still lists releases
  unpublished since (three's 1.58.1, of 2013), so only published versions at or below the `latest` tag count. Node's
  dates come from nodejs.org's release index, through curl (which honours the proxy).
- **Node is listed, never installed** by `--update`: installing it changes the session's runtime, which
  `scripts/setup.sh` owns. The line names the fix (write `.nvmrc`, run `bash scripts/setup.sh`).
- **A types package moves within its dependents' ranges** (`npm update`), never by `--save-exact`, which would make
  it a direct dependency. `--qualify` lists direct dependencies and Node; what follows another package or is pulled in
  moves with it.
- **The day.** A release qualifies on the same calendar day 12 months after its UTC publish date. The record's dates
  were read on 2026-10-10; the pins and qualifying releases are §4.7's.
