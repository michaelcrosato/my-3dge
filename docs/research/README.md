# Research behind PLAN.md

These are eight deep-dives into [my-3d2dge](https://github.com/michaelcrosato/my-3d2dge) at v0.14.0 (commit `e37e4ee`),
written on 2026-10-09 to plan my-3dge. They are point-in-time notes, not living documentation:

- **`PLAN.md` and its ADRs are canonical.** Where a note and the plan disagree, the plan wins, and the plan records why.
- **Citations** use the form `path:line` and refer to the source repo at that commit (`ed/` means `src/emberdeep/`).
  Re-check a citation before relying on it.
- **Measurements** were taken with throwaway probe scripts that are not kept here; the numbers are quoted as measured.
- **The notes on the game (Emberdeep)** describe engine-grade patterns to rebuild generically. Its content stays out
  (`PLAN.md` §5.7).

| Note | Covers |
|---|---|
| [A](A-stress-world.md) | The 3D world runtime, `src/stress-world/`: architecture, sim/render split, Rapier, level text, rendering, cameras, tests |
| [B](B-lab3d-build-vendor.md) | The 3D world lab `src/lab3d/`; the free-camera fly renderer; vendoring; the headless WebGPU test harness; the build |
| [C](C-rig-animation-core.md) | The rig and animation core of `engine/my-3d2dge.js`, and the design for a renderer-agnostic `anim/` module |
| [D](D-mocap-library.md) | The motion-clip library, its readable key-pose format, the runtime, the toolchain, and the migration plan |
| [E](E-engine-support-systems.md) | The 2D engine's other systems (audio, textures, input, font, UI, levels…), with a verdict on each |
| [F](F-tooling-ai-workflow.md) | Tooling, tests, docs and the agent workflow: what works, what hurts, measured |
| [G](G-emberdeep-harvest.md) | Engine-grade patterns inside the game, the exclusion list, and the lessons learned |
| [H](H-web-3d-stack-2026.md) | The web 3D stack as of October 2026: three.js r182 → r186, Rapier, WebGPU reach, headless testing, audio, agent practices |
