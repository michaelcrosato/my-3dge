/**
 * @file The foot plant's stance locks (PLAN.md WP 13.10, the rule ADR-0009 amendment 8 asked for; ADR-0025 amendment
 * 10): `holdFoot` keeps a sole where it landed while its body says the foot stands (the humanoid's `stance()`: the
 * planted stride's contact window, engine/anim/locomotion/planted.ts), and lets it go over `FOOT_LOCK.release` once the
 * window ends, lifting as its animation lifts it, so a push-off never drags it along the floor (at once when its
 * animation took it up, but a toe-off in its stride on the level it held on: it eases out of a lock the body sped away
 * from). Standing still, a sole that strays from its animation steps back under the body, one foot at a time: at once
 * past `step` (a turn in place, a stop), and past `settle` once the animation has held the sole still for `settleTime`
 * (the feet coming back to rest after an action); the shorter the step, the quicker and lower. A lock rides along with
 * the ground's own velocity (a treadmill: the state matrix's run in place, engine/anim/stateMatrix.ts) and is dropped
 * at once when the body is put more than `carried` away (a teleport, a respawn). engine/anim/footPlant.ts runs it for
 * each foot.
 *
 * Invariants: a lock reads only its own and the other foot's lock and what it is told; nothing reads a clock or a
 * stream; a held foot moves only with the treadmill or in a step.
 *
 * @example
 * import { Vector3 } from '../../core/math';
 * const [left, right] = createFootPlantState().feet;
 * const at = new Vector3(0.1, 0, 0.3);
 * holdFoot(left, right, at, new Vector3(0, 1, 0), { held: true, ground: 0, lift: 0, dt: 1 / 60 }); // 1: locked there
 * at.set(0.1, 0, 0.5); // the animation moves on…
 * holdFoot(left, right, at, new Vector3(0, 1, 0), { held: true, ground: 0, lift: 0, dt: 1 / 60 }); // 1
 * at.z; // 0.3: …and the sole stays put
 * @see engine/anim/locomotion/locks.test.ts
 */
import { Quaternion, Vector3 } from '../../core/math';
import type { HumanoidWeights } from '../locomotion';

/**
 * A foot's stance lock: the sole `point` and ground `normal` it holds (the point NaN until the foot is first placed),
 * its `weight` (1 locked, easing to 0), whether it is `stepping` back under the body and that step's `span` (its share
 * of a full step), the seconds its animation has held the sole `still` and on the floor outside its stance (`touch`),
 * and where the animation put it `last`.
 */
export type FootLock = {
  weight: number;
  stepping: boolean;
  span: number;
  still: number;
  touch: number;
  readonly point: Vector3;
  readonly normal: Vector3;
  readonly last: Vector3;
  /** The foot's world rotation as it locked: a held foot keeps its heading, turning only in a step. */
  readonly turn: Quaternion;
};

/** What `footPlant` keeps between ticks for one character: the left and right `feet`'s locks. */
export type FootPlantState = { readonly feet: readonly [FootLock, FootLock] };

/** A new, unlocked `FootPlantState`. */
export function createFootPlantState(): FootPlantState {
  const lock = (): FootLock => ({
    ...{ weight: 0, stepping: false, span: 1, still: 0, touch: 0 },
    ...{ point: new Vector3(NaN, NaN, NaN), normal: new Vector3(0, 1, 0), last: new Vector3(), turn: new Quaternion() },
  });
  return { feet: [lock(), lock()] };
}

/** The locks' tuning, in metres and seconds. */
export const FOOT_LOCK = {
  release: 0.05, // seconds a lock takes to let go once the stance ends (the planted stride is there by then)
  step: 0.12, // standing, how far a sole may stray from its animation before it steps there at once
  settle: 0.015, // …and how far once the animation has held it still for `settleTime`
  settleTime: 0.05,
  still: 0.06, // m/s: an animated sole slower than this is held still
  stepTime: 0.15, // seconds a full step takes…
  stride: 0.3, // …a full step being this long (a shorter one takes the square root of its share, a quarter at least)
  stepLift: 0.08, // how high a full step lifts, m (a half sine; a shorter one by its share of the time)
  carried: 1, // how far from its animation a lock is dropped at once: the body was put elsewhere
  lifted: 0.02, // m: an animated sole lifted higher than this was taken up (an action's kick): no stance holds it
  touch: 0.005, // m: on its feet, a sole its animation keeps this close to the floor holds (a push-off, a touchdown)…
  push: 0.1, // …for at most this long outside its stance (an animation dragging a foot drags it)
} as const;

/**
 * Whether a body with weights `w` is on its feet, so its locks may hold: not lying, climbing or striking at all, nor
 * flying or in a dash's first half (its locks let go at once, as the move begins to carry the feet). A kneel keeps
 * them, and a dash easing out lets them lock as it slows.
 */
