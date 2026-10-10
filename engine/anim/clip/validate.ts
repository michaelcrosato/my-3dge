/**
 * @file Reading clips in, and checking them (PLAN.md §10.2, WP 8.2): `parseClip` and `parseClipSet` turn text or
 * objects into clips and sets of format 1 or 2, refusing a broken one with an error that names the clip, the key, its
 * time and the field, and the fix; `validateClip` then warns about poses that read but play badly.
 *
 * Parsing follows `my-3d2dge:src/mocap/readable.js`'s `parse`: `//` comment lines are allowed, keys are sorted by
 * time, `dur` defaults to the last key's time, and the header keeps its order, so `clipText` prints it unchanged.
 * Beyond the source it checks each field's length and, as shardfall's reader does, refuses no format-1 file; unlike
 * shardfall's it refuses unknown names (a typo would play as a missing field), with the closest known name.
 *
 * The validator warns when a limb direction collapses between opposite keys, when a twist jumps more than 120° while
 * the bend is over 140° (the v1 pop: HERO `Victory`, 1.2–1.27 s), when a knee bends out of range, when an angle goes
 * past ±540°, and when the hips go below the floor. Warnings are data (`ClipWarning`); WP 8.6's QA family reports
 * them, with a baseline.
 *
 * @example
 * const clip = parseClip('{"dur": 1, "keys": [{"t": 0, "hips": [0, 0, 100], …}]}', 'Idle');
 * validateClip(clip).map((w) => w.message); // [] for a clean clip
 * parseClip('{"keys": [{"t": 0.5}]}'); // throws [ANIM_CLIP_MISSING_FIELD] the clip: key 1 (t 0.5) has no "hips": …
 * @see engine/anim/clip/validate.test.ts
 */
import { codeError, codeInfo, defineCodes, didYouMean, fill, type CodeValues } from '../../core/log';
import { ANGLE_ENTRIES, foldAngle, KEY_ARRAYS, KEY_FIELDS, KEY_NUMBERS, REQUIRED } from './lens';
import { POSE_POINTS, type Clip, type ClipContact, type ClipKey, type LimbPose, type Triple } from './readable';

/**
 * A body's rest measurements (mm and degrees), measured by the importer from the library's own clips: `H0`, the
 * standing pelvis height (the unit of `hips` and `root`); `Pr`, `Cr` and `Hr`, the rest frames of the pelvis, chest and
 * head (`[forward, right, up]` axes); the four `spine` bones from the pelvis to the neck, and `spineW`, how much of the
 * pelvis-to-chest turn each takes (the library's own), as `neckW` is the neck's share of the chest-to-head turn; `cv`,
 * each collarbone from its pivot to the shoulder; and the segments' lengths (`up`, `fore`, `thigh`, `shin`…).
 */
export type RestBody = Record<'H0' | 'hipZ' | 'ankleZ' | 'up' | 'fore' | 'knuck' | 'fist' | 'thigh' | 'shin', number> &
  Record<'ab' | 'bt' | 'abPitch' | 'btPitch' | 'neckW', number> &
  Record<'Pr' | 'Cr' | 'Hr' | 'spine', Triple[]> &
  Record<'hip' | 'clav' | 'cv', { L: Triple; R: Triple }> &
  Record<'neckSeg' | 'topH' | 'faceH', Triple> & { spineW: number[] };

/** A library a set's clips came from: its provenance and the rest body they were measured on. */
export interface ClipSource {
  rest: RestBody;
  label?: string;
  origin?: string;
  license?: string;
  url?: string;
  file?: string;
  rig?: string;
}

/** A set of clips: the header, then the clips by name. `title` and `legend` are format 2's (shardfall's). */
export interface ClipSet {
  set: string;
  title?: string;
  legend?: string[];
  format?: number;
  credit?: string;
  /** The sets a picked set was taken from. */
  from?: string[];
  fps?: number;
  sources?: Record<string, ClipSource>;
  /** The mannequin's segments (WP 8.4 reads them). */
  body?: object | null;
  /** Each clip's average and worst body-point error against its capture, mm. */
  fit?: Record<string, [mean: number, worst: number]>;
  clips: Record<string, Clip>;
}

