/**
 * @file The names a humanoid takes (PLAN.md WP 3.6, §5.2; I-09): its held poses (`POSES`), its stances (`STANCES`) and
 * what its right hand holds (`WEAPONS`, by the direction its blade rests in), each with what it shows, and
 * `poseName`, `stanceName` and `weaponName`, which pass a known name and warn `ANIM_UNKNOWN_POSE` once for an unknown
 * one, suggesting the closest. engine/anim/poses.ts lays them over the gait. Split from poses.ts at its line cap.
 *
 * Invariants: `die` and `down` are reactions, laid by the humanoid (humanoid.ts), not by a layer; a weapon's blade is
 * `[forward, right, up]`, normalised when used; a warning goes through the engine's log, once per name.
 *
 * @example
 * import { createLog } from '../core/log';
 * const quiet = createLog({ console: { warn: () => {}, error: () => {} } });
 * poseName('cheer'); // 'cheer'
 * poseName('cheeer', quiet); // undefined, and quiet.advice[0].message ends '(did you mean "cheer"?); it is ignored'
 * @see engine/anim/poses.test.ts
 */
import { defineCodes, didYouMean, log, type Log } from '../core/log';
import type { FRU } from './authoring';

/** The codes this module raises, with their fixes. */
export const POSE_CODES = defineCodes('anim', {
  ANIM_UNKNOWN_POSE: {
    template: '{name} is not a humanoid {what}{suggestion}; it is ignored',
    fix: 'use one of: {names}',
    doc: 'Raised once per name by the humanoid (engine/anim/humanoid.ts) for a `pose`, `stance` or `weapon` it does not know. The message names the closest names; `POSES`, `STANCES` and `WEAPONS` (engine/anim/poseNames.ts) list them all. An unknown weapon holds nothing.',
  },
});

/** The held poses, each with what it shows. `die` and `down` are reactions: they knock the body flat. */
export const POSES = {
  cheer: 'Both fists pumping above the head (an item found, a victory).',
  cast: 'Both hands thrust forward.',
  guard: "A boxer's guard: fists up by the chin, knees bent, feet apart.",
  kneel: 'Down on the right knee.',
  crouch: 'Crouched low, feet wide.',
  wave: 'The free hand waves: the left when the right holds a weapon.',
  hips: 'Hands on the hips.',
  block: 'The weapon upright across the body, both hands on it.',
  die: 'A stagger, the knees give, then the body topples onto its back and stays down.',
  down: 'Knocked flat onto the back; it gets up when the pose ends.',
} as const;

/** A pose's name. */
export type PoseName = keyof typeof POSES;

/** The stances, held while moving. */
export const STANCES = {
  guard: 'Fists up while moving.',
  ready: 'The weapon held forward in both hands (with a weapon).',
} as const;

/** A stance's name. */
export type StanceName = keyof typeof STANCES;

/** What the right hand holds, by the direction its blade rests in: `[forward, right, up]`, normalised when used. */
export const WEAPONS = {
  /** Nothing: the hands are fists (the knuckle line rests as a sword's would). */
  none: [0.55, 0.35, -0.75],
  /** A blade held low, pointing forward, out and down. */
  sword: [0.55, 0.35, -0.75],
  /** A gun held low, muzzle forward and down. */
  gun: [0.8, 0, -0.6],
  /** A staff held upright, leaning forward. */
  staff: [0.3, 0.15, 1],
} as const satisfies Record<string, FRU>;

/** A weapon's name. */
export type Weapon = keyof typeof WEAPONS;

/** Returns `name` when `table` has it; otherwise warns `ANIM_UNKNOWN_POSE` once for it and returns undefined. */
function known<T extends string>(table: object, name: string | undefined, what: string, to: Log): T | undefined {
  if (name === undefined || Object.hasOwn(table, name)) return name as T | undefined;
  const names = Object.keys(table);
  const values = { name: JSON.stringify(name), what, suggestion: didYouMean(String(name), names) };
  to.warnOnce('ANIM_UNKNOWN_POSE', { ...values, names: names.join(', ') }, `${what}:${name}`);
  return undefined;
}

/** `name` if it is a pose; otherwise warns once, suggesting the closest, and returns undefined. */
export function poseName(name: string | undefined, to: Log = log): PoseName | undefined {
  return known<PoseName>(POSES, name, 'pose', to);
}

/** `name` if it is a stance; otherwise warns once, suggesting the closest, and returns undefined. */
export function stanceName(name: string | undefined, to: Log = log): StanceName | undefined {
  return known<StanceName>(STANCES, name, 'stance', to);
}

/** `name` if it is a weapon; otherwise warns once, suggesting the closest, and returns undefined. */
export function weaponName(name: string | undefined, to: Log = log): Weapon | undefined {
  return known<Weapon>(WEAPONS, name, 'weapon', to);
}
