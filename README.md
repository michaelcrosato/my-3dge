# my-3dge

A fully 3D web game engine written and maintained only by AI coding agents. Everything it draws, animates and plays is
made by code or readable data. It renders with three.js on WebGPU only, and simulates with Rapier physics. Gameplay runs
only on the CPU: it is reproducible, runs headless in Node, and the GPU improves speed and looks, never play. Game UI is
HTML/CSS. Games see a small public API built on the most widely used web tools (TypeScript, Vite, Vitest, Playwright,
ESLint, Prettier), so any agent can work with what it already knows; behind that API, the engine's internals use the
best approach its builders can execute well.

## Make a game with my-3dge

**Lean, the default, for any agent (a chat in a browser too):** read [`lean/README.md`](lean/README.md), one file
of about 10,000 tokens holding a small game that already plays. A game is one HTML page that loads the engine from a
CDN, the way three.js or Rapier load: nothing to install, build or test. Open the page in a browser with WebGPU.

**The full workspace, for a coding agent that also wants the engine's checks** (headless tests, replays, renders read
as numbers): a game lives in a repository of its own, never in this one. In the empty folder or fresh repository where
the game should live, run:

```sh
src=$(mktemp -d) && git clone --depth 1 https://github.com/michaelcrosato/my-3dge "$src" && node "$src/tools/game/new-game.mjs" .
```

That makes the game there (named after the folder; `--name dragon-run` names it): the engine, read-only and pinned
by `engine-lock.json`; a small starter game in `labs/game/` that already plays, is won by its bot and passes its
tests; and an `AGENTS.md` written for making a game. Then follow that `AGENTS.md`. Without git, unzip
[the ZIP of main](https://github.com/michaelcrosato/my-3dge/archive/refs/heads/main.zip) and run
`node <unzipped folder>/tools/game/new-game.mjs <dir>`. For the owner: [`docs/HANDOFF.md`](docs/HANDOFF.md).

## Status

[`docs/PROGRESS.md`](docs/PROGRESS.md) is the one-screen status, rewritten at each gate: where things
stand, what is next and the open issues. The ledger in [`PLAN.md`](PLAN.md) §14 has every work package.

## The doctrine

[`DOCTRINE.md`](DOCTRINE.md) is the owner's doctrine for this engine, and it governs everything else: agent-readable,
agent-operable, verifiable without a display, agent-accessible assets, reproducible on the development platform, WebGPU
only, common ground, quality under the hood, mastery over novelty, and discovery first. [`AGENTS.md`](AGENTS.md) turns
it into the rules every change follows; [`PLAN.md`](PLAN.md) §3 lists the check behind each principle.

## The Stress Box

The engine's integration target is the *Stress test: 3D world* of
[my-3d2dge](https://github.com/michaelcrosato/my-3d2dge), rebuilt from the ground up in six stages, from a small room
to a hall with a crowd of 5,000 (`PLAN.md` §9.0). Each stage adds engine systems, not game content, and ends with a box
that runs, is measured and is proved. The game that will run on the engine lives elsewhere and comes later.

## The Playground

The tech demo (Phase 13, [`docs/PLAYGROUND.md`](docs/PLAYGROUND.md)): a house on a block where the player moves as in
Apex Legends, in five cameras and two looks, with doors, melee, guns, neighbours, a dog, sound, day and night. Run
`npm run dev` and open http://127.0.0.1:5173/labs/playground/; `?replay=playground-tour&playground.attract=on` plays
the tour through every feature. [`labs/playground/README.md`](labs/playground/README.md) says how it plays and what
each scene shows.

## How to start

```sh
bash scripts/setup.sh           # Node 24.22.1 if missing (SHA-256 checked), the read-only sources, then npm ci
npm run typecheck               # tsc -b over tsconfig.check.json's projects (incremental), on the pinned types
npm test                        # vitest run
node x ci --local               # the merge gate: every tier, summary in out/ci/summary.md
```

`scripts/setup.sh` is idempotent and prints the `export` lines for `PATH`, `MY3D2DGE_SRC` and `SHARDFALL_SRC` (it
appends them to `$CLAUDE_ENV_FILE` in Claude Code). The development platform is Linux x64 with Node 24.22.1 and
Chromium 153 (WebGPU on SwiftShader). The rest of the toolchain is `npm run check` (types, lint, format and the
repository checks), `npm run e2e` (the browser suites) and the `node x` command line (`node x help`).

## Deploying

Vercel imports the repository, and [`vercel.json`](vercel.json) does the rest: `npm ci`, then `npm run build` (plain
`vite build`, on the Node 24 that `package.json`'s `engines` names), then `dist/` served as static files. To keep its
cost down ([ADR-0023](docs/decisions/ADR-0023-owner-calls-2026-10-15.md) amendment 4), a merge to `main` deploys to
production when it changes what ships, a branch push builds a preview only when its commit message says `[preview]`
([`scripts/vercel-ignore.mjs`](scripts/vercel-ignore.mjs)), and the hashed files under `/assets/` are cached for a
year. The landing page, `index.html`, opens the Stress Box (`labs/box/`) with the URL's query and hash. Nothing tests
the deployment, by the owner's order ([ADR-0021](docs/decisions/ADR-0021-owner-calls-2026-10-10.md)). To build and
serve the same output locally:

```sh
npm run build && npx vite preview
```

## Where things are

- [`AGENTS.md`](AGENTS.md): the rules for every change; [`CLAUDE.md`](CLAUDE.md) adds Claude Code's notes.
- [`PLAN.md`](PLAN.md): the full plan. §1–§3: the summary, the goals, and the doctrine turned into checks; §9: the
  work packages, stage by stage; §14: the status ledger.
- [`docs/decisions/`](docs/decisions/): the ADRs (PLAN.md §13).
- [`docs/research/`](docs/research/): the eight studies of my-3d2dge (October 2026) the plan is based on.

[MIT License](LICENSE).
