/**
 * @file The intents vocabulary (PLAN.md §6.4, §6.5 item 3, §8.4, WP 1.5; doctrine: Reproducible): everything the sim
 * reads from outside arrives once per step as plain data, recorded by replays. `move` is a world-space direction
 * `[x, z]` (`fromCamera` turns a stick or keys into one, so W walks away from the camera), `cam` the camera heading,
 * `aim` a world-space aim point, `look` a view direction, `b` the buttons held and `p` the buttons pressed this step,
 * and game code adds its own keys, namespaced (`'game:charge'`). Devices (WP 3.3) make intents; the sim only reads them.
 *
 * Invariants: `normalizeIntents` checks every key and value (an unknown key names the closest; numbers are finite;
 * custom values are plain data) and returns a frozen object with keys in a fixed order, buttons sorted and unique, and
 * absent or empty entries left out. `p` is the union of the presses given and the edges of `b` (held now, not held the
 * step before), so a press is never lost and a hold presses once; when one frame runs several steps, the frame loop
 * passes its taps to the first step only (§6.4). `diffIntents` and `applyIntents` are the replay encoding (§8.4): held
 * state repeats until a change-point changes it (`null` clears a key), `p` belongs to its step and is written only for
 * presses the edges of `b` do not explain, so `applyIntents(prev, diffIntents(prev, next))` is `next` again. `-0` is
 * kept (`Object.is`), since replays must give the sim the very bits live play gave it.
 *
 * `cam` is the yaw of the camera's horizontal view direction, forward(ψ) = (sin ψ, 0, cos ψ) (§6.3), not three.js's
 * `camera.rotation.y`, which is ψ − π since a camera looks down its −Z.
 *
 * @example
 * const step1 = normalizeIntents({ move: fromCamera(Math.PI / 2, [0, 1]), b: ['jump'] }); // move ≈ [1, 0]: +X
 * pressed(step1, 'jump'); // true: an edge of b
 * const step2 = normalizeIntents({ move: step1.move, b: ['jump'] }, step1);
 * [held(step2, 'jump'), pressed(step2, 'jump')]; // [true, false]
 * diffIntents(step1, normalizeIntents({}, step1)); // { b: null, move: null }
 * @see engine/input/intents.test.ts
 */
import { codeError, defineCodes, didYouMean } from '../core/log';
import { isPlainObject, show } from '../core/schema';

/** The codes this module raises, with their fixes. */
export const INTENT_CODES = defineCodes('input', {
  INPUT_BAD_INTENTS: {
    template: '{where}: {problems}',
    fix: 'give intents as { move: [x, z], cam, aim: [x, y, z], look: [yaw, pitch], b: [held buttons], p: [pressed buttons] } with finite numbers, plus custom keys namespaced "game:key" holding plain data (engine/input/intents.ts); null or a missing key means not given',
    doc: 'Raised by `normalizeIntents`, `applyIntents` and the replay checks (engine/input/intents.ts, engine/sim/replay.ts) for an unknown key (named with the closest), a non-finite or misshapen number, a button that is not a non-empty string, or a custom value that is not plain data. Every problem is listed at once.',
  },
});

/** A custom intent's value: plain data, as a replay file holds it. */
export type IntentValue = number | string | boolean | readonly IntentValue[] | { readonly [key: string]: IntentValue };

/** A namespaced key for game code's own intents: `'game:charge'`. */
export type CustomIntentKey = `${string}:${string}`;

/** One step's intents, as the sim reads them (systems get them as their second argument). */
export type Intents = {
  /** The direction to move in, world space `[x, z]`, length 1 at most from `fromCamera`. */
  readonly move?: readonly [number, number];
  /** The camera heading: the yaw of its horizontal view direction, rad (see the file comment). */
  readonly cam?: number;
  /** The point aimed at, world space `[x, y, z]`, m. */
  readonly aim?: readonly [number, number, number];
  /** The view direction `[yaw, pitch]`, rad (first-person look). */
  readonly look?: readonly [number, number];
  /** The buttons held this step, sorted. */
  readonly b?: readonly string[];
  /** The buttons pressed this step (edges of `b` plus taps released within the step), sorted. */
  readonly p?: readonly string[];
} & { readonly [key: CustomIntentKey]: IntentValue | undefined };

/** A replay change-point's intent part: the keys that changed, `null` for a key cleared, `p` for unexplained presses. */
export type IntentChanges = { -readonly [K in keyof Intents]?: Intents[K] | null };

