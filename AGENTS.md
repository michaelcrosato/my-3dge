# AGENTS.md: rules for every change to my-3dge

my-3dge is a fully 3D web game engine written and maintained only by AI agents. DOCTRINE.md governs everything here:
read it first. The plan and its ledger are PLAN.md; generated docs start at docs/INDEX.md. The game is not here.

## How to work
Act as a trusted, capable manager of this engine. Where the doctrine and the plan are silent, use your judgment and
record the call. When going against the doctrine looks best, escalate with your reasoning (below); never deviate
quietly. Aim for the best expected overall result, not flawless software: solve problems when they surface, not in
anticipation. On-demand work packages wait for their measured trigger (PLAN.md §9.1).

## Setup
bash scripts/setup.sh (idempotent) does three things:
- Node 24.21.0 (.nvmrc): when the active node differs, it downloads the official build from nodejs.org, checks it
  against SHASUMS256.txt and keeps it in ~/.cache/my3dge/. Offline, it keeps the container's Node 22: everything runs
  there too, but Node goldens are recorded on 24.
- The read-only sources: MY3D2DGE_SRC (my-3d2dge@e37e4ee) and SHARDFALL_SRC (shardfall@fa2dab6) are absolute paths.
  Set them to your own checkouts at those commits, or leave them unset: the script then clones .cache/src-3d2dge and
  .cache/src-shardfall (git clone --shared from a local clone, else GitHub) and detaches them at the pinned commits.
  Tools resolve them the same way ($VAR, else .cache/src-*), so no shell state is needed. Never edit them.
- npm ci.
It prints the export lines for PATH, MY3D2DGE_SRC and SHARDFALL_SRC, and appends them to $CLAUDE_ENV_FILE when that is
set. Phase 0 builds the tools below one WP at a time: until a command exists, skip its step (PLAN.md §9.3).

## The doctrine, as checks
1. Agent-readable: one concept per file, ≤ 400 lines (hard 600), a JSDoc file comment, strict TypeScript the way
   agents usually write it, docs generated from comments.   → npm run check (tsc, ESLint, Prettier), x docs --check
2. Agent-operable: every capability through npm scripts, node x or __engine; nothing only in a page.
                                                            → command smoke tests, the help() check, verifier
3. Verifiable without a display: the sim runs headless; visual checks are numbers (ID pass, metrics, thumbnails);
   the HTML/CSS UI is checked through DOM queries.          → npm test, x replay, npm run e2e
4. Assets: procedural first, then text and data; binary only with the owner's approval (fonts are pre-approved).
                                                            → x check (asset scan), x esc
5. Reproducible here: fixed 60 Hz, recorded intents, named seeded RNG. Game code writes the standard Math; the sim
   swaps in fdlibm ports while it steps, so one golden per replay holds in Node and Chromium. Captures restore
   exactly.                                                 → ESLint sim bans, replays, the drift test
6. WebGPU only: no WebGL fallback (GFX_NO_WEBGPU without it). Gameplay runs only on the CPU: sim-side code never
   imports gfx, the renderer, the DOM or Web Audio, and no GPU result reaches the sim. Game UI is HTML/CSS.
                                                            → ESLint layer rules, tests/e2e/parity.spec.ts
