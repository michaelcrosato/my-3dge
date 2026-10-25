---
name: visual-qa
description: Checking what my-3dge draws without looking — the look metrics (coverage, luma spread, dark and blown-out shares, palette, flat share, dithering, edges, the largest object, the protagonist), the ID pass (which object covers which pixels, and why an unseen one is unseen), the 48 × 27 text thumbnails and their baselines, contact sheets (x film, x gallery, x sheet), film comparisons that name the objects whose pixels changed, the agent eye in Node, and when to hand an image to the visual-reviewer subagent. Use when you change rendering, a look, a camera, a material or a scene's view, when a look note or a thumbnail check fails, or when a question is whether something shows.
---

# Visual QA: numbers first

PLAN.md §8.5 is the rule: what a frame shows is read as numbers and text; an image is opened only when a number
points at one, and then by the `visual-reviewer` subagent, which returns JSON, so its tokens stay out of your context.
Every command below prints its verdict first and writes `out/<cmd>/<target>/report.json`: read that, not scrollback.

## One frame: node x shot

`node x shot <page> [--scene s] [--cam code] [--set k=v…]` (a page is `labs/<name>` or an `.html` file) renders on
WebGPU in the platform's Chromium with the virtual clock and seed 1, and reports:

- **The look metrics** (engine/gfx/lookMetrics.ts): `coverage` (pixels that are not the background), the luma's mean,
  P5, P95 and spread, the dark and blown-out shares, the colours and the palette, the flat share, the checkerboard
  share (dithering), edge density, the mean and commonest colours, the largest object's share and whether the
  protagonist shows. Each note against `LOOK_LIMITS` is a warning with its number and its fix (`LOOK_DARK`,
  `LOOK_BLOWN`, `LOOK_FLAT`, `LOOK_ONE_OBJECT`: "the camera is inside a wall", `LOOK_NO_PROTAGONIST`…); `LOOK_BLANK`
  fails.
- **The ID pass** (engine/gfx/idpass.ts): every drawable in a flat colour of its own, unlit, so `px.<name>`,
  `share.<name>` and `bbox.<name>` say what covers what, largest first, and `unseen.<name>` says why the rest show
  nothing: `hidden`, `background`, `outside` (the frustum) or `covered` (in view, 0 px). "The hero covers 0 px" is
  the answer, not a picture of it.
- **The thumbnail**: 48 × 27 cells of hex colours with an object map (`A` the largest object…, `.` empty), in
  `out/shot/<target>/shot.json`: a coarse picture to read as text.
- `--marks` numbers what the ID pass sees on `marks.png` (the legend as `mark.<n>`), `--png` writes `frame.png`: for
  the reviewer, on demand.

`--ids` or `--metrics` alone is cheaper. While `node x inspect` runs, the shot is taken in its page, so what
`node x set` changed shows.

## Baselines

- `--thumb <case>` compares the thumbnail with tests/baselines/thumbs/<case>.json: a cell fails when a channel moves
  more than 24 of 255 (`SHOT_THUMB_MOVED`, naming the worst cells). `--update` records it, and a baseline changes
  only with the reason in the commit (tests/baselines/thumbs/README.md lists the cases and who compares each).
- An advice code or a console warning that no baseline under tests/baselines/advice/ lists fails the test that
  printed it (the advice trap, docs/TESTING.md); `x shot` reports it as a warning.

## Many frames

- `node x film <page> --steps "…"` plays a script over `__engine.input` (`step 60`, `press jump`, `axis move 0,1`,
  `cam topdown`, `shot`, `rec 4 15`) and lays the frames out on a labelled contact sheet. `--compare <ref>` films the
  same steps at that commit in a temporary worktree and gives every differing pixel to an object, through the ID pass
  ("93% of the changed pixels are on hero"): `FILM_CHANGED` names them; `FILM_NOT_REPEATABLE` means the same sources
  drew different pixels, a bug.
- `node x gallery <kind> [id]` films every prop, material, body, move, look or emitter, each frame checked to show
  its subject; `--look <id>` draws them all in a look.
- `node x sheet <subject>` draws the humanoid's states (the `animation-authoring` skill); `node x qa tex` writes
  out/qa/tex/sheet.png, every texture tiled so a seam shows.

## Without a GPU

`node x eye <scene> [--cam code]` (engine/dev/eye.ts) answers "is X visible from camera C" in Node: a coarse raster
of the physics shapes from the camera as the view places it, printed as text with its legend (`eye.txt`,
`eye.json`); `__engine.eye()` asks the same in a page. Use it before a shot when the question is only whether
something is in view: it agrees with the ID pass on the box's cameras in 280 of 282 cases (PLAN.md WP 12.3).

## The looks

docs/PLAYGROUND.md §5.2 and §9.1 say how the playground's two looks are held: thumbnails per look and camera
(`playground-<look>-<camera>`), the shimmer metric (pixels a sub-pixel pan of an orthographic camera changes: 0 in
the pixel look), contrast and palette within each look's bounds; tests/e2e/playground-looks.spec.ts checks them in
T2 (`npm run e2e -- tests/e2e/playground-looks.spec.ts`, only when you touched a look).

## Handing an image over

When a metric points at a picture (a `LOOK_ONE_OBJECT`, a thumbnail that moved, a film's changed objects), give the
`visual-reviewer` subagent the image paths, the report.json beside them and the question ("does the hero show?",
"did only the door move?"). It returns `{ pass, images, failures: [{ what, where, fix }], notes }`. Never open
images to browse: a frame's tokens buy less than its numbers.
