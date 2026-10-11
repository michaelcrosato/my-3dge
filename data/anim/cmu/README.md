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
| `flags` | `inverted` (upside down at some point), `floats` (feet off the floor most of the time: stairs, a ladder, a bench), `loose` (fit over 30 mm), `short` (under a second); for a take the site's list leaves out, how its frame rate is known: `fps:c3d`, `twin:<id>` (below), or `fps?` (not known: 120 assumed) |
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

## Frame rates

The site's motion list gives each take's frame rate. 113 takes are missing from it (subjects 63, 73, 84, 117 and
121, all in the site's archive), and my-3d2dge's survey read them at an assumed 120 frames a second, flagged `fps?`.
`x anim cmu rates` verified every one (WP 8.5), and each row names its evidence:

- `fps:c3d`: the take's C3D file on the site (`subjects/NN/NN_MM.c3d`, the capture's marker data) gives the rate in
  its header, over the same number of frames as the `.amc` (58 takes);
- `twin:<id>`: the take's skeleton and frames are byte for byte those of `<id>`, a take on the list (subject 63 is
  64's golf, 73 is 70's suitcase, 117 is 85's breakdance, 121 is 90's acrobatics), so it has that take's rate, and
  the same length, stretch, fit, travel and hips (93 takes; subjects 63 and 73 have C3D files as well).

Subject 84's takes (walking up an incline board) were captured at 60 frames a second, all but `84_09` (120): their
rate is corrected, and their length, active stretch, fit and flags were measured again at it (`x anim cmu rates
--write` surveys them again). The other 94 are 120, as assumed. A survey keeps a row's evidence and rate.

## Counts

| What | Count |
|---|---|
| Takes | 2,548 |
| Subjects | 113 |
| Seconds | 38,777.6 |
| Takes at 60 fps | 345 |
| Takes flagged `inverted` | 189 |
| Takes flagged `fps?` | 0 |
| Takes flagged `fps:c3d` | 58 |
| Takes flagged `twin:<id>` | 93 |
| Takes flagged `floats` | 63 |
| Takes flagged `loose` | 56 |
| Takes flagged `short` | 25 |
| Takes `used` by the CMU set | 59 |
| Takes marked `pick` | 30 |

`tests/unit/data/anim/ledger/` checks these counts, the category of every row, the twins against their takes, and
that the split joins back to the original rows exactly, but for the 113 whose rates WP 8.5 verified.
