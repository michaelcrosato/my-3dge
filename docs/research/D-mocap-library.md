# D. The mocap / animation library and its toolchain (my-3d2dge → my-3dge)

**Scope.** I read these files in full:
- `docs/MOCAP.md`, `src/mocap/readable.js`, `src/mocap/mocap.js`;
- the catalogs `cmu.json` and `quaternius.json`;
- `tools/anim-import.mjs`, `anim-set.mjs`, `anim-sheet.mjs`, `asf-amc.mjs`, `cmu.mjs`, `mocap-lib.mjs`, `mocap-test.mjs` and `to-glb.py`.

I skimmed or read parts of:
- `mesh2motion.json`, the ledger (the first 160 lines, plus statistics over every row), every set file and the library files;
- `ed-clips-test.mjs`, `mocap.game.js`, `mocap.template.html`;
- `docs/ANIMATION-RESEARCH.md` (its structure, §4–§8 in full);
- `src/emberdeep/96-hero-clips.js`;
- and, for alignment, `src/lab3d/40-characters.js` and report C (rig core).

**Source tree and method.** The source tree is commit `e37e4ee` (v0.14.0). Nothing in either repository was modified. Two things back the numbers below:
- Prototypes in `scratchpad/scripts/v2*.mjs`. They decode every curated key with the repo's own `readable.js`, convert it to per-joint rotations and check it again by forward kinematics (FK).
- A re-run of the CMU import, with its cache and output in `scratchpad/cmu-verify/`.

---

## 0. Decisions in brief

1. **Bring the library over intact. It is cheap.**
   - **Curated clips:** 325 (QUATERNIUS 88, MESH2MOTION 177, CMU 60) in **1.93 MB of text** (393 KB gzipped).
   - **Catalogs:** three hand-written catalogs, 39 KB in all.
   - **Ledger:** one row for each of the database's **2,548 CMU takes** (262 KB).
   - **Leave out** `examples/cmu-lib/` (68 MB): it is a derivative, regenerated on demand. Drop HERO, Emberdeep's 15-clip subset.
2. **What the format is.** "Readable key poses" (`format: 1`) are engine-independent: `readable.js` has no dependencies.
   - **Position-based, not a rotation skeleton.** A key holds 42 integers that rebuild 36 body points on a measured rest body.
   - **It converts exactly to local rotations if you bake** at the clip's own interpolation: mean error **0.26–0.46 mm** at 60 Hz.
   - **Key-for-key conversion is unsafe.** Slerping between v1's keys gives outliers up to **0.73 m**, because v1 interpolates each stored number linearly.
3. **Source fidelity is not in the repo.** These degrees of freedom were never stored:
   - wrist and hand roll (hand roll survives only in 24 sword clips);
   - forearm twist;
   - foot roll;
   - the per-bone spine;
   - fingers;
   - root yaw;
   - detail above 30 fps.

   Average error against the capture is 14–18 mm. **The re-import path is proven.** Re-running `anim-import --cmu` on the public CMU data **reproduced `src/mocap/sets/cmu.js` byte for byte**: same sha256, 69 MB downloaded, about 1 minute. The Quaternius and Mesh2Motion GLBs are public too.
4. **Recommended canonical format: keep readable key poses as the stored, agent-facing format.**
   - Carry format 1 over byte for byte.
   - Make **format 2 a backward-compatible superset**: optional hands, foot roll, root yaw, a spine override, grip, events, contacts and props.
   - **Bake to rotation tracks for the runtime.** This matches report C §6.8, which gives the converter to this area.
   - A rotation-native text format was prototyped and measured as the fallback (§7.4).
5. **Layout.**
   - One file per clip, plus a TSV catalog per set.
   - The ledger split by category, plus a subjects table.
   - The CMU database fetched and converted on demand into `.cache/`, never committed.
6. **Tools.**
   - **Port with changes:** importer, ASF/AMC reader, `cmu.mjs`, `anim-set`, `mocap-lib`.
   - **Keep:** `to-glb.py`.
   - **Rewrite:** `mocap.js`, the lab, the contact sheets and the tests.
   - **Drop:** `hero.js`, `cmu-lib/` and `ed-clips-test.mjs`.

---

## 1. The readable key-pose format (format 1)

### 1.1 Container

A set file is a classic script written by `writeSet` (`tools/mocap-lib.mjs:19-38`). Its header comment holds the credit, the counts and the **full legend** (`readable.js:25-38`, about 450 tokens). Then:

```
(window.MOCAP = window.MOCAP || {})["QUATERNIUS"] = {
"set", "title"?, "format": 1, "credit", "from"? (picked sets), "fps": 30,
"sources": { "UAL1": { "file": "AnimationLibrary_Godot_Standard.glb", "rig": "rigify", "label", "origin", "license", "url", "rest": {...} }, ... },
"body": { "height": 1829, "segs": [{a,b,r:[3 radii mm]}...], "bands": [...] } | null,   // look-alike mannequin, measured from UAL1's mesh
"fit": { "<clip>": [meanMm, worstMm] },
"clips": { "<clip>": { "clip", "src", "orig"?, "take"?, "dur", "loop", "tags", "desc", "keys": [...] } } };
```

### 1.2 Key pose fields

Quoted from `MOCAP.md:259-262`:

```
{"t":0.13,
   "hips":[-2,-2,90], "body":[14,-25,1], "chest":[-2,43,6], "head":[-10,11,-1],
   "shL":[16,5], "shR":[-6,-1], "armL":[60,-44,66,132,155], "armR":[84,-27,47,133,-157],
   "legL":[-35,14,-93,44,6], "legR":[-66,19,-72,28,-32], "footL":[25,11,0], "footR":[20,44,-1]}
```