/** The built-in keys, in the order a normalized object holds them, each with what it means. */
export const INTENT_KEYS = {
  move: 'the direction to move in, world space [x, z]',
  cam: 'the camera heading (yaw of its view direction), rad',
  aim: 'the point aimed at, world space [x, y, z], m',
  look: 'the view direction [yaw, pitch], rad',
  b: 'the buttons held, sorted',
  p: 'the buttons pressed this step, sorted',
} as const;

/** A built-in key. */
export type IntentKey = keyof typeof INTENT_KEYS;

/** No intents: what a step gets when nothing is given. */
export const NO_INTENTS: Intents = Object.freeze({});

/** A namespaced key: a lower-case word, a colon, a name. */
const CUSTOM = /^[a-z][A-Za-z0-9]*:[A-Za-z0-9_.-]+$/;

/** The namespaced key a bad one most likely means: `'Game:x'` → `'game:x'`, `'charge'` → `'game:charge'`. */
function customKey(key: string): string {
  const at = key.indexOf(':');
  const space = (at < 0 ? '' : key.slice(0, at)).replace(/[^A-Za-z0-9]/g, '').replace(/^[^A-Za-z]+/, '');
  const name = (at < 0 ? key : key.slice(at + 1)).replace(/[^A-Za-z0-9_.-]/g, '');
  return `${space ? space[0].toLowerCase() + space.slice(1) : 'game'}:${name || 'key'}`;
}

/** How many numbers each vector key holds. */
const VECTORS: Partial<Record<IntentKey, number>> = { move: 2, aim: 3, look: 2 };
/** Code-unit order, so sorting never depends on the locale. */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Deepest nesting a custom value may have. */
const MAX_DEPTH = 32;

/** A frozen copy of plain data, or a problem pushed for the first value that is not. */
function plainData(value: unknown, path: string, problems: string[], depth = 0): IntentValue | undefined {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    problems.push(`${path} is ${show(value)}; numbers must be finite`);
  } else if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  } else if (depth >= MAX_DEPTH) {
    problems.push(`${path} nests deeper than ${MAX_DEPTH} levels`);
  } else if (Array.isArray(value)) {
    const out = value.map((item, i) => plainData(item, `${path}[${i}]`, problems, depth + 1));
    return Object.freeze(out) as IntentValue;
  } else if (isPlainObject(value)) {
    const out: Record<string, IntentValue | undefined> = {};
    for (const key of Object.keys(value).sort(byText))
      out[key] = plainData(value[key], `${path}.${key}`, problems, depth + 1);
    return Object.freeze(out) as IntentValue;
  } else {
    problems.push(`${path} is ${value === null ? 'null inside a value' : show(value)}; custom intents hold plain data`);
  }
  return undefined;
}

/** A sorted, unique, frozen copy of a button list, or problems. */
function buttons(value: unknown, path: string, problems: string[]): readonly string[] | undefined {
  if (!Array.isArray(value)) return void problems.push(`${path} is ${show(value)}; it must be a list of button names`);
  const bad = value.find((name) => typeof name !== 'string' || name === '');
  if (bad !== undefined) return void problems.push(`${path} holds ${show(bad)}; button names are non-empty strings`);
  return Object.freeze([...new Set(value as string[])].sort(byText));
}

/** A frozen copy of an n-number vector, or a problem. */
function vector(value: unknown, n: number, path: string, problems: string[]): readonly number[] | undefined {
  if (Array.isArray(value) && value.length === n && value.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return Object.freeze([...(value as number[])]);
  }
  problems.push(`${path} is ${show(value)}; it must be ${n} finite numbers`);
  return undefined;
}

/**
 * Checks `raw` and returns the step's intents: frozen, keys in order (built-ins, then custom keys sorted), buttons
 * sorted, `p` widened by the edges of `b` since `previous` (the step before; none at the start). Throws
 * `INPUT_BAD_INTENTS` listing every problem. `null` and `undefined` values mean "not given".
 */
