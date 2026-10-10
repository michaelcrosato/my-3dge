# Text thumbnails

Golden references for how a frame looks, as text instead of images (PLAN.md §8.5; doctrine: Assets). Each
`<case>.json` is the 48 × 27 thumbnail of one shot, written by engine/gfx/thumbnail.ts and recorded by `x shot`:

- `case`: the file's name.
- `width`, `height`: the grid, 48 × 27 cells; `source`: the shot's size in pixels.
- `rows`: 27 strings of 48 colours `rrggbb` separated by spaces, each the average of the pixels its cell covers.
- `map` and `legend`, when the page has an ID pass: 27 strings of 48 symbols, each cell the object covering most of
  it (`A` the largest visible object, then `B`…; `.` empty space), and what each symbol is. Read it as a coarse map
  of the frame; the comparison ignores it.

## Compare and record

- `node x shot <page> [--scene s] [--cam code] --thumb <case>` compares the shot's thumbnail with `<case>.json`: a
  cell differs when one of its channels moved by more than 24 of 255, and any differing cell fails the shot
  (`SHOT_THUMB_MOVED`, naming the worst cells). A missing baseline fails too (`SHOT_NO_THUMB`).
- Add `--update` to record it. A baseline changes only with a written reason in the commit (AGENTS.md), and belongs
  to the WP that records it (PLAN.md §9.3).

## Cases

- `shot-objects`: tests/pages/shot.html, scene `objects`, camera `front` (WP 2.6), compared by tests/e2e/shot.spec.ts.
