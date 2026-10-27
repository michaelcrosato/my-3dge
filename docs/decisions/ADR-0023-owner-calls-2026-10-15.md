# ADR-0023: The owner's calls of 2026-10-15: long tests never hold up work

Status: accepted · 2026-10-15 · Records PLAN.md §8.2, §8.9, §11.1, §11.5; amends ADR-0022 (decision 6, amendment 2)
and ADR-0016 (amendment 1's merge gate)

## Decision
1. **Long tests never hold up work.** Before every merge an agent runs the quick gate, `node x ci --local`: npm ci,
   x src, T0, T1 and x port refs --check. The full run, `node x ci --local --full` (the same, x new --test-all and T2
   in full, about an hour on 4 cores), runs where nobody waits on it: on GitHub after each merge to main
   (.github/workflows/ci.yml, one run per merge and none cancelled, so a failure names its merge) and by hand. While
   working, an agent runs browser specs only for what only they check that it touched, or a failure it is finding
   and fixing.
2. **Assume it passes; fix it when it fails.** `node x ci --status` reads main's last full run from GitHub. The
   SessionStart hook prints it, and a red main is fixed before other work. At the end of a goal or a stage the agent
   waits for main's full run and reports it: nobody is held up then.
3. **One budget:** the quick gate's steps together, five minutes (`GATE_BUDGET_MS`), a warning as ever (ADR-0022). T2
   and the long runs have none. This answers C1's Owner: issue (T0 and T1 over their fixed 10 s and 60 s on 4
   cores): those budgets are gone, with T2's by machine size (ADR-0022 amendment 2) and its selection in the gate.
4. **No branch protection** (PLAN.md §11.5): the workflow's `ci` check stays optional, and runs on pull requests no
   more.
5. **The `game/*` branches** were deleted on GitHub by the owner, on purpose (noted in docs/HANDOFF.md).
6. **Vercel is paused** by the owner from 2026-10-15 until they test. Until they say it is back on, agents skip the
   look at a PR's Vercel status and ignore Vercel's statuses and errors (AGENTS.md, PLAN.md §8.9 and §11.5).

