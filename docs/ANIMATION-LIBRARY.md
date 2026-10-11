# The animation library

my-3dge's characters animate procedurally, and they can also play animation made for 3D games: clips kept as
**readable key poses**, plain JSON with whole numbers that people and models read and edit (doctrine: Assets, its
second preference). This page is how to find, read, play and add to them. PLAN.md §10 is the plan behind it; it was
ported from my-3d2dge's `my-3d2dge:docs/MOCAP.md` (WP 8.1), with the format and playback rewritten for a 3D engine.

**Agents search the library. They never read it whole.**

## What is in it

| Set | What it holds | License |
|---|---|---|
| QUATERNIUS | Every free clip of Quaternius' Universal Animation Library 1 and 2, version 2 (June 2026), from shardfall, each travelling clip with its root-motion twin `_RM`; and version 1's `Punch_Enter`, which version 2 dropped | CC0 1.0 |
| MESH2MOTION | Mesh2Motion's human animations: Quaternius' clips as it re-exported them, clips its contributors animated (climbs, ledge hang, bow, backflip, dodges, crawling, flying, dances, emotes, deaths) and its own mocopi captures | CC0 1.0 |
| CMU | Moments cut from the CMU Graphics Lab Motion Capture Database, picked for what a game needs: gaits, traversal, fighting, falls and get-ups, townsfolk at work, gestures, monsters acted by people, acrobatics | CMU's terms: never resold as data |
| STYLE100, STYLE100_BACK, _BACKRUN, _IDLE, _RUN, _SIDE, _SIDERUN | 100STYLE, from shardfall: about 100 styles of walking, running, sidestepping and standing, one loop per style and gait, each loop with the `speed` it was captured at | CC BY 4.0: credit on screen (below) |

Their sizes, fit and sources are PLAN.md §10.1's table.

**100STYLE's credit (CC BY 4.0).** Any page or game that ships a `style100*` clip shows the credit on screen: the
title, the authors, the license with its link, a link to the dataset, and a note that the clips were changed. SOURCES.md
gives the wording and the links; the box shows it from WP 8.9, since Vercel publishes it (WP 0.12). The CC0 sets need
no credit; CMU's terms and acknowledgment are in SOURCES.md.

Beside the sets:
- **[SOURCES.md](../data/anim/SOURCES.md)**: every library, its license text (`data/anim/LICENSES/`), URL and file
  names, CMU's terms and acknowledgment verbatim, and where each file of `data/anim/` came from. Read it before
  shipping a clip.
- **The catalogs** (`data/anim/catalogs/`): hand-written tags and one-line descriptions, the importers' input.
- **The CMU ledger** (`data/anim/cmu/`, its README explains it): every take of the CMU database, one a line, split by
  category, with its fit, flags and what the library did with it.
- **ACTIONS** (`data/anim/actions/`, WP 8.7): multi-beat sequences built on clips.

The layout is PLAN.md §10.3. What arrives when:
- this page, the provenance, the catalogs and the ledger: WP 8.1;
- the sets, one JSON file per clip in `data/anim/sets/<set>/`: WP 8.3; 100STYLE and Quaternius version 2, from
  shardfall (`tools/anim/shardfall.ts`, `npx tsx tools/anim/shardfall.ts --check`): WP 8.10;
- the codec, validator and lens: WP 8.2; baking, the clip layer and retargeting: WP 8.4;
- the tools (`x anim find|show|cut|import|cmu|bake|sheet`): WP 8.5; until then the recipes below run with my-3d2dge's
  own tools (`my-3d2dge:tools/anim-import.mjs`, `my-3d2dge:tools/cmu.mjs`).

my-3d2dge's HERO set (Emberdeep's picks) and its 68 MB browsable CMU library did not come over: a game picks its own
clips, and the CMU library can be regenerated into `.cache/anim/`.

## Finding a clip

- `x anim find <words> [--cat c] [--max 20]` searches the catalogs, then the ledger; `x anim show <set>/<clip>
  --lens` prints one clip.
