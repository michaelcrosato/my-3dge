/**
 * @file Projectile patterns (PLAN.md WP 10.4, §5.8; doctrine: Reproducible): which ways a volley flies and when an
 * emitter looses one, over WP 6.3's shots (engine/world/projectiles.ts), as shooters and bullet-hell games write them.
 * An emitter is plain data in a component (`SHOT_EMITTER_FIELDS`):
 * - **Volleys** (`volley`): `count` unit directions round a heading, `pitch` above the ground (headings as the sim's:
 *   0 along +Z, forward (sin yaw, 0, cos yaw)): `aimed` at a target, its heading and rise from the emitter, fanned
 *   across `spread`; `forward` along the emitter's facing, fanned the same; `ring`, `count` round the full turn from
 *   the facing turned by `turn`; `spiral`, a ring whose `turn` grows by `spin` each volley; `random`, `count` within
 *   the spread, each drawn from the stream the caller names (`rng`).
 * - **Timing** (`stepVolleys`): nothing until its target has been within `range` for `delay` seconds; then a volley at
 *   once and one each `interval` after, `pause` more after every `burst` volleys; out of range its clock waits at the
 *   delay, so it fires again an interval after he comes back.
 * - **Shots** (`loose`): a volley's projectiles, `muzzle` metres out from the emitter along each direction, at `speed`,
 *   with its `radius`, `life`, `gravity`, `pierce`, `kind` and `team`: the scene keeps each in a component and steps
 *   them with `stepProjectiles`, which sweeps their whole move, so no pattern's shot tunnels (patterns.test.ts fires
 *   each through thin posts at 60 m/s).
 *
 * Invariants: pure: a volley depends only on the emitter's fields, the headings and the numbers of the stream given
 * (`random` draws `count`, nothing else draws); an emitter's state is its fields, so the hash and captures cover it;
 * `Math.sin`, `Math.cos` and `Math.atan2` by name (the sim's math swap reaches them). Problems raise `CORE_BAD_SPEC`.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3607-3625` (`E.pattern`: `dir`, `aim`, `spread` across an arc, `ring`
 * with an offset), moved to 3D, and shardfall@fa2dab6 `crates/pav_core/src/behaviors.rs:77-92, 189-241` (its emitter:
 * aimed, forward, ring, spiral and random volleys, a burst's pause, the delay, the range, the muzzle 0.3 m out), in SI
 * with headings in radians.
 *
 * @example
 * const fan = { ...SHOT_EMITTER, pattern: 'forward', count: 3, spread: Math.PI / 2 } as const;
 * volley(fan, 0).map(([x, , z]) => Math.round(Math.atan2(x, z) * 180 / Math.PI)); // [-45, 0, 45]
 * const turret = { ...SHOT_EMITTER, interval: 0.5, burst: 3, pause: 1 };
 * [stepVolleys(turret, 0.1, true), stepVolleys(turret, 0.5, true)]; // [1, 1]: a volley at once, the next 0.5 s on
 * loose(turret, { x: 0, y: 1, z: 0 }, 0)[0].z; // 0.3: out of the muzzle, flying along +Z at 20 m/s
 * @see engine/world/patterns.test.ts
 */
import { codeError } from '../core/log';
import type { Rng } from '../core/rng';
import { copyValue, defineSchema, freezeValue } from '../core/schema';
import { PROJECTILE, PROJECTILE_FIELDS, type Projectile } from './projectiles';
import type { SteerPoint } from './steer';

/** The ways a volley flies (see the file comment). */
export const PATTERNS = ['aimed', 'forward', 'ring', 'spiral', 'random'] as const;
/** One of `PATTERNS`. */
export type Pattern = (typeof PATTERNS)[number];

/** The most volleys an emitter looses in one step, however short its interval: a runaway one never floods a step. */
export const MOST_VOLLEYS = 8;

