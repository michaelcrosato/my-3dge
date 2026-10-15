# AGENTS.md: rules for every change to my-3dge

my-3dge is a fully 3D web game engine written and maintained only by AI agents. DOCTRINE.md governs everything here:
read it first. The plan and its ledger are PLAN.md; generated docs start at docs/INDEX.md. The game is not here.

## How to work
Where the doctrine and the plan are silent, use your judgment and record the call. When going against the doctrine
looks best, escalate with your reasoning (below); never deviate quietly. On-demand work packages wait for their
measured trigger (PLAN.md §9.1).
Testing budget (ADR-0022): verify with cheap, objective checks (suites, hashes, counts), never wall-clock time on
this shared machine. Long tests never hold up work (ADR-0023): the full run goes on GitHub after each merge, nobody
waiting on it. Unclear after a cheap test means no proven benefit: stop, record it as an open issue starting "Owner:"
and move on.

## Setup
bash scripts/setup.sh (idempotent; the SessionStart hook runs it) installs Node 24.22.0 (.nvmrc), resolves the
read-only sources, $MY3D2DGE_SRC (my-3d2dge@e37e4ee) and $SHARDFALL_SRC (shardfall@fa2dab6), cloning them into
.cache/src-* when unset, and runs npm ci. Never edit the sources. Offline it keeps Node 22: everything runs, but Node
goldens are recorded on 24. npm's warning that an .npmrc allow-scripts setting is ignored is expected.

## The doctrine, as checks
1. Agent-readable: one concept per file, ≤ 400 lines (hard 600), a JSDoc file comment; docs come from comments.
   → npm run check, x docs --check
2. Agent-operable: every capability through npm scripts, node x or __engine, never only in a page.
   → command smoke tests, the help() check
3. Verifiable without a display: the sim runs headless; visual checks are numbers (ID pass, metrics, thumbnails);
   the HTML/CSS UI is checked through DOM queries. → npm test, x replay, npm run e2e
4. Assets: procedural first, then text and data; binary only with the owner's approval (fonts are pre-approved).
   → x check, x esc
5. Reproducible: fixed 60 Hz, recorded intents, named seeded RNG. Game code writes the standard Math; the sim swaps
   in fdlibm ports while it steps, so one golden per replay holds in Node and Chromium.
   → ESLint sim bans, replays, the drift test
6. WebGPU only, no WebGL fallback. Gameplay runs only on the CPU: sim-side code never imports gfx, the renderer, the
   DOM or Web Audio, and no GPU result reaches the sim. → ESLint layer rules, tests/e2e/parity.spec.ts
7. Common ground: game code meets npm, Vite, Vitest, Playwright and a public API in plain terms; a bespoke
   game-facing tool only where nothing fits, with the reason in its file comment. → verifier, ADR-0019
8. Quality under the hood: game code imports only engine/index.ts and engine/sim-api.ts; behind them, the best
   approach you can execute well. Every public export is documented and every error names its fix.
   → ESLint public-API rule, x docs --check, ADR-0020
9. Mastery: only the pins tools/deps.json records, and an upgrade is a work package of its own; write the pinned
   release's idioms (docs/THREE-DELTA.md). → x deps --check, banned names
10. Discovery first: target this container (Node 24, Chromium 141, WebGPU on SwiftShader); no production hardening
    outside Phase H, except ADR-0021's touch controls and Vercel deployment.

## Escalate, don't stall
Owner approval needed (a binary asset, a new dependency, spending money, a repo setting, any other outward action;
pushes, stage PRs, merges and branch deletions are pre-approved, ADR-0021), a principle can't be met, or going
against the doctrine looks best: node x esc open … → post it → wait up to 15 minutes, doing the preferred
alternative, never the action itself → answered: act on it. No answer: commit, decide, node x esc decide …,
continue, and report later conflicts without stopping. Record every escalation, conflict and call.

## The loop
1. node x deps --update: adopt compatible releases first, in a commit of their own.
2. Read your WP in PLAN.md §9 and only the sections it cites, and the file comments of the modules you touch (not
   whole files). The sources being ported are read-only (node x src).
3. Edit. The after-edit hook formats and lints the file: fix what it reports.
4. npm run check → npm test. Browser specs (npm run e2e -- <spec>) only for what only they check that you touched
   (rendering, the page, the DOM) or a failure you are finding and fixing, never the whole set while you work.
5. Read out/**/report.json. Open images only when a metric points at one (use the visual-reviewer subagent).
6. Show it in the box or a fixture test. Update the ledger row in PLAN.md §14 (in ultracode lanes, report it).
7. Commit "<area>: <what> (WP-x.y)". Report the commit, the report paths and any escalations.

## Rules
- SI units, +Y up, characters face +Z. Gameplay time is in 60 Hz sim ticks. Randomness comes from named streams.
- DOCTRINE.md changes only when the owner asks. Never edit out/ or node_modules/ by hand.
- Never skip, disable or loosen a test to get green. Baselines change only with a written reason.
- Merge on the quick gate (ADR-0023): squash-merge a PR once node x ci --local is green on its head. GitHub then
  runs the full run on main; nobody waits on it. node x ci --status (the SessionStart hook prints it) says how
  main's last one went: a red main is fixed before other work.
- At each gate and at the end of a goal: push, open the stage's PR, merge it, then wait for main's full run and
  report it. Start the next stage from the updated main (PLAN.md §11.1).
- Vercel and the touch controls have no tests (ADR-0021). The owner paused Vercel on 2026-10-15 (ADR-0023): until
  they say it is back on, ignore its statuses and errors. When it is on, look once at a stage PR's Vercel status and
  fix a failed build; fix anything else about either only when the owner reports it.
- Never downgrade silently: every downgrade emits an advice code.
- Ask the entry, never the id: shared code reads registry hooks and never compares ids.
- No game content in the engine; the box's own content stays in labs/box/ (PLAN.md §5.7).
- Docs are generated from comments: never restate a fact in prose (x docs --check).
- Deviations from PLAN.md become ADR amendments in docs/decisions/, with the plan edited in the same commit (§11.4).
- Blocked by the core? Write the smallest core change as a proposal in your WP notes. Don't widen your WP.
- Say plainly what you did not verify.

## Done means
Verify commands green; npm run check and npm test green; the specs for what only T2 checks that you touched green;
shown in the box or a fixture; file comments and docs current; a template for any kind written by hand a third time;
QA for kinds with a QA family; a verifier review for L-size WPs; no new advice codes; escalations recorded; ledger
updated.

## Where things are
Task guides (docs/INDEX.md opens with them), each read when the task needs it:
- docs/PROGRESS.md: read first, every session: where things stand, what is next, the open issues.
- docs/TESTING.md: the tiers, and which unit tests and specs a change selects.
- docs/HANDOFF.md: starting in a new environment, handing the engine to an agent to try, and the box against
  my-3d2dge's stress-world.
- labs/box/README.md: the box's scenes, settings and quick loop; adding a scene or a variant (a variant is a new
  scene file or a settings preset, never a change of meaning in a passing scene).
- tests/replays/README.md: the replay format; checking, recording and making replays.
- tools/templates/: `node x new <kind> <id>` writes a module, scene, material… from its kind's template and checks it
  (`node x new` lists the kinds).
- .claude/skills/: the skills, each loaded when its description says (x-loop after any change, stress-box for the box,
  determinism-debugging when hashes part, rapier, three-webgpu, escalation).