/** The clip codes, with their fixes (collected into docs/ERRORS.md by `x docs`). */
export const CLIP_CODES = defineCodes('anim', {
  ANIM_CLIP_NOT_JSON: {
    template: '{where} is not JSON: {problem}',
    fix: 'write the clip as JSON (lines starting with // are comments): { "dur": seconds, "loop": false, "keys": [ … ] }',
  },
  ANIM_CLIP_NO_KEYS: {
    template: '{where} has no key poses',
    fix: 'give it "keys": [ … ] with at least one key pose, each { "t": seconds, "hips": [0, 0, 100], … }',
  },
  ANIM_CLIP_BAD_KEY: {
    template: '{where}: key {key} is {value}, not a key pose',
    fix: 'write each key as an object holding "t" (seconds) and the fields LEGEND lists',
  },
  ANIM_CLIP_NO_TIME: {
    template: '{where}: key {key} has no time "t"',
    fix: 'give every key its time in seconds from the start of the clip, such as "t": 0.5',
  },
  ANIM_CLIP_MISSING_FIELD: {
    template: '{where}: key {key} (t {t}) has no "{field}"',
    fix: 'add "{field}": {shape}; every key needs hips, body, chest, head, armL, armR, legL and legR',
  },
  ANIM_CLIP_BAD_FIELD: {
    template: '{where}: key {key} (t {t}): "{field}" is {value}',
    fix: 'make "{field}" {shape}',
  },
  ANIM_CLIP_UNKNOWN_FIELD: {
    template: '{where}: key {key} (t {t}) has no field "{field}"{suggestion}',
    fix: 'use only the key fields {fields} (LEGEND in engine/anim/clip/readable.ts says what each means)',
  },
  ANIM_CLIP_BAD_HEADER: {
    template: '{where}: "{field}" is {value}',
    fix: 'make "{field}" {shape}, or leave it out',
    doc: 'Raised by `parseClip` and `parseClipSet` (engine/anim/clip/validate.ts) for a clip or set header field of the wrong type or shape, and for a clip whose `src` is not one of its set’s sources.',
  },
  ANIM_CLIP_UNKNOWN_HEADER: {
    template: '{where} has no field "{field}"{suggestion}',
    fix: 'use only the fields {fields}',
  },
  ANIM_CLIP_LIMB_COLLAPSE: {
    template: '{where}: "{field}" turns {angle}° between key {key} (t {t}) and key {next} (t {nextT})',
    fix: 'add a key between them pointing the way the limb should swing: in-betweens of opposite directions pass through the joint',
    doc: 'Reported by `validateClip` (engine/anim/clip/validate.ts) when a limb direction turns more than 150° from one key to the next: keys in-between every number linearly, so the direction nearly vanishes on the way and the limb snaps round.',
  },
  ANIM_CLIP_TWIST_POP: {
    template:
      '{where}: "{field}" twist jumps {jump}° between key {key} (t {t}) and key {next} (t {nextT}) while bent {bend}°',
    fix: 'add or subtract 360 so the twist continues from the key before, or add a key between them',
    doc: 'Reported by `validateClip` (engine/anim/clip/validate.ts) for a twist that changes more than 120° between keys while either key bends the limb more than 140°: the elbow or knee spins round the limb (the v1 pop pattern).',
  },
  ANIM_CLIP_KNEE_RANGE: {
    template: '{where}: key {key} (t {t}): "{field}" {problem}',
    fix: 'keep the knee bend from 0 to 165 and, while it bends more than 30, its twist within 120 of forward',
  },
  ANIM_CLIP_ANGLE_RANGE: {
    template: '{where}: key {key} (t {t}): "{field}" holds {value}°, past ±540°',
    fix: 'take whole turns (360) off it, keeping it near the keys round it; normalizedLens(clip) shows every angle folded to ±180°',
  },
  ANIM_CLIP_BELOW_FLOOR: {
    template: '{where}: key {key} (t {t}): the hips are at {value}% of standing hip height, below the floor',
    fix: 'raise hips[2] to 0 or more (100 is standing, 55 sitting on a chair)',
  },
});

/** A clip code. */
export type ClipCode = keyof typeof CLIP_CODES;

/** One warning about a clip: the code, the key (from 1) and its time, the field, and the sentence naming the fix. */
export interface ClipWarning {
  code: ClipCode;
  key: number;
  t: number;
  field: string;
  /** `[CODE] <clip>: key <n> (t <seconds>): <what is wrong>: <the fix>`. */
  message: string;
}

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isText = (v: unknown) => typeof v === 'string';
const isTexts = (v: unknown) => Array.isArray(v) && v.every(isText);
const atLeast = (min: number) => (v: unknown) => isNumber(v) && v >= min;
const isPair = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(atLeast(0));
/** Only the fields named, each passing its check (a missing optional field passes). */
const shaped = (checks: Record<string, (v: unknown) => boolean>, required: string[]) => (v: unknown) =>
  isObject(v) &&
  required.every((name) => name in v) &&
  Object.entries(v).every(([name, value]) => checks[name]?.(value));