/** A shot emitter's fields, for a scene's component: `defineComponent('turret', { fields: SHOT_EMITTER_FIELDS })`. */
export const SHOT_EMITTER_FIELDS = defineSchema({
  pattern: { type: 'string', enum: [...PATTERNS], default: 'forward', description: 'How a volley flies: aimed, forward, ring, spiral or random.' }, // prettier-ignore
  count: { type: 'integer', default: 1, minimum: 1, maximum: 360, description: 'Shots in a volley.' },
  spread: { type: 'number', default: 0, minimum: 0, maximum: 2 * Math.PI, unit: 'rad', description: 'The arc an aimed or forward fan spans, and a random volley’s.' }, // prettier-ignore
  spin: { type: 'number', default: 0, unit: 'rad', description: 'How far a spiral turns on each volley.' },
  turn: { type: 'number', default: 0, unit: 'rad', description: 'A ring’s or a spiral’s turn from the facing (a spiral’s grows).' }, // prettier-ignore
  pitch: { type: 'number', default: 0, minimum: -Math.PI / 2, maximum: Math.PI / 2, unit: 'rad', description: 'How far above the ground a volley rises (aimed: above the line to the target).' }, // prettier-ignore
  speed: { type: 'number', default: 20, minimum: 0, unit: 'm/s', description: 'How fast its shots fly.' },
  muzzle: { type: 'number', default: 0.3, minimum: 0, unit: 'm', description: 'How far out from its origin a shot starts.' }, // prettier-ignore
  radius: PROJECTILE_FIELDS.radius,
  life: PROJECTILE_FIELDS.life,
  gravity: PROJECTILE_FIELDS.gravity,
  pierce: PROJECTILE_FIELDS.pierce,
  kind: PROJECTILE_FIELDS.kind,
  team: PROJECTILE_FIELDS.team,
  delay: { type: 'number', default: 0, minimum: 0, unit: 's', description: 'How long its target must be in range before the first volley.' }, // prettier-ignore
  interval: { type: 'number', default: 0.5, minimum: 0.001, unit: 's', description: 'The time from one volley to the next.' }, // prettier-ignore
  burst: { type: 'integer', default: 0, minimum: 0, description: 'Volleys in a burst before its pause (0: no bursts).' }, // prettier-ignore
  pause: { type: 'number', default: 0, minimum: 0, unit: 's', description: 'The rest after each burst, beyond the interval.' }, // prettier-ignore
  range: { type: 'number', default: 1000, minimum: 0, unit: 'm', description: 'How near its target must be for it to fire.' }, // prettier-ignore
  clock: { type: 'number', default: 0, minimum: 0, unit: 's', description: 'Its clock: time in range, held at the delay out of it.' }, // prettier-ignore
  volleys: { type: 'integer', default: 0, minimum: 0, description: 'Volleys loosed so far.' },
});

/** An emitter: its pattern, its shots' numbers and its timing (`SHOT_EMITTER_FIELDS` says what each means). */
export interface ShotEmitter {
  pattern: Pattern;
  count: number;
  spread: number;
  spin: number;
  turn: number;
  pitch: number;
  speed: number;
  muzzle: number;
  radius: number;
  life: number;
  gravity: number;
  pierce: number;
  kind: string;
  team: string;
  delay: number;
  interval: number;
  burst: number;
  pause: number;
  range: number;
  clock: number;
  volleys: number;
}

/** An emitter with every field at its default: one shot forward at 20 m/s every half second, from the first step. */
export const SHOT_EMITTER: Readonly<ShotEmitter> = freezeValue(
  Object.fromEntries(Object.entries(SHOT_EMITTER_FIELDS).map(([key, field]) => [key, copyValue(field.default)])) as unknown as ShotEmitter, // prettier-ignore
);

/** What a volley aims by besides the emitter's facing: where it stands, its target, the stream `random` draws from. */
export interface VolleyAim {
  /** Where the emitter's shots start from (m): an aimed volley's heading and rise are from here. */
  readonly from?: SteerPoint;
  /** What an aimed volley aims at (m); without one it flies along the facing. */
  readonly target?: SteerPoint | null;
  /** The stream a random volley draws from (`w.rng('<stream>')`); a random volley needs one. */
  readonly rng?: Pick<Rng, 'next'>;
}

/** The unit direction of a heading (rad, 0 along +Z) and a rise above the ground (rad). */
export function direction(yaw: number, pitch = 0): [number, number, number] {
  const flat = Math.cos(pitch);
  return [Math.sin(yaw) * flat, Math.sin(pitch), Math.cos(yaw) * flat];
}

/** The heading and rise (rad) from `from` to `to`; straight up or down, or onto itself, heads along +Z. */
export function headingTo(from: SteerPoint, to: SteerPoint): [number, number] {
  const [dx, dy, dz] = [to.x - from.x, to.y - from.y, to.z - from.z];
  const flat = Math.hypot(dx, dz);
  return [flat > 1e-9 ? Math.atan2(dx, dz) : 0, Math.atan2(dy, flat)];
}