7. Common ground: what game code touches is familiar: npm, Vite, Vitest, Playwright, ESLint, Prettier, and a public
   API in plain terms (three.js's math, materials and clips as data). Bespoke game-facing tools only where nothing
   fits, with the reason in the file comment.               → verifier, ADR-0019
8. Quality under the hood: game code imports only engine/index.ts and engine/sim-api.ts. Behind them, use the best
   approach you can execute well (TSL, compute, newer releases when measured). Every public export is documented and
   every error names its fix, so game agents never read internals.
                                                            → ESLint public-API rule, x docs --check, ADR-0020
9. Mastery: each pin is the newest release compatible with the newest one ≥ 12 months old, adopted at once;
   internals may go newer when measured. Write the pinned release's idioms (docs/THREE-DELTA.md).
                                                            → x deps --check, x deps --update, banned names
10. Discovery first: target this container (Node 24 through scripts/setup.sh; its Chromium 141, WebGPU on
    SwiftShader); no production hardening outside Phase H, except ADR-0021's touch controls and Vercel deployment.

## Escalate, don't stall
Owner approval needed (a binary asset, a new dependency, spending money, a repo setting, any other outward action;
pushes, stage PRs, merges, branch deletions and the Vercel deploys they trigger are pre-approved), a principle can't be
met, or going against the doctrine looks best: node x esc open … → post it → wait up to 15 minutes, doing the
preferred alternative, never the action itself → answered: act on it. No answer: commit, decide, node x esc
decide …, continue. For the rest of the run, or until the owner answers, report further conflicts without
stopping. Record every escalation, every later conflict and every call.

## The loop
1. node x deps --update: adopt compatible releases first, in a commit of their own.
2. Read DOCTRINE.md, this file, your WP in PLAN.md §9 and only the sections it cites, and the file comments of the
   modules you touch (not whole files). The sources being ported are read-only at $MY3D2DGE_SRC and $SHARDFALL_SRC
   (node x src).
3. Edit. The after-edit hook formats and lints the file: fix what it reports.
4. npm run check (< 10 s) → npm test (< 60 s) → npm run e2e (< 6 min; PLAN.md §8.2 says what to select).
5. Read out/**/report.json. Open images only when a metric points at one (use the visual-reviewer subagent).
6. Show it in the box or a fixture test. Update the ledger row in PLAN.md §14 (in ultracode lanes, report it).
7. Commit "<area>: <what> (WP-x.y)". Report the commit, the report paths and any escalations.

## Rules
- SI units, +Y up, characters face +Z. Gameplay time is in 60 Hz sim ticks. Randomness comes from named streams.
- DOCTRINE.md changes only when the owner asks. Never edit out/ or node_modules/ by hand.
- Versions: only the pins in package.json, as tools/deps.json records them. Upgrades are their own work packages.
- Never skip, disable or loosen a test to get green. Baselines change only with a written reason.
- At each gate: push, open the stage's PR, look once at its Vercel status (fix a failed build first), squash-merge
  it once x ci --local is green (the repository allows only squash merges, and GitHub then deletes the branch).
  Start the next stage from the updated main (PLAN.md §11.1). None of this needs the owner's approval (ADR-0021).
- Touch controls and the Vercel deployment have no tests, by the owner's order (ADR-0021): fix a failed Vercel
  build; fix anything else about them only when the owner reports it.
- Never downgrade silently: every downgrade emits an advice code.
- Ask the entry, never the id: shared code reads registry hooks and never compares ids.
- No game content in the engine; the box's own content stays in labs/box/ (PLAN.md §5.7).
- Docs are generated from comments: never restate a fact in prose (x docs --check).
- Deviations from PLAN.md become ADR amendments in docs/decisions/, with the plan edited in the same commit (§11.4).
- Blocked by the core? Write the smallest core change as a proposal in your WP notes. Don't widen your WP.
- Say plainly what you did not verify.

## Done means
Verify commands green; npm run check and npm test green; T2 green for what you touched; shown in the box or a
fixture; file comments and docs current; a template for any kind written by hand a third time; QA for kinds with a
QA family; a verifier review for L-size WPs; no new advice codes; escalations recorded; ledger updated.

## Where things are
engine/ (code + unit tests; index.ts and sim-api.ts are the public API) · labs/box/ (the Stress Box) · data/
(readable data) · fixtures/ · tools/ (x commands, content QA, the ESLint plugin, deps.json) · tests/ (e2e, replays,
baselines) · docs/ (generated INDEX/API/ERRORS, ADRs in docs/decisions/, escalations, reference) · scripts/setup.sh
(the platform) · .cache/ (git-ignored: the source checkouts, importer inputs)