const listOf = (check: (v: unknown) => boolean) => (v: unknown) => Array.isArray(v) && v.every(check);
const isSide = (v: unknown) => v === 'L' || v === 'R';
const isPart = (v: unknown) => ['footL', 'footR', 'handL', 'handR'].includes(v as string);
const isEvent = shaped({ t: atLeast(0), name: (v) => isText(v) && v !== '', side: isSide }, ['t', 'name']);
const isInterval = shaped({ part: isPart, from: atLeast(0), to: atLeast(0) }, ['part', 'from', 'to']);
const isContact = (v: unknown) => isInterval(v) && (v as ClipContact).from <= (v as ClipContact).to;
const isProp = (v: unknown) => isText(v) && /^[A-Za-z][\w-]*:(L|R|LR)$/.test(v as string);

/** A header check and the shape its error names. */
type Spec = [check: (v: unknown) => boolean, shape: string];
/** A clip's header fields: format 1's, then format 2's. */
const CLIP_HEADER: Record<string, Spec> = {
  clip: [isText, 'the clip’s name'],
  src: [isText, 'the name of one of the set’s sources'],
  orig: [isText, 'the clip it was made from, "SET/clip"'],
  take: [isText, 'a take and its seconds, such as "13_29 2.30-3.42"'],
  dur: [atLeast(0), 'its length in seconds'],
  loop: [(v) => typeof v === 'boolean', 'true or false'],
  tags: [isTexts, 'a list of words'],
  desc: [isText, 'a sentence'],
  speed: [atLeast(0), 'how fast the loop travels: % of standing hip height a second, 0 or more'],
  fps: [(v) => isNumber(v) && v > 0, 'frames a second, above 0'],
  via: [(v) => v === 'v1' || v === 'shardfall' || v === 'source', '"v1", "shardfall" or "source"'],
  fit: [isPair, '[mean, worst] in mm'],
  events: [listOf(isEvent), 'a list of { "t": seconds, "name": "land", "side": "L" or "R" (optional) }'],
  contacts: [listOf(isContact), 'a list of { "part": "footL", "footR", "handL" or "handR", "from": s, "to": s }'],
  props: [listOf(isProp), 'a list of "<prop>:<hands>", such as "sword:R" or "box:LR"'],
  keys: [Array.isArray, 'a list of key poses'],
};
/** A set's header fields (`clips` is checked clip by clip). */
const SET_HEADER: Record<string, Spec> = {
  set: [isText, 'the set’s name'],
  title: [isText, 'a title'],
  legend: [isTexts, 'a list of lines'],
  format: [(v) => v === 1 || v === 2, '1 or 2'],
  credit: [isText, 'the credit line'],
  from: [isTexts, 'the names of the sets it was picked from'],
  fps: [(v) => isNumber(v) && v > 0, 'frames a second, above 0'],
  sources: [
    (v) => isObject(v) && Object.values(v).every((s) => isObject(s) && isObject(s.rest)),
    'sources by name, each with its "rest" body',
  ],
  body: [(v) => v === null || isObject(v), 'the mannequin’s segments, or null'],
  fit: [(v) => isObject(v) && Object.values(v).every(isPair), 'each clip’s [mean, worst] in mm, by name'],
  clips: [isObject, 'the clips by name'],
};

