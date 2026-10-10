# my-3dge

A fully 3D web game engine written and maintained only by AI coding agents. Everything it draws, animates and plays is
made by code or readable data. It renders with three.js on WebGPU only, and simulates with Rapier physics. Gameplay runs
only on the CPU: it is reproducible, runs headless in Node, and the GPU improves speed and looks, never play. Game UI is
HTML/CSS. Games see a small public API built on the most widely used web tools (TypeScript, Vite, Vitest, Playwright,
ESLint, Prettier), so any agent can work with what it already knows; behind that API, the engine's internals use the
best approach its builders can execute well.

**Status: Phases 0 and 1 are done (gates G0 and G1); Box 1, the first Stress Box stage, is next.** The repository
has its rules, toolchain and checks, and the reproducible kernel: deterministic math shared by Node and Chromium,
registries and settings, the world with its hash, capture and restore, scenes, sessions and replays that give one
golden hash in both runtimes, a headless app and the inspector (`__engine`). Rendering arrives with Box 1.
[`docs/PROGRESS.md`](docs/PROGRESS.md) is the one-screen status; the ledger in [`PLAN.md`](PLAN.md) §14 has every
work package.

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

## How to start

```sh
bash scripts/setup.sh           # Node 24.21.0 if missing (SHA-256 checked), the read-only sources, then npm ci
npm run typecheck               # tsc --noEmit against the pinned three.js and Rapier types
npm test                        # vitest run
node x ci --local               # the merge gate: every tier, summary in out/ci/summary.md
```

`scripts/setup.sh` is idempotent and prints the `export` lines for `PATH`, `MY3D2DGE_SRC` and `SHARDFALL_SRC` (it
appends them to `$CLAUDE_ENV_FILE` in Claude Code). The development platform is Linux x64 with Node 24.21.0 and
Chromium 141 (WebGPU on SwiftShader). The rest of the toolchain is `npm run check` (types, lint, format and the
repository checks), `npm run e2e` (the browser suites) and the `node x` command line (`node x help`).

## Deploying

Vercel imports the repository, and [`vercel.json`](vercel.json) does the rest: `npm ci`, then `npm run build` (plain
`vite build`, on the Node 24 that `package.json`'s `engines` names), then `dist/` served as static files. Every push
deploys: `main` to production, other branches to previews. The landing page, `index.html`, opens the hello page with
the URL's query and hash, and opens the box once it exists. Nothing tests the deployment, by the owner's order
([ADR-0021](docs/decisions/ADR-0021-owner-calls-2026-10-10.md)). To build and serve the same output locally:

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
