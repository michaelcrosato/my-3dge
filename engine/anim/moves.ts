/**
 * @file Moves on a body (PLAN.md WP 6.1, §6.4; I-10): what game code does with a move beside playing it. A humanoid
 * plays a move told as its body state `body` (engine/anim/humanoid.ts, through the arm path of strike.ts): `moveAt`
 * names a move at a moment (previews, sheets, cutscenes); `measureMove` measures where its strike reaches on a spare
 * body (`HitShape`); `strikePart` and `strikeSegment` say what strikes and where it spans; `inArc`, `inHitShape` and
 * `knockbackVelocity` are the hit helpers. Attacks and combos play moves over time (engine/anim/timeline.ts).
 *
 * Invariants:
 * - `measureMove` runs under the sim's math (engine/core/simMath.ts) and caches by what it measured (the move's fields,
 *   the build's, the weapon), so a changed move or build is measured again and the same bits come back everywhere.
 * - `strikeSegment` reads a pose, so it takes an animator only with `preciseHits`, whose pose the sim makes
 *   (`ANIM_NOT_PRECISE` otherwise): a hit never depends on what the view drew.
 * - Pure helpers otherwise: no clock, no random stream, no state.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:2574-2582` (`E.move`, `E.knockback`), `:194` (`inArc`) and
 * `src/emberdeep/30-monsters-core.js:31-41` (`measureAttacks`: the mechanism, measured on a spare rig).
 *
 * @example
 * import { Vector3 } from '../core/math';
 * import { Humanoid } from './humanoid';
 * const hero = new Humanoid({ build: 'build:heroic', weapon: 'sword', clock: 0 });
 * for (let i = 0; i < 10; i++) hero.update({ body: moveAt('slash', i / 10, 'active') });
 * hero.state.arm.weight; // 1: the arm follows the swing
 * measureMove('thrust', { build: 'build:heroic', weapon: 'sword' }).range; // ≈ 1.69 m: the blade's tip at its farthest
 * inArc(new Vector3(), 0, new Vector3(0, 0, 1), 1.5, 0.5); // true: 1 m straight ahead
 * @see engine/anim/moves.test.ts
 */
import { codeError, defineCodes } from '../core/log';
import { angDiff, Quaternion, Vector3 } from '../core/math';
import { withSimMath } from '../core/simMath';
import { getBuild, type Build } from './builds';
import { TRAIL, type Animator } from './character';
import { jointPosition, jointRotation, socketPosition } from './fk';
import { Humanoid } from './humanoid';
import { resolveMove, type Move, type MoveInput, type MovePhase, type MoveSpec } from './moves-data';
import type { Weapon } from './poses';
import type { TrailName } from './states';

/** The codes this module raises, with their fixes. */
export const MOVE_CODES = defineCodes('anim', {
  ANIM_NOT_PRECISE: {
    template: 'strikeSegment was given an animator without preciseHits: its pose is the view’s, not the sim’s',
    fix: 'make the animator (an actor’s anim) with preciseHits: true, so the sim poses it every tick; or pass a Humanoid the sim updates itself',
    doc: 'Thrown by `strikeSegment` (engine/anim/moves.ts) for an `Animator` without `preciseHits`. A strike’s span is read from a pose, and the sim poses only animators with `preciseHits` (engine/sim/actors.ts, the system `actors.pose`); any other animator holds whatever the view last drew, nothing headless, so hits read from it would depend on rendering and visibility.',
  },
});

/** Scratch objects. */
const [at, start, sweep] = Array.from({ length: 3 }, () => new Vector3());
const turn = new Quaternion();

/** Move `name` at share `u` of `phase`: what a body is told for a preview, a sheet or a cutscene. */
export function moveAt(name: string | Move | MoveSpec, u = 0.5, phase: MovePhase = 'active'): MoveInput {
  return { move: resolveMove(name), phase, u };
}

/** The part of a body that strikes in `move`: the right foot, the left fist, a held weapon's blade, or the right fist. */
export function strikePart(move: Move, armed: boolean): TrailName {
  if (move.limb === 'footR') return 'kick';
  if (move.hand === 'L') return 'fistL';
  return armed && move.trail ? 'blade' : 'fistR';
}

/** What `strikeSegment` reads of a body. */
export type StrikeBody = Pick<Humanoid, 'skeleton' | 'world' | 'build' | 'weapon'>;

/** What `strikeSegment` reads of an animator: its body, which the sim poses only with `preciseHits`. */
export type StrikeAnimator = Pick<Animator, 'body' | 'preciseHits'>;

/**
 * Where `part` spans on a body's pose now, world metres, into `base` and `tip`: a sword from near the grip to its tip
 * (another weapon strikes as the right fist), a forearm from the elbow to the wrist, the right shin from the knee to
 * the sole. The span the animator's trail samples (engine/anim/character.ts).
 *
 * It reads the pose, so sim code (a gameplay hit, `Attack.sweep`) reads it only from a pose the sim made: pass the
 * `Animator` itself, made with `preciseHits` (the sim poses it every tick; without it this throws `ANIM_NOT_PRECISE`),
 * or a spare `Humanoid` the sim updates itself. An animator's `body` otherwise holds the view's pose (none headless),
 * and play would depend on what was drawn.
 */
