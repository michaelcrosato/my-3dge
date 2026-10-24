---
id: ESC-0002
title: "WP 13.27: the shooter camera cannot keep the player's chest in the picture in every frame of the house's soak, as docs/PLAYGROUND.md §4 asks. In 538 of the tour's 5,127 frames there is less than 0.6 m behind his chest along his view (his back to a wall just after turning away from it), and no camera that looks along his aim and stays out of the walls can frame him there. How should the shooter's indoor bound read?"
status: decided-in-absence
principle: Verifiable
raised: 2026-10-22T15:14:04Z
deadline: 2026-10-22T15:29:04Z
run: cse_01ECrwiVj327dCi8rWWbGsfD
options:
  - "Judge the shooter's bounds only on frames that leave room for its frame (0.6 m behind the chest along the view, out of the walls), and report the unframable frames' count beside them"
  - "In those frames go first-person-like (the camera at his eye, his body faded, his arms shown), and judge first person's arms bound there"
  - "Let the shooter's camera stand past the wall with the wall faded (it then crosses walls, so the 0.3 m bound breaks at each crossing instead)"
  - "Leave the shooter's indoor bounds watched, the gate's clause open for the shooter"
recommendation: 1
answer: null
call: "Kept docs/PLAYGROUND.md §4's bound as written for the shooter; option 1's exemption is not taken yet. With its arm's base drawn in toward his chest as the arm shortens (f81747c), the shooter frames his chest in all but 19 of the tour's 5,127 frames, even where less than 0.6 m lies behind him. WP 13.27 tunes on toward 0. Any frames left where the camera's ball cannot fit behind his chest are reported as unframable, counted in ADR-0025's amendment and judged apart, and the owner's answer, when it comes, decides the bound."
commit: f81747c
followUp: null
---

# ESC-0002: WP 13.27: the shooter camera cannot keep the player's chest in the picture in every frame of the house's soak, as docs/PLAYGROUND.md §4 asks. In 538 of the tour's 5,127 frames there is less than 0.6 m behind his chest along his view (his back to a wall just after turning away from it), and no camera that looks along his aim and stays out of the walls can frame him there. How should the shooter's indoor bound read?

It keeps every bound wherever a camera can meet it and measures the rest instead of hiding it, with no camera trick the player would see; the platformer meets its bounds everywhere

## Options

1. Judge the shooter's bounds only on frames that leave room for its frame (0.6 m behind the chest along the view, out of the walls), and report the unframable frames' count beside them (recommended)
2. In those frames go first-person-like (the camera at his eye, his body faded, his arms shown), and judge first person's arms bound there
3. Let the shooter's camera stand past the wall with the wall faded (it then crosses walls, so the 0.3 m bound breaks at each crossing instead)
4. Leave the shooter's indoor bounds watched, the gate's clause open for the shooter

## Log

- 2026-10-22T15:14:04Z: opened, waiting until 2026-10-22T15:29:04Z (run cse_01ECrwiVj327dCi8rWWbGsfD).
- 2026-10-22T15:29:15Z: decided in the owner's absence at f81747c: Kept docs/PLAYGROUND.md §4's bound as written for the shooter; option 1's exemption is not taken yet. With its arm's base drawn in toward his chest as the arm shortens (f81747c), the shooter frames his chest in all but 19 of the tour's 5,127 frames, even where less than 0.6 m lies behind him. WP 13.27 tunes on toward 0. Any frames left where the camera's ball cannot fit behind his chest are reported as unframable, counted in ADR-0025's amendment and judged apart, and the owner's answer, when it comes, decides the bound.