| Field | Meaning | Decode |
|---|---|---|
| `t` | seconds, to the ms, so a key lands on a 30 fps frame | `:280` |
| `hips` [f, r, u] | pelvis position, **% of standing hip height H0** (100 = standing, 55 = seated) | `:189` |
| `body`, `chest`, `head` [turn, lean, tilt] ° | yaw about up, pitch about right, roll. Each is relative to the part below | `euler`/`fromEuler` `:77-87` |
| `shL/R` [reach, shrug] ° | collarbone→shoulder azimuth and elevation from rest, in chest space | `:193-194` |
| `armL/R` [fwd, out, up, bend, twist] | direction shoulder→**fist** in chest space, in % (normalized on decode; `out` + = away from the body); elbow bend °; twist ° of the elbow round the limb from a smoothly carried reference | `:244-245`, `hintFor` `:112-120` |
| `legL/R` [fwd, out, up, bend, twist] | hip→**ankle** in pelvis space; knee bend; twist | `:251-252` |
| `footL/R` [down, out, toes] ° | foot pitch, yaw, toe bend. **No roll** | `:254-256` |
| `blade` [f, r, u] | sword clips only: the knuckle line index−pinky in chest space | `:281` |
| `root` [f, r] % H0 | travelling clips only: ground displacement | `moveAt` `:275` |

**Required fields** (`:263`): hips, body, chest, head, armL, armR, legL, legR. **Defaults:** shoulders [0,0], feet [0,0,0], bend and twist 0.

### 1.3 Skeleton, frame, units, rest body

**Points.** There are 36 (`:20-21`):
- `pelvis spine1 spine2 chest neck head headTop`;
- the facing helpers `faceF chestF pelvisF`;
- per side: `clav sh elbow wrist index knuck pinky fist hip knee ankle ball toe`.

They are in mm, in the rig frame (f forward, r right, z up), centred on the root on the ground.

**The frame is a mirror image of glTF space.**
- Frames are built algebraically with f × r = u (`:47`).
- The importer reaches them from right-handed glTF space through a reflection (`anim-import.mjs:187-191`).
- **A three.js port needs exactly one reflection**, e.g. f→+Z, r→−X, u→+Y. Test it with an asymmetric clip.

**The rest body** is `sources[id].rest`, from `measure()` (`:155-183`) on a T-pose or rest clip. It holds:
- H0, hipZ, ankleZ;
- the rest frames Pr, Cr and Hr;
- the hip and collarbone offsets;
- four spine segments, neckSeg, topH, faceH;
- the limb and foot lengths and the foot pitches;
- **the fitted spine shares** `spineW` and `neckW`: how each library's animators spread the hips→chest turn.

| Library | spineW |
|---|---|
| UAL1 | `[0,0,.25,1]` |
| UAL2 | `[0,0,.55,1]` |
| Mesh2Motion, hand-animated | `[0,.3,.65,1]` |
| CMU subject 13 | `[.7,1,1,1]` |

**Playback** rebuilds every clip on the *first* source's proportions, each with its own library's spine shares (`mocap.js:24-28`). The format is size-independent, so a clip plays on any build.

### 1.4 Timing, interpolation, loops

- **Sample rate.** All sets use `fps: 30`. CMU's 120 and 60 fps takes are downsampled by taking the **nearest frame**, without interpolating (`asf-amc.mjs:147`).
- **Interpolation.** `keyAt` (`:265-271`) is **linear on every stored number**.
  - Directions are normalized afterwards. Angles are not slerped, so 0→360 between two keys is a full spin.
  - Continuity is kept at encode time:
    - `unwrap` (`:104`);
    - choosing between the two Euler readings (turn+180, 180−lean, tilt+180) (`:200-203`);
    - a twist reference carried smoothly from a rest direction (`:106-120`).
- **Loops and one-shots.**
  - A loop wraps `t mod dur`, with no last→first interpolation. `reduce` keeps both ends (`:141`).
  - A one-shot clamps to the clip and holds its last pose.
- **Loop flags** come from:
  - names: `_Loop` and `(^|_)Idle$` (`anim-import.mjs:228`);
  - catalog tags `loop` and `once` (`:250-252`);
  - CMU's cycle search (§4).

### 1.5 Quantization and key reduction

- **Quantization.** Every number except `t` is an integer:
  - angles to 1°, directions to 1%;
  - hips and root to **1% of H0**, which is 9.2 mm on UAL and 10.3 mm on CMU.
- **Key selection** is `fit()` (`:293-302`):
  1. RDP over whole poses. The error is the largest distance over 34 points; finger helpers are left out (`:134-146`).
  2. It then greedily adds the frame that misses most *beyond that frame's own floor* (its error when encoded as its own key), until every frame is within `tol`.
- **Tolerances and density.** `tol` is 30 mm for sets and 50 mm for the library. Sets come out at about 9–10 keys a second, the library at 6.25.
- **Error is checked only at 30 fps frames** (see §1.8).
- **Measured fit** (mean and worst, mm):

| Set | Mean | Worst |
|---|---|---|
| QUATERNIUS | 13.9 | 222 |
| MESH2MOTION | 16.1 | 286 |
| CMU | 17.8 | 167 |

- **Clips averaging over 30 mm:** Bow, Run_Stealth, Sword_Attack_Air_Vertical, Power Up, Death_C, Cheering_Two_Hands, Side_Kick and Waiting_Loop.
- **Causes** (`MOCAP.md:133-135`): hard wrist bends, and a spine curled into a "C".

### 1.6 Root motion and props

- **Root motion.**
  - For glTF, `root` is the root bone's ground projection, kept if it moves more than 1 cm (`anim-import.mjs:224-228`).
  - For CMU one-shots it is the hips' projection. For CMU loops it is a straight line, so the loop plays in place and keeps its sway (`asf-amc.mjs:157`).
  - **No yaw and no vertical root.** Vertical motion stays in `hips`, and in-place jumps keep the root on the floor.
  - Travelling clips: 13 QUATERNIUS, 21 MESH2MOTION, 44 CMU.
- **Blade.** `blade` is written only when the clip's name matches `--blade Sword` (`anim-import.mjs:45,249`): 11, 12 and 1 clips.
- **Hand roll, everywhere else, is not data.** Decode lays the knuckle line along the chest's right axis (`readable.js:249-250`).

### 1.7 Provenance metadata

**Per clip:**
- `src` is the library id, a key into `sources`.
- `orig` names the clip this one was copied or edited from, as `"QUATERNIUS/Walk_Loop"`.
- `take` is the recording and its seconds, as `"02_01 0.91-2.01"`.

**Catalogs** (`src/mocap/catalogs/*.json`, written by hand from watching each clip):
- `$sources` (label, origin, license, url);
- `$skip` (each clip left out, with the reason);
- for CMU, `$pick`, e.g. `"Cartwheel": ["49_06", 1.0, 3.6]` or `"Wounded_Walk_Loop": ["139_19", 3, 8, 0.9]`, where the 4th number is the minimum cycle;
- an entry per clip, `"Name": ["tags", "what the body does", "SET/orig"?]`.