## Why
The owner's direction of 2026-10-15: a ten-minute fix took about two and a half hours to merge, since the local gate
ran T2 in full (61 min 44 s on 4 cores at 8006e81) and the workflow then ran it again (74 minutes on PR #14's merge).
Tests that long belong where they slow nobody; when they run matters little, as long as nobody waits on them.
GitHub's runners cost nothing here (the repository is public) and are no faster (T2 took 65 min 44 s there): the time
saved comes from running the hour once, off the critical path. A merge now waits on the quick gate, a few minutes.
`x new --test-all` moved to the full run too (my call): with it the quick gate took 6 min 53 s at c2d1333, over the
owner's five minutes, and it took 2 min 33 s of them; without it, 4 min 19 s (3 min 3 s at 8006e81).

Accepted trade-off: a fault only T2 catches reaches main, and the Vercel preview, until the full run after its merge
names it. The leaks between suites that C1's full runs found are still found, an hour after the merge instead of
before it.

## Enforced by
tools/cmd/ci.ts (`CI_STEPS`' `full`, `FULL_ONLY`, `--status`, `--shard`, `--minutes`), tools/lib/ciShards.ts and
tests/baselines/t2-minutes.json, tools/lib/tierBudgets.ts
(`GATE_BUDGET_MS`), tools/lib/ciStatus.ts, .github/workflows/ci.yml and tools/cmd/ci-workflow.test.ts,
tools/game/imports.test.ts, .claude/hooks/session-start.sh, AGENTS.md (the loop, merging, gates).

## Amendments
1. **2026-10-24: the full run in four shards; a cancelled run is red** (my call, found at the hand-off after PR #28).
   Main's full runs on 39e06b0 (#27) and 9b988aa (#28) hit the job's 120 minutes inside T2 (86 min of the 96 at G10;
   past 107 min by then) and were cancelled, and `x ci --status` passed over cancelled runs, so main read green on
   14e1810 for two merges while both runs had also failed `x engine --test` (tools/qa imported fixtures/, which games
   never get). Now: the workflow runs four jobs, fail-fast off, each `node x ci --local --full --shard <i>/4`: T2's
   i-th share through Playwright's `--shard` (it balances by test count, so parity.spec.ts, about 45 minutes, bounds
   the slowest), and on the first job every other step too; a run passes when every shard does. The workflow cancels
   no run, so `x ci --status` reads a cancelled one, a timeout as GitHub reports it, as not passing. And T1 checks
   what `x engine --test` found too late: every file a game gets imports only files a game gets
   (tools/game/imports.test.ts). Alternative not taken: a longer limit (up to 360 minutes), simpler, but main's
   verdict would come two and a half hours after each merge and grow with T2.
2. **2026-10-24: what main's first run in shards found** (my calls). The full run on d1d707b (#29) took T2 to its
   end for the first time since G10, on Chromium 141, and failed in all four on faults from G11 and G12 that no
   full run had reached; each is fixed where it lies, every bar kept: tiled lighting dropped a lamp of unlimited
   range (WP 11.5); the outline shells kept their pages' stale bounds (WP 13.24); GPU timing let three.js's query
   pool fill, since the virtual clock's `tick(n)` draws n frames in one task, before a read can come back, so the
   renderer now queries nothing while a read is out (WP 11.2; tests/e2e/timing.spec.ts draws such a burst). Specs
   had fallen behind the engine: the box room's shot counts the shots' two batches (WP 13.20), and its inspector
   check calls `fx.stats` (WP 11.3); the materials cards, rows of ten, left the frame at 19 materials (now rows of
   seven, each window checked in the frame), and glass's 2 m bands never fit a card's window (its card maps 2.4 m of
   texture, so the 85% check holds it); materials-v2's shell measure lists the page's own shells, which the ID pass
   leaves out; the playground's accent count (WP 13.2's) dropped the pixel look's third step of the accent, a middle
   band at value 0.48–0.52 under its 0.55 floor, now 0.45, below that step and above both looks' dark bands and ink
   as measured. Two waits were too short on GitHub's runners: the gallery's pages get 120 s to be ready, and the
   camera sweep runs one replay a test, as test 1 does (Box 5's two passed 240 s).
3. **2026-10-24: the shards dealt by minutes** (my call). Amendment 1's `--shard` balanced test counts, and the
   playground's three heaviest spec files, next to each other by name, all fell to the fourth job: 90 minutes of T2
   there against 7 on the second, 45 on the first (plus its 14.5 minutes of other steps) and 55 on the third, on
   d1d707b; G12's and G13's specs would have pushed it past the 120. Now `x ci --local --full --shard <i>/<n>` runs the
   spec files tools/lib/ciShards.ts deals to machine i: longest first, each to the machine with the fewest minutes so
   far, the first starting with the other steps', by tests/baselines/t2-minutes.json (each spec file's minutes on
   GitHub's runner, measured on d1d707b; a file it does not list weighs 5 until measured). On those numbers each job
   runs about 53 minutes. `node x ci --minutes <report.json…>` rewrites the table from a full run's `out-<i>`
   artifacts, and T1 fails when the table names a gone spec file or its plan puts any job past 100 minutes, which
   asks for a fifth shard. Alternatives not taken: more count-balanced shards, or Playwright's `fullyParallel` to
   split files by test: both still balance counts, blind to minutes, so heavy files can still meet on one job. The
   new order's first run (on 1c4c540, d289543's tree) ran materials.spec.ts after box-hall.spec.ts, whose imports
   put the props' materials in the worker's shared registry, which the spec read for what the page should have: it
   now reads the built-ins from a registry of its own.
4. **2026-10-27: Vercel back on, and cheaper** (the owner's direction: Vercel is unpaused, and its cost is to come
   down without losing quality or what it serves; the calls are mine). Decision 6 ends. What was measured first:
   production still served 2026-10-15's build, every deployment since blocked by the pause; before it, Vercel built
   every push of every branch (agents push a branch many times a stage, and nobody opens those previews: merges wait
   on the quick gate); the hashed files under `/assets/` were served with `max-age=0, must-revalidate`, so each visit
   asked again for every file it loads; and the animation library shipped as 1,270 files, which the Library Lab, the
   Animation Lab with a library clip and the box's clip mode fetched at once, a request each.
   - **What Vercel builds** (scripts/vercel-ignore.mjs, vercel.json's `ignoreCommand`): production builds a merge to
     `main` that changes a file that can ship, since the last deployment that succeeded; one that changes only what
     never ships (`NEVER_SHIPS`: docs, the plan, tests but the replays the pages play, tools but the one
     vite.config.ts imports, CI and agents' files; checked against the build's module graph on this day) is skipped,
     the site byte for byte the same. A branch push builds a preview only when its commit message says `[preview]`.
     Whatever the script cannot tell (no earlier deployment, its commit outside the shallow clone, `VERCEL_ENV`
     unset) builds. It lists what never ships, not what does: a page importing from a new place costs one build,
     never a stale site. This replaces ADR-0021 decision 1's deployment of every push and its look at a stage PR's
     Vercel status: a stage that changes the build itself asks for a preview and looks once; after a merge that
     ships, one look at main's production deployment, whose failure leaves the last good build serving.
   - **`/assets/` cached a year, immutable** (vercel.json's one header): Vite hashes every file name there (1,276 of
     1,276 at 5657cda; vite.config.ts sets no output names), so a returning visitor asks for none of them again. The
     pages themselves keep Vercel's default, `must-revalidate`, so a new deployment shows at once.
   - **The library in one chunk** (labs/box/clipFiles.ts, imported by those three pages when they need it): one
     request instead of 1,270, 1.22 MB gzipped instead of 1.8 MB, the same text. The build went from 1,300 files and
     16 MB to 74 files and 13 MB, and `vite build` from 17.8 s to 10.1 s here.
   - **Not taken:** Rapier's WASM as a file of its own (the 5.8 MB chunk, 1.86 MB gzipped, about a third smaller as
     binary) needs Rapier's non-compat package, a new dependency and so the owner's call; turning previews off in
     the project's Vercel settings, an outward action vercel.json makes unneeded and which a PR could not show.
   - **Not verified here:** Vercel's own run of the script and the header, first seen on this change's production
     deployment (one look, as above). Enforced by tests/unit/vercel-ignore.test.ts, a unit test of the script and the
     configs in Node, not a deployment test (ADR-0021).
