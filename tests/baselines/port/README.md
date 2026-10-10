# Reference vectors from my-3d2dge

Written by `node x port refs` (tools/cmd/port.ts, PLAN.md WP 0.11), which needs the source (`node x src`); never by
hand. `--check` and `x check` compare every file with `checksums.json` (sha256), offline. A re-run is byte-identical,
so a diff means the source, the generator or the runtime changed: a baseline changes only with a written reason.

- **Source:** my-3d2dge@e37e4eedcd23326f3734188b9574a4aa635fcbd3, `engine/my-3d2dge.js` (sha256 86adf03e52a60a1d5944281aff9cce54af08a85c1ff64a9f771e8cc080796999), on Node 24, in
  a `vm` context whose only shim is `console` (a message fails the run). `Math.random` is `E.rng` seeded with the
  FNV-1a hash of each record's id (`humanoid/<build>/<state>`, `move/<build>/<name>/<phase>/<i>`,
  `blob/<script>`). Nothing is drawn, so no view hack runs (`_cheat` 0, `_pitch` and `_camSide` unset: a swing is
  vertical only with `plane: 'side'`, the left hand waves). No rig has a cape or long hair.
- **Numbers** are exact: the shortest decimal that parses back to the same double, `-0` kept. Times are in seconds.
- **Frames:** positions are the source's (x east, y south, z up, 16 units per metre, left-handed). To my-3dge (Appendix
  C): (x, y, z) → (x, z, y) / 16 m; facing φ (forward (cos φ, sin φ)) → yaw ψ = π/2 − φ; rig-local (f, r, z) → (−r, z,
  f) / 16; move fields by Appendix C's table.
- `core.json`, `color.json` (WP 1.1, bit for bit; angle helpers within 1e-12): each helper's inputs, then outputs;
  `rng` gives 64 outputs per seed, `ease` each curve at u = i/20.
- `humanoid-<build>.json` (WP 3.6): a run is a fresh `new E.Humanoid({ build })`; `t0`, its clock after construction,
  is the initial breathing phase (breathing is sin(2.3 t)) the port injects. Then 120 calls `update(1/120, { x, y,
  z, ...input })`, the root moving from `root0` by `velocity` × dt before each. Stances walk; moving states go along
  the facing φ = kπ/4, k = `facing`. A sample (after the step it names) is the root, then the world positions of
  `points` (root + `rig._w(rig.J[…])`, and `rig.tip()`): every 4th step at facing 0, every 40th at
  the others, which differ only by the root's turn (to rounding) and so check the facing conversion.
- `moves.json` (WP 6.1): `E.move(name, u, phase)` for every move in `specs`, each phase, u = i/20, each build. Each
  sample is a fresh rig: `rig.t = -1; update(1, { x: 0, y: 0 })` (the rest pose at t = 0, no breathing or sway), then
  `rig.t = -1; update(1, { x: 0, y: 0, attack })`: dt = 1 saturates every smoothing, so the pose is the move's own at
  (phase, u), the wind blending from the rest pose. A sample is u, then `hand('R')`, `hand('L')`, `tip()` and the
  right foot, the rig at the origin facing φ = 0 (world = rig-local (f, r, z), but for `spin`'s turn).
- `blob.json` (WP 5.3): scripts on a fresh `new E.Blob()`: each segment holds `input` for `steps` updates of
  1/120 s, after `kick(v)` when named; every step is sampled. Body radius R(1 − 0.55 sq), height and centre R(1 + sq).