export function normalizeIntents(raw: unknown = {}, previous: Intents = NO_INTENTS, where = 'intents'): Intents {
  if (raw === null || !isPlainObject(raw)) {
    throw codeError('INPUT_BAD_INTENTS', { where, problems: `they are ${show(raw)}; intents are an object` });
  }
  const problems: string[] = [];
  const out: Record<string, unknown> = {};
  const custom: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    if (Object.hasOwn(INTENT_KEYS, key)) continue;
    if (CUSTOM.test(key)) custom.push(key);
    else
      problems.push(
        `unknown key ${show(key)}${didYouMean(key, Object.keys(INTENT_KEYS))} (custom keys are namespaced: "${customKey(key)}")`,
      );
  }
  for (const key of Object.keys(INTENT_KEYS) as IntentKey[]) {
    const value = raw[key];
    if (value === null || value === undefined || key === 'p') continue;
    const n = VECTORS[key];
    if (n) out[key] = vector(value, n, key, problems);
    else if (key === 'b') out.b = buttons(value, key, problems);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else problems.push(`${key} is ${show(value)}; it must be a finite number`);
  }
  const given = raw.p === null || raw.p === undefined ? [] : (buttons(raw.p, 'p', problems) ?? []);
  for (const key of custom.sort(byText)) out[key] = plainData(raw[key], key, problems);
  if (problems.length) throw codeError('INPUT_BAD_INTENTS', { where, problems: problems.join('; ') });
  const held = (out.b as readonly string[] | undefined) ?? [];
  if (!held.length) delete out.b;
  const before = new Set(previous.b ?? []);
  const presses = [...new Set([...given, ...held.filter((name) => !before.has(name))])].sort(byText);
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(out)) if (!CUSTOM.test(key) && out[key] !== undefined) ordered[key] = out[key];
  if (presses.length) ordered.p = Object.freeze(presses);
  for (const key of custom) ordered[key] = out[key];
  return Object.freeze(ordered) as Intents;
}

/** Whether `button` is held this step. */
export function held(intents: Intents, button: string): boolean {
  return intents.b?.includes(button) ?? false;
}

/** Whether `button` was pressed this step: it went down (or was tapped) since the step before. */
export function pressed(intents: Intents, button: string): boolean {
  return intents.p?.includes(button) ?? false;
}

/**
 * Turns a stick or keys into a world-space move, so pushing forward walks away from the camera: `axes` is `[right,
 * forward]` (W is `[0, 1]`, D is `[1, 0]`) and `yaw` the camera heading. Longer than 1 (two keys at once) is scaled
 * to length 1; shorter stays as it is, so a half-pushed stick walks. Returns `[x, z]`: forward(yaw) · forward axis +
 * right(yaw) · right axis, where forward(ψ) = (sin ψ, cos ψ) and right(ψ) = (−cos ψ, sin ψ) on the XZ plane (§6.3).
 */
export function fromCamera(yaw: number, axes: readonly [number, number]): [number, number] {
  const [right, forward] = axes;
  const length = Math.sqrt(right * right + forward * forward);
  const k = length > 1 ? 1 / length : 1;
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return [k * (forward * s - right * c), k * (forward * c + right * s)];
}

/** Whether two intent values are equal, numbers by `Object.is` (so `-0` differs from `0`). */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => key in b && same(a[key], b[key]));
  }
  return false;
}

/**
 * The change-point from `prev` to `next` (both normalized, `prev` the step before): each held key whose value
 * changed, `null` for one that went away, and `p` only for presses the edges of `b` do not explain. `{}` when the
 * step repeats the one before.
 */
export function diffIntents(prev: Intents, next: Intents): IntentChanges {
  const out: Record<string, unknown> = {};
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(next)])].filter((key) => key !== 'p');
  for (const key of keys.sort(byText)) {
    const before = (prev as Record<string, unknown>)[key];
    const after = (next as Record<string, unknown>)[key];
    if (!same(before, after)) out[key] = after === undefined ? null : after;
  }
  const before = new Set(prev.b ?? []);
  const edges = new Set((next.b ?? []).filter((name) => !before.has(name)));
  const taps = (next.p ?? []).filter((name) => !edges.has(name));
  if (taps.length) out.p = taps;
  return out as IntentChanges;
}

/**
 * The next step's intents: `prev`'s held keys with `change` applied (`null` clears a key), then normalized with `prev`
 * as the step before, so `p` is the change's presses plus the new edges of `b`. Throws `INPUT_BAD_INTENTS`.
 */
export function applyIntents(prev: Intents, change: IntentChanges, where = 'intents'): Intents {
  const raw: Record<string, unknown> = { ...prev, p: undefined };
  for (const [key, value] of Object.entries(change)) raw[key] = value;
  return normalizeIntents(raw, prev, where);
}