/** A value as an error shows it: JSON, cut to 60 characters. */
function shown(value: unknown): string {
  const text = value === undefined ? 'missing' : (JSON.stringify(value) ?? String(value));
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** Checks a header's fields against `specs`, refusing unknown names. */
function checkHeader(raw: Raw, specs: Record<string, Spec>, where: string): void {
  for (const [field, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    const spec = specs[field];
    const fields = Object.keys(specs).join(', ');
    if (!spec)
      throw codeError('ANIM_CLIP_UNKNOWN_HEADER', {
        where,
        field,
        fields,
        suggestion: didYouMean(field, Object.keys(specs)),
      });
    if (!spec[0](value)) throw codeError('ANIM_CLIP_BAD_HEADER', { where, field, value: shown(value), shape: spec[1] });
  }
}

/** One key, checked; its fields kept as written. */
function parseKey(key: unknown, index: number, where: string): ClipKey {
  if (!isObject(key)) throw codeError('ANIM_CLIP_BAD_KEY', { where, key: index, value: shown(key) });
  if (!isNumber(key.t)) throw codeError('ANIM_CLIP_NO_TIME', { where, key: index });
  const at = { where, key: index, t: key.t };
  for (const field of REQUIRED) {
    if (key[field] === undefined)
      throw codeError('ANIM_CLIP_MISSING_FIELD', { ...at, field, shape: KEY_ARRAYS[field][1] });
  }
  for (const [field, value] of Object.entries(key)) {
    if (field === 't' || value === undefined) continue;
    const [array, number] = [KEY_ARRAYS[field], KEY_NUMBERS[field]];
    const bad = (shape: string) => codeError('ANIM_CLIP_BAD_FIELD', { ...at, field, value: shown(value), shape });
    if (array) {
      const shape = `${array[0]} numbers: ${array[1]}`;
      if (!Array.isArray(value) || value.length !== array[0] || !value.every(isNumber)) throw bad(shape);
    } else if (number) {
      if (!isNumber(value) || value < number[0] || value > number[1]) throw bad(number[2]);
    } else {
      const suggestion = didYouMean(field, KEY_FIELDS);
      throw codeError('ANIM_CLIP_UNKNOWN_FIELD', { ...at, field, suggestion, fields: KEY_FIELDS.join(', ') });
    }
  }
  return { ...key } as unknown as ClipKey;
}

/** `clip "<name>"`, or `the clip`, as messages name it. */
const clipWhere = (name: unknown) => (typeof name === 'string' && name ? `clip "${name}"` : 'the clip');

/**
 * Reads a clip of format 1 or 2 from its text (`//` comment lines allowed) or an object, which is not changed: the
 * result is a copy, its keys sorted by time and `dur` filled in. `name` names it in errors (default: its `clip`).
 * Throws an `ANIM_CLIP_*` error naming the key, its time and the field, with the fix.
 */
export function parseClip(input: string | object, name?: string): Clip {
  let raw: unknown = input;
  const where = clipWhere(name ?? (isObject(input) ? input.clip : undefined));
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input.replace(/^\s*\/\/.*$/gm, ''));
    } catch (error) {
      throw codeError('ANIM_CLIP_NOT_JSON', { where, problem: (error as Error).message }, error);
    }
  }
  if (!isObject(raw)) throw codeError('ANIM_CLIP_NO_KEYS', { where });
  const label = name === undefined ? clipWhere(raw.clip) : where;
  if (!Array.isArray(raw.keys) || !raw.keys.length) throw codeError('ANIM_CLIP_NO_KEYS', { where: label });
  checkHeader(raw, CLIP_HEADER, label);
  const keys = raw.keys.map((key: unknown, i: number) => parseKey(key, i + 1, label)).sort((a, b) => a.t - b.t);
  return { ...raw, keys, dur: (raw.dur as number) || keys[keys.length - 1].t } as Clip;
}

/**
 * Reads a set of clips (a set file's text or object): its header, then every clip by `parseClip`. A clip's `src`
 * must name one of the set's `sources` when it has them. Format-1 sets and shardfall's parse unchanged.
 */
export function parseClipSet(input: string | object): ClipSet {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input.replace(/^\s*\/\/.*$/gm, ''));
    } catch (error) {
      throw codeError('ANIM_CLIP_NOT_JSON', { where: 'the set', problem: (error as Error).message }, error);
    }
  }
  const header = isObject(raw) ? raw : {};
  const where = `set "${String(header.set ?? '')}"`;
  if (!isText(header.set) || !isObject(header.clips)) {
    const field = isText(header.set) ? 'clips' : 'set';
    throw codeError('ANIM_CLIP_BAD_HEADER', { where, field, value: shown(header[field]), shape: SET_HEADER[field][1] });
  }
  checkHeader(header, SET_HEADER, where);
  const sources = header.sources as Raw | undefined;
  const clips = Object.entries(header.clips as Raw).map(([name, value]): [string, Clip] => {
    const clip = parseClip(value as object, `${header.set}/${name}`);
    if (sources && clip.src !== undefined && !(clip.src in sources)) {
      const shape = `one of the set’s sources (${Object.keys(sources).join(', ')})`;
      throw codeError('ANIM_CLIP_BAD_HEADER', {
        where: clipWhere(`${header.set}/${name}`),
        field: 'src',
        value: shown(clip.src),
        shape,
      });
    }
    return [name, clip];
  });
  return { ...header, clips: Object.fromEntries(clips) } as unknown as ClipSet;
}

