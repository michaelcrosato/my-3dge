---
name: animation-authoring
description: Authoring animation in my-3dge — poses as effector targets in metres (B(forward, right, up)) solved by IK onto the humanoid's rotation skeleton, builds and bodies, moves (strikes as data), actions (multi-beat sequences), library clips (find, show, play), procedural rigs, reactions and secondary motion — and checking it by numbers (animCheck, animCheckBody, actionCheck, rigCheck, node x qa anim, node x sheet, the gallery, the Animation Lab). Use when you add or change a build, body, move, action, clip, pose, rig or reaction, touch engine/anim, or an anim QA metric fails.
---

# Animation authoring

ADR-0009 is the rule: poses are authored in effector space, solved by IK and applied to a rotation skeleton (a root
plus 23 joints, engine/anim/skeleton.ts); `anim.step` runs in the sim for every character and is hashed, `anim.pose`
runs in the view for what is drawn and is not; the camera never feeds animation. ADR-0010 is the clip library's.
Game code takes every name from engine/sim-api.ts (engine/anim/api.ts lists them by area).

## The frame and the units

- The model frame: +Y up, the character faces +Z, its left is +X. Effector tables write `B(f, r, u)`: metres forward,
  right and up (engine/anim/authoring.ts), rig-local before the build's `size`, the floor at y = 0; `turnRight(a)`
  turns toward the right hand. Angles in radians, times in seconds, the sim's fixed step; nothing random but the
  named streams.
- The humanoid (engine/anim/humanoid.ts) solves the spine, the arms and the legs from those targets; the animator
  (engine/anim/character.ts) stacks the layers (base, override, solve, clips, additive, post, physics, secondary)
  and is told its body states each step (`states.body`; an unknown word warns with the closest).

## What to write, and the template for it

Each is an `x new` kind (the `add-entry` skill): its test is the first check, and `node x describe <kind>` lists the
fields with their defaults.

| You want | Write | Checked by its test with |
|---|---|---|
| Proportions (a taller, heavier, smaller body) | `node x new build labs/<lab>/builds/<name>` (`defineBuild`) | `animCheck`: its rest pose on the floor |
| How a body looks on the skeleton | `node x new body labs/<lab>/bodies/<name>` (`defineBody`) | compiled for every build, at most 10 draw calls |
| A strike (arc, height, reach, phases, hit window) | `node x new move labs/<lab>/moves/<name>` (`defineMove`) | an `Attack` from wind to end, `measureMove`'s reach |
| A sequence (beats of states, effectors, clips, events, cancel windows) | `node x new action labs/<lab>/actions/<name>` (`defineAction`) | `actionCheck` through `animCheckBody` on a humanoid |
| A creature that is not a humanoid | `node x new rig labs/<lab>/rigs/<name>` (engine/anim/proc's blocks) | `rigCheck`, and a walk on its gait |

Engine content lives in data, not labs: the engine's actions are data/anim/actions/ (one JSON file each, loaded by
`loadActions`), its moves engine/anim/moves-data.ts, its builds engine/anim/builds.ts (`build:adult`, `build:heroic`,
`build:bulky`, `build:chibi`, `build:skeleton`), its poses and stances engine/anim/poses.ts, its sample states
engine/anim/states.ts. A game's stay in its lab (PLAN.md §5.7).

## Playing it on an actor

- `spawnActor(w, { at, character, anim: { build: 'build:adult' } })` animates an actor; its body states come from its
  movement (the locomotion, engine/anim/locomotion/) and from what the scene tells it.
- An action: `actOn(w, id, (a) => a.play('bow'))` (engine/sim/actorActions.ts); `a.next()`, `a.finish()`,
  `a.cancel(...)`; its events go out as `action` `{ id, type, phase, late }`.
- A clip: give the actor `clips: { sets: ['clipset:<set>'] }`, then `playClip(w, id, '<SET>/<Clip>')`
  (engine/sim/actorClips.ts); `locomoteClips` plays an idle, a walk or a run by its ground speed. The sets are
  data/anim/sets/<set>/, one file a clip, registered as `clipset:<set>` (`defineClipSet`; a page loads them, as
  labs/box/library.ts does).
- Reactions and secondary motion: `reactTo(w, id, act)` runs a flinch, a knockdown, a death or the get-up on the
  component `reactions`; `secondary` holds hair, tails and a cape; both given at spawn (engine/sim/reactions.ts).

## The clip library, from the command line

`node x anim find <words> [--cat tag]` searches every set's catalog and the CMU ledger;
`node x anim show <set>/<clip>` prints the clip as text and what the validator warns of;
`node x anim sheet <set>/<clip>` draws its contact sheet; `node x anim bake <set>/<clip>` bakes it and checks FK
parity. A clip is readable key poses
(engine/anim/clip/readable.ts: hips, the body's turns, each limb a direction and a bend), so it fits any build and
mirrors by swapping L and R. Importing and cutting sets are `x anim import`, `cut`, `cmu`: `node x help anim`.

## Checking it

- `node x qa anim [--only move:|action:|clip:|state:]` drives the engine's bodies through the state matrix (every
  state, pose, stance, move, reaction and action at both facings, from rest and back) and every library clip, and
  measures `pop`, `footSlide`, `loopClosure`, `jointLimit`, `twistJump`, `stretch`, `underFloor`, `reach`,
  `unstableHash` and `rateDrift` against tests/baselines/qa-anim*.json (an accepted exception carries its reason).
  It reads the engine's content; a lab's entry is checked by its own test.
- `node x sheet <subject> [--build id] [--cams body|move|turntable]` (`move:slash`, `pose:kneel`, `state:`,
  `humanoid`) draws the humanoid's states as a contact sheet beside their QA violations; `node x gallery body` and
  `node x gallery move` film the bodies and moves the gallery's page registers; the Animation Lab (labs/anim/,
  `npm run dev`) lines every build up under one clock, its timeline scrubbing a move (`lab.anim.time`).
- docs/PLAYGROUND.md §5.1's bounds hold on every feel course: a planted foot drifts at most 5 cm a contact, a hand
  stays within 3 cm of its contact, no point pops, the muzzle within 2° of the aim.
- Pictures only when a number points at one: the `visual-qa` skill, and the `visual-reviewer` subagent for the sheet.

## Traps

- Animation in the sim is hashed: a change to a move, a build or the humanoid moves goldens. Re-record a replay only
  for a change meant to, with the reason in the commit (the `determinism-debugging` skill when they part).
- Bones keep their lengths: a stretch means a rotation that is not a unit quaternion (`animCheck` names the joint).
- A foot target is the sole, not the ankle: the ankle stands `ankleHeight` above it (ADR-0009 amendment 1).
- An action's beat held `until: 'next'`, or a loop, needs `check.signals` for its check to end it.
