# Clip decodes from my-3d2dge

Written by `node x port refs --clips` (tools/cmd/port.ts, tools/anim/legacy-readable.ts, PLAN.md WP 8.2), which needs
the source (`node x src`); never by hand. `--check` and `x check` compare them with `../checksums.json`, offline.

- **Source:** my-3d2dge@e37e4eedcd23326f3734188b9574a4aa635fcbd3. The oracle is its own codec, run in a Node
  24 `vm` context; the clips are its own sets, never data/anim/sets/:
  - `src/mocap/readable.js`: sha256 627ab2b65c6a4c88fd326c1f5039aba50afabc4a79875085e1d7c54fcc72144e
  - `src/mocap/sets/quaternius.js`: sha256 c5ea4a45f039cb8676fafaa26f26041a0a34d527ba1d18e13e9fce1dfad5afc1
  - `src/mocap/sets/mesh2motion.js`: sha256 a1f90daff84348244e85743ac4668a49644901d1c907a46374ee3d6419e2f091
  - `src/mocap/sets/cmu.js`: sha256 4f50eb86020029ddb8f4409077bfe128eb17500ab487ea50594735a8e427e5d0
- **Decodes:** `MR.pose(rest, clip, frame / 30)` for every frame of every clip, `frames` = round(dur × 30) + 1,
  on the clip's own source's rest body (`set.sources[clip.src].rest`), as the source's Float32Array holds them: the
  36 `points`, each `[f, r, z]` in mm (forward, right, up; to my-3dge, Appendix C: (−r, z, f) / 1000 m).
- **Committed:** three samples per clip, frames 0, ⌊(n − 1)/3⌋ and ⌊2(n − 1)/3⌋, each `[frame, …108 numbers]`, every
  number the shortest decimal that reads back to the same float32 (`Math.fround`), `-0` kept.
- **Checksums:** a clip's `sha256` covers all its frames: their float32 bytes, little-endian, frame after frame. The
  full set is regenerable: `--clips` also writes every frame to `out/port/clips/<set>.json`, in this layout.
- engine/anim/clip/readable.test.ts holds the port to these within 0.001 mm and the oracle to them bit for bit.
