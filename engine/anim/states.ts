/**
 * @file The body-state vocabulary (PLAN.md WP 3.7, §4.6; I-09): the words a body is told each step, kept distinct
 * from input intents (what a player or an AI wants): where it is and how it moves, whether it dashes, flinches or is
 * airborne, the pose or stance it holds, the move it plays, the part that leaves a trail. `BODY_STATES` gives each
 * word the kind of value it takes; `checkBodyStates` warns once for a word outside the vocabulary, naming the closest
 * (`ANIM_UNKNOWN_STATE`), and once for a value of the wrong kind (`ANIM_BAD_STATE`), and drops both. `SAMPLE_STATES`
 * are named body states (idle, run, dodge…) with how long each is held, for tests, sheets and rig checks.
 *
 * Invariants:
 * - Any behaviour runs on any body: a body reads the words it knows and ignores the others without a warning; only a
 *   word outside the vocabulary (a typo) warns. The humanoid (engine/anim/humanoid.ts) reads every word but `trail`,
 *   which the animator samples (engine/anim/character.ts).
 * - `BODY_STATES` has exactly the keys of `AnimatorInput` (the compiler checks), so the vocabulary and what bodies
 *   read cannot drift. Pose and stance names are the body's to check (the humanoid's `ANIM_UNKNOWN_POSE`).
 * - Pure: no clock, no random stream; the warnings go through the given log, once per word.
 *
 * Carried from `my-3d2dge:src/emberdeep/18-characters.js:36-38` (the state bag a body's `update(dt, s)` takes, unknown
 * keys ignored) and `:82-88` (`CHAR_STATES`, as `SAMPLE_STATES` in metres, the three moves told as `body`, WP 6.1);
 * `src/emberdeep/33-beasts.js:1053-1060` reads the same words on a body that is not a humanoid.
 *
 * @example
 * import { createLog } from '../core/log';
 * const quiet = createLog({ console: { warn: () => {}, error: () => {} } });
 * checkBodyStates({ pose: 'cheer', dash: true }); // the same object: every word passes
 * checkBodyStates({ psoe: 'cheer' }, quiet); // {}, and quiet.advice[0].message is '"psoe" is not a body state (did you mean "pose"?); it is ignored'
 * checkBodyStates({ dash: 1 }, quiet); // {}: ANIM_BAD_STATE, dash takes true or false
 * SAMPLE_STATES.dodge.seconds; // 0.15
 * @see engine/anim/states.test.ts
 */
import { defineCodes, didYouMean, log as engineLog, type Log } from '../core/log';
import { Vector3 } from '../core/math';
import { isPlainObject, show } from '../core/schema';
import type { HumanoidInput } from './humanoid';

/** The codes this module raises, with their fixes. */
export const STATE_CODES = defineCodes('anim', {
  ANIM_UNKNOWN_STATE: {
    template: '{name} is not a body state{suggestion}; it is ignored',
    fix: 'use one of: {names}',
    doc: 'Raised once per word by the animator (engine/anim/character.ts `step`, through `checkBodyStates`) for a body state outside the vocabulary, usually a typo. The message names the closest words; `BODY_STATES` (engine/anim/states.ts) lists them all.',
  },
  ANIM_BAD_STATE: {
    template: 'body state {name} is {value}, not {expected}{suggestion}; it is ignored',
    fix: 'give {name} {expected}',
    doc: 'Raised once per word by the animator (engine/anim/character.ts `step`, through `checkBodyStates`) for a body state whose value is of the wrong kind: a number for `dash`, a trail that does not exist. `BODY_STATES` (engine/anim/states.ts) gives each word its kind. Raised once too by a humanoid playing a move told in `body` (engine/anim/strike.ts `stepArm`) whose phase is not wind, active or recover, or whose share `u` is not finite: data or the console, which TypeScript does not check; the move does not play.',
  },
});

/** The parts that leave a trail, each with the span its ribbon covers. */
export const TRAILS = {
  blade: 'The sword, from near the grip to its tip; another weapon or none trails as `fistR`.',
  fistR: 'The right forearm, elbow to wrist.',
  fistL: 'The left forearm, elbow to wrist.',
  kick: 'The right shin, knee to sole.',
} as const;

/** A part that leaves a trail. */
export type TrailName = keyof typeof TRAILS;

/** What a body is told each step: the humanoid's words and the trail. Every word is optional. */
export interface AnimatorInput extends HumanoidInput {
  /** The part that leaves a trail this step (a move's strike sets it, WP 6.1); none when absent. */
  trail?: TrailName;
}

/** The kind of value a body state takes; a `name` is checked by the body that reads it. */
export type StateKind = 'number' | 'boolean' | 'vector' | 'object' | 'name' | 'trail';