**Tests enforce** (`mocap-test.mjs:63-71`):
- every `src` has an origin and a license;
- every `orig` resolves;
- every `take` matches `^\d+_\d+ \d+\.\d\d-\d+\.\d\d$`.

### 1.8 Serialize, parse, mirror

- `text(o)` (`:304-309`) writes the header line (non-key fields as JSON), then **three lines per key**: torso and root; shoulders, arms and blade; legs and feet. The output is valid JSON and diff-friendly.
  - Clip text runs 1.98 characters a token (`mocap.game.js:285`): about **2,100 tokens per typical clip**. Catalogs cost about 30 tokens per clip.
- `parse` (`:311-321`):
  - strips whole-line `//` comments;
  - requires keys, a numeric `t` and every REQUIRED field as an array of finite numbers;
  - sorts the keys;
  - errors name the key, its time and the field (`key 3 (t 0.2) has no "body"`).
- `mirror` (`:323-335`) swaps L and R, negates turn and tilt, the hips' and root's right component, twist and the blade's right component, and appends `_Mirror`.
- `encodePose` (`:199-233`) encodes, with a fallback for a fist curled in past the shoulder (`:220-222`). `torso` and `decodePose` (`:188-259`) decode, with two-bone IK `ik3` (`:89-100`) and the pole from the twist (`poleHint` `:123`).

**Warts found while measuring:**
1. **Angles grow without bound.**
   - The largest seen: foot `out` 913° (CMU Backflip), twist 1,086°, Euler 582°.
   - Quaternius `Roll_RM`'s last key reads `"body":[193,-174,-180]`, the same orientation as `[13,-6,0]`.
   - CMU Walk_Loop goes `footR …[69,-250,25]`: the yaw is undefined when a foot points straight down.
2. **Playback pops that `fit` cannot see.** In HERO `Victory`, at 1.2–1.3 s, the arm is folded 156–163° and its twist runs 24 → −123 → 52 across three keys. The elbow jumps about 0.44 m in 1/120 s (`[44,386,1353]` at 1.2333 s, then `[131,-35,1449]` at 1.2417 s).
3. **The CMU license string omits the no-resale clause** (§3.2).
4. **Ledger categories fall back on the subject.** 144_30 "Sun Salutation" lands in *combat*, because subject 144 is "punching female".
5. **113 takes have an assumed frame rate** (120 fps, flagged `fps?`). Verify them.
6. **The GLB reader** (`anim-import.mjs:128-135`) **silently misreads CUBICSPLINE samplers**, and does not handle signed or quantized component types or sparse accessors. `to-glb.py` forces LINEAR sampling, which is why this has not mattered.

---

## 2. Runtime: `mocap.js`

### 2.1 API

```
Mocap.load(set) -> lib
lib.clip(name)
lib.sample(clip, t, out)     // Float32Array(108) of 36 points, with .src set
lib.moveAt(clip, t)
lib.blend(a, b, k)           // a LINEAR blend of points
lib.text(clip)
lib.replace(name, edited) / lib.restore(name) / lib.edited(name)
lib.origin(clip)
lib.pt(pose, name)
new Mocap.Mannequin(lib, {height}).draw(g, ox, oy, view, pose, facing)   // Canvas2D capsules
Mocap.drive(humanoid, lib)
```

### 2.2 `drive(rig, lib)` (`mocap.js:174-262`)

`drive` monkey-patches the instance's `_pose` and `update`, and overrides 16 joints (`DRIVEN`, `:142`).

- **Heading.**
  - `yaw = atan2` of the chest's forward on the floor, faded in by a trust ramp (`clamp((horizontal share − .3)/.3)`, `:186-192`).
  - The clip is read in the turned frame, and `rig.spin` takes the yaw: a spinning kick turns the face, hair and cape.
- **Hips.**
  - Scaled by `rig.hipZ / R.hipZ`.
  - The whole clip is lifted by its lowest point (`:199-200`).
  - The across-axis comes from the clip, at the rig's own half-width.
- **Legs.**
  - Foot target = rig hip + (clip **sole** − clip hip) × the leg-length ratio. The sole blends to the ankle as the foot rises 30 cm (`:205`), and z is clamped at 0 or above.
  - `E.ik3` solves the leg, with the clip's knee as the hint.
- **Torso and arms.**
  - Shoulders: clip direction × the rig's torso length.
  - Head: the shoulders→head direction × (neck + head radius).
  - Hands: shoulder + (fist − shoulder) × `armK`, then IK with the clip's elbow as the hint.
- **Tilt.** `mocapTilt` holds 3×3 chest and head frames relative to **that library's rest** Cr and Hr (`:227-229`). The Humanoid's `_offsets` uses them to draw the face, hair and belt upside down in a cartwheel.
- **Sword.**
  - With `mocapBlade`, the blade runs along index−pinky.
  - Otherwise it drops flat beside the hand as the body goes down.
  - It never goes through the floor (`:253-259`).
  - "Sword away" is the lab's X key: `hero.o.weapon = null`.
- **Blending.**
  - `mocapW` lerps joint *positions* between the rig's pose and the clip's (`:232-238`).
  - `mocapMask = 'upper'` drives only the `UPPER` joints (`:143`).
  - `downW` (the knocked-down measure) follows the torso, for the game to read.

### 2.3 Coupling and consumers

**Coupling.** `mocap.js` depends on `My3D2dge` (`V3`, `ik3`, `tones`, `px.poly/disc`, views) and on the Humanoid's internals (`_pose`, `J`, `o.*`, `spin`, `_offsets`). `readable.js` depends on nothing.

**Consumers:**
- **Emberdeep** (`96-hero-clips.js`). Its moments table `HCL_MOVES` is `{clip, speed, fade, out, mask:'upper', walk, hold, landed, at, next, instant}`. Game events trigger the moments, and the death panel waits on a hand-coded `landed` time.
- **The 3D world lab** (`src/lab3d/40-characters.js:238-262`). Its mocap figure plays HERO and CMU clips through `drive` on a 2D Humanoid, drawn as Puppet parts.

