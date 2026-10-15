# Animation sources and licenses

Every animation in `data/anim/` is text data converted from the libraries below (doctrine: Assets, its second
preference). Their binary sources (GLB, ASF/AMC, BVH) are never committed: the importers read them from `.cache/anim/`.
Each catalog's `"$sources"` names its libraries by the ids in the first column, and every clip's `src` is one of them
(a CMU clip's `src` is its subject, `CMU_<NN>`). `tests/unit/data/anim/` checks this file against the catalogs, the
ledger and the license texts.

## Sources

| Source | Library | Set | License | License text | URL | Files |
|---|---|---|---|---|---|---|
| `UAL1` | Quaternius Universal Animation Library 1, Standard edition, version 2 (June 2026) | QUATERNIUS | CC0 1.0 | [CC0-1.0.txt](LICENSES/CC0-1.0.txt) | https://quaternius.com/packs/universalanimationlibrary.html | `UAL1_Standard.glb`, `UAL1_Standard_RM.glb`; version 1's `AnimationLibrary_Godot_Standard.glb` for `Punch_Enter` |
| `UAL2` | Quaternius Universal Animation Library 2, Standard edition, version 2 (June 2026) | QUATERNIUS | CC0 1.0 | [CC0-1.0.txt](LICENSES/CC0-1.0.txt) | https://quaternius.com/packs/universalanimationlibrary2.html | `UAL2_Standard.glb`, `UAL2_Standard_RM.glb` |
| `M2M_QUATERNIUS` | Mesh2Motion: Quaternius' clips as Mesh2Motion re-exported them | MESH2MOTION | CC0 1.0 | [CC0-1.0.txt](LICENSES/CC0-1.0.txt) | https://github.com/Mesh2Motion/mesh2motion-app | `static/animations/human-base-animations.glb` |
| `M2M_ANIMATED` | Mesh2Motion: clips its contributors animated | MESH2MOTION | CC0 1.0 | [CC0-1.0.txt](LICENSES/CC0-1.0.txt) | https://github.com/Mesh2Motion/mesh2motion-app | `static/animations/human-addon-animations.glb` |
| `M2M_MOCOPI` | Mesh2Motion: its own motion captures | MESH2MOTION | CC0 1.0 | [CC0-1.0.txt](LICENSES/CC0-1.0.txt) | https://github.com/Mesh2Motion/mesh2motion-assets | `static/animations/human-mocap-animations.glb` (in mesh2motion-app) |
| `CMU` | CMU Graphics Lab Motion Capture Database | CMU | CMU terms | [CMU.txt](LICENSES/CMU.txt) | http://mocap.cs.cmu.edu/ | `allasfamc.zip`, or per take `subjects/<NN>/<NN>.asf` and `subjects/<NN>/<NN>_<MM>.amc` |
| `100STYLE` | 100STYLE Dataset (Mason, Starke and Komura, 2022) | 100STYLE | CC BY 4.0 | [CC-BY-4.0.txt](LICENSES/CC-BY-4.0.txt) | https://zenodo.org/records/8127870 | `100STYLE.zip`: `100STYLE/<Style>/<Style>_<Gait>.bvh`, `Dataset_List.csv`, `Frame_Cuts.csv` |

The Set column names the catalog a library's clips are described in (`catalogs/<set>.json`). 100STYLE's clips are in
seven sets, `STYLE100` and `STYLE100_BACK`, `_BACKRUN`, `_IDLE`, `_RUN`, `_SIDE` and `_SIDERUN`, described by seven
catalogs, `catalogs/100style.json` and `catalogs/100style_<gait>.json`: shardfall names the family `100style` (each
catalog's `"$library"`), and the sets `STYLE100…` because a set's name must not start with a digit.

## Quaternius Universal Animation Library 1 and 2

- **What:** every free clip of both libraries, as Quaternius exports them in version 2 of their Standard editions
  (June 2026), converted by shardfall's importer at `fa2dab6`: 102 clips, each clip in place and, for the clips that
  travel, its root-motion twin `<clip>_RM` (a loop takes its `speed` from the twin). The QUATERNIUS set holds them and
  `Punch_Enter`, which version 2 dropped, kept from my-3d2dge's conversion of version 1 (`"via": "v1"`; the other 102
  say `"via": "shardfall"`): 103 clips. Version 1's set (88 clips, my-3d2dge's) is gone; 87 of its clips are in
  version 2 (tests/unit/data/anim/shardfall.test.ts compares them).
- **License:** CC0 1.0 Universal (public domain dedication); the legal code is in `LICENSES/CC0-1.0.txt`. No credit is
  required. The sets credit "Universal Animation Library 1 and 2 by Quaternius (quaternius.com)" anyway.