- Until WP 8.5: `grep -i cartwheel data/anim/catalogs/*.json data/anim/cmu/*.tsv`.
- A catalog line costs about 30 tokens; one clip about 2,100. Open only the clips you use.
- `docs/ANIMATION-RESEARCH.md` maps the famous animations games need to the clips that serve them (its section 7).

## Pipeline

```
.blend / .fbx / .bvh ──tools/anim/to-glb.py──▶ .glb
libraries (.glb) ──x anim import──▶ data/anim/sets/<set>/<Clip>.json   (+ _set.json, catalog.tsv)
CMU takes (.asf + .amc) ──x anim cmu──▶ .cache/anim/ ──x anim import --cmu──▶ data/anim/sets/cmu/
                                                 │
<Clip>.json ──parse, validate──▶ key poses ──bake──▶ rotation tracks ──clip layer──▶ the character's pose
```

**Import.** For each library the importer:
- recognises the rig: Rigify `DEF-` bones (Library 1) or Unreal-style names (`pelvis`, `spine_01`, `upperarm_l`;
  Library 2, Mesh2Motion), in any case; CMU's own ASF skeletons are read directly;
- measures the rest body from the T-pose (or a named rest clip), finds forward and right, and fits how that library's
  animators share a turn of the hips-to-chest between the spine bones;
- samples every clip at 30 fps, runs forward kinematics to 36 body points, turns each frame into a readable pose, and
  keeps only the key poses needed to stay within the budget (`fit`, 30 mm by default);
- takes each clip's tags and description from the catalog.

A clip whose name an earlier library already took is skipped, and a clip with no catalog entry is reported.

## The format

The stored format, its fields and format 2's additions are PLAN.md §10.2; the codec is `engine/anim/clip/readable.ts`
(WP 8.2), with the validator (`engine/anim/clip/validate.ts`) and the normalized lens (`engine/anim/clip/lens.ts`).
One key pose reads as an animator would name it:

```
{"t":0.13,
   "hips":[-2,-2,90], "body":[14,-25,1], "chest":[-2,43,6], "head":[-10,11,-1],
   "shL":[16,5], "shR":[-6,-1], "armL":[60,-44,66,132,155], "armR":[84,-27,47,133,-157],
   "legL":[-35,14,-93,44,6], "legR":[-66,19,-72,28,-32], "footL":[25,11,0], "footR":[20,44,-1]}
```

Why it is shaped this way (measured in my-3d2dge, and why it stays):
- **Limbs are directions plus a bend, not joint angles.** An arm swinging through straight down has no angle that
  flips, and a bend in degrees is well conditioned: storing reach as a fraction moved a nearly straight knee 56 mm per
  rounding step. It is also what IK consumes.
- **It does not depend on body size,** so one clip fits every build and every library's skeleton.
- **"out" is mirror-friendly:** mirroring swaps L and R and flips the signs of turns and tilts.
- **Whole numbers are cheap.** `-0.35` costs several tokens and `-35` one or two. Named fields cost about a quarter
  more than bare rows, but they make edits safe ("which column was `legR`?").
- **The spine is fitted per library,** because a library's animators decide how the spine bends; each clip names its
  library (`src`) and plays back with that library's spine.
- **Keys are chosen by the format's own error** (`fit`), so the fitter stops where the remaining error is the format's
  limit, not the in-betweening.
- **Numbers continue from key to key, so in-betweens never jump:** twist is measured from a reference carried smoothly
  from the rest direction; turn, lean and tilt each have a second reading (turn + 180, 180 − lean, tilt + 180), and the
  encoder takes whichever continues from the key before; key times are stored to the millisecond.

How it was chosen: on the first library's 46 clips, readable key poses (615 poses, 31 KB gzipped, about 12 mm from the
capture on average) could not be told from every captured frame (2,078 poses, 118 KB) side by side, where halving the
frame rate cost more and could skip a punch's moment of contact. Its known misses are hard wrist bends (the hand
continues the forearm) and a spine curled into a C; format 2 has fields for hands and a spine override (WP 8.2),
which the re-import from the sources fills (WP 8.8).