**Lesson:** the new engine needs a clip-action layer with masks, holds, chaining and *events stored in the clip*.

---

## 3. Inventory

### 3.1 Sets (`du -sh src/mocap` = 2.3 MB)

| Set | Clips (loop / root / blade) | Keys | Seconds | Keys/clip, median / max | File | gzip | Fit mean / worst (mm) | Sources (clips) | License |
|---|---|---|---|---|---|---|---|---|---|
| QUATERNIUS | 88 (32 / 13 / 11) | 1,295 | 135.0 | 14 / 61 | 387 KB | 74 KB | 13.9 / 222 | UAL1 46 (45 + T-pose), UAL2 42 | CC0 1.0 |
| MESH2MOTION | 177 (72 / 21 / 12) | 2,798 | 322.1 | 14 / 64 | 819 KB | 158 KB | 16.1 / 286 | M2M_QUATERNIUS 86 (84 with `orig`), M2M_ANIMATED 75, M2M_MOCOPI 16 | CC0 1.0 |
| CMU | 60 (16 / 44 / 1) | 2,376 | 235.9 | 37 / 136 | 722 KB | 161 KB | 17.8 / 167 | 25 subject libraries (`CMU_13`...) | CMU terms |
| HERO | 15 (subset: 8 QUATERNIUS + 7 MESH2MOTION) | 238 | 25.6 | 15 / 34 | 75 KB | 17 KB | 15.1 / 227 | UAL1, UAL2, M2M_ANIMATED | CC0 |

