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

## Amendment 2 (2026-10-10, WP-8.3)
- **Layout:** `data/anim/sets/<set>/` holds one `<clipSlug(name)>.json` per clip, which is exactly the clip's `text()`
  (three lines a key), plus `_set.json` (the set minus its clips, in its own key order) and `catalog.tsv` (generated:
  3 `#` lines, then `name sec loop speed tags desc src orig take fit`; fit is mean/worst; trailing empty fields
  trimmed).
- **Each set's `fit` map stays in `_set.json`**, not per clip, and its order is the clip order that `joinSet`
  restores.
- **Slugging** turns each run of characters other than `[A-Za-z0-9_-]` into `_` and trims `_` and `-` at the ends;
  names that collide, even in case only, are refused.
- **Clips with an `orig` get `alt` as their last tag** (the 84 Mesh2Motion re-exports).
- **Prettier skips `data/anim/sets/`**, like ADR-0014 amendment 3: it would spread each key over 13 lines (4x the
  lines, 1.43x the bytes), and the tests pin every byte.
- Until WP 8.5's `anim` command, the repacker runs as `npx tsx tools/anim/repack.ts [--check] [set.json…]`.

## Amendment 3 (2026-10-11, WP-8.6)
- **WP 8.6 extends `tools/qa/anim{,.test}.ts` and `tools/cmd/sheet{,.test}.ts` from WP 6.6.** It adds
  `tools/qa/anim/clips.ts` (ids `clip:<SET>/<Clip>` and `set:<SET>`; baseline `tests/baselines/qa-anim-library.json`),
  which the family imports when it runs. An empty `only` now also plays every clip. For that reason `x sheet humanoid`
  passes the humanoid's own id kinds (`qaPrefixes`, from `humanoidPrefixes` in `anim.ts`, which also picks up WP 8.7's
  `action:`) and no longer passes `[]`. Its QA reports the humanoid alone, never the library, the blob or the floater.
- **Clips play at once, at one facing, with no rest before or after**, on `HUMANOIDS` and `build:mannequin`. Foot
  slide waits for format-2 contacts (WP 8.8).
- **T1 checks every clip's data and plays a sample.** The full sweep (about 40 s) is a `LONG_RUNS` entry in
  `tools/lib/tiers.ts`.
- **Fixes to WP 8.4 files:** `bake.ts` puts the pole on the side the limb bends away from, so a fold never bends
  backward (`anim-clips.json` rewritten; the `clip-parity.ts` `@example` cites the new means, 0.315 and 0.155 mm).
  `library.ts` `replace()` parses before it records the original.