## Playing clips

The runtime path is PLAN.md §10.4. In short:
- **Bake** (WP 8.4, `engine/anim/clip/bake.ts`): a clip becomes 30 fps rotation tracks on the canonical skeleton, and
  also a three.js `AnimationClip` that a page can play with an `AnimationMixer`, for presentation only.
- **The clip layer** (`engine/anim/clip/layer.ts`) plays it in the animator's clip slot: weight, bone mask, a fade from
  the current pose, speed, loop, additive, events, root motion. A loop with a `speed` plays at the character's ground
  speed, and a walk and a run switch with hysteresis.
- **Retargeting** (`engine/anim/clip/retarget.ts`): a rotation copy, the root scaled by the ratio of hip heights, and
  contact IK for feet and hands; the sole, not the ankle, meets the floor.
- **Sampling stays on the CPU**, so root motion, events and hit volumes are the same in Node and in every page.
- **The mannequin** (`engine/gfx/puppets/bodies/mannequin.ts`) is a look-alike of the libraries' own figure, built
  from the `body` measured from the first library's mesh (`data/anim/sets/quaternius/_set.json`, version 1's, which
  WP 8.10 kept; every other set's `body` is `null`).

**What the clips assume:**
- **In-place jumps.** `Jump_Start`, `Jump_Loop` and the `NinjaJump_*` clips keep the root on the floor while the feet
  point down: the game supplies the arc.
- **Props.** Sitting clips expect a chair, `PickUp_Table` a table, `Chest_Open` a chest, `Walk_Carry_Loop` a box,
  `Idle_Rail_*` a railing, `Farm_*` and `TreeChopping_Loop` their tools, `Driving_Loop` a seat and a wheel, the
  `Pistol_*` clips a gun and the `Shield_*` clips a shield. Format 2 names them (`props`).
- **Root motion.** The `_RM` clips (and the `Sword_Regular_*` combo, `Sword_Block`) move the root; the others play in
  place and expose their path as data, which a game may use or ignore.
- **Combos.** `Sword_Regular_A`, `B` and `C` are one combo's strikes, each with a recovery (`_Rec`) for when the chain
  stops; `Sword_Regular_Combo` is the whole chain.

## Adding a library, step by step

The whole process of translating a 3D animation library into the format. Everything runs in Node, except the
conversion from Blender, FBX or BVH files. The options named below are the source importer's
(`my-3d2dge:tools/anim-import.mjs`); WP 8.5 ports them to `x anim import`.

1. **Check the license.** The converted clips are committed to this repository and ship inside games, so the source
   must allow sharing derived data. CC0 is ideal. CC BY works, with the credit in the set and in SOURCES.md, shown
   wherever a clip ships. "No derivatives", "non-commercial" and Mixamo-style terms are out. A source under terms the
   repository does not hold yet is the owner's call: escalate (`node x esc open`).
2. **Keep the source files out of the repository.** They go in `.cache/anim/` (git-ignored); only the converted clips
   are committed (doctrine: Assets). A file too big for a session's channel goes in a private repository the session
   can clone, or behind a direct link.
3. **Convert to GLB, if it isn't one.** The importer reads glTF binary only. `tools/anim/to-glb.py` converts `.blend`,
   `.fbx` and `.bvh` files with Blender's Python module (`bpy`, pinned; no Blender install). Every action becomes one
   clip; `--deform-only` keeps a Rigify file's `DEF-` bones; a file without a skinned mesh still imports.
4. **Inspect it** with the importer's `--list`: the rig it recognises, the clips and the bones, writing nothing. A rig
   it does not recognise needs a bone map: the bone for the pelvis, spine, chest, neck and head, and per side the
   collarbone, upper arm, forearm, hand, index, middle and pinky knuckles, thigh, shin, foot and toes.