- **Files:** `UAL1_Standard.glb` and `UAL1_Standard_RM.glb`, `UAL2_Standard.glb` and `UAL2_Standard_RM.glb` (rig:
  Unreal-style names), downloaded from the two pages in the table. `Punch_Enter` came from version 1's
  `AnimationLibrary_Godot_Standard.glb` (rig: Rigify `DEF-` bones). The set's `body`, the mannequin's segments and
  bands, was measured by my-3d2dge from version 1's mesh.

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
- **Files:** `http://mocap.cs.cmu.edu/allasfamc.zip` (1.08 GB: the ASF and AMC files of 2,514 takes; subject 144's
  34, added later, are fetched one by one), or one take at a time: `subjects/<NN>/<NN>.asf` (the subject's skeleton)
  and `subjects/<NN>/<NN>_<MM>.amc` (take `<MM>`, at 120 frames a second, or 60 for some subjects).

## 100STYLE

- **What:** the **100STYLE Dataset** by Ian Mason, Sebastian Starke and Taku Komura (2022): one performer walking,
  running, sidestepping and standing in 100 styles, over four million frames of motion capture, published with the
  paper *Real-Time Style Modelling of Human Locomotion via Feature-Wise Transformations and Local Motion Phases*
  (Proceedings of the ACM on Computer Graphics and Interactive Techniques 5(1), 2022), DOI
  [10.1145/3522618](https://doi.org/10.1145/3522618). Dataset: https://zenodo.org/records/8127870.
- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0),
  https://creativecommons.org/licenses/by/4.0/; the legal code is in `LICENSES/CC-BY-4.0.txt`. The clips may be
  shared and adapted, commercially too, with credit, a link to the license and a note of the changes. The owner
  approved it (ADR-0021).
- **Changes made:** converted from the dataset's BVH captures into readable key poses, one loop per style and gait,
  each cut at its best cycle inside the frames the dataset marks as the style (`Frame_Cuts.csv`), described from its
  `Dataset_List.csv`, by shardfall's importer at `fa2dab6` (`shardfall:crates/pav_tools/src/mocap/`); then repacked
  here one file per clip (tools/anim/shardfall.ts). 878 loops in seven sets: forward walks (`STYLE100`, 98), backward
  walks and runs (`STYLE100_BACK`, `STYLE100_BACKRUN`, 98 each), standing (`STYLE100_IDLE`, 98), runs
  (`STYLE100_RUN`, 98), and sidesteps and sideways runs each way (`STYLE100_SIDE`, `STYLE100_SIDERUN`, 194 each).
  The styles that cannot loop in place (the spins; the drags that lead with the dragged leg) are left out, each with
  its reason in its catalog's `"$skip"`.
- **Credit:** every `style100*` set carries shardfall's, verbatim: "100STYLE (CC BY 4.0 (credit: 100STYLE, Mason,
  Starke and Komura))".
- **Shown on screen.** Any page or game that ships a `style100*` clip shows the credit on screen: the title, the
  authors, the license with its link, a link to the dataset, and a note that the clips were changed. For example
  (the box's, WP 8.9): "Motion: 100STYLE, by Mason, Starke and Komura (2022), CC BY 4.0; converted to key poses, one
  loop per style and gait", linking https://creativecommons.org/licenses/by/4.0/ and
  https://zenodo.org/records/8127870. The box counts from WP 8.9, since Vercel publishes it (WP 0.12).
- **Files:** `100STYLE.zip` (1.47 GB) from the dataset's page: one BVH file per style and gait,
  `100STYLE/<Style>/<Style>_<Gait>.bvh` (gaits `FW`, `BW`, `FR`, `BR`, `SW`, `SR` and `ID` were cut; `TR1` to `TR3`
  were not), and the lists `Dataset_List.csv` and `Frame_Cuts.csv`. shardfall reads single takes out of the archive by
  HTTP range requests.

## Where each file came from

Paths are relative to `data/anim/`. "Changes" names, as JSON pointers, the only values that differ from the source;
the catalogs are otherwise deep-equal to it (Prettier formats them).

| File | From | Changes |
|---|---|---|
| `catalogs/quaternius.json` | `shardfall:anim/catalogs/quaternius.json` | none |
| `catalogs/100style*.json` | `shardfall:anim/catalogs/100style*.json` | none |
| `catalogs/mesh2motion.json` | `my-3d2dge:src/mocap/catalogs/mesh2motion.json` | none |
| `catalogs/cmu.json` | `my-3d2dge:src/mocap/catalogs/cmu.json` | `/$sources/CMU/license`: CMU's full terms and acknowledgment, where the source said only "free for all uses" |
| `cmu/*.tsv` | `my-3d2dge:src/mocap/catalogs/cmu-takes.tsv` | split by category, the subjects' descriptions moved to `cmu/subjects.tsv`, the category fallback fixed (`cmu/README.md`) |
| `LICENSES/CC0-1.0.txt` | https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt | none |
| `LICENSES/CMU.txt` | http://mocap.cs.cmu.edu/ and http://mocap.cs.cmu.edu/faqs.php | quoted, retrieved 2026-10-10 |
| `LICENSES/CC-BY-4.0.txt` | https://creativecommons.org/licenses/by/4.0/legalcode.txt | none |

## Where each set came from

Each set in `sets/` is a directory, one file per clip (tools/anim/repack.ts). `tests/unit/data/anim/sets/` proves each
rejoins to its source, apart from the changes named here.

| Set | From | Changes |
|---|---|---|
| `sets/mesh2motion/` | `my-3d2dge:src/mocap/sets/mesh2motion.js` | the tag `alt` on the 84 clips with an `orig` |
| `sets/cmu/` | `my-3d2dge:src/mocap/sets/cmu.js` | `/sources/*/license` in its 25 source records: CMU's terms, as `catalogs/cmu.json` states them, where the source said "free for all uses" (WP 8.5); and `/credit`: the terms in short and CMU's acknowledgment, verbatim (tools/anim/repack.ts `CMU_CREDIT`, after G9), where the source said "free for all uses" too |
| `sets/quaternius/` | `shardfall:anim/quaternius.json` | each clip `"via": "shardfall"`; `body` from `my-3d2dge:src/mocap/sets/quaternius.js`; its `Punch_Enter` and that clip's `fit`, `"via": "v1"` |
| `sets/style100/` | `shardfall:anim/style100.json` | each clip `"via": "shardfall"`; `"body": null` |
| `sets/style100_<gait>/` | `shardfall:anim/100style/style100_<gait>.json` (`back`, `backrun`, `idle`, `run`, `side`, `siderun`) | each clip `"via": "shardfall"`; `"body": null` |
