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

## Amendment 4 (2026-10-11, WP-8.5)
- **The codec's frame math has one copy: `engine/anim/clip/frames.ts`.** It holds the vectors, frames, quaternions,
  `fromEuler`, `reachOf`, the limb hint `hintFor`, `limbEnd` and `torso`. The decode (`readable.ts`) and the encode
  (`encode.ts`) both import it, which replaces amendment 1's "`readable.ts` exports `torso()` for it". The decode keeps
  `ik3` and `poleHint`; the encode keeps their inverses (`euler`, `bendOf`, `poleOf`, `bodyFrames`). WP 8.8 changes
  format 2's spine, roll and yaw in this one place. The move fixes a WP 8.2 file and changes no behaviour: all 325
  curated clips still decode bit-identical to the source, the encode still matches the source oracle, and
  `x anim import --cmu --legacy --check` still reproduces the CMU set byte for byte.
- **`x anim cmu` reads entries near each other in one range request**: entries share a request only when the unwanted
  bytes between them are at most 256 KiB. One request to the CMU site costs about 0.13 s, measured. Shardfall reads
  each entry on its own.

## Amendment 5 (2026-10-12, WP-8.9): clip sets in the registry, clips on actors
- **The sim reads no files, so sets reach scenes through the kind `clipset`** (§6.6's Phase 8 kind). A page or tool
  registers them with `defineClipSet` or `clipSetFromFiles`, as actions are (ADR-0009 amendment 7). `defineSetBuild`
  registers `build:mannequin` sim-side.
- **An actor's clip layer is sim data:** `spawnActor`'s `clips` adds the component `clips` (sets, IK, blade,
  `ClipLayerState`). The system `actors.clips` steps it after `actors.anim` at ground speed and emits events as `clip`.
  API: `playClip`, `stopClip`, `seekClip`, `locomoteClips`, `clipLayerOf`, `addClips`.
- **`ClipLayerPool` loads layers from the component at every use.** The sim keeps one pool per world and the view its
  own, so sim bakes are never shared with the view.
- **`spawnActor`'s `body` adds the component `puppet`.** The view's actors draw that body and lay the clip layer over
  the pose. `__engine.anim` shows the clips slot.
- **The box page loads the library only for `?scene=clips`** (`labs/box/library.ts`, `labs/box/main.ts`).
- **WP 8.9's Owns grows** (PLAN.md edited to match): it owns `engine/anim/clip/clipsets{,.test}.ts`,
  `engine/sim/actorClips{,.test}.ts`, `labs/box/library.ts` and `labs/box/scenes/clips.test.ts`, and extends
  `engine/sim/actors.ts`, `engine/gfx/puppets/actors{,.test}.ts`, `engine/app/animMember.ts`, `engine/anim/api.ts`,
  `engine/sim-api.ts` (append), `labs/box/{main.ts,README.md}` and `tools/lib/tiers.ts`'s `LONG_RUNS`.
- **Every host registers the library** (gate G8's review closed the deferral): `x sim`, `x perf`, `x replay`'s Node
  runtime, `x describe` and tests through `tools/anim/library.ts` (`defineLibrary`, once a registry), the box page and
  `tests/pages/replay.ts` through `labs/box/library.ts`; both end with the same entries (library.test.ts). The box page
  loads it for `?replay=` a clip-mode replay too. `tests/replays/box-8-clips.replay.json` (a clip change, frame stepping,
  the hero walking under a one-shot masked to his upper body) gives one set of goldens in Node, the sim page and the
  rendering page; it is a `STAGES` entry of tests/e2e/parity.spec.ts. Cost: about 0.5 s more per Node host run.

## Amendment 6 (2026-10-14, after G9, WPs 8.4 and 8.6): the lift and the knee, retargeted
- **The lift follows the source.** `retargetPose` raises a pose only as far as it sinks below its source's own lowest
  point, scaled by the hip-height ratio (engine/anim/clip/retarget.ts), where it raised every pose to stand on the
  floor: a swim or a clip rising out of the ground keeps its depth instead of hovering (Quaternius' Swim_Idle_Loop
  stood 1,813 mm up on the mannequin). Feet the source stands on stay put, except where a hand or the head would sink
  through the floor on the build's proportions: the pose then rises by just that much (15 clips, retarget.test.ts).
- **The knee follows the source.** Contact IK passes the source's knee, seen from the middle of its hip and ankle, as
  the pole once it stands 2 cm off that line (`KNEE_POLE`), where it took the thigh frame's default and swung the
  knee through at deep folds.
- **Call, with the baselines' reasons:** Zombie_Rise, which rises with its hips under the floor by design, keeps its
  pop (0.7215 → 0.7119), gains a twistJump (build:skeleton's thigh rolls 2.81 rad at frame 106, as the source's knee
  crosses its hip–ankle line) and an underFloor of 4.9 cm (it now keeps its source's depth); Swim_Fwd_Loop gains an
  underFloor of 8 mm for 2 frames. Both are the clips' own motion followed more closely, so they are accepted in
  tests/baselines/qa-anim-library.json rather than special-cased: a fold limit for the pole would trade one clip's
  flip for every deep get-up's swing.
- Evidence: `engine/anim/clip/retarget.test.ts`, `engine/gfx/puppets/bodies/mannequin.test.ts`, `node x qa anim`.

## Amendment 7 (2026-10-24, WP-8.8): format 2's decode, defined with its encode
- **Hands: `handL`/`handR` `[flex, side, roll]` and `gripL`/`gripR` (0–100)** (engine/anim/clip/hands.ts). The frame
  sits at the decoded wrist: the forearm's direction, the thumb's side opposite the elbow's pole (the decode's own
  hint, so it turns with the arm), the palm's side their cross product signed per side. `roll` turns the thumb toward
  the palm, `flex` the hand toward the palm, `side` the hand toward the thumb; the index and pinky knuckles sit 20 mm
  either side of the middle knuckle along the turned thumb axis (they are the captured knuckles, `index_01` and
  `pinky_01`, where format 1 hangs them off the fist), and the fist point curls toward the palm by `grip` × 0.9°.
  Every turn is toward a vector of the same side, so the same numbers draw the mirror image on the other side and
  mirroring stays a swap.
- **A key with a hand reaches a straight hand's fist.** With hands on, the encoder aims the arm's IK at the point a
  straight hand would hold, on the captured forearm's line, so the elbow and the wrist decode where the capture had
  them and the hand's own turn is written apart. A key without `hand` and `grip` decodes as format 1 does, bit for
  bit (the oracle tests).
- **The spine override: `spine [turn, lean, tilt]`** (engine/anim/clip/spine.ts; decoded in frames.ts `torso`)
  turns the spine's two middle bones together, relative to the body, in place of their shares. Its bend takes the
  decoded `spine1` to the captured chest; its twist about the spine is the shares' own, since the two bones lie almost
  in line and say little about it. The importer writes it on every key of a clip whose shares miss the capture's neck
  by more than `SPINE_MISS` (15 mm, half the importer's tolerance), on none of the others, since `keyAt` holds a field
  the next key lacks. Measured on Mesh2Motion: the shares miss by more than 15 mm in 72 of 178 clips, up to 129 mm
  (`Bow`); fitted with hands and the override, `Bow`'s worst frame falls from 184 to 34 mm, `Angry`'s from 170 to 35.
- **Foot roll: `rollL`/`rollR`** (engine/anim/clip/feet.ts) turn the toes' plane about the decoded ankle-to-ball line,
  + turning the sole inward, and the toes bend in the rolled plane. The ankle, ball and toe are not in line (the toes
  lie about 30° off the ankle-to-ball line at rest), so the 36 body points show the roll and the importer reads it
  from them: no extra capture data. Format 2 writes it on every key. Mesh2Motion's feet roll 20 to 35° in their
  strides and crouches; with the roll, `Land_Three_Point`'s worst toe falls from 101 to 46 mm.
- **The baker follows** (bake.ts): a key's hand turns the hand joint to the hand frame and its +Z toward the thumb,
  the override sets the middle spine joints, the roll turns the foot joint about its rest ankle-to-ball line and the
  toe with it. The skeleton has no fingers, so a grip closes only the decoded fist; FK parity holds against the decode
  with its grips open.
- **Call: no root yaw.** No source this session can read turns its root: Mesh2Motion's 177 clips keep their root's
  heading within 0.5° (their turns, `Turn_Left_90` among them, are in the body), and CMU's root is its pelvis. So the
  importer writes no `yaw`, and its decode waits for a source that turns its root (the Quaternius GLBs' root-motion
  clips may: ESC-0003); the field stays carried, mirrored and printed as before.
- **Format 2 bends a limb as the capture does** (encode.ts): its bend comes from the captured shoulder or hip to the
  limb's end, not from the decoded one. A nearly straight limb's bend swings by about a degree for every 0.6 mm its
  reach gains or loses, so the decoded shoulder's few millimetres used to fold it: `Turn_Left_180`'s elbows landed 31
  to 42 mm off where format 1's landed 9 to 11; now 5. Format 1 (`--legacy`) keeps the source's rule, for its bits.
- **The spine override only where it helps:** the importer fits a clip whose shares miss both ways and keeps the
  override only when it brings the worst frame closer. CMU's neck bone is long and follows the chest (its share is
  0.05), so on some frames a chest put right bares the neck's own miss at the head (`Drink_Water`: 61 → 92 mm).
- **Contacts and events, detected at import** (tools/anim/contacts.ts), watched in the ground's frame: the root's
  travel added, an in-place loop's treadmill taken away (the planted balls' median velocity along the floor, or the
  velocity most hand and foot frames share: an in-place ladder's rungs sinking at 0.6 m/s). A foot holds where its
  sole is within 30 mm of the floor, or where its ball holds still while the pelvis moves 5 cm past it; a hand where
  its knuckle holds still for 0.15 s while the pelvis moves 5 cm past it, or lies still on the floor or above the
  head. `step` where a foot's contact begins, `land` where one begins after a quarter second with nothing held, `hit`
  in an `attack` or `kick` clip at the runtime's own strike time. Known limit: a hand still while the body is still
  too, below the head and off the floor (an idle's, a held wall), reads as no contact.
- **Call: parity is two decodes of one capture, and no worse** (tools/anim/upgrade.ts; PLAN.md §10.5 step 9 and WP
  8.8 edited to match). The plan asked each re-imported clip's decode to lie within the old clip's fit of the old
  decode. That rule sits on its own boundary: a format-2 clip that holds its capture closely lies from the format-1
  decode by just the format-1 clip's error against that capture, which is its fit, so the upgrades that mend most
  fail it by a millimetre or two (104 of Mesh2Motion's 177, 47 of CMU's 60). The rule kept: the two decodes lie within
  the sum of their fits of each other, mean and worst (two decodes each within its fit of one capture can lie no
  farther apart: the same motion; every clip of both sets passes), and the new clip fits its capture no worse, mean
  and worst. Mesh2Motion: 175 of 177 swapped in; CMU: 51 of 60. The others stay as they were, each with its reason in
  data/anim/upgrade.json (a worse worst frame, or a worse mean by a millimetre or two: CMU's format 2 in-betweens its
  takes' frames where format 1 took the nearest, so each is fitted to a slightly different capture).
- **Sources:** Mesh2Motion's three `.glb` files at mesh2motion-app@653a969, each checked by its sha256 (`x anim
  fetch`; the repository's API and archives are not reachable here, its raw files are); CMU's picked takes by range
  requests, as before. The Quaternius GLBs wait for the owner (ESC-0003) and the 100STYLE sets for a defect that touches
  them (tools/anim/fetch.ts `SET_SOURCES`); `x anim upgrade <set>` refuses both, saying why.
- **Call: the ledger's re-survey waits for a pick** (PLAN.md §10.5 step 10). `x anim cmu survey` now fits format 2
  (as the importer does, `fitFormat2`), so every row it writes from here on reflects format 2, and the CMU set's own
  60 clips are fitted in format 2 by the upgrade. Re-fitting the ledger's other takes now would need CMU's whole 1.08
  GB archive and hours of fits for numbers that only rank takes for browsing; they are re-surveyed subject by subject
  as games pick their rows (`x anim cmu survey --subjects …`), the notes kept, as step 10 already says of the picks.
- Evidence: engine/anim/clip/hands.test.ts (random turns and grips back to the degree and the whole, either side; the
  mirror image; a capture with turning, closing hands fitted within 30 mm and its hands within 15 mm, more than three
  times closer than format 1), engine/anim/clip/feet.test.ts, engine/anim/clip/spine.test.ts,
  engine/anim/clip/mirror.test.ts (a mirrored format-2 clip decodes to the reflected body, every hand, spine and toe
  point with it), engine/anim/clip/bake.test.ts (FK of a format-2 key rebuilds every rigid point; a flipped roll sign
  misses by 57 mm), tools/anim/contacts.test.ts, tools/anim/upgrade.test.ts, tools/anim/glb-library.test.ts (a skinned
  mesh read through its inverse bind matrices, the WP's prerequisite), tests/unit/data/anim/upgrade.test.ts (the 80%
  per set, the kept clips listed, every swapped clip's format-2 fields in full).