5. **Import into a set,** one set per source family, so each keeps its credit. Order matters: a clip whose name an
   earlier file took is skipped, so a bigger edition of a library goes in place of the smaller one, not after it.
   Measure each library's body from its T-pose or `Rest Pose` clip (`--rest`): on Mesh2Motion's addon clips the right
   rest pose cut the average error from about 32 mm to 19.
6. **Read the fit.** Each clip records its average and worst error against its capture. The library QA (WP 8.6) fails
   a clip over 40 mm on average or 300 mm at worst, and a set over 20 mm on average. Look at the clips over 30 mm:
   the usual culprits are hard wrist bends and a spine curled into a C. A clip that reads wrong goes in the catalog's
   `"$skip"` with the reason, so it is left out on the record.
7. **Write the catalog** (`data/anim/catalogs/<set>.json`), from contact sheets of the clips it lacks (`x anim sheet`):
   - `"Name": ["tags", "what the body does"]`, and a third element `"SET/clip"` when the clip is a copy or an edit of
     another set's clip;
   - **tags** are lowercase words: idle, walk, run, crouch, crawl, strafe, turn, jump, dodge, climb, slide, fly,
     attack, stance, block, shield, sword, unarmed, magic, gun, bow, throw, kick, hurt, death, getup, interact, work,
     item, chest, carry, eat, farm, fish, sport, talk, emote, gesture, dance, cheer, exercise, sit, rest, lie, swim,
     zombie, reference, and any others that help a search (air, prop, root-motion);
   - `loop` and `once` in the tags say whether the clip loops, for libraries whose names don't (Quaternius ends its
     loops in `_Loop`; Mesh2Motion doesn't); the importer takes them out of the tags;
   - **describe the body, not the intent:** "bends forward and lifts a chest's lid with both hands" is something a
     model can match to a moment in a game.
8. **Record the provenance:** the catalog's `"$sources"` (label, origin, license, URL per library), a row and a
   section in SOURCES.md, and the license text in `data/anim/LICENSES/`. `tests/unit/data/anim/sources/` fails a
   library without them.
9. **Test and commit** the set, the catalog and the provenance, never the source files.

## Importing from CMU, step by step

The [CMU database](http://mocap.cs.cmu.edu/) holds walks in every style, runs, dances, sports, martial arts,
acrobatics, playground games, everyday chores and people acting animals. Takes are raw recordings of one action or
several, so each clip is a stretch cut from one. Its terms allow copying, changing and sharing the data, and using it
in commercial products, but never reselling it, even converted (SOURCES.md has them verbatim).

**The ledger** (`data/anim/cmu/`) is the survey of every take: converted, measured and listed with its category,
length, active stretch, fit, travel, hip range, flags and the clips cut from it. Its `note` column is yours:
`pick: Name (why)` for the next to import, `skip: why`. `x anim cmu` fetches takes into `.cache/anim/` by HTTP range
reads from the site's archive, re-runs the survey and writes the split ledger, keeping the notes (WP 8.5).

1. **Find takes:** `x anim find --cat <category> <words>`, or grep the ledger's category files. A take's description
   is a hint, not a promise.
2. **Pick a stretch:** import the whole take once and look at a contact sheet with a frame every half second, each
   marked with its time; narrow it around the moment. When frames are too small to judge (a jumping jack), measure the
   bones instead: hands above the head, feet apart, hip height.
3. **Write the catalog** (`data/anim/catalogs/cmu.json`):
   - `"$sources"`: one `"CMU"` record; the importer copies it for each subject (`CMU_<NN>`), naming the subject and
     linking its page;
   - `"$pick"`: each clip's take and the seconds to keep, `"Cartwheel": ["49_06", 1.0, 3.6]` (no end: to the end of
     the take). The take alone, `"Wave_Hello": ["141_16"]`, keeps the stretch where it moves. A loop's fourth number
     is the shortest cycle it may cut: `["139_19", 3, 8, 0.9]`, for a limp whose feet meet between steps;
   - an entry per clip, as for any library; the tag `loop` asks for a loop.
