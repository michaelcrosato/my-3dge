# my-3dge

A fully 3D web game engine written and maintained only by AI coding agents. Everything it draws, animates and plays is
made by code. It runs on three.js `WebGPURenderer` (WebGPU, with a WebGL 2 fallback) and Rapier physics. Gameplay is
deterministic and runs headless in Node. WebGPU-only techniques may improve speed and looks, and never gameplay.

**Status: planning.** Nothing is built yet. The engine is planned as a successor to the real-3D work and the animation
library of [my-3d2dge](https://github.com/michaelcrosato/my-3d2dge). The game that will run on it lives elsewhere and
comes later.

- [`PLAN.md`](PLAN.md): the full plan.
  - §1–§8: what to carry over and why, the target architecture, the improvements, and the tooling.
  - §9: the phased work packages.
  - §14: the status ledger.
- [`docs/research/`](docs/research/): the eight studies of my-3d2dge (October 2026) the plan is based on.

Work starts with Phase 0 of `PLAN.md`. It creates `AGENTS.md` (the rules every change follows), the `node x` command line,
and the checks that every later change must pass.