/** Throws `CORE_BAD_SPEC` for `where` unless `ok`. */
function need(ok: boolean, where: string, value: unknown, expected: string): void {
  if (!ok) throw codeError('CORE_BAD_SPEC', { where, problems: `${String(value)}: give ${expected}` });
}

/**
 * A volley's directions, unit vectors in firing order (see the file comment), the emitter facing `facing` (rad).
 * Changes nothing: `loose` turns a spiral on. Throws `CORE_BAD_SPEC` for a random volley without a stream.
 */
export function volley(
  emitter: Readonly<ShotEmitter>,
  facing: number,
  aim: VolleyAim = {},
): [number, number, number][] {
  const { pattern, count, spread, pitch } = emitter;
  need(PATTERNS.includes(pattern), 'volley(emitter.pattern)', pattern, `one of ${PATTERNS.join(', ')}`);
  need(Number.isInteger(count) && count >= 1, 'volley(emitter.count)', count, 'a whole number of shots, 1 or more');
  const aimed = pattern === 'aimed' && aim.target && aim.from ? headingTo(aim.from, aim.target) : [facing, 0];
  const [yaw, rise] = [aimed[0], aimed[1] + pitch];
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    if (pattern === 'ring' || pattern === 'spiral') {
      out.push(direction(yaw + emitter.turn + (2 * Math.PI * i) / count, rise));
    } else if (pattern === 'random') {
      need(aim.rng !== undefined, 'volley(aim.rng)', 'none', "the stream a random volley draws from: { rng: w.rng('turret') }"); // prettier-ignore
      out.push(direction(yaw + (aim.rng!.next() - 0.5) * spread, rise));
    } else out.push(direction(yaw + (count < 2 ? 0 : (i / (count - 1) - 0.5) * spread), rise));
  }
  return out;
}

/**
 * Moves an emitter's clock on by `dt` seconds, its target within range or not (`near`), and returns how many volleys
 * it looses now (see the file comment): 0 or more, at most `MOST_VOLLEYS`.
 */
export function stepVolleys(emitter: ShotEmitter, dt: number, near: boolean): number {
  need(Number.isFinite(dt) && dt >= 0, 'stepVolleys(dt)', dt, 'a step of 0 seconds or more');
  if (!near) {
    emitter.clock = Math.min(emitter.clock, emitter.delay);
    return 0;
  }
  emitter.clock += dt;
  let loosed = 0;
  while (loosed < MOST_VOLLEYS) {
    const { burst, volleys, interval, pause, delay } = emitter;
    const rest = burst > 0 && volleys > 0 && volleys % burst === 0 ? pause : 0;
    const gap = volleys > 0 ? interval + rest : 0;
    if (emitter.clock < delay + gap - 1e-9) break;
    emitter.clock -= gap; // the overshoot kept: its rhythm holds whatever the step
    emitter.volleys++;
    loosed++;
  }
  return loosed;
}

/** Who looses a volley: its entity, which its shots keep as their `source` (−1: none). */
export interface LooseOptions extends VolleyAim {
  readonly source?: number;
}

/**
 * The shots of one volley from `from` (m), the emitter facing `facing` (rad): `PROJECTILE`s `muzzle` out along each
 * direction at `speed`, with the emitter's radius, life, gravity, pierce, kind and team. A spiral turns on by `spin`.
 */
export function loose(
  emitter: ShotEmitter,
  from: SteerPoint,
  facing: number,
  options: LooseOptions = {},
): Projectile[] {
  const dirs = volley(emitter, facing, { from, ...options });
  if (emitter.pattern === 'spiral') emitter.turn = (emitter.turn + emitter.spin) % (2 * Math.PI);
  const { muzzle, speed, radius, life, gravity, pierce, kind, team } = emitter;
  return dirs.map(([dx, dy, dz]) => ({
    ...(copyValue(PROJECTILE) as Projectile),
    ...{ kind, team, source: options.source ?? -1, radius, life, gravity, pierce },
    ...{ x: from.x + dx * muzzle, y: from.y + dy * muzzle, z: from.z + dz * muzzle },
    ...{ vx: dx * speed, vy: dy * speed, vz: dz * speed },
  }));
}