4. **Import** (`x anim import --cmu`). On the way the importer places the body points on CMU's bones, turns each clip
   to face forward and start at the origin, finds the floor (the height the lowest foot point keeps most often over the
   subject's takes), and cuts loops: for a clip tagged `loop` it searches the stretch for the cycle whose end best
   matches its start in pose and speed, among spans that keep moving, then spreads the seam's remainder over the cycle
   so the loop closes exactly.
5. **Check** the contact sheets, the clip in the box (clip mode, WP 8.9) and the tests.

What my-3d2dge's first CMU clips showed:
- **Accuracy:** the first nine were 10 to 24 mm from the capture on average (Quaternius' clips: 14); the takes that
  fit looser than 30 mm are fast acrobatics and hard-bent wrists (the ledger's `loose` flag).
- **A description is a hint:** "Looking Around" was crouched searching the ground (it became `Search_Ground`), a
  "Robot" walk stood still for nine seconds, a "JumpTwist" fell into breakdancing, a duck ended lying down. A contact
  sheet of every new clip caught each one.
- **What needed fixing:** the first loop search picked a pause (now refused); the first floor estimate caught a
  landing's dip (now the most common height); gaits whose feet meet between steps match themselves after one step
  (now the fourth number).

## Where each clip came from

Every set records the origin of every clip, so a clip's history survives being copied into another set or edited:
- **`sources`** in `_set.json`: one record per library the set was imported from, with its `file` and `rig`, plus the
  `label`, `origin`, `license` and `url` its catalog's `"$sources"` gives;
- **`src`** on each clip: the library it came from (the key into `sources`);
- **`orig`** on a clip that is a copy or an edit of another set's clip, as `SET/clip`: Mesh2Motion's `Walk` says
  `"orig": "QUATERNIUS/Walk_Loop"`;
- **`take`** on a clip cut from a motion capture database: the recording and the seconds used, `"13_29 2.30-3.42"`;
  each CMU subject is its own library (`CMU_13`);
- **`via`** (format 2): `v1`, `shardfall` or `source`, how the clip reached this repository;
- **`"$skip"`** in the catalog: the clips left out on purpose, each with the reason.

How Mesh2Motion's origins were established: each of its base clips was matched to a Quaternius clip by motion,
comparing every frame after scaling both to the same length. 77 match their same-named or renamed Quaternius clip
closely and 8 more are Quaternius' clips with small edits (trimmed, or ending back on their feet); the 84 it keeps
carry an `orig` (WP 8.3 tags them `alt`). `Death_D` and `Hit_Chest` differ from every free Quaternius clip, so they
carry the library but no `orig`. Mesh2Motion's copy of `Sword_Regular_A_Rec` whips the body round in its last frames,
so it is skipped. Its hand-animated clips have their Blender files, and its captures their raw BVH files, in
[mesh2motion-assets](https://github.com/Mesh2Motion/mesh2motion-assets).

## Where to get more animation

Contents, prices and terms as my-3d2dge recorded them in October 2026.

| Source | Humanoid clips | Cost | License | Files | Here |
|---|---|---|---|---|---|
| Quaternius Universal Animation Library 1 and 2, Standard | 45 + T-pose, and 42 | free | CC0 | GLB | Imported: version 2 from shardfall, with root-motion twins (QUATERNIUS) |
| [Library 1 Pro](https://quaternius.itch.io/universal-animation-library) | 120+ | $9.99 | CC0 | GLB, FBX | Drop-in: the Standard skeleton. Import it in place of the Standard file |
| [Library 2 Source](https://quaternius.itch.io/universal-animation-library-2) (Library 2 has no Pro tier) | 130+ | $14.99 | CC0 | .blend only | Convert to GLB, then import. Library 1's Source edition ($14.99) is the same route |
| [Mesh2Motion](https://github.com/Mesh2Motion/mesh2motion-app) humans | 178 | free | CC0 | GLB | Imported (MESH2MOTION; one defective re-export skipped) |
| [CMU motion capture](http://mocap.cs.cmu.edu/) | 2,548 takes, about ten hours | free | CMU's terms: use, change and share freely, credit mocap.cs.cmu.edu, never sell the data itself | ASF/AMC | Imported (CMU) and all of it surveyed in the ledger |
| [CMU, retargeted by RancidMilk](https://rancidmilk.itch.io/free-character-animations) | 2,000+ | free | CMU's terms | FBX, on a Quaternius character | Not tried: convert to GLB; it needs a bone map if the rig is not one the importer reads |
| [100STYLE](https://zenodo.org/records/8127870) | about 100 walking, running and standing styles | free | CC BY 4.0 (credit required) | BVH | Approved by the owner (ADR-0021). Imported: shardfall's 878 loops (STYLE100 and six more sets); the original takes on demand (WP 8.8) |
| Mixamo | thousands | free account | Adobe's terms forbid redistributing the animations in an editable form | FBX | No: a converted set in an open repository is exactly that |
| Bandai Namco Research motion dataset | 3,000 | free | CC BY-NC-ND 4.0 | BVH | No: retargeting is a derivative |

## Looking ahead

The questions that get harder to change once games and models depend on the library, as my-3d2dge left them, and
where each stands here:
1. **The format is an API.** Sets carry their format number; format 2 is a strict superset, with a validator that warns
   about collapsed limbs, twist pops, knees out of range and hips below the floor (WP 8.2).
2. **It is a humanoid format.** Non-human bodies map chains by name, using direction, bend and twist (PLAN.md §10.4);
   creatures and four-legged rigs come from procedural building blocks (WP 10.1).
3. **The renderer has to honour what the format says.** Clips are baked to rotations on the canonical skeleton, so
   chest twist and head turn reach the 3D puppet exactly (WP 8.4).
4. **Gameplay needs events.** Format 2 carries `events` and `contacts` (WP 8.2, detected at import in WP 8.8), and an
   attack that plays a clip lands at the clip's strike time when it has no `hit` event (WP 8.4).
5. **Root motion against physics.** Clips play in place by default and expose their root path as data. Keep it so.
6. **Layering.** The clip layer has weights, bone masks and additive clips (WP 8.4).
7. **Style.** Motion capture is realistic; procedural moves are snappy. Mixed in one game they can feel inconsistent,
   so imported clips may want a style pass: holds on key poses, a little exaggeration, eased in-betweens. Still open.
8. **The catalog's token budget.** About 30 tokens a clip: agents search (`x anim find`) and start from a core list of
   about 40 clips (PLAN.md §10.3); the ledger is for tools and people, not for a model's context.
9. **Provenance per clip.** Each clip names its library, each library its license, and SOURCES.md holds the terms,
   so a source with other terms (CMU's no-resale, 100STYLE's credit) is carried by its source, not by a set-wide
   credit. Still to do: an importer that refuses sources whose terms forbid redistribution.
10. **Loading.** Clips are one file each and bake lazily, cached (PLAN.md §10.4), so a page pays only for the clips
    it plays.

## Limits

- **Fingers are not imported**: hands are fists. Format 2 has a hand's flex, side and roll and a grip (WP 8.2), which
  the re-import fills (WP 8.8).
- **CMU's hands have one finger bone and a thumb**, so the knuckle line is set across the hand toward the thumb: a CMU
  fist turns with the wrist but never curls.
- **Rigs:** Rigify `DEF-` bones and Unreal-style names in GLB files, and CMU's ASF/AMC. 100STYLE's BVH rig is
  shardfall's map (WP 8.8). Any other skeleton needs its own map.

## Tests

- `tests/unit/data/anim/`: the provenance (`sources/`), the catalogs and the coverage map (`catalogs/`), the ledger
  (`ledger/`), the sets (`sets/`, WP 8.3), and what came from shardfall (`shardfall.test.ts`, WP 8.10: the `via`
  marks and bodies, the catalogs, Quaternius version 2 against version 1, every clip decoding, 100STYLE's credit).
- The library QA (WP 8.6): format, fit thresholds, the `anim` QA family over every clip, and a browser smoke test
  (`tests/e2e/library.spec.ts`).
