# Templates

`node x new <kind> <id>` writes a working entry of a kind from its template here: the module and its unit test,
formatted, then its checks (types, lint, its test, docs) and the step that comes next. It never overwrites a file.
`node x new` lists the kinds with what each id looks like; `node x new <kind> --test` writes a kind's sample, checks
it and removes it, and `node x new --test-all` tests every kind (the full run, `node x ci --local --full`, runs it),
so no template rots. tools/cmd/new.ts's file comment is the manual (the manifest's keys, the placeholders, the
checks); the `add-entry` skill (.claude/skills/add-entry/SKILL.md) is the loop round it.

## The kinds

Each row is a directory here; tools/cmd/new.test.ts fails a kind this table leaves out, or a path its kind refuses.
"Seen with" names a command that shows or checks an entry beyond its own test; `x new` prints the rest of what to do
after writing one (its manifest's `next`). A kind marked "no" in "In a game" makes no entry there and says what a
game does instead (its manifest's `games`).

| Kind           | An entry is                                                    | Its path                               | Seen with                                         | In a game |
| -------------- | -------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------- | --------- |
| `action`       | a multi-beat sequence a body plays (`defineAction`)            | `labs/<lab>/actions/<name>`            | its test (`actionCheck` through `animCheckBody`)  | yes       |
| `body`         | a puppet body on the humanoid's bones (`defineBody`)           | `labs/<lab>/bodies/<name>`             | `node x gallery body body:<name>`                 | yes       |
| `build`        | the humanoid's proportions (`defineBuild`)                     | `labs/<lab>/builds/<name>`             | its test (`animCheck` of its rest pose)           | yes       |
| `camera`       | a camera mode of a game's own, `cam3=<name>` (`defineCamera`)  | `labs/<lab>/cameras/<name>`            | `node x shot <page> --cam cam3=<name>`            | yes       |
| `course`       | a playground feel course (`defineCourse`)                      | `labs/playground/courses/<name>`       | `node x feel labs/playground --course <name>`     | no        |
| `emitter`      | a particle effect as data (`defineEmitter`)                    | `labs/<lab>/emitters/<name>`           | `node x gallery emitter emitter:<name>`           | yes       |
| `feature`      | a rendering technique behind its feature and advice            | `engine/gfx/enhanced/<name>`           | `node x perf <lab> --feature feature:<name>`      | no        |
| `geometry`     | a shape built from the kit's builders (`defineGeometry`)       | `labs/<lab>/geometry/<name>`           | `node x qa geo --only geometry:<name>`            | yes       |
| `interactable` | what a player uses and strikes (`defineUsable`, `defineStrikable`) | `labs/<lab>/interactables/<name>`  | its test (a player's use and punch in a yard)     | yes       |
| `level`        | a level written as storeys (`defineLevel`)                     | `labs/<lab>/levels/<name>`             | `node x eye <scene>` (a scene that plays it)      | yes       |
| `look`         | a material style and a filter chain (`defineLook`)             | `labs/<lab>/looks/<name>`              | `node x gallery look look:<name>`                 | yes       |
| `material`     | three.js's classic parameters as data (`defineMaterial`)       | `labs/<lab>/materials/<name>`          | `node x gallery material material:<name>`         | yes       |
| `module`       | a TypeScript module and its unit test                          | `<engine\|tools\|labs\|tests>/<dir>/<name>` | `npm test -- <path>`                         | yes       |
| `move`         | a named strike in metres and seconds (`defineMove`)            | `labs/<lab>/moves/<name>`              | `node x gallery move move:<name>`                 | yes       |
| `movement`     | how a character moves (`defineMovement`)                       | `labs/<lab>/movement/<name>`           | `node x sim <scene> --feel`                       | yes       |
| `prop`         | a thing that stands in a level (`defineProp`)                  | `labs/<lab>/props/<name>`              | `node x gallery prop prop:<name>`, `node x qa geo tex --only prop:<name>` | yes |
| `rig`          | a procedural creature of engine/anim/proc's blocks              | `labs/<lab>/rigs/<name>`               | its test (`rigCheck`, and a walk)                 | yes       |
| `scene`        | a box scene and its replay test (`defineScene`)                | `labs/box/scenes/<name>`               | `node x sim`, `node x replay`, `node x shot labs/box --scene <name>` | no |
| `sfx`          | a sound effect for the DSP core (`defineSfx`)                  | `labs/<lab>/sounds/<name>`             | `node x audio sfx:<name>`                         | yes       |
| `song`         | a tune in tracker notation (`defineSong`)                      | `labs/<lab>/sounds/<name>`             | `node x audio song:<name>`                        | yes       |
| `telegraph`    | an attack's warning shape on the floor (`defineTelegraph`)     | `labs/<lab>/telegraphs/<name>`         | its test (a hit inside, a near miss past it)      | yes       |
| `texture`      | a seeded, periodic texture generator (`defineTexture`)         | `labs/<lab>/textures/<name>`           | `node x qa tex --only texture:<name>`             | yes       |
| `thing`        | what can be hit, as data (`defineThing`)                       | `labs/<lab>/things/<name>`             | its test (struck down, standing again)            | yes       |
| `weapon`       | a firearm and the prop it is drawn as (`defineWeapon`)         | `labs/<lab>/weapons/<name>`            | `node x gallery prop prop:<name>`                 | yes       |

`<lab>` is the lab that shows it (`box`, `playground`…; `game` in a game). The gallery (`node x gallery`, PLAN.md WP
7.7) films what its page registers: its page (tests/pages/gallery.ts) imports every lab's `scenes/`, `looks/` and
`bodies/`, so an emitter, a prop or a weapon is filmed once a scene imports its module (`--page` films a lab's own
page instead).

## Adding a kind

A kind gets its template when an agent writes the third entry of it by hand (PLAN.md §8.13); the work package that
writes that entry adds the template, and its row here.

1. `tools/templates/<kind>/`: `template.json` and the template files. Its keys: `describe` (one sentence, which
   `node x new` lists), `id` (what an id looks like, with an example), `pattern` (a regular expression every id
   matches; let it take `tools/templates/<kind>/<name>`, where the sample is written), `sample`
   (`tools/templates/<kind>/sample<Kind>`), `files` (template file → target: `{{id}}.ts`, `{{id}}.test.ts`), `checks`
   (`types`, `lint`, `test`, `docs`), and when they help, `next` (what to do after writing one, which `x new` prints)
   and `games` (for a kind a game makes none of, what it does instead).
2. Write it from a real entry of the kind: the file comment's first sentence says "replace this text", and the rest
   says what the sample starts as, its units and its invariants; the test proves what an entry must do, through the
   public API (engine/sim-api.ts, engine/index.ts) where it can, so it holds for the next entry too.
3. Placeholders: `{{id}}`, `{{name}}` (its last segment), `{{NAME}}` (upper case, words split by `_`) and `{{dir}}`.
   A template's lines stay within 120 columns for any name (tools/cmd/new.test.ts renders a one-letter one and a long
   one): `x new` rewraps a doc comment's prose, but Prettier never breaks a string, a line comment or an `@example`
   line, so keep any of those that holds `{{name}}` short.
4. A kind the gallery films (props, materials, bodies, moves, looks, emitters) writes its `gallery` hook in the entry
   (engine/core/gallery.ts), as the prop template does; tools/cmd/new.test.ts fails a template that defines one without
   it. An id or a character an entry must own alone (a camera's name, a glyph's character) is named in its file comment.
5. `node x new <kind> --test`; then add its row above, and name it in the `add-entry` skill's description, so an
   agent who asks for one finds the skill (tests/unit/hooks/settings.test.ts fails a kind it leaves out).