- **Other files:** catalogs 39 KB, ledger 262 KB, `readable.js` 29 KB, `mocap.js` 20 KB.
- **Contents.**
  - **QUATERNIUS:** locomotion, jump phases, roll, slide, swim; a sword combo with recoveries, shield, pistol aim poses, spells, punches, throws; hits, knockback, death, get-up; chest, table pick-up, push, farm, chop, carry, sit, drive; rail leans, dance, zombies.
  - **MESH2MOTION:** the Quaternius re-exports (UAL1's clips run 25% longer); climbs, ledge hang, bow, backflip, dodges with root-motion twins, crawl, fly, glide, levitate; four deaths, dizzy, tired; dances, emotes, cheers; its mocopi captures (fishing, golf, turns of 90° and 180°).
  - **CMU:** in-place gaits (including a limp and a robot walk); a skid stop, jump-over, dive roll, duck; karate kicks, punch and block combinations, a sword lunge; falls and three get-ups; chores; gestures; human-acted monsters; acrobatics.

### 3.2 Licenses

- **Quaternius and Mesh2Motion:** CC0.
- **CMU:** the site's wording, fetched 2026-10-09:
  - FAQ: "may be copied, modified, or redistributed without permission."
  - Home page: "You may include this data in commercially-sold products, **but you may not resell this data directly, even in converted form**". It also asks for an acknowledgment: *"The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217."*
- **Gap:** the repo's record says only "free for all uses (may be copied, modified, or redistributed without permission)" (`cmu.json`). **Record the full terms in my-3dge.**

### 3.3 The CMU ledger and the full library

**Ledger** (`src/mocap/catalogs/cmu-takes.tsv`):

| What | Value |
|---|---|
| Rows | 2,548 takes; 113 subjects; **38,698 s (10.75 h)** |
| Frame rates | 2,222 at 120 fps (113 of them assumed, flagged `fps?`); 326 at 60 fps |
| Columns (`cmu.mjs:123`, explained in the header `:131-139`) | `id subject fps sec category active fit travel hips flags used note desc about` |
| Categories (17) | locomotion 715, everyday 412, animal and character 211, undescribed 203, jump 181, gesture and talk 141, sports 137, combat 104, dance 92, acrobatics 59, sit and lie 55, climb 53, reaction 52, calibration 45, exercise 38, other 36, idle 14 |
| Flags | inverted 189, fps? 113, floats 63, loose 56, short 25 |
| Usage | 59 takes `used` (they feed the 60 clips); **30 marked `pick: Name (why)`** |
| Fit | mean 17.8 mm |

The `about` column (the subject's description, repeated on every row of a subject) is 24% of the file.

**`examples/cmu-lib/`** (68 MB on disk; 70.4 MB of text, 14.5 MB gzipped, 11.2 MB brotli):
- `index.js` (139 KB): `window.CMU_LIB = {tol: 50, subjects, takes: [[id, subject, category, sec, desc, parts]]}`;
- 113 `CMU_NN.js` subject sets, 14 KB to 2.6 MB each (median 427 KB);
- 4,770 clip entries: 1,901 whole takes, plus 647 takes over 20 s cut into 2,869 parts of 10 s;
- 241,740 keys at 50 mm (mean error 19.2 mm).

**Lazy loading** (`mocap.game.js:210-262`): with `?set=library`, a `<script>` tag loads the index; each subject's file loads when one of its takes is picked. The page itself stays at 2.47 MB, with the curated sets inlined.

---

## 4. The toolchain

| Tool | Does | In → Out | Network | Needs | Deterministic |
|---|---|---|---|---|---|
| `to-glb.py` | Blender to GLB: every action becomes one animation; force-sampled every frame; skins; `--deform-only`; `--list` | `.blend/.fbx/.bvh/.glb` → `.glb` | `pip install bpy` | **Python 3.11 + bpy 5.x (~1 GB)**, or Blender | Per bpy version (unpinned) |
| `anim-import.mjs` | Hand-written GLB parser; rig maps (`RIGS`: Rigify `DEF-*`, Unreal names, any case; `:75-93`); FK to 36 points at 30 fps; measures rest, spine shares and the mannequin mesh; fits each clip; catalog words, provenance, skips; `--cmu` | GLBs or CMU picks + catalog → set `.js` | CMU mode fetches takes | Node | **Yes** (verified, below) |
| `asf-amc.mjs` | Acclaim reader + FK (`M = Mp·C·R·C⁻¹`, `:68-78`); `readCmu`: picks → clips. Body-point mapping `:98-106`; facing and origin normalized `:148-153`; floor = **most common centimetre among the lower half of foot heights** `:166-173`; **loop cycle search** (0.5–2.5 s spans that keep moving, matched in pose and speed; seam spread over the cycle) `:115-134`, `:161-162` | `.asf`+`.amc` → clips | none | Node | Yes |
| `cmu.mjs` | `find`/`subject` (scrapes the site's index once); `get`; `all` (1.08 GB zip, 3.3 GB unpacked, own zip reader, + subject 144); `survey` (converts and measures every take → ledger, keeping notes, about 10 min); `library` (→ `examples/cmu-lib`); `ledger` (query) | site → `.cache/cmu` → ledger and library | **plain HTTP** to `mocap.cs.cmu.edu` (reachable from here) | Node | Yes |
| `anim-set.mjs` | Copies named clips key for key into a smaller set; `SET:Clip` for ambiguous names; keeps the source records; refuses a library not on record | set files → set | none | Node | Yes |
| `anim-sheet.mjs` | Contact sheets: inlines the set into the lab template (it hijacks the `quaternius.js` slot), drives `__mocap`, writes PNGs; 8 frames, or `--every s` with time stamps; `--uncataloged` | set → `check-output/anim-sheets/*.png` | none | Playwright + Chromium | mostly |
| `mocap-lib.mjs` | `MR` (`readable.js` run in a vm), `readSet`, `writeSet` | — | none | Node | Yes |

**`anim-import` details.**
- Point mapping: `toe` = the toe bone's tip, measured from its mesh. `faceF`, `chestF` and `pelvisF` are points 12 cm forward of their bones.
- The importer measures segment radii and the `joint`-material bands for the mannequin (`:194-207`).
- The rest clip is chosen from `--rest`, `A_TPose`, `T-Pose`, `Rest Pose` or `_rest` (`:240`).
- The first library to use a clip name keeps it.

**Reproducibility, verified.**
- Run: `node tools/anim-import.mjs --cmu --catalog src/mocap/catalogs/cmu.json --name CMU --title CMU --credit "…" --out <scratch>`, from a clean cache.
- It downloaded the site index, 25 skeletons and 59 takes (85 files, 69 MB) and printed the 16 loop cycles.
- **The output was byte-identical to the committed `cmu.js`** (sha256 `4f50eb86…`).

**What needs Blender, and what needs the network.**
- Only `to-glb.py` needs Blender. It is for `.blend`, `.fbx` and `.bvh` sources: Quaternius Library 2 Source, Library 1 Pro, 100STYLE.
- Network:
  - the Quaternius free GLBs are fetched by hand once;
  - Mesh2Motion's GLBs come from GitHub (`curl github.com` got a policy 403 in this sandbox; git may work);
  - CMU is plain HTTP.

---

## 5. Tests

**`mocap-test.mjs`** runs headless Chromium on the built lab. For every set the lab carries, it plays every clip at four moments, cycling the five views, on both figures. It fails on:

- **Page health:**
  - a page error, or an engine warning;
  - a pose value or hero joint that is not a number;
  - a mannequin foot more than 1 mm under the floor, or a hero foot below 0;
  - the hero's sword tip below the floor;
  - fewer figures drawn than the cast.
- **Format:**
  - **`parse(text(c))` that does not replay within 0.5 mm** (sampled every 0.1 s);
  - **`mirror(mirror(c))` that does not come back within 0.5 mm** (`:49-55`).
- **Import quality:**
  - a missing `fit`;
  - **a clip mean over 40 mm or a worst over 300 mm**;
  - a set mean over 20 mm.
- **Provenance:**
  - a library with no origin or license;
  - an `orig` that does not resolve;
  - a malformed `take`.
- **Picked sets:** a clip that is not key-for-key equal to its source clip (`:77-85`).
- **Hero behaviour** (CMU):
  - in Jump_Kick he turns at least 270°;
  - in Cartwheel his body frame goes upside down;
  - his face strays at most 2° from the clip's head;
  - in side view, travelling figures stand apart;
  - the sword can be put away and taken back.
- **CMU library:** five takes from different subjects load and play (one at 60 fps, one long-take part, one undescribed).
- **AI panel:**
  - a broken edit is rejected with a clear message;
  - **an applied edit (right arm up) raises the fist, and Reset restores the clip**.
- **Ledger** (Node): at least 2,548 fully measured rows, every take in the library index, and every `$pick` take listing its clip in `used`.

**`ed-clips-test.mjs`** checks Emberdeep's 15 hero moments (stash, waystone, talk, loot, a heavy blow, the landing, level-up, victory, three deaths with the death panel waiting for the fall, the revive, the gallery). It does not come over.

---

## 6. `docs/ANIMATION-RESEARCH.md`

**What it is.**
- A survey of famous NES-to-PS1/N64 animations in five sweeps: side, brawler, three-quarter/top-down, isometric/3D-era, and JRPG/shmup.
- Timings come from code where possible: the PoP source, the zelda3 and pokered disassemblies, the SM64 decompilation, DevilutionX.
- "Predrawn" means named, timed, tuned code animations a model asks for in one line.
- Its "Engine" column is the **2D engine's status: obsolete for my-3dge.**

**Conclusions (§4).**
1. About 15 animations are in every genre.
2. People remember transitions and reactions, not loops.
3. Timing is anticipation plus a **held contact frame**.
4. One death per cause.
5. State shows on the body.
6. Procedural rigs get reuse for free.
7. A ground shadow is a height cue.

**The gap it names** is an `E.ACTIONS` library of multi-beat sequences.

**The ranked list (§5).**
- 40 items in four tiers: staples #1–14, traversal #15–23, combat signatures #24–33, rigs, vehicles and presentation #34–40.
- Build order (§6):
  1. `E.ACTIONS`;
  2. jump phases;
  3. hurt and dizzy;
  4. the flip layer;
  5. death styles;
  6. emote bubbles and charge-up;
  7. specials, then grab and victim poses;
  8. ledge hang and wall slide;
  9. idle life;
  10. transitions and the path trail;
  11. the ship helper;
  12. new rigs.
- **Keep:** §7 (22 sourced timing references) and §8 (one API line per family, everything in the lab, filmstrips).

**What the library already covers.** The research never mentions the library. My mapping:

| Items | Library clips | Verdict |
|---|---|---|
| 1 Jump phases | Jump_Start/Loop/Land, NinjaJump_*, Jump_2(_RM), Run Jump, **Land_Three_Point**; 181 CMU jump takes | Covered (in place) |
| 2 Get up | LayToIdle, Get_Up_From_Back/Face_Down/Side, Zombie_Rise | Covered |
| 3 Hurt, knockback | Hit_Chest/Head, Hit_Knockback(_RM), Idle_Shield_Break, Dodge_back | Partial |
| 4 Launched, tumbling | Hit_Knockback, Death_B | Partial: physics should own it |
| 5 Dizzy; 14 Charge-up | Dizzy; Power Up, Spell_Simple_* | Covered |
| 6 Death styles | Death01, Death_A–D, Fall_On_Face | Body falls covered; fx deaths are not clips |
| 7 Flips and rolls | Roll(_RM), Backflip ×2, Dive_Roll, Cartwheel, Jump_Twist, Dodge_* | Covered |
| 8 Lift, carry, throw | PickUp_Table, Walk_Carry_Loop, Pick_Up_Box, Carry_Heavy_Box, OverhandThrow, Throw Object | Covered |
| 9 Push, pull | Push_Loop | Partial (no pull) |
| 10 Item get | none (Cheering_Two_Hands is close) | Missing |
| 11 Interactions | Chest_Open, Kick_Breach, Interact, Farm_Harvest, Search_Ground, Head Nod, Greeting | Covered |
| 12 Idle life | Idle/Subtle, Waiting, Looking_Around, Stretch_Yawn, Shivering, Idle Hurt, Tired Hunched, Kneeling Tired, Wounded/Hurt_Stomach walks, Sleeping, Meditate | Covered |
| 15 Ledge, climb | Ledge Hang, ClimbUp_1m_RM, Climb Wall/Ladder, Pipe Climb | Partial (no shimmy) |
| 16 Wall slide; 26 Whip; 25 Grab with a victim | — (CMU subjects 18–23 are two-person takes, not explored) | Missing |
| 17 Swim | Swim_Idle/Fwd; picks Breaststroke, Backstroke | Covered |
| 18 Skid, teeter | Run_Quick_Stop, Turn_*_90/180 | Partial |
| 19 Slide, crawl; 20 Hover, glide | Slide_*, Crawl(_RM); Glide, Flying Forward(_Super), Levitate | Covered |
| 21 Ground pound, dive | Attack_Ground_Pound, Dive_Roll, Run Jump | Partial |
| 24 Specials | Two-hand Blast (≈ hadouken), Jump_Kick (tornado), Punch_Combo; pick Spin_Jump_Kick | Partial |
| 27 Bow, shield; 28 Blocks | Bow ×4, Shield ×4; Sword_Block, Defend, Block_Combo | Covered |
| 29 Tools, daily life | Farm ×3, chop ×2, Fishing ×4, Dig, Rake, Sweep, Wash_Window, Consume, Drink; 4 more picks | Covered |
| 30 Casts; 31 Ceremonies | Spell_*, Two-hand Blast, Levitate; Salute, Greeting, Curtsey, Victory ×2, cheers, Idle_FoldArms, dances ×4 (+3 picks), laugh takes | Covered |
| 33 Enemy personality | zombie set, Zombie Yell, Kick_Breach, Duck_Thrown_Object, Confused; 211 human-acted "animal and character" takes | Partial |
| 34–36 Creatures, four-legged rigs, mounts | Driving_Loop only | Missing (needs non-human rigs) |
| 13, 22–23, 32, 37–40 | engine, fx or presentation | n/a |

**Net:**
- For **humanoids**, the library already serves most of Tiers 1–3.
- Missing: item-get, wall slide, whip, grabs with a victim, quadrupeds and vehicles.
- The "missing layer" the research names (multi-beat actions with held contact frames) is what the new engine must build *on top of* clips.

---

## 7. Assessment for a true 3D engine

### 7.1 Degrees of freedom: v1 against report C's 22-bone humanoid

| Bone | v1 stores | Missing |
|---|---|---|
| Root | [f, r], only when the clip travels | yaw, vertical |
| Pelvis, chest, head | 3 DOF each; the pelvis also has a position (at 1% H0) | — |
| Spine bones, neck | derived from fixed per-library shares | per-bone curl |
| Clavicle | 2 (reach, shrug) | roll (minor) |
| Upper arm, thigh | direction + twist = 3 | — |
| Forearm, shin | bend | **forearm pronation** |
| Hand | none: the hand continues the forearm; roll is a heuristic except in 24 sword clips | **flex, deviation, roll** |
| Foot, toes | pitch and yaw; toe bend | **foot roll** |
| Fingers | none | grip |

### 7.2 Re-expressing v1 as local rotations: measured

**The prototype skeleton** has 23 joints:
- pelvis;
- **`spine0`, a lower-back bone pivoting at the pelvis.** It is required: CMU's `spineW[0]` is 0.55–0.7, and without it every point above the pelvis was 35 mm off;
- spine1, spine2, chest, neck, head;
- per side: clavicle, upper arm, forearm, hand, thigh, shin, foot, toe.

Bone frames came from the decoded points; local rotations are relative to a decoded T-pose; FK checked them against `MR.pose`.

| | QUATERNIUS | MESH2MOTION | CMU | HERO |
|---|---|---|---|---|
| **Dense bake** (30 fps float quaternions) vs v1 at 60 Hz midpoints: mean | **0.46 mm** | **0.32** | **0.27** | **0.26** |
| Key for key (slerp between v1 keys): mean / worst | 0.33 / 104 | 0.69 / **727** | 0.64 / 363 | 0.51 / 207 |
| Integer-degree rotation vectors at the keys: mean / worst | 4.6 / 30 | 4.6 / 33 | 4.7 / 32 | 4.6 / 27 |
| Resample at 30 fps + refit at 30 mm: keys (v1 keys) | 1,255 (1,295) | 2,740 (2,798) | 2,341 (2,376) | 244 (238) |
| Refit error: mean / worst | 4.3 / 30 | 4.3 / 33 | 4.5 / 32 | 4.3 / 29 |

What the table shows:
- **A dense bake is exact in the mean.** But 0.3–1.2% of midpoints exceed 50 mm (in 21 of 88, 27 of 177 and 9 of 60 clips).
  - Most of these are **singular poses** in my point-derived frames: a straight limb has no bend plane, and a foot pointing down has no yaw.
  - Some are **real v1 pops** (§1.8).
  - The production baker must derive bone swing and twist from v1's *parameters* (direction, bend, twist, through `hintFor` and `poleHint`), not from decoded points. Slerped tracks then also remove v1's pops.
- **Key for key is unsafe.** v1 in-betweens interpolate each number linearly, not by slerp.
- **Integer-degree storage costs about 4.5 mm.**

### 7.3 Source fidelity

**It is not recoverable from the repo.** The repo holds only key-reduced, integer, position-derived poses. The GLBs and AMC files were never committed (`.cache/` is ignored).

**Re-import is well-specified and proven.**
- **Exact file names:**
  - `AnimationLibrary_Godot_Standard.glb` (UAL1, Rigify);
  - `UAL2_Standard.glb`;
  - Mesh2Motion's `human-base-animations.glb`, `human-addon-animations.glb` and `human-mocap-animations.glb`.
- **Clip names** are the glTF names. **Skips** are on record.
- **CMU's `take`** holds seconds to 0.01 s, the loop cycle included.
- **The CMU set already regenerates byte for byte** (§4). So a ported importer can re-cut the same 60 moments with richer degrees of freedom and be diffed against v1.

### 7.4 Recommended canonical format

**Keep "readable key poses" as the stored, agent-facing format, and bake to rotation tracks at load or build time.**

**Why:**
- **LLMs handle it.** It is whole numbers with named fields and a 450-token legend; an edit like `armR:[0,0,100,0,0]` works; round-trip and mirror tests already exist.
- **Size-independent and IK-shaped.** A limb is a direction + bend + twist, so it plays on any build, and it is the natural primitive for chain retargeting to **non-human bodies**.
- **Expressive in time.** Per-number interpolation lets an agent write a 720° spin with two keys; slerp cannot.
- **Zero migration loss.**

**Format 2 is a superset; every format-1 file stays valid.** Optional per-key fields:
- `handL/handR [flex, side, roll]`;
- foot `roll` as the 4th number;
- root `yaw` as the 3rd number;
- `spine [turn, lean, tilt]`, written only when the fixed share misses;
- `gripL/R` 0–100.

Optional per-clip fields:
- `events` (land, hit, step...);
- `contacts` (foot and hand intervals, detected at import);
- `props` (`"sword:R"`, `"box:LR"`);
- the source `fps`;
- `via` (`v1` or `source`);
- `fit`, moved into the clip.

**Tooling around format 2:**
- **A validator** that warns when:
  - a limb direction collapses between opposite keys;
  - twist jumps more than 120° between keys while the bend is over 140° (the pop pattern);
  - a knee bends past its range;
  - an angle goes past ±540°;
  - the hips go below the floor.
- **A "normalized lens"** for reading: each key's angles folded to ±180.

**The runtime gets rotation tracks.**
- `bake()` produces Float32 quaternion tracks per bone at 30 fps, plus hips and root. A 10 s clip is about 106 KB; bake lazily.
- The tracks feed report C's Character clip layer: weight, mask, fade, speed, additive.
- **Sampling stays on the CPU** (principle 5), so root motion, events and hit volumes are identical on WebGL 2 and WebGPU.

**The alternative I measured: rotation-native text.**
- One row per key: `"hips":[‰]` plus integer rotation vectors per joint. Sizes for the clip rows only, against v1's 368 / 786 / 673 KB:

| Rows | QUATERNIUS | MESH2MOTION | CMU |
|---|---|---|---|
| Dense, named | 551 KB (1.5×) | 1,198 KB | 1,020 KB |
| **Sparse** (a joint listed only at its own RDP keys, 2°) | **317 KB (0.86×)** | 668 KB | 587 KB |
| Sparse, gzipped | 52 KB | 117 KB | 120 KB |

- It is clean for skinning but harder to read. In the Punch_Jab sample, `"elbowL":[0,0,-121]`, and v1's hand-roll heuristic shows up as a fake `"wristL":[-88,0,0]`. It also loses size independence and spins over 180° between keys.
- Use it only if the engine bans effector-space clips.

### 7.5 Blending, root motion, foot planting, retargeting

- **Blending.** Today, crossfades lerp *points* (`lib.blend`), which shortens bones.
  - Blend in rotation space instead, with bone-group masks (`upper` exists; add `arms` and lists).
  - Additive layers are a clip minus its reference pose (`MOCAP.md:362`).
- **Root motion.** Keep clips in place with `root` as data (`MOCAP.md:361`) and add yaw. Rapier gets the deltas only in an explicit `'apply'` mode (report C §6.6).
- **Foot planting on uneven terrain.**
  - Use `contacts`, a two-bone IK post pass (`ik3` ports verbatim) and a physics ground probe.
  - Lower the pelvis by the deepest foot drop, then align the foot to the ground normal (it needs the new foot roll).
  - Keep drive's sole-not-ankle rule and its lift so the lowest point never sinks.
- **Retargeting.**
  - **Humanoids:** decode onto the target's bone lengths. It is v1's own decode with that rest body, plus contact IK.
  - **Non-humans:** map chains by name using direction, bend and twist (`MOCAP.md:358` flags this as an open decision).

### 7.6 Chunking and indexing, in repo or on demand, sizes

**In the repo (~2.5 MB):**
- `anim/sets/<set>/<Clip_Slug>.json`: one `MR.text()` per file, 1–10 KB.
  - Slug the file name and keep the real name in `clip`, because names have spaces.
  - Each set gets `_set.json` (sources with rest and license, body, credit) and a generated `catalog.tsv` (`name | sec | loop | tags | desc | src | orig | take | fit`, about 30 tokens a line).
- The catalog JSONs stay as the importers' hand-edited input.
- The ledger is split into 17 `anim/cmu/<category>.tsv` files (the largest is about 55 KB once `about` moves to `subjects.tsv`), plus a README with counts, flags and commands.
- **Agents search with `node tools/anim.mjs find <words> [--cat] [--max 20]` or grep, never by reading files.**
- Catalog tiers: a core list of about 40 clips (seeded from the lab's `CORE`, `mocap.game.js:48-49`), then the per-set catalogs, then the ledger by tool.

**On demand (`.cache/`, never committed):**
- The CMU archive: 1.08 GB zip, 3.3 GB unpacked; or per take, about 1 MB.
- The converted library: v1 70 MB; a format-2 or rotation version about 60 MB.
- `anim.mjs cmu get|convert|sheet <take>` handles one take in seconds.
- The lab reads `.cache/` through the dev server. Browsers cannot fetch CMU directly: plain HTTP is mixed content, and there is no CORS.
- Optional: publish the converted library as a pinned, checksummed release asset (about 11–15 MB gzipped).
- Source GLBs and Blender files also stay in `.cache/` (principle 1).

---

## 8. Classification and migration

### 8.1 Files

| File | Verdict | Reason |
|---|---|---|
| `src/mocap/readable.js` | **PORT-WITH-CHANGES** (core verbatim) | dependency-free and tested; becomes an ES module; adds format-2 fields, `bake()`, the validator and the lens |
| `src/mocap/mocap.js` | **REWRITE** | keep the `load/clip/sample/moveAt/text/replace/restore/origin` API; `drive` is welded to the 2D Humanoid; `Mannequin` is Canvas2D. Rebuild the mannequin as three.js capsules from `body.segs/bands` (keep that data). Keep drive's ideas: the sole, the lift, the heading trust, the blade on the knuckles never below the floor, the upper mask |
| `catalogs/quaternius.json`, `mesh2motion.json` | **KEEP-AS-IS** | hand-written knowledge |
| `catalogs/cmu.json` | **KEEP** (fix the license text) | no resale; acknowledgment |
| `catalogs/cmu-takes.tsv` | **PORT-WITH-CHANGES** | keep rows and notes; split; add `subjects.tsv` |
| `sets/quaternius.js`, `mesh2motion.js`, `cmu.js` | **KEEP data** (re-containerized) | one file per clip, verified deep-equal; tag the 84 Mesh2Motion re-exports as `alt` (their `orig` points to QUATERNIUS) so agents prefer the originals |
| `sets/hero.js` | **DROP** | Emberdeep subset |
| `examples/cmu-lib/` (114 files) | **DROP** | regenerable, 68 MB |
| `tools/anim-import.mjs` | **PORT-WITH-CHANGES** | split into GLB, rig-map and import modules; guard CUBICSPLINE and signed types; add format-2 fields (hand roll from the finger bones, foot roll, spine, root yaw, contacts) |
| `tools/asf-amc.mjs` | **PORT-WITH-CHANGES** | interpolate source frames; rotation output; keep the cycle search and the floor |
| `tools/cmu.mjs` | **PORT-WITH-CHANGES** | output to `.cache`; split ledger; category fallback fix; `--json`; verify the `fps?` takes |
| `tools/anim-set.mjs`, `mocap-lib.mjs` | **PORT-WITH-CHANGES** | bundle per-clip files; per-clip read and write |
| `tools/anim-sheet.mjs` | **REWRITE** | deterministic Node renderer to PNG (no browser), plus an optional 3D-lab mode |
| `tools/to-glb.py` | **KEEP-AS-IS** | optional; pin `bpy`; consider a Node BVH reader |
| `tools/mocap-test.mjs` | **REWRITE** | the same checks, as Node unit tests (format, provenance, ledger, picks) plus a browser smoke test on WebGL 2 and WebGPU |
| `tools/ed-clips-test.mjs`, `src/emberdeep/96-hero-clips.js` | **DROP** | Emberdeep; `HCL_MOVES` is design input for a clip-action layer |
| `src/mocap.game.js`, `src/mocap.template.html` | **REWRITE** | a 3D Mocap Lab that keeps the UX: catalog tab, clip-as-text Apply, Reset, Mirror and Copy-for-model, deep links, frame stepping, `window.__mocap` |
| `docs/MOCAP.md` | **PORT-WITH-CHANGES** | keep the library recipe, provenance, source and license table, CMU workflow and "Looking ahead"; rewrite the format and retargeting sections |
| `docs/ANIMATION-RESEARCH.md` | **PORT-WITH-CHANGES** | keep the research and timing tables; drop the 2D "Engine" column; add the coverage map from §6 |

### 8.2 Migration steps, in order, each with its proof

1. **Provenance.** Write `anim/SOURCES.md` and the license texts:
   - Quaternius and Mesh2Motion (CC0), with URLs and file names;
   - CMU's exact terms and acknowledgment;
   - the source commit `e37e4ee` (v0.14.0).
2. **Catalogs and ledger, verbatim**, then the split ledger and `subjects.tsv`. *Proof:* joining the split files gives the original rows.
3. **Port `readable.js`** with no change in behaviour. *Proof:* every clip sampled at 30 fps is bit-identical (Float32) to the source repo's decode.
4. **Re-containerize the sets** into one file per clip plus `_set.json`. *Proof:* rejoining them deep-equals the source objects; `text()` output is unchanged; HERO is dropped.
5. **Baker and Character clip layer** (report C), from v1 parameters, handling singular poses; `root` gives root motion. *Proof:* FK parity against `MR.pose` at 30 fps and 60 Hz, with a mean of 1 mm or less and a recorded worst-case list.
6. **3D lab, Node contact sheets, ported tests**, on WebGL 2 and WebGPU.
7. **Port the tools.** *Proof (acceptance):* `anim-import --cmu` on `cmu.json` reproduces `cmu.js` byte for byte, as it does today.
8. **Format 2 and re-import from sources** into `.cache/`, using the same catalogs; this fills the hands, foot roll, root yaw, spine, contacts and events.
   - *Proof:* per clip, decoded-point parity with v1 within that clip's fit, plus side-by-side sheets.
   - Swap clips in one at a time, marked `via: "source"`.
9. **CMU.** Re-survey with the new importer (the ledger's `fit` then reflects format 2), keeping the notes. Import the 30 rows marked `pick` as games need them.

### 8.3 Improvements

- Events and contacts in the data, instead of `landed` times hand-written in game code.
- The validator and the normalized lens.
- Measure `fit` at 60 Hz too, so pops count.
- Mirror on demand, not stored.
- A style pass through playback parameters (speed, holds on contact frames, ease) rather than edited data (`MOCAP.md:363`).
- Additive clips.
- Prop sockets oriented by the hand roll.
- Deterministic hashes of baked tracks in the tests.
- Tokens per catalog line.
- Faster survey (worker threads).
- Next sources: Quaternius Library 1 Pro and Library 2 Source (CC0), and 100STYLE (CC BY 4.0), as `MOCAP.md:387-398` lists.