/** A warning about key `index` (from 1) of `where`. */
function warning(code: ClipCode, values: CodeValues & { key: number; t: number; field: string }): ClipWarning {
  const text = codeInfo(code) ?? CLIP_CODES[code];
  const message = `[${code}] ${fill(text.template, values)}: ${fill(text.fix, values)}`;
  return { code, key: values.key, t: values.t, field: values.field, message };
}

/** The angle in degrees between two limb directions (their first three numbers). */
function turn(a: LimbPose, b: LimbPose): number {
  const [la, lb] = [Math.hypot(a[0], a[1], a[2]), Math.hypot(b[0], b[1], b[2])];
  if (!la || !lb) return 0;
  const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

const LIMBS = ['armL', 'armR', 'legL', 'legR'] as const;

/**
 * Warns about poses that parse but play badly (see the file comment), in key order. `name` names the clip in
 * messages (default: its `clip`). Returns an empty list for a clean clip.
 */
export function validateClip(clip: Clip, name = clip.clip): ClipWarning[] {
  const where = clipWhere(name);
  const found: ClipWarning[] = [];
  clip.keys.forEach((k, i) => {
    const at = { where, key: i + 1, t: k.t };
    if (k.hips[2] < 0) found.push(warning('ANIM_CLIP_BELOW_FLOOR', { ...at, field: 'hips', value: k.hips[2] }));
    for (const [field, entries] of Object.entries(ANGLE_ENTRIES)) {
      const value = k[field as keyof ClipKey];
      if (value === undefined) continue;
      const numbers = typeof value === 'number' ? [value] : (value as number[]);
      const past = entries.map((e) => numbers[e]).find((v) => Math.abs(v) > 540);
      if (past !== undefined) found.push(warning('ANIM_CLIP_ANGLE_RANGE', { ...at, field, value: past }));
    }
    for (const field of ['legL', 'legR'] as const) {
      const [bend, twist] = [k[field][3], k[field][4]];
      const problem =
        bend < 0 || bend > 165
          ? `bends ${bend}°, outside 0–165°`
          : bend > 30 && Math.abs(foldAngle(twist)) > 120
            ? `bends ${bend}° with the knee turned ${Math.round(foldAngle(twist))}° from forward`
            : '';
      if (problem) found.push(warning('ANIM_CLIP_KNEE_RANGE', { ...at, field, problem }));
    }
    const next = clip.keys[i + 1];
    if (!next) return;
    const pair = { ...at, next: i + 2, nextT: next.t };
    for (const field of LIMBS) {
      const [a, b] = [k[field], next[field]];
      const angle = turn(a, b);
      if (angle > 150) found.push(warning('ANIM_CLIP_LIMB_COLLAPSE', { ...pair, field, angle: Math.round(angle) }));
      const [jump, bend] = [Math.abs(b[4] - a[4]), Math.max(a[3], b[3])];
      if (jump > 120 && bend > 140) found.push(warning('ANIM_CLIP_TWIST_POP', { ...pair, field, jump, bend }));
    }
  });
  return found;
}

/** Body points shown in errors: all but the finger helpers, which only aim a blade. */
const SHOWN = POSE_POINTS.map((p, i) => (/^(index|pinky)/.test(p) ? -1 : i * 3)).filter((i) => i >= 0);

/** The largest distance (mm) between matching body points of two decoded poses, the finger helpers left out. */
export function poseError(A: ArrayLike<number>, B: ArrayLike<number>): number {
  let worst = 0;
  for (const i of SHOWN) {
    const [x, y, z] = [A[i] - B[i], A[i + 1] - B[i + 1], A[i + 2] - B[i + 2]];
    worst = Math.max(worst, x * x + y * y + z * z);
  }
  return Math.sqrt(worst);
}

/** The average distance (mm) between matching body points of two decoded poses, the finger helpers left out. */
export function poseMeanError(A: ArrayLike<number>, B: ArrayLike<number>): number {
  let sum = 0;
  for (const i of SHOWN) sum += Math.hypot(A[i] - B[i], A[i + 1] - B[i + 1], A[i + 2] - B[i + 2]);
  return sum / SHOWN.length;
}
