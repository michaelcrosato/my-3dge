---
name: add-entry
description: Adding an entry of a kind through node x new and its template in tools/templates/ — a module, a box scene, a prop, material, texture, geometry, look, emitter, telegraph, thing, weapon, interactable (what a player uses or strikes), level written as storeys, movement profile, camera mode, build, body, move, action, procedural rig, sfx, song, a playground feel course or a rendering feature — which kind, the command, what its test proves, wiring it in, seeing it, finishing; and adding the template when a kind is written by hand a third time. Use whenever you add a new entry of any kind, or catch yourself writing the third entry of a kind that has no template.
---

# Adding an entry: x new

PLAN.md §8.13 is the rule; tools/templates/README.md lists every kind, where its entries go and the command that
shows one; tools/cmd/new.ts's file comment is the manual. One skill for every kind, since `x new` itself carries what
differs between them (each kind's sample, test and next step); PLAN.md §8.10 planned one `add-<kind>` skill a kind
(ADR-0025's WP 12.1 amendment says why one serves them all).

## 1. Pick the kind

`node x new` lists the kinds, each with what its id looks like. Most make an entry of the registry kind of their name
(`node x describe <kind>` lists its fields and the entries there are); `module` and `rig` make plain code, and an
`interactable` its component's entries of the kinds `usable` and `strikable`. A kind that is not listed has no
template: write the entry by hand from a real one, and see 7.

## 2. Write it

`node x new <kind> <id>`, the id a repository path without `.ts`: `node x new prop labs/<lab>/props/<name>`, `<lab>`
the lab that shows it (`box`, `playground`; in a game `labs/game/<dir>/<name>`). It writes the module and its unit
test from the kind's sample, formatted, then runs the checks: types, lint, the test, docs (a file comment, every
export documented, every `@example` runs, every path and command cited exists). Exit 1 lists each problem
(`NEW_TYPES`, `NEW_LINT`, `NEW_TEST`, `NEW_DOCS`); exit 2 is a bad id or kind, naming the closest. It never
overwrites: a taken path is refused. A kind with `games` in its manifest (scene, course, feature) makes no entry in a
game and says what the game does instead.

## 3. Make it yours

- The file comment's first sentence is what docs/INDEX.md shows: replace "replace this text", and say what it is
  and where its numbers come from. The rest of the comment says what the sample starts as, its units and invariants.
- Change the data; keep the test's claims true of the new entry. The tests prove what any entry of the kind must do,
  through the public API (a prop's parts build clean, a weapon empties its magazine at its rate, a level passes
  every `x qa level` check), so most survive an edit untouched; a number a test pins (an example's comment, an
  expected count) changes with the entry. `npx vitest run <id>.test.ts` while you work.
- Ids are global: a second `prop:chest` throws `CORE_DUPLICATE_ID`. Some names must be an entry's alone, and its file
  comment says so: a camera's name (no engine camera's), an interactable's component, a level's room-marker
  characters (a character writes one glyph in a legend).

## 4. Wire it in

An entry exists where its module is imported, so `x new` prints the next step (the manifest's `next`) naming who
imports it:

- sim-side entries (props, things, weapons, interactables, levels, movement profiles, builds, moves, actions,
  telegraphs, rigs): the scene that uses them, so `x sim`, the tests and the page all have them;
- view-side entries (looks, cameras, bodies, materials, textures, geometry, emitters, sounds): the page. The box's
  labs/box/main.ts imports every module under labs/box/scenes/ and labs/box/looks/, the playground's
  labs/playground/main.ts its looks, bodies and scenes; anything else is imported by name;
- a box scene: labs/box/README.md's scenes and a replay (the `stress-box` skill); a feel course: the playground's
  courses test (its `next` says how).

## 5. See it

- `node x gallery <kind> <id>` for props, materials, bodies, moves, looks and emitters (a weapon's prop too): a labelled
  contact sheet, every frame checked to show its subject.
- `node x shot <page> [--scene s] [--cam code] [--set post.look=look:<name>]`: the look metrics, the ID pass, a text
  thumbnail; `node x eye <scene>` answers what a camera sees of the bodies in Node, with no GPU.
- `node x qa geo tex --only prop:<name>`, `node x qa tex`, `node x audio sfx:<name>`, `node x sim <scene> --feel`,
  `node x feel labs/playground --course <name>`: the numbers for their kinds.
- Images only when a number points at one, through the `visual-reviewer` subagent (the `visual-qa` skill).

## 6. Finish

`node x docs --write` (INDEX and API take the new module), `npm run check`, then the entry's test and what selects it
(`npx vitest related --run <files>`). The rest is AGENTS.md's "Done means" and the `x-loop` skill.

## 7. A kind with no template

When you write the third entry of a kind by hand, add its template in the same work package (PLAN.md §8.13):
tools/templates/README.md, "Adding a kind", has the steps. Model it on a real entry; its test proves what every entry
must do; `node x new <kind> --test` proves the template; then give it a row in tools/templates/README.md and name it in
this skill's description (tools/cmd/new.test.ts and tests/unit/hooks/settings.test.ts fail a kind either leaves
out). A kind the gallery films writes its `gallery` hook. Record the template in the work package's notes.
