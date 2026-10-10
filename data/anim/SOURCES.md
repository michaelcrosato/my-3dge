# Animation sources and licenses

Every animation in `data/anim/` is text data converted from the libraries below (doctrine: Assets, its second
preference). Their binary sources (GLB, ASF/AMC) are never committed: the importers read them from `.cache/anim/`.
Each catalog's `"$sources"` names its libraries by the ids in the first column, and every clip's `src` is one of them
(a CMU clip's `src` is its subject, `CMU_<NN>`). `tests/unit/data/anim/` checks this file against the catalogs, the
ledger and the license texts.

## Sources

| Source | Library | Set | License | License text | URL | Files |
|---|---|---|---|---|---|---|
| `UAL1` | Quaternius Universal Animation Library 1, Standard edition | QUATERNIUS | CC0 1.0 | [CC0-1.0.txt](LICENSES/CC0-1.0.txt) | https://quaternius.com/packs/universalanimationlibrary.html | `AnimationLibrary_Godot_Standard.glb` |
| `UAL2` | Quaternius Universal Animation Library 2, Standard edition | QUATERNIUS | CC0 1.0 | [CC0-1.0.txt](LICENSES/CC0-1.0.txt) | https://quaternius.com/packs/universalanimationlibrary2.html | `UAL2_Standard.glb` |
| `M2M_QUATERNIUS` | Mesh2Motion: Quaternius' clips as Mesh2Motion re-exported them | MESH2MOTION | CC0 1.0 | [CC0-1.0.txt](LICENSES/CC0-1.0.txt) | https://github.com/Mesh2Motion/mesh2motion-app | `static/animations/human-base-animations.glb` |
| `M2M_ANIMATED` | Mesh2Motion: clips its contributors animated | MESH2MOTION | CC0 1.0 | [CC0-1.0.txt](LICENSES/CC0-1.0.txt) | https://github.com/Mesh2Motion/mesh2motion-app | `static/animations/human-addon-animations.glb` |
| `M2M_MOCOPI` | Mesh2Motion: its own motion captures | MESH2MOTION | CC0 1.0 | [CC0-1.0.txt](LICENSES/CC0-1.0.txt) | https://github.com/Mesh2Motion/mesh2motion-assets | `static/animations/human-mocap-animations.glb` (in mesh2motion-app) |
| `CMU` | CMU Graphics Lab Motion Capture Database | CMU | CMU terms | [CMU.txt](LICENSES/CMU.txt) | http://mocap.cs.cmu.edu/ | `allasfamc.zip`, or per take `subjects/<NN>/<NN>.asf` and `subjects/<NN>/<NN>_<MM>.amc` |

## Quaternius Universal Animation Library 1 and 2

- **What:** every free clip of both libraries, as Quaternius exports them: Library 1's Standard edition (45 clips and a
  T-pose; the Godot export) and Library 2's Standard edition (42 clips). The QUATERNIUS set holds all 88.
- **License:** CC0 1.0 Universal (public domain dedication); the legal code is in `LICENSES/CC0-1.0.txt`. No credit is
  required. The sets credit "Universal Animation Library 1 and 2 by Quaternius (quaternius.com)" anyway.
- **Files:** `AnimationLibrary_Godot_Standard.glb` (rig: Rigify `DEF-` bones) and `UAL2_Standard.glb` (rig:
  Unreal-style names), downloaded from the two pages in the table.

## Mesh2Motion

- **What:** the human animations of Mesh2Motion (mesh2motion.org), from three origins:
  - `M2M_QUATERNIUS`: Quaternius' Library 1 and 2 clips as Mesh2Motion re-exported them on its human rig. Library 1's
    clips run 25% longer than in Quaternius' own files, and a few are trimmed or end back on their feet. A clip's
    `orig` names the Quaternius clip it was made from;
  - `M2M_ANIMATED`: animated in Blender by Mesh2Motion's contributors; the Blender sources are in
    `Mesh2Motion/mesh2motion-assets` (`rigs/human`);
  - `M2M_MOCOPI`: captured by Mesh2Motion with a Sony mocopi suit and retargeted onto its rig with its own Blender
    add-on; the raw BVH captures are in `Mesh2Motion/mesh2motion-assets` (`motion-capture`).
- **License:** CC0 1.0 Universal; the legal code is in `LICENSES/CC0-1.0.txt`. No credit is required.
- **Files:** `human-base-animations.glb`, `human-addon-animations.glb` and `human-mocap-animations.glb`, all in
  mesh2motion-app's `static/animations/`.

## CMU Graphics Lab Motion Capture Database

- **What:** 2,548 takes by more than 100 people (113 subject numbers, about 10.75 hours), each a skeleton per subject
  and a motion per take. The CMU set holds 60 moments cut from 59 takes of 25 subjects; the ledger in `cmu/` lists
  every take. Each subject is its own library in a set (`CMU_<NN>`, linked to
  `http://mocap.cs.cmu.edu/search.php?subjectnumber=<N>`).
- **License: CMU's terms**, verbatim in `LICENSES/CMU.txt`:
  - "The motion capture data may be copied, modified, or redistributed without permission."
  - "You may include this data in commercially-sold products, but you may not resell this data directly, even in
    converted form."
  - So the converted clips and the ledger may ship in this repository and in games, but they may never be sold as
    data, converted or not.
- **Credit**, the acknowledgment the database asks for, verbatim: "The data used in this project was obtained from
  mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217."
- **Files:** `http://mocap.cs.cmu.edu/allasfamc.zip` (every ASF and AMC file, 1.08 GB), or one take at a time:
  `subjects/<NN>/<NN>.asf` (the subject's skeleton) and `subjects/<NN>/<NN>_<MM>.amc` (take `<MM>`, 120 frames a
  second, a few at 60).

## Where each file came from

Paths are relative to `data/anim/`. "Changes" names, as JSON pointers, the only values that differ from the source;
the catalogs are otherwise deep-equal to it (Prettier formats them).

| File | From | Changes |
|---|---|---|
| `catalogs/quaternius.json` | `my-3d2dge:src/mocap/catalogs/quaternius.json` | none |
| `catalogs/mesh2motion.json` | `my-3d2dge:src/mocap/catalogs/mesh2motion.json` | none |
| `catalogs/cmu.json` | `my-3d2dge:src/mocap/catalogs/cmu.json` | `/$sources/CMU/license`: CMU's full terms and acknowledgment, where the source said only "free for all uses" |
| `cmu/*.tsv` | `my-3d2dge:src/mocap/catalogs/cmu-takes.tsv` | split by category, the subjects' descriptions moved to `cmu/subjects.tsv`, the category fallback fixed (`cmu/README.md`) |
| `LICENSES/CC0-1.0.txt` | https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt | none |
| `LICENSES/CMU.txt` | http://mocap.cs.cmu.edu/ and http://mocap.cs.cmu.edu/faqs.php | quoted, retrieved 2026-10-10 |