export function strikeSegment(from: StrikeBody | StrikeAnimator, part: TrailName, base: Vector3, tip: Vector3): void {
  if ('preciseHits' in from && !from.preciseHits) throw codeError('ANIM_NOT_PRECISE');
  const { skeleton, world, build, weapon } = 'preciseHits' in from ? from.body : from;
  if (part === 'blade' && weapon === 'sword') {
    socketPosition(skeleton, world, 'weaponR', base);
    sweep.set(0, 0, build.size).applyQuaternion(jointRotation(world, 'handR', turn));
    tip.copy(base).addScaledVector(sweep, TRAIL.bladeTip);
    base.addScaledVector(sweep, TRAIL.bladeBase);
    return;
  }
  if (part === 'kick') {
    jointPosition(world, 'shinR', base);
    socketPosition(skeleton, world, 'contactR', tip);
    return;
  }
  const side = part === 'fistL' ? 'L' : 'R';
  jointPosition(world, `forearm${side}`, base);
  jointPosition(world, `hand${side}`, tip);
}

/** Where a strike can connect, around its body, which faces +Z standing at the origin: metres and radians. */
export interface HitShape {
  /** The farthest the strike point reaches, horizontally from the body's position. */
  readonly range: number;
  /** The widest angle it reaches either side of the facing. */
  readonly halfAngle: number;
  /** The lowest and highest it reaches, above the ground. */
  readonly yMin: number;
  readonly yMax: number;
}

/** Hit shapes measured so far, by what they were measured from. */
const measured = new Map<string, HitShape>();
/** The most hit shapes kept; past it the cache starts again. */
const MEASURED_MAX = 256;
/** Share of the hit window between measured samples. */
const MEASURE_STEP = 0.05;
/** The cone's angle and heights come from samples at least this share of the range out (not overhead or close in). */
const MEASURE_OUT = 0.5;

/**
 * Measures where `move`'s strike point (the blade's tip, the fist, the foot's sole) goes through its hit window, on a
 * spare body of `options.build` holding `options.weapon` (`build:chibi` with a sword by default): the hit cone and
 * height window to test targets against (`inHitShape`). The range is the farthest it gets; the angle and the heights
 * are where it gets at least half that far, so a blade passing overhead or close by does not widen the cone. Cached
 * by the move's, the build's and the weapon's fields, so changing any of them measures again.
 */
export function measureMove(
  move: string | Move | MoveSpec,
  options: { build?: Build | string; weapon?: Weapon } = {},
): HitShape {
  const m = resolveMove(move);
  const build = typeof options.build === 'object' ? options.build : getBuild(options.build ?? 'build:chibi');
  const weapon = options.weapon ?? 'sword';
  const key = JSON.stringify([m, build, weapon]);
  const known = measured.get(key);
  if (known) return known;
  const shape = withSimMath(() => {
    const rig = new Humanoid({ build, weapon, clock: 0, dt: 1 });
    const part = strikePart(m, weapon !== 'none');
    const samples: [distance: number, angle: number, y: number][] = []; // the angle unwrapped along the swing
    const steps = Math.max(1, Math.ceil((1 - m.hitAt) / MEASURE_STEP));
    for (let i = 0; i <= steps; i++) {
      rig.update({ body: { move: m, phase: 'active', u: m.hitAt + ((1 - m.hitAt) * i) / steps } });
      strikeSegment(rig, part, start, at);
      const angle = Math.atan2(at.x, at.z);
      const last = samples.at(-1)?.[1];
      samples.push([Math.hypot(at.x, at.z), last === undefined ? angle : last + angDiff(last, angle), at.y]);
    }
    const range = Math.max(...samples.map(([d]) => d));
    const out = samples.filter(([d]) => d >= range * MEASURE_OUT);
    const ys = out.map(([, , y]) => y);
    const halfAngle = Math.min(Math.PI, Math.max(...out.map(([, a]) => Math.abs(a))));
    return Object.freeze({ range, halfAngle, yMin: Math.min(...ys), yMax: Math.max(...ys) });
  });
  if (measured.size >= MEASURED_MAX) measured.clear();
  measured.set(key, shape);
  return shape;
}

/**
 * Whether `target` (plus `radius`) is within `range` of `from` on the ground plane and within `halfAngle` of the
 * facing `yaw` (forward is (sin yaw, 0, cos yaw)). Heights are ignored; `inHitShape` adds them.
 */
export function inArc(
  from: Vector3,
  yaw: number,
  target: Vector3,
  range: number,
  halfAngle: number,
  radius = 0,
): boolean {
  const [dx, dz] = [target.x - from.x, target.z - from.z];
  return Math.hypot(dx, dz) <= range + radius && Math.abs(angDiff(yaw, Math.atan2(dx, dz))) <= halfAngle;
}

/** `inArc` with `shape`'s range and half angle, scaled by `size`, and its height window (± `radius`) above `from`. */
export function inHitShape(
  from: Vector3,
  yaw: number,
  shape: HitShape,
  target: Vector3,
  radius = 0,
  size = 1,
): boolean {
  const dy = target.y - from.y;
  if (dy < shape.yMin * size - radius || dy > shape.yMax * size + radius) return false;
  return inArc(from, yaw, target, shape.range * size, shape.halfAngle, radius);
}

/**
 * The velocity a hit gives `target` away from `from`: `speed` m/s along the ground, plus `up` m/s upward, into `out`
 * (nothing along the ground when they stand on the same spot). It only computes the velocity: the receiver adds it
 * to its own (a crowd agent through engine/physics/crowd.ts `knockback`, which applies one).
 */
export function knockbackVelocity(from: Vector3, target: Vector3, speed: number, up = 0, out = new Vector3()): Vector3 {
  const [dx, dz] = [target.x - from.x, target.z - from.z];
  const d = Math.hypot(dx, dz) || 1;
  return out.set((dx / d) * speed, up, (dz / d) * speed);
}