/** Every body state and the kind of value it takes (`AnimatorInput` documents each word). */
export const BODY_STATES = {
  position: 'vector',
  velocity: 'vector',
  yaw: 'number',
  run: 'number',
  dash: 'boolean',
  hurt: 'boolean',
  air: 'boolean',
  climb: 'boolean',
  point: 'boolean',
  aim: 'number',
  pose: 'name',
  stance: 'name',
  down: 'number',
  body: 'object',
  trail: 'trail',
} as const satisfies { readonly [K in keyof Required<AnimatorInput>]: StateKind };

/** A body state's name. */
export type BodyStateName = keyof typeof BODY_STATES;

/** What a kind's value must be, as a message says it. */
const EXPECTED: Readonly<Record<StateKind, string>> = {
  number: 'a finite number',
  boolean: 'true or false',
  vector: 'a Vector3',
  object: 'an object',
  name: 'a name',
  trail: `one of ${Object.keys(TRAILS).join(', ')}`,
};

/** Whether `value` is of kind `kind`. */
function fits(kind: StateKind, value: unknown): boolean {
  switch (kind) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'vector':
      return value instanceof Vector3 && [value.x, value.y, value.z].every(Number.isFinite);
    case 'object':
      return isPlainObject(value);
    case 'name':
      return typeof value === 'string';
    case 'trail':
      return typeof value === 'string' && Object.hasOwn(TRAILS, value);
  }
}

/**
 * Checks `input`'s words against the vocabulary: warns once per word outside it (`ANIM_UNKNOWN_STATE`) and once per
 * word whose value is of the wrong kind (`ANIM_BAD_STATE`), adding each such word to `ignored`. Returns `input` itself
 * when every word passes, else a copy without the failing words. An `undefined` value is no word.
 */
export function checkBodyStates(input: AnimatorInput, to: Log = engineLog, ignored?: Set<string>): AnimatorInput {
  let out: Record<string, unknown> | undefined;
  const words = Object.keys(BODY_STATES);
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const kind = Object.hasOwn(BODY_STATES, name) ? BODY_STATES[name as BodyStateName] : undefined;
    if (kind && fits(kind, value)) continue;
    if (!kind) {
      const values = { name: JSON.stringify(name), suggestion: didYouMean(name, words), names: words.join(', ') };
      to.warnOnce('ANIM_UNKNOWN_STATE', values, `state:${name}`);
    } else {
      const suggestion = kind === 'trail' && typeof value === 'string' ? didYouMean(value, Object.keys(TRAILS)) : '';
      const values = { name, value: show(value), expected: EXPECTED[kind], suggestion };
      to.warnOnce('ANIM_BAD_STATE', values, `state:${name}`);
    }
    ignored?.add(name);
    out ??= { ...input };
    delete out[name];
  }
  return out ?? input;
}

/** A named body state and how long it is held, seconds: a body stepped through it shows it. */
export interface SampleState {
  readonly states: Readonly<AnimatorInput>;
  readonly seconds: number;
}

/**
 * Named body states, my-3d2dge's `CHAR_STATES` in metres (moving along +Z); the wind-up, the strike and the
 * follow-through are a slash told as `body` (WP 6.1, as `moveAt` names it).
 */
export const SAMPLE_STATES = {
  idle: { states: {}, seconds: 0.6 },
  run: { states: { run: 1 }, seconds: 0.6 },
  dodge: { states: { dash: true, velocity: new Vector3(0, 0, 13.75) }, seconds: 0.15 },
  jump: { states: { air: true, position: new Vector3(0, 0.625, 0) }, seconds: 0.3 },
  windUp: { states: { body: { move: 'move:slash', phase: 'wind', u: 0.8 } }, seconds: 0.2 },
  strike: { states: { body: { move: 'move:slash', phase: 'active', u: 0.5 } }, seconds: 0.2 },
  followThrough: { states: { body: { move: 'move:slash', phase: 'recover', u: 0.5 } }, seconds: 0.2 },
  cast: { states: { pose: 'cast' }, seconds: 0.5 },
  guard: { states: { stance: 'guard' }, seconds: 0.5 },
  hurt: { states: { hurt: true }, seconds: 0.2 },
  knockedDown: { states: { down: 1 }, seconds: 1 },
  death: { states: { pose: 'die' }, seconds: 2.2 },
  cheer: { states: { pose: 'cheer' }, seconds: 0.6 },
  wave: { states: { pose: 'wave' }, seconds: 0.6 },
} as const satisfies Readonly<Record<string, SampleState>>;

/** A sample state's name. */
export type SampleStateName = keyof typeof SAMPLE_STATES;
