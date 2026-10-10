# ADR-0010: Animation library: readable key poses

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §10

## Decision
- The stored format is readable key poses: format 1, extended as format 2 (§10.2).
- At load they are baked to rotation tracks that are also three.js `AnimationClip`s, so game code meets a familiar
  type.
- The CMU library comes on demand (`x anim cmu` fills `.cache/`; §13.2 Q10).

## Why
Doctrine Assets: text and data agents read and edit directly, never binary clips. Baking to `AnimationClip` keeps the
public API common ground.

## Enforced by
The library's tests and QA (WP 8.6); the asset scan in `x check`.

## Amendment 1 (2026-10-10, WP-8.2)
- **The decode reads format-1 fields only.** Format 2's key fields (`hand`, `roll`, `yaw`, `spine`, `grip`) are
  parsed, in-betweened, mirrored, lensed and printed, but no clip in the library writes them yet, so there is nothing
  to check a decode against. WP 8.8, which first writes them, defines their decode together with the encode (WP 8.5)
  that produces them. Unknown fields are refused, not ignored.
- **Reference decodes use each clip's own source rest body** (`set.sources[clip.src].rest`), stored as the source's
  float32, as the source decoder does. With that, all 21,116 frames (30 fps) of the 325 curated clips decode
  bit-identical to the oracle (max 0 mm; `engine/anim/clip/readable.test.ts`).
- **File split under the 400-line cap:** `RestBody` and the set types live in `validate.ts`, the field tables in
  `lens.ts`. The oracle loader is about 5 lines; `tools/anim/legacy-readable.ts` (169 lines) also records the clip
  vectors (3 float32 samples per clip plus a sha256 over every frame; every frame goes to `out/port/clips/`).
- **Not ported yet:** the importer half of `readable.js` (`measure`, `encode`, `fit`, `capSample`, `reduce`) moves
  to `engine/anim/clip/encode.ts` in WP 8.5, which needs it; `readable.ts` exports `torso()` for it. The codec is
  exported publicly by WP 8.4's library API, not by WP 8.2.
