# The CMU ledger

Every take of the CMU Graphics Lab Motion Capture Database (CMU's terms and credit: `data/anim/SOURCES.md`), one a
line, with what a game would use it for, how well the readable format keeps to it, and what the library did with it.
It came from my-3d2dge's `src/mocap/catalogs/cmu-takes.tsv`, which `tools/cmu.mjs survey` wrote by converting and
measuring every take. Search it (`grep -i cartwheel data/anim/cmu/*.tsv`); never read it whole.

## Files

- `categories.tsv`: the 17 categories in the order they are tried, each with its file, its number of takes and its
  pattern.
- `<category>.tsv`: that category's takes, ordered by subject and take. The file is the category, so the rows have no
  category column.
- `subjects.tsv`: each subject's description from the site's motion list, and its number of takes. The original
  repeated it on every row (a quarter of the file).

Tab-separated, one header row, `#` lines are comments. A row may stop short of its last, empty fields (`.editorconfig`
trims trailing tabs): read missing fields as empty.

## Columns

| Column | Meaning |
|---|---|
| `id` | the take: subject and take number, `13_29` |
| `subject` | the subject number (`subjects.tsv` describes it) |
| `fps` | the capture's frame rate: 120, or 60 for some subjects |
| `sec` | length in seconds |
| `active` | the seconds where it moves (still stretches at either end left out) |
| `fit` | the readable format's average and worst body-point error against the capture, in mm |
| `travel` | metres the hips cover |
| `hips` | lowest and highest hip height, in percent of standing: under 60 is crouching or lying, over 115 in the air or up on something |
| `flags` | `inverted` (upside down at some point), `floats` (feet off the floor most of the time: stairs, a ladder, a bench), `loose` (fit over 30 mm), `short` (under a second), `fps?` (not on the site's list, so 120 is assumed) |
| `used` | the CMU set's clips cut from it (`data/anim/catalogs/cmu.json`) |
| `note` | the only column edited by hand: `pick: Name (why)` (next to import) or `skip: why` |
| `desc` | the take's description on the site's motion list |

## Categories

A take's category is the first in `categories.tsv` whose pattern matches its description, lower-cased. A take with no
description is `undescribed`; one that no pattern matches is `other`.

**The fallback, fixed.** my-3d2dge's survey tried the subject's description when the take's own matched nothing. A
subject's description often lists several activities, or none of the take's, so 191 takes landed in the first category
their subject mentioned: `144_30` "Sun Salutation" in combat, because subject 144 is "punching female", and 21
"Alaskan vacation" takes in "animal and character". The category now comes from the take's own words, so those 191
are `other`; their subject's description is still one look away in `subjects.tsv`. Some lose a category their subject
gave them rightly (swimming strokes, karate kata, style walks): `other` under-reports, where the fallback misled. The
patterns are unchanged.

## Counts

| What | Count |
|---|---|
| Takes | 2,548 |
| Subjects | 113 |
| Seconds | 38,698.3 |
| Takes at 60 fps | 326 |
| Takes flagged `inverted` | 189 |
| Takes flagged `fps?` | 113 |
| Takes flagged `floats` | 63 |
| Takes flagged `loose` | 56 |
| Takes flagged `short` | 25 |
| Takes `used` by the CMU set | 59 |
| Takes marked `pick` | 30 |

The 113 `fps?` takes keep their flag until WP 8.5 verifies their frame rate. `tests/unit/data/anim/ledger/` checks
these counts, the category of every row and that the split joins back to the original rows exactly.