export function onFeet(w: Readonly<HumanoidWeights>): boolean {
  return w.air < 0.5 && w.dash < 0.5 && Math.max(w.down, w.climb, w.attack) === 0;
}

/** What `holdFoot` is told about a foot this tick. */
export interface HoldOptions {
  /** Whether the foot is in stance: a foot in stance locks where it lands. */
  held: boolean;
  /** Standing still, where no contact window ends a stance: a sole astray steps back (see the file comment). */
  steps?: boolean;
  /** The ground's height under the animated sole, m. */
  ground: number;
  /** How high the animation lifts the sole over its floor, m. */
  lift: number;
  /** How high its foot's lowest point is (the toes as a heel lifts off the ball), m: past `FOOT_LOCK.lifted` the
   * animation took the foot up; `lift` by default. */
  bottom?: number;
  /** In its stride: a foot its animation takes up as its stance ends (the toe-off) still lets go over `release`, on the
   * level it holds on (one leaving it for a step up or down goes at once, never through the riser). */
  toeOff?: boolean;
  /** The tick's length, s. */
  dt: number;
  /** The ground's own velocity under the body, m/s (a treadmill): a lock rides along with it. */
  treadmill?: Vector3;
  /** Seconds a lock takes to let go; `FOOT_LOCK.release` by default, 0 at once (an action took the feet). */
  release?: number;
  /** The foot's world rotation in its animation: what a lock keeps from where it locks. */
  rotation?: Quaternion;
}

/**
 * Holds the foot whose lock is `lock` (the other foot's `other`): moves `at`, where its animation puts the sole on the
 * ground, and `normal`, the ground's there, to where the lock holds them; returns the lock's weight (1 held).
 */
export function holdFoot(lock: FootLock, other: FootLock, at: Vector3, normal: Vector3, how: HoldOptions): number {
  const L = FOOT_LOCK;
  const { steps = false, ground, lift, dt, treadmill, bottom = lift } = how;
  const lifted = bottom > L.lifted; // the animation took the foot up: it goes at once (a toe-off on its level, eased)
  const level = !(Math.abs(ground - lock.point.y) > L.lifted); // a step up or down ahead takes the sole along
  const release = lifted && !(how.toeOff && level) ? 0 : (how.release ?? L.release);
  const touching = release > 0 && lift <= L.touch && lock.touch < L.push && level;
  const held = (how.held || touching) && !lifted;
  lock.touch = how.held || lift > L.touch ? 0 : lock.touch + dt;
  if (treadmill) lock.point.addScaledVector(treadmill, dt);
  const astray = Math.hypot(lock.point.x - at.x, lock.point.z - at.z);
  const carried = astray > L.carried; // the body was put elsewhere: nothing holds
  if (carried) [lock.weight, lock.stepping] = [0, false];
  lock.still = Math.hypot(at.x - lock.last.x, at.z - lock.last.z) <= L.still * dt ? lock.still + dt : 0;
  lock.last.copy(at);
  const settle = astray > L.step || (astray > L.settle && lock.still >= L.settleTime);
  if (steps && held && lock.weight === 1 && !lock.stepping && !other.stepping && settle) {
    [lock.stepping, lock.span] = [true, Math.min(1, Math.max(0.25, Math.sqrt(astray / L.stride)))];
  }
  if (lock.stepping) {
    lock.weight = Math.max(0, lock.weight - dt / (L.stepTime * lock.span));
    if (lock.weight === 0) {
      // the step is done: it plants where it arrived
      [lock.stepping, lock.weight] = [false, held ? 1 : 0];
      lock.point.set(at.x, ground, at.z);
      lock.normal.copy(normal);
      if (how.rotation) lock.turn.copy(how.rotation);
    }
  } else if (held) {
    // standing, a free foot that comes down away from its place stays where it was, and steps there next
    if (lock.weight === 0 && steps && !carried && astray > L.step) lock.point.y = ground;
    else if (lock.weight < 1) {
      lock.point.set(at.x, ground, at.z); // on the ground, a sole the animation hovers over it too
      lock.normal.copy(normal);
      if (how.rotation) lock.turn.copy(how.rotation);
    }
    lock.weight = 1;
  } else {
    lock.weight = release > 0 ? Math.max(0, lock.weight - dt / release) : 0;
    if (lock.weight === 0) {
      lock.point.copy(at); // free: where its animation puts it
      lock.normal.copy(normal);
      if (how.rotation) lock.turn.copy(how.rotation);
    }
  }
  const w = lock.weight;
  at.lerp(lock.point, w);
  // letting go, the sole lifts as the animation lifts it over the ground between, never dragged along the floor; a
  // step lifts it too
  if (!held || lock.stepping) at.y += lift * w + (lock.stepping ? L.stepLift * lock.span * Math.sin(Math.PI * w) : 0);
  normal.lerp(lock.normal, w).normalize();
  return w;
}
