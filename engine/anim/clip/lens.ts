/**
 * @file How a clip reads (PLAN.md §10.2, WP 8.2): `LEGEND`, what every key field means, and each field's shape
 * (`KEY_ARRAYS`, `KEY_NUMBERS`, `ANGLE_ENTRIES`), which parsing, in-betweening and the validator read; `clipText`, the
 * text an agent reads and edits, ported from `my-3d2dge:src/mocap/readable.js`'s `text` with no change in its output;
 * and the normalized lens, every angle folded to (−180°, 180°] for reading, without changing the stored data.
 *
 * Importers unwrap angles so each key continues from the one before (a spin keeps counting past 360°), which keeps
 * the in-betweens right but makes a single key hard to read; the lens shows the same pose at every key.
 *
 * Invariants: `clipText` writes the header in the clip's own field order, then three lines per key (torso, arms,
 * legs), format 2's fields after format 1's, so a format-1 clip prints exactly as the source printed it. The lens
 * returns a copy; a folded angle differs from the stored one by whole turns, so each key decodes to the same body
 * points (to rounding), but the in-betweens differ: the lens is for reading, never for storing. Bends of 0° to 180°
 * read unchanged.
 *
 * @example
 * import { standing } from '../../../tests/unit/anim/clip-fixtures';
 * const clip = { dur: 0, keys: [{ ...standing(0), body: [450, 10, -370] }] };
 * normalizedLens(clip).keys[0].body; // [90, 10, -10]: the same pose, read at a glance
 * foldAngle(190); // -170
 * clipText(clip).split('\n')[2]; // '   "hips":[0,0,100], "body":[450,10,-370], …': the stored numbers
 * @see engine/anim/clip/lens.test.ts
 */
import type { Clip, ClipKey } from './readable';

/** What each field means, one line each, as a set file or a reader shows it (shardfall's legend, format 2 added). */
export const LEGEND: readonly string[] = [
  'Readable key poses (the my-3D2dge format). Times in seconds; every other number is a whole number. Rig frame: forward, right, up.',
  "L and R are the figure's own sides. Directions are percentages and need not add up: [100, 0, 0] and [50, 0, 0] agree.",
  'hips   [forward, right, up]   the pelvis, in percent of standing hip height (100 = standing, 55 = sitting on a chair)',
  'body   [turn, lean, tilt]     the pelvis, degrees: turn + = toward the right, lean + = forward, tilt + = toward the right',
  'chest  [turn, lean, tilt]     the chest, relative to the pelvis; head [turn, lean, tilt] relative to the chest',
  'shL shR    [reach, shrug]     degrees the shoulder swings forward (into a punch or an aim) and up, from rest',
  'armL armR  [forward, out, up, bend, twist]  which way the arm points from the shoulder to the fist, in chest space (out + = away from the body on that side; [0, 0, -100] hangs down, [100, 0, 0] punches ahead); bend = elbow bend in degrees (0 = straight); twist = degrees the elbow swings round the arm from its natural direction (back and down)',
  'legL legR  [forward, out, up, bend, twist]  hip to ankle in pelvis space; bend: the knee; twist: from pointing forward',
  'footL footR [down, out, toes]   degrees the foot points down from standing, turns outward, and the toes bend up',
  'blade  [forward, right, up]   (sword clips) the direction of a blade held in the right fist, in chest space',
  'root   [forward, right]       (clips that travel) how far the whole body has moved, in percent of standing hip height',
  "speed  (a clip's header: loops that walk or run in place) how fast the capture travelled, percent of standing hip height a second",
  'format 2, each optional: handL handR [flex, side, roll] at the wrist; rollL rollR (foot roll); yaw (root); spine [turn, lean, tilt]; gripL gripR (0-100)',
];

