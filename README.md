# my-3dge

A fully 3D web game engine written and maintained only by AI coding agents. Everything it draws, animates and plays is
made by code or readable data. It renders with three.js on WebGPU only, and simulates with Rapier physics. Gameplay runs
only on the CPU: it is reproducible, runs headless in Node, and the GPU improves speed and looks, never play. Game UI is
HTML/CSS. Games see a small public API built on the most widely used web tools (TypeScript, Vite, Vitest, Playwright,
ESLint, Prettier), so any agent can work with what it already knows; behind that API, the engine's internals use the
best approach its builders can execute well.

**Status: planning.** Nothing is built yet.

- [`DOCTRINE.md`](DOCTRINE.md): the owner's doctrine for this engine. It governs everything else.
- [`PLAN.md`](PLAN.md): the full plan.
  - §1–§3: the summary, the goals, and the doctrine turned into checks.
  - §9.0: **the Stress Box**, the engine's integration target: the *Stress test: 3D world* of
    [my-3d2dge](https://github.com/michaelcrosato/my-3d2dge), rebuilt from the ground up in six stages, from a small
    room to a hall with a crowd of 5,000.
  - §9: the work packages, stage by stage; §14: the status ledger.
- [`docs/research/`](docs/research/): the eight studies of my-3d2dge (October 2026) the plan is based on.

Work starts with Phase 0 of `PLAN.md`. It creates `AGENTS.md` (the rules every change follows), the platform setup
(Node 24), the standard toolchain behind npm scripts, the `node x` command line for what only this engine does, the
checks every later change must pass, and the escalation log. The game that will run on the engine lives elsewhere and
comes later.