/** Each array field of a key: its length and its shape, as an error names it. */
export const KEY_ARRAYS: Record<string, [size: number, shape: string]> = {
  hips: [3, '[forward, right, up] in % of standing hip height'],
  ...Object.fromEntries(['body', 'chest', 'head', 'spine'].map((f) => [f, [3, '[turn, lean, tilt] in degrees']])),
  ...Object.fromEntries(['shL', 'shR'].map((f) => [f, [2, '[reach, shrug] in degrees']])),
  ...Object.fromEntries(['armL', 'armR', 'legL', 'legR'].map((f) => [f, [5, '[forward, out, up, bend, twist]']])),
  ...Object.fromEntries(['footL', 'footR'].map((f) => [f, [3, '[down, out, toes] in degrees']])),
  blade: [3, '[forward, right, up], the blade’s direction'],
  root: [2, '[forward, right] in % of standing hip height'],
  ...Object.fromEntries(['handL', 'handR'].map((f) => [f, [3, '[flex, side, roll] in degrees']])),
};
/** Format 2's single-number key fields: their range and shape. */
export const KEY_NUMBERS: Record<string, [min: number, max: number, shape: string]> = {
  ...Object.fromEntries(['rollL', 'rollR', 'yaw'].map((f) => [f, [-Infinity, Infinity, 'a number of degrees']])),
  ...Object.fromEntries(['gripL', 'gripR'].map((f) => [f, [0, 100, 'a number from 0 (open) to 100 (closed)']])),
};
/** The fields every key has. */
export const REQUIRED = ['hips', 'body', 'chest', 'head', 'armL', 'armR', 'legL', 'legR'];
/** Every key field's name, `t` first. */
export const KEY_FIELDS = ['t', ...Object.keys(KEY_ARRAYS), ...Object.keys(KEY_NUMBERS)];

/** Each key's fields in the three lines `clipText` writes: torso, arms, legs (format 2's after format 1's). */
const LINES = [
  ['hips', 'body', 'chest', 'head', 'root', 'spine', 'yaw'],
  ['shL', 'shR', 'armL', 'armR', 'blade', 'handL', 'handR', 'gripL', 'gripR'],
  ['legL', 'legR', 'footL', 'footR', 'rollL', 'rollR'],
] as const;

/** The text an agent reads and edits: the clip's header on one line, then each key as three short lines. */
export function clipText(clip: Clip): string {
  const head = Object.entries(clip)
    .filter(([name]) => name !== 'keys')
    .map(([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`)
    .join(', ');
  const line = (k: ClipKey) => {
    const fields = (names: readonly (keyof ClipKey)[]) =>
      names.filter((f) => k[f] !== undefined).map((f) => `"${f}":${JSON.stringify(k[f])}`);
    return `  {"t":${k.t},\n${LINES.map((names) => `   ${fields(names).join(', ')}`).join(',\n')}}`;
  };
  return `{${head}, "keys": [\n${clip.keys.map(line).join(',\n')}\n]}`;
}

/**
 * Which entries of each key field are angles in degrees, by field (a single-number field lists entry 0): what the
 * lens folds and `validateClip` bounds. A limb's direction is not an angle; its bend and twist are.
 */
export const ANGLE_ENTRIES: Readonly<Partial<Record<keyof ClipKey, readonly number[]>>> = {
  ...Object.fromEntries(
    ['body', 'chest', 'head', 'spine', 'footL', 'footR', 'handL', 'handR'].map((f) => [f, [0, 1, 2]]),
  ),
  ...Object.fromEntries(['shL', 'shR'].map((f) => [f, [0, 1]])),
  ...Object.fromEntries(['armL', 'armR', 'legL', 'legR'].map((f) => [f, [3, 4]])),
  ...Object.fromEntries(['rollL', 'rollR', 'yaw'].map((f) => [f, [0]])),
};

/** An angle in degrees folded to (−180°, 180°]: 190 → −170, 540 → 180, −180 → 180. */
export function foldAngle(deg: number): number {
  const folded = deg - 360 * Math.ceil((deg - 180) / 360);
  return folded === 0 ? 0 : folded;
}

/** One key with its angles folded. */
function foldKey(key: ClipKey): ClipKey {
  const out: Record<string, unknown> = { ...key };
  for (const [field, entries] of Object.entries(ANGLE_ENTRIES)) {
    const value = out[field];
    if (typeof value === 'number') out[field] = foldAngle(value);
    else if (Array.isArray(value)) out[field] = value.map((v: number, i) => (entries.includes(i) ? foldAngle(v) : v));
  }
  return out as unknown as ClipKey;
}

/** `clip` with every angle of every key folded to (−180°, 180°], for reading (see the file comment). */
export function normalizedLens(clip: Clip): Clip {
  return { ...clip, keys: clip.keys.map(foldKey) };
}
